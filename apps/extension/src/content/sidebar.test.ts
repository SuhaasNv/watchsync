// The chat panel's shell (UC-013): open, close and focus rules, and the pill's chat button,
// on a fresh copy of the modules each test, as a page load would have.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Sidebar = typeof import("./sidebar");
type Overlay = typeof import("./overlay");
let s: Sidebar;
let o: Overlay;
let previous: Sidebar | undefined;
/** The shell's shadow root: closed to the page, caught as it is made. */
let shadow: ShadowRoot | null = null;

beforeEach(async () => {
  previous?.retireSidebar(); // the last test's copy: off the page, its listeners gone
  document.body.innerHTML = `<button id="page">Page control</button>`;
  vi.useFakeTimers();
  let issued = 0;
  vi.stubGlobal("chrome", {
    runtime: {
      getURL: (path: string) => `chrome-extension://abc/${path}`,
      sendMessage: () => Promise.resolve({ nonce: nonceN(++issued) }),
    },
    storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
  });
  const attach = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (
    this: HTMLElement,
    init: ShadowRootInit,
  ) {
    const made = attach.call(this, init);
    if (this.localName === "watchsync-sidebar") shadow = made;
    return made;
  });
  vi.resetModules();
  o = await import("./overlay");
  s = await import("./sidebar");
  previous = s;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const root = (): ShadowRoot => {
  if (!shadow) throw new Error("no shadow root");
  return shadow;
};
/** The background's passes, numbered in the order it gives them. */
const nonceN = (n: number) => `nonce-${String(n).padStart(6, "0")}`;
/** The pass in the frame's address. */
const frameNonce = () => frame()?.src.split("#")[1] ?? null;
const hosts = () => document.querySelectorAll("watchsync-sidebar").length;
const panel = () => {
  const p = root().querySelector<HTMLElement>("[role=region]");
  if (!p) throw new Error("missing panel");
  return p;
};
const frame = () => root().querySelector("iframe");
const pageButton = () => {
  const b = document.getElementById("page");
  if (!b) throw new Error("missing page button");
  return b;
};
/** Lets promises and observers run: the frame waits for its pass from the background. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
async function openAndLoad(from?: HTMLElement | null) {
  s.openSidebar(from);
  await settle();
}

describe("the frame's pass and its place on the page", () => {
  test("no pass, no frame", async () => {
    vi.stubGlobal("chrome", {
      runtime: { getURL: (p: string) => p, sendMessage: () => Promise.resolve(null) },
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
    });
    s.showSidebar(true);
    await openAndLoad();
    expect(frame()).toBeNull();
  });

  test("taken off the page by the page, it comes back", async () => {
    s.showSidebar(true);
    await openAndLoad();
    document.querySelector("watchsync-sidebar")?.remove();
    await settle();
    expect(hosts()).toBe(1);
    expect(s.isSidebarOpen()).toBe(true);
  });

  test("a spent pass gets a new frame with a new pass, not a changed address", async () => {
    s.showSidebar(true);
    await openAndLoad();
    const first = frame();
    s.renewFrame();
    await settle();
    expect(frame()).not.toBe(first);
    expect(first?.isConnected).toBe(false);
    expect(root().querySelectorAll("iframe").length).toBe(1);
  });

  test("a late reply to an older request for a pass is dropped", async () => {
    const replies: ((v: { nonce: string }) => void)[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (p: string) => `chrome-extension://abc/${p}`,
        sendMessage: () => new Promise((resolve) => replies.push(resolve)),
      },
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
    });
    s.showSidebar(true);
    s.openSidebar(); // asks for pass 1
    s.closeSidebar();
    s.openSidebar(); // asks for pass 2
    replies[1]?.({ nonce: nonceN(2) }); // the newer reply first
    await settle();
    replies[0]?.({ nonce: nonceN(1) }); // then the older one, late
    await settle();
    expect(root().querySelectorAll("iframe").length).toBe(1);
    expect(frameNonce()).toBe(nonceN(2));
  });

  test("a frame that doesn't connect within 2 s of loading is replaced", async () => {
    s.showSidebar(true);
    await openAndLoad();
    frame()?.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(2001);
    await settle();
    expect(frameNonce()).toBe(nonceN(2));
  });

  test("a frame that connects in time stays", async () => {
    s.showSidebar(true);
    await openAndLoad();
    s.chatFrameReady(nonceN(1));
    frame()?.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(6000);
    await settle();
    expect(frameNonce()).toBe(nonceN(1));
  });

  test("a lost frame is taken off at once and a new one loaded; old news is ignored", async () => {
    s.showSidebar(true);
    await openAndLoad();
    s.chatFrameReady(nonceN(1));
    const lost = frame();
    s.chatFrameLost(nonceN(1));
    expect(lost?.isConnected).toBe(false); // before any new pass arrives
    expect(frame()).toBeNull();
    await settle();
    expect(frameNonce()).toBe(nonceN(2));
    s.chatFrameLost(nonceN(1)); // the frame we removed ourselves
    await settle();
    expect(frameNonce()).toBe(nonceN(2));
  });

  test("a page that keeps taking the frame turns chat off on that page", async () => {
    const turnedOff = vi.fn();
    s.onChatOff(turnedOff);
    s.showSidebar(true);
    await openAndLoad();
    for (let n = 1; n <= 3; n++) {
      s.chatFrameLost(nonceN(n));
      await settle();
    }
    expect(s.isChatOff()).toBe(true);
    expect(turnedOff).toHaveBeenCalledTimes(1);
    expect(hosts()).toBe(0);
    expect(s.isSidebarOpen()).toBe(false);
    s.openSidebar();
    await settle();
    expect(hosts()).toBe(0);
  });

  test("losses spread over more than a minute, or our own reloads, don't turn it off", async () => {
    s.showSidebar(true);
    await openAndLoad();
    s.chatFrameLost(nonceN(1));
    await settle();
    s.chatFrameLost(nonceN(2));
    await settle();
    s.chatFrameReady(nonceN(3)); // the third frame connects, so its deadline passes quietly
    vi.advanceTimersByTime(61_000);
    s.chatFrameLost(nonceN(3));
    await settle();
    for (let i = 0; i < 3; i++) {
      s.renewFrame(); // a worker restart: ours
      await settle();
    }
    expect(s.isChatOff()).toBe(false);
    expect(hosts()).toBe(1);
  });

  test("taken off by us (leaving), it stays off", async () => {
    s.showSidebar(true);
    await openAndLoad();
    s.showSidebar(false);
    await settle();
    expect(hosts()).toBe(0);
  });
});

describe("in and out of a room", () => {
  test("nothing on the page in a room until chat opens", async () => {
    s.showSidebar(true);
    expect(hosts()).toBe(0);
    await openAndLoad();
    expect(hosts()).toBe(1);
    expect(panel().hidden).toBe(false);
    expect(panel().getAttribute("aria-label")).toBe("WatchSync");
    expect(frame()?.src).toBe(`chrome-extension://abc/sidebar.html#${nonceN(1)}`);
    expect(frame()?.title).toBe("WatchSync chat");
  });

  test("can't open outside a room", async () => {
    await openAndLoad();
    expect(s.isSidebarOpen()).toBe(false);
    expect(hosts()).toBe(0);
  });

  test("leaving removes the panel and its frame, even while open", async () => {
    const changes: boolean[] = [];
    s.onSidebarChange((open) => changes.push(open));
    s.showSidebar(true);
    await openAndLoad();
    s.showSidebar(false);
    expect(hosts()).toBe(0);
    expect(frame()).toBeNull();
    expect(s.isSidebarOpen()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  test("a retired copy takes it off the page for good", async () => {
    s.showSidebar(true);
    await openAndLoad();
    s.retireSidebar();
    expect(hosts()).toBe(0);
    s.showSidebar(true);
    await openAndLoad();
    expect(hosts()).toBe(0);
  });
});

describe("opening and closing", () => {
  test("opening focuses the frame and tells UC-014", async () => {
    const opened = vi.fn();
    s.onSidebarOpen(opened);
    s.showSidebar(true);
    await openAndLoad();
    expect(root().activeElement).toBe(frame());
    expect(opened).toHaveBeenCalledTimes(1);
  });

  test("closing animates out, then hides, and gives focus back", async () => {
    s.showSidebar(true);
    pageButton().focus();
    await openAndLoad();
    s.closeSidebar();
    expect(s.isSidebarOpen()).toBe(false);
    expect(document.activeElement).toBe(pageButton()); // focus moves first
    expect(panel().classList.contains("closing")).toBe(true);
    expect(panel().hidden).toBe(false);
    vi.advanceTimersByTime(200); // no animation end in jsdom: the fallback hides it
    expect(panel().hidden).toBe(true);
    expect(panel().classList.contains("closing")).toBe(false);
  });

  test("the end of the close animation hides it at once", async () => {
    s.showSidebar(true);
    await openAndLoad();
    s.closeSidebar();
    panel().dispatchEvent(new Event("animationend"));
    expect(panel().hidden).toBe(true);
  });

  test("reopening mid-close stops the close", async () => {
    s.showSidebar(true);
    await openAndLoad();
    s.closeSidebar();
    await openAndLoad();
    vi.advanceTimersByTime(300);
    expect(panel().hidden).toBe(false);
    expect(panel().classList.contains("closing")).toBe(false);
  });

  test("when the opener is gone, focus goes to the fallback", async () => {
    const fallback = document.createElement("button");
    document.body.append(fallback);
    s.focusFallback(() => fallback);
    s.showSidebar(true);
    await openAndLoad(pageButton());
    pageButton().remove(); // the pill redrew
    s.closeSidebar();
    expect(document.activeElement).toBe(fallback);
  });

  test("closing while focus is elsewhere doesn't move focus", async () => {
    const other = document.createElement("button");
    document.body.append(other);
    s.showSidebar(true);
    await openAndLoad(pageButton());
    other.focus();
    s.toggleSidebar();
    expect(s.isSidebarOpen()).toBe(false);
    expect(document.activeElement).toBe(other);
  });

  test("follows the player into full screen and back, still open", async () => {
    s.showSidebar(true);
    await openAndLoad();
    const player = document.createElement("div");
    document.body.append(player);
    const fullscreen = (el: Element | null) => {
      Object.defineProperty(document, "fullscreenElement", { value: el, configurable: true });
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    fullscreen(player);
    expect(player.querySelector("watchsync-sidebar")).not.toBeNull();
    expect(s.isSidebarOpen()).toBe(true);
    fullscreen(null);
    expect(document.documentElement.lastElementChild?.localName).toBe("watchsync-sidebar");
    expect(root().activeElement).toBe(frame());
  });
});

describe("the pill's chat button", () => {
  const model = (chatOpen: boolean, chatOff = false) => ({
    people: [],
    following: true,
    onSync: () => {},
    onOwn: () => {},
    onStart: null,
    playing: false,
    onPause: () => {},
    onSyncAll: () => {},
    onChat: () => {},
    chatOpen,
    chatOff,
  });

  test("off on this page: says why, does nothing, hides the count", async () => {
    s.setCollapsedBadge(2);
    o.renderPill(model(false, true));
    expect(chat().getAttribute("aria-label")).toBe(o.CHAT_OFF);
    expect(chat().title).toBe(o.CHAT_OFF);
    expect(chat().getAttribute("aria-disabled")).toBe("true");
    expect(chat().querySelector<HTMLElement>(".count")?.hidden).toBe(true);
  });
  const chat = () => {
    const b = o.chatButton();
    if (!b) throw new Error("chat button not on the page");
    return b;
  };

  test("a toggle that names the shortcut and says whether chat is open", async () => {
    o.renderPill(model(false));
    expect(chat().getAttribute("aria-label")).toBe("Open chat (Alt+Shift+W)");
    expect(chat().title).toBe(chat().getAttribute("aria-label"));
    expect(chat().getAttribute("aria-expanded")).toBe("false");
    o.renderPill(model(true));
    expect(chat().getAttribute("aria-label")).toBe("Close chat");
    expect(chat().getAttribute("aria-expanded")).toBe("true");
  });

  test("carries the unread count, 9+ past nine", async () => {
    o.renderPill(model(false));
    s.setCollapsedBadge(3);
    expect(chat().getAttribute("aria-label")).toBe("Open chat (Alt+Shift+W), 3 unread");
    const count = chat().querySelector<HTMLElement>(".count");
    expect(count?.textContent).toBe("3");
    s.setCollapsedBadge(12);
    expect(count?.textContent).toBe("9+");
    s.setCollapsedBadge(0);
    expect(count?.hidden).toBe(true);
  });

  test("not on the page outside a room", async () => {
    o.renderPill(null);
    expect(o.chatButton()).toBeNull();
  });
});
