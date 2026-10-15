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
  // "You can't play this here" screens (US-128). Only a marker plus the words in code
  // (providers.ts) says "can't play"; a marker alone never does. Evidence and confidence per
  // service are in docs/RULES-SECURITY.md and the fixtures in content/fixtures.
  unavailable: {
    // Netflix's "Lost your way?" page, which a title Netflix won't open here lands on
    // (/watch/<id> is sent to /title/<id>?fromWatch=true). Seen on the public page, 15 Oct 2026.
    netflix: '[data-uia="page-404"]',
    // The title line of Prime's player error modal, from its player bundle (read, not run).
    prime: ".atvwebplayersdk-video-unavailable-error",
    // Hotstar draws errors from server-sent widgets with no stable marker found: wide on
    // purpose, and the words decide.
    jiohotstar: '[role="alertdialog"], [role="dialog"], [role="alert"], [data-testid*="rror"]',
  },
};
