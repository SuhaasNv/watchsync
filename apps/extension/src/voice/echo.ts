// How the microphone is asked for, and which mic mode follows from what Chrome can do (DEC-037).
// Open mic is the default only when Chrome cancels echo from everything the computer plays
// (echoCancellation "all"), which keeps the film out of the mic. Otherwise push-to-talk is the
// default, with a headphones hint that never blocks. The person can change it in settings.
import type { BlockedBy, MicMode } from "./messages";

/** "all" is asked for as an ideal, so a Chrome that doesn't know it still gives a microphone. */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: { ideal: "all" }, noiseSuppression: true, autoGainControl: true },
};

/** Whether this Chrome cancels echo from all audio on the computer, on a mic it has just given. */
export function cancelsAllEcho(track: Pick<MediaStreamTrack, "getCapabilities" | "getSettings">) {
  const caps = track.getCapabilities().echoCancellation;
  return (
    Array.isArray(caps) && caps.includes("all") && track.getSettings().echoCancellation === "all"
  );
}

const PLAIN_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};
/** A mic given with echo "all" that ends within this long could not really do it. */
const SETTLE_MS = 800;

const endsWithin = (t: MediaStreamTrack, ms: number) =>
  new Promise<boolean>((resolve) => {
    const done = (ended: boolean) => {
      t.removeEventListener("ended", onEnded);
      clearTimeout(timer);
      resolve(ended);
    };
    const onEnded = () => done(true);
    const timer = setTimeout(() => done(false), ms);
    t.addEventListener("ended", onEnded);
  });

/**
 * Asks for the microphone. `all` says whether it really cancels echo from everything the
 * computer plays: some Chrome builds report "all" and then end the mic at once, and those
 * get an ordinary mic and count as not doing it (so push-to-talk stays the default).
 */
export async function openMic(): Promise<{ stream: MediaStream; all: boolean }> {
  const first = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  const t = first.getAudioTracks()[0];
  if (!t || !cancelsAllEcho(t)) return { stream: first, all: false };
  if (!(await endsWithin(t, SETTLE_MS))) return { stream: first, all: true };
  for (const x of first.getTracks()) x.stop();
  return { stream: await navigator.mediaDevices.getUserMedia(PLAIN_CONSTRAINTS), all: false };
}

/** Why asking for the microphone failed; null when the person only dismissed Chrome's question. */
export function blockedBy(e: unknown): BlockedBy | null {
  if (!(e instanceof DOMException)) return "chrome";
  if (e.name === "NotFoundError") return "none";
  if (e.name === "NotReadableError") return "system"; // the system, or another app, holds it
  if (e.name === "NotAllowedError") {
    if (/dismissed/i.test(e.message)) return null;
    return /system/i.test(e.message) ? "system" : "chrome";
  }
  return "chrome";
}

/** Saved in chrome.storage.local: the person's choice, and what this Chrome was found to do. */
export const MODE_KEY = "voiceMode";
export const MODE_AUTO_KEY = "voiceModeAuto";

const isMode = (v: unknown): v is MicMode => v === "open" || v === "ptt";

/** The person's choice, else what was found, else push-to-talk (nothing known yet). */
export function micMode(chosen: unknown, found: unknown): MicMode {
  if (isMode(chosen)) return chosen;
  return isMode(found) ? found : "ptt";
}
