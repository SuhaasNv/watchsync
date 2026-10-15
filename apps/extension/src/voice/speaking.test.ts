import { describe, expect, it } from "vitest";
import { freshLevel, SpeakingDetector } from "./speaking";

describe("SpeakingDetector", () => {
  it("needs 0.02 for 150 ms to start, and stops below 0.008", () => {
    const d = new SpeakingDetector();
    expect(d.feed(0.03, 0)).toBe(false);
    expect(d.feed(0.03, 100)).toBe(false);
    expect(d.feed(0.03, 150)).toBe(true);
    expect(d.speaking).toBe(true);
    // Between the two thresholds a speaker keeps speaking.
    expect(d.feed(0.01, 200)).toBe(false);
    expect(d.speaking).toBe(true);
    expect(d.feed(0.007, 250)).toBe(true);
    expect(d.speaking).toBe(false);
  });

  it("a blip shorter than 150 ms is not speech, and a dip resets the wait", () => {
    const d = new SpeakingDetector();
    d.feed(0.05, 0);
    d.feed(0.01, 100); // under the start level: the wait begins again
    d.feed(0.05, 120);
    expect(d.feed(0.05, 250)).toBe(false);
    expect(d.feed(0.05, 270)).toBe(true);
  });

  it("no fresh source is silence", () => {
    const d = new SpeakingDetector();
    d.feed(0.05, 0);
    d.feed(0.05, 200);
    expect(d.speaking).toBe(true);
    expect(d.feed(null, 300)).toBe(true);
    expect(d.speaking).toBe(false);
  });
});

describe("freshLevel", () => {
  it("is the loudest source heard in the last 300 ms", () => {
    const sources = [
      { audioLevel: 0.1, timestamp: 900 },
      { audioLevel: 0.4, timestamp: 600 }, // 400 ms ago: stale
      { audioLevel: 0.03, timestamp: 990 },
    ];
    expect(freshLevel(sources, 1000)).toBe(0.1);
    expect(freshLevel([{ audioLevel: 0.5, timestamp: 600 }], 1000)).toBeNull();
    expect(freshLevel([{ timestamp: 990 }], 1000)).toBeNull(); // no level reported
    expect(freshLevel([], 1000)).toBeNull();
  });
});
