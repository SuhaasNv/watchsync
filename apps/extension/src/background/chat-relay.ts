// The background's side of chat (UC-014): tab events to the room, the room's chat back to tabs,
// delivery confirmation, and the unread count. Kept apart from index.ts so it can be tested.
import {
  type AnyServerMessage,
  type ClientMessageOf,
  envelope,
  isClientMessage,
  type ServerMessageOf,
} from "@watchsync/protocol";
import {
  CHAT_CONFIRM_MS,
  type Chat,
  chatAfter,
  chatOpened,
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

export interface RelayDeps {
  /** Send on the room's socket; false when it isn't open. */
  send(message: ClientMessageOf<"CHAT.SEND">): boolean;
  /** Our participant id in the room. */
  you(): string | null;
  /** The unread count or last-seen id changed: keep it and show it. */
  seen(seen: ChatSeen): void;
  /** Whether a port is still connected. */
  connected(port: RelayPort): boolean;
}

export type ChatTabEvent = Extract<TabEvent, { kind: "chat" | "chatOpened" }>;
type Failure = Extract<Push, { kind: "chatFailed" }>["reason"];
interface Pending {
  port: RelayPort;
  text: string;
  timer: ReturnType<typeof setTimeout>;
}

export function chatRelay(deps: RelayDeps, confirmMs = CHAT_CONFIRM_MS) {
  let chat: Chat = NO_CHAT;
  /** The room's history has arrived since the last reset (or worker start). */
  let historyKnown = false;
  const pending = new Map<string, Pending>();

  const report = () => deps.seen({ unread: chat.unread, lastSeen: chat.lastSeen });

  function fail(port: RelayPort, text: string, clientId: string, reason: Failure) {
    if (deps.connected(port)) port.postMessage({ kind: "chatFailed", reason, text, clientId });
  }

  function settle(clientId: string): Pending | undefined {
    const p = pending.get(clientId);
    if (!p) return undefined;
    clearTimeout(p.timer);
    pending.delete(clientId);
    return p;
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
      if (!isClientMessage(message)) return fail(port, e.text, clientId, "invalid");
      settle(clientId); // a Retry takes over the earlier wait
      if (!deps.send(message)) return fail(port, e.text, clientId, "offline");
      const timer = setTimeout(() => {
        if (settle(clientId)) fail(port, e.text, clientId, "offline");
      }, confirmMs);
      pending.set(clientId, { port, text: e.text, timer });
    },

    /**
     * Where a server message goes: every port, only the tab whose send the room refused, or
     * nowhere (a refusal nobody is waiting for any more).
     */
    onServer(msg: AnyServerMessage): RelayPort | "all" | null {
      if (msg.type === "CHAT.REJECTED") {
        const { clientId } = msg.payload;
        return (clientId === undefined ? undefined : settle(clientId))?.port ?? null;
      }
      if (msg.type !== "CHAT.HISTORY" && msg.type !== "CHAT.MESSAGE") return "all";
      if (msg.type === "CHAT.MESSAGE") settle(msg.payload.clientId);
      else historyKnown = true;
      const before = chat;
      chat = chatAfter(chat, msg, deps.you());
      if (chat.unread !== before.unread || chat.lastSeen !== before.lastSeen) report();
      return "all";
    },

    /** A tab that opens (or reloads) gets the earlier messages, once the room has sent them. */
    onPortConnected(port: RelayPort) {
      if (port.name !== "tab" || !historyKnown) return;
      const { messages } = chat;
      const history = envelope<ServerMessageOf<"CHAT.HISTORY">>("CHAT.HISTORY", { messages });
      port.postMessage({ kind: "server", message: history });
    },

    /** The socket closed: nothing waiting for an echo will get one. */
    onSocketClosed() {
      for (const clientId of [...pending.keys()]) {
        const p = settle(clientId);
        if (p) fail(p.port, p.text, clientId, "offline");
      }
    },

    /** Leaving, ending or switching rooms: the chat stays with the room. */
    reset() {
      for (const p of pending.values()) clearTimeout(p.timer);
      pending.clear();
      chat = NO_CHAT;
      historyKnown = false;
    },
  };
}
