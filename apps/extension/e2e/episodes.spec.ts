// Episode changes: the friend is told who moved and to which episode, and ends up in sync.
import type { Page } from "@playwright/test";
import { expect, MOCK, room, test } from "./fixtures";

const position = (p: Page) => p.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
const gap = async (a: Page, b: Page) => Math.abs((await position(a)) - (await position(b)));

/** Resolves true if `text` shows on `page` at any moment in the next `ms` (notices fade). */
const seen = (page: Page, text: string | RegExp, ms: number) =>
  page
    .getByText(text)
    .first()
    .waitFor({ timeout: ms })
    .then(() => true)
    .catch(() => false);

test("the next episode tells the friend who moved and where, and they land in sync", async ({
  ext,
}) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await tab.waitForTimeout(3200);

    await hostTab.getByRole("link", { name: "Next episode" }).click();
    await tab.waitForURL(`${MOCK}/watch/ep2`, { timeout: 5000 });
    // The notice before the page load is wiped by it; the new page says it again.
    await expect(tab.getByText("Moved to Demo Show, E2 with Suhaas")).toBeVisible({
      timeout: 5000,
    });
    await expect.poll(() => gap(tab, hostTab), { timeout: 8000 }).toBeLessThan(1);
    await expect(tab.getByText(/Open it\?|opened|closed the show/)).toHaveCount(0);
    // A reload later is not a move: no second "Moved to".
    await tab.reload();
    expect(await seen(tab, "Moved to", 4000)).toBe(false);
  } finally {
    await friend.context.close();
  }
});

test("a friend watching on their own stays put but is told about the next episode", async ({
  ext,
}) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await tab.waitForTimeout(3200);
    await tab.getByRole("button", { name: "Watch on my own" }).click();

    await hostTab.getByRole("link", { name: "Next episode" }).click();
    await expect(tab.getByText("Suhaas moved on to Demo Show, E2")).toBeVisible({
      timeout: 5000,
    });
    await expect(tab.getByText("You're watching on your own, so you stay here.")).toBeVisible();
    await tab.waitForTimeout(2500);
    expect(tab.url()).toBe(`${MOCK}/watch/ep1`); // not moved

    // Back with the room, they're offered the episode the room is on.
    await tab.getByRole("button", { name: "Watch with the room" }).click();
    await expect(tab.getByText("Suhaas is watching Demo Show, E2. Open it?")).toBeVisible({
      timeout: 5000,
    });
  } finally {
    await friend.context.close();
  }
});

test("a moment without a readable title between episodes is still the next episode", async ({
  ext,
}) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await tab.waitForTimeout(3200);

    const closed = seen(tab, "Suhaas closed the show", 6000);
    const asked = seen(tab, /Suhaas opened/, 6000);
    // Like Netflix moving on in its player: the address changes, and for a second or so
    // the page shows no title.
    await hostTab.evaluate(() => {
      document.body.dataset.loading = "1";
      history.pushState(null, "", "/watch/ep2");
      const h1 = document.querySelector("[data-title]");
      if (h1) h1.textContent = "Demo Show, E2";
    });
    await hostTab.waitForTimeout(1500);
    await hostTab.evaluate(() => delete document.body.dataset.loading);

    await tab.waitForURL(`${MOCK}/watch/ep2`, { timeout: 6000 });
    expect(await closed).toBe(false);
    expect(await asked).toBe(false);
  } finally {
    await friend.context.close();
  }
});
