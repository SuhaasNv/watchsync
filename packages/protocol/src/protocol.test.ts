import { describe, expect, it } from "vitest";
import { type ClientMessageOf, envelope, isClientMessage, isServerMessage } from "./index";

describe("protocol validators", () => {
  it("accepts a valid playback update", () => {
    const m = envelope<ClientMessageOf<"PLAYBACK.UPDATE">>("PLAYBACK.UPDATE", {
      action: "seek",
      status: "playing",
      position: 2530.4,
      rate: 1,
      titleId: "80057281",
    });
    expect(isClientMessage(m)).toBe(true);
  });

  it("rejects unknown types, bad values and extra fields", () => {
    const base = { id: "1", timestamp: 1, type: "PLAYBACK.UPDATE" };
    expect(isClientMessage({ ...base, type: "PLAYBACK.NOPE", payload: {} })).toBe(false);
    expect(
      isClientMessage({
        ...base,
        payload: { action: "seek", position: -1, rate: 1, titleId: null },
      }),
    ).toBe(false);
    expect(
      isClientMessage({
        ...base,
        payload: { action: "play", position: 1, rate: 1, titleId: null, extra: true },
      }),
    ).toBe(false);
  });

  it("accepts a room restore with or without a title and clock (US-120)", () => {
    const media = { service: "mock", titleId: "ep1", titleName: null, titleUrl: null } as const;
    const playback = { status: "paused", position: 2530, rate: 1, updatedAt: 1, titleId: "ep1" };
    const restore = (payload: Record<string, unknown>) => ({
      id: "1",
      type: "ROOM.RESTORE",
      timestamp: 1,
      payload,
    });
    expect(isClientMessage(restore({ media, playback, knownAt: 1 }))).toBe(true);
    expect(isClientMessage(restore({ media: null, playback: null, knownAt: 0 }))).toBe(true);
    expect(isClientMessage(restore({ media, knownAt: 1 }))).toBe(false);
    expect(isClientMessage(restore({ media, playback }))).toBe(false); // knownAt is required
    expect(isClientMessage(restore({ media, playback, knownAt: -1 }))).toBe(false);
    expect(isClientMessage(restore({ media, playback, knownAt: 1, chat: [] }))).toBe(false);
    const behind = { ...playback, position: -1 };
    expect(isClientMessage(restore({ media, playback: behind, knownAt: 1 }))).toBe(false);
  });

  it("does not accept server messages as client messages", () => {
    const pong = { id: "1", timestamp: 1, type: "SYS.PONG", payload: { t1: 1, serverTime: 2 } };
    expect(isServerMessage(pong)).toBe(true);
    expect(isClientMessage(pong)).toBe(false);
  });
});

describe("boundary values (edge-case sweep, UC-008)", () => {
  const update = (payload: Record<string, unknown>) => ({
    id: "1",
    type: "PLAYBACK.UPDATE",
    timestamp: 1,
    payload: { action: "seek", status: "playing", position: 1, rate: 1, titleId: "t", ...payload },
  });

  it("refuses non-finite, negative and out-of-range positions and rates", () => {
    for (const position of [Number.NaN, Number.POSITIVE_INFINITY, -0.5, 86_401, "1"])
      expect(isClientMessage(update({ position }))).toBe(false);
    for (const rate of [Number.NaN, 0, 0.1, 16, Number.POSITIVE_INFINITY])
      expect(isClientMessage(update({ rate }))).toBe(false);
    expect(isClientMessage(update({ position: 0, rate: 0.25 }))).toBe(true);
    expect(isClientMessage(update({ position: 86_400, rate: 4 }))).toBe(true);
  });

  it("caps title IDs, names and links", () => {
    expect(isClientMessage(update({ titleId: "x".repeat(201) }))).toBe(false);
    const presence = (media: Record<string, unknown>) => ({
      id: "1",
      type: "PRESENCE.UPDATE",
      timestamp: 1,
      payload: {
        service: "netflix",
        following: true,
        media: { service: "netflix", titleId: "1", titleName: "A", titleUrl: null, ...media },
      },
    });
    expect(isClientMessage(presence({}))).toBe(true);
    expect(isClientMessage(presence({ titleName: "x".repeat(201) }))).toBe(false);
    expect(isClientMessage(presence({ titleUrl: "x".repeat(2001) }))).toBe(false);
    expect(isClientMessage(presence({ service: "youtube" }))).toBe(false);
    // Script-like text is only data: it is accepted and later rendered as text.
    expect(isClientMessage(presence({ titleName: "<img src=x onerror=alert(1)>" }))).toBe(true);
  });

  it("refuses envelopes with a missing or wrongly typed field", () => {
    const ok = update({});
    expect(isClientMessage(ok)).toBe(true);
    expect(isClientMessage({ ...ok, id: 1 })).toBe(false);
    expect(isClientMessage({ ...ok, id: "x".repeat(65) })).toBe(false);
    expect(isClientMessage({ ...ok, timestamp: "1" })).toBe(false);
    expect(isClientMessage({ ...ok, payload: null })).toBe(false);
    expect(isClientMessage(null)).toBe(false);
    expect(isClientMessage("PLAYBACK.UPDATE")).toBe(false);
    expect(isClientMessage([])).toBe(false);
  });
});

describe("chat messages (UC-014)", () => {
  const chat = (payload: Record<string, unknown>) => ({
    id: "1",
    type: "CHAT.SEND",
    timestamp: 1,
    payload: { text: "hi", movieTime: 2530, titleId: "80057281", ...payload },
  });
  const relayed = (payload: Record<string, unknown> = {}) => ({
    id: "a1b2c3d4e5f60708",
    fromId: "p1",
    name: "Maya",
    text: "hi",
    movieTime: 2530,
    titleId: "80057281",
    serverTime: 1,
    ...payload,
  });
  const server = (type: string, payload: unknown) => ({ id: "1", type, timestamp: 1, payload });

  it("accepts a chat message with or without a movie time", () => {
    const m = envelope<ClientMessageOf<"CHAT.SEND">>("CHAT.SEND", {
      text: "hi",
      movieTime: 2530.4,
      titleId: "80057281",
    });
    expect(isClientMessage(m)).toBe(true);
    expect(isClientMessage(chat({ movieTime: null, titleId: null }))).toBe(true);
    // Script-like text is only data: it is accepted and later rendered as text.
    expect(isClientMessage(chat({ text: "<img src=x onerror=alert(1)> https://x.y" }))).toBe(true);
  });

  it("counts length in code points, so 500 emoji fit and 501 don't", () => {
    // Each emoji is two UTF-16 units; a UTF-16 count would refuse 500 of them.
    expect(isClientMessage(chat({ text: "😀".repeat(500) }))).toBe(true);
    expect(isClientMessage(chat({ text: "😀".repeat(501) }))).toBe(false);
    expect(isClientMessage(chat({ text: "x".repeat(500) }))).toBe(true);
    expect(isClientMessage(chat({ text: "x".repeat(501) }))).toBe(false);
    expect(isClientMessage(chat({ text: "" }))).toBe(false);
  });

  it("refuses control characters, newlines included", () => {
    for (const c of ["\u0000", "\n", "\r", "\t", "\u001b", "\u007f", "\u0085", "\u009f"])
      expect(isClientMessage(chat({ text: `a${c}b` })), JSON.stringify(c)).toBe(false);
    expect(isClientMessage(chat({ text: "a b" }))).toBe(true); // a no-break space is text
    expect(isClientMessage(chat({ text: "hi\n" }))).toBe(false); // a final newline too
  });

  it("refuses the invisible characters names refuse, so nobody can hide or flip text", () => {
    const hidden = [
      ["​", "‏", "⁠", "﻿"], // zero-width
      ["‪", "‮", "⁦", "⁩"], // direction
      [" ", " "], // line and paragraph separators
      ["\u{e0000}", "\u{e0041}", "\u{e007f}"], // tags
    ].flat();
    for (const c of hidden)
      expect(isClientMessage(chat({ text: `a${c}b` })), JSON.stringify(c)).toBe(false);
    // Neighbours of each range stay allowed.
    expect(isClientMessage(chat({ text: "a\u{e0080}b" }))).toBe(true);
    expect(isClientMessage(chat({ text: "a‧b c⁰" }))).toBe(true);
    expect(isServerMessage(server("CHAT.MESSAGE", relayed({ text: "a‮b" })))).toBe(false);
  });

  it("refuses wrong types, missing and extra fields", () => {
    expect(isClientMessage(chat({ text: 5 }))).toBe(false);
    expect(isClientMessage(chat({ movieTime: "42:10" }))).toBe(false);
    expect(isClientMessage(chat({ movieTime: -1 }))).toBe(false);
    expect(isClientMessage(chat({ titleId: 7 }))).toBe(false);
    expect(isClientMessage(chat({ extra: true }))).toBe(false);
    const { titleId: _, ...missing } = chat({}).payload;
    expect(isClientMessage({ ...chat({}), payload: missing })).toBe(false);
  });

  it("accepts the server's chat messages and refuses malformed ones", () => {
    expect(isServerMessage(server("CHAT.MESSAGE", relayed()))).toBe(true);
    expect(isServerMessage(server("CHAT.MESSAGE", relayed({ movieTime: null })))).toBe(true);
    expect(isServerMessage(server("CHAT.MESSAGE", relayed({ text: "" })))).toBe(false);
    expect(isServerMessage(server("CHAT.MESSAGE", relayed({ name: "x".repeat(31) })))).toBe(false);
    const { serverTime: _, ...noTime } = relayed();
    expect(isServerMessage(server("CHAT.MESSAGE", noTime))).toBe(false);
    expect(isServerMessage(server("CHAT.HISTORY", { messages: [] }))).toBe(true);
    const full = Array.from({ length: 200 }, () => relayed());
    expect(isServerMessage(server("CHAT.HISTORY", { messages: full }))).toBe(true);
    const over = [...full, relayed()];
    expect(isServerMessage(server("CHAT.HISTORY", { messages: over }))).toBe(false);
    for (const reason of ["too_long", "rate_limited", "invalid"])
      expect(isServerMessage(server("CHAT.REJECTED", { reason, text: "hi" }))).toBe(true);
    expect(isServerMessage(server("CHAT.REJECTED", { reason: "nope", text: "hi" }))).toBe(false);
    // A chat message is never a client message, and a client's send never a server one.
    expect(isClientMessage(server("CHAT.MESSAGE", relayed()))).toBe(false);
    expect(isServerMessage(chat({}))).toBe(false);
  });

  it("refuses server types it doesn't know, as the shipped extension does with chat", () => {
    const show = { fromId: "p1", name: "Maya", emoji: "🔥", count: 1 };
    expect(isServerMessage(server("REACTION.SHOW", show))).toBe(false);
  });
});
