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

// ---- US-041: full screen, player controls, fading, page width ----

const inFullscreen = (tab: Page) => tab.evaluate(() => document.fullscreenElement?.id ?? null);

/** Puts a line in the sidebar's body, standing in for chat that must survive full screen. */
const markBody = (tab: Page) =>
  tab.evaluate(() => {
    const body = document
      .querySelector("watchsync-sidebar")
      ?.shadowRoot?.querySelector("[data-sidebar-body]");
    const p = document.createElement("p");
    p.textContent = "kept message";
    body?.append(p);
  });

/**
 * The sidebar (or, collapsed, its button) is what's painted at its centre: in full screen
 * only the fullscreen element and what's inside it are shown.
 */
const onTop = (tab: Page) =>
  tab.evaluate(() => {
    const host = document.querySelector("watchsync-sidebar");
    const shown = host?.shadowRoot?.querySelector(".panel:not([hidden]), .toggle:not([hidden])");
    const r = shown?.getBoundingClientRect();
    if (!r) return false;
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === host;
  });

/** No part of the sidebar over the player's top or bottom control strips. */
async function clearOfControls(tab: Page) {
  const box = await sidebar(tab).boundingBox();
  const height = await tab.evaluate(() => window.innerHeight);
  expect(box?.y).toBeGreaterThanOrEqual(72);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height - 120);
  // The mock player's own controls answer clicks where they are, not the sidebar.
  const hit = await tab.evaluate(() => {
    const r = document.querySelector("video")?.getBoundingClientRect();
    if (!r) return null;
    return document.elementFromPoint(r.left + r.width / 2, r.bottom - 10)?.tagName ?? null;
  });
  expect(hit).toBe("VIDEO");
}

test("the sidebar stays open with its content in and out of full screen", async ({ ext }) => {
  const { tab } = await inRoom(ext);
  await tab.getByRole("button", { name: "Open chat" }).click();
  await markBody(tab);
  await tab.getByRole("button", { name: "Full screen" }).click();
  await expect.poll(() => inFullscreen(tab)).toBe("player");
  await expect.poll(() => onTop(tab)).toBe(true);
  await expect(sidebar(tab).getByText("kept message")).toBeVisible();
  await clearOfControls(tab);
  // Still usable inside full screen.
  await closeButton(tab).click();
  await expect(sidebar(tab)).toBeHidden();
  await openButton(tab).click();
  await expect(sidebar(tab).getByText("kept message")).toBeVisible();

  await tab.evaluate(() => document.exitFullscreen());
  await expect.poll(() => inFullscreen(tab)).toBe(null);
  await expect.poll(() => onTop(tab)).toBe(true);
  await expect(sidebar(tab).getByText("kept message")).toBeVisible();
  await expect(closeButton(tab)).toBeFocused(); // moving out of full screen kept focus
});

test("opened inside full screen, it shows there", async ({ ext }) => {
  const { tab } = await inRoom(ext);
  await tab.getByRole("button", { name: "Full screen" }).click();
  await expect.poll(() => inFullscreen(tab)).toBe("player");
  await expect.poll(() => onTop(tab)).toBe(true); // its button shows in full screen
  await openButton(tab).click();
  await expect.poll(() => onTop(tab)).toBe(true);
  await expect(closeButton(tab)).toBeFocused();
  await clearOfControls(tab);
});

test("open at 1280 px: no horizontal scroll, player untouched, controls clear", async ({ ext }) => {
  const { tab } = await inRoom(ext);
  await tab.setViewportSize({ width: 1280, height: 720 });
  const player = () => tab.locator("video").boundingBox();
  const before = await player();
  await tab.getByRole("button", { name: "Open chat" }).click();
  await expect(sidebar(tab)).toBeVisible();
  expect(await player()).toEqual(before);
  const overflow = await tab.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  await clearOfControls(tab);
  // Notices and prompts move beside the sidebar instead of covering it.
  const noticesRight = () =>
    tab.evaluate(
      () =>
        document
          .querySelector("watchsync-overlay")
          ?.shadowRoot?.querySelector(".wrap")
          ?.getBoundingClientRect().right ?? 0,
    );
  const box = await sidebar(tab).boundingBox();
  expect(await noticesRight()).toBeLessThanOrEqual(box?.x ?? 0);
  await closeButton(tab).click();
  await expect.poll(noticesRight).toBe(1280 - 24);
});

test("the collapsed button fades with the controls and comes back on mouse move", async ({
  ext,
}) => {
  const { tab } = await inRoom(ext);
  const opacity = () => openButton(tab).evaluate((b) => getComputedStyle(b).opacity);
  await tab.mouse.move(10, 10);
  await expect.poll(opacity).toBe("1");
  await expect.poll(opacity, { timeout: 6000 }).toBe("0");
  await tab.mouse.move(40, 40);
  await expect.poll(opacity).toBe("1");
});
