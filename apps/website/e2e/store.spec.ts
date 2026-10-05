import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, TEST_STORE_URL, test } from "./fixtures";

// Runs against the build made with PUBLIC_STORE_URL set (playwright.store.config.ts).

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const ZIP =
  "https://github.com/SuhaasNv/watchsync/releases/latest/download/watchsync-extension.zip";

async function settle(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1600);
}

async function audit(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const name = (path: string) => (path === "/" ? "home" : path.replaceAll("/", "-").slice(1, -1));

for (const width of [375, 1280]) {
  for (const path of ["/", "/install/", "/install/manual/", "/faq/"]) {
    test(`store build: ${path} at ${width}px passes WCAG 2.2 AA, no sideways scroll`, async ({
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
      await page.screenshot({
        path: `screenshots/store-${name(path)}-${width}.png`,
        fullPage: true,
      });
    });
  }
}

test("every install button says Add to Chrome and opens the store listing", async ({ page }) => {
  for (const path of ["/", "/features/", "/faq/", "/install/"]) {
    await page.goto(path);
    const buttons = page.getByRole("link", { name: "Add to Chrome", exact: true });
    // The header's, plus the page's own.
    expect(await buttons.count(), path).toBeGreaterThan(1);
    for (const href of await buttons.evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
      expect(href, path).toBe(TEST_STORE_URL);
    }
    await expect(page.locator(`a[href="${ZIP}"]`), path).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Download/ }), path).toHaveCount(0);
  }
  await page.goto("/");
  await expect(page.locator(".meta").first()).toContainText("Free, on the Chrome Web Store");
  const ld: unknown = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}",
  );
  expect(ld).toMatchObject({ installUrl: TEST_STORE_URL });
  expect(ld).not.toHaveProperty("downloadUrl");
});

test("/install/ is three steps with no Developer mode", async ({ page }) => {
  await page.goto("/install/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Install it in three steps.");
  const steps = page.locator(".guide .step h3");
  await expect(steps).toHaveText(["Add it to Chrome", "Pin WatchSync", "Make or join a room"]);
  await expect(page.getByRole("link", { name: "Open the Chrome Web Store" })).toHaveAttribute(
    "href",
    TEST_STORE_URL,
  );
  await expect(page.getByRole("tablist")).toHaveCount(0);
  const text = await page.locator("main").innerText();
  for (const gone of ["Developer mode", "Load unpacked", "unzip", "Unzip", "developer-mode"]) {
    expect(text, gone).not.toContain(gone);
  }
  // The store reviews it, so the zip's "Is it safe?" section and links are gone.
  await expect(page.locator("#safe")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Is it safe?" })).toHaveCount(0);
  await expect(
    page.locator(".reassure").getByRole("link", { name: "public on GitHub" }),
  ).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await page.getByRole("link", { name: "Install it from the zip." }).click();
  await expect(page).toHaveURL(/\/install\/manual\/$/);
});

test("/install/manual/ keeps the zip guide, out of search results", async ({ page, request }) => {
  await page.goto("/install/manual/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Install it in seven steps.");
  await expect(page.locator("main .head-cta a.btn.primary")).toHaveAttribute("href", ZIP);
  await expect(page.locator("main .head-cta")).toContainText("Free, from our public GitHub");
  const panel = page.getByRole("tabpanel");
  await expect(panel.locator(".step")).toHaveCount(7);
  await expect(panel).toContainText("Turn on Developer mode");
  await expect(panel).toContainText("Click Load unpacked");
  const safe = page.locator("#safe");
  await expect(safe).toContainText("join.watchsync.space");
  await safe.getByText("Check your download").click();
  await expect(safe.getByRole("button", { name: "Copy the attestation command" })).toBeVisible();
  await expect(page.getByRole("link", { name: "add it from the store" })).toHaveAttribute(
    "href",
    "/install/",
  );
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/install/</loc>");
  expect(sitemap).not.toContain("/install/manual/");
});

test("FAQ and goodbye answers follow the store", async ({ page }) => {
  await page.goto("/faq/");
  await expect(page.getByRole("heading", { name: "Do I need Developer mode?" })).toBeVisible();
  await expect(page.locator("#update")).toContainText(
    "update extensions from the Chrome Web Store",
  );
  await page.goto("/goodbye/");
  await expect(page.getByRole("link", { name: "Add WatchSync again" })).toHaveAttribute(
    "href",
    TEST_STORE_URL,
  );
  await expect(page.locator("main")).not.toContainText("Developer mode");
});

test("store pages keep to the Content-Security-Policy: no inline scripts or styles", async ({
  request,
}) => {
  for (const path of ["/", "/install/", "/install/manual/", "/faq/", "/goodbye/"]) {
    const html = await (await request.get(path)).text();
    expect(
      html.match(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>/g),
      path,
    ).toBeNull();
    expect(html.match(/<style[\s>]|\sstyle="|\son[a-z]+="/g), path).toBeNull();
  }
});
