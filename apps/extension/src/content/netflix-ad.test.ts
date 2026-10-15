// Netflix ads (US-126). Nobody has captured a real Netflix ad yet, so these run against a
// fixture reconstructed from what others recorded live (fixtures/netflix-ad-reconstructed.html)
// and a fake page bridge. The confident cases say "ad"; everything weaker says "unsure",
// which the adapter turns into the buffering wait.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { adPresenting } from "../page/netflix-ad";
import { adoptStoredRules } from "../rules/active";
import { BUNDLED_RULES } from "../rules/bundled";
import type { RulesFile } from "../rules/schema";
import { netflixAd, providerFor } from "./providers";

const fixture = readFileSync(
  path.join(import.meta.dirname, "fixtures/netflix-ad-reconstructed.html"),
  "utf8",
);
const doc = (html = fixture) => new DOMParser().parseFromString(html, "text/html");
const without = (selector: string) => {
  const d = doc();
  d.querySelector(selector)?.remove();
  return d;
};

describe("netflixAd on the reconstructed fixture", () => {
  test("player flag and badge with a countdown: an ad, with the time left", () => {
    expect(netflixAd(doc(), true)).toEqual({ left: 15 });
  });

  test("no flag to read: a badge with a countdown is still an ad", () => {
    expect(netflixAd(doc(), null)).toEqual({ left: 15 });
  });

  test("the flag alone is an ad; the time is unknown without the badge", () => {
    expect(netflixAd(without('[data-uia="ads-info-container"]'), true)).toEqual({ left: null });
  });

  test("no flag and no badge: no ad", () => {
    expect(netflixAd(without('[data-uia="ads-info-container"]'), null)).toBeNull();
    expect(netflixAd(without('[data-uia="ads-info-container"]'), false)).toBeNull();
  });

  test("a badge with no countdown is not sure enough to say ad", () => {
    expect(netflixAd(without('[data-uia="ads-info-time"]'), null)).toBe("unsure");
  });

  test("a countdown that isn't a time is not sure enough either", () => {
    const d = doc();
    const time = d.querySelector('[data-uia="ads-info-time"]');
    if (time) time.textContent = "soon";
    expect(netflixAd(d, null)).toBe("unsure");
  });

  test("the player says no ad while the badge shows: unsure, not an ad", () => {
    expect(netflixAd(doc(), false)).toBe("unsure");
  });

  test("a badge the page has hidden is not an ad", () => {
    const d = doc();
    const box = d.querySelector('[data-uia="ads-info-container"]');
    if (!box) throw new Error("missing badge");
    Object.defineProperty(box, "checkVisibility", { value: () => false, configurable: true });
    expect(netflixAd(d, null)).toBeNull();
  });

  test("pause-screen ads are not ad breaks", () => {
    const d = doc(
      `<div data-uia="pause-ad-title-display">Sponsored</div><button data-uia="pause-ad-expand-button"></button>`,
    );
    expect(netflixAd(d, null)).toBeNull();
    expect(netflixAd(d, false)).toBeNull();
  });
});

describe("adPresenting reads only the player's ad flag", () => {
  const withFlag = (value: unknown) => ({
    getAdManager: () => ({ adPresenting: { _value: value } }),
  });

  test("true and false pass through", () => {
    expect(adPresenting(withFlag(true))).toBe(true);
    expect(adPresenting(withFlag(false))).toBe(false);
  });

  test.each([
    ["no player", null],
    ["no ad manager", {}],
    ["an ad manager without the flag", { getAdManager: () => ({}) }],
    ["a flag that isn't a boolean", withFlag("yes")],
    [
      "an ad manager that throws",
      {
        getAdManager: () => {
          throw new Error("changed");
        },
      },
    ],
  ])("%s: unknown, never 'no ad'", (_name, player) => {
    expect(adPresenting(player)).toBeNull();
  });
});

describe("the live Netflix adapter", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  /** Plays the page bridge: answers the adapter's "ad" question with `flag`. */
  function bridge(flag: boolean | null) {
    const onCommand = (e: Event) => {
      const { id, action } = JSON.parse((e as CustomEvent<string>).detail);
      if (action !== "ad") return;
      document.dispatchEvent(
        new CustomEvent("watchsync:netflix-result", {
          detail: JSON.stringify({ id, ok: flag !== null, ad: flag }),
        }),
      );
    };
    document.addEventListener("watchsync:netflix-command", onCommand);
    return () => document.removeEventListener("watchsync:netflix-command", onCommand);
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test("the player's flag makes the room wait for an ad, with no badge in the page", async () => {
    const stop = bridge(true);
    const p = providerFor("www.netflix.com");
    if (!p) throw new Error("no provider");
    expect(p.ad()).toBeNull(); // nothing read yet: the first question is on its way
    await settle();
    expect(p.ad()).toEqual({ left: null });
    stop();
  });

  test("the flag going false ends the wait", async () => {
    const stop = bridge(false);
    const p = providerFor("www.netflix.com");
    if (!p) throw new Error("no provider");
    p.ad();
    await settle();
    expect(p.ad()).toBeNull();
    stop();
  });

  test("a badge with no countdown and no flag: buffering wait, never an ad", async () => {
    document.body.innerHTML = `<div data-uia="ads-info-container"><span data-uia="ads-info-text">Ad</span></div><video></video>`;
    const video = document.querySelector("video");
    if (!video) throw new Error("missing video");
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    Object.defineProperty(video, "readyState", { value: 4, configurable: true });
    const stop = bridge(null);
    const p = providerFor("www.netflix.com");
    if (!p) throw new Error("no provider");
    await settle();
    expect(p.ad()).toBeNull();
    expect(p.stalled()).toBe(true);
    stop();
  });
});

describe("a rules file fixes stale Netflix markers", () => {
  const html = `<div class="x-ad-box"><span class="x-ad-clock">0:20</span></div>`;

  test("the old selectors miss the new markup until a signed file names the new ones", async () => {
    expect(netflixAd(doc(html), null)).toBeNull();
    const file: RulesFile = {
      schema: 1,
      seq: 2,
      expires: new Date(Date.now() + 30 * 864e5).toISOString().replace(/\.\d+Z$/, "Z"),
      rules: {
        ...BUNDLED_RULES,
        netflix: {
          ...BUNDLED_RULES.netflix,
          ad: { containerSelector: ".x-ad-box", timeSelector: ".x-ad-clock" },
        },
      },
    };
    vi.stubGlobal("chrome", {
      storage: { local: { get: async () => ({ rules: { nextCheckAt: 0, file } }) } },
    });
    await adoptStoredRules();
    try {
      expect(netflixAd(doc(html), null)).toEqual({ left: 20 });
    } finally {
      vi.stubGlobal("chrome", {
        storage: { local: { get: async () => ({}) } },
      });
      await adoptStoredRules();
    }
    expect(netflixAd(doc(html), null)).toBeNull();
  });
});
