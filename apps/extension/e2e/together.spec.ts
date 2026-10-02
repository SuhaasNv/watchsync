// The flagship (UC-042): nobody gets left behind, and start together.
import type { Page } from "@playwright/test";
import { expect, MOCK, room, test } from "./fixtures";

const playing = (p: Page) => p.evaluate(() => !document.querySelector("video")?.paused);
const position = (p: Page) => p.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
const gap = async (a: Page, b: Page) => Math.abs((await position(a)) - (await position(b)));
const buffering = (p: Page, on: boolean) =>
  p.evaluate((v) => {
    if (v) document.body.dataset.buffering = "1";
    else delete document.body.dataset.buffering;
  }, on);
const ad = (p: Page, text: string | null) =>
  p.evaluate((t) => {
    document.querySelector("[data-ad]")?.remove();
    if (t === null) return;
    const el = document.createElement("div");
    el.dataset.ad = "";
    el.textContent = t;
    document.body.append(el);
  }, text);

async function bothWatching(ext: Parameters<typeof room>[0]) {
  const r = await room(ext);
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

test("the room waits while someone buffers, then resumes together", async ({ ext }) => {
  const { hostTab, friend, tab } = await bothWatching(ext);
  try {
    await buffering(tab, true);
    const started = Date.now();
    await expect.poll(() => playing(hostTab), { timeout: 3000, intervals: [100] }).toBe(false);
    expect(Date.now() - started).toBeLessThan(2500); // 1 s to call it buffering, then under 1 s
    await expect(hostTab.getByText("Waiting for Asha to load")).toBeVisible();
    await expect(hostTab.getByRole("img", { name: "Asha, loading" })).toBeVisible();

    await buffering(tab, false);
    await expect.poll(() => playing(hostTab), { timeout: 4000 }).toBe(true);
    await expect(hostTab.getByText("Back together")).toBeVisible();
    await expect.poll(() => gap(tab, hostTab), { timeout: 5000 }).toBeLessThan(1);
  } finally {
    await friend.context.close();
  }
});

test("the room waits through someone's ad and says how long", async ({ ext }) => {
  const { hostTab, friend, tab } = await bothWatching(ext);
  try {
    await ad(tab, "Ad 0:18");
    await expect.poll(() => playing(hostTab), { timeout: 2000 }).toBe(false);
    await expect(hostTab.getByText("Asha is on an ad · about 0:20 left")).toBeVisible();
    const hostAt = await position(hostTab);
    // The ad moving the friend's player is not a jump for the room.
    await tab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 100;
    });
    await tab.waitForTimeout(1000);
    expect(Math.abs((await position(hostTab)) - hostAt)).toBeLessThan(0.5);
    await expect(tab.getByText("You're")).toHaveCount(0); // no Sync during my own ad

    await ad(tab, null);
    await expect.poll(() => playing(hostTab), { timeout: 3000 }).toBe(true);
    await expect.poll(() => gap(tab, hostTab), { timeout: 5000 }).toBeLessThan(1);
  } finally {
    await friend.context.close();
  }
});

test("after a long wait, the others can go on without them", async ({ ext }) => {
  const { hostTab, friend, tab } = await bothWatching(ext);
  try {
    await buffering(tab, true);
    await expect(hostTab.getByText("Waiting for Asha to load")).toBeVisible();
    await hostTab.getByRole("button", { name: "Watch without Asha" }).click({ timeout: 8000 });
    await expect.poll(() => playing(hostTab)).toBe(true);
    await expect(hostTab.getByText("Waiting for Asha")).toHaveCount(0);

    // Asha's player recovers and catches up to the room.
    await buffering(tab, false);
    await expect.poll(() => gap(tab, hostTab), { timeout: 6000 }).toBeLessThan(1);
  } finally {
    await friend.context.close();
  }
});

test("start together counts down and starts every player at once", async ({ ext }) => {
  const { hostTab, friend, tab } = await bothWatching(ext);
  try {
    const stamp = (p: Page) =>
      p.evaluate(() => {
        delete document.body.dataset.t;
        document
          .querySelector("video")
          ?.addEventListener("play", () => (document.body.dataset.t = String(Date.now())), {
            once: true,
          });
      });
    await hostTab.getByRole("button", { name: "Start together" }).click();
    await expect.poll(() => playing(tab)).toBe(false);
    await expect(tab.getByText(/Starting together in [123]/)).toBeVisible({ timeout: 5000 });
    await stamp(tab);
    await stamp(hostTab);
    await expect.poll(() => playing(tab), { timeout: 6000 }).toBe(true);
    await expect.poll(() => playing(hostTab), { timeout: 6000 }).toBe(true);
    const t = (p: Page) => p.evaluate(() => Number(document.body.dataset.t ?? 0));
    expect(Math.abs((await t(tab)) - (await t(hostTab)))).toBeLessThan(300);
    expect(await gap(tab, hostTab)).toBeLessThan(0.5);
  } finally {
    await friend.context.close();
  }
});
