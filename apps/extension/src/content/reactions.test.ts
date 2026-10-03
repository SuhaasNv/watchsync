// The float layer (US-045, US-046): five nodes reused, reduced motion stays still, a hidden
// tab shows nothing, and incoming reactions are said once, merged.
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

test("shows the sender's name and the count, and floats up", () => {
  r.showReaction({ fromId: "a", name: "Asha", emoji: "😂", count: 3, mine: false });
  expect(visible()[0]?.textContent).toBe("😂×3Asha");
  expect(JSON.stringify(started[0]?.frames)).toContain("-240px");
});

test("reduced motion: a still fade in place", () => {
  reduced = true;
  from(1);
  expect(JSON.stringify(started[0]?.frames)).not.toContain("translate");
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
