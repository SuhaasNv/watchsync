import { type ChatMessagePayload, envelope, type ServerMessageOf } from "@watchsync/protocol";
import { describe, expect, it } from "vitest";
import { CHAT_KEEP, type Chat, chatAfter } from "./chat";

const said = (text: string, fromId = "friend"): ChatMessagePayload => ({
  id: text,
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
const empty: Chat = { messages: [], unread: 0 };

describe("chat buffer and unread count (US-042, US-044)", () => {
  it("counts messages from other people, never my own", () => {
    let chat = chatAfter(empty, message(said("hi")), "me");
    chat = chatAfter(chat, message(said("hello", "me")), "me");
    chat = chatAfter(chat, message(said("again")), "me");
    expect(chat.unread).toBe(2);
    expect(chat.messages.map((m) => m.text)).toEqual(["hi", "hello", "again"]);
  });

  it("never counts earlier messages loaded from the room", () => {
    const chat = chatAfter({ messages: [], unread: 3 }, history([said("a"), said("b")]), "me");
    expect(chat.unread).toBe(3);
    expect(chat.messages.map((m) => m.text)).toEqual(["a", "b"]);
  });

  it("takes the room's history in place of what it had (a reconnect)", () => {
    const before = chatAfter(empty, message(said("old")), "me");
    const after = chatAfter(before, history([said("a")]), "me");
    expect(after.messages.map((m) => m.text)).toEqual(["a"]);
  });

  it("keeps only the most recent 200", () => {
    let chat = chatAfter(
      empty,
      history(Array.from({ length: CHAT_KEEP }, (_, i) => said(`h${i}`))),
      "me",
    );
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
    const chat = { messages: [said("a")], unread: 1 };
    expect(chatAfter(chat, pong, "me")).toBe(chat);
    expect(chatAfter(chat, refused, "me")).toBe(chat);
  });
});
