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
