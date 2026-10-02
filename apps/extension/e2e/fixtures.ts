import { readFileSync } from "node:fs";
import path from "node:path";
import {
  type BrowserContext,
  test as base,
  chromium,
  expect,
  type Page,
  type Route,
} from "@playwright/test";

const dist = path.resolve(import.meta.dirname, "../dist");
const clipBytes = readFileSync(path.resolve(import.meta.dirname, "mock/clip.webm"));

export const MOCK = "http://localhost:4173";
const TITLES: Record<string, string> = {
  ep1: "Demo Show, E1",
  ep2: "Demo Show, E2",
  film: "Demo Film",
  // Netflix shows its title text only with the controls: a page that starts without one.
  untitled: "",
};

/** Byte ranges make the clip seekable; without them Chrome snaps every seek back to 0. */
function serveClip(route: Route) {
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? "");
  const headers = { "accept-ranges": "bytes", "content-type": "video/webm" };
  if (!range) return route.fulfill({ status: 200, headers, body: clipBytes });
  const start = Number(range[1]);
  const end = range[2] ? Number(range[2]) : clipBytes.length - 1;
  return route.fulfill({
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${clipBytes.length}` },
    body: clipBytes.subarray(start, end + 1),
  });
}

/** The mock player (a stand-in for a streaming service) at localhost:4173/watch/<id>. */
async function serveMockPlayer(context: BrowserContext) {
  await context.route(`${MOCK}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/clip.webm") return serveClip(route);
    const id = url.pathname.match(/^\/watch\/([\w-]+)$/)?.[1];
    if (!id) return route.fulfill({ status: 404, body: "not found" });
    const next = id === "ep1" ? `<a href="/watch/ep2">Next episode</a>` : "";
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Mock player</title><h1 data-title>${TITLES[id] ?? `Demo ${id}`}</h1>
        <div id="player"><video src="/clip.webm" width="640" height="360" muted autoplay controls></video></div>
        <button onclick="document.getElementById('player').requestFullscreen()">Full screen</button>${next}`,
    });
  });
}

export const isWelcome = (page: Page) => page.url().endsWith("/welcome.html");

/**
 * A Chromium profile with the built extension loaded. Each test gets its own. A new profile
 * is a first install, so the welcome tab opens; it is closed unless `keepWelcome`.
 */
export async function launchWithExtension(
  userDataDir = "",
  { keepWelcome = false } = {},
): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  await serveMockPlayer(context);
  if (!keepWelcome) {
    const close = (page: Page) => {
      if (isWelcome(page)) page.close().catch(() => {});
    };
    for (const page of context.pages()) close(page);
    context.on("page", close);
  }
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
export async function room(ext: Ext, friendProfile = "") {
  const host = await popup(ext, "Suhaas");
  await host.getByRole("button", { name: "Create a room" }).click();
  const code = (await host.getByTestId("room-code").textContent()) ?? "";
  const hostTab = await ext.context.newPage();
  await hostTab.goto(`${MOCK}/watch/ep1`);
  await expect(host.getByText("Test player · Demo Show, E1")).toBeVisible();

  const loadedAt = Date.now();
  const friend = await launchWithExtension(friendProfile);
  const fpop = await popup(friend, "Asha");
  await fpop.getByRole("textbox", { name: "Or join a friend's room" }).fill(code);
  await fpop.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(fpop.getByTestId("room-code")).toHaveText(code);
  // Player events in the first 3 s after a page load are ignored (BUG-004): wait them out.
  await hostTab.waitForTimeout(Math.max(0, loadedAt + 3200 - Date.now()));
  return { host, hostTab, friend, fpop };
}

export { expect };
