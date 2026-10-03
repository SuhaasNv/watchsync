// Play, pause and jumps between this tab's player and the room.
import type { Playback } from "@watchsync/protocol";
import {
  DRIFT_TOLERANCE_SEC,
  decide,
  expectedPosition,
  SEEK_SAMPLES,
  SETTLE_MAX_CORRECTIONS,
  seekLead,
  settleDecision,
  settleMinFor,
} from "@watchsync/sync-engine";
import { baseRate, endNudge, nudgeAvailable } from "./nudge";
import type { StreamingProvider } from "./providers";

export type Action = "play" | "pause" | "seek" | "sync";

const ECHO_MS = 1500;
let quietUntil = 0;

/** Player events within this window come from our own commands, not the user. */
export const isEcho = (now = Date.now()) => now < quietUntil;

/** Treat player events in the next `ms` as not the person's own (never shortens a hold). */
export function hold(ms: number) {
  quietUntil = Math.max(quietUntil, Date.now() + ms);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Calls `onUser` for plays and pauses the person makes in the service's player.
 * Media events don't bubble, so listen in the capture phase on the document.
 * Returns a function that stops listening.
 */
export function listen(
  provider: StreamingProvider,
  onUser: (action: Action, playing: boolean, position: number, rate: number) => void,
): () => void {
  const handler = (e: Event) => {
    const v = provider.video();
    if (e.target !== v || !v || isEcho()) return;
    if (!Number.isFinite(v.duration)) return; // live: not synced (UC-010)
    // Scrubbing, arrow keys, 10-second skips and Skip intro all end in "seeked".
    const action: Action = e.type === "seeked" ? "seek" : e.type === "play" ? "play" : "pause";
    onUser(action, !v.paused, clamp(v.currentTime, 0, 86_400), clamp(baseRate(v), 0.25, 4));
  };
  document.addEventListener("play", handler, true);
  document.addEventListener("pause", handler, true);
  document.addEventListener("seeked", handler, true);
  return () => {
    document.removeEventListener("play", handler, true);
    document.removeEventListener("pause", handler, true);
    document.removeEventListener("seeked", handler, true);
  };
}

/**
 * Calls `onSeek` with the new position the moment the provider's video starts a seek
 * (`currentTime` is already the target then). Returns a function that stops listening.
 */
export function watchSeeking(
  provider: StreamingProvider,
  onSeek: (position: number) => void,
): () => void {
  const handler = (e: Event) => {
    const v = provider.video();
    if (!v || e.target !== v || !Number.isFinite(v.currentTime)) return;
    onSeek(v.currentTime);
  };
  document.addEventListener("seeking", handler, true);
  return () => document.removeEventListener("seeking", handler, true);
}

/** One thing the person did in the player, as `listen` reports it. */
export interface Move {
  action: Action;
  playing: boolean;
  position: number;
  rate: number;
}

/** A skip fires pause, seeking, seeked and play within about 80 ms; wait for the last. */
export const COALESCE_MS = 120;
/** The most a held move waits, so scrubbing still reaches the room about 2.5 times a second. */
export const COALESCE_MAX_MS = 400;

/**
 * The one message that says what a run of moves ended up as: the last move's state, with
 * "play" if the player is playing and a play was among them, "pause" if it is paused and a
 * pause was, and "seek" when only seeks moved it.
 */
export function settle(moves: readonly Move[]): Move | null {
  const last = moves[moves.length - 1];
  if (!last) return null;
  const played = moves.some((m) => m.action === "play");
  const paused = moves.some((m) => m.action === "pause");
  const action: Action = last.playing ? (played ? "play" : "seek") : paused ? "pause" : "seek";
  return { ...last, action };
}

/**
 * Holds the person's moves for a short trailing window and sends only what they settled on:
 * one skip is one message, and holding an arrow key or scrubbing stays under the room's
 * rate limit. Each new move restarts `wait`; the first move of a run is never held past `cap`.
 */
export function coalesce(
  send: (move: Move) => void,
  wait = COALESCE_MS,
  cap = COALESCE_MAX_MS,
): { push: (move: Move) => void; cancel: () => void; pending: () => boolean } {
  let moves: Move[] = [];
  let first = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    const move = settle(moves);
    moves = [];
    if (move) send(move);
  };
  return {
    push(move) {
      const now = Date.now();
      if (moves.length === 0) first = now;
      moves.push(move);
      clearTimeout(timer);
      timer = setTimeout(flush, Math.max(0, Math.min(wait, first + cap - now)));
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      moves = [];
    },
    pending: () => moves.length > 0,
  };
}

/** 2530 → "42:10", 3723 → "1:02:03" (shared with the chat feed, US-113). */
export { clock } from "../shared/activity";

/** A correction the person didn't ask for: seek without it being taken as theirs. */
export async function seekQuietly(provider: StreamingProvider, seconds: number) {
  hold(ECHO_MS);
  endNudge(); // seek from the room's real rate, not a nudged one
  await provider.seek(seconds);
}

// ---- Landing on the room's clock after a seek ----
//
// A seek on a streaming player takes real time (it buffers the new spot) and `seek()` returns
// when the player has been told, not when it has landed. The room's clock runs meanwhile, so a
// player that seeks to "now" lands behind. Each room-driven seek on a playing room therefore
// aims ahead by how long the last few seeks took, and once it has landed and is playing, the
// player is measured against the room and corrected at most twice.

/** A seek that hasn't said "seeked" by now is given up on, ms. A jump to a spot that isn't
 * loaded can take several seconds, and it still needs its settle afterwards. */
const SEEK_CEILING_MS = 8000;
/** While a seek is out, player events count as our own this far ahead, ms. */
const SEEK_HOLD_MS = 700;
/** And this long after its "seeked", for the play and playing events that follow, ms. */
const LANDED_HOLD_MS = 300;
/** Looking at the player while it lands and starts playing, ms. */
const SETTLE_POLL_MS = 100;
/** About 4 s for a seek to land and the player to play. */
const SETTLE_WAIT_TRIES = 40;
/** The player has to be seen moving this far (seconds) before it is measured. */
const SETTLE_ADVANCE_SEC = 0.05;
/** Then it is measured this long after, ms. */
const SETTLE_AFTER_MS = 300;
/** After a correction, the next measurement waits this long past the landing, ms. */
const SETTLE_RECHECK_MS = 1200;
/** A settle that hasn't finished by now is dropped, ms. */
const SETTLE_DEADLINE_MS = 20_000;
/** Netflix's bridge can fail once while its player object is busy: one more try after this, ms. */
const SETTLE_RETRY_MS = 500;

/** How long the last few seeks took, ms; the lead of the next one is their median. */
const latencies: number[] = [];

/** How far ahead of the room's clock a seek on a playing room aims now, ms. */
export const seekLeadMs = () => seekLead(latencies);

function recordLatency(ms: number) {
  latencies.push(ms);
  if (latencies.length > SEEK_SAMPLES) latencies.shift();
}

const pending = new Set<() => void>();

/**
 * Starts timing a seek of `v`: resolves with the ms until its "seeked", or null if none comes
 * within SEEK_CEILING_MS. Meanwhile it keeps the echo window open, so a slow landing's own
 * "seeked" is never taken as the person's seek.
 */
function landing(v: HTMLVideoElement): Promise<number | null> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const end = (ms: number | null) => {
      clearTimeout(ceiling);
      clearInterval(keep);
      v.removeEventListener("seeked", onSeeked);
      pending.delete(cancel);
      if (ms !== null) hold(LANDED_HOLD_MS);
      resolve(ms);
    };
    const onSeeked = () => end(Date.now() - t0);
    const cancel = () => end(null);
    const ceiling = setTimeout(cancel, SEEK_CEILING_MS);
    const keep = setInterval(() => hold(SEEK_HOLD_MS), 250);
    v.addEventListener("seeked", onSeeked);
    pending.add(cancel);
    hold(SEEK_HOLD_MS);
  });
}

/**
 * A correction the person didn't ask for, on a playing room: a quiet seek aimed ahead by the
 * seek lead. Resolves once the seek is out; `landed` resolves with how long it took to land
 * (null if it never said), which also feeds the lead of the next one.
 */
export async function correctQuietly(
  provider: StreamingProvider,
  playback: Playback,
  serverNow: number,
): Promise<{ landed: Promise<number | null> }> {
  const v = provider.video();
  const landed = v ? landing(v) : Promise.resolve(null);
  await seekQuietly(provider, expectedPosition(playback, serverNow + seekLeadMs()));
  return {
    landed: landed.then((ms) => {
      if (ms !== null && playback.status === "playing") recordLatency(ms);
      return ms;
    }),
  };
}

/** What the settle reads from the room, fresh each time, and tells it. */
export interface RoomView {
  /** The room's clock for the title this tab is on, or null when this tab isn't following it. */
  clock(): { playback: Playback; offset: number } | null;
  /** Something other than drift is going on: a hold, an ad, a countdown, a live stream. */
  busy(): boolean;
  /** A settle correction is about to be made from this much drift (absolute, seconds). */
  corrected(drift: number): void;
  /** The player can't land closer to the room; leave it alone for a while. */
  stuck(): void;
}

type Ready =
  | { v: HTMLVideoElement; clock: { playback: Playback; offset: number } }
  | "wait"
  | "stop";

let run: { stop: () => void } | null = null;
/** Bumped on every cancel, so a landing that finishes after one starts no settle. */
let epoch = 0;

/** True while a seek is landing or a settle is running: the drift check waits. */
export const isSettling = () => run !== null || pending.size > 0;

/** Ends the settle (the room moved, the person acted, the tab left the room). */
export function cancelSettle() {
  epoch += 1;
  run?.stop();
}

/** Ends the settle and every seek timer (this copy of the content script is retiring). */
export function stopSettling() {
  cancelSettle();
  for (const cancel of [...pending]) cancel();
}

function startSettle(provider: StreamingProvider, view: RoomView, from: Playback) {
  run?.stop();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dead = false;
  let corrections = 0;
  let previous: number | null = null;
  let retried = false;
  // A second seek during the settle (hls.js does one after "seeked") keeps the echo window open.
  const onSeeking = (e: Event) => {
    const v = provider.video();
    if (v && e.target === v) void landing(v);
  };
  document.addEventListener("seeking", onSeeking, true);
  const me = {
    stop() {
      dead = true;
      clearTimeout(timer);
      document.removeEventListener("seeking", onSeeking, true);
      if (run === me) run = null;
    },
  };
  run = me;
  const later = (ms: number, fn: () => void) => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };

  /** The player and the room if it's time to look, "wait" while it lands, "stop" to give up. */
  const ready = (): Ready => {
    const v = provider.video();
    const clock = view.clock();
    if (!v || !clock || dead) return "stop";
    const { playback } = clock;
    if (playback.updatedAt !== from.updatedAt || playback.status !== "playing") return "stop";
    if (document.hidden || view.busy() || provider.ad()) return "stop";
    if (Date.now() - startedAt > SETTLE_DEADLINE_MS || !Number.isFinite(v.duration)) return "stop";
    if (Math.abs(baseRate(v) - playback.rate) > 0.01) return "stop";
    return v.seeking || v.readyState < 3 || v.paused ? "wait" : { v, clock };
  };

  const waitLanded = (tries: number) => {
    const r = ready();
    if (r === "stop") return me.stop();
    if (r === "wait")
      return tries > 0 ? later(SETTLE_POLL_MS, () => waitLanded(tries - 1)) : me.stop();
    advance(r.v.currentTime, SETTLE_WAIT_TRIES);
  };
  const advance = (since: number, tries: number) => {
    const r = ready();
    if (r === "stop") return me.stop();
    if (r === "wait") return waitLanded(tries);
    if (r.v.currentTime - since >= SETTLE_ADVANCE_SEC) return later(SETTLE_AFTER_MS, measure);
    if (tries <= 0) return me.stop();
    later(50, () => advance(since, tries - 1));
  };
  const measure = async () => {
    const r = ready();
    if (r === "stop") return me.stop();
    if (r === "wait") return waitLanded(SETTLE_WAIT_TRIES);
    const { v, clock } = r;
    const now = Date.now();
    const local = v.currentTime;
    const expected = expectedPosition(clock.playback, now + clock.offset);
    const min = settleMinFor(provider.driftToleranceSec ?? DRIFT_TOLERANCE_SEC);
    const action = settleDecision(local, expected, corrections, previous, min);
    if (action === "stop") {
      // It has been corrected and is no closer: stop jumping it for this move. The next move
      // gets its own settle: a correction that landed on a spot still loading looks the same.
      view.stuck();
      return me.stop();
    }
    if (action !== "correct") return me.stop();
    const drift = Math.abs(local - expected);
    let landed: Promise<number | null>;
    try {
      landed = (await correctQuietly(provider, clock.playback, Date.now() + clock.offset)).landed;
    } catch {
      // The bridge couldn't find Netflix's player: no message, one more try shortly.
      if (dead || retried) return me.stop();
      retried = true;
      return later(SETTLE_RETRY_MS, measure);
    }
    corrections += 1;
    previous = drift;
    view.corrected(drift);
    await landed;
    if (dead) return;
    if (corrections >= SETTLE_MAX_CORRECTIONS) return me.stop();
    later(SETTLE_RECHECK_MS, () => waitLanded(SETTLE_WAIT_TRIES));
  };
  waitLanded(SETTLE_WAIT_TRIES);
}

/**
 * Brings this player to the room's playback. `serverNow` is the server clock in ms. A seek on a
 * playing room aims ahead by the seek lead and, when `view` is given, is followed by a settle.
 */
/** Within this, "Bring everyone here" leaves a player alone: about what anyone can notice. */
const EXACT_SEC = 0.15;
/** A paused room lines every player up on its frame within this: a pause lands late by a trip. */
const PAUSED_SEC = 0.04;
/** Resuming from a pause, a player this far off seeks (it is buffered there) rather than nudging. */
const RESUME_SEC = 0.1;

export async function apply(
  provider: StreamingProvider,
  playback: Playback,
  serverNow: number,
  exact = false,
  view?: RoomView,
) {
  const local = provider.getState();
  if (!local) return;
  hold(ECHO_MS);
  endNudge(); // a room move starts from the room's rate; the nudge picks up again after it
  const target = expectedPosition(playback, serverNow);
  const gap = Math.abs(local.position - target);
  const off = exact
    ? gap > EXACT_SEC
    : playback.status === "paused"
      ? gap > PAUSED_SEC
      : !local.playing
        ? gap > RESUME_SEC
        : decide(local.position, target) !== "none";
  if (off) {
    const playing = playback.status === "playing";
    const v = provider.video();
    const landed = playing && v ? landing(v) : null;
    const mine = epoch;
    await provider.seek(playing ? expectedPosition(playback, serverNow + seekLeadMs()) : target);
    // Not awaited: the player starts playing without waiting for the seek to land.
    void landed?.then((ms) => {
      if (ms === null) return;
      recordLatency(ms);
      // With nudging on, the nudge closes the last bit; a second seek would be another gamble.
      if (view && mine === epoch && !nudgeAvailable()) startSettle(provider, view, playback);
    });
  }
  if (playback.status === "playing" && !local.playing) await provider.play();
  if (playback.status === "paused" && local.playing) await provider.pause();
}
