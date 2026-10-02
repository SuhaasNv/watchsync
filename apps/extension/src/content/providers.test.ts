import type { Media } from "@watchsync/protocol";
import { expect, test } from "vitest";
import { align } from "./align";
import { clock } from "./playback";
import {
  capName,
  hotstarMedia,
  longestVideo,
  mainVideo,
  netflixMedia,
  primeAd,
  primeMedia,
  separateAd,
} from "./providers";

// Shape of Netflix's title overlay from the UC-002 desk research, not yet captured from a
// live account. Replace with a real capture during the DEC-019 confirm checks.
const NETFLIX_TITLE = `<div data-uia="video-title"><h4>Dark</h4><span>S1:E3</span><span>Past and Present</span></div>`;

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");

test("netflix reads the episode ID from the URL and the name from the overlay", () => {
  const m = netflixMedia(
    new URL("https://www.netflix.com/watch/80100172?trackId=1"),
    doc(NETFLIX_TITLE),
    null,
  );
  expect(m).toEqual({
    service: "netflix",
    titleId: "80100172",
    titleName: "Dark, S1:E3, Past and Present",
    titleUrl: "https://www.netflix.com/watch/80100172",
  });
});

test("netflix keeps the last name while the controls are hidden", () => {
  const m = netflixMedia(new URL("https://www.netflix.com/watch/1"), doc(""), "Dark, S1:E3");
  expect(m?.titleName).toBe("Dark, S1:E3");
});

test("netflix pages without /watch are not a title", () => {
  expect(
    netflixMedia(new URL("https://www.netflix.com/browse"), doc(NETFLIX_TITLE), null),
  ).toBeNull();
});

test("mainVideo skips elements with no data", () => {
  const d = doc("<video></video>");
  expect(mainVideo(d)).toBeNull();
});

const ep = (id: string): Media => ({
  service: "netflix",
  titleId: id,
  titleName: `Dark ${id}`,
  titleUrl: `https://www.netflix.com/watch/${id}`,
});

test("align follows the room to the next episode only for someone who was with it", () => {
  expect(align(ep("1"), ep("2"), ep("1"), true)).toEqual({ kind: "follow", url: ep("2").titleUrl });
  expect(align(ep("1"), ep("2"), ep("1"), false).kind).toBe("prompt");
  expect(align(ep("1"), ep("2"), ep("7"), true).kind).toBe("prompt");
  expect(align(null, ep("2"), null, true).kind).toBe("prompt");
  expect(align(ep("1"), ep("2"), ep("2"), true).kind).toBe("none");
  // The room moved to another service (Netflix to Prime Video): ask, never navigate away.
  const prime: Media = {
    service: "prime",
    titleId: "B0ABC12345",
    titleName: "Vaarasudu",
    titleUrl: "https://www.amazon.in/gp/video/detail/B0ABC12345",
  };
  expect(align(ep("1"), prime, ep("1"), true)).toEqual({ kind: "prompt", url: prime.titleUrl });
  expect(align(null, { ...ep("2"), titleUrl: "https://evil.example/" }, null, true).kind).toBe(
    "none",
  );
});

test("clock formats notice times", () => {
  expect(clock(2530)).toBe("42:10");
  expect(clock(62)).toBe("1:02");
  expect(clock(3723)).toBe("1:02:03");
  expect(clock(-3)).toBe("0:00");
});

test("prime reads the title from the page title and the ID from the URL (BUG-015)", () => {
  const d = doc("");
  d.title = "Prime Video: Vaarasudu";
  const url = new URL(
    "https://www.primevideo.com/region/eu/detail/0TQV0X9RJF64O24RIRD1BHH37H?ref_=x",
  );
  expect(primeMedia(url, d, true)).toEqual({
    service: "prime",
    titleId: "0TQV0X9RJF64O24RIRD1BHH37H",
    titleName: "Vaarasudu",
    titleUrl: "https://www.primevideo.com/detail/0TQV0X9RJF64O24RIRD1BHH37H",
  });
  // Detail page with only the trailer: not watching yet.
  expect(primeMedia(url, d, false)).toBeNull();
});

test("prime on amazon.in keeps the gp/video path and cleans the store title", () => {
  const d = doc("");
  d.title = "Amazon.in: Watch Vaarasudu | Prime Video";
  const m = primeMedia(new URL("https://www.amazon.in/gp/video/detail/B0ABC12345"), d, true);
  expect(m?.titleUrl).toBe("https://www.amazon.in/gp/video/detail/B0ABC12345");
  expect(m?.titleName).toBe("Vaarasudu");
});

test("prime picks the film, not the detail page's trailer", () => {
  const d = doc("<video id=trailer></video><video id=film></video>");
  const [trailer, film] = [...d.querySelectorAll("video")];
  for (const [v, duration] of [
    [trailer, 101],
    [film, 10146],
  ] as const) {
    Object.defineProperty(v, "readyState", { value: 4 });
    Object.defineProperty(v, "duration", { value: duration, configurable: true });
  }
  expect(longestVideo(d)?.id).toBe("film");
  Object.defineProperty(film, "duration", { value: 90 });
  expect(longestVideo(d)).toBeNull();
});

test("prime ad timer gives the time left", () => {
  expect(primeAd(doc(`<span class="atvwebplayersdk-ad-timer">Ad 0:25</span>`))).toEqual({
    left: 25,
  });
  expect(primeAd(doc(""))).toBeNull();
});

test("jiohotstar reads the content ID and a clean title", () => {
  const d = doc("");
  d.title = "Panchayat S3 E2 - Watch on JioHotstar";
  const m = hotstarMedia(
    new URL("https://www.jiohotstar.com/in/shows/panchayat/1260123456/watch?x=1"),
    d,
  );
  expect(m).toEqual({
    service: "jiohotstar",
    titleId: "1260123456",
    titleName: "Panchayat S3 E2",
    titleUrl: "https://www.jiohotstar.com/in/shows/panchayat/1260123456/watch",
  });
  expect(hotstarMedia(new URL("https://www.jiohotstar.com/in/home"), d)).toBeNull();
});

test("an ad in its own short video counts as an ad only while the film waits (BUG-020)", () => {
  const d = doc("<video id=film></video><video id=ad></video>");
  const [film, ad] = [...d.querySelectorAll("video")];
  const set = (v: Element | undefined, props: Record<string, number | boolean>) => {
    if (!v) throw new Error("missing video");
    for (const [k, value] of Object.entries(props))
      Object.defineProperty(v, k, { value, configurable: true });
  };
  set(film, { readyState: 4, duration: 6000, paused: true, clientWidth: 1280 });
  set(ad, { readyState: 4, duration: 30, currentTime: 12, paused: false, clientWidth: 1280 });
  expect(separateAd(d)).toEqual({ left: 18 });
  set(film, { paused: false });
  expect(separateAd(d)).toBeNull(); // film playing: a short video is a preview, not an ad
  set(film, { duration: 100, paused: true });
  expect(separateAd(d)).toBeNull(); // no film loaded (detail page trailer)
});

test("title names over 200 characters are cut, not refused by the room", () => {
  const long = {
    service: "netflix",
    titleId: "1",
    titleName: "x".repeat(250),
    titleUrl: null,
  } as const;
  const name = capName(long)?.titleName ?? "";
  expect([...name].length).toBe(200);
  expect(name.endsWith("…")).toBe(true);
  expect(capName({ ...long, titleName: "Dune" })?.titleName).toBe("Dune");
});

test("prime never takes its storefront page title for the show's name (BUG-054)", () => {
  const url = new URL("https://www.amazon.in/gp/video/detail/B0REACHER1");
  const d = doc("");
  d.title = "Prime Video: Watch movies, TV shows, sports, and live TV";
  // No real name anywhere yet: the title goes out without one, the room fills it in later.
  expect(primeMedia(url, d, true)?.titleName).toBeNull();
  // The player's own title wins over the page title.
  const player = doc(`<div class="atvwebplayersdk-title-text">Reacher</div>
    <div class="atvwebplayersdk-subtitle-text">Season 3, Ep. 1</div>`);
  player.title = d.title;
  expect(primeMedia(url, player, true)?.titleName).toBe("Reacher, Season 3, Ep. 1");
  // Then the detail page's heading, then og:title.
  const detail = doc(`<h1 data-automation-id="title">Reacher</h1>`);
  detail.title = d.title;
  expect(primeMedia(url, detail, true)?.titleName).toBe("Reacher");
  const og = doc(`<meta property="og:title" content="Watch Reacher - Season 3 | Prime Video">`);
  og.title = d.title;
  expect(primeMedia(url, og, true)?.titleName).toBe("Reacher - Season 3");
});
