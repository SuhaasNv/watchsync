// Ads (UC-042): the room waits while someone is on an ad and resumes everyone together.
// Real ads can't be triggered on demand, so the mock player stands in: a [data-ad] marker
// with a countdown (as Prime shows), or an ad in its own short <video> while the film
// waits (the JioHotstar heuristic, BUG-020).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Page, Route } from "@playwright/test";
import { expect, MOCK, room, test } from "./fixtures";

const playing = (p: Page) => p.evaluate(() => !document.querySelector("video")?.paused);
const position = (p: Page) => p.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
const gap = async (a: Page, b: Page) => Math.abs((await position(a)) - (await position(b)));
/** Shows, updates or (null) removes the mock player's ad countdown. */
const ad = (p: Page, text: string | null) =>
  p.evaluate((t) => {
    const el = document.querySelector<HTMLElement>("[data-ad]");
    if (t === null) return el?.remove();
    if (el) {
      el.textContent = t;
      return;
    }
    const next = document.createElement("div");
    next.dataset.ad = "";
    next.textContent = t;
    document.body.append(next);
  }, text);
/** Milliseconds until `check` holds, polling every 50 ms; fails after `limit`. */
async function within(limit: number, check: () => Promise<boolean>) {
  const started = Date.now();
  await expect.poll(check, { timeout: limit, intervals: [50] }).toBe(true);
  return Date.now() - started;
}
const bothPlaying = (a: Page, b: Page) => async () => (await playing(a)) && (await playing(b));
/** Whether `text` shows up on `p` at any moment in the next `ms` (notices only last 3 s). */
const appears = (p: Page, text: string | RegExp, ms: number) =>
  p
    .getByText(text)
    .first()
    .waitFor({ timeout: ms })
    .then(() => true)
    .catch(() => false);

async function bothWatching(
  ext: Parameters<typeof room>[0],
  prepare: (context: BrowserContext) => Promise<void> = async () => {},
) {
  await prepare(ext.context);
  const r = await room(ext);
  await prepare(r.friend.context);
  const tab = await r.friend.context.newPage();
  await tab.goto(`${MOCK}/watch/ep1`);
  await expect.poll(() => playing(tab)).toBe(true);
  await tab.waitForTimeout(3200); // past the arrival window (BUG-004)
  // Give the room a playing clock, as after anyone's first play.
  await r.hostTab.evaluate(() => {
    const v = document.querySelector("video");
    if (v) v.currentTime = 20;
  });
  await expect.poll(() => gap(tab, r.hostTab)).toBeLessThan(1);
  await r.hostTab.waitForTimeout(1600);
  return { ...r, tab };
}

test("an ad pauses the others, counts down, and everyone resumes together", async ({ ext }) => {
  const { hostTab, friend, tab } = await bothWatching(ext);
  try {
    const pausedNotice = appears(hostTab, /^Asha paused/, 4000); // the card says why instead
    await ad(tab, "Ad 0:18");
    expect(await within(1500, async () => !(await playing(hostTab)))).toBeLessThan(1500);
    await expect(hostTab.getByText("Asha is on an ad · about 0:20 left")).toBeVisible();
    await expect(hostTab.getByText("Paused for everyone until the ad ends.")).toBeVisible();
    expect(await pausedNotice).toBe(false);

    // The room leaves Asha's ad alone: her player isn't paused or moved by it.
    await tab.waitForTimeout(1500);
    expect(await playing(tab)).toBe(true);

    await ad(tab, "Ad 0:09");
    await expect(hostTab.getByText("Asha is on an ad · about 0:10 left")).toBeVisible();
    await ad(tab, "Ad 0:03");
    await expect(hostTab.getByText("Asha is on an ad · about 0:05 left")).toBeVisible();
    expect(await playing(hostTab)).toBe(false);

    await ad(tab, null);
    expect(await within(1500, bothPlaying(hostTab, tab))).toBeLessThan(1000);
    await expect(hostTab.getByText("Back together")).toBeVisible();
    await expect(hostTab.getByText(/is on an ad/)).toHaveCount(0);
    await expect.poll(() => gap(tab, hostTab), { timeout: 5000 }).toBeLessThan(1);
  } finally {
    await friend.context.close();
  }
});

test("two people on ads at once: the room waits for both", async ({ ext }) => {
  const { hostTab, friend, tab } = await bothWatching(ext);
  try {
    await ad(tab, "Ad 0:30");
    await expect.poll(() => playing(hostTab), { timeout: 1500 }).toBe(false);
    await ad(hostTab, "Ad 0:12");
    await hostTab.waitForTimeout(500);

    // Asha's ad ends first: she waits for Suhaas's, paused at the room's position.
    const early = appears(hostTab, "Back together", 3000); // not while Suhaas's own ad runs
    await ad(tab, null);
    await expect(tab.getByText("Suhaas is on an ad · about 0:15 left")).toBeVisible();
    expect(await early).toBe(false);
    await expect.poll(() => playing(tab), { timeout: 2000 }).toBe(false);
    await tab.waitForTimeout(1500);
    expect(await playing(tab)).toBe(false);
    expect(await playing(hostTab)).toBe(false);

    await ad(hostTab, null);
    expect(await within(1500, bothPlaying(hostTab, tab))).toBeLessThan(1000);
    await expect(tab.getByText("Back together")).toBeVisible();
    await expect.poll(() => gap(tab, hostTab), { timeout: 5000 }).toBeLessThan(1);
  } finally {
    await friend.context.close();
  }
});

test("a long ad lets the others keep waiting or watch without them", async ({ ext }) => {
  const { hostTab, friend, tab } = await bothWatching(ext);
  try {
    await ad(tab, "Ad 2:30");
    await expect(hostTab.getByText("Asha is on an ad · about 2:30 left")).toBeVisible();
    // After a long wait (90 s; 4 s in test builds) the card offers a choice.
    const without = hostTab.getByRole("button", { name: "Watch without Asha" });
    await expect(without).toHaveCount(0);
    await hostTab.getByRole("button", { name: "Keep waiting" }).click({ timeout: 8000 });
    await expect(without).toHaveCount(0); // the wait starts over
    expect(await playing(hostTab)).toBe(false);
    await without.click({ timeout: 8000 });
    await expect.poll(() => playing(hostTab)).toBe(true);
    await expect(hostTab.getByText(/is on an ad/)).toHaveCount(0);

    // Asha's ad ends and she catches up with the room.
    await ad(tab, null);
    await expect.poll(() => gap(tab, hostTab), { timeout: 6000 }).toBeLessThan(1);
    expect(await playing(tab)).toBe(true);
  } finally {
    await friend.context.close();
  }
});

// ---- An ad in its own short <video> (separateAd) ----

const mockDir = path.resolve(import.meta.dirname, "mock");
const film = readFileSync(path.join(mockDir, "film.webm")); // 10 minutes: a "film"
const short = readFileSync(path.join(mockDir, "clip.webm")); // 2 minutes: an "ad"

/** Serves bytes with range support, so the video is seekable. */
function serve(route: Route, body: Buffer) {
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? "");
  const headers = { "accept-ranges": "bytes", "content-type": "video/webm" };
  if (!range) return route.fulfill({ status: 200, headers, body });
  const start = Number(range[1]);
  const end = range[2] ? Number(range[2]) : body.length - 1;
  return route.fulfill({
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${body.length}` },
    body: body.subarray(start, end + 1),
  });
}

/** The mock player plays the 10-minute film, and has a short video at /ad.webm. */
async function filmAndAd(context: BrowserContext) {
  await context.route(`${MOCK}/clip.webm`, (route) => serve(route, film));
  await context.route(`${MOCK}/ad.webm`, (route) => serve(route, short));
}

/**
 * As a service with separate ad videos does it: pause the film, then play a smaller ad
 * video with `left` seconds to go; when the ad ends, remove it and resume the film.
 */
const separateAdVideo = (p: Page, left: number) =>
  p.evaluate(async (s) => {
    const main = document.querySelector("video");
    if (!main) throw new Error("no film");
    const adVideo = document.createElement("video");
    adVideo.dataset.testAd = "";
    adVideo.muted = true;
    adVideo.width = 320;
    adVideo.height = 180;
    adVideo.src = "/ad.webm";
    adVideo.addEventListener(
      "ended",
      () => {
        adVideo.remove();
        void main.play();
      },
      { once: true },
    );
    const loaded = new Promise((r) => adVideo.addEventListener("loadeddata", r, { once: true }));
    document.body.append(adVideo);
    await loaded;
    adVideo.currentTime = adVideo.duration - s;
    main.pause();
    await adVideo.play();
  }, left);

test("an ad in its own short video holds the room until it ends", async ({ ext }) => {
  const { hostTab, friend, tab } = await bothWatching(ext, filmAndAd);
  try {
    expect(await tab.evaluate(() => document.querySelector("video")?.duration)).toBe(600);
    await separateAdVideo(tab, 8);
    expect(await within(1500, async () => !(await playing(hostTab)))).toBeLessThan(1500);
    await expect(hostTab.getByText("Asha is on an ad · about 0:10 left")).toBeVisible();
    // The countdown comes from the ad video's own clock.
    await expect(hostTab.getByText("Asha is on an ad · about 0:05 left")).toBeVisible({
      timeout: 6000,
    });

    // The ad ends, the service resumes the film, and the room resumes with it.
    await expect(tab.locator("video[data-test-ad]")).toHaveCount(0, { timeout: 8000 });
    const ended = Date.now();
    await expect.poll(bothPlaying(hostTab, tab), { timeout: 3000, intervals: [50] }).toBe(true);
    expect(Date.now() - ended).toBeLessThan(1000);
    await expect(hostTab.getByText("Back together")).toBeVisible();
    await expect.poll(() => gap(tab, hostTab), { timeout: 5000 }).toBeLessThan(1);
    // Still together a moment later: nothing pauses the room again after the ad.
    await tab.waitForTimeout(1500);
    expect(await playing(hostTab)).toBe(true);
    expect(await playing(tab)).toBe(true);
  } finally {
    await friend.context.close();
  }
});
