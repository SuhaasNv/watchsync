// The background's side of chat (UC-014): tab events to the room, the room's chat back to tabs,
// delivery (the v0.2 retry policy), and the unread count. Kept apart from index.ts so it can be
// tested.
import {
  type AnyServerMessage,
  type ClientMessageOf,
  envelope,
  isClientMessage,
  type ServerMessageOf,
} from "@watchsync/protocol";
import {
  CHAT_FLUSH_GAP_MS,
  CHAT_GIVE_UP_MS,
  CHAT_QUEUE_MAX,
  CHAT_SENDING_MS,
  type Chat,
  chatAfter,
  chatOpened,
  isChatText,
  NO_CHAT,
  normalizeChatText,
  safeMovieTime,
} from "../shared/chat";
import type { Push, TabEvent } from "../shared/messages";

/** The part of a runtime port the relay uses. */
export interface RelayPort {
  name: string;
  postMessage(message: Push): void;
}

/** What survives a worker restart: ids and counts, never text (DEC-032). */
export interface ChatSeen {
  unread: number;
  lastSeen: string | null;
}

/** open: the room's socket is open; reconnecting: in a room, waiting for it; closed: no room. */
export type Link = "open" | "reconnecting" | "closed";

export interface RelayDeps {
  /** Send on the room's socket; false when it isn't open. */
  send(message: ClientMessageOf<"CHAT.SEND">): boolean;
  link(): Link;
  /** Our participant id in the room. */
  you(): string | null;
  /** The unread count or last-seen id changed: keep it and show it. */
  seen(seen: ChatSeen): void;
  /** Whether a port is still connected. */
  connected(port: RelayPort): boolean;
}

export type ChatTabEvent = Extract<TabEvent, { kind: "chat" | "chatOpened" }>;
type Failure = Extract<Push, { kind: "chatFailed" }>["reason"];

/** A message on its way: sent and waiting for its echo, or queued for the next connection. */
interface Outgoing {
  port: RelayPort;
  text: string;
  message: ClientMessageOf<"CHAT.SEND">;
  queued: boolean;
  timers: ReturnType<typeof setTimeout>[];
}

export function chatRelay(deps: RelayDeps) {
  let chat: Chat = NO_CHAT;
  /** The room's history has arrived since the last reset (or worker start). */
  let historyKnown = false;
  /** In the order they were first sent (a Retry goes to the end). */
  const outgoing = new Map<string, Outgoing>();
  let flushing: ReturnType<typeof setTimeout> | undefined;

  const report = () => deps.seen({ unread: chat.unread, lastSeen: chat.lastSeen });
  const queued = () => [...outgoing.values()].filter((o) => o.queued);

  function post(port: RelayPort, message: Push) {
    if (deps.connected(port)) port.postMessage(message);
  }

  function fail(port: RelayPort, text: string, clientId: string, reason: Failure) {
    post(port, { kind: "chatFailed", reason, text, clientId });
  }

  /** The message arrived, was refused, or was given up on: stop trying. */
  function settle(clientId: string): Outgoing | undefined {
    const o = outgoing.get(clientId);
    if (!o) return undefined;
    for (const t of o.timers) clearTimeout(t);
    outgoing.delete(clientId);
    return o;
  }

  /** Queued messages go out one at a time, spaced so the room's rate limit never trips. */
  function flush() {
    flushing = undefined;
    const next = queued()[0];
    if (!next || !deps.send(next.message)) return;
    next.queued = false;
    if (queued().length > 0) flushing = setTimeout(flush, CHAT_FLUSH_GAP_MS);
  }

  return {
    get unread() {
      return chat.unread;
    },

    /** After a worker restart: the stored count and last seen message of this room. */
    restore(seen: ChatSeen) {
      chat = { ...chat, ...seen };
    },

    onTabEvent(port: RelayPort, e: ChatTabEvent) {
      if (e.kind === "chatOpened") {
        chat = chatOpened(chat);
        return report();
      }
      const { clientId } = e;
      const message = envelope<ClientMessageOf<"CHAT.SEND">>("CHAT.SEND", {
        text: normalizeChatText(e.text),
        movieTime: safeMovieTime(e.movieTime),
        titleId: e.titleId,
        clientId,
      });
      // What the room would refuse is never sent (or queued): the tab says why at once.
      if (!isClientMessage(message) || !isChatText(message.payload.text))
        return fail(port, e.text, clientId, "invalid");
      settle(clientId); // a Retry starts over, with the same clientId
      const link = deps.link();
      const sent = link === "open" && queued().length === 0 && deps.send(message);
      if (!sent && (link === "closed" || queued().length >= CHAT_QUEUE_MAX))
        return fail(port, e.text, clientId, "offline");
      const timers = [
        setTimeout(() => post(port, { kind: "chatSending", clientId }), CHAT_SENDING_MS),
        setTimeout(() => {
          if (settle(clientId)) fail(port, e.text, clientId, "offline");
        }, CHAT_GIVE_UP_MS),
      ];
      outgoing.set(clientId, { port, text: e.text, message, queued: !sent, timers });
      // Connected while earlier ones are still going out: it follows them.
      if (!sent && link === "open" && flushing === undefined)
        flushing = setTimeout(flush, CHAT_FLUSH_GAP_MS);
    },

    /**
     * Where a server message goes: every port, only the tab whose send the room refused, or
     * nowhere (a refusal nobody is waiting for any more). A refusal is never retried.
     */
    onServer(msg: AnyServerMessage): RelayPort | "all" | null {
      if (msg.type === "CHAT.REJECTED") {
        const { clientId } = msg.payload;
        return (clientId === undefined ? undefined : settle(clientId))?.port ?? null;
      }
      if (msg.type !== "CHAT.HISTORY" && msg.type !== "CHAT.MESSAGE") return "all";
      if (msg.type === "CHAT.MESSAGE") settle(msg.payload.clientId);
      else {
        historyKnown = true;
        // Arrived before the connection dropped, with the echo lost: nothing to resend.
        const you = deps.you();
        for (const m of msg.payload.messages) if (m.fromId === you) settle(m.clientId);
      }
      const before = chat;
      chat = chatAfter(chat, msg, deps.you());
      if (chat.unread !== before.unread || chat.lastSeen !== before.lastSeen) report();
      return "all";
    },

    /** A chat frame that opens (or reloads) gets the earlier messages, once the room sent them. */
    onPortConnected(port: RelayPort) {
      if (port.name !== "sidebar" || !historyKnown) return; // chat goes to chat frames only
      const { messages } = chat;
      const history = envelope<ServerMessageOf<"CHAT.HISTORY">>("CHAT.HISTORY", { messages });
      port.postMessage({ kind: "server", message: history });
    },

    /** Connected again: what waited goes out, with the same clientIds. */
    onSocketOpen() {
      clearTimeout(flushing);
      flush();
    },

    /** The socket closed: whatever had no echo yet is sent again on the next connection. */
    onSocketClosed() {
      clearTimeout(flushing);
      flushing = undefined;
      for (const o of outgoing.values()) o.queued = true;
    },

    /** Leaving, ending or switching rooms: the chat stays with the room. */
    reset() {
      for (const clientId of [...outgoing.keys()]) settle(clientId);
      clearTimeout(flushing);
      flushing = undefined;
      chat = NO_CHAT;
      historyKnown = false;
    },
  };
}
