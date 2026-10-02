// Play, pause and jumps between this tab's player and the room.
import type { Playback } from "@watchsync/protocol";
import { decide, expectedPosition } from "@watchsync/sync-engine";
import type { StreamingProvider } from "./providers";

export type Action = "play" | "pause" | "seek";

const ECHO_MS = 1500;
let quietUntil = 0;

/** Player events within this window come from our own commands, not the user. */
export const isEcho = (now = Date.now()) => now < quietUntil;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Calls `onUser` for plays and pauses the person makes in the service's player.
 * Media events don't bubble, so listen in the capture phase on the document.
 */
export function listen(
  provider: StreamingProvider,
  onUser: (action: Action, position: number, rate: number) => void,
) {
  const handler = (e: Event) => {
    const v = provider.video();
    if (e.target !== v || !v || isEcho()) return;
    if (!Number.isFinite(v.duration)) return; // live: not synced (UC-010)
    const action: Action = e.type === "play" ? "play" : "pause";
    onUser(action, clamp(v.currentTime, 0, 86_400), clamp(v.playbackRate, 0.25, 4));
  };
  document.addEventListener("play", handler, true);
  document.addEventListener("pause", handler, true);
}

/** Brings this player to the room's playback. `serverNow` is the server clock in ms. */
export async function apply(provider: StreamingProvider, playback: Playback, serverNow: number) {
  const local = provider.getState();
  if (!local) return;
  quietUntil = Date.now() + ECHO_MS;
  const target = expectedPosition(playback, serverNow);
  if (decide(local.position, target) !== "none") await provider.seek(target);
  if (playback.status === "playing" && !local.playing) await provider.play();
  if (playback.status === "paused" && local.playing) await provider.pause();
}
