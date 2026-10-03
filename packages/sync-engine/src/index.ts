// Pure sync maths shared by every client. No DOM, no timers.

export interface SyncConfig {
  /** Drift below this many seconds is ignored; streaming players seek in coarse steps. */
  toleranceSec: number;
  /** Drift above this asks the user (Sync button) instead of jumping silently. */
  promptAboveSec: number;
}

// ponytail: fixed thresholds tuned by hand; v0.6 (UC-027) replaces with rate-based correction.
export const DEFAULT_SYNC: SyncConfig = { toleranceSec: 1.0, promptAboveSec: 6 };

export interface RoomPlayback {
  status: "playing" | "paused";
  position: number;
  rate: number;
  /** Server time in ms when position was recorded. */
  updatedAt: number;
}

/** Where the room should be now, in seconds. serverNow is in server ms. */
export function expectedPosition(p: RoomPlayback, serverNow: number): number {
  if (p.status === "paused") return p.position;
  return p.position + (Math.max(0, serverNow - p.updatedAt) / 1000) * p.rate;
}

export type SyncAction = "none" | "seek" | "prompt";

/** Positive drift: local is ahead of the room. */
export function decide(
  local: number,
  expected: number,
  cfg: SyncConfig = DEFAULT_SYNC,
): SyncAction {
  const drift = Math.abs(local - expected);
  if (drift < cfg.toleranceSec) return "none";
  return drift <= cfg.promptAboveSec ? "seek" : "prompt";
}

export interface ClockSample {
  /** serverTime - clientTime, ms. */
  offset: number;
  rtt: number;
}

/** One ping/pong: t1 sent, serverTime from the pong, t4 received (client ms). */
export function clockSample(t1: number, serverTime: number, t4: number): ClockSample {
  return { offset: serverTime - (t1 + t4) / 2, rtt: t4 - t1 };
}

/** The sample with the smallest round trip is the most trustworthy. */
export function bestSample(samples: ClockSample[]): ClockSample | null {
  return samples.reduce<ClockSample | null>((b, s) => (b === null || s.rtt < b.rtt ? s : b), null);
}

/** A sample plus when it was taken (monotonic ms), so an old one can be dropped. */
export interface TimedSample extends ClockSample {
  at: number;
}

/** Samples the estimate looks at: the most recent ones. */
export const CLOCK_WINDOW = 12;
/** How many of the lowest-round-trip samples vote on the offset. */
export const CLOCK_VOTERS = 3;
/** A sample whose round trip is above this multiple of the best one is ignored. */
export const CLOCK_RTT_FACTOR = 3;
/** A new estimate closer than this to the current one is not applied (ms). */
export const CLOCK_SMOOTH_MS = 15;
/** An estimate older than this is not trusted after a reconnect (ms). */
export const CLOCK_MAX_AGE_MS = 120_000;

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 === 1 ? (v[mid] ?? 0) : ((v[mid - 1] ?? 0) + (v[mid] ?? 0)) / 2;
}

/**
 * The offset to use: the median of the CLOCK_VOTERS lowest-round-trip samples among the last
 * CLOCK_WINDOW, ignoring any whose round trip is above CLOCK_RTT_FACTOR times the best.
 * `rtt` is the best round trip; half of it bounds the error of the offset.
 */
export function estimateOffset(samples: ClockSample[]): ClockSample | null {
  const recent = samples
    .slice(-CLOCK_WINDOW)
    .filter((s) => Number.isFinite(s.offset) && Number.isFinite(s.rtt) && s.rtt >= 0);
  const best = bestSample(recent);
  if (best === null) return null;
  const voters = recent
    .filter((s) => s.rtt <= best.rtt * CLOCK_RTT_FACTOR)
    .sort((a, b) => a.rtt - b.rtt)
    .slice(0, CLOCK_VOTERS);
  return { offset: median(voters.map((s) => s.offset)), rtt: best.rtt };
}

/** Keeps the current offset unless the new one differs by CLOCK_SMOOTH_MS or more. */
export function smoothOffset(current: number | null, next: number): number {
  return current !== null && Math.abs(next - current) < CLOCK_SMOOTH_MS ? current : next;
}

/**
 * Turns an offset measured against a monotonic clock (server time minus monotonic time) into
 * the wall-clock offset callers add to Date.now(). wallNow and monoNow are read together, so
 * a system clock change moves the result by exactly the change and the samples stay valid.
 */
export function toWallOffset(monoOffset: number, wallNow: number, monoNow: number): number {
  return monoOffset - (wallNow - monoNow);
}

/** Samples taken within maxAgeMs of now. */
export function freshSamples(samples: TimedSample[], now: number, maxAgeMs: number): TimedSample[] {
  return samples.filter((s) => now - s.at <= maxAgeMs);
}

/** Pings in the burst sent on every (re)connect, and the gap between them (ms). */
export const PING_BURST = 6;
export const PING_BURST_GAP_MS = 150;
/** Gap between pings after the burst; they also keep the MV3 worker alive (ms). */
export const PING_STEADY_MS = 20_000;

/** Wait before the next ping, once `sent` pings have gone out on this connection. */
export function nextPingDelay(sent: number): number {
  return sent < PING_BURST ? PING_BURST_GAP_MS : PING_STEADY_MS;
}
export * from "./drift";
