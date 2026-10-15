// One WatchSync after updating (US-133): the same extension ID wherever the folder is, the
// update notice's steps, and a warning when two copies run in one Chrome. (That replacing the
// folder of an older zip keeps one copy is Chrome's own behaviour: the owner checks it by hand.)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";
import { expect, launchWithExtension, MOCK, test } from "./fixtures";

const extension = path.resolve(import.meta.dirname, "..");
const dist = path.resolve(extension, "dist");
/** The IDs of WatchSync and WatchSync Dev, from their fixed keys (scripts/extension-key.test.mjs). */
const PROD_ID = "dgoifalfabkpbnpcmahfngmhjaekcdkj";
const DEV_ID = "ffehhcgkamjnfflfblajdabolliifocj";

/** The address of Chrome's extensions page, as a tab of the profile shows it. */
const CHROME_EXTENSIONS = expect.stringMatching(/^chrome:\/\/extensions/);
/** The addresses of the profile's open tabs (a welcome tab of another copy may come and go). */
const tabUrls = (context: BrowserContext) => context.pages().map((p) => p.url());

const folders: string[] = [];
/** A build of the test extension in a folder of its own, of either channel. */
function build(channel: "prod" | "dev"): string {
  const out = mkdtempSync(path.join(tmpdir(), `watchsync-copy-${channel}-`));
  folders.push(out);
  execFileSync("node", ["build.mjs"], {
    cwd: extension,
    env: { ...process.env, WATCHSYNC_MOCK: "1", WATCHSYNC_CHANNEL: channel, WATCHSYNC_OUT: out },
  });
  return out;
}

test.afterAll(() => {
  for (const f of folders) rmSync(f, { recursive: true, force: true });
});

test("the extension has the same ID whichever folder it is loaded from", async () => {
  const here = await launchWithExtension("");
  const elsewhere = await launchWithExtension("", { build: build("prod") });
  const dev = await launchWithExtension("", { build: build("dev") });
  try {
    expect(here.extensionId).toBe(PROD_ID);
    expect(elsewhere.extensionId).toBe(PROD_ID);
    // WatchSync Dev has an ID of its own, so it still installs next to the real one.
    expect(dev.extensionId).toBe(DEV_ID);
  } finally {
    await here.context.close();
    await elsewhere.context.close();
    await dev.context.close();
  }
});

test("a lone copy announces itself and warns about nothing", async () => {
  const ext = await launchWithExtension("");
  try {
    const page = await ext.context.newPage();
    await page.goto(`${MOCK}/watch/ep1`);
    await expect(page.locator("watchsync-copy")).toHaveCount(1);
    await expect(page.locator("watchsync-copy")).toHaveAttribute("data-id", ext.extensionId);
    await page.waitForTimeout(2000);
    await expect(page.getByText(/Two copies of WatchSync/)).toHaveCount(0);
  } finally {
    await ext.context.close();
  }
});

test("two copies in one Chrome: one warning, with the way to remove one", async () => {
  const ext = await launchWithExtension("", { build: `${dist},${build("dev")}` });
  try {
    const page = await ext.context.newPage();
    await page.goto(`${MOCK}/watch/ep1`);
    await expect(page.locator("watchsync-copy")).toHaveCount(2);
    // Both copies see each other; only one says so.
    const warning = page.getByText(
      "Two copies of WatchSync are running in this Chrome, so they can fight over the film. Remove one at chrome://extensions.",
    );
    await expect(warning).toHaveCount(1);
    await expect(warning).toBeVisible();
    await page.getByRole("button", { name: "Open extensions" }).click();
    await expect
      .poll(() => tabUrls(ext.context), { timeout: 5000 })
      .toContainEqual(CHROME_EXTENSIONS);
  } finally {
    await ext.context.close();
  }
});

test("the update notice says how to update, and sends nobody to a store", async () => {
  const profile = mkdtempSync(path.join(tmpdir(), "watchsync-update-steps-"));
  const url = "https://github.com/SuhaasNv/watchsync/releases/tag/v9.0.0";
  try {
    const first = await launchWithExtension(profile);
    const [worker] = first.context.serviceWorkers();
    if (!worker) throw new Error("no service worker");
    const cached = () =>
      worker.evaluate(async () => (await chrome.storage.local.get("updateCheck")).updateCheck);
    await expect.poll(cached).toBeTruthy();
    await worker.evaluate(
      (url) =>
        chrome.storage.local.set({
          updateCheck: { checkedAt: Date.now(), latest: { version: "9.0.0", url } },
        }),
      url,
    );
    await first.context.close();

    const again = await launchWithExtension(profile);
    try {
      const page = await again.context.newPage();
      await page.goto(`chrome-extension://${again.extensionId}/popup.html`);
      await expect(page.getByText("WatchSync 9.0.0 is out")).toBeVisible();
      const steps = page.locator(".foot .update li");
      await expect(steps.nth(0)).toHaveText(
        "Unzip it over your WatchSync folder, replacing the files.",
      );
      await expect(steps.nth(1)).toContainText("press the reload arrow on WatchSync");
      // No link to a store: the one link goes to the release.
      await expect(page.locator(".foot .update a")).toHaveCount(1);
      await expect(page.locator(".foot .update a")).toHaveAttribute("href", url);
      expect(
        await page
          .locator("a[href*='chromewebstore'], a[href*='chrome.google.com/webstore']")
          .count(),
      ).toBe(0);
      await page.getByRole("button", { name: "chrome://extensions" }).click();
      await expect
        .poll(() => tabUrls(again.context), { timeout: 5000 })
        .toContainEqual(CHROME_EXTENSIONS);
    } finally {
      await again.context.close();
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});
