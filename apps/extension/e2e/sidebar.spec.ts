// The WatchSync chat panel (UC-013): opening, closing, full screen and keyboard use. The
// panel's content is an extension frame (DEC-042); the page only holds its shell.
import type { Frame, Page } from "@playwright/test";
import { type Ext, expect, MOCK, popup, test } from "./fixtures";

/** One person in a room, watching ep1. */
async function inRoom(ext: Ext) {
  const pop = await popup(ext, "Suhaas");
  await pop.getByRole("button", { name: "Create a room" }).click();
  const code = (await pop.getByTestId("room-code").first().textContent()) ?? "";
  const tab = await ext.context.newPage();
  await tab.goto(`${MOCK}/watch/ep1`);
  await expect(chatButton(tab)).toBeVisible();
  return { pop, tab, code };
}

const chatButton = (tab: Page) => tab.getByRole("button", { name: /^(Open|Close) chat/ });
const panel = (tab: Page) => tab.getByRole("region", { name: "WatchSync", exact: true });
const frame = (tab: Page) => tab.frameLocator("watchsync-sidebar iframe");
const closeButton = (tab: Page) => frame(tab).getByRole("button", { name: "Close chat" });
/** From the message box back to the close button by keyboard (the message list, which
 * scrolls, is a stop on the way). */
async function backToClose(tab: Page) {
  for (let i = 0; i < 3; i++) {
    await tab.keyboard.press("Shift+Tab");
    if (await closeButton(tab).evaluate((b) => b === document.activeElement)) return;
  }
}
/** Where focus goes when chat opens (UC-014). */
const messageBox = (tab: Page) => frame(tab).getByRole("textbox", { name: "Message" });

/**
 * The panel's slide-in has ended. Playwright's own wait for a still element can't see it: it
 * moves the frame, not the buttons inside the frame.
 */
const settled = (tab: Page) =>
  expect
    .poll(() =>
      tab.evaluate(() => {
        const p = document.querySelector("watchsync-sidebar")?.shadowRoot?.querySelector(".panel");
        return p instanceof HTMLElement && !p.hidden && p.getAnimations().length === 0;
      }),
    )
    .toBe(true);

/** The chat frame itself, for checks that run inside it. */
async function chatFrame(tab: Page): Promise<Frame> {
  const isChat = (f: Frame) => new URL(f.url()).pathname === "/sidebar.html";
  await expect.poll(() => tab.frames().some(isChat)).toBe(true);
  const f = tab.frames().find(isChat);
  if (!f) throw new Error("chat frame not loaded");
  return f;
}

/** The chat shortcut, through the worker's own command handler (US-040). */
async function pressShortcut(ext: Ext, tab: Page) {
  const [worker] = ext.context.serviceWorkers();
  if (!worker) throw new Error("extension service worker not running");
  const ran = await worker.evaluate(async (url) => {
    const [t] = await chrome.tabs.query({ url });
    const run = Reflect.get(globalThis, "watchsyncCommand");
    if (typeof run !== "function") return false;
    await run("toggle-sidebar", t);
    return true;
  }, tab.url());
  if (!ran) throw new Error("watchsyncCommand is missing: build with WATCHSYNC_MOCK=1");
}

test("the pill's chat button opens and closes chat; Esc and close give focus back", async ({
  ext,
}) => {
  const { tab, code } = await inRoom(ext);
  await expect(panel(tab)).toHaveCount(0);
  // The shortcut as Chrome suggests it here: Control+Shift+W on a Mac, Alt+Shift+W elsewhere.
  await expect(chatButton(tab)).toHaveAttribute(
    "aria-label",
    /^Open chat \((Control|Alt)\+Shift\+W\)$/,
  );
  const label = await chatButton(tab).getAttribute("aria-label");
  await expect(chatButton(tab)).toHaveAttribute("title", label ?? "");
  await expect(chatButton(tab)).toHaveAttribute("aria-expanded", "false");

  await chatButton(tab).click();
  await expect(panel(tab)).toBeVisible();
  await expect(frame(tab).getByText(`Room ${code}`)).toBeVisible();
  await expect(frame(tab).getByText("Messages from the room show up here.")).toBeVisible();
  await expect(messageBox(tab)).toBeFocused();
  await expect(chatButton(tab)).toHaveAttribute("aria-label", "Close chat");
  await expect(chatButton(tab)).toHaveAttribute("aria-expanded", "true");
  // About 320 px, over the right edge of the page (once its slide-in has settled).
  const edges = async () => {
    const box = await panel(tab).boundingBox();
    return { width: box?.width, right: (box?.x ?? 0) + (box?.width ?? 0) };
  };
  const right = (tab.viewportSize()?.width ?? 0) - 16;
  await expect.poll(edges).toEqual({ width: 320, right });

  // The same button closes it: one way in and out.
  await chatButton(tab).click();
  await expect(panel(tab)).toBeHidden();
  await expect(chatButton(tab)).toHaveAttribute("aria-expanded", "false");

  await chatButton(tab).click();
  await expect(messageBox(tab)).toBeFocused();
  await tab.keyboard.press("Escape");
  await expect(panel(tab)).toBeHidden();
  await expect(chatButton(tab)).toBeFocused();

  await chatButton(tab).click();
  await settled(tab);
  await closeButton(tab).click();
  await expect(panel(tab)).toBeHidden();
  await expect(chatButton(tab)).toBeFocused();
});

test("the shortcut opens chat with focus inside, and closes it again", async ({ ext }) => {
  const { tab } = await inRoom(ext);
  // A real extension command, so people can change it at chrome://extensions/shortcuts.
  const [worker] = ext.context.serviceWorkers();
  const commands = await worker?.evaluate(() => chrome.commands.getAll());
  expect(commands?.find((c) => c.name === "toggle-sidebar")?.description).toBe(
    "Open or close WatchSync chat",
  );
  await tab.getByRole("button", { name: "Full screen" }).focus();
  await pressShortcut(ext, tab);
  await expect(panel(tab)).toBeVisible();
  await expect(messageBox(tab)).toBeFocused();
  await pressShortcut(ext, tab);
  await expect(panel(tab)).toBeHidden();
  await expect(tab.getByRole("button", { name: "Full screen" })).toBeFocused();
});

test("not in a room: no chat and no chat button", async ({ ext }) => {
  const pop = await popup(ext, "Suhaas");
  await expect(pop.getByRole("button", { name: "Create a room" })).toBeVisible();
  const tab = await ext.context.newPage();
  await tab.goto(`${MOCK}/watch/ep1`);
  await tab.waitForTimeout(1500);
  await pressShortcut(ext, tab);
  await tab.waitForTimeout(500);
  await expect(tab.locator("watchsync-sidebar")).toHaveCount(0);
  await expect(chatButton(tab)).toHaveCount(0);
});

test("leaving the room removes chat and its button", async ({ ext }) => {
  const { pop, tab } = await inRoom(ext);
  await chatButton(tab).click();
  await expect(panel(tab)).toBeVisible();
  await pop.getByRole("button", { name: "Leave room" }).click();
  await expect(tab.locator("watchsync-sidebar")).toHaveCount(0);
  await expect(chatButton(tab)).toHaveCount(0);
  expect(tab.frames().some((f) => f.url().includes("/sidebar.html"))).toBe(false);
});

test("the popup shows the chat shortcut", async ({ ext }) => {
  const { pop } = await inRoom(ext);
  await expect(pop.getByText(/^Open chat on the player with .+W$/)).toBeVisible();
});

// ---- Privacy (DEC-042): keys typed in chat never reach the service page ----

test("a page listening on window in the capture phase hears nothing typed in chat", async ({
  ext,
}) => {
  const { tab } = await inRoom(ext);
  await expect.poll(() => playing(tab)).toBe(true);
  await tab.evaluate(() => {
    const heard: string[] = [];
    Reflect.set(window, "heard", heard);
    for (const type of ["keydown", "keyup", "keypress", "input", "beforeinput"])
      window.addEventListener(type, (e) => heard.push(`${e.type}:${Reflect.get(e, "key")}`), true);
  });
  await playerKeys(tab);
  await chatButton(tab).click();
  await expect(messageBox(tab)).toBeFocused();
  await tab.keyboard.type("hello k");
  await tab.keyboard.press("Space");
  await expect(messageBox(tab)).toHaveValue("hello k ");
  await tab.keyboard.press("Escape");
  await expect(panel(tab)).toBeHidden();
  const heard = await tab.evaluate(() => Reflect.get(window, "heard"));
  expect(heard).toEqual([]);
  expect(await reached(tab)).toBe(0);
  expect(await playing(tab)).toBe(true);
});

test("the page can't hide chat, and a page that removes it gets it back, connected", async ({
  ext,
}) => {
  const { tab, code } = await inRoom(ext);
  await chatButton(tab).click();
  await expect(frame(tab).getByText(`Room ${code}`)).toBeVisible();
  await tab.evaluate(() => {
    const host = document.querySelector("watchsync-sidebar");
    if (host instanceof HTMLElement) host.style.setProperty("display", "none", "important");
  });
  await expect.poll(() => onTop(tab)).toBe(true);
  await tab.evaluate(() => document.querySelector("watchsync-sidebar")?.remove());
  await expect(tab.locator("watchsync-sidebar")).toHaveCount(1);
  // Re-adding reloads the frame; a new frame with a new pass takes its place and draws the
  // room again, once (no reload loop).
  await expect(frame(tab).getByText(`Room ${code}`)).toBeVisible();
  const url = (await chatFrame(tab)).url();
  await tab.waitForTimeout(1500);
  expect((await chatFrame(tab)).url()).toBe(url);
  await expect(frame(tab).getByText(`Room ${code}`)).toBeVisible();
});

test("a scripted click in the chat frame does nothing; only the person's own does", async ({
  ext,
}) => {
  const { tab } = await inRoom(ext);
  await chatButton(tab).click();
  await expect(messageBox(tab)).toBeFocused();
  const f = await chatFrame(tab);
  await f.evaluate(() => {
    document.getElementById("close")?.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await tab.waitForTimeout(500);
  await expect(panel(tab)).toBeVisible();
  await settled(tab);
  await closeButton(tab).click();
  await expect(panel(tab)).toBeHidden();
});

test("a page that points the chat frame at its own page gets the real one back; three times turns chat off", async ({
  ext,
}) => {
  const { tab, code } = await inRoom(ext);
  // The service page's own fake chat, served from its own origin so it could read keys.
  await ext.context.route(`${MOCK}/fake-chat`, (r) =>
    r.fulfill({ contentType: "text/html", body: "<p>Fake chat</p>" }),
  );
  // window.frames leaves out frames in shadow trees, so a page can't reach ours that way; it
  // would have to capture the closed shadow root (patching attachShadow before we run). The
  // test build's open root stands in for that.
  expect(await tab.evaluate(() => window.frames.length)).toBe(0);
  const hijack = () =>
    tab.evaluate(() => {
      const f = document
        .querySelector("watchsync-sidebar")
        ?.shadowRoot?.querySelector("iframe")?.contentWindow;
      if (!f) throw new Error("no chat frame to hijack");
      f.location.href = "http://localhost:4173/fake-chat";
    });
  const fakeShown = () => tab.frames().some((f) => f.url().endsWith("/fake-chat"));
  await chatButton(tab).click();
  await expect(frame(tab).getByText(`Room ${code}`)).toBeVisible();

  for (let i = 0; i < 2; i++) {
    await hijack();
    // Within a second the page's frame is gone and the real chat is back, connected.
    await expect.poll(fakeShown, { timeout: 1000 }).toBe(false);
    await expect(frame(tab).getByText(`Room ${code}`)).toBeVisible({ timeout: 1000 });
  }

  await hijack();
  const off = "Chat is turned off on this page because the page interfered with it.";
  await expect(tab.getByText(off)).toBeVisible();
  await expect(tab.locator("watchsync-sidebar")).toHaveCount(0);
  await expect.poll(fakeShown).toBe(false);
  const button = tab.getByRole("button", { name: off });
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await button.click({ force: true }); // a person can still press it; nothing opens
  await expect(tab.locator("watchsync-sidebar")).toHaveCount(0);
});

test("the page never sees the chat frame's pass", async ({ ext }) => {
  const { tab, code } = await inRoom(ext);
  await chatButton(tab).click();
  await expect(frame(tab).getByText(`Room ${code}`)).toBeVisible();
  const seen = await tab.evaluate(() =>
    performance
      .getEntries()
      .map((e) => e.name)
      .filter((name) => name.includes("#")),
  );
  expect(seen).toEqual([]);
});

// ---- US-041: full screen, player controls, fading, page width ----

const inFullscreen = (tab: Page) => tab.evaluate(() => document.fullscreenElement?.id ?? null);

/** The panel is what's painted at its centre: in full screen only the fullscreen element shows. */
const onTop = (tab: Page) =>
  tab.evaluate(() => {
    const host = document.querySelector("watchsync-sidebar");
    const r = host?.shadowRoot?.querySelector(".panel:not([hidden])")?.getBoundingClientRect();
    if (!r) return false;
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === host;
  });

/**
 * No part of the panel over the player's control strips: it keeps 64 px at the top and 96 px
 * at the bottom, and the corners where players put their buttons answer for the player.
 */
async function clearOfControls(tab: Page) {
  const box = await panel(tab).boundingBox();
  const height = await tab.evaluate(() => window.innerHeight);
  expect(box?.y).toBeGreaterThanOrEqual(64);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height - 96);
  const hits = await tab.evaluate(() => {
    const player = document.fullscreenElement ?? document.querySelector("video");
    const r = player?.getBoundingClientRect();
    if (!r) return ["no player"];
    const points: [number, number][] = [
      [r.right - 20, r.bottom - 10], // full screen, volume, subtitles
      [r.left + r.width / 2, r.bottom - 10], // seek bar
      [r.right - 20, r.top + 10], // top-right controls (Prime)
    ];
    return points.map(([x, y]) => document.elementFromPoint(x, y)?.localName ?? "none");
  });
  expect(hits).not.toContain("watchsync-sidebar");
}

test("chat stays open, loaded and usable in and out of full screen", async ({ ext }) => {
  const { tab } = await inRoom(ext);
  await chatButton(tab).click();
  await expect(messageBox(tab)).toBeFocused();
  // Something only this load of the frame has: a reload would lose it.
  const f = await chatFrame(tab);
  await f.evaluate(() => {
    const p = document.createElement("p");
    p.textContent = "kept message";
    document.getElementById("body")?.append(p);
  });
  await tab.getByRole("button", { name: "Full screen" }).click();
  await expect.poll(() => inFullscreen(tab)).toBe("player");
  await expect.poll(() => onTop(tab)).toBe(true);
  await expect(frame(tab).getByText("kept message")).toBeVisible();
  await clearOfControls(tab);
  // Usable inside full screen: close and open again from the pill there.
  await settled(tab);
  await closeButton(tab).click();
  await expect(panel(tab)).toBeHidden();
  await chatButton(tab).click();
  await expect(messageBox(tab)).toBeFocused();

  await tab.evaluate(() => document.exitFullscreen());
  await expect.poll(() => inFullscreen(tab)).toBe(null);
  await expect.poll(() => onTop(tab)).toBe(true);
  await expect(frame(tab).getByText("kept message")).toBeVisible();
  await expect(messageBox(tab)).toBeFocused(); // moving out of full screen kept focus
});

test("opened inside full screen, chat shows there", async ({ ext }) => {
  const { tab } = await inRoom(ext);
  await tab.getByRole("button", { name: "Full screen" }).click();
  await expect.poll(() => inFullscreen(tab)).toBe("player");
  await chatButton(tab).click();
  await expect.poll(() => onTop(tab)).toBe(true);
  await expect(messageBox(tab)).toBeFocused();
  await clearOfControls(tab);
});

test("open at 1280 px: no horizontal scroll, player untouched, notices aside", async ({ ext }) => {
  const { tab } = await inRoom(ext);
  await tab.setViewportSize({ width: 1280, height: 720 });
  const player = () => tab.locator("video").boundingBox();
  const before = await player();
  await chatButton(tab).click();
  await expect(panel(tab)).toBeVisible();
  expect(await player()).toEqual(before);
  const overflow = await tab.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  await clearOfControls(tab);
  // Notices and prompts move aside instead of covering it.
  const noticesRight = () =>
    tab.evaluate(
      () =>
        document
          .querySelector("watchsync-overlay")
          ?.shadowRoot?.querySelector(".wrap")
          ?.getBoundingClientRect().right ?? 0,
    );
  const box = await panel(tab).boundingBox();
  await expect.poll(noticesRight).toBeLessThanOrEqual(box?.x ?? 0);
  await settled(tab);
  await closeButton(tab).click();
  await expect.poll(noticesRight).toBe(1280 - 24);
});

test("on a narrow window, passing notices wait while chat is open", async ({ ext }) => {
  const { tab } = await inRoom(ext);
  await tab.setViewportSize({ width: 600, height: 700 });
  await chatButton(tab).click();
  await expect(panel(tab)).toBeVisible();
  const [worker] = ext.context.serviceWorkers();
  await worker?.evaluate(() => {
    const drop = Reflect.get(globalThis, "watchsyncDropSocket");
    if (typeof drop === "function") drop();
  });
  const back = tab.getByText("Back with the room");
  await expect(back).toBeAttached({ timeout: 8000 });
  await expect(back).toBeHidden();
  await settled(tab);
  await closeButton(tab).click();
  await expect(back).toBeVisible();
});

test("the chat button fades with the controls and comes back on mouse move", async ({ ext }) => {
  const { tab } = await inRoom(ext);
  const opacity = () =>
    tab.evaluate(() => {
      const pill = document.querySelector("watchsync-overlay")?.shadowRoot?.querySelector(".pill");
      return pill ? getComputedStyle(pill).opacity : "missing";
    });
  await tab.mouse.move(10, 300);
  await expect.poll(opacity).toBe("1");
  // 3 s after the last move or redraw (the room's first clock redraws the pill once early on).
  await expect.poll(opacity, { timeout: 10_000 }).toBe("0");
  await tab.mouse.move(40, 320);
  await expect.poll(opacity).toBe("1");
});

// ---- US-108: keyboard and screen reader ----

const playing = (p: Page) => p.evaluate(() => !document.querySelector("video")?.paused);

/**
 * Stands in for a service's player: Space or Enter anywhere on the page plays or pauses, and
 * a click on the player is a tap on the picture. Counts what reached it.
 */
const playerKeys = (tab: Page) =>
  tab.evaluate(() => {
    const reached = () => {
      document.body.dataset.reached = String(Number(document.body.dataset.reached ?? 0) + 1);
    };
    for (const type of ["keydown", "keyup", "keypress"])
      document.addEventListener(type, (e) => {
        if (!(e instanceof KeyboardEvent) || (e.key !== " " && e.key !== "Enter")) return;
        reached();
        const v = document.querySelector("video");
        if (type === "keydown" && v) v.paused ? void v.play() : v.pause();
      });
    document.getElementById("player")?.addEventListener("click", reached);
  });
const reached = (tab: Page) => tab.evaluate(() => Number(document.body.dataset.reached ?? 0));

test("Space and Enter on chat controls act on them, never on the player", async ({ ext }) => {
  const { tab } = await inRoom(ext);
  await expect.poll(() => playing(tab)).toBe(true);
  await playerKeys(tab);

  await chatButton(tab).focus();
  await tab.keyboard.press("Enter");
  await expect(messageBox(tab)).toBeFocused();
  await backToClose(tab);
  await expect(closeButton(tab)).toBeFocused();
  await tab.keyboard.press("Space");
  await expect(panel(tab)).toBeHidden();
  await expect(chatButton(tab)).toBeFocused();
  await tab.keyboard.press("Space");
  await expect(messageBox(tab)).toBeFocused();
  await backToClose(tab);
  await expect(closeButton(tab)).toBeFocused();
  await tab.keyboard.press("Enter");
  await expect(panel(tab)).toBeHidden();
  expect(await reached(tab)).toBe(0);
  expect(await playing(tab)).toBe(true);

  // In full screen the panel sits inside the player: its clicks stay its own.
  await tab.getByRole("button", { name: "Full screen" }).click();
  await expect.poll(() => inFullscreen(tab)).toBe("player");
  await chatButton(tab).click();
  await settled(tab);
  await closeButton(tab).click();
  await expect(panel(tab)).toBeHidden();
  const clicksOnPill = await reached(tab); // the pill lives in the page: its clicks bubble
  await chatButton(tab).click();
  await settled(tab);
  await frame(tab).getByText("Messages from the room show up here.").click();
  expect(await reached(tab)).toBe(clicksOnPill + 1);

  // The stand-in does hear the page's own keys.
  await tab.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await tab.keyboard.press("Space");
  expect(await reached(tab)).toBeGreaterThan(clicksOnPill + 1);
});

test("by keyboard: reachable, visible focus, states announced, 24 px targets", async ({ ext }) => {
  const { tab } = await inRoom(ext);
  await tab.getByRole("button", { name: "Full screen" }).focus();
  const focused = () => chatButton(tab).evaluate((b) => b.matches(":focus"));
  for (let i = 0; i < 15 && !(await focused()); i++) await tab.keyboard.press("Tab");
  await expect(chatButton(tab)).toBeFocused();
  const ring = (b: HTMLElement | SVGElement) => {
    const s = getComputedStyle(b);
    return `${s.outlineStyle} ${s.outlineColor} ${s.boxShadow}`;
  };
  const halo = "solid rgb(255, 210, 90) rgba(0, 0, 0, 0.6) 0px 0px 0px 6px";
  expect(await chatButton(tab).evaluate(ring)).toBe(halo);
  await expect(chatButton(tab)).toHaveAttribute("aria-expanded", "false");

  await tab.keyboard.press("Enter");
  await expect(panel(tab)).toBeVisible();
  await expect(messageBox(tab)).toBeFocused();
  await backToClose(tab);
  await expect(closeButton(tab)).toBeFocused();
  expect(await closeButton(tab).evaluate(ring)).toBe(halo);
  await expect(chatButton(tab)).toHaveAttribute("aria-expanded", "true");
  // Tab moves on out of chat: no trap.
  await tab.keyboard.press("Tab");
  await expect(closeButton(tab)).not.toBeFocused();

  for (const b of [closeButton(tab), chatButton(tab)]) {
    const box = await b.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(24);
    expect(box?.height).toBeGreaterThanOrEqual(24);
  }
});

test("with reduced motion chat fades in and out without sliding", async ({ ext }) => {
  const { tab } = await inRoom(ext);
  const animation = () =>
    tab.evaluate(() => {
      const p = document.querySelector("watchsync-sidebar")?.shadowRoot?.querySelector(".panel");
      return p ? getComputedStyle(p).animationName : "missing";
    });
  await chatButton(tab).click();
  expect(await animation()).toBe("in");
  await chatButton(tab).click();
  expect(await animation()).toBe("out");
  await expect(panel(tab)).toBeHidden();
  await tab.emulateMedia({ reducedMotion: "reduce" });
  await chatButton(tab).click();
  expect(await animation()).toBe("fade-in");
  await chatButton(tab).click();
  expect(await animation()).toBe("fade-out");
  await expect(panel(tab)).toBeHidden();
});
