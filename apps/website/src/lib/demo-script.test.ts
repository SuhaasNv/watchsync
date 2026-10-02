import { describe, expect, it } from "vitest";
import { clock, START, STEPS, stateAt } from "./demo-script";

describe("stateAt", () => {
  it("plays from the start", () => {
    const s = stateAt(2);
    expect(s.playing).toBe(true);
    expect(s.position).toBeCloseTo(START + 2);
  });

  it("shows who paused on everyone else's screen", () => {
    const s = stateAt(4);
    expect(s.playing).toBe(false);
    expect(s.position).toBeCloseTo(START + 3.4);
    expect(s.screens.suhaas.notice?.text).toBe("Asha paused");
    expect(s.screens.ravi.notice?.text).toBe("Asha paused");
    expect(s.screens.asha.notice).toBeNull();
  });

  it("lands everyone on the skip target", () => {
    const s = stateAt(11);
    expect(s.position).toBeCloseTo(2530.4);
    expect(s.screens.asha.notice?.text).toBe("Ravi skipped ahead to 42:10");
  });

  it("waits for the person on an ad and counts down", () => {
    const s = stateAt(16.6);
    expect(s.playing).toBe(false);
    expect(s.screens.asha.ad).toBe(6);
    expect(s.screens.suhaas.notice).toEqual({
      text: "Asha is on an ad · about 0:06 left",
      kind: "wait",
    });
    expect(s.synced.asha).toBe(false);
  });

  it("resumes everyone together from the same position", () => {
    const during = stateAt(20).position;
    const after = stateAt(23);
    expect(after.playing).toBe(true);
    expect(after.position).toBeCloseTo(during + 0.5);
    expect(after.screens.ravi.notice?.text).toBe("Back together");
    expect(after.synced.asha).toBe(true);
  });

  it("waits for a loading player", () => {
    const s = stateAt(27);
    expect(s.screens.ravi.loading).toBe(true);
    expect(s.screens.asha.notice?.text).toBe("Waiting for Ravi to load");
  });

  it("reports the step for every still", () => {
    STEPS.forEach((step, i) => {
      expect(stateAt(step.still).step).toBe(i);
    });
  });
});

describe("clock", () => {
  it("formats like a player", () => {
    expect(clock(2530)).toBe("42:10");
    expect(clock(6720)).toBe("1:52:00");
    expect(clock(5)).toBe("0:05");
  });
});
