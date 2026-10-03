// Chat (UC-014) between two profiles on the mock player: messages both ways with the movie
// time, script-like text stays inert, typing never reaches the player, and the unread count.
import type { Page } from "@playwright/test";
import { expect, MOCK, room, test } from "./fixtures";

const playing = (p: Page) => p.evaluate(() => !document.querySelector("video")?.paused);
const chatButton = (tab: Page) => tab.getByRole("button", { name: /^(Open|Close) chat/ });
const frame = (tab: Page) => tab.frameLocator("watchsync-sidebar iframe");
const box = (tab: Page) => frame(tab).getByRole("textbox", { name: "Message" });
const log = (tab: Page) => frame(tab).getByRole("log", { name: "Messages" });
const header = (tab: Page, name: string) => log(tab).locator(".who").filter({ hasText: name });

test("two people chat both ways with movie times; text is inert; typing never plays", async ({
  ext,
}) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)
    await hostTab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 70; // the room's clock: about 1:10
    });
    await hostTab.waitForTimeout(1600);

    // Closed on Asha's side: Suhaas's message shows up as unread on her chat button.
    await chatButton(hostTab).click();
    await expect(box(hostTab)).toBeEnabled(); // the room's state has arrived
    await box(hostTab).click(); // two browsers: only one window has focus at a time
    await hostTab.keyboard.type("hi");
    await hostTab.keyboard.press("Enter");
    await expect(log(hostTab).getByText("hi", { exact: true })).toBeVisible();
    await expect(log(hostTab).getByText(/^You$/)).toBeVisible();
    await expect(chatButton(tab)).toHaveAttribute("aria-label", /, 1 unread$/);

    // Opening clears it; the message carries Suhaas's movie time.
    await chatButton(tab).click();
    await expect(chatButton(tab)).not.toHaveAttribute("aria-label", /unread/);
    await expect(header(tab, "Suhaas")).toHaveText(/Suhaas · 1:\d\d$/);
    await expect(log(tab).getByText("hi", { exact: true })).toBeVisible();

    // Script-like text is shown as typed and does nothing; Space and k stay in the box.
    const evil = `<img src=x onerror="document.title='owned'"> k`;
    await box(tab).click();
    await tab.keyboard.type(evil);
    await tab.keyboard.press("Space");
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.keyboard.press("Shift+Enter");
    await tab.keyboard.type("second line");
    await tab.keyboard.press("Enter");
    const sent = `${evil} \nsecond line`;
    await expect(log(hostTab).getByText(sent)).toBeVisible();
    await expect(header(hostTab, "Asha")).toHaveText(/Asha · 1:\d\d$/);
    expect(await frame(hostTab).locator("img").count()).toBe(0);
    expect(await hostTab.title()).not.toBe("owned");
    expect(await playing(tab)).toBe(true);
    expect(await playing(hostTab)).toBe(true);
  } finally {
    await friend.context.close();
  }
});
