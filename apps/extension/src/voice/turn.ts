// TURN credentials for voice (US-123). The room service hands them to room members only and
// they expire within 2 hours; this asks for them, validates what comes back, and keeps them
// until shortly before they expire. The background worker owns the room token, so the fetch
// runs there; nothing here is stored on disk or logged.
import { type IceServer, isTurnCredentials } from "@watchsync/protocol";

/** Ask again this long before the credentials expire, so a call never starts on stale ones. */
export const RENEW_BEFORE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 10_000;

/** unavailable: the room service has no TURN. failed: anything else. Either way, go direct. */
export type TurnResult =
  | { ok: true; iceServers: IceServer[]; ttl: number }
  | { ok: false; reason: "unavailable" | "failed" };

/** One request to the room service, as a member of `session.code`. Never throws. */
export async function fetchTurn(
  api: string,
  session: { code: string; token: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TurnResult> {
  try {
    const res = await fetchImpl(`${api}/api/v1/rooms/${session.code}/turn`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 503) return { ok: false, reason: "unavailable" };
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok || !isTurnCredentials(data)) return { ok: false, reason: "failed" };
    return { ok: true, iceServers: data.iceServers, ttl: data.ttl };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

interface Held {
  code: string;
  iceServers: IceServer[];
  ttl: number;
  /** When they stop working (ms, this cache's clock). */
  expiresAt: number;
}

/**
 * Credentials for the room a call is in: fetched on first use, kept until RENEW_BEFORE_MS
 * before they expire, then fetched again. Calls made at the same time share one request. If a
 * renewal fails while the old credentials still work, those are used. They are never kept
 * across rooms: asking for another room (or clear(), on leaving) starts over.
 */
export function turnCache(
  fetchFresh: (code: string) => Promise<TurnResult>,
  now: () => number = Date.now,
) {
  let held: Held | null = null;
  let inflight: { code: string; promise: Promise<TurnResult> } | null = null;
  /** Bumped by clear(), so a request that was on its way when the room ended keeps nothing. */
  let epoch = 0;

  const result = (h: Held): TurnResult => ({ ok: true, iceServers: h.iceServers, ttl: h.ttl });

  return {
    async get(code: string): Promise<TurnResult> {
      if (held && held.code !== code) held = null;
      if (held && now() < held.expiresAt - RENEW_BEFORE_MS) return result(held);
      if (inflight?.code === code) return inflight.promise;
      const mine = epoch;
      const promise = fetchFresh(code).then((r): TurnResult => {
        if (inflight?.promise === promise) inflight = null;
        if (mine !== epoch) return r;
        if (r.ok) {
          held = { code, iceServers: r.iceServers, ttl: r.ttl, expiresAt: now() + r.ttl * 1000 };
          return r;
        }
        // A failed renewal falls back to what still works.
        return held && held.code === code && now() < held.expiresAt ? result(held) : r;
      });
      inflight = { code, promise };
      return promise;
    },

    /** Leaving or ending the room: forget everything. */
    clear() {
      held = null;
      inflight = null;
      epoch += 1;
    },
  };
}
