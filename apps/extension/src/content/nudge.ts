// Small drift is closed by playing a touch faster or slower, not by seeking: a seek on a
// streaming player re-buffers and lands 100-1500 ms late, a 1-5% rate change doesn't.
import type { Playback } from "@watchsync/protocol";
import { expectedPosition, median, NUDGE_SAMPLES, nudgeRate } from "@watchsync/sync-engine";
import type { StreamingProvider } from "./providers";

/** What the nudge reads from the room, fresh each tick. */
export interface NudgeView {
  /** The room's clock for the title this tab is on, or null when this tab isn't following it. */
  clock(): { playback: Playback; offset: number } | null;
  /** Something other than drift is going on: a hold, an ad, a countdown, a move on its way. */
  busy(): boolean;
}

/** How often the player is measured, ms. */
const TICK_MS = 250;
/** Fewest measurements the median is taken from. */
const MIN_SAMPLES = 3;
/** A jump in `currentTime` between ticks bigger than this is a seek, seconds. */
const SEEK_JUMP_SEC = 1;
/** A rate rounds to the same speed within this. */
const SAME_RATE = 0.001;
/** A rate that goes back to the room's this soon after we set it was the player's doing, ms. */
const RESET_WITHIN_MS = 600;
/** Resets after which this page is given up on: the player fights every change. */
const MAX_RESETS = 2;

/** The rate we last set and the room rate we set it around; null when no nudge is active. */
let ours: number | null = null;
let base = 1;
let target: HTMLVideoElement | null = null;
let setAt = 0;
let resets = 0;
let disabled = false;
/** Whether startNudging is running; when it isn't, drift is left to the seeks. */
let running = false;
/** The room move at which the person took over the speed: no nudging until it changes. */
let yieldedTo: number | null = null;
let samples: number[] = [];
let lastUpdatedAt: number | null = null;
let lastTime: number | null = null;
let latest: number | null = null;

/** True while the controller runs and the player hasn't undone our rate twice. */
export const nudgeAvailable = () => running && !disabled;

/** True while this player runs at a rate we set. */
export const isNudging = () => ours !== null;

/** The room's rate while our nudge is on this player, else whatever the player runs at. */
export function baseRate(v: HTMLVideoElement): number {
  return ours !== null && v === target && Math.abs(v.playbackRate - ours) <= SAME_RATE
    ? base
    : v.playbackRate;
}

/** The latest median drift (local minus room, ms), or null when not measuring. */
export const nudgeDriftMs = () => latest;

/** Back to the room's rate, if the nudge is on and the player still runs at our rate. */
export function endNudge() {
  if (ours !== null && target && Math.abs(target.playbackRate - ours) <= SAME_RATE)
    target.playbackRate = base;
  ours = null;
  target = null;
  samples = [];
  lastTime = null;
  latest = null;
}

function tick(provider: StreamingProvider, view: NudgeView) {
  const v = provider.video();
  const clock = view.clock();
  if (!v || !clock) return endNudge();
  const { playback } = clock;
  if (lastUpdatedAt !== playback.updatedAt) {
    // The room moved: whatever the last nudge was closing is stale, and so is the person's say.
    if (ours !== null) endNudge();
    samples = [];
    lastTime = null;
    lastUpdatedAt = playback.updatedAt;
    if (yieldedTo !== null && yieldedTo !== playback.updatedAt) yieldedTo = null;
  }
  if (ours !== null && Math.abs(v.playbackRate - ours) > SAME_RATE) {
    if (Math.abs(v.playbackRate - base) <= SAME_RATE && Date.now() - setAt <= RESET_WITHIN_MS) {
      resets += 1;
      if (resets >= MAX_RESETS) disabled = true;
    } else {
      yieldedTo = playback.updatedAt; // the person's own speed: never fought
    }
    ours = null;
    target = null;
    samples = [];
  }
  if (
    disabled ||
    yieldedTo === playback.updatedAt ||
    view.busy() ||
    document.hidden ||
    v.paused ||
    v.seeking ||
    v.readyState < 3 ||
    playback.status !== "playing" ||
    !Number.isFinite(v.duration) ||
    provider.ad()
  )
    return endNudge();
  // A player at a rate that isn't the room's and isn't ours is a speed tool.
  if (ours === null && Math.abs(v.playbackRate - playback.rate) > SAME_RATE) return endNudge();

  if (lastTime !== null && Math.abs(v.currentTime - lastTime) > SEEK_JUMP_SEC) samples = [];
  lastTime = v.currentTime;
  samples.push(v.currentTime - expectedPosition(playback, Date.now() + clock.offset));
  if (samples.length > NUDGE_SAMPLES) samples.shift();
  if (samples.length < MIN_SAMPLES) return;
  const drift = median(samples);
  latest = Math.round(drift * 1000);
  const rate = nudgeRate(drift, playback.rate, ours !== null);
  if (rate === null) {
    // Too far for a nudge: the seek path takes it from here.
    const keep = latest;
    endNudge();
    latest = keep;
    return;
  }
  if (Math.abs(rate - playback.rate) <= SAME_RATE) {
    // Within a few ms of the room: done, back to its rate (the measurements stay).
    if (ours !== null) v.playbackRate = base;
    ours = null;
    target = null;
    return;
  }
  if (ours !== null && Math.abs(v.playbackRate - rate) < SAME_RATE) return;
  base = playback.rate;
  target = v;
  ours = rate;
  setAt = Date.now();
  v.playbackRate = rate;
}

/**
 * Measures this player against the room every 250 ms and nudges its playback rate to close
 * small drift. Returns a function that stops it and puts the rate back.
 */
export function startNudging(provider: StreamingProvider, view: NudgeView): () => void {
  endNudge();
  running = true;
  const timer = setInterval(() => tick(provider, view), TICK_MS);
  return () => {
    clearInterval(timer);
    endNudge();
    running = false;
  };
}
