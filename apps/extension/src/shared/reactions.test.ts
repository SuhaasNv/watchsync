import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { announcement, Burst, RateWindow } from "./reactions";

describe("Burst (US-045)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("taps on one reaction within 250 ms go out once with a count", () => {
    const sent: [string, number][] = [];
    const b = new Burst((e, n) => sent.push([e, n]));
    b.tap("😂");
    vi.advanceTimersByTime(100);
    b.tap("😂");
    b.tap("😂");
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(150);
    expect(sent).toEqual([["😂", 3]]);
    b.tap("😂");
    vi.advanceTimersByTime(250);
    expect(sent).toEqual([
      ["😂", 3],
      ["😂", 1],
    ]);
  });

  test("a fifth tap sends at once, and another reaction sends the open burst first", () => {
    const sent: [string, number][] = [];
    const b = new Burst((e, n) => sent.push([e, n]));
    for (let i = 0; i < 5; i++) b.tap("🔥");
    expect(sent).toEqual([["🔥", 5]]);
    b.tap("❤️");
    b.tap("👏");
    expect(sent).toEqual([
      ["🔥", 5],
      ["❤️", 1],
    ]);
    vi.advanceTimersByTime(250);
    expect(sent.at(-1)).toEqual(["👏", 1]);
  });
});

test("RateWindow allows 8 in 5 s, then more once the oldest ages out (US-046)", () => {
  let t = 0;
  const w = new RateWindow(8, 5000, () => t);
  expect(Array.from({ length: 10 }, () => w.allow())).toEqual([
    ...Array<boolean>(8).fill(true),
    false,
    false,
  ]);
  t = 4999;
  expect(w.allow()).toBe(false);
  t = 5000;
  expect(w.allow()).toBe(true);
});

test("announcements merge by reaction, each name once", () => {
  expect(announcement([{ name: "Asha", emoji: "😂" }])).toBe("Asha: Laugh");
  expect(
    announcement([
      { name: "Asha", emoji: "😂" },
      { name: "Maya", emoji: "😂" },
      { name: "Asha", emoji: "😂" },
      { name: "Ravi", emoji: "😂" },
      { name: "Maya", emoji: "❤️" },
    ]),
  ).toBe("Asha and 2 others: Laugh. Maya: Love");
  expect(
    announcement([
      { name: "Asha", emoji: "😱" },
      { name: "Ravi", emoji: "😱" },
    ]),
  ).toBe("Asha and 1 other: Shocked");
});
