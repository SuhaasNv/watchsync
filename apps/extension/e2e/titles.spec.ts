import type { BrowserContext } from "@playwright/test";
import { expect, launchWithExtension, MOCK, test } from "./fixtures";

type Ext = { context: BrowserContext; extensionId: string };

async function popup(ext: Ext, name: string) {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  return page;
}

/** Host creates a room on ep1; friend joins by code. Returns both popups and a friend context. */
async function room(ext: Ext) {
  const host = await popup(ext, "Suhaas");
  await host.getByRole("button", { name: "Create a room" }).click();
  const code = (await host.getByTestId("room-code").textContent()) ?? "";
  const hostTab = await ext.context.newPage();
  await hostTab.goto(`${MOCK}/watch/ep1`);
  await expect(host.getByText("Test player · Demo Show, E1")).toBeVisible();

  const friend = await launchWithExtension();
  const fpop = await popup(friend, "Asha");
  await fpop.getByRole("textbox", { name: "Or join a friend's room" }).fill(code);
  await fpop.getByRole("button", { name: "Join", exact: true }).click();
  await expect(fpop.getByTestId("room-code")).toHaveText(code);
  return { host, hostTab, friend, fpop };
}

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
  } finally {
    await friend.context.close();
  }
});
