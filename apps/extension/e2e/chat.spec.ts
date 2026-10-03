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
    // Two browsers share one screen: fill and press on the box itself, so focus moving to the
    // other window can't swallow the keys (BUG-064).
    await box(hostTab).fill("hi");
    await box(hostTab).press("Enter");
    await expect(log(hostTab).getByText("hi", { exact: true })).toBeVisible();
    await expect(log(hostTab).getByText(/^You$/)).toBeVisible();
    await expect(chatButton(tab)).toHaveAttribute("aria-label", /, 1 unread$/);

    // Opening clears it; the message carries Suhaas's movie time.
    await chatButton(tab).click();
    await expect(chatButton(tab)).not.toHaveAttribute("aria-label", /unread/);
    await expect(header(tab, "Suhaas")).toHaveText(/Suhaas 1:\d\d$/);
    await expect(log(tab).getByText("hi", { exact: true })).toBeVisible();

    // Script-like text is shown as typed and does nothing; Space and k stay in the box.
    const evil = `<img src=x onerror="document.title='owned'"> k`;
    // Typed into the box itself: with two browsers open, page.keyboard goes to whichever window
    // has focus (BUG-064). These are still real key events inside the chat frame.
    await box(tab).pressSequentially(evil);
    await box(tab).press("Space");
    await expect.poll(() => playing(tab)).toBe(true);
    await box(tab).press("Shift+Enter");
    await box(tab).pressSequentially("second line");
    await expect(frame(tab).locator("#send")).toBeEnabled();
    await box(tab).press("Enter");
    const sent = `${evil} \nsecond line`;
    await expect(log(hostTab).getByText(sent)).toBeVisible();
    await expect(header(hostTab, "Asha")).toHaveText(/Asha 1:\d\d$/);
    expect(await frame(hostTab).locator("img").count()).toBe(0);
    expect(await hostTab.title()).not.toBe("owned");
    expect(await playing(tab)).toBe(true);
    expect(await playing(hostTab)).toBe(true);
  } finally {
    await friend.context.close();
  }
});

test("the new messages chip: none at the bottom, a count when scrolled up, click goes down", async ({
  ext,
}) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)
    await chatButton(hostTab).click();
    await chatButton(tab).click();
    await expect(box(tab)).toBeEnabled();

    // Enough to scroll: a tall block above the list (the list itself redraws).
    const body = () => frame(hostTab).locator("#body");
    await body().evaluate((b) => {
      const tall = document.createElement("div");
      tall.style.height = "1500px";
      b.prepend(tall);
      b.scrollTop = b.scrollHeight;
    });
    const atBottom = () =>
      body().evaluate((b) => b.scrollTop + b.clientHeight >= b.scrollHeight - 24);
    const chip = frame(hostTab).getByRole("button", { name: /new message/ });
    const say = async (text: string) => {
      await box(tab).fill(text);
      await box(tab).press("Enter");
      await expect(log(hostTab).getByText(text, { exact: true })).toBeAttached();
    };

    // At the bottom: the list follows the new message and no chip appears.
    await say("one");
    await expect.poll(atBottom).toBe(true);
    await hostTab.waitForTimeout(300);
    await expect(chip).toBeHidden();

    // Scrolled up: what lands below is counted on the chip.
    await body().evaluate((b) => {
      b.scrollTop = 0;
    });
    await expect.poll(atBottom).toBe(false);
    await say("two");
    await say("three");
    await expect(chip).toHaveText("2 new messages");
    expect(await atBottom()).toBe(false);

    // The chip takes the reader down and goes.
    await chip.click();
    await expect(chip).toBeHidden();
    await expect.poll(atBottom).toBe(true);
    // The newest message is in view, once rows skipped while offscreen take their real height.
    const shown = () =>
      log(hostTab)
        .getByText("three", { exact: true })
        .evaluate((m) => {
          const r = m.getBoundingClientRect();
          const b = document.getElementById("body")?.getBoundingClientRect();
          return b !== undefined && r.top >= b.top && r.bottom <= b.bottom;
        });
    await expect.poll(shown).toBe(true);
  } finally {
    await friend.context.close();
  }
});
