// How the microphone is asked for, and which mic mode follows from what Chrome can do (DEC-037).
// Open mic is the default only when Chrome cancels echo from everything the computer plays
// (echoCancellation "all"), which keeps the film out of the mic. Otherwise push-to-talk is the
// default, with a headphones hint that never blocks. The person can change it in settings.
import { type BlockedBy, isMode, type MicMode } from "./messages";

/**
 * The microphone the person picked in the mic test, else the system's. Asked for exactly (an
 * ideal is not always honoured); `ask` below falls back to the default if it is gone.
 */
const picked = (
  audio: MediaTrackConstraints,
  deviceId: string | null | undefined,
): MediaStreamConstraints => ({
  audio: deviceId ? { ...audio, deviceId: { exact: deviceId } } : audio,
});

/** "all" is asked for as an ideal, so a Chrome that doesn't know it still gives a microphone. */
export const micConstraints = (deviceId?: string | null): MediaStreamConstraints =>
  picked(
    { echoCancellation: { ideal: "all" }, noiseSuppression: true, autoGainControl: true },
    deviceId,
  );

/** Whether this Chrome cancels echo from all audio on the computer, on a mic it has just given. */
export function cancelsAllEcho(track: Pick<MediaStreamTrack, "getCapabilities" | "getSettings">) {
  const caps = track.getCapabilities().echoCancellation;
  return (
    Array.isArray(caps) && caps.includes("all") && track.getSettings().echoCancellation === "all"
  );
}

const plainConstraints = (deviceId?: string | null): MediaStreamConstraints =>
  picked({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }, deviceId);
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

/** getUserMedia for the picked microphone; one that has been unplugged falls back to the default. */
async function ask(
  constraints: (deviceId: string | null | undefined) => MediaStreamConstraints,
  deviceId: string | null | undefined,
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints(deviceId));
  } catch (e) {
    if (deviceId && Reflect.get(Object(e), "name") === "OverconstrainedError")
      return navigator.mediaDevices.getUserMedia(constraints(null));
    throw e;
  }
}

/**
 * Asks for the microphone. `all` says whether it really cancels echo from everything the
 * computer plays: some Chrome builds report "all" and then end the mic at once, and those
 * get an ordinary mic and count as not doing it (so push-to-talk stays the default).
 */
export async function openMic(
  deviceId?: string | null,
): Promise<{ stream: MediaStream; all: boolean }> {
  const first = await ask(micConstraints, deviceId);
  const t = first.getAudioTracks()[0];
  if (!t || !cancelsAllEcho(t)) return { stream: first, all: false };
  if (!(await endsWithin(t, SETTLE_MS))) return { stream: first, all: true };
  for (const x of first.getTracks()) x.stop();
  return {
    stream: await ask(plainConstraints, deviceId),
    all: false,
  };
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
/** Saved in chrome.storage.local: the microphone picked in the mic test (absent: the system's). */
export const MIC_ID_KEY = "voiceMicId";

/** A device id from storage or the worker: a short string, else none. */
export const deviceIdOf = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= 512 ? v : null;

/** The person's choice, else what was found, else push-to-talk (nothing known yet). */
export function micMode(chosen: unknown, found: unknown): MicMode {
  if (isMode(chosen)) return chosen;
  return isMode(found) ? found : "ptt";
}
