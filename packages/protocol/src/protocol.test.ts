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
