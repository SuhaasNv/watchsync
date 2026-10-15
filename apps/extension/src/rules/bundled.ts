// The rules that ship inside the extension: what the adapters use with no network, a bad
// file or an expired one. The same values the adapters had before rules existed.
import type { Rules } from "./schema";

/** The sequence number these rules correspond to: a published file must be higher. */
export const BUNDLED_SEQ = 0;

export const BUNDLED_RULES: Rules = {
  filmMinSec: 300,
  netflix: {
    titleSelector: '[data-uia="video-title"]',
    driftToleranceSec: 0.15,
    // The ad badge ("Ad" and a countdown) that exists only while an ad plays (UC-048).
    ad: {
      containerSelector: '[data-uia="ads-info-container"]',
      timeSelector: '[data-uia="ads-info-time"]',
    },
  },
  prime: {
    titleSelectors: [".atvwebplayersdk-title-text", '[data-automation-id="title"]'],
    episodeSelector: ".atvwebplayersdk-subtitle-text",
    // Three markers: the first from the spike's desk research, the other two seen by a
    // third-party extension on live players (undated; not yet confirmed here, US-127).
    adTimerSelector:
      ".atvwebplayersdk-ad-timer, .dv-player-fullscreen .atvwebplayersdk-ad-timer-remaining-time, .atvwebplayersdk-adtimeindicator-text",
    driftToleranceSec: 0.25,
  },
  jiohotstar: { driftToleranceSec: 0.5 },
};
