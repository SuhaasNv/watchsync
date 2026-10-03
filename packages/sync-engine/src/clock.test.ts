import { describe, expect, it } from "vitest";
import {
  CLOCK_MAX_AGE_MS,
  CLOCK_SMOOTH_MS,
  CLOCK_WINDOW,
  type ClockSample,
  clockSample,
  estimateOffset,
  freshSamples,
  nextPingDelay,
  PING_BURST,
  PING_BURST_GAP_MS,
  PING_STEADY_MS,
  smoothOffset,
  type TimedSample,
  toWallOffset,
} from "./index";

const s = (offset: number, rtt: number): ClockSample => ({ offset, rtt });

describe("estimateOffset", () => {
  it("is null with no samples", () => {
    expect(estimateOffset([])).toBeNull();
  });

  it("uses a single sample as it is", () => {
    expect(estimateOffset([s(5000, 40)])).toEqual({ offset: 5000, rtt: 40 });
  });

  it("takes the median offset of the three lowest round trips", () => {
    const got = estimateOffset([s(5010, 30), s(5000, 20), s(5004, 25), s(9000, 28)]);
    // lowest three by rtt: 20, 25, 28 -> offsets 5000, 5004, 9000 -> median 5004
    expect(got).toEqual({ offset: 5004, rtt: 20 });
  });

  it("averages the two middle values when only two samples qualify", () => {
    expect(estimateOffset([s(5000, 20), s(5010, 22)])).toEqual({ offset: 5005, rtt: 20 });
  });

  it("ignores samples whose round trip is above three times the best", () => {
    // 61 ms is above 3 x 20: its offset must not vote even though three slots are free.
    const got = estimateOffset([s(5000, 20), s(5002, 60), s(7000, 61)]);
    expect(got).toEqual({ offset: 5001, rtt: 20 });
  });

  it("keeps a sample at exactly three times the best", () => {
    expect(estimateOffset([s(5000, 20), s(5010, 60)])).toEqual({ offset: 5005, rtt: 20 });
  });

  it("looks only at the last twelve samples", () => {
    const old = Array.from({ length: 5 }, () => s(100, 1));
    const recent = Array.from({ length: CLOCK_WINDOW }, () => s(5000, 30));
    expect(estimateOffset([...old, ...recent])).toEqual({ offset: 5000, rtt: 30 });
  });

  it("skips samples that are not finite or have a negative round trip", () => {
    const got = estimateOffset([s(Number.NaN, 5), s(1, -3), s(5000, Number.POSITIVE_INFINITY)]);
    expect(got).toBeNull();
    expect(estimateOffset([s(1, -3), s(5000, 30)])).toEqual({ offset: 5000, rtt: 30 });
  });

  it("does not change the list it is given", () => {
    const list = [s(3, 30), s(1, 10), s(2, 20)];
    estimateOffset(list);
    expect(list).toEqual([s(3, 30), s(1, 10), s(2, 20)]);
  });
});

describe("smoothOffset", () => {
  it("takes the first estimate whatever it is", () => {
    expect(smoothOffset(null, 3)).toBe(3);
  });

  it("keeps the current offset for a change under the threshold", () => {
    expect(smoothOffset(5000, 5000 + CLOCK_SMOOTH_MS - 1)).toBe(5000);
    expect(smoothOffset(5000, 5000 - CLOCK_SMOOTH_MS + 1)).toBe(5000);
  });

  it("applies a change at or over the threshold at once", () => {
    expect(smoothOffset(5000, 5000 + CLOCK_SMOOTH_MS)).toBe(5015);
    expect(smoothOffset(5000, 4000)).toBe(4000);
  });
});

describe("monotonic samples", () => {
  it("measures offset against a monotonic clock and converts it to wall time", () => {
    // Client monotonic clock reads 1000 -> 1100, the wall clock reads 1_700_000_000_000 + that.
    // The server is 5000 ms ahead of the wall clock.
    const wallAtMono0 = 1_700_000_000_000;
    const server = wallAtMono0 + 1050 + 5000;
    const sample = clockSample(1000, server, 1100); // mono offset, no wall clock involved
    const wall = toWallOffset(sample.offset, wallAtMono0 + 1100, 1100);
    expect(wall).toBe(5000);
  });

  it("a system clock step moves the wall offset by the step and nothing else", () => {
    const sample = clockSample(1000, 1_700_000_006_050, 1100);
    const before = toWallOffset(sample.offset, 1_700_000_001_100, 1100);
    // Later the user sets the system clock 90 s back; monotonic time keeps running.
    const after = toWallOffset(sample.offset, 1_700_000_001_100 + 2000 - 90_000, 3100);
    expect(after - before).toBe(90_000);
  });
});

describe("freshSamples", () => {
  const at = (t: number): TimedSample => ({ offset: 0, rtt: 10, at: t });

  it("drops samples older than the limit and keeps the rest", () => {
    const list = [at(0), at(50_000), at(CLOCK_MAX_AGE_MS + 1)];
    const now = CLOCK_MAX_AGE_MS + 1;
    expect(freshSamples(list, now, CLOCK_MAX_AGE_MS)).toEqual([at(50_000), at(now)]);
  });

  it("keeps a sample exactly at the limit", () => {
    expect(freshSamples([at(0)], CLOCK_MAX_AGE_MS, CLOCK_MAX_AGE_MS)).toHaveLength(1);
  });

  it("is empty when everything is old", () => {
    expect(freshSamples([at(0), at(1)], 10 * CLOCK_MAX_AGE_MS, CLOCK_MAX_AGE_MS)).toEqual([]);
  });
});

describe("nextPingDelay", () => {
  it("pings 150 ms apart for a burst of six, then every 20 s", () => {
    const gaps = Array.from({ length: PING_BURST + 2 }, (_, sent) => nextPingDelay(sent + 1));
    expect(gaps).toEqual([
      PING_BURST_GAP_MS,
      PING_BURST_GAP_MS,
      PING_BURST_GAP_MS,
      PING_BURST_GAP_MS,
      PING_BURST_GAP_MS,
      PING_STEADY_MS,
      PING_STEADY_MS,
      PING_STEADY_MS,
    ]);
    expect(PING_BURST).toBe(6);
    expect(PING_BURST_GAP_MS).toBe(150);
    expect(PING_STEADY_MS).toBe(20_000);
  });

  it("the first ping goes out at once and is followed by the burst gap", () => {
    expect(nextPingDelay(1)).toBe(PING_BURST_GAP_MS);
  });
});
