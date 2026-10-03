import {
  type ChatMessagePayload,
  envelope,
  isServerMessage,
  type ServerMessageOf,
} from "@watchsync/protocol";
import { describe, expect, it } from "vitest";
import {
  CHAT_KEEP,
  type Chat,
  chatAfter,
  chatOpened,
  NO_CHAT,
  normalizeChatText,
  safeMovieTime,
  salvageHistory,
  unreadLabel,
} from "./chat";

const said = (text: string, fromId = "friend"): ChatMessagePayload => ({
  id: text,
  clientId: `c-${text}`,
  fromId,
  name: fromId === "me" ? "Maya" : "Asha",
  text,
  movieTime: 2530,
  titleId: "1",
  serverTime: 1,
});
const message = (m: ChatMessagePayload) =>
  envelope<ServerMessageOf<"CHAT.MESSAGE">>("CHAT.MESSAGE", m);
const history = (messages: ChatMessagePayload[]) =>
  envelope<ServerMessageOf<"CHAT.HISTORY">>("CHAT.HISTORY", { messages });
const texts = (chat: Chat) => chat.messages.map((m) => m.text);

describe("chat buffer and unread count (US-042, US-044)", () => {
  it("counts messages from other people, never my own", () => {
    let chat = chatAfter(NO_CHAT, history([]), "me");
    chat = chatAfter(chat, message(said("hi")), "me");
    chat = chatAfter(chat, message(said("hello", "me")), "me");
    chat = chatAfter(chat, message(said("again")), "me");
    expect(chat.unread).toBe(2);
    expect(texts(chat)).toEqual(["hi", "hello", "again"]);
  });

  it("never counts the earlier messages a join loads", () => {
    const chat = chatAfter(NO_CHAT, history([said("a"), said("b")]), "me");
    expect(chat.unread).toBe(0);
    expect(texts(chat)).toEqual(["a", "b"]);
    expect(chat.lastSeen).toBe("b");
  });

  it("on a reconnect, counts other people's messages after the last one seen", () => {
    let chat = chatAfter(NO_CHAT, history([said("a")]), "me"); // joined: a is seen
    chat = chatAfter(chat, message(said("b")), "me");
    // The connection dropped; c (someone else) and d (mine) were said meanwhile.
    chat = chatAfter(chat, history([said("a"), said("b"), said("c"), said("d", "me")]), "me");
    expect(chat.unread).toBe(2); // b and c
    expect(texts(chat)).toEqual(["a", "b", "c", "d"]);
    // Opened: everything is seen; the next reconnect counts nothing old.
    chat = chatOpened(chat);
    expect(chat).toMatchObject({ unread: 0, lastSeen: "d" });
    chat = chatAfter(chat, history([said("a"), said("b"), said("c"), said("d", "me")]), "me");
    expect(chat.unread).toBe(0);
  });

  it("counts the whole history when the last seen one was pushed out of it", () => {
    const chat = chatAfter({ ...NO_CHAT, lastSeen: "gone" }, history([said("x"), said("y")]), "me");
    expect(chat.unread).toBe(2);
  });

  it("counts everything after a join into a room with no messages yet", () => {
    let chat = chatAfter(NO_CHAT, history([]), "me");
    expect(chat.lastSeen).toBe("");
    chat = chatAfter(chat, history([said("x"), said("y", "me")]), "me"); // a reconnect
    expect(chat.unread).toBe(1);
  });

  it("recounts from stored ids after a worker restart, with no text kept", () => {
    const restored: Chat = { messages: [], unread: 1, lastSeen: "b" };
    const chat = chatAfter(restored, history([said("a"), said("b"), said("c"), said("d")]), "me");
    expect(chat.unread).toBe(2);
  });

  it("never adds or counts the same message twice (a retry's echo)", () => {
    let chat = chatAfter(chatAfter(NO_CHAT, history([]), "me"), message(said("hi")), "me");
    chat = chatAfter(chat, message(said("hi")), "me");
    expect(texts(chat)).toEqual(["hi"]);
    expect(chat.unread).toBe(1);
  });

  it("keeps only the most recent 200", () => {
    const many = Array.from({ length: CHAT_KEEP }, (_, i) => said(`h${i}`));
    let chat = chatAfter(NO_CHAT, history(many), "me");
    chat = chatAfter(chat, message(said("new")), "me");
    expect(CHAT_KEEP).toBe(200);
    expect(chat.messages).toHaveLength(200);
    expect(chat.messages[0]?.text).toBe("h1");
    expect(chat.messages.at(-1)?.text).toBe("new");
  });

  it("is untouched by other messages and refusals", () => {
    const pong = envelope<ServerMessageOf<"SYS.PONG">>("SYS.PONG", { t1: 1, serverTime: 2 });
    const refused = envelope<ServerMessageOf<"CHAT.REJECTED">>("CHAT.REJECTED", {
      reason: "rate_limited",
      text: "hi",
    });
    const chat = { messages: [said("a")], unread: 1, lastSeen: "" };
    expect(chatAfter(chat, pong, "me")).toBe(chat);
    expect(chatAfter(chat, refused, "me")).toBe(chat);
  });

  it("shows more than 9 as 9+", () => {
    expect([0, 1, 9, 10, 250].map(unreadLabel)).toEqual(["0", "1", "9", "9+", "9+"]);
  });
});

describe("what a tab sends", () => {
  it("keeps line breaks as a newline and turns tabs into spaces", () => {
    expect(normalizeChatText("a\r\nb\rc\nd\te")).toBe("a\nb\nc\nd e");
  });

  it("never lets the movie time stop a message", () => {
    for (const t of [Number.POSITIVE_INFINITY, Number.NaN, -1, 86_401, null])
      expect(safeMovieTime(t), String(t)).toBeNull();
    expect(safeMovieTime(0)).toBe(0);
    expect(safeMovieTime(2530.4)).toBe(2530.4);
    expect(safeMovieTime(86_400)).toBe(86_400);
  });
});

describe("a history with a bad message in it (defence in depth)", () => {
  const raw = (messages: unknown) => ({
    id: "1",
    type: "CHAT.HISTORY",
    timestamp: 1,
    payload: { messages },
  });

  it("keeps the valid messages, in order, instead of dropping them all", () => {
    const bad = [
      { ...said("x"), text: `a${String.fromCodePoint(0x202e)}b` },
      { ...said("x"), text: "a\tb" },
      { ...said("x"), name: "" },
      { ...said("x"), clientId: "a b" },
      { ...said("x"), extra: 1 },
      "not a message",
      null,
    ];
    const msg = raw([said("a"), ...bad, said("b")]);
    expect(isServerMessage(msg)).toBe(false); // the whole history would have been lost
    const saved = salvageHistory(msg);
    expect(saved && isServerMessage(saved)).toBe(true);
    expect(saved?.payload.messages.map((m) => m.text)).toEqual(["a", "b"]);
  });

  it("keeps only the last 200 of an oversized history", () => {
    const saved = salvageHistory(raw(Array.from({ length: 201 }, (_, i) => said(`h${i}`))));
    expect(saved?.payload.messages).toHaveLength(200);
    expect(saved?.payload.messages[0]?.text).toBe("h1");
  });

  it("leaves everything else alone", () => {
    for (const other of [
      null,
      "CHAT.HISTORY",
      raw("nope"),
      { ...raw([]), payload: null },
      { id: "1", type: "CHAT.MESSAGE", timestamp: 1, payload: { ...said("x"), text: "" } },
      { id: "1", type: "ROOM.STATE", timestamp: 1, payload: {} },
    ])
      expect(salvageHistory(other)).toBeNull();
  });
});
