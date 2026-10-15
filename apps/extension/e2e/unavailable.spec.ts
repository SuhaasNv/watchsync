// A friend whose service won't play the room's title (US-128). The real error screens can't
// be shown in automated Chromium, so the mock player's [data-unavailable] marker stands in for
// each service's screen (the per-service markers are covered by unit tests on fixtures).
import type { Page } from "@playwright/test";
import { expect, MOCK, room, test } from "./fixtures";

const playing = (p: Page) => p.evaluate(() => !document.querySelector("video")?.paused);
const position = (p: Page) => p.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
const gap = async (a: Page, b: Page) => Math.abs((await position(a)) - (await position(b)));
const mark = (p: Page, on: boolean) =>
  p.evaluate((show) => {
    document.querySelector("[data-unavailable]")?.remove();
    if (!show) return;
    const el = document.createElement("div");
    el.dataset.unavailable = "";
    document.body.append(el);
  }, on);
const LINE = "Asha can't play this here";

test("a friend who can't play the title: everyone is told, nobody waits, it clears", async ({
  ext,
}) => {
  const { host, hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)
    await hostTab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 20; // give the room a playing clock
    });
    await expect.poll(() => gap(tab, hostTab)).toBeLessThan(1);
    await hostTab.waitForTimeout(1600);

    // From here on, no page of the service may be fetched for the room's sake: only the ones
    // each person opened (all of them already loaded above).
    const fetched: string[] = [];
    for (const context of [ext.context, friend.context])
      context.on("request", (r) => {
        if (r.url().startsWith(MOCK)) fetched.push(r.url());
      });

    // Asha's service says she can't play it: the host is told within 5 s.
    await mark(tab, true);
    await expect(hostTab.getByText(LINE)).toBeVisible({ timeout: 5000 });
    await expect(tab.getByText(LINE)).toHaveCount(0); // her own screen already says it

    // The room doesn't wait for her: not for her loading, and not for a Start together.
    await tab.evaluate(() => {
      document.body.dataset.buffering = "1";
    });
    await hostTab.waitForTimeout(2500);
    expect(await playing(hostTab)).toBe(true);
    await expect(hostTab.getByText(/^Waiting for Asha/)).toHaveCount(0);
    await tab.evaluate(() => {
      delete document.body.dataset.buffering;
    });
    await hostTab.getByRole("button", { name: "Pause everyone" }).click();
    await expect.poll(() => playing(hostTab)).toBe(false);
    await hostTab.getByRole("button", { name: "Start with 3-2-1" }).click();
    await expect.poll(() => playing(hostTab), { timeout: 9000 }).toBe(true);

    // The popup says it too.
    await host.reload();
    await expect(host.getByText("Asha can't play this here.")).toBeVisible();

    // She opens something she can play (here: the marker goes): the line clears.
    await mark(tab, false);
    await expect(hostTab.getByText(LINE)).toHaveCount(0, { timeout: 5000 });
    // Again, and this time she moves on to another title.
    await mark(tab, true);
    await expect(hostTab.getByText(LINE)).toBeVisible({ timeout: 5000 });
    await tab.goto(`${MOCK}/watch/film`);
    await expect(hostTab.getByText(LINE)).toHaveCount(0, { timeout: 5000 });

    // The only pages fetched were the one she opened herself.
    expect(fetched.filter((u) => !u.endsWith("/clip.webm"))).toEqual([`${MOCK}/watch/film`]);
  } finally {
    await friend.context.close();
  }
});
