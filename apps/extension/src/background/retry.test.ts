import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { backoff, Retry } from "./retry";

const LONG = 120_000;
let runs: number[] = [];
let changes = 0;
let start = 0;
const retry = (random = () => 0) =>
  new Retry(
    () => runs.push(Date.now() - start),
    () => changes++,
    LONG,
    random,
  );

beforeEach(() => {
  vi.useFakeTimers();
  start = Date.now();
  runs = [];
  changes = 0;
});
afterEach(() => vi.useRealTimers());

/** Every close is followed by a failed attempt (connection refused): close again at once. */
function failAll(r: Retry, code: number, until: number) {
  r.closed(code);
  while (Date.now() - start < until) {
    const before = runs.length;
    vi.advanceTimersToNextTimer();
    if (runs.length > before) r.closed(1006);
  }
}

test("backoff is 1, 2, 4, 8, then 10 s, with up to 30% jitter", () => {
  expect([0, 1, 2, 3, 4, 9].map((n) => backoff(n, () => 0))).toEqual([
    1000, 2000, 4000, 8000, 10_000, 10_000,
  ]);
  expect(backoff(0, () => 1)).toBe(1300);
});

test("a network drop retries on the backoff schedule", () => {
  failAll(retry(), 1006, 30_000);
  expect(runs.slice(0, 6)).toEqual([1000, 3000, 7000, 15_000, 25_000, 35_000]);
});

test("4001 (flooded) uses the normal backoff", () => {
  const r = retry();
  r.closed(4001);
  vi.advanceTimersByTime(999);
  expect(runs).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(runs).toEqual([1000]);
});

test("a restart retries every 1 to 3 s for a minute, then backs off as usual", () => {
  const r = retry(() => 0.5);
  expect(r.closed(4002)).toEqual({ updating: true, unreachable: false });
  failAll(r, 4002, 60_000);
  const gaps = runs.slice(1).map((t, i) => t - (runs[i] ?? 0));
  expect(gaps.every((g) => g === 2000)).toBe(true); // 1 + 0.5 x 2 s, all through the minute
  expect(r.status().updating).toBe(false);
  vi.advanceTimersToNextTimer();
  expect(r.closed(1006).updating).toBe(false);
  const before = runs.length;
  vi.advanceTimersByTime(1149); // backoff(0) x 1.15 = 1150 ms
  expect(runs.length).toBe(before);
});

test("after 2 minutes down it says so, and keeps trying every 10 s", () => {
  const r = retry();
  failAll(r, 1006, LONG - 15_000);
  expect(r.status().unreachable).toBe(false);
  expect(changes).toBe(0);
  vi.advanceTimersByTime(LONG - (Date.now() - start)); // an attempt hangs: no close arrives
  expect(changes).toBe(1); // the switch is heard anyway
  expect(r.status()).toEqual({ updating: false, unreachable: true });
  const at = runs.length;
  failAll(r, 1006, LONG + 40_000);
  const late = runs.slice(at + 1).map((t, i) => t - (runs[at + i] ?? 0));
  expect(late.length).toBeGreaterThan(2);
  expect(late.every((g) => g === 10_000)).toBe(true);
});

test("a restart that runs long ends up unreachable too", () => {
  const r = retry();
  failAll(r, 4002, LONG + 1000);
  expect(r.status()).toEqual({ updating: false, unreachable: true });
});

test("Try now connects at once; reset forgets the outage", () => {
  const r = retry();
  failAll(r, 1006, LONG + 1000);
  const before = runs.length;
  r.now();
  expect(runs.length).toBe(before + 1);
  r.reset();
  expect(r.status()).toEqual({ updating: false, unreachable: false });
  r.closed(1006);
  vi.advanceTimersByTime(1000);
  expect(runs.at(-1)).toBe(Date.now() - start); // back to 1 s
});
