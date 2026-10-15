import { envelope, type ServerMessageOf } from "@watchsync/protocol";
import { describe, expect, it } from "vitest";
import { isVoiceIn, isVoiceOut, isVoiceView, NO_VOICE } from "./messages";

const OFFER = { kind: "description", type: "offer", sdp: "v=0" } as const;

describe("what the voice document may say", () => {
  it("accepts the messages it sends and nothing else", () => {
    expect(isVoiceOut({ kind: "hello", nonce: "n" })).toBe(false); // admitted by its address now
    expect(isVoiceOut({ kind: "view", view: NO_VOICE })).toBe(true);
    expect(isVoiceOut({ kind: "needPermission" })).toBe(true);
    expect(isVoiceOut({ kind: "duck" })).toBe(true);
    expect(isVoiceOut({ kind: "found", mode: "open" })).toBe(true);
    expect(isVoiceOut({ kind: "found", mode: "loud" })).toBe(false);
    expect(isVoiceOut({ kind: "probed", id: 1, value: { a: 1 } })).toBe(true);
    expect(isVoiceOut({ kind: "probed", value: 1 })).toBe(false);
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

describe("what the worker may tell the voice document", () => {
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
    for (const cmd of ["enable", "down", "up", "retry"])
      expect(isVoiceIn({ kind: "cmd", cmd })).toBe(true);
  });

  it("accepts the microphone page's answer, the settings and a test probe", () => {
    expect(isVoiceIn({ kind: "micAnswer", by: null })).toBe(true);
    for (const by of ["chrome", "system", "none"])
      expect(isVoiceIn({ kind: "micAnswer", by })).toBe(true);
    expect(isVoiceIn({ kind: "micAnswer", by: "mars" })).toBe(false);
    expect(isVoiceIn({ kind: "micAnswer" })).toBe(false);
    const settings = { kind: "settings", chosen: null, found: "ptt", relay: false, micId: null };
    expect(isVoiceIn(settings)).toBe(true);
    expect(isVoiceIn({ ...settings, micId: "abc123" })).toBe(true);
    expect(isVoiceIn({ ...settings, micId: "" })).toBe(false);
    expect(isVoiceIn({ ...settings, micId: 7 })).toBe(false);
    expect(isVoiceIn({ ...settings, micId: "x".repeat(513) })).toBe(false);
    expect(isVoiceIn({ kind: "testing", on: true })).toBe(true);
    expect(isVoiceIn({ kind: "testing", on: "yes" })).toBe(false);
    expect(isVoiceIn({ ...settings, chosen: "open" })).toBe(true);
    expect(isVoiceIn({ ...settings, chosen: "loud" })).toBe(false);
    expect(isVoiceIn({ ...settings, relay: "yes" })).toBe(false);
    expect(isVoiceIn({ kind: "probe", id: 1, what: "heard" })).toBe(true);
    expect(isVoiceIn({ kind: "probe", id: 1, what: "mic" })).toBe(true);
    expect(isVoiceIn({ kind: "probe", id: 1, what: "film" })).toBe(false);
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
