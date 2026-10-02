// Runs in Netflix's page context (MAIN world) because the player API lives on window.netflix.
// Takes commands from the content script over CustomEvents; reports success or failure, and
// for "title" the name of what's playing (the page shows it only with the controls, BUG-025).
import { type NetflixMetadata, netflixTitle } from "./netflix-title";

interface NetflixPlayer {
  play(): void;
  pause(): void;
  seek(ms: number): void;
}
interface NetflixVideoPlayer {
  getAllPlayerSessionIds(): string[];
  getVideoPlayerBySessionId(id: string): NetflixPlayer | undefined;
}
interface NetflixWindow {
  netflix?: {
    appContext?: {
      state?: {
        playerApp?: {
          getAPI?: () => { videoPlayer?: NetflixVideoPlayer };
          getState?: () => {
            videoPlayer?: { videoMetadata?: Record<string, NetflixMetadata | undefined> };
          };
        };
      };
    };
  };
}

function titleOf(videoId: string): string | null {
  try {
    const state = (window as NetflixWindow).netflix?.appContext?.state?.playerApp?.getState?.();
    return netflixTitle(state?.videoPlayer?.videoMetadata?.[videoId]);
  } catch {
    return null;
  }
}

function player(): NetflixPlayer | null {
  try {
    const vp = (window as NetflixWindow).netflix?.appContext?.state?.playerApp?.getAPI?.()
      .videoPlayer;
    const id = vp?.getAllPlayerSessionIds()[0];
    return (id && vp?.getVideoPlayerBySessionId(id)) || null;
  } catch {
    return null;
  }
}

document.addEventListener("watchsync:netflix-command", (e) => {
  const detail = (e as CustomEvent<unknown>).detail;
  if (typeof detail !== "string") return;
  let cmd: { id?: unknown; action?: unknown; ms?: unknown; videoId?: unknown };
  try {
    cmd = JSON.parse(detail);
  } catch {
    return;
  }
  if (typeof cmd.id !== "string") return;
  if (cmd.action === "title") {
    const name = typeof cmd.videoId === "string" ? titleOf(cmd.videoId) : null;
    document.dispatchEvent(
      new CustomEvent("watchsync:netflix-result", {
        detail: JSON.stringify({ id: cmd.id, ok: name !== null, name }),
      }),
    );
    return;
  }
  const p = player();
  let ok = true;
  if (p && cmd.action === "play") p.play();
  else if (p && cmd.action === "pause") p.pause();
  else if (p && cmd.action === "seek" && typeof cmd.ms === "number" && cmd.ms >= 0) p.seek(cmd.ms);
  else ok = false;
  document.dispatchEvent(
    new CustomEvent("watchsync:netflix-result", { detail: JSON.stringify({ id: cmd.id, ok }) }),
  );
});
