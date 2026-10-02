import { expect, MOCK, room, test } from "./fixtures";

test("a friend on another title is asked, and Open takes them there", async ({ ext }) => {
  const { friend, fpop } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/film`);
    await expect(fpop.getByText("Test player · Demo Film")).toBeVisible();

    const ask = tab.getByText("Suhaas is watching Demo Show, E1. Open it?");
    await expect(ask).toBeVisible({ timeout: 5000 });
    await expect(tab.getByRole("button", { name: "Not now" })).toBeVisible();
    await tab.getByRole("button", { name: "Open" }).click();
    await tab.waitForURL(`${MOCK}/watch/ep1`);
  } finally {
    await friend.context.close();
  }
});

test("the room moves to the next episode together", async ({ ext }) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect(tab.getByText("Open it?")).toHaveCount(0);

    await hostTab.getByRole("link", { name: "Next episode" }).click();
    await tab.waitForURL(`${MOCK}/watch/ep2`, { timeout: 5000 });
    // Both start the new episode at the same position (US-020).
    const at = (p: typeof tab) =>
      p.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
    await expect
      .poll(async () => Math.abs((await at(tab)) - (await at(hostTab))), { timeout: 8000 })
      .toBeLessThan(1);
  } finally {
    await friend.context.close();
  }
});
