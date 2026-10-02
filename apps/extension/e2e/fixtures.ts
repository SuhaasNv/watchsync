import path from "node:path";
import { type BrowserContext, test as base, chromium, expect } from "@playwright/test";

const dist = path.resolve(import.meta.dirname, "../dist");
const clip = path.resolve(import.meta.dirname, "mock/clip.webm");

export const MOCK = "http://localhost:4173";
const TITLES: Record<string, string> = {
  ep1: "Demo Show, E1",
  ep2: "Demo Show, E2",
  film: "Demo Film",
};

/** The mock player (a stand-in for a streaming service) at localhost:4173/watch/<id>. */
async function serveMockPlayer(context: BrowserContext) {
  await context.route(`${MOCK}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/clip.webm") return route.fulfill({ path: clip });
    const id = url.pathname.match(/^\/watch\/([\w-]+)$/)?.[1];
    if (!id) return route.fulfill({ status: 404, body: "not found" });
    const next = id === "ep1" ? `<a href="/watch/ep2">Next episode</a>` : "";
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Mock player</title><h1 data-title>${TITLES[id] ?? `Demo ${id}`}</h1>
        <video src="/clip.webm" width="640" height="360" muted autoplay controls></video>${next}`,
    });
  });
}

/** A Chromium profile with the built extension loaded. Each test gets its own. */
export async function launchWithExtension(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  await serveMockPlayer(context);
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

export type Ext = { context: BrowserContext; extensionId: string };

export async function popup(ext: Ext, name: string) {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  return page;
}

/** Host creates a room on ep1; friend joins by code. Returns both popups and a friend context. */
export async function room(ext: Ext) {
  const host = await popup(ext, "Suhaas");
  await host.getByRole("button", { name: "Create a room" }).click();
  const code = (await host.getByTestId("room-code").textContent()) ?? "";
  const hostTab = await ext.context.newPage();
  await hostTab.goto(`${MOCK}/watch/ep1`);
  await expect(host.getByText("Test player · Demo Show, E1")).toBeVisible();

  const friend = await launchWithExtension();
  const fpop = await popup(friend, "Asha");
  await fpop.getByRole("textbox", { name: "Or join a friend's room" }).fill(code);
  await fpop.getByRole("button", { name: "Join", exact: true }).click();
  await expect(fpop.getByTestId("room-code")).toHaveText(code);
  return { host, hostTab, friend, fpop };
}

export { expect };
