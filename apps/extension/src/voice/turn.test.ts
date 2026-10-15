import type { IceServer } from "@watchsync/protocol";
import { describe, expect, it, vi } from "vitest";
import { fetchTurn, RENEW_BEFORE_MS, type TurnResult, turnCache } from "./turn";

const servers: IceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478"] },
  { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" },
];
const good: TurnResult = { ok: true, iceServers: servers, ttl: 7200 };
const HOUR = 3600 * 1000;

const reply = (status: number, body: unknown) =>
  vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );

describe("fetchTurn", () => {
  it("asks as a member of the room, with the token in a header, never the URL", async () => {
    const fetchImpl = reply(200, { iceServers: servers, ttl: 7200 });
    const r = await fetchTurn("https://api.test", { code: "ABCDEF", token: "tok.en" }, fetchImpl);
    expect(r).toEqual(good);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.test/api/v1/rooms/ABCDEF/turn");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ authorization: "Bearer tok.en" });
  });

  it("says unavailable when the room service has no TURN", async () => {
    const r = await fetchTurn("https://a", { code: "ABCDEF", token: "t" }, reply(503, {}));
    expect(r).toEqual({ ok: false, reason: "unavailable" });
  });

  it("fails, never throwing, on a refusal, an error, bad JSON, a bad shape or no network", async () => {
    const session = { code: "ABCDEF", token: "t" };
    const cases = [
      reply(403, { detail: "no" }),
      reply(502, {}),
      reply(200, { iceServers: [{ urls: ["http://evil.example"] }], ttl: 7200 }),
      reply(200, { iceServers: servers, ttl: 99999 }),
      reply(200, { iceServers: servers, ttl: 7200, extra: 1 }),
      vi.fn(async (_url: RequestInfo | URL) => new Response("not json", { status: 200 })),
      vi.fn(async (_url: RequestInfo | URL): Promise<Response> => {
        throw new TypeError("offline");
      }),
    ];
    for (const fetchImpl of cases) {
      expect(await fetchTurn("https://a", session, fetchImpl)).toEqual({
        ok: false,
        reason: "failed",
      });
    }
  });
});

describe("turnCache", () => {
  it("fetches once and reuses the credentials until 10 minutes before they expire", async () => {
    let t = 0;
    const fetchFresh = vi.fn(async () => good);
    const cache = turnCache(fetchFresh, () => t);
    expect(await cache.get("ROOM01")).toEqual(good);
    t = 2 * HOUR - RENEW_BEFORE_MS - 1;
    expect(await cache.get("ROOM01")).toEqual(good);
    expect(fetchFresh).toHaveBeenCalledTimes(1);
    t = 2 * HOUR - RENEW_BEFORE_MS; // time to renew
    await cache.get("ROOM01");
    expect(fetchFresh).toHaveBeenCalledTimes(2);
  });

  it("shares one request between calls made together", async () => {
    const fetchFresh = vi.fn(async () => good);
    const cache = turnCache(fetchFresh, () => 0);
    await Promise.all([cache.get("ROOM01"), cache.get("ROOM01"), cache.get("ROOM01")]);
    expect(fetchFresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the old credentials when a renewal fails while they still work", async () => {
    let t = 0;
    const fetchFresh = vi
      .fn<(code: string) => Promise<TurnResult>>()
      .mockResolvedValueOnce(good)
      .mockResolvedValue({ ok: false, reason: "failed" });
    const cache = turnCache(fetchFresh, () => t);
    await cache.get("ROOM01");
    t = 2 * HOUR - 5 * 60 * 1000; // inside the renewal window, not yet expired
    expect(await cache.get("ROOM01")).toEqual(good);
    t = 2 * HOUR; // expired: the failure shows
    expect(await cache.get("ROOM01")).toEqual({ ok: false, reason: "failed" });
  });

  it("does not cache a failure", async () => {
    const fetchFresh = vi
      .fn<(code: string) => Promise<TurnResult>>()
      .mockResolvedValueOnce({ ok: false, reason: "unavailable" })
      .mockResolvedValue(good);
    const cache = turnCache(fetchFresh, () => 0);
    expect(await cache.get("ROOM01")).toEqual({ ok: false, reason: "unavailable" });
    expect(await cache.get("ROOM01")).toEqual(good);
  });

  it("never gives one room's credentials to another, or after clear()", async () => {
    const fetchFresh = vi.fn(async (_code: string) => good);
    const cache = turnCache(fetchFresh, () => 0);
    await cache.get("ROOM01");
    await cache.get("ROOM02");
    expect(fetchFresh.mock.calls.map((c) => c[0])).toEqual(["ROOM01", "ROOM02"]);
    cache.clear();
    await cache.get("ROOM02");
    expect(fetchFresh).toHaveBeenCalledTimes(3);
  });

  it("keeps nothing from a request that was on its way when the room ended", async () => {
    let finish: (r: TurnResult) => void = () => {};
    const slow = new Promise<TurnResult>((resolve) => {
      finish = resolve;
    });
    const fetchFresh = vi.fn().mockReturnValueOnce(slow).mockResolvedValue(good);
    const cache = turnCache(fetchFresh, () => 0);
    const pending = cache.get("ROOM01");
    cache.clear();
    finish(good);
    await pending;
    await cache.get("ROOM01");
    expect(fetchFresh).toHaveBeenCalledTimes(2);
  });
});
