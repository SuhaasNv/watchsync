import path from "node:path";
import { type BrowserContext, test as base, chromium } from "@playwright/test";

const dist = path.resolve(import.meta.dirname, "../dist");

/** A Chromium profile with the built extension loaded. Each test gets its own. */
export async function launchWithExtension(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  return { context, extensionId };
}

export const test = base.extend<{ ext: { context: BrowserContext; extensionId: string } }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
  ext: async ({}, use) => {
    const ext = await launchWithExtension();
    await use(ext);
    await ext.context.close();
  },
});
export { expect } from "@playwright/test";
