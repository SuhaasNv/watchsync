// Ad detection (UC-042): the parts of the adapters that tell the room someone is on an ad.
// Nobody on the team can trigger a real ad on demand, so these pin the behaviour down
// against DOM fixtures.
import { describe, expect, test } from "vitest";
import { adSeconds, longestVideo, primeAd, separateAd } from "./providers";

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");

type VideoProps = Partial<
  Record<"paused" | "duration" | "currentTime" | "readyState" | "clientWidth", number | boolean>
>;

/** jsdom has no media pipeline: give a <video> the state a real player would report. */
function set(v: Element | null | undefined, props: VideoProps) {
  if (!v) throw new Error("missing video");
  for (const [k, value] of Object.entries(props))
    Object.defineProperty(v, k, { value, configurable: true });
}

/** A page with the given videos, each set up as described, in document order. */
function page(...videos: VideoProps[]) {
  const d = doc(videos.map((_, i) => `<video id="v${i}"></video>`).join(""));
  const els = [...d.querySelectorAll("video")];
  videos.forEach((props, i) => {
    set(els[i], props);
  });
  return { d, els };
}

const FILM = { readyState: 4, duration: 6000, currentTime: 1200, clientWidth: 1280 };
const AD = { readyState: 4, duration: 30, currentTime: 12, clientWidth: 1280 };

describe("adSeconds", () => {
  test.each([
    ["Ad 0:20", 20],
    ["Ad · 1:05 left", 65],
    ["Ad 1 of 2 · 0:25", 25],
    ["0:07", 7],
    ["Ad 1:05:00", 3900],
  ])("%s → %i s", (text, seconds) => {
    expect(adSeconds(text)).toBe(seconds);
  });

  test.each([["Ad"], ["Ad 5s"], ["Ad 1:5"], [""], [null], [undefined]])(
    "%s has no time",
    (text) => {
      expect(adSeconds(text)).toBeNull();
    },
  );
});

describe("primeAd", () => {
  // Prime's player markup from the UC-002 desk research (docs/spikes/player-control.md),
  // not captured from a live account. BUG-015 found the live player now uses generated
  // class names, so this selector may no longer match; separateAd is the fallback.
  const player = (overlay: string) =>
    doc(`<div class="atvwebplayersdk-overlays-container">
      <div class="atvwebplayersdk-title-text">Vaarasudu</div>
      ${overlay}
      <video></video>
    </div>`);

  test("the ad countdown gives the time left", () => {
    const d = player(
      `<div class="atvwebplayersdk-ad-timer"><span>Ad</span> <span>1:05</span></div>`,
    );
    expect(primeAd(d)).toEqual({ left: 65 });
  });

  test("an ad label without a time is still an ad", () => {
    expect(primeAd(player(`<div class="atvwebplayersdk-ad-timer">Ad</div>`))).toEqual({
      left: null,
    });
  });

  test("no countdown in the player: no ad", () => {
    expect(primeAd(player(""))).toBeNull();
  });

  test("a countdown the player has hidden is not an ad", () => {
    const d = player(`<div class="atvwebplayersdk-ad-timer">Ad 0:00</div>`);
    const el = d.querySelector(".atvwebplayersdk-ad-timer");
    if (!el) throw new Error("missing timer");
    Object.defineProperty(el, "checkVisibility", { value: () => false, configurable: true });
    expect(primeAd(d)).toBeNull();
  });
});

describe("longestVideo", () => {
  test("picks the film over shorter videos, whatever the order", () => {
    const { d, els } = page({ ...AD }, FILM, { readyState: 4, duration: 299 });
    expect(longestVideo(d)).toBe(els[1]);
  });

  test("ignores videos without metadata", () => {
    const { d } = page({ readyState: 0, duration: 6000 });
    expect(longestVideo(d)).toBeNull();
  });

  test("ignores anything 5 minutes or shorter", () => {
    expect(longestVideo(page({ readyState: 4, duration: 300 }).d)).toBeNull();
    expect(longestVideo(page({ readyState: 4, duration: 301 }).d)).not.toBeNull();
  });

  test("ignores live and unknown durations", () => {
    const { d } = page({ readyState: 4, duration: Infinity }, { readyState: 4, duration: NaN });
    expect(longestVideo(d)).toBeNull();
  });
});

describe("separateAd (BUG-020 heuristic)", () => {
  test("film paused while a short video plays: an ad, with the time left", () => {
    const { d } = page({ ...FILM, paused: true }, { ...AD, paused: false });
    expect(separateAd(d)).toEqual({ left: 18 });
  });

  test("the time left is never negative", () => {
    const { d } = page({ ...FILM, paused: true }, { ...AD, currentTime: 31, paused: false });
    expect(separateAd(d)).toEqual({ left: 0 });
  });

  test("film playing: a short video is a preview, not an ad", () => {
    const { d } = page({ ...FILM, paused: false }, { ...AD, paused: false });
    expect(separateAd(d)).toBeNull();
  });

  test("film paused with the short video paused too: the person paused, no ad", () => {
    const { d } = page({ ...FILM, paused: true }, { ...AD, paused: true });
    expect(separateAd(d)).toBeNull();
  });

  test("a detail page with only a trailer has no film, so no ad", () => {
    const { d } = page({ ...AD, duration: 140, paused: false });
    expect(separateAd(d)).toBeNull();
  });

  test("a trailer playing next to a film that hasn't loaded is not an ad", () => {
    const { d } = page({ ...FILM, readyState: 0, paused: true }, { ...AD, paused: false });
    expect(separateAd(d)).toBeNull();
  });

  test("two short videos: the one playing is the ad", () => {
    const { d } = page(
      { ...FILM, paused: true },
      { ...AD, duration: 15, currentTime: 0, paused: true },
      { ...AD, duration: 20, currentTime: 5, paused: false },
    );
    expect(separateAd(d)).toEqual({ left: 15 });
  });

  test("a short video that isn't on screen is not an ad", () => {
    const { d } = page({ ...FILM, paused: true }, { ...AD, clientWidth: 0, paused: false });
    expect(separateAd(d)).toBeNull();
  });

  test("live or unknown durations are never taken for an ad", () => {
    const live = page({ ...FILM, paused: true }, { ...AD, duration: Infinity, paused: false });
    expect(separateAd(live.d)).toBeNull();
    const unknown = page({ ...FILM, paused: true }, { ...AD, duration: NaN, paused: false });
    expect(separateAd(unknown.d)).toBeNull();
  });

  test("a live film has no length, so nothing next to it reads as an ad", () => {
    const { d } = page({ ...FILM, duration: Infinity, paused: true }, { ...AD, paused: false });
    expect(separateAd(d)).toBeNull();
  });
});
