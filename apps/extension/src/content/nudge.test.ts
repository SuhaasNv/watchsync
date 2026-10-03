// Small drift closed by a nudge to the playback rate: it speeds up, stops, and never fights.
import type { Playback } from "@watchsync/protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { StreamingProvider } from "./providers";

type Nudge = typeof import("./nudge");

/** A playing video `behind` seconds behind a room at 100 s whose position follows its rate. */
function rig(behind: number) {
  const video = document.createElement("video");
  document.body.append(video);
  const room: Playback = {
    status: "playing",
    position: 100,
    rate: 1,
    updatedAt: Date.now(),
    titleId: "t",
  };
  let base = 100 - behind;
  let since = Date.now();
  let rate = 1;
  const position = () => base + ((Date.now() - since) / 1000) * rate;
  Object.defineProperties(video, {
    currentTime: { get: position, configurable: true },
    playbackRate: {
      get: () => rate,
      set: (r: number) => {
        base = position();
        since = Date.now();
        rate = r;
      },
      configurable: true,
    },
    duration: { value: 7200, configurable: true },
    readyState: { value: 4, configurable: true },
    paused: { value: false, configurable: true },
    seeking: { value: false, configurable: true },
  });
  const provider: StreamingProvider = {
    service: "mock",
    media: () => null,
    video: () => video,
    getState: () => ({ playing: true, position: position(), duration: 7200, rate }),
    play: async () => {},
    pause: async () => {},
    seek: async () => {},
    stalled: () => false,
    ad: () => null,
  };
  const view = { clock: () => ({ playback: room, offset: 0 }), busy: () => false };
  const drift = () => position() - (room.position + (Date.now() - room.updatedAt) / 1000);
  return { video, provider, view, drift };
}

describe("nudging small drift", () => {
  let mod: Nudge;
  let stop: () => void = () => {};
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    mod = await import("./nudge");
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  test("0.3 s behind plays faster, then returns to the room's rate within 20 ms", async () => {
    const { video, provider, view, drift } = rig(0.3);
    stop = mod.startNudging(provider, view);
    await vi.advanceTimersByTimeAsync(1000);
    expect(video.playbackRate).toBeGreaterThan(1);
    expect(mod.isNudging()).toBe(true);
    expect(mod.baseRate(video)).toBe(1);
    for (let i = 0; i < 120 && mod.isNudging(); i++) await vi.advanceTimersByTimeAsync(250);
    expect(mod.isNudging()).toBe(false);
    expect(video.playbackRate).toBe(1);
    expect(Math.abs(drift())).toBeLessThan(0.05);
  });

  test("a person's own speed set mid-nudge is never overridden", async () => {
    const { video, provider, view } = rig(0.3);
    stop = mod.startNudging(provider, view);
    await vi.advanceTimersByTimeAsync(1000);
    expect(video.playbackRate).toBeGreaterThan(1);
    video.playbackRate = 1.5;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(video.playbackRate).toBe(1.5);
    expect(mod.isNudging()).toBe(false);
  });

  test("a player that resets the rate twice is given up on", async () => {
    const { video, provider, view } = rig(0.3);
    stop = mod.startNudging(provider, view);
    for (let i = 0; i < 40 && mod.nudgeAvailable(); i++) {
      await vi.advanceTimersByTimeAsync(250);
      if (video.playbackRate !== 1) video.playbackRate = 1; // the player undoes it
    }
    await vi.advanceTimersByTimeAsync(250);
    expect(mod.nudgeAvailable()).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(video.playbackRate).toBe(1);
  });

  test("stopping puts the rate back", async () => {
    const { video, provider, view } = rig(0.3);
    stop = mod.startNudging(provider, view);
    await vi.advanceTimersByTimeAsync(1000);
    expect(video.playbackRate).not.toBe(1);
    stop();
    expect(video.playbackRate).toBe(1);
    expect(mod.nudgeAvailable()).toBe(false);
  });
});
