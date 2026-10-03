// Pure drift maths for landing after a seek and for correcting small drift. No DOM, no timers.

/** Seek lead used before any seek has been measured, ms. */
export const DEFAULT_SEEK_LEAD_MS = 250;
/** The most a seek is allowed to lead the room's clock by, ms. */
export const MAX_SEEK_LEAD_MS = 1500;
/** How many recent seek latencies the lead is taken from. */
export const SEEK_SAMPLES = 5;

/** A lead in ms, kept inside 0..MAX_SEEK_LEAD_MS; anything that isn't a number is the default. */
export function clampSeekLead(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_SEEK_LEAD_MS;
  return Math.min(MAX_SEEK_LEAD_MS, Math.max(0, ms));
}

/** The middle of `xs` (the mean of the two middle ones when even); NaN for none. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? Number.NaN)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** The lead to use: the median of the last SEEK_SAMPLES latencies, so one slow seek can't skew it. */
export function seekLead(latencies: readonly number[]): number {
  const recent = latencies.filter(Number.isFinite).slice(-SEEK_SAMPLES);
  if (recent.length === 0) return DEFAULT_SEEK_LEAD_MS;
  return clampSeekLead(median(recent));
}

/** A player landing this far (or more) off the room after a seek gets corrected, seconds. */
export const SETTLE_MIN_SEC = 0.12;
/** Landing further off than this isn't a seek's lag (an ad break, a wrong spot): not chased, seconds. */
export const SETTLE_MAX_SEC = 3;
/** A correction that shrinks the drift by less than this did nothing: a coarse player, seconds. */
export const MIN_GAIN_SEC = 0.05;
/** Corrections after one room-driven seek, never more. */
export const SETTLE_MAX_CORRECTIONS = 2;

/** Drift the ongoing check ignores, seconds. */
export const DRIFT_TOLERANCE_SEC = 0.25;
/** Drift the ongoing check ignores while a player has shown it can't land closer, seconds. */
export const DRIFT_TOLERANCE_WIDE_SEC = 1.0;
/** How long the wide tolerance lasts after a correction that didn't help, ms. */
export const WIDE_FOR_MS = 30_000;

/**
 * The smallest drift worth a correction after a seek, for a player whose ongoing tolerance is
 * `toleranceSec`: 0.12 s, except on a player that only lands in coarse steps (tolerance above
 * the default), which is never re-seeked below its own tolerance.
 */
export function settleMinFor(toleranceSec: number): number {
  return toleranceSec > DRIFT_TOLERANCE_SEC ? toleranceSec : SETTLE_MIN_SEC;
}

export type SettleAction = "none" | "correct" | "leave" | "stop";

/**
 * What to do when a player that has landed from a room-driven seek is measured against the room.
 * `corrections` is how many it has had already; `previousDrift` the drift (absolute, seconds)
 * measured before the last one, or null. "leave" is drift beyond a seek's lag, left to the Sync
 * prompt; "stop" is a player that can't land closer (or has had its two corrections).
 */
export function settleDecision(
  local: number,
  expected: number,
  corrections: number,
  previousDrift: number | null,
  minSec: number = SETTLE_MIN_SEC,
): SettleAction {
  const drift = Math.abs(local - expected);
  if (drift < minSec) return "none";
  if (drift > SETTLE_MAX_SEC) return "leave";
  if (corrections >= SETTLE_MAX_CORRECTIONS) return "stop";
  if (previousDrift !== null && previousDrift - drift < MIN_GAIN_SEC) return "stop";
  return "correct";
}

/** Whether a correction made the drift (absolute, seconds) smaller by enough to count. */
export function improved(before: number, after: number): boolean {
  return before - after >= MIN_GAIN_SEC;
}

/** When the wide tolerance should run to after a correction, or null if it helped. */
export function wideAfter(before: number, after: number, now: number): number | null {
  return improved(before, after) ? null : now + WIDE_FOR_MS;
}

/**
 * The tolerance to use now: `narrow` (a player's own, default 0.25 s), or 1.0 s while
 * `wideUntil` (a ms time, 0 for never) hasn't passed.
 */
export function toleranceAt(
  wideUntil: number,
  now: number,
  narrow: number = DRIFT_TOLERANCE_SEC,
): number {
  return now < wideUntil ? Math.max(narrow, DRIFT_TOLERANCE_WIDE_SEC) : narrow;
}

/** Drift (absolute, seconds) at which a player that isn't nudging starts. */
export const NUDGE_MIN_SEC = 0.015;
/** A nudging player is back at the base rate once within this, seconds (hysteresis). */
export const NUDGE_DONE_SEC = 0.005;
/** Drift beyond this is seeked (5% speed would take 10 s+ to close it), then nudged, seconds. */
export const NUDGE_MAX_SEC = 0.5;
/** The most a nudge changes the base rate by (0.05 is 5%, too small to hear or see). */
export const NUDGE_MAX_DELTA = 0.05;
/** Rate change per second of drift. */
export const NUDGE_GAIN = 0.5;
/** The least a nudge changes the rate by, so it closes the gap in reasonable time. */
export const NUDGE_MIN_DELTA = 0.01;
/** How many recent drift measurements the nudge takes its median from. */
export const NUDGE_SAMPLES = 5;

/**
 * The playback rate that closes `drift` (local minus expected, seconds) around `baseRate`:
 * ahead plays slower, behind plays faster. Null when the drift is too big to nudge. Inside
 * NUDGE_DONE_SEC it is the base rate; a player that isn't nudging yet waits for NUDGE_MIN_SEC.
 */
export function nudgeRate(drift: number, baseRate: number, nudging: boolean): number | null {
  const gap = Math.abs(drift);
  if (gap > NUDGE_MAX_SEC) return null;
  if (gap < NUDGE_DONE_SEC || (!nudging && gap < NUDGE_MIN_SEC)) return baseRate;
  const delta = Math.min(NUDGE_MAX_DELTA, Math.max(NUDGE_MIN_DELTA, gap * NUDGE_GAIN)) * baseRate;
  // Whole 1% steps: every rate change can blip a streaming player's audio, so change it rarely.
  return Math.round((baseRate - Math.sign(drift) * delta) * 100) / 100;
}
