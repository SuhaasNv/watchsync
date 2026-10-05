// "A newer WatchSync is out" (UC-012): the latest GitHub release, looked up at most once a day.
// Installs from the zip don't update themselves, so the popup says when there is a new one.
// Chrome Web Store installs are updated by Chrome itself, so they never look or say anything.

export const RELEASES_API = "https://api.github.com/repos/SuhaasNv/watchsync/releases/latest";
/** The WatchSync Dev build checks the rolling pre-release testers download (DEC-026). */
export const DEV_RELEASE_API =
  "https://api.github.com/repos/SuhaasNv/watchsync/releases/tags/dev-latest";
const DEV_TAG = "dev-latest";
/** A dev release's version is the short commit it was built from. */
const COMMIT = /^[0-9a-f]{7}$/;
const RELEASE_PAGES = "https://github.com/SuhaasNv/watchsync/releases/";
/** Where the prod build lives on the Chrome Web Store. */
export const STORE_URL =
  "https://chromewebstore.google.com/detail/watchsync/odlngcfniaebaekgiaaghfehnchgkihc";
export const CHECK_EVERY = 24 * 3600 * 1000;

/**
 * Whether this install came from the Chrome Web Store: Chrome adds an `update_url` to the
 * installed manifest for store installs. Unpacked and zip installs have none (the build adds none).
 */
export function fromStore(manifest: { update_url?: unknown }): boolean {
  return typeof manifest.update_url === "string" && manifest.update_url !== "";
}

export interface Update {
  /** As tagged, without the leading v: "0.1.1" or "0.2.0-rc.1"; a dev build's short commit. */
  version: string;
  /** The release's page on GitHub. */
  url: string;
}

/** What chrome.storage.local keeps between checks. */
export interface UpdateCheck {
  checkedAt: number;
  latest: Update | null;
}

interface Version {
  major: number;
  minor: number;
  patch: number;
  /** Release candidate number; null for a final release. */
  rc: number | null;
}

const VERSION = /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})(?:-rc\.(\d{1,5}))?$/;

export function parseVersion(v: string): Version | null {
  const m = VERSION.exec(v);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    rc: m[4] === undefined ? null : Number(m[4]),
  };
}

/** Semver order with release candidates before their final: 0.1.0-rc.1 < 0.1.0-rc.2 < 0.1.0. */
export function compareVersions(a: Version, b: Version): number {
  const d = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (d !== 0) return d;
  if (a.rc === b.rc) return 0;
  if (a.rc === null) return 1;
  if (b.rc === null) return -1;
  return a.rc - b.rc;
}

/**
 * Whether `latest` (a release tag) is newer than the installed manifest version.
 * The zip of v0.1.0-rc.1 carries manifest version 0.1.0 and can't tell it's a candidate,
 * so only a higher base version counts: v0.1.0 is not offered to someone on v0.1.0-rc.1.
 */
export function isUpdate(latest: string, installed: string): boolean {
  const l = parseVersion(latest);
  const i = parseVersion(installed);
  if (!l || !i) return false;
  return compareVersions({ ...l, rc: null }, { ...i, rc: null }) > 0;
}

const isOurs = (version: unknown, url: unknown): boolean =>
  typeof version === "string" &&
  (parseVersion(version) !== null || COMMIT.test(version)) &&
  typeof url === "string" &&
  url.startsWith(RELEASE_PAGES);

/** The GitHub release body crosses a boundary: keep only a well-formed tag and our own page. */
export function parseRelease(data: unknown): Update | null {
  if (typeof data !== "object" || data === null) return null;
  const { tag_name, html_url, target_commitish } = data as {
    tag_name?: unknown;
    html_url?: unknown;
    target_commitish?: unknown;
  };
  if (tag_name === DEV_TAG) {
    // The dev workflow points the release at the commit it built.
    const sha = typeof target_commitish === "string" ? target_commitish.slice(0, 7) : null;
    return sha && isOurs(sha, html_url) ? { version: sha, url: String(html_url) } : null;
  }
  if (!isOurs(tag_name, html_url)) return null;
  return { version: String(tag_name).replace(/^v/, ""), url: String(html_url) };
}

function isCheck(v: unknown): v is UpdateCheck {
  if (typeof v !== "object" || v === null) return false;
  const { checkedAt, latest } = v as { checkedAt?: unknown; latest?: unknown };
  if (typeof checkedAt !== "number") return false;
  if (latest === null) return true;
  if (typeof latest !== "object") return false;
  const { version, url } = latest as { version?: unknown; url?: unknown };
  return isOurs(version, url);
}

export interface UpdateDeps {
  now: number;
  load: () => Promise<unknown>;
  save: (check: UpdateCheck) => Promise<void>;
  /** Resolves to the release JSON; rejects on network errors, timeouts and non-2xx replies. */
  fetchLatest: () => Promise<unknown>;
}

/**
 * The latest release, from the cache when it is under a day old, else from GitHub.
 * A failed lookup also counts as a check, so an offline browser doesn't retry on every wake;
 * it keeps whatever it knew before.
 */
export async function latestRelease(deps: UpdateDeps): Promise<Update | null> {
  const cached = await deps.load();
  const known = isCheck(cached) ? cached : null;
  const age = known ? deps.now - known.checkedAt : Number.POSITIVE_INFINITY;
  if (known && age >= 0 && age < CHECK_EVERY) return known.latest;
  let latest: Update | null;
  try {
    latest = parseRelease(await deps.fetchLatest());
  } catch {
    latest = known?.latest ?? null;
  }
  await deps.save({ checkedAt: deps.now, latest });
  return latest;
}
