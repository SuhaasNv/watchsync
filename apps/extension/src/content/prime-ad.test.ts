// Prime Video ads (US-127): the live adapter's ad marker, and a rules file fixing a stale one.
// Prime's ad markers have not been confirmed on a live player by the team (owner-pending); these
// run against markup built from the spike's research and from what a third-party extension
// reads on live players (.atvwebplayersdk-ad-timer-remaining-time, -adtimeindicator-text).
import { afterEach, describe, expect, test, vi } from "vitest";
import { adoptStoredRules } from "../rules/active";
import { BUNDLED_RULES } from "../rules/bundled";
import type { RulesFile } from "../rules/schema";
import { primeAd, providerFor } from "./providers";

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("primeAd with the bundled markers", () => {
  test.each([
    ["the spike's timer", `<div class="atvwebplayersdk-ad-timer">Ad 0:25</div>`],
    [
      "the fullscreen player's remaining time",
      `<div class="dv-player-fullscreen"><span class="atvwebplayersdk-ad-timer-remaining-time">Ad 0:25</span></div>`,
    ],
    ["Prime's own promo ad", `<div class="atvwebplayersdk-adtimeindicator-text">Ad 0:25</div>`],
  ])("%s gives the time left", (_name, html) => {
    expect(primeAd(doc(html))).toEqual({ left: 25 });
  });

  test("a remaining-time outside the fullscreen player is not taken", () => {
    expect(
      primeAd(doc(`<span class="atvwebplayersdk-ad-timer-remaining-time">Ad 0:25</span>`)),
    ).toBeNull();
  });

  test("an empty or hidden first match doesn't hide a shown second one", () => {
    const d = doc(
      `<div class="atvwebplayersdk-ad-timer"> </div><div class="atvwebplayersdk-adtimeindicator-text">Ad 0:08</div>`,
    );
    expect(primeAd(d)).toEqual({ left: 8 });
  });

  test("the film's own clock is not an ad", () => {
    expect(primeAd(doc(`<div class="atvwebplayersdk-timeindicator">1:02:05</div>`))).toBeNull();
  });
});

describe("Prime's live provider", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  const prime = () => {
    const p = providerFor("www.primevideo.com");
    if (!p) throw new Error("no provider");
    return p;
  };

  test("reports an ad from the page's marker, and none without it", () => {
    expect(prime().ad()).toBeNull();
    document.body.innerHTML = `<div class="atvwebplayersdk-ad-timer"><span>Ad</span> <span>0:30</span></div>`;
    expect(prime().ad()).toEqual({ left: 30 });
  });

  test("a rules file fixes a stale marker without an extension update", async () => {
    const p = prime(); // made before the rules change, like the one running in a tab
    document.body.innerHTML = `<div class="prime-ad-clock-v2">Ad 0:12</div>`;
    expect(p.ad()).toBeNull(); // the page changed its markup: the bundled marker is stale
    const file: RulesFile = {
      schema: 1,
      seq: 2,
      expires: new Date(Date.now() + 30 * 864e5).toISOString().replace(/\.\d+Z$/, "Z"),
      rules: {
        ...BUNDLED_RULES,
        prime: { ...BUNDLED_RULES.prime, adTimerSelector: ".prime-ad-clock-v2" },
      },
    };
    vi.stubGlobal("chrome", {
      storage: { local: { get: async () => ({ rules: { nextCheckAt: 0, file } }) } },
    });
    try {
      await adoptStoredRules();
      expect(p.ad()).toEqual({ left: 12 });
    } finally {
      vi.stubGlobal("chrome", { storage: { local: { get: async () => ({}) } } });
      await adoptStoredRules();
    }
    expect(p.ad()).toBeNull();
  });
});
