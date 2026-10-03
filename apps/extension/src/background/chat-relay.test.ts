import {
  type AnyServerMessage,
  type ChatMessagePayload,
  type ClientMessageOf,
  envelope,
  type ServerMessageOf,
} from "@watchsync/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Push } from "../shared/messages";
import { type ChatSeen, chatRelay, type RelayPort } from "./chat-relay";

class FakePort implements RelayPort {
  got: Push[] = [];
  constructor(readonly name: string) {}
  postMessage(message: Push) {
    this.got.push(message);
  }
}

function setup() {
  const sent: ClientMessageOf<"CHAT.SEND">[] = [];
  const seen: ChatSeen[] = [];
  const open = new Set<RelayPort>();
  const deps = {
    socketOpen: true,
    send(msg: ClientMessageOf<"CHAT.SEND">) {
      if (!deps.socketOpen) return false;
      sent.push(msg);
      return true;
    },
    you: () => "me",
    seen: (s: ChatSeen) => seen.push(s),
    connected: (port: RelayPort) => open.has(port),
  };
  const relay = chatRelay(deps);
  const port = (name = "tab") => {
    const p = new FakePort(name);
    open.add(p);
    return p;
  };
  return { relay, deps, sent, seen, open, port };
}

const said = (text: string, fromId = "friend", clientId = `c-${text}`): ChatMessagePayload => ({
  id: text,
  clientId,
  fromId,
  name: "Asha",
  text,
  movieTime: 1,
  titleId: "1",
  serverTime: 1,
});
const message = (m: ChatMessagePayload) =>
  envelope<ServerMessageOf<"CHAT.MESSAGE">>("CHAT.MESSAGE", m);
const history = (messages: ChatMessagePayload[]) =>
  envelope<ServerMessageOf<"CHAT.HISTORY">>("CHAT.HISTORY", { messages });
const rejected = (clientId?: string): AnyServerMessage =>
  envelope<ServerMessageOf<"CHAT.REJECTED">>("CHAT.REJECTED", {
    reason: "rate_limited",
    text: "hi",
    ...(clientId ? { clientId } : {}),
  });
const chatEvent = (text: string, clientId: string, movieTime: number | null = 61) =>
  ({ kind: "chat", text, movieTime, titleId: "1", clientId }) as const;
const failures = (p: FakePort) => p.got.filter((m) => m.kind === "chatFailed");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("sending (US-042)", () => {
  it("sends a valid CHAT.SEND with line breaks kept and tabs as spaces", () => {
    const { relay, sent, port } = setup();
    relay.onTabEvent(port(), chatEvent("a\r\nb\tc", "c-1"));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload).toEqual({
      text: "a\nb c",
      movieTime: 61,
      titleId: "1",
      clientId: "c-1",
    });
  });

  it("sends with no movie time rather than refusing one it can't take", () => {
    const { relay, sent, port } = setup();
    const tab = port();
    relay.onTabEvent(tab, chatEvent("live", "c-1", Number.POSITIVE_INFINITY));
    expect(sent[0]?.payload.movieTime).toBeNull();
    expect(failures(tab)).toEqual([]);
  });

  it("is confirmed by its own echo: no Not sent", () => {
    const { relay, port } = setup();
    const tab = port();
    relay.onTabEvent(tab, chatEvent("hi", "c-1"));
    relay.onServer(message(said("hi", "me", "c-1")));
    vi.advanceTimersByTime(10_000);
    expect(failures(tab)).toEqual([]);
  });

  it("says Not sent (offline) when no echo comes within 5 s, even with the socket open", () => {
    const { relay, port } = setup();
    const tab = port();
    relay.onTabEvent(tab, chatEvent("hi", "c-1"));
    vi.advanceTimersByTime(4999);
    expect(failures(tab)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(failures(tab)).toEqual([
      { kind: "chatFailed", reason: "offline", text: "hi", clientId: "c-1" },
    ]);
  });

  it("says Not sent at once when the socket isn't open", () => {
    const { relay, deps, sent, port } = setup();
    const tab = port();
    deps.socketOpen = false;
    relay.onTabEvent(tab, chatEvent("hi", "c-1"));
    expect(sent).toEqual([]);
    expect(failures(tab)).toEqual([
      { kind: "chatFailed", reason: "offline", text: "hi", clientId: "c-1" },
    ]);
  });

  it("says Not sent when the socket closes while waiting (a half-open connection)", () => {
    const { relay, port } = setup();
    const tab = port();
    relay.onTabEvent(tab, chatEvent("hi", "c-1"));
    relay.onSocketClosed();
    expect(failures(tab).map((m) => m.kind === "chatFailed" && m.reason)).toEqual(["offline"]);
    vi.advanceTimersByTime(10_000);
    expect(failures(tab)).toHaveLength(1); // once
  });

  it("says invalid, without sending, for text the room can't take", () => {
    const { relay, sent, port } = setup();
    const tab = port();
    relay.onTabEvent(tab, chatEvent("x".repeat(501), "c-1"));
    relay.onTabEvent(tab, chatEvent("hi", "not a client id"));
    expect(sent).toEqual([]);
    expect(failures(tab).map((m) => m.kind === "chatFailed" && m.reason)).toEqual([
      "invalid",
      "invalid",
    ]);
  });

  it("a Retry with the same clientId takes over the earlier wait", () => {
    const { relay, sent, port } = setup();
    const tab = port();
    relay.onTabEvent(tab, chatEvent("hi", "c-1"));
    vi.advanceTimersByTime(4000);
    relay.onTabEvent(tab, chatEvent("hi", "c-1"));
    vi.advanceTimersByTime(2000);
    expect(failures(tab)).toEqual([]); // the first wait was dropped
    expect(sent.map((m) => m.payload.clientId)).toEqual(["c-1", "c-1"]);
  });

  it("tells nobody when the tab has gone", () => {
    const { relay, open, port } = setup();
    const tab = port();
    relay.onTabEvent(tab, chatEvent("hi", "c-1"));
    open.delete(tab);
    vi.advanceTimersByTime(5000);
    expect(tab.got).toEqual([]);
  });
});

describe("refusals go to the sending tab only", () => {
  it("routes CHAT.REJECTED to the tab that sent it, and ends its wait", () => {
    const { relay, port } = setup();
    const a = port();
    port();
    relay.onTabEvent(a, chatEvent("hi", "c-1"));
    expect(relay.onServer(rejected("c-1"))).toBe(a);
    vi.advanceTimersByTime(10_000);
    expect(failures(a)).toEqual([]);
  });

  it("sends a refusal nobody waits for nowhere", () => {
    const { relay } = setup();
    expect(relay.onServer(rejected("c-unknown"))).toBeNull();
    expect(relay.onServer(rejected())).toBeNull();
  });

  it("sends every other message to every port", () => {
    const { relay } = setup();
    const pong = envelope<ServerMessageOf<"SYS.PONG">>("SYS.PONG", { t1: 1, serverTime: 2 });
    expect(relay.onServer(pong)).toBe("all");
    expect(relay.onServer(history([]))).toBe("all");
    expect(relay.onServer(message(said("hi")))).toBe("all");
  });
});

describe("unread count (US-044)", () => {
  it("counts others' messages, reports each change, and clears when opened", () => {
    const { relay, seen, port } = setup();
    relay.onServer(history([said("a")]));
    relay.onServer(message(said("b")));
    relay.onServer(message(said("mine", "me")));
    relay.onServer(message(said("c")));
    expect(relay.unread).toBe(2);
    relay.onTabEvent(port(), { kind: "chatOpened" });
    expect(relay.unread).toBe(0);
    expect(seen.at(-1)).toEqual({ unread: 0, lastSeen: "c" });
    expect(seen.map((s) => s.unread)).toEqual([0, 1, 2, 0]);
  });

  it("recounts from the stored state after a worker restart", () => {
    const { relay } = setup();
    relay.restore({ unread: 1, lastSeen: "b" });
    expect(relay.unread).toBe(1);
    relay.onServer(history([said("a"), said("b"), said("c"), said("d")]));
    expect(relay.unread).toBe(2);
  });
});

describe("history for a tab that opens", () => {
  it("is replayed to tabs only, and only once the room has sent it", () => {
    const { relay, port } = setup();
    const early = port();
    relay.onPortConnected(early); // a worker restart: nothing known yet
    expect(early.got).toEqual([]);
    relay.onServer(history([said("a")]));
    relay.onServer(message(said("b")));
    const tab = port();
    const popup = port("popup");
    relay.onPortConnected(tab);
    relay.onPortConnected(popup);
    expect(popup.got).toEqual([]);
    const [push] = tab.got;
    expect(push?.kind === "server" && push.message.type).toBe("CHAT.HISTORY");
    if (push?.kind === "server" && push.message.type === "CHAT.HISTORY")
      expect(push.message.payload.messages.map((m) => m.text)).toEqual(["a", "b"]);
  });

  it("is forgotten, with the unread count and every wait, on reset", () => {
    const { relay, port } = setup();
    const tab = port();
    relay.onServer(history([]));
    relay.onServer(message(said("a")));
    relay.onTabEvent(tab, chatEvent("hi", "c-1"));
    relay.reset();
    expect(relay.unread).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(failures(tab)).toEqual([]);
    const next = port();
    relay.onPortConnected(next);
    expect(next.got).toEqual([]); // no replay until the next room's history
    relay.onServer(history([]));
    relay.onPortConnected(next);
    const [push] = next.got;
    expect(push?.kind === "server" && push.message.type === "CHAT.HISTORY").toBe(true);
    if (push?.kind === "server" && push.message.type === "CHAT.HISTORY")
      expect(push.message.payload.messages).toEqual([]);
  });
});
