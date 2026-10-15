// The daily check for newer service rules (DEC-038): at worker start and when the popup opens,
// at most once a day, with no alarm. The file and its signature come from watchsync.space
// (served with CORS, so no host permission); only a correctly signed, newer, in-date file
// replaces what we have. Logs say counts and versions, never the fetched content.
import { rulesKey } from "../rules/public-key";
import { refreshRules } from "../rules/update";
import { MAX_RULES_BYTES, MAX_SIG_BYTES, type Verdict, verifyRules } from "../rules/verify";

const FETCH_TIMEOUT_MS = 10_000;

/** The body of `url` as bytes, refusing anything over `max` (header first, then while reading). */
async function fetchCapped(url: string, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url, {
    credentials: "omit",
    cache: "no-cache",
    redirect: "error", // the file lives at one address; a redirect is a surprise
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) throw new Error(`rules ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > max) throw new Error("rules too large");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error("rules too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}

let running: Promise<void> | null = null;

async function check(source: string, key: string): Promise<void> {
  const outcome = await refreshRules({
    now: Date.now(),
    load: async () => (await chrome.storage.local.get("rules")).rules,
    save: (rules) => chrome.storage.local.set({ rules }),
    fetchVerified: async (): Promise<Verdict> => {
      const [body, sig] = await Promise.all([
        fetchCapped(source, MAX_RULES_BYTES),
        fetchCapped(`${source}.sig`, MAX_SIG_BYTES),
      ]);
      return verifyRules(body, new TextDecoder().decode(sig), key);
    },
  });
  console.debug("watchsync: rules check", outcome);
}

/** Never throws and never runs twice at once (worker start and a popup open can overlap). */
function run(source: string, key: string | null): Promise<void> {
  // No key bundled (production before the owner's key is pasted in): bundled rules only.
  if (!key) return Promise.resolve();
  running ??= check(source, key)
    .catch((e: unknown) =>
      console.debug("watchsync: rules check failed", e instanceof Error ? e.message : "error"),
    )
    .finally(() => {
      running = null;
    });
  return running;
}

/** Test builds stay off the network; they call the hook below instead. */
export const checkRules = (): Promise<void> =>
  __MOCK__ ? Promise.resolve() : run(`${__SITE_URL__}/rules/v1.json`, rulesKey());

// Test builds only: a check against a test server and a test key (the schedule is the
// test's to reset in chrome.storage).
if (__MOCK__) Object.assign(globalThis, { watchsyncCheckRules: run });
