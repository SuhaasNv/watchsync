import { describe, expect, it } from "vitest";
import { bestSample, clockSample, decide, expectedPosition } from "./index";

describe("expectedPosition", () => {
  it("advances while playing, scaled by rate", () => {
    expect(
      expectedPosition({ status: "playing", position: 100, rate: 1, updatedAt: 0 }, 2000),
    ).toBe(102);
    expect(
      expectedPosition({ status: "playing", position: 100, rate: 1.5, updatedAt: 0 }, 2000),
    ).toBe(103);
  });
  it("holds while paused and never runs backwards", () => {
    expect(expectedPosition({ status: "paused", position: 100, rate: 1, updatedAt: 0 }, 9000)).toBe(
      100,
    );
    expect(
      expectedPosition({ status: "playing", position: 100, rate: 1, updatedAt: 5000 }, 4000),
    ).toBe(100);
  });
});

describe("decide (TRD §67 style, both directions)", () => {
  it.each([
    [100.3, 100, "none"],
    [99.7, 100, "none"],
    [102, 100, "seek"],
    [97, 100, "seek"],
    [108, 100, "prompt"],
    [92, 100, "prompt"],
  ])("local %s vs room %s -> %s", (local, room, want) => {
    expect(decide(local, room)).toBe(want);
  });
});

describe("clock", () => {
  it("estimates offset from one round trip and keeps the fastest sample", () => {
    const a = clockSample(1000, 6050, 1100); // rtt 100, server 5000 ms ahead
    expect(a).toEqual({ offset: 5000, rtt: 100 });
    const b = clockSample(2000, 7010, 2020);
    expect(bestSample([a, b])).toEqual(b);
    expect(bestSample([])).toBeNull();
  });
});
