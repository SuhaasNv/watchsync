// Room notices in the chat feed (UC-044) between two profiles on the mock player.
import type { Page } from "@playwright/test";
import { expect, MOCK, room, test } from "./fixtures";

const playing = (p: Page) => p.evaluate(() => !document.querySelector("video")?.paused);
const chatButton = (tab: Page) => tab.getByRole("button", { name: /^(Open|Close) chat/ });
const frame = (tab: Page) => tab.frameLocator("watchsync-sidebar iframe");
const log = (tab: Page) => frame(tab).getByRole("log", { name: "Messages" });

test("room notices show in the feed in time order, apart from chat, and not as unread", async ({
  ext,
}) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)
    await chatButton(hostTab).click();
    await expect(log(hostTab)).toBeAttached();
    await chatButton(hostTab).click(); // closed again: notices must not count as unread

    await tab.close(); // Asha closes the show
    await expect(hostTab.getByText("Asha closed the show")).toBeVisible(); // the on-page notice
    await expect(chatButton(hostTab)).not.toHaveAttribute("aria-label", /unread/);

    await chatButton(hostTab).click();
    const line = log(hostTab).locator(".activity", { hasText: "Asha closed the show" });
    await expect(line).toBeVisible();
    await expect(line).toHaveCSS("text-align", "center");
    await frame(hostTab).getByRole("textbox", { name: "Message" }).fill("brb");
    await frame(hostTab).getByRole("textbox", { name: "Message" }).press("Enter");
    await expect(log(hostTab).locator(".msg", { hasText: "brb" })).toBeVisible();
    // One list in time order: the notice, then the message sent after it.
    const order = await log(hostTab)
      .locator(".activity, .msg")
      .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    expect(order.indexOf("Asha closed the show")).toBeLessThan(
      order.findIndex((t) => t.startsWith("brb")),
    );
    // Not said again in chat's own spoken region: the page's notice already said it.
    await expect(frame(hostTab).locator("#say")).not.toHaveText(/closed the show/);
  } finally {
    await friend.context.close();
  }
});

test("Show pop-ups off hides them on my page only; the feed keeps them (US-114)", async ({
  ext,
}) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)
    await chatButton(hostTab).click();
    const toggle = frame(hostTab).getByRole("checkbox", { name: "Show pop-ups" });
    await expect(toggle).toBeChecked();
    // By keyboard: a click can land beside it while the panel still slides in.
    await toggle.press("Space");
    await expect(toggle).not.toBeChecked();
    const [worker] = ext.context.serviceWorkers();
    if (!worker) throw new Error("extension service worker not running");
    const saved = () =>
      worker.evaluate(async () => (await chrome.storage.local.get("roomNotices")).roomNotices);
    await expect.poll(saved).toBe(false); // a setting: every room from now on

    // Asha's notices are hers: still on.
    await hostTab.evaluate(() => document.querySelector("video")?.pause());
    await expect(tab.getByText("Suhaas paused")).toBeVisible();

    await tab.close(); // Asha closes the show: in my feed, not as a pop-up on my page
    await expect(
      log(hostTab).locator(".activity", { hasText: "Asha closed the show" }),
    ).toBeVisible();
    await expect(
      hostTab.locator("watchsync-overlay").getByText("Asha closed the show"),
    ).toHaveCount(0);
  } finally {
    await friend.context.close();
  }
});
