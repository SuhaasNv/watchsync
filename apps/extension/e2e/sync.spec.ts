import type { Page } from "@playwright/test";
import { expect, MOCK, room, test } from "./fixtures";

const position = (p: Page) => p.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
const playing = (p: Page) => p.evaluate(() => !document.querySelector("video")?.paused);
const gap = async (a: Page, b: Page) => Math.abs((await position(a)) - (await position(b)));
/** Runs the player fast for a moment: drift without any play, pause or seek event. */
const drift = (p: Page, rate: number, ms: number) =>
  p.evaluate(
    ([r, t]) =>
      new Promise<void>((done) => {
        const v = document.querySelector("video");
        if (!v) return done();
        v.playbackRate = r;
        setTimeout(() => {
          v.playbackRate = 1;
          done();
        }, t);
      }),
    [rate, ms] as const,
  );

test("small drift is corrected silently", async ({ ext }) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)
    await hostTab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 10; // a shared starting point
    });
    await expect.poll(() => gap(tab, hostTab)).toBeLessThan(1);
    await hostTab.waitForTimeout(1600);

    await drift(tab, 3, 1000); // about 2 s ahead
    await expect.poll(() => gap(tab, hostTab), { timeout: 6000 }).toBeLessThan(1);
    await expect(tab.getByText("seconds ahead")).toHaveCount(0);
    await expect(hostTab.getByText(/Asha (skipped|went back)/)).toHaveCount(0);
  } finally {
    await friend.context.close();
  }
});

test("large drift asks, and Sync snaps back", async ({ ext }) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)
    await hostTab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 10;
    });
    await expect.poll(() => gap(tab, hostTab)).toBeLessThan(1);
    await hostTab.waitForTimeout(1600);

    // The friend lands 9 s ahead right after applying the host's play, inside the echo
    // window, so it counts as drift rather than as the friend's own jump.
    await hostTab.evaluate(() => document.querySelector("video")?.pause());
    await expect.poll(() => playing(tab)).toBe(false);
    await hostTab.waitForTimeout(1600);
    await hostTab.evaluate(() => document.querySelector("video")?.play());
    await expect.poll(() => playing(tab), { intervals: [50] }).toBe(true);
    await tab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime += 9;
    });
    await expect(tab.getByText(/You're \d+ seconds ahead/)).toBeVisible({ timeout: 4000 });
    await tab.getByRole("button", { name: "Sync", exact: true }).click();
    await expect.poll(() => gap(tab, hostTab)).toBeLessThan(1);
    await expect(tab.getByText(/seconds ahead/)).toHaveCount(0);
  } finally {
    await friend.context.close();
  }
});

test("watching on my own stops following until Sync", async ({ ext }) => {
  const { host, hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)

    await tab.getByRole("button", { name: "Watch on my own" }).click();
    await expect(host.getByText(/On their own/)).toBeVisible();

    // The host pauses; the friend keeps playing and isn't pulled back.
    await hostTab.evaluate(() => document.querySelector("video")?.pause());
    await tab.waitForTimeout(1500);
    expect(await playing(tab)).toBe(true);
    // The friend jumps; the host doesn't move.
    const hostAt = await position(hostTab);
    await tab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 90;
    });
    await tab.waitForTimeout(1500);
    expect(Math.abs((await position(hostTab)) - hostAt)).toBeLessThan(0.5);

    await tab.getByRole("button", { name: "Sync", exact: true }).click();
    await expect.poll(() => playing(tab)).toBe(false);
    await expect.poll(() => gap(tab, hostTab)).toBeLessThan(1);
    await expect(host.getByText(/On their own/)).toHaveCount(0);
  } finally {
    await friend.context.close();
  }
});

test("the pill shows who is here, moves, and stays in full screen", async ({ ext }) => {
  const { friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    const region = tab.getByRole("region", { name: "WatchSync room" });
    await expect(region.getByRole("img", { name: "Suhaas, in sync" })).toBeVisible();
    await expect(region.getByRole("img", { name: "Asha (you), in sync" })).toBeVisible();

    await region.getByRole("button", { name: "Move left" }).click();
    await expect(region.getByRole("button", { name: "Move right" })).toBeVisible();
    const box = await region.boundingBox();
    expect(box?.x).toBeLessThan(100);

    await tab.getByRole("button", { name: "Full screen" }).click();
    await expect
      .poll(() =>
        tab.evaluate(
          () =>
            document.fullscreenElement?.contains(document.querySelector("watchsync-overlay")) ??
            false,
        ),
      )
      .toBe(true);
  } finally {
    await friend.context.close();
  }
});
