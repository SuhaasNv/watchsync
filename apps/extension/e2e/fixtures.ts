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
    // ?steal=1: a player that grabs focus every 800 ms and toggles play on Space, k and Enter,
    // like the real ones do (BUG-073). Pauses are counted on window.__pauses. (Slower than
    // that, a page that took focus every 150 ms is one the panel gives up on after 5 times in
    // 3 s, and the hint then stays: the panel only fights a thief it can win against.)
    const steal =
      url.searchParams.get("steal") === "1"
        ? `<script>
            const player = document.getElementById("player");
            const video = document.querySelector("video");
            window.__pauses = 0;
            video.addEventListener("pause", () => { window.__pauses += 1; });
            const toggle = () => (video.paused ? video.play() : video.pause());
            player.tabIndex = -1;
            setInterval(() => player.focus(), 800);
            document.addEventListener("keydown", (e) => {
              if (e.code === "Space" || e.key === "k" || e.key === "Enter") toggle();
            });
            document.addEventListener("keyup", (e) => {
              if (e.key === "Enter") toggle();
            });
          </script>`
        : "";
    // ?slow=ms: a player whose seeks land that many ms late, like a streaming player that has
    // to buffer the new spot: it holds still at the new spot, then plays on and only then says
    // "seeked". ?coarse=ms: a player that can only land on multiples of that many ms (HLS
    // segments). The extension reads the page from its own JavaScript world, so a patched
    // currentTime can't reach it; these work on the media events, which both worlds share.
    // Seeks made from outside are counted on window.__seeks.
    const slow = Number(url.searchParams.get("slow") ?? 0);
    const coarse = Number(url.searchParams.get("coarse") ?? 0);
    const seeking =
      slow > 0 || coarse > 0
        ? `<script>
            const seekable = document.querySelector("video");
            const step = ${coarse} / 1000;
            let holding = false;
            let mineUntil = 0;
            window.__seeks = 0;
            const hush = (e) => {
              if (holding) e.stopImmediatePropagation();
            };
            for (const type of ["seeked", "pause", "play", "playing"])
              window.addEventListener(type, hush, true);
            window.addEventListener(
              "seeking",
              () => {
                if (performance.now() < mineUntil) return;
                window.__seeks += 1;
                const wasPlaying = !seekable.paused;
                if (step > 0) {
                  mineUntil = performance.now() + 50;
                  seekable.currentTime = Math.round(seekable.currentTime / step) * step;
                }
                if (${slow} > 0) {
                  holding = true;
                  seekable.pause();
                  setTimeout(() => {
                    const landed = () => {
                      holding = false;
                      seekable.dispatchEvent(new Event("seeked"));
                    };
                    if (wasPlaying) seekable.play().then(landed, landed);
                    else landed();
                  }, ${slow});
                }
              },
              true,
            );
          </script>`
        : "";
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Mock player</title><h1 data-title>${TITLES[id] ?? `Demo ${id}`}</h1>
        <div id="player"><video src="/clip.webm" width="640" height="360" muted autoplay controls></video></div>
        <button onclick="document.getElementById('player').requestFullscreen()">Full screen</button>${next}${steal}${seeking}`,
    });
  });
}

export const isWelcome = (page: Page) => page.url().endsWith("/welcome.html");

/**
 * A Chromium profile with the built extension loaded. Each test gets its own. A new profile
 * is a first install, so the welcome tab opens; it is closed unless `keepWelcome`. `build`
 * loads another build of the extension (one made against another room service).
 */
export async function launchWithExtension(
  userDataDir = "",
  { keepWelcome = false, build = dist } = {},
): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`],
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
