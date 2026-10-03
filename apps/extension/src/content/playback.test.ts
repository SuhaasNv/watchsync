// What this tab tells the room about the person's own plays, pauses and skips.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  COALESCE_MAX_MS,
  COALESCE_MS,
  coalesce,
  type Move,
  settle,
  watchSeeking,
} from "./playback";
import type { StreamingProvider } from "./providers";

const move = (action: Move["action"], playing: boolean, position: number): Move => ({
  action,
  playing,
  position,
  rate: 1,
});

describe("settle", () => {
  test("a Prime skip (pause and seek at the new spot, then play) is one play there", () => {
    expect(
      settle([move("pause", false, 70), move("seek", false, 70), move("play", true, 70)]),
    ).toEqual(move("play", true, 70));
  });

  test("a Netflix skip (pause at the old spot, seek, play) is one play at the new spot", () => {
    expect(
      settle([move("pause", false, 60), move("seek", false, 70), move("play", true, 70)]),
    ).toEqual(move("play", true, 70));
  });

  test("a seek while playing stays a seek, and a lone play or pause is itself", () => {
    expect(settle([move("seek", true, 90)])).toEqual(move("seek", true, 90));
    expect(settle([move("play", true, 5)])).toEqual(move("play", true, 5));
    expect(settle([move("pause", false, 5)])).toEqual(move("pause", false, 5));
  });

  test("a paused skip is a pause when the player paused, a seek when it only moved", () => {
    expect(settle([move("pause", false, 70), move("seek", false, 70)])).toEqual(
      move("pause", false, 70),
    );
    expect(settle([move("seek", false, 70)])).toEqual(move("seek", false, 70));
  });

  test("the player's last state wins: pause then play is playing, play then pause is paused", () => {
    expect(settle([move("pause", false, 5), move("play", true, 5)])?.action).toBe("play");
    expect(settle([move("play", true, 5), move("pause", false, 5)])?.action).toBe("pause");
  });

  test("nothing in, nothing out", () => {
    expect(settle([])).toBeNull();
  });
});

describe("coalesce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("one skip's three events send one message, after the quiet window", () => {
    const send = vi.fn();
    const c = coalesce(send);
    c.push(move("pause", false, 70));
    vi.advanceTimersByTime(2);
    c.push(move("seek", false, 70));
    vi.advanceTimersByTime(65);
    c.push(move("seek", false, 70));
    vi.advanceTimersByTime(4);
    c.push(move("play", true, 70));
    vi.advanceTimersByTime(COALESCE_MS - 1);
    expect(send).not.toHaveBeenCalled();
    expect(c.pending()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(move("play", true, 70));
    expect(c.pending()).toBe(false);
  });

  test("a lone pause goes out after the window, well inside half a second", () => {
    const send = vi.fn();
    coalesce(send).push(move("pause", false, 12));
    vi.advanceTimersByTime(COALESCE_MS);
    expect(send).toHaveBeenCalledWith(move("pause", false, 12));
    expect(COALESCE_MS).toBeLessThan(500);
  });

  test("scrubbing sends at most one message per cap, with the latest position", () => {
    const send = vi.fn();
    const c = coalesce(send);
    // A seek every 50 ms for 2 s never goes quiet for 120 ms.
    for (let t = 0; t < 2000; t += 50) {
      c.push(move("seek", true, t / 10));
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(COALESCE_MS);
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(send.mock.calls.length).toBeLessThanOrEqual(6);
    expect(send.mock.calls.at(-1)?.[0]).toEqual(move("seek", true, 195));
    expect(COALESCE_MAX_MS).toBe(400);
  });

  test("cancel drops what is waiting and the next move starts afresh", () => {
    const send = vi.fn();
    const c = coalesce(send);
    c.push(move("pause", false, 5));
    c.cancel();
    expect(c.pending()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
    c.push(move("play", true, 6));
    vi.advanceTimersByTime(COALESCE_MS);
    expect(send).toHaveBeenCalledWith(move("play", true, 6));
  });
});

describe("watchSeeking", () => {
  /** A provider whose video reports `currentTime` already at the target, like a real seek. */
  function setup() {
    const video = document.createElement("video");
    const other = document.createElement("video");
    document.body.append(video, other);
    Object.defineProperty(video, "currentTime", { value: 0, writable: true });
    const provider: StreamingProvider = {
      service: "netflix",
      media: () => null,
      video: () => video,
      getState: () => null,
      play: async () => {},
      pause: async () => {},
      seek: async () => {},
      stalled: () => false,
      ad: () => null,
    };
    return { video, other, provider };
  }

  test("reports the target of each seek of the provider's video, and only that video", () => {
    const { video, other, provider } = setup();
    const seen: number[] = [];
    const stop = watchSeeking(provider, (p) => seen.push(p));
    video.currentTime = 70;
    video.dispatchEvent(new Event("seeking"));
    other.dispatchEvent(new Event("seeking"));
    video.currentTime = 130;
    video.dispatchEvent(new Event("seeking"));
    expect(seen).toEqual([70, 130]);
    stop();
  });

  test("stops listening when stopped", () => {
    const { video, provider } = setup();
    const onSeek = vi.fn();
    watchSeeking(provider, onSeek)();
    video.dispatchEvent(new Event("seeking"));
    expect(onSeek).not.toHaveBeenCalled();
  });
});
