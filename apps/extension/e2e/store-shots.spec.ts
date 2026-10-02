// Chrome Web Store screenshots from the real popup and welcome page, at 2x.
// Only runs on request: STORE_SHOTS=1 pnpm exec playwright test e2e/store-shots.spec.ts
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { expect, test } from "./fixtures";

const out = path.resolve(import.meta.dirname, "../store/raw");

test.skip(!process.env.STORE_SHOTS, "store screenshots are made on request");

test("capture popup and welcome screens", async () => {
  mkdirSync(out, { recursive: true });
  const dist = path.resolve(import.meta.dirname, "../dist");
  // 2x pixels: the store shows screenshots at 1280x800 and the popup is drawn at 360 px.
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const ext = { context, extensionId: new URL(worker.url()).host };
  try {
    const welcome =
      ext.context.pages().find((p) => p.url().endsWith("/welcome.html")) ??
      (await ext.context.waitForEvent("page"));
    await welcome.setViewportSize({ width: 1280, height: 800 });
    await welcome.waitForTimeout(2500);
    await welcome.screenshot({ path: path.join(out, "welcome.png"), scale: "css" });

    const page = await ext.context.newPage();
    // Chrome sizes the real popup to its content: a short viewport plus fullPage does the same.
    await page.setViewportSize({ width: 360, height: 200 });
    await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
    await page.getByLabel("Your name").fill("Sam");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("button", { name: "Create a room" })).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, "popup-home.png"), fullPage: true });

    await page.getByRole("button", { name: "Create a room" }).click();
    await expect(page.getByTestId("room-code")).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, "popup-invite.png"), fullPage: true });
  } finally {
    await ext.context.close();
  }
});
