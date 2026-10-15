// The rules that ship inside the extension: what the adapters use with no network, a bad
// file or an expired one. The same values the adapters had before rules existed.
import type { Rules } from "./schema";

/** The sequence number these rules correspond to: a published file must be higher. */
export const BUNDLED_SEQ = 0;

export const BUNDLED_RULES: Rules = {
  filmMinSec: 300,
  netflix: { titleSelector: '[data-uia="video-title"]', driftToleranceSec: 0.15 },
  prime: {
    titleSelectors: [".atvwebplayersdk-title-text", '[data-automation-id="title"]'],
    episodeSelector: ".atvwebplayersdk-subtitle-text",
    adTimerSelector: ".atvwebplayersdk-ad-timer",
    driftToleranceSec: 0.25,
  },
  jiohotstar: { driftToleranceSec: 0.5 },
};
