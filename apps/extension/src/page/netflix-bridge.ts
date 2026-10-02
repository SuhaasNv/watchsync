// Runs in Netflix's page context (MAIN world) because the player API lives on window.netflix.
// Takes commands from the content script over CustomEvents; reports only success or failure.

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
      state?: { playerApp?: { getAPI?: () => { videoPlayer?: NetflixVideoPlayer } } };
    };
  };
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
  let cmd: { id?: unknown; action?: unknown; ms?: unknown };
  try {
    cmd = JSON.parse(detail);
  } catch {
    return;
  }
  if (typeof cmd.id !== "string") return;
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
