// The WatchSync sidebar (UC-013): opening, collapsing, full screen and keyboard use.
import type { Page } from "@playwright/test";
import { type Ext, expect, MOCK, popup, test } from "./fixtures";

/** One person in a room, watching ep1. */
async function inRoom(ext: Ext) {
  const pop = await popup(ext, "Suhaas");
  await pop.getByRole("button", { name: "Create a room" }).click();
  const code = (await pop.getByTestId("room-code").textContent()) ?? "";
  const tab = await ext.context.newPage();
  await tab.goto(`${MOCK}/watch/ep1`);
  await expect(tab.getByRole("button", { name: "Open chat" })).toBeVisible();
  return { pop, tab, code };
}

const sidebar = (tab: Page) => tab.getByRole("region", { name: "WatchSync", exact: true });
const openButton = (tab: Page) => tab.getByRole("button", { name: /^Open WatchSync sidebar/ });
const closeButton = (tab: Page) => tab.getByRole("button", { name: "Close WatchSync sidebar" });

/** The sidebar shortcut, through the worker's own command handler (US-040). */
async function pressShortcut(ext: Ext, tab: Page) {
  const [worker] = ext.context.serviceWorkers();
  if (!worker) throw new Error("extension service worker not running");
  await worker.evaluate(async (url) => {
    const [t] = await chrome.tabs.query({ url });
    const run = Reflect.get(globalThis, "watchsyncCommand");
    if (typeof run === "function") await run("toggle-sidebar", t);
  }, tab.url());
}

test("the pill opens the sidebar; close and Esc collapse it and give focus back", async ({
  ext,
}) => {
  const { tab, code } = await inRoom(ext);
  await expect(sidebar(tab)).toBeHidden();
  await expect(openButton(tab)).toBeVisible();

  const chat = tab.getByRole("button", { name: "Open chat" });
  await chat.click();
  await expect(sidebar(tab)).toBeVisible();
  await expect(sidebar(tab).getByText(`Room ${code}`)).toBeVisible();
  await expect(closeButton(tab)).toBeFocused();
  await expect(chat).toHaveAttribute("aria-expanded", "true");
  // About 320 px, over the right edge of the page (once its slide-in has settled).
  const edges = async () => {
    const box = await sidebar(tab).boundingBox();
    return { width: box?.width, right: (box?.x ?? 0) + (box?.width ?? 0) };
  };
  const right = (tab.viewportSize()?.width ?? 0) - 16;
  await expect.poll(edges).toEqual({ width: 320, right });
  // Collapsed button gone while open: one WatchSync button at a time.
  await expect(openButton(tab)).toHaveCount(0);

  await closeButton(tab).click();
  await expect(sidebar(tab)).toBeHidden();
  await expect(chat).toBeFocused();
  await expect(chat).toHaveAttribute("aria-expanded", "false");
  await expect(openButton(tab)).toHaveCount(1);

  await chat.click();
  await expect(closeButton(tab)).toBeFocused();
  await tab.keyboard.press("Escape");
  await expect(sidebar(tab)).toBeHidden();
  await expect(chat).toBeFocused();

  // The collapsed button opens it too, and gets focus back.
  await openButton(tab).click();
  await expect(sidebar(tab)).toBeVisible();
  await tab.keyboard.press("Escape");
  await expect(openButton(tab)).toBeFocused();
});

test("the shortcut opens the sidebar with focus inside, and closes it again", async ({ ext }) => {
  const { tab } = await inRoom(ext);
  // A real extension command, so people can change it at chrome://extensions/shortcuts.
  const [worker] = ext.context.serviceWorkers();
  const commands = await worker?.evaluate(() => chrome.commands.getAll());
  expect(commands?.find((c) => c.name === "toggle-sidebar")?.description).toBe(
    "Open or close the WatchSync sidebar",
  );
  const before = await tab.evaluate(() => {
    const b = document.querySelector("button");
    b?.focus();
    return b?.textContent;
  });
  expect(before).toBe("Full screen");
  await pressShortcut(ext, tab);
  await expect(sidebar(tab)).toBeVisible();
  await expect(closeButton(tab)).toBeFocused();
  await pressShortcut(ext, tab);
  await expect(sidebar(tab)).toBeHidden();
  await expect(tab.getByRole("button", { name: "Full screen" })).toBeFocused();
});

test("not in a room: no sidebar and no button", async ({ ext }) => {
  const pop = await popup(ext, "Suhaas");
  await expect(pop.getByRole("button", { name: "Create a room" })).toBeVisible();
  const tab = await ext.context.newPage();
  await tab.goto(`${MOCK}/watch/ep1`);
  await tab.waitForTimeout(1500);
  await pressShortcut(ext, tab);
  await tab.waitForTimeout(500);
  await expect(tab.locator("watchsync-sidebar")).toHaveCount(0);
  await expect(openButton(tab)).toHaveCount(0);
});

test("leaving the room removes the sidebar and its button", async ({ ext }) => {
  const { pop, tab } = await inRoom(ext);
  await tab.getByRole("button", { name: "Open chat" }).click();
  await expect(sidebar(tab)).toBeVisible();
  await pop.getByRole("button", { name: "Leave room" }).click();
  await expect(tab.locator("watchsync-sidebar")).toHaveCount(0);
  await expect(openButton(tab)).toHaveCount(0);
});
