// WCAG 2.2 AA gate (DEC-022): every WatchSync surface, in each state a person can reach.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, MOCK, popup, room, test } from "./fixtures";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page: Page, include?: string) {
  // Audit the settled state: with reduced motion, entrance fades end at once, so contrast
  // is measured on the finished screen rather than mid-fade.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const builder = new AxeBuilder({ page }).withTags(WCAG);
  const { violations } = await (include ? builder.include(include) : builder).analyze();
  const summary = violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`);
  expect(summary).toEqual([]);
}

test("popup: name, home, join error and room screens", async ({ ext }) => {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  await audit(page);

  await page.getByLabel("Your name").fill("Suhaas");
  await page.getByRole("button", { name: "Continue" }).click();
  await audit(page);

  await page.getByRole("textbox", { name: "Or join a friend's room" }).fill("ZZZZZZ");
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await audit(page);

  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.getByText("Connected")).toBeVisible();
  await audit(page);
});

test("invite page, with and without the extension", async ({ ext, page }) => {
  await page.goto("http://localhost:8000/j/ABC234");
  await audit(page);

  const withExt = await ext.context.newPage();
  await withExt.goto("http://localhost:8000/j/ABC234");
  await expect(withExt.getByRole("button", { name: "Join room" })).toBeVisible();
  await audit(withExt);
});

test("on-page prompt and notices", async ({ ext }) => {
  const { host, hostTab, friend, fpop } = await room(ext);
  try {
    await audit(host); // the popup's room with people in it
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/film`);
    await expect(fpop.getByRole("button", { name: "Open Demo Show, E1" })).toBeVisible();
    await audit(fpop); // a friend on another title
    await expect(tab.getByText("Open it?")).toBeVisible({ timeout: 5000 });
    await audit(tab, "watchsync-overlay");

    await tab.getByRole("button", { name: "Open", exact: true }).click();
    await tab.waitForURL(`${MOCK}/watch/ep1`);
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)
    await hostTab.evaluate(() => document.querySelector("video")?.pause());
    await expect(tab.getByText("Suhaas paused")).toBeVisible();
    await expect(tab.getByRole("region", { name: "WatchSync room" })).toBeVisible();
    await audit(tab, "watchsync-overlay"); // notices and the presence pill
  } finally {
    await friend.context.close();
  }
});

test("chat: closed and open", async ({ ext }) => {
  const pop = await popup(ext, "Suhaas");
  await pop.getByRole("button", { name: "Create a room" }).click();
  await audit(pop); // the room screen with its chat shortcut line
  const tab = await ext.context.newPage();
  await tab.goto(`${MOCK}/watch/ep1`);
  const chat = tab.getByRole("button", { name: /^Open chat/ });
  await expect(chat).toBeVisible();
  await tab.mouse.move(20, 20); // not faded out while measured
  await audit(tab, "watchsync-overlay"); // the pill with its chat button, closed

  await chat.click();
  const frame = tab.frameLocator("watchsync-sidebar iframe");
  await expect(frame.getByRole("textbox", { name: "Message" })).toBeFocused();
  await audit(tab, "watchsync-sidebar"); // the panel and the chat frame inside it
  await audit(tab, "watchsync-overlay");
});

test("the popup works by keyboard alone", async ({ ext }) => {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  await expect(page.getByLabel("Your name")).toBeFocused();
  await page.keyboard.type("Suhaas");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Create a room" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Copy link" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Copy code" })).toBeFocused();
});

test("flagship: wait card and countdown", async ({ ext }) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await tab.waitForTimeout(3200);
    await hostTab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 20;
    });
    await hostTab.waitForTimeout(1600);
    await tab.evaluate(() => {
      document.body.dataset.buffering = "1";
    });
    await expect(hostTab.getByText("Waiting for Asha to load")).toBeVisible();
    await audit(hostTab, "watchsync-overlay");
    await expect(hostTab.getByRole("button", { name: "Watch without Asha" })).toBeVisible({
      timeout: 8000,
    });
    await audit(hostTab, "watchsync-overlay");
    await tab.evaluate(() => {
      delete document.body.dataset.buffering;
    });
    await expect(hostTab.getByText("Back together")).toBeVisible({ timeout: 5000 });
    // Playing, the pill offers Pause everyone; paused, Start with 3-2-1.
    await hostTab.getByRole("button", { name: "Pause everyone" }).click();
    await hostTab.getByRole("button", { name: "Start with 3-2-1" }).click();
    await expect(tab.getByText(/Starting together in|Getting ready/)).toBeVisible();
    await audit(tab, "watchsync-overlay");
  } finally {
    await friend.context.close();
  }
});
