import { describe, expect, it } from "vitest";
import { type ClientMessageOf, envelope, isClientMessage, isServerMessage } from "./index";

describe("protocol validators", () => {
  it("accepts a valid playback update", () => {
    const m = envelope<ClientMessageOf<"PLAYBACK.UPDATE">>("PLAYBACK.UPDATE", {
      action: "seek",
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
