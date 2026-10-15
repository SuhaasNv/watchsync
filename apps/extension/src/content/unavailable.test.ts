// "You can't play this here" (US-128): read only from the page the person already has open.
// Netflix's fixture is the real public 404 page; Prime's and Hotstar's are reconstructed from
// each service's own player files and string tables (see the notes inside each fixture).
// Anything unsure must say nothing, so most cases below are things that must NOT be flagged.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { adoptStoredRules } from "../rules/active";
import { BUNDLED_RULES } from "../rules/bundled";
import type { RulesFile } from "../rules/schema";
import { netflixLostTitle, providerFor, regionRefusal } from "./providers";

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const hide = (el: Element | null) => {
  if (!el) throw new Error("missing element");
  Object.defineProperty(el, "checkVisibility", { value: () => false, configurable: true });
};
const { netflix, prime, jiohotstar } = BUNDLED_RULES.unavailable;

describe("Netflix: the page a title it won't open here lands on", () => {
  const page = () => doc(fixture("netflix-unavailable-public-404.html"));
  const url = (p: string) => new URL(`https://www.netflix.com${p}`);

  test("the 404 page on a title address names the title", () => {
    expect(netflixLostTitle(url("/title/999999999?fromWatch=true"), page())).toEqual({
      service: "netflix",
      titleId: "999999999",
      titleName: null,
      titleUrl: "https://www.netflix.com/watch/999999999",
    });
    // With a country in the address, as signed-in people see it.
    expect(netflixLostTitle(url("/sg/title/80100172"), page())?.titleId).toBe("80100172");
    expect(netflixLostTitle(url("/en-gb/title/80100172"), page())?.titleId).toBe("80100172");
  });

  test.each([
    ["the browse page", "/browse"],
    ["a watch address (the player, not the 404)", "/watch/80100172"],
    ["a made-up address", "/title/abc"],
    ["a title with more path", "/title/80100172/extra"],
  ])("%s: not a lost title", (_name, p) => {
    expect(netflixLostTitle(url(p), page())).toBeNull();
  });

  test("a title page that loaded fine is not flagged", () => {
    const ok = doc(`<div data-uia="title-details"><h1>Dark</h1></div>`);
    expect(netflixLostTitle(url("/title/80100172"), ok)).toBeNull();
  });

  test("a 404 marker the page has hidden is not flagged", () => {
    const d = page();
    hide(d.querySelector('[data-uia="page-404"]'));
    expect(netflixLostTitle(url("/title/999999999"), d)).toBeNull();
  });
});

describe("Prime Video: the player's error modal", () => {
  const modal = (title: string, description: string) =>
    doc(
      `<div class="m"><div class="atvwebplayersdk-video-unavailable-error t">${title}</div><div class="d">${description}</div></div>`,
    );

  test("the reconstructed region refusal is flagged", () => {
    expect(regionRefusal(doc(fixture("prime-unavailable-reconstructed.html")), prime, true)).toBe(
      true,
    );
  });

  test("the title alone or the description alone is enough", () => {
    expect(regionRefusal(modal("Service Area Restriction", ""), prime, true)).toBe(true);
    expect(
      regionRefusal(
        modal("Video Unavailable", "This video isn't available due to geographical licensing."),
        prime,
        true,
      ),
    ).toBe(true);
  });

  test.each([
    ["a playback problem", "Video Unavailable", "We're experiencing a problem playing this video."],
    [
      "no rental or purchase",
      "Video Unavailable",
      "You don't own this video or have an active rental.",
    ],
    ["a lost connection", "Internet connection error", "An Internet connection is required."],
    ["a VPN refusal", "HTTP proxies and VPN connections not allowed", "Please disable any VPN."],
    ["too many streams", "Maximum Streams Playing", "The maximum number of videos is playing."],
  ])("%s is not a region refusal", (_name, title, description) => {
    expect(regionRefusal(modal(title, description), prime, true)).toBe(false);
  });

  test("the words without the modal's marker say nothing", () => {
    const d = doc(`<p>Service Area Restriction: this video isn't available</p>`);
    expect(regionRefusal(d, prime, true)).toBe(false);
  });

  test("a modal the page has hidden says nothing", () => {
    const d = modal("Service Area Restriction", "");
    hide(d.querySelector(".atvwebplayersdk-video-unavailable-error"));
    expect(regionRefusal(d, prime, true)).toBe(false);
  });
});

describe("JioHotstar: the region screen", () => {
  test("the reconstructed screen is flagged", () => {
    expect(
      regionRefusal(doc(fixture("jiohotstar-unavailable-reconstructed.html")), jiohotstar, false),
    ).toBe(true);
  });

  test("Hotstar's own string table, sitting in a script, is not a screen", () => {
    // The real page inlines these words in its page data on every load.
    const d = doc(
      `<div id="__next"><div role="dialog">Welcome</div></div><script id="__NEXT_DATA__">{"m":"This content is currently not available in your region. Please select another content."}</script>`,
    );
    expect(regionRefusal(d, jiohotstar, false)).toBe(false);
  });

  test.each([
    ["a network error", "Unable to connect. Please check your internet connection."],
    ["a generic failure", "Something went wrong. Please try again later."],
    ["a subscription wall", "This content is not available with your current subscriptions."],
    ["an unrelated alert", "Added to watchlist"],
  ])("%s says nothing", (_name, text) => {
    expect(regionRefusal(doc(`<div role="alert">${text}</div>`), jiohotstar, false)).toBe(false);
  });

  test("a page-sized wrapper that happens to hold the words says nothing", () => {
    const d = doc(
      `<div data-testid="error-boundary">${"x ".repeat(2000)} not available in your region</div>`,
    );
    expect(regionRefusal(d, jiohotstar, false)).toBe(false);
  });

  test("the words in a dialog the page has hidden say nothing", () => {
    const d = doc(`<div role="dialog">Content not available in your region</div>`);
    hide(d.querySelector("[role=dialog]"));
    expect(regionRefusal(d, jiohotstar, false)).toBe(false);
  });
});

describe("the live adapters", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    history.replaceState({}, "", "/");
    vi.unstubAllGlobals();
  });

  const adapter = (host: string) => {
    const p = providerFor(host);
    if (!p) throw new Error("no provider");
    return p;
  };

  test("Netflix reports the lost title as the one open, and as unavailable", () => {
    const p = adapter("www.netflix.com");
    expect(p.unavailable()).toBe(false);
    history.replaceState({}, "", "/title/999999999?fromWatch=true");
    document.body.innerHTML = fixture("netflix-unavailable-public-404.html").replace(
      /^[\s\S]*<body>|<\/body>[\s\S]*$/g,
      "",
    );
    expect(p.unavailable()).toBe(true);
    expect(p.media()).toMatchObject({ service: "netflix", titleId: "999999999" });
  });

  test("Prime counts the title as open while its error modal shows, and as unavailable", () => {
    const p = adapter("www.primevideo.com");
    history.replaceState({}, "", "/detail/0ABC123");
    expect(p.media()).toBeNull(); // browsing: no player open
    expect(p.unavailable()).toBe(false);
    document.body.innerHTML = `<div><div class="atvwebplayersdk-video-unavailable-error">Service Area Restriction</div></div>`;
    expect(p.unavailable()).toBe(true);
    expect(p.media()?.titleId).toBe("0ABC123");
  });

  test("Hotstar reports a region screen on its watch address", () => {
    const p = adapter("www.jiohotstar.com");
    history.replaceState({}, "", "/in/shows/panchayat/1260123456/watch");
    expect(p.unavailable()).toBe(false);
    document.body.innerHTML = `<div role="dialog">Content not available. This content is currently not available in your region.</div>`;
    expect(p.unavailable()).toBe(true);
    expect(p.media()?.titleId).toBe("1260123456");
  });

  test("a rules file fixes a stale marker without an extension update", async () => {
    const p = adapter("www.primevideo.com");
    document.body.innerHTML = `<div><div class="prime-error-title-v2">Service Area Restriction</div></div>`;
    expect(p.unavailable()).toBe(false); // the page renamed its marker
    const file: RulesFile = {
      schema: 1,
      seq: 3,
      expires: new Date(Date.now() + 30 * 864e5).toISOString().replace(/\.\d+Z$/, "Z"),
      rules: {
        ...BUNDLED_RULES,
        unavailable: { netflix, prime: ".prime-error-title-v2", jiohotstar },
      },
    };
    vi.stubGlobal("chrome", {
      storage: { local: { get: async () => ({ rules: { nextCheckAt: 0, file } }) } },
    });
    try {
      await adoptStoredRules();
      expect(p.unavailable()).toBe(true);
    } finally {
      vi.stubGlobal("chrome", { storage: { local: { get: async () => ({}) } } });
      await adoptStoredRules();
    }
    expect(p.unavailable()).toBe(false);
  });
});
