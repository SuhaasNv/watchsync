import { parseReleases, type Release } from "../lib/releases";
import { RELEASES_API } from "../lib/site";

const CACHE_KEY = "ws-releases";
const CACHE_MS = 10 * 60 * 1000;

function readCache(): unknown {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("at" in parsed) || !("data" in parsed)) {
      return null;
    }
    return typeof parsed.at === "number" && Date.now() - parsed.at < CACHE_MS ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeCache(data: unknown) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Storage can be full or blocked (private windows); the next page simply asks again.
  }
}

export class GithubError extends Error {
  constructor(
    message: string,
    readonly rateLimited: boolean,
  ) {
    super(message);
  }
}

let pending: Promise<Release[]> | null = null;

/**
 * The published releases, newest first. GitHub allows 60 unauthenticated requests an hour,
 * so one answer is shared by the whole tab for ten minutes.
 */
export function fetchReleases(): Promise<Release[]> {
  const cached = readCache();
  if (cached !== null) return Promise.resolve(parseReleases(cached));
  pending ??= (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(RELEASES_API, {
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        const limited = res.status === 403 || res.status === 429;
        throw new GithubError(`GitHub answered ${res.status}`, limited);
      }
      const data: unknown = await res.json();
      writeCache(data);
      return parseReleases(data);
    } finally {
      clearTimeout(timer);
    }
  })();
  return pending.catch((e: unknown) => {
    pending = null;
    throw e;
  });
}
