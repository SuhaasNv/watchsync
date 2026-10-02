// Play, pause and jumps between this tab's player and the room.
import type { Playback } from "@watchsync/protocol";
import { decide, expectedPosition } from "@watchsync/sync-engine";
import type { StreamingProvider } from "./providers";

export type Action = "play" | "pause" | "seek";

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
 */
export function listen(
  provider: StreamingProvider,
  onUser: (action: Action, playing: boolean, position: number, rate: number) => void,
) {
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
}

/** 2530 → "42:10", 3723 → "1:02:03". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

/** A correction the person didn't ask for: seek without it being taken as theirs. */
export async function seekQuietly(provider: StreamingProvider, seconds: number) {
  hold(ECHO_MS);
  await provider.seek(seconds);
}

/** Brings this player to the room's playback. `serverNow` is the server clock in ms. */
export async function apply(provider: StreamingProvider, playback: Playback, serverNow: number) {
  const local = provider.getState();
  if (!local) return;
  hold(ECHO_MS);
  const target = expectedPosition(playback, serverNow);
  if (decide(local.position, target) !== "none") await provider.seek(target);
  if (playback.status === "playing" && !local.playing) await provider.play();
  if (playback.status === "paused" && local.playing) await provider.pause();
}
