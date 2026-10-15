// What to tell someone whose microphone is blocked (US-057): the exact steps, for their system.
// Chrome keeps the answer per site, so the first step opens WatchSync's own entry in Chrome's
// settings. A system-level block (macOS, Windows) is a step of its own, shown only for the
// system they are on.
import type { BlockedBy } from "./messages";

export type Os = "mac" | "windows" | "other";

/** The system from the browser's own platform string. */
export function detectOs(platform: string): Os {
  if (/mac|iphone|ipad/i.test(platform)) return "mac";
  if (/win/i.test(platform)) return "windows";
  return "other";
}

/** Chrome's settings page for one site: here, WatchSync's own extension address. */
export const micSettingsUrl = (origin: string) =>
  `chrome://settings/content/siteDetails?site=${encodeURIComponent(origin)}`;

/** The page that asks Chrome for the microphone ("ask") and lets people test it ("test"). */
export const MIC_PAGE = "voice-permission.html";

/** Its address, with the tab to send the person back to when they are done (if any). */
export function micPageUrl(base: string, mode: "ask" | "test", back?: number): string {
  const query = new URLSearchParams({ mode });
  if (back !== undefined) query.set("tab", String(back));
  return `${base}${MIC_PAGE}?${query}`;
}

export interface MicHelp {
  title: string;
  /** One line above the steps. */
  text: string;
  steps: string[];
  /** The line under them: what keeps working. */
  footer: string;
  /** The button that opens Chrome's settings; null when settings can't help (no microphone). */
  button: string | null;
}

const FOOTER = "Sync and chat keep working without a mic.";

const SYSTEM: Record<Os, string | null> = {
  mac: "On a Mac, open System Settings › Privacy & Security › Microphone and turn Chrome on.",
  windows:
    "On Windows, open Settings › Privacy & security › Microphone and turn on “Let desktop apps access your microphone”.",
  other: null,
};

/**
 * The steps for a blocked mic. `by`: Chrome said no, or the system did (its step then comes
 * first), or there is no microphone at all (settings can't fix that).
 */
export function micHelp(os: Os, by: BlockedBy): MicHelp {
  if (by === "none") {
    return {
      title: "No microphone found",
      text: "WatchSync can't find a microphone on this computer.",
      steps: ["Plug in or turn on a microphone.", "Come back and press Talk."],
      footer: FOOTER,
      button: null,
    };
  }
  const chrome = [
    "Open Chrome's settings for WatchSync with the button below.",
    "Set Microphone to Allow.",
  ];
  const system = SYSTEM[os] ?? [];
  const steps = by === "system" ? [system, ...chrome] : [...chrome, system];
  return {
    title: "Turn your mic back on",
    text: "Chrome or your computer is keeping WatchSync from your microphone.",
    steps: [...steps.flat(), "Come back and press Talk."],
    footer: FOOTER,
    button: "Open mic settings",
  };
}
