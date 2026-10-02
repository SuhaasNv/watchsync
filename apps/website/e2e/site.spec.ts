import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, PAGES, test } from "./fixtures";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const WIDTHS = [375, 768, 1280, 1440];
const SHOTS = [375, 1280];

async function settle(page: Page) {
  // Scroll through once so sections that reveal on view reach their final state.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  // The slowest reveal (Flagship's last line) takes 1.3 s; axe reads mid-fade colours.
  await page.waitForTimeout(1600);
}

async function audit(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const name = (path: string) => (path === "/" ? "home" : path.replaceAll("/", ""));

for (const width of WIDTHS) {
  for (const path of PAGES) {
    test(`${path} at ${width}px: no WCAG 2.2 AA violations, no sideways scroll`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await settle(page);
      expect(await audit(page)).toEqual([]);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]);
      if (SHOTS.includes(width)) {
        await page.screenshot({ path: `screenshots/${name(path)}-${width}.png`, fullPage: true });
      }
    });
  }
}

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the hero demo starts paused and steps through stills", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Play demo" });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^Step 5:/ }).click();
    await expect(page.locator("[data-caption]")).toHaveText(/Maya gets an ad/);
    await expect(page.locator('[data-screen="sam"] [data-notice]')).toHaveText(
      "Maya is on an ad · about 0:06 left",
    );
    expect(await audit(page)).toEqual([]);
    await page.screenshot({ path: "screenshots/home-1280-reduced.png" });
  });
});

test("the hero demo can be paused and shows real notices", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Step 2:/ }).click();
  await page.waitForTimeout(1600);
  await expect(page.locator('[data-screen="leo"] [data-notice]')).toHaveText("Maya paused");
  const toggle = page.locator("[data-toggle]");
  await expect(toggle).toHaveAccessibleName("Pause demo");
  await toggle.click();
  await expect(toggle).toHaveAccessibleName("Play demo");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const before = await page.locator('[data-screen="sam"] [data-time]').textContent();
  await page.waitForTimeout(1200);
  expect(await page.locator('[data-screen="sam"] [data-time]').textContent()).toBe(before);
});

test("a visitor can pause, play and skip on any demo player", async ({ page }) => {
  await page.goto("/");
  const sam = page.locator('[data-screen="sam"]');
  const leo = page.locator('[data-screen="leo"]');
  const time = sam.locator("[data-time]");
  await sam.locator(".viewport").click({ position: { x: 40, y: 40 } });
  await expect(leo.locator("[data-notice]")).toHaveText("Sam paused");
  await expect(page.locator("[data-toggle]")).toHaveAccessibleName("Play demo");
  const paused = await time.textContent();
  await page.waitForTimeout(1200);
  expect(await time.textContent()).toBe(paused);
  await sam.locator("[data-play]").click();
  await expect(leo.locator("[data-notice]")).toHaveText("Sam pressed play");
  await expect(time).not.toHaveText(paused ?? "", { timeout: 2500 });
  // Play resumes the story itself: the scripted steps carry on.
  await expect(page.locator("[data-toggle]")).toHaveAccessibleName("Pause demo");
  const step = await page.locator('[aria-current="step"]').getAttribute("data-step");
  await expect(page.locator('[aria-current="step"]')).not.toHaveAttribute("data-step", step ?? "", {
    timeout: 5000,
  });
  const track = leo.locator("[data-track]");
  const box = await track.boundingBox();
  if (!box) throw new Error("no track");
  await track.click({ position: { x: box.width * 0.9, y: box.height / 2 } });
  await expect(sam.locator("[data-notice]")).toHaveText(/^Leo skipped ahead to 1:4\d:\d\d$/);
});

test("every download button points at the latest GitHub release", async ({ page }) => {
  await page.goto("/");
  const hrefs = await page
    .locator("a.btn.primary", { hasText: "Download" })
    .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(hrefs.length).toBeGreaterThan(1);
  for (const href of hrefs) {
    expect(href).toBe(
      "https://github.com/SuhaasNv/watchsync/releases/latest/download/watchsync-extension.zip",
    );
  }
});

test.describe("install guide", () => {
  test("browser tabs work from the keyboard and change the address", async ({ page }) => {
    await page.goto("/install/");
    const chrome = page.getByRole("tab", { name: "Chrome" });
    await expect(chrome).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toContainText("chrome://extensions");
    await chrome.focus();
    await page.keyboard.press("ArrowRight");
    const brave = page.getByRole("tab", { name: "Brave" });
    await expect(brave).toBeFocused();
    await expect(brave).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toContainText("brave://extensions");
    await expect(page.locator("#panel-chrome")).toBeHidden();
  });

  test("the address copy button copies and says so", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/install/");
    await page.getByRole("tabpanel").getByRole("button", { name: "Copy" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Copied" })).toHaveText(
      "Copied chrome://extensions",
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("chrome://extensions");
  });
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 375, height: 812 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });

  test("the download explains WatchSync runs on a computer", async ({ page }) => {
    await page.goto("/");
    const note = page.locator("[data-device-note]").first();
    await expect(note).toBeVisible();
    await expect(note).toContainText("WatchSync runs on your computer, in Chrome or Brave");
    expect(await audit(page)).toEqual([]);
    await page.screenshot({ path: "screenshots/home-375-phone.png" });
  });
});

test.describe("release notes", () => {
  test.describe("with a release", () => {
    test.use({ github: "release" });

    test("renders the notes safely, with badge and download", async ({ page }) => {
      await page.goto("/releases/");
      const card = page.locator(".release").first();
      await expect(card.getByRole("heading", { name: "WatchSync v0.1.0" })).toBeVisible();
      await expect(card).toContainText("Release candidate");
      await expect(
        card.getByRole("link", { name: "Download v0.1.0 release candidate" }),
      ).toHaveAttribute("href", /releases\/download\/v0\.1\.0-rc\.1\/watchsync-extension\.zip$/);
      await expect(card.locator("strong", { hasText: "Rooms" })).toBeVisible();
      await expect(card.locator("code", { hasText: "code" })).toBeVisible();
      await expect(card.locator("img")).toHaveCount(0);
      await expect(card).toContainText('<img src=x onerror="window.__xss=1">');
      expect(await page.evaluate(() => Reflect.get(window, "__xss"))).toBeUndefined();
      expect(await audit(page)).toEqual([]);
      await page.screenshot({ path: "screenshots/releases-1280-with-release.png", fullPage: true });
      // The version label under every download follows the newest release.
      await page.goto("/");
      await expect(page.locator("[data-version]").first()).toHaveText("v0.1.0 release candidate");
    });
  });

  test.describe("when GitHub is unreachable", () => {
    test.use({ github: "offline" });

    test("says so, links to GitHub, and keeps the changelog", async ({ page }) => {
      await page.goto("/releases/");
      await expect(page.getByText("We couldn't reach GitHub just now")).toBeVisible();
      await expect(page.getByRole("link", { name: "See every release on GitHub" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Changelog" })).toBeVisible();
      await expect(page.locator("[data-changelog]")).toContainText("Nobody gets left behind");
      await page.goto("/");
      await expect(page.locator("[data-version]").first()).toHaveText("v0.1.0 release candidate");
    });
  });

  test.describe("when GitHub rate-limits us", () => {
    test.use({ github: "limited" });

    test("asks to try again later", async ({ page }) => {
      await page.goto("/releases/");
      await expect(page.getByText("GitHub is asking us to slow down")).toBeVisible();
    });
  });

  test("with no releases, says none are published yet", async ({ page }) => {
    await page.goto("/releases/");
    await expect(page.getByText("No releases published yet")).toBeVisible();
  });
});

test("the 404 page is served for unknown paths", async ({ page }) => {
  const res = await page.goto("/nope/");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This scene got cut.");
});

test("no inline scripts or styles, for the site's Content-Security-Policy", async ({ request }) => {
  for (const path of PAGES) {
    const html = await (await request.get(path)).text();
    expect(html.match(/<script(?![^>]*\bsrc=)[^>]*>/g), path).toBeNull();
    expect(html.match(/<style[\s>]|\sstyle="|\son[a-z]+="/g), path).toBeNull();
  }
});
