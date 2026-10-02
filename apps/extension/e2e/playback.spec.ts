import type { Page } from "@playwright/test";
import { expect, MOCK, room, test } from "./fixtures";

const playing = (p: Page) => p.evaluate(() => !document.querySelector("video")?.paused);

/** Records when this page's video next fires `event`, in Date.now() ms. */
const stamp = (p: Page, event: "play" | "pause") =>
  p.evaluate((ev) => {
    delete document.body.dataset.t;
    document
      .querySelector("video")
      ?.addEventListener(ev, () => (document.body.dataset.t = String(Date.now())), { once: true });
  }, event);
const stamped = (p: Page) => p.evaluate(() => Number(document.body.dataset.t ?? 0));

test("play and pause reach the other person within 500 ms, without echo", async ({ ext }) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    await expect.poll(() => playing(hostTab)).toBe(true);
    await tab.waitForTimeout(1500); // both tabs have reported their title

    // Host pauses in the service's own player.
    await stamp(tab, "pause");
    const paused = await hostTab.evaluate(() => {
      const t = Date.now();
      document.querySelector("video")?.pause();
      return t;
    });
    await expect.poll(() => stamped(tab)).toBeGreaterThan(0);
    expect((await stamped(tab)) - paused).toBeLessThan(500);
    await expect(tab.getByText("Suhaas paused")).toBeVisible();

    // The friend's player pausing for us must not bounce back to the host.
    await hostTab.waitForTimeout(2000);
    await expect(hostTab.getByText("Asha paused")).toHaveCount(0);
    expect(await playing(hostTab)).toBe(false);

    // Friend presses play.
    await stamp(hostTab, "play");
    const played = await tab.evaluate(() => {
      const t = Date.now();
      document.querySelector("video")?.play();
      return t;
    });
    await expect.poll(() => stamped(hostTab)).toBeGreaterThan(0);
    expect((await stamped(hostTab)) - played).toBeLessThan(500);
    await expect(hostTab.getByText("Asha pressed play")).toBeVisible();
  } finally {
    await friend.context.close();
  }
});

const position = (p: Page) => p.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
const jump = (p: Page, to: number) =>
  p.evaluate((t) => {
    const v = document.querySelector("video");
    if (v) v.currentTime = t;
  }, to);

test("jumps take everyone along, with a notice of where to", async ({ ext }) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.waitForTimeout(1500);

    await jump(hostTab, 60);
    await expect(tab.getByText("Suhaas skipped ahead to 1:00")).toBeVisible();
    await expect
      .poll(async () => Math.abs((await position(tab)) - (await position(hostTab))))
      .toBeLessThan(1);

    await hostTab.waitForTimeout(1600); // past the friend's echo window
    await jump(tab, 20);
    await expect(hostTab.getByText("Asha went back to 0:20")).toBeVisible();
    await expect
      .poll(async () => Math.abs((await position(tab)) - (await position(hostTab))))
      .toBeLessThan(1);
  } finally {
    await friend.context.close();
  }
});
