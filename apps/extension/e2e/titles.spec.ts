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

test("the popup offers the room's title to a friend who isn't on it", async ({ ext }) => {
  const { friend, fpop } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/film`);
    const open = fpop.getByRole("button", { name: "Open Demo Show, E1" });
    await expect(open).toBeVisible({ timeout: 5000 });
    const opened = friend.context.waitForEvent("page");
    await open.click();
    await (await opened).waitForURL(`${MOCK}/watch/ep1`);
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

test("opening another movie asks friends to continue or watch on their own (BUG-014)", async ({
  ext,
}) => {
  const { hostTab, friend, host } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await tab.waitForTimeout(3200);

    await hostTab.goto(`${MOCK}/browse`); // back to the service's browse page
    await hostTab.waitForTimeout(1500);
    await hostTab.goto(`${MOCK}/watch/film`);
    await hostTab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 40; // resuming mid-film
    });

    await expect(tab.getByText("Suhaas opened Demo Film on Test player.")).toBeVisible({
      timeout: 6000,
    });
    await expect(tab.getByRole("button", { name: "Watch on my own" }).first()).toBeVisible();
    await tab.getByRole("button", { name: "Continue with Suhaas" }).click();
    await tab.waitForURL(`${MOCK}/watch/film`);
    const at = (p: typeof tab) =>
      p.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
    await expect
      .poll(async () => Math.abs((await at(tab)) - (await at(hostTab))), { timeout: 10000 })
      .toBeLessThan(1);
    await expect(host.getByText("Test player · Demo Film")).toHaveCount(2); // both on it
  } finally {
    await friend.context.close();
  }
});

test("watch on my own from the new-movie prompt keeps the friend where they are", async ({
  ext,
}) => {
  const { hostTab, friend, host } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await tab.waitForTimeout(3200);
    await hostTab.goto(`${MOCK}/browse`);
    await hostTab.waitForTimeout(1500);
    await hostTab.goto(`${MOCK}/watch/film`);

    const card = tab.getByText("Suhaas opened Demo Film on Test player.");
    await expect(card).toBeVisible({ timeout: 6000 });
    await tab.getByRole("button", { name: "Watch on my own" }).first().click();
    await expect(card).toHaveCount(0);
    expect(tab.url()).toBe(`${MOCK}/watch/ep1`);
    await expect(host.getByText(/On their own/)).toBeVisible();
  } finally {
    await friend.context.close();
  }
});
