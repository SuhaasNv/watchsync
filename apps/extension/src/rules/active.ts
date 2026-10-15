// The rules the adapters read right now. They start as the bundled ones and switch to the
// stored file (checked and signed by the background worker) once content-script start has
// read chrome.storage; the adapters ask on every poll, so the switch needs no restart.
import { BUNDLED_RULES } from "./bundled";
import { activeRules, parseState } from "./update";

let current = BUNDLED_RULES;

export const rules = () => current;

/** A selector the page can actually parse (a bad one would throw on every poll). */
const parses = (selector: string) => {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
};

/** Adopts the stored rules if they are valid and in date; otherwise keeps the bundled ones. */
export async function adoptStoredRules(): Promise<void> {
  try {
    const stored = (await chrome.storage.local.get("rules")).rules;
    const state = parseState(stored, parses);
    current = activeRules(state?.file ?? null, Date.now());
  } catch {
    current = BUNDLED_RULES; // storage unavailable: the bundled rules are the fallback
  }
}
