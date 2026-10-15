// The words on the Talk button, the same in the pill and in the popup.
import type { VoiceView } from "./messages";

/**
 * Before the mic is allowed: "Talk". Then open mic shows Mute or Unmute, and push-to-talk shows
 * "Hold to talk" (and "Talking" while it is held). `label` is what a screen reader says.
 */
export function talkWords(view: VoiceView): { text: string; label: string } {
  if (view.mic !== "on") return { text: "Talk", label: "Talk" };
  if (view.mode === "open") {
    return view.live
      ? { text: "Mute", label: "Mute your mic" }
      : { text: "Unmute", label: "Unmute your mic" };
  }
  return { text: view.live ? "Talking" : "Hold to talk", label: "Hold to talk" };
}
