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
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)

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
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)

    await jump(hostTab, 60);
    await expect(tab.getByText("Suhaas skipped ahead to 1:00")).toBeVisible();
    await expect
      .poll(async () => Math.abs((await position(tab)) - (await position(hostTab))))
      .toBeLessThan(1);

    await hostTab.waitForTimeout(1600); // past the friend's echo window
    await jump(tab, 20);
    await expect(hostTab.getByText("Asha went back to 0:20")).toBeVisible();
    // The jumper's own tab must not think it fell behind (BUG-006).
    await tab.waitForTimeout(2500);
    await expect(tab.getByText(/You're \d+ seconds/)).toHaveCount(0);
    await expect
      .poll(async () => Math.abs((await position(tab)) - (await position(hostTab))))
      .toBeLessThan(1);
  } finally {
    await friend.context.close();
  }
});

test("a friend arriving on the title doesn't pull the room back (BUG-004)", async ({ ext }) => {
  const { hostTab, friend } = await room(ext);
  try {
    await hostTab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 30;
    });
    await hostTab.waitForTimeout(1600);
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`); // autoplays from 0:00
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.waitForTimeout(1000);
    expect(await position(hostTab)).toBeGreaterThan(30);
    await expect(hostTab.getByText("Asha pressed play")).toHaveCount(0);
    // The friend catches up to the host instead.
    await expect.poll(() => position(tab), { timeout: 6000 }).toBeGreaterThan(29);
    // And the host's next pause reaches the friend.
    await hostTab.evaluate(() => document.querySelector("video")?.pause());
    await expect(tab.getByText("Suhaas paused")).toBeVisible();
  } finally {
    await friend.context.close();
  }
});
