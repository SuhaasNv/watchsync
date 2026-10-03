// A room-driven seek on a playing room: aimed ahead by how long seeks take, then settled.
import type { Playback } from "@watchsync/protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RoomView } from "./playback";
import type { StreamingProvider } from "./providers";

type Playback_ = typeof import("./playback");

/** A player whose seeks land `latency` ms late, `offBy` seconds from where it was told to go. */
function rig(latency: number, offBy: number) {
  const video = document.createElement("video");
  document.body.append(video);
  let base = 0;
  let since = Date.now();
  Object.defineProperties(video, {
    currentTime: { get: () => base + (Date.now() - since) / 1000, configurable: true },
    duration: { value: 7200, configurable: true },
    readyState: { value: 4, configurable: true },
    paused: { value: false, configurable: true },
    seeking: { value: false, configurable: true },
    playbackRate: { value: 1, configurable: true },
  });
  const seeks: number[] = [];
  const provider: StreamingProvider = {
    service: "mock",
    media: () => null,
    video: () => video,
    getState: () => ({ playing: true, position: video.currentTime, duration: 7200, rate: 1 }),
    play: async () => {},
    pause: async () => {},
    seek: async (s) => {
      seeks.push(s);
      setTimeout(() => {
        base = s + offBy;
        since = Date.now();
        video.dispatchEvent(new Event("seeked"));
      }, latency);
    },
    stalled: () => false,
    ad: () => null,
  };
  return { video, provider, seeks };
}

const roomAt = (position: number, status: Playback["status"] = "playing"): Playback => ({
  status,
  position,
  rate: 1,
  updatedAt: Date.now(),
  titleId: "t",
});

function viewOf(playback: Playback) {
  const corrected = vi.fn<(drift: number) => void>();
  const stuck = vi.fn<() => void>();
  const view: RoomView = {
    clock: () => ({ playback, offset: 0 }),
    busy: () => false,
    corrected,
    stuck,
  };
  return Object.assign(view, { corrected, stuck });
}

describe("seek lead and settle", () => {
  let mod: Playback_;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    mod = await import("./playback");
  });
  afterEach(() => {
    mod.stopSettling();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  test("a seek on a playing room aims 250 ms ahead before any seek was measured", async () => {
    const { provider, seeks } = rig(100, 0);
    const room = roomAt(100);
    await mod.apply(provider, room, Date.now());
    expect(seeks).toHaveLength(1);
    expect(seeks[0]).toBeCloseTo(100.25, 3);
  });

  test("a paused room gets its exact position, with no lead", async () => {
    const { provider, seeks } = rig(100, 0);
    await mod.apply(provider, roomAt(100, "paused"), Date.now());
    expect(seeks).toEqual([100]);
  });

  test("the lead becomes the median of the seeks measured", async () => {
    const { provider, seeks } = rig(600, 0);
    const room = roomAt(100);
    await mod.apply(provider, room, Date.now());
    await vi.advanceTimersByTimeAsync(600);
    expect(mod.seekLeadMs()).toBe(600);
    // Back to somewhere else: the next seek aims 600 ms ahead.
    const again = rig(600, 0);
    await mod.apply(again.provider, room, Date.now());
    expect(again.seeks[0]).toBeCloseTo(100 + (Date.now() - room.updatedAt) / 1000 + 0.6, 3);
    expect(seeks).toHaveLength(1);
  });

  test("a landing that came up short is corrected once, then left alone", async () => {
    // Told 250 ms ahead, the seek took 600 ms: it lands about 0.35 s behind the room.
    const { provider, seeks } = rig(600, 0);
    const room = roomAt(100);
    const view = viewOf(room);
    await mod.apply(provider, room, Date.now(), false, view);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seeks).toHaveLength(2); // the seek and one correction, now aimed 600 ms ahead
    expect(view.corrected).toHaveBeenCalledTimes(1);
    expect(view.stuck).not.toHaveBeenCalled();
    expect(mod.isSettling()).toBe(false);
  });

  test("a player that lands in the same wrong place is corrected once and then given up on", async () => {
    // Every seek lands 0.6 s behind where it was told: a coarse player.
    const { provider, seeks } = rig(300, -0.6);
    const room = roomAt(100);
    const view = viewOf(room);
    await mod.apply(provider, room, Date.now(), false, view);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(seeks).toHaveLength(2);
    expect(view.corrected).toHaveBeenCalledTimes(1);
    expect(view.stuck).toHaveBeenCalledTimes(1);
  });

  test("nothing is settled once the room has moved or the person has acted", async () => {
    const { provider, seeks } = rig(600, 0);
    const room = roomAt(100);
    await mod.apply(provider, room, Date.now(), false, viewOf(room));
    await vi.advanceTimersByTimeAsync(700); // landed, short of the room
    mod.cancelSettle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seeks).toHaveLength(1);
  });

  test("a landing more than 3 s off is left to the Sync prompt", async () => {
    const { provider, seeks } = rig(300, -5);
    const room = roomAt(100);
    const view = viewOf(room);
    await mod.apply(provider, room, Date.now(), false, view);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seeks).toHaveLength(1);
    expect(view.corrected).not.toHaveBeenCalled();
  });

  test("no settle while the room is busy with a hold, an ad or a countdown", async () => {
    const { provider, seeks } = rig(600, 0);
    const room = roomAt(100);
    const view = { ...viewOf(room), busy: () => true };
    await mod.apply(provider, room, Date.now(), false, view);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seeks).toHaveLength(1);
  });
});
