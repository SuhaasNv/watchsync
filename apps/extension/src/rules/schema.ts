// The service rules (DEC-038): the few values in the adapters that change when a service
// changes its page. Data only: selectors, numbers and nothing else. Nothing here is ever
// evaluated, and every key is checked; an unknown or missing one fails the whole file.
// This file imports nothing so scripts/sign-rules.mjs can run it with Node as it is.
// The schema stays out of packages/protocol: only the extension reads these files.

/** Where Netflix's player shows its ad badge: the box, and the countdown inside it. */
export interface NetflixAdRules {
  containerSelector: string;
  timeSelector: string;
}

export interface Rules {
  /** Seconds: a video longer than this is the film, a shorter one is a trailer or an ad. */
  filmMinSec: number;
  netflix: { titleSelector: string; driftToleranceSec: number; ad: NetflixAdRules };
  prime: {
    /** Tried in order; the first with text is the show's name. */
    titleSelectors: string[];
    episodeSelector: string;
    adTimerSelector: string;
    driftToleranceSec: number;
  };
  jiohotstar: { driftToleranceSec: number };
}

/**
 * What a file holds. A group added after the first files were signed (Netflix ads, UC-048) may
 * be left out; activeRules fills it from the bundled rules, so those files stay valid.
 */
export type FileRules = Omit<Rules, "netflix"> & {
  netflix: Omit<Rules["netflix"], "ad"> & { ad?: NetflixAdRules };
};

/** What the signature covers (the file's exact bytes). */
export interface RulesFile {
  schema: 1;
  /** Counts up with every published file; the extension never goes back to a lower one. */
  seq: number;
  /** "2026-11-14T00:00:00Z": past it the file is ignored and the bundled rules apply. */
  expires: string;
  rules: FileRules;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const hasKeys = (o: Obj, keys: string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => k in o);
const num = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** Letters, digits and the characters CSS selectors use; no braces, semicolons or backslashes. */
const SELECTOR = /^[\w\s.#[\]="'\-:>,*()~+^$|]{1,200}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

/** A file may not claim to be valid for longer than this, so a leaked key can't plant rules for good. */
export const MAX_LIFETIME_MS = 90 * 24 * 3600 * 1000;

/** When the file stops counting, in ms since the epoch. */
export const expiresAt = (file: Pick<RulesFile, "expires">): number => Date.parse(file.expires);

/**
 * The rules file if every part is exactly as expected, else null. `selectorOk` lets a page
 * also check that a selector parses (the background has no DOM, so it checks the shape only).
 */
export function parseRulesFile(
  data: unknown,
  selectorOk?: (selector: string) => boolean,
): RulesFile | null {
  if (!isObj(data) || !hasKeys(data, ["schema", "seq", "expires", "rules"])) return null;
  const { schema, seq, expires, rules } = data;
  if (schema !== 1 || typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) return null;
  if (typeof expires !== "string" || !ISO.test(expires) || Number.isNaN(Date.parse(expires)))
    return null;
  if (!isObj(rules) || !hasKeys(rules, ["filmMinSec", "netflix", "prime", "jiohotstar"]))
    return null;

  const sel = (v: unknown): v is string =>
    typeof v === "string" && SELECTOR.test(v) && (selectorOk?.(v) ?? true);
  const drift = (v: unknown): v is number => num(v, 0.05, 5);

  const { filmMinSec, netflix, prime, jiohotstar } = rules;
  if (!num(filmMinSec, 30, 3600)) return null;

  const netflixKeys = ["titleSelector", "driftToleranceSec"];
  if (
    !isObj(netflix) ||
    !(hasKeys(netflix, netflixKeys) || hasKeys(netflix, [...netflixKeys, "ad"]))
  )
    return null;
  const { titleSelector, driftToleranceSec: netflixDrift, ad } = netflix;
  if (!sel(titleSelector) || !drift(netflixDrift)) return null;
  let netflixAd: NetflixAdRules | undefined;
  if ("ad" in netflix) {
    if (!isObj(ad) || !hasKeys(ad, ["containerSelector", "timeSelector"])) return null;
    const { containerSelector, timeSelector } = ad;
    if (!sel(containerSelector) || !sel(timeSelector)) return null;
    netflixAd = { containerSelector, timeSelector };
  }

  if (
    !isObj(prime) ||
    !hasKeys(prime, ["titleSelectors", "episodeSelector", "adTimerSelector", "driftToleranceSec"])
  )
    return null;
  const { titleSelectors, episodeSelector, adTimerSelector, driftToleranceSec: primeDrift } = prime;
  if (!Array.isArray(titleSelectors) || titleSelectors.length < 1 || titleSelectors.length > 8)
    return null;
  const titles: string[] = [];
  for (const s of titleSelectors) {
    if (!sel(s)) return null;
    titles.push(s);
  }
  if (!sel(episodeSelector) || !sel(adTimerSelector) || !drift(primeDrift)) return null;

  if (!isObj(jiohotstar) || !hasKeys(jiohotstar, ["driftToleranceSec"])) return null;
  const { driftToleranceSec: hotstarDrift } = jiohotstar;
  if (!drift(hotstarDrift)) return null;

  return {
    schema: 1,
    seq,
    expires,
    rules: {
      filmMinSec,
      netflix: {
        titleSelector,
        driftToleranceSec: netflixDrift,
        ...(netflixAd && { ad: netflixAd }),
      },
      prime: {
        titleSelectors: titles,
        episodeSelector,
        adTimerSelector,
        driftToleranceSec: primeDrift,
      },
      jiohotstar: { driftToleranceSec: hotstarDrift },
    },
  };
}
