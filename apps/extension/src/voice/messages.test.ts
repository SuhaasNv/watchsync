import { envelope, type ServerMessageOf } from "@watchsync/protocol";
import { describe, expect, it } from "vitest";
import { isVoiceIn, isVoiceOut, isVoiceView, NO_VOICE } from "./messages";

const OFFER = { kind: "description", type: "offer", sdp: "v=0" } as const;

describe("what the voice frame may say", () => {
  it("accepts the messages it sends and nothing else", () => {
    expect(isVoiceOut({ kind: "hello", nonce: "n" })).toBe(true);
    expect(isVoiceOut({ kind: "view", view: NO_VOICE })).toBe(true);
    expect(isVoiceOut({ kind: "state", state: "live" })).toBe(true);
    expect(isVoiceOut({ kind: "state", state: "off" })).toBe(false); // leaving is the worker's
    expect(isVoiceOut({ kind: "signal", to: "b", signal: OFFER })).toBe(true);
    expect(isVoiceOut({ kind: "signal", to: "b", signal: { kind: "restart" } })).toBe(true);
    expect(isVoiceOut({ kind: "needIce" })).toBe(true);
    // A set-up message the room would refuse is refused here, before it leaves the worker.
    expect(isVoiceOut({ kind: "signal", to: "b", signal: { kind: "description", sdp: "x" } })).toBe(
      false,
    );
    const huge = { ...OFFER, sdp: "x".repeat(16_385) };
    expect(isVoiceOut({ kind: "signal", to: "b", signal: huge })).toBe(false);
    expect(isVoiceOut({ kind: "signal", to: "x".repeat(65), signal: OFFER })).toBe(false);
    expect(isVoiceOut({ kind: "mystery" })).toBe(false);
    expect(isVoiceOut(null)).toBe(false);
    expect(isVoiceOut("hello")).toBe(false);
  });

  it("checks the view it is given", () => {
    expect(isVoiceView(NO_VOICE)).toBe(true);
    expect(isVoiceView({ ...NO_VOICE, mic: "open" })).toBe(false);
    expect(isVoiceView({ ...NO_VOICE, blocked: "mars" })).toBe(false);
    expect(isVoiceView({ ...NO_VOICE, peers: { a: "connected" }, speaking: ["a"] })).toBe(true);
    expect(isVoiceView({ ...NO_VOICE, peers: { a: "calling" } })).toBe(false);
    expect(isVoiceView({ ...NO_VOICE, speaking: [1] })).toBe(false);
  });
});

describe("what the worker may tell the voice frame", () => {
  const relay = envelope<ServerMessageOf<"VOICE.SIGNAL">>("VOICE.SIGNAL", {
    from: "a",
    signal: OFFER,
  });

  it("accepts the room, a voice signal, credentials and a command", () => {
    expect(isVoiceIn({ kind: "room", you: "me", people: [{ id: "a", name: "Asha" }] })).toBe(true);
    expect(isVoiceIn({ kind: "signal", message: relay })).toBe(true);
    expect(isVoiceIn({ kind: "ice", iceServers: [{ urls: ["stun:stun.example:3478"] }] })).toBe(
      true,
    );
    for (const cmd of ["enable", "down", "up", "retry", "resume"])
      expect(isVoiceIn({ kind: "cmd", cmd })).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isVoiceIn({ kind: "cmd", cmd: "record" })).toBe(false);
    expect(isVoiceIn({ kind: "room", you: "me", people: [{ id: "a" }] })).toBe(false);
    expect(isVoiceIn({ kind: "ice", iceServers: [{ urls: ["http://evil.example"] }] })).toBe(false);
    expect(isVoiceIn({ kind: "ice", iceServers: "stun:x" })).toBe(false);
    // Only a voice signal may arrive as a signal.
    const pong = { id: "1", type: "SYS.PONG", timestamp: 1, payload: { t1: 1, serverTime: 2 } };
    expect(isVoiceIn({ kind: "signal", message: pong })).toBe(false);
    expect(isVoiceIn(undefined)).toBe(false);
  });
});
