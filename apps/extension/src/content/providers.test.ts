import type { Media } from "@watchsync/protocol";
import { expect, test } from "vitest";
import { align } from "./align";
import { mainVideo, netflixMedia } from "./providers";

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
