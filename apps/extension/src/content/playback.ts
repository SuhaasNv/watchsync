// Play, pause and jumps between this tab's player and the room.
import type { Playback } from "@watchsync/protocol";
import { decide, expectedPosition } from "@watchsync/sync-engine";
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
    onUser(action, !v.paused, clamp(v.currentTime, 0, 86_400), clamp(v.playbackRate, 0.25, 4));
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
  await provider.seek(seconds);
}

/** Brings this player to the room's playback. `serverNow` is the server clock in ms. */
/** Within this, "Bring everyone here" leaves a player alone: about what anyone can notice. */
const EXACT_SEC = 0.15;

export async function apply(
  provider: StreamingProvider,
  playback: Playback,
  serverNow: number,
  exact = false,
) {
  const local = provider.getState();
  if (!local) return;
  hold(ECHO_MS);
  const target = expectedPosition(playback, serverNow);
  const off = exact
    ? Math.abs(local.position - target) > EXACT_SEC
    : decide(local.position, target) !== "none";
  if (off) await provider.seek(target);
  if (playback.status === "playing" && !local.playing) await provider.play();
  if (playback.status === "paused" && local.playing) await provider.pause();
}
