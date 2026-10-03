// The float layer (US-045, US-046): a burst floats as separate emojis, five nodes reused,
// reduced motion stays still, a hidden tab shows nothing, and incoming reactions are said once,
// merged.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Layer = typeof import("./reactions");
let r: Layer;
let shadow: ShadowRoot | null = null;
let reduced = false;
/** Every animation started, with its keyframes and a way to finish it. */
let started: { frames: Keyframe[]; finish: () => void; cancelled: boolean }[] = [];

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  started = [];
  reduced = false;
  const attach = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (
    this: HTMLElement,
    init: ShadowRootInit,
  ) {
    shadow = attach.call(this, init);
    return shadow;
  });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduced && q.includes("reduce") }));
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(frames: Keyframe[]) {
      let done: () => void = () => {};
      let fail: (e: Error) => void = () => {};
      const finished = new Promise<void>((res, rej) => {
        done = res;
        fail = rej;
      });
      const entry = { frames, finish: () => done(), cancelled: false };
      started.push(entry);
      return {
        finished,
        cancel() {
          entry.cancelled = true;
          fail(new Error("AbortError"));
        },
      };
    },
  });
  r = await import("./reactions");
  r.showReactions(true);
});

afterEach(() => {
  r.retireReactions();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const visible = () =>
  [...(shadow?.querySelectorAll<HTMLElement>(".r") ?? [])].filter((n) => !n.hidden);
const said = () => shadow?.querySelector('[role="status"]')?.textContent ?? "";

function from(i: number, emoji: "😂" | "❤️" = "😂", mine = false) {
  r.showReaction({ fromId: `p${i}`, name: `Friend ${i}`, emoji, count: 1, mine });
}

test("at most five float at once, reusing five nodes; the oldest gives way", () => {
  for (let i = 0; i < 7; i++) from(i);
  expect(shadow?.querySelectorAll(".r")).toHaveLength(5);
  expect(visible()).toHaveLength(5);
  expect(started.filter((a) => a.cancelled)).toHaveLength(2);
  const names = visible().map((n) => n.querySelector(".n")?.textContent);
  expect(names).toEqual(expect.arrayContaining(["Friend 2", "Friend 6"]));
  expect(names).not.toContain("Friend 0");
});

test("a node is released when its float finishes", async () => {
  from(1);
  started[0]?.finish();
  await vi.runAllTimersAsync();
  expect(visible()).toHaveLength(0);
});

/** A small seeded random, so a run of variations is repeatable. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const burst = (count: number, fromId = "a", name = "Asha") =>
  r.showReaction({ fromId, name, emoji: "😂", count, mine: false });

test("variation stays inside its ranges, for a seeded random and at both extremes", () => {
  const draws = [seeded(7), () => 0, () => 0.999999];
  for (const random of draws) {
    for (let i = 0; i < 200; i++) {
      const v = r.variation(random);
      expect(v.size).toBeGreaterThanOrEqual(26);
      expect(v.size).toBeLessThanOrEqual(34);
      expect(v.left).toBeGreaterThanOrEqual(28);
      expect(v.left + v.size).toBeLessThanOrEqual(200 - 28);
      expect(v.rise).toBeGreaterThanOrEqual(200);
      expect(v.rise).toBeLessThanOrEqual(320);
      expect(v.duration).toBeGreaterThanOrEqual(2400);
      expect(v.duration).toBeLessThanOrEqual(4200);
      expect(v.delay).toBeGreaterThanOrEqual(70);
      expect(v.delay).toBeLessThanOrEqual(140);
      expect([3, 4]).toContain(v.sway.length);
      for (const x of v.sway) {
        expect(Math.abs(x)).toBeGreaterThanOrEqual(12);
        expect(Math.abs(x)).toBeLessThanOrEqual(28);
      }
    }
  }
  // The same seed gives the same look; different draws differ.
  expect(r.variation(seeded(3))).toEqual(r.variation(seeded(3)));
  expect(r.variation(seeded(3))).not.toEqual(r.variation(seeded(4)));
});

test("a burst floats as that many separate emojis, staggered, with no count badge", () => {
  burst(3);
  expect(visible()).toHaveLength(1); // the first is straight away
  vi.advanceTimersByTime(300); // two gaps of at most 140 ms
  expect(visible()).toHaveLength(3);
  expect(started).toHaveLength(3);
  expect(visible().map((n) => n.firstElementChild?.textContent)).toEqual(["😂", "😂", "😂"]);
  expect(visible().some((n) => n.textContent?.includes("×"))).toBe(false);
  // Each has its own look.
  const lefts = visible().map((n) => n.style.left);
  expect(new Set(lefts).size).toBeGreaterThan(1);
});

test("the burst's spawns are 70 to 140 ms apart, never all at once", () => {
  burst(5);
  vi.advanceTimersByTime(60);
  expect(visible()).toHaveLength(1); // the next one is at least 70 ms away
  vi.advanceTimersByTime(80);
  expect(visible()).toHaveLength(2); // and within 140 ms
  vi.advanceTimersByTime(600);
  expect(visible()).toHaveLength(5);
});

test("only the first emoji of a burst carries the sender's name", () => {
  burst(4);
  vi.advanceTimersByTime(600);
  const nodes = visible();
  expect(nodes).toHaveLength(4);
  expect(nodes[0]?.querySelector(".n")?.textContent).toBe("Asha");
  expect(shadow?.querySelectorAll(".n")).toHaveLength(1);
  for (const n of nodes.slice(1)) expect(n.querySelector(".n")).toBeNull();
});

test("never more than five on screen: a burst is capped, later bursts replace the oldest", () => {
  burst(9); // more than the protocol allows
  vi.advanceTimersByTime(1000);
  expect(visible()).toHaveLength(5);
  burst(5, "b", "Ben");
  vi.advanceTimersByTime(1000);
  expect(shadow?.querySelectorAll(".r")).toHaveLength(5);
  expect(visible()).toHaveLength(5);
  expect(started).toHaveLength(10);
  expect(started.filter((a) => a.cancelled)).toHaveLength(5);
});

test("a bad count floats one emoji", () => {
  burst(0);
  burst(Number.NaN, "b");
  vi.advanceTimersByTime(1000);
  expect(visible()).toHaveLength(2);
});

test("a floating emoji sways and rises on its own path", () => {
  burst(1);
  const frames = JSON.stringify(started[0]?.frames);
  expect(frames).toContain("scale(0.8)");
  expect(frames).toContain("scale(1.15)");
  expect(frames).not.toContain("will-change");
  const shifts = (started[0]?.frames ?? []).filter(
    (f) => typeof f.transform === "string" && !f.transform.startsWith("translate3d(0,"),
  );
  expect(shifts.length).toBeGreaterThanOrEqual(3);
});

test("reduced motion: each emoji of a burst fades in place, still five at most, name on the first", () => {
  reduced = true;
  burst(5);
  vi.advanceTimersByTime(1000);
  expect(visible()).toHaveLength(5);
  expect(started).toHaveLength(5);
  for (const a of started) {
    const text = JSON.stringify(a.frames);
    expect(text).toContain("opacity");
    expect(text).not.toContain("translate");
    expect(text).not.toContain("transform");
  }
  expect(shadow?.querySelectorAll(".n")).toHaveLength(1);
  expect(new Set(visible().map((n) => n.style.left)).size).toBeGreaterThan(1);
  burst(5, "b", "Ben");
  vi.advanceTimersByTime(1000);
  expect(visible()).toHaveLength(5);
});

test("leaving the room drops the spawns still waiting", () => {
  burst(5);
  r.showReactions(false);
  vi.advanceTimersByTime(1000);
  expect(started).toHaveLength(1);
  expect(visible()).toHaveLength(0);
});

test("a burst is announced as one line, not once per emoji", () => {
  burst(5);
  vi.advanceTimersByTime(1500);
  expect(said()).toBe("Asha: Laugh");
});

test("the per-sender gate drops lone taps close together but never a burst", () => {
  burst(1);
  burst(1); // a lone tap right behind another one
  expect(started).toHaveLength(1);
  burst(3); // a burst is already a batch
  vi.advanceTimersByTime(1000);
  expect(started).toHaveLength(4);
  burst(2); // a second burst straight after the first
  vi.advanceTimersByTime(1000);
  expect(started).toHaveLength(6);
  vi.advanceTimersByTime(400);
  burst(1);
  expect(started).toHaveLength(7);
});

test("a hidden tab shows nothing; one sender floats at most once per 300 ms", () => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  from(1);
  expect(started).toHaveLength(0);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  from(1);
  from(1);
  expect(started).toHaveLength(1);
});

test("incoming reactions are said once, merged; my own are not said", () => {
  from(0, "😂", true);
  from(1);
  from(2);
  from(3);
  expect(said()).toBe("");
  vi.advanceTimersByTime(1500);
  expect(said()).toBe("Friend 1 and 2 others: Laugh");
});

test("the layer moves clear of open chat and leaves with the room", () => {
  r.reactionsBesideChat(true);
  expect(shadow?.querySelector(".layer")?.classList.contains("beside")).toBe(true);
  expect(document.querySelector("watchsync-reactions")).not.toBeNull();
  r.showReactions(false);
  expect(document.querySelector("watchsync-reactions")).toBeNull();
});
