import type { Media } from "@watchsync/protocol";
import { expect, test } from "vitest";
import { align } from "./align";
import { clock } from "./playback";
import { hotstarMedia, mainVideo, netflixMedia, primeAd, primeMedia } from "./providers";

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

// Shapes from the UC-002 desk research; replace with live captures during the DEC-019 checks.
const PRIME_PLAYER = `<div class="atvwebplayersdk-title-text">The Boys</div>
  <div class="atvwebplayersdk-subtitle-text">Season 1, Ep. 3 Get Some</div>`;

test("prime reads the title from the URL and the episode from the player", () => {
  const m = primeMedia(
    new URL("https://www.primevideo.com/detail/0KRGHGZCHKS920ZQGY5LBRF7MA/ref=x?autoplay=1"),
    doc(PRIME_PLAYER),
  );
  expect(m).toEqual({
    service: "prime",
    titleId: "0KRGHGZCHKS920ZQGY5LBRF7MA:Season 1, Ep. 3 Get Some",
    titleName: "The Boys, Season 1, Ep. 3 Get Some",
    titleUrl: "https://www.primevideo.com/detail/0KRGHGZCHKS920ZQGY5LBRF7MA",
  });
});

test("prime on amazon.in keeps the gp/video path, and browsing isn't watching", () => {
  const m = primeMedia(
    new URL("https://www.amazon.in/gp/video/detail/B0ABC12345"),
    doc(PRIME_PLAYER),
  );
  expect(m?.titleUrl).toBe("https://www.amazon.in/gp/video/detail/B0ABC12345");
  expect(primeMedia(new URL("https://www.primevideo.com/detail/X1"), doc(""))).toBeNull();
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
