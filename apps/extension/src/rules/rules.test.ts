// @vitest-environment node
// Signed service rules (US-124): schema, signature, sequence, expiry and fallback. Keys are
// made fresh in each run; the committed public key is only checked against the committed file.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { BUNDLED_RULES, BUNDLED_SEQ } from "./bundled";
import { DEV_RULES_KEY } from "./public-key";
import { parseRulesFile, type RulesFile } from "./schema";
import { activeRules, CHECK_EVERY, parseState, RETRY_AFTER, refreshRules } from "./update";
import { MAX_RULES_BYTES, type Verdict, verifyRules } from "./verify";

const NOW = Date.parse("2026-10-20T00:00:00Z");
const DAY = 24 * 3600 * 1000;

const file = (seq: number, expires = "2026-11-20T00:00:00Z"): RulesFile => ({
  schema: 1,
  seq,
  expires,
  rules: { ...BUNDLED_RULES, filmMinSec: 240 },
});

const b64 = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(new Uint8Array(bytes)).toString("base64");
const bytesOf = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

async function keypair() {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  return {
    pair,
    publicKey: b64(await crypto.subtle.exportKey("raw", pair.publicKey)),
  };
}

async function sign(pair: CryptoKeyPair, body: Uint8Array<ArrayBuffer>) {
  return b64(await crypto.subtle.sign("Ed25519", pair.privateKey, body));
}

describe("schema", () => {
  test("accepts exactly the expected shape", () => {
    expect(parseRulesFile(file(3))).toEqual(file(3));
  });

  test("rejects unknown keys at every level", () => {
    const f = file(1);
    expect(parseRulesFile({ ...f, extra: 1 })).toBeNull();
    expect(parseRulesFile({ ...f, rules: { ...f.rules, code: "alert(1)" } })).toBeNull();
    const netflix = { ...f.rules.netflix, url: "x" };
    expect(parseRulesFile({ ...f, rules: { ...f.rules, netflix } })).toBeNull();
  });

  test("rejects missing keys, wrong types and out-of-range numbers", () => {
    const f = file(1);
    expect(parseRulesFile({ ...f, seq: "1" })).toBeNull();
    expect(parseRulesFile({ ...f, seq: 0 })).toBeNull();
    expect(parseRulesFile({ ...f, seq: 1.5 })).toBeNull();
    expect(parseRulesFile({ ...f, schema: 2 })).toBeNull();
    expect(parseRulesFile({ ...f, expires: "tomorrow" })).toBeNull();
    expect(parseRulesFile({ ...f, rules: { ...f.rules, filmMinSec: 5 } })).toBeNull();
    expect(
      parseRulesFile({ ...f, rules: { ...f.rules, jiohotstar: { driftToleranceSec: 60 } } }),
    ).toBeNull();
    expect(parseRulesFile({ ...f, rules: { filmMinSec: 300 } })).toBeNull();
    expect(parseRulesFile(null)).toBeNull();
    expect(parseRulesFile([])).toBeNull();
  });

  test("selectors are plain selector text: no URLs, braces, escapes or oversize", () => {
    const withTitle = (titleSelector: string) => ({
      ...file(1),
      rules: { ...BUNDLED_RULES, netflix: { ...BUNDLED_RULES.netflix, titleSelector } },
    });
    expect(parseRulesFile(withTitle('div > [data-uia="x"]:not(.y)'))).not.toBeNull();
    expect(parseRulesFile(withTitle("https://evil.example/x.js"))).toBeNull();
    expect(parseRulesFile(withTitle("a{color:red}"))).toBeNull();
    expect(parseRulesFile(withTitle("a\\62"))).toBeNull();
    expect(parseRulesFile(withTitle(""))).toBeNull();
    expect(parseRulesFile(withTitle("a".repeat(201)))).toBeNull();
  });

  test("a file signed before Netflix ad rules existed stays valid and gets the bundled ones", () => {
    const { ad: _ad, ...netflix } = BUNDLED_RULES.netflix;
    const old = { ...file(1), rules: { ...BUNDLED_RULES, netflix } };
    const parsed = parseRulesFile(old);
    expect(parsed).not.toBeNull();
    expect(parsed?.rules.netflix.ad).toBeUndefined();
    expect(activeRules(parsed, NOW).netflix.ad).toEqual(BUNDLED_RULES.netflix.ad);
  });

  test("Netflix ad rules are two plain selectors and nothing else", () => {
    const withAd = (ad: unknown) => ({
      ...file(1),
      rules: { ...BUNDLED_RULES, netflix: { ...BUNDLED_RULES.netflix, ad } },
    });
    const good = { containerSelector: "[data-uia='x']", timeSelector: ".t" };
    expect(parseRulesFile(withAd(good))).not.toBeNull();
    expect(parseRulesFile(withAd({ ...good, pattern: "^Ad$" }))).toBeNull();
    expect(parseRulesFile(withAd({ containerSelector: good.containerSelector }))).toBeNull();
    expect(parseRulesFile(withAd({ ...good, timeSelector: "a{x:y}" }))).toBeNull();
    expect(parseRulesFile(withAd(null))).toBeNull();
    expect(parseRulesFile(withAd("[data-uia='x']"))).toBeNull();
  });

  test("a file signed before the unavailable-title rules existed stays valid and gets the bundled ones", () => {
    const { unavailable: _u, ...rules } = BUNDLED_RULES;
    const parsed = parseRulesFile({ ...file(1), rules });
    expect(parsed).not.toBeNull();
    expect(parsed?.rules.unavailable).toBeUndefined();
    expect(activeRules(parsed, NOW).unavailable).toEqual(BUNDLED_RULES.unavailable);
  });

  test("unavailable-title rules are one plain selector per service and nothing else", () => {
    const withUnavailable = (unavailable: unknown) => ({
      ...file(1),
      rules: { ...BUNDLED_RULES, unavailable },
    });
    const good = { netflix: "[data-uia='x']", prime: ".y", jiohotstar: "[role='dialog'], .z" };
    expect(parseRulesFile(withUnavailable(good))?.rules.unavailable).toEqual(good);
    expect(parseRulesFile(withUnavailable({ ...good, pattern: "^no$" }))).toBeNull();
    expect(
      parseRulesFile(withUnavailable({ netflix: good.netflix, prime: good.prime })),
    ).toBeNull();
    expect(parseRulesFile(withUnavailable({ ...good, prime: "a{x:y}" }))).toBeNull();
    expect(parseRulesFile(withUnavailable({ ...good, netflix: "" }))).toBeNull();
    expect(parseRulesFile(withUnavailable({ ...good, jiohotstar: ["a"] }))).toBeNull();
    expect(parseRulesFile(withUnavailable(null))).toBeNull();
    expect(parseRulesFile(withUnavailable("[data-uia='x']"))).toBeNull();
  });

  test("the bundled unavailable-title selectors pass the schema's own rules", () => {
    expect(parseRulesFile(file(1))?.rules.unavailable).toEqual(BUNDLED_RULES.unavailable);
  });

  test("the page can also reject a selector that does not parse", () => {
    expect(parseRulesFile(file(1), () => false)).toBeNull();
    expect(parseRulesFile(file(1), () => true)).not.toBeNull();
  });
});

describe("verification", () => {
  const body = bytesOf(JSON.stringify(file(2)));

  test("a file signed by the key is accepted", async () => {
    const k = await keypair();
    const v = await verifyRules(body, await sign(k.pair, body), k.publicKey);
    expect(v).toEqual({ ok: true, file: file(2) });
  });

  test("a changed byte, another key or a bad signature is refused", async () => {
    const k = await keypair();
    const other = await keypair();
    const sig = await sign(k.pair, body);
    const tampered = bytesOf(JSON.stringify(file(2)).replace('"seq":2', '"seq":9'));
    expect(await verifyRules(tampered, sig, k.publicKey)).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(await verifyRules(body, sig, other.publicKey)).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(await verifyRules(body, "not base64!", k.publicKey)).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(await verifyRules(body, b64(new Uint8Array(10)), k.publicKey)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  test("signed but not valid rules is refused", async () => {
    const k = await keypair();
    for (const text of ["not json", JSON.stringify({ ...file(1), extra: true })]) {
      const b = bytesOf(text);
      expect(await verifyRules(b, await sign(k.pair, b), k.publicKey)).toEqual({
        ok: false,
        reason: "schema",
      });
    }
  });

  test("a file over the size cap is refused before anything is checked", async () => {
    const k = await keypair();
    const big = new Uint8Array(MAX_RULES_BYTES + 1);
    expect(await verifyRules(big, await sign(k.pair, big), k.publicKey)).toEqual({
      ok: false,
      reason: "size",
    });
  });

  test("a Chrome without Ed25519 refuses everything instead of trusting it", async () => {
    const k = await keypair();
    const noEd25519: SubtleCrypto = Object.assign(Object.create(crypto.subtle), {
      importKey: () => Promise.reject(new DOMException("unsupported", "NotSupportedError")),
    });
    expect(await verifyRules(body, await sign(k.pair, body), k.publicKey, noEd25519)).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(await verifyRules(body, "AAAA", k.publicKey, undefined)).toMatchObject({ ok: false });
  });

  test("the committed rules file verifies against the committed public key", async () => {
    const dir = new URL("../../../website/public/rules/", import.meta.url);
    const text = readFileSync(new URL("v1.json", dir));
    const sig = readFileSync(new URL("v1.json.sig", dir), "utf8");
    const v = await verifyRules(new Uint8Array(text), sig, DEV_RULES_KEY);
    expect(v.ok).toBe(true);
  });
});

describe("daily check", () => {
  /** In-memory storage and a scripted fetch. */
  function world(stored: unknown, verdicts: Array<Verdict | Error>) {
    let state: unknown = stored;
    let fetches = 0;
    const run = (now: number) =>
      refreshRules({
        now,
        load: async () => state,
        save: async (s) => {
          state = s;
        },
        fetchVerified: async () => {
          fetches += 1;
          const v = verdicts.shift();
          if (!v) throw new Error("unscripted fetch");
          if (v instanceof Error) throw v;
          return v;
        },
      });
    return { run, state: () => parseState(state), fetches: () => fetches };
  }
  const good = (f: RulesFile): Verdict => ({ ok: true, file: f });

  test("a newer signed file is stored and used without an update", async () => {
    const w = world(null, [good(file(1))]);
    expect(await w.run(NOW)).toBe("updated");
    expect(w.state()?.file?.seq).toBe(1);
    expect(activeRules(w.state()?.file ?? null, NOW)).toEqual(file(1).rules);
  });

  test("it asks at most once a day", async () => {
    const w = world(null, [good(file(1)), good(file(2))]);
    await w.run(NOW);
    expect(await w.run(NOW + DAY - 1)).toBe("skipped");
    expect(w.fetches()).toBe(1);
    expect(await w.run(NOW + DAY)).toBe("updated");
    expect(w.state()?.file?.seq).toBe(2);
  });

  test("a clock set far back does not freeze the schedule", async () => {
    const w = world({ nextCheckAt: NOW + 400 * DAY, file: null }, [good(file(1))]);
    expect(await w.run(NOW)).toBe("updated");
  });

  test("an older or equal sequence never replaces what we have", async () => {
    const w = world({ nextCheckAt: 0, file: file(5) }, [good(file(4)), good(file(5))]);
    expect(await w.run(NOW)).toBe("kept");
    expect(w.state()?.file?.seq).toBe(5);
    expect(await w.run(NOW + DAY)).toBe("kept");
    expect(w.state()?.file?.seq).toBe(5);
  });

  test("the sequence floor holds even after the stored file has expired", async () => {
    const expired = file(5, "2026-10-01T00:00:00Z");
    const w = world({ nextCheckAt: 0, file: expired }, [good(file(3))]);
    expect(await w.run(NOW)).toBe("kept");
    expect(activeRules(w.state()?.file ?? null, NOW)).toEqual(BUNDLED_RULES);
    expect(w.state()?.file?.seq).toBe(5);
  });

  test("an expired file is not taken, and a file at or below the bundled sequence either", async () => {
    const w = world(null, [good(file(2, "2026-10-19T00:00:00Z")), good(file(BUNDLED_SEQ))]);
    expect(await w.run(NOW)).toBe("kept");
    expect(w.state()?.file).toBeNull();
    expect(await w.run(NOW + DAY)).toBe("kept");
    expect(w.state()?.file).toBeNull();
  });

  test("a file that claims to last more than 90 days is not taken", async () => {
    const w = world(null, [good(file(2, "2099-01-01T00:00:00Z"))]);
    expect(await w.run(NOW)).toBe("kept");
    expect(w.state()?.file).toBeNull();
  });

  test("a bad signature or schema keeps the last good file and tries again in an hour", async () => {
    const w = world({ nextCheckAt: 0, file: file(2) }, [
      { ok: false, reason: "signature" },
      { ok: false, reason: "schema" },
    ]);
    expect(await w.run(NOW)).toBe("failed");
    expect(w.state()).toEqual({ nextCheckAt: NOW + RETRY_AFTER, file: file(2) });
    expect(await w.run(NOW + RETRY_AFTER - 1)).toBe("skipped");
    expect(await w.run(NOW + RETRY_AFTER)).toBe("failed");
    expect(w.state()?.file?.seq).toBe(2);
  });

  test("no network: the bundled rules work, and the stored ones stay", async () => {
    const w = world(null, [new Error("offline")]);
    expect(await w.run(NOW)).toBe("failed");
    expect(w.state()).toEqual({ nextCheckAt: NOW + RETRY_AFTER, file: null });
    expect(activeRules(w.state()?.file ?? null, NOW)).toEqual(BUNDLED_RULES);
  });

  test("a corrupt stored value is replaced by a fresh check", async () => {
    const w = world({ nextCheckAt: 0, file: { seq: "x" } }, [good(file(1))]);
    expect(await w.run(NOW)).toBe("updated");
  });

  test("a stored file stops counting when it expires", () => {
    expect(activeRules(file(1), NOW)).toEqual(file(1).rules);
    expect(activeRules(file(1), Date.parse("2026-11-20T00:00:00Z"))).toEqual(BUNDLED_RULES);
    expect(CHECK_EVERY).toBe(DAY);
  });
});
