// The daily rules check as plain decisions with its dependencies passed in (tests give fakes;
// background/rules.ts gives chrome.storage and fetch). Failure is never loud: the last good
// rules, or the bundled ones, simply stay.
import { BUNDLED_RULES, BUNDLED_SEQ } from "./bundled";
import { expiresAt, MAX_LIFETIME_MS, parseRulesFile, type Rules, type RulesFile } from "./schema";
import type { Verdict } from "./verify";

export const CHECK_EVERY = 24 * 3600 * 1000;
/** A failed check (offline, host down) tries again after this. */
export const RETRY_AFTER = 3600 * 1000;

/** What chrome.storage.local keeps under "rules". */
export interface RulesState {
  /** Not before this time (ms): the next network check. */
  nextCheckAt: number;
  /** The last good file, or none yet. */
  file: RulesFile | null;
}

/** The rules the adapters use now: the stored file while it is in date, else the bundled ones. */
export function activeRules(file: RulesFile | null, now: number): Rules {
  if (!file || now >= expiresAt(file)) return BUNDLED_RULES;
  const { netflix } = file.rules;
  return { ...file.rules, netflix: { ...netflix, ad: netflix.ad ?? BUNDLED_RULES.netflix.ad } };
}

/** A stored value from chrome.storage, checked again like anything that crosses a boundary. */
export function parseState(
  data: unknown,
  selectorOk?: (selector: string) => boolean,
): RulesState | null {
  if (typeof data !== "object" || data === null) return null;
  const { nextCheckAt, file } = data as { nextCheckAt?: unknown; file?: unknown };
  if (typeof nextCheckAt !== "number") return null;
  if (file === null) return { nextCheckAt, file: null };
  const parsed = parseRulesFile(file, selectorOk);
  return parsed ? { nextCheckAt, file: parsed } : null;
}

export interface RefreshDeps {
  now: number;
  load: () => Promise<unknown>;
  save: (state: RulesState) => Promise<void>;
  /** Resolves to the verdict on the fetched file; rejects on network errors and timeouts. */
  fetchVerified: () => Promise<Verdict>;
}

export type Outcome = "skipped" | "updated" | "kept" | "failed";

/**
 * Looks for newer rules at most once a day. A file is taken only if its signature and shape
 * are right (fetchVerified), it has not expired nor claims more than 90 days, and its sequence
 * is higher than the stored file's and the bundled one's: an old file replayed by a broken
 * host is never accepted.
 */
export async function refreshRules(deps: RefreshDeps): Promise<Outcome> {
  const state = parseState(await deps.load());
  const due = !state || deps.now >= state.nextCheckAt || state.nextCheckAt > deps.now + CHECK_EVERY;
  if (!due) return "skipped";
  const file = state?.file ?? null;
  let verdict: Verdict;
  try {
    verdict = await deps.fetchVerified();
  } catch {
    await deps.save({ nextCheckAt: deps.now + RETRY_AFTER, file });
    return "failed";
  }
  if (!verdict.ok) {
    await deps.save({ nextCheckAt: deps.now + RETRY_AFTER, file });
    return "failed";
  }
  const newer = verdict.file.seq > Math.max(file?.seq ?? 0, BUNDLED_SEQ);
  const fresh =
    deps.now < expiresAt(verdict.file) && expiresAt(verdict.file) <= deps.now + MAX_LIFETIME_MS;
  if (!newer || !fresh) {
    await deps.save({ nextCheckAt: deps.now + CHECK_EVERY, file });
    return "kept";
  }
  await deps.save({ nextCheckAt: deps.now + CHECK_EVERY, file: verdict.file });
  return "updated";
}
