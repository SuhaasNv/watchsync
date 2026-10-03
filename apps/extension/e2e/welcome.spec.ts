// First-run welcome page (UC-003): opens on install, explains the steps, saves a name.
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, isWelcome, launchWithExtension, test } from "./fixtures";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const summary = violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`);
  expect(summary).toEqual([]);
}

/** A fresh profile, keeping the welcome tab the install opened. */
async function welcome(): Promise<{ context: BrowserContext; extensionId: string; page: Page }> {
  const { context, extensionId } = await launchWithExtension("", { keepWelcome: true });
  await expect.poll(() => context.pages().some(isWelcome)).toBe(true);
  const page = context.pages().find(isWelcome);
  if (!page) throw new Error("no welcome tab");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome to WatchSync");
  return { context, extensionId, page };
}

/** Scrolls the whole page so every section has revealed itself. */
async function scrollThrough(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 300) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(40);
  }
}

test("opens on install; the mark animates, and holds still under reduced motion", async () => {
  const { context, page } = await welcome();
  try {
    const dot = page.locator(".dot-move");
    await expect(dot).toHaveCSS("animation-name", "from-left");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(dot).toHaveCSS("animation-name", "none");
    // Reduced motion shows each scene's finished frame: the pinned mark is already there.
    await expect(page.locator(".s1 .pinned")).toHaveCSS("opacity", "1");
    await expect(page.locator(".s1 .pinned")).toHaveCSS("animation-name", "none");
    await expect(page.getByRole("link", { name: "Read the privacy notice" })).toHaveAttribute(
      "href",
      "https://watchsync.space/privacy/",
    );
  } finally {
    await context.close();
  }
});

test("not pinned: an arrow points up at Chrome's puzzle icon, top right", async () => {
  const { context, page } = await welcome();
  try {
    await page.emulateMedia({ reducedMotion: "reduce" }); // no bounce: the arrow holds still
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 });
      const arrow = page.locator(".pointer-arrow");
      await expect(arrow).toBeVisible();
      await expect(page.locator("#pin-text")).toHaveText("Not pinned yet");
      const box = await arrow.boundingBox();
      const fromRight = width - ((box?.x ?? 0) + (box?.width ?? 0) / 2);
      expect(fromRight).toBeGreaterThanOrEqual(96);
      expect(fromRight).toBeLessThanOrEqual(140);
      expect(box?.y).toBe(0);
      await expect(page.locator("#pointer-text")).toContainText("puzzle icon");
    }
  } finally {
    await context.close();
  }
});

test("the steps work by keyboard and announce themselves", async () => {
  const { context, page } = await welcome();
  try {
    const pin = page.getByRole("tab", { name: "Pin" });
    await pin.focus();
    await page.keyboard.press("ArrowRight");
    const room = page.getByRole("tab", { name: "Room" });
    await expect(room).toBeFocused();
    await expect(room).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Create a room, or join one" })).toBeVisible();
    await expect(page.locator("#step-1")).toBeHidden();

    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Watch" })).toBeFocused();
    await expect(page.getByRole("heading", { name: "Watch like you always do" })).toBeVisible();
    await page.keyboard.press("ArrowRight"); // wraps to the first step
    await expect(pin).toBeFocused();
    await page.keyboard.press("Home");
    await expect(pin).toHaveAttribute("aria-selected", "true");

    const next = page.getByRole("button", { name: "Next" });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#tour-live")).toHaveText("Step 2 of 4: Create a room, or join one");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Watch like you always do" })).toBeVisible();
    await page.getByRole("button", { name: "Finish" }).press("Enter");
    await expect(page.getByRole("heading", { name: "Before you go" })).toBeFocused();
  } finally {
    await context.close();
  }
});

test("a name saved here opens the popup on its home screen", async () => {
  const { context, extensionId, page } = await welcome();
  try {
    const name = page.getByRole("textbox", { name: "Your name" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Enter your name." })).toBeVisible();
    await name.fill("...");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Use at least one letter or number." }),
    ).toBeVisible();
    await expect(name).toHaveAttribute("aria-invalid", "true");

    await name.fill("Maya");
    await name.press("Enter");
    await expect(page.getByText("Saved. Friends will see you as Maya.")).toBeVisible();

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole("button", { name: "Create a room" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("let's go keeps a typed name and closes the tab", async () => {
  const { context, extensionId, page } = await welcome();
  try {
    await page.getByRole("textbox", { name: "Your name" }).fill("Asha");
    const closed = page.waitForEvent("close");
    await page.getByRole("button", { name: "I've pinned it, let's go" }).click();
    await closed;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole("button", { name: "Create a room" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("welcome page passes WCAG 2.2 AA at desktop and phone widths", async () => {
  const { context, page } = await welcome();
  try {
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.reload();
      await scrollThrough(page);
      await page.waitForTimeout(800); // reveals and the first scene finish
      await audit(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

      // Each step, with nothing mid-animation.
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (const step of ["Room", "Open", "Watch"]) {
        await page.getByRole("tab", { name: step }).click();
        await audit(page);
      }
      await page.getByRole("button", { name: "Show me where" }).click();
      await expect(page.getByRole("button", { name: "Got it" })).toBeFocused();
      await audit(page);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Show me where" })).toBeFocused();
    }
  } finally {
    await context.close();
  }
});
