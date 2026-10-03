import { describe, expect, it } from "vitest";
import {
  clampSeekLead,
  DEFAULT_SEEK_LEAD_MS,
  DRIFT_TOLERANCE_SEC,
  DRIFT_TOLERANCE_WIDE_SEC,
  improved,
  MAX_SEEK_LEAD_MS,
  median,
  nudgeRate,
  SETTLE_MIN_SEC,
  seekLead,
  settleDecision,
  settleMinFor,
  toleranceAt,
  WIDE_FOR_MS,
  wideAfter,
} from "./drift";

describe("settleDecision", () => {
  it("does nothing below 0.12 s, either direction", () => {
    expect(settleDecision(100.1, 100, 0, null)).toBe("none");
    expect(settleDecision(99.9, 100, 0, null)).toBe("none");
  });
  it("corrects from 0.12 s up to 3 s", () => {
    expect(settleDecision(99.85, 100, 0, null)).toBe("correct");
    expect(settleDecision(98, 100, 0, null)).toBe("correct");
    expect(settleDecision(102.9, 100, 0, null)).toBe("correct");
  });
  it("leaves more than 3 s alone (an ad break, not a seek's lag)", () => {
    expect(settleDecision(96.9, 100, 0, null)).toBe("leave");
    expect(settleDecision(110, 100, 1, 8)).toBe("leave");
  });
  it("makes a second correction only if the first shrank the drift by 0.05 s", () => {
    expect(settleDecision(99.7, 100, 1, 0.9)).toBe("correct");
    expect(settleDecision(99.2, 100, 1, 0.9)).toBe("correct"); // gained 0.1
    expect(settleDecision(99.1, 100, 1, 0.94)).toBe("stop"); // gained 0.04
    expect(settleDecision(99, 100, 1, 0.9)).toBe("stop"); // grew
    expect(settleDecision(100.9, 100, 1, 0.9)).toBe("stop"); // same, other side
  });
  it("never makes a third correction", () => {
    expect(settleDecision(99.5, 100, 2, 2)).toBe("stop");
    expect(settleDecision(99.5, 100, 3, null)).toBe("stop");
  });
  it("is done once the drift is small, even after corrections", () => {
    expect(settleDecision(100.05, 100, 2, 0.4)).toBe("none");
  });
});

describe("seek lead", () => {
  it("is 250 ms before any measurement", () => {
    expect(seekLead([])).toBe(DEFAULT_SEEK_LEAD_MS);
    expect(DEFAULT_SEEK_LEAD_MS).toBe(250);
  });
  it("is the median of the last five, so one slow seek does not skew it", () => {
    expect(seekLead([400])).toBe(400);
    expect(seekLead([300, 500])).toBe(400);
    expect(seekLead([300, 320, 3000, 340, 310])).toBe(320);
    expect(seekLead([9000, 9000, 9000, 300, 320, 340, 310, 330])).toBe(320); // only the last 5
  });
  it("stays between 0 and 1500 ms", () => {
    expect(clampSeekLead(-5)).toBe(0);
    expect(clampSeekLead(800)).toBe(800);
    expect(clampSeekLead(4000)).toBe(MAX_SEEK_LEAD_MS);
    expect(clampSeekLead(Number.NaN)).toBe(DEFAULT_SEEK_LEAD_MS);
    expect(seekLead([3000, 3000, 3000])).toBe(1500);
  });
});

describe("ongoing tolerance", () => {
  it("is 0.25 s normally and 1.0 s while widened", () => {
    expect(toleranceAt(0, 1000)).toBe(DRIFT_TOLERANCE_SEC);
    expect(toleranceAt(31_000, 1000)).toBe(DRIFT_TOLERANCE_WIDE_SEC);
    expect(toleranceAt(31_000, 31_000)).toBe(DRIFT_TOLERANCE_SEC);
  });
  it("widens for 30 s after a correction that did not shrink the drift by 0.05 s", () => {
    expect(wideAfter(0.6, 0.58, 1000)).toBe(1000 + WIDE_FOR_MS);
    expect(wideAfter(0.6, 0.7, 1000)).toBe(31_000);
    expect(wideAfter(0.6, 0.1, 1000)).toBeNull();
    expect(improved(0.6, 0.5)).toBe(true);
    expect(improved(0.6, 0.56)).toBe(false);
  });
  it("narrows again when the 30 s are over", () => {
    const until = wideAfter(0.6, 0.6, 1000) ?? 0;
    expect(toleranceAt(until, 20_000)).toBe(DRIFT_TOLERANCE_WIDE_SEC);
    expect(toleranceAt(until, 31_001)).toBe(DRIFT_TOLERANCE_SEC);
  });
  it("takes a player's own tolerance, and never narrows below it while widened", () => {
    expect(toleranceAt(0, 1000, 0.15)).toBe(0.15);
    expect(toleranceAt(31_000, 1000, 0.15)).toBe(DRIFT_TOLERANCE_WIDE_SEC);
    expect(toleranceAt(31_000, 1000, 1.5)).toBe(1.5);
  });
  it("re-seeks after a landing at 0.12 s, or at the player's own tolerance if it is coarser", () => {
    expect(settleMinFor(0.15)).toBe(SETTLE_MIN_SEC);
    expect(settleMinFor(DRIFT_TOLERANCE_SEC)).toBe(SETTLE_MIN_SEC);
    expect(settleMinFor(0.5)).toBe(0.5);
    expect(settleDecision(99.7, 100, 0, null, settleMinFor(0.5))).toBe("none");
    expect(settleDecision(99.4, 100, 0, null, settleMinFor(0.5))).toBe("correct");
  });
});

describe("median", () => {
  it("is the middle value, or the mean of the two middle ones", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("is NaN for nothing", () => {
    expect(median([])).toBeNaN();
  });
});

describe("nudgeRate", () => {
  it("slows a player that is ahead and speeds one that is behind", () => {
    expect(nudgeRate(0.3, 1, false)).toBe(0.95);
    expect(nudgeRate(-0.3, 1, false)).toBe(1.05);
    expect(nudgeRate(-0.06, 1, false)).toBe(1.03);
  });
  it("never changes the rate by more than 5% or less than 1%", () => {
    expect(nudgeRate(1.5, 1, true)).toBe(0.95);
    expect(nudgeRate(-1.5, 1, true)).toBe(1.05);
    expect(nudgeRate(0.021, 1, true)).toBe(0.99);
  });
  it("scales the change by the room's rate", () => {
    expect(nudgeRate(-1, 2, false)).toBe(2.1);
  });
  it("waits for 40 ms to start and keeps going until within 20 ms", () => {
    expect(nudgeRate(0.03, 1, false)).toBe(1);
    expect(nudgeRate(0.03, 1, true)).toBe(0.99);
    expect(nudgeRate(0.01, 1, true)).toBe(1);
  });
  it("leaves more than 2 s to the seek", () => {
    expect(nudgeRate(2.01, 1, false)).toBeNull();
    expect(nudgeRate(-5, 1, true)).toBeNull();
  });
});
