// The sidebar's open, collapse and focus rules (UC-013), on a fresh copy of the module each
// test, as a page load would have.
import { beforeEach, describe, expect, test, vi } from "vitest";

type Sidebar = typeof import("./sidebar");
let s: Sidebar;
let previous: Sidebar | undefined;

beforeEach(async () => {
  previous?.retireSidebar(); // the last test's copy: off the page, its listeners gone
  document.body.innerHTML = `<button id="page">Page control</button>`;
  vi.resetModules();
  s = await import("./sidebar");
  previous = s;
});

/** The sidebar's shadow root, closed to the page but reachable from an element inside it. */
function shadow(): ShadowRoot {
  const r = s.sidebarBody().getRootNode();
  if (!(r instanceof ShadowRoot)) throw new Error("sidebar is not in a shadow root");
  return r;
}
const hosts = () => document.querySelectorAll("watchsync-sidebar").length;
const el = (sel: string) => {
  const found = shadow().querySelector<HTMLElement>(sel);
  if (!found) throw new Error(`missing ${sel}`);
  return found;
};
const panel = () => el("[role=region]");
const toggle = () => el(".toggle");
const pageButton = () => {
  const b = document.getElementById("page");
  if (!b) throw new Error("missing page button");
  return b;
};

describe("in and out of a room", () => {
  test("nothing on the page until in a room, then only the small button", () => {
    expect(hosts()).toBe(0);
    s.showSidebar("ABC234");
    expect(hosts()).toBe(1);
    expect(toggle().hidden).toBe(false);
    expect(panel().hidden).toBe(true);
    expect(el(".code").textContent).toBe("Room ABC234");
  });

  test("can't open outside a room", () => {
    s.openSidebar();
    expect(s.isSidebarOpen()).toBe(false);
    expect(hosts()).toBe(0);
  });

  test("leaving removes the sidebar and its button, even while open", () => {
    const changes: boolean[] = [];
    s.onSidebarChange((open) => changes.push(open));
    s.showSidebar("ABC234");
    s.openSidebar();
    s.showSidebar(null);
    expect(hosts()).toBe(0);
    expect(s.isSidebarOpen()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  test("a retired copy takes it off the page for good", () => {
    s.showSidebar("ABC234");
    s.retireSidebar();
    expect(hosts()).toBe(0);
    s.showSidebar("XYZ789");
    s.openSidebar();
    expect(hosts()).toBe(0);
  });
});

describe("opening and closing", () => {
  test("opening moves focus in and names the region WatchSync", () => {
    const opened = vi.fn();
    s.onSidebarOpen(opened);
    s.showSidebar("ABC234");
    s.openSidebar();
    expect(panel().hidden).toBe(false);
    expect(toggle().hidden).toBe(true);
    expect(shadow().activeElement).toBe(el(".close"));
    expect(opened).toHaveBeenCalledTimes(1);
    const title = shadow().getElementById(panel().getAttribute("aria-labelledby") ?? "");
    expect(title?.textContent).toBe("WatchSync");
  });

  test("Esc collapses it and gives focus back to where it was", () => {
    s.showSidebar("ABC234");
    pageButton().focus();
    s.openSidebar();
    el(".close").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
    expect(s.isSidebarOpen()).toBe(false);
    expect(document.activeElement).toBe(pageButton());
  });

  test("the close button gives focus back to the opener", () => {
    s.showSidebar("ABC234");
    s.openSidebar(pageButton());
    el(".close").click();
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(pageButton());
  });

  test("opened from its own button, focus comes back to that button", () => {
    s.showSidebar("ABC234");
    toggle().click();
    expect(s.isSidebarOpen()).toBe(true);
    s.closeSidebar();
    expect(shadow().activeElement).toBe(toggle());
  });

  test("closing while focus is elsewhere doesn't move focus", () => {
    s.showSidebar("ABC234");
    s.openSidebar(toggle());
    pageButton().focus();
    s.toggleSidebar();
    expect(s.isSidebarOpen()).toBe(false);
    expect(document.activeElement).toBe(pageButton());
  });

  test("follows the player into full screen and back, open and focused", () => {
    s.showSidebar("ABC234");
    s.openSidebar();
    const player = document.createElement("div");
    document.body.append(player);
    const fullscreen = (el: Element | null) => {
      Object.defineProperty(document, "fullscreenElement", { value: el, configurable: true });
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    fullscreen(player);
    expect(player.querySelector("watchsync-sidebar")).not.toBeNull();
    expect(s.isSidebarOpen()).toBe(true);
    expect(shadow().activeElement).toBe(el(".close"));
    fullscreen(null);
    expect(document.documentElement.lastElementChild?.tagName).toBe("WATCHSYNC-SIDEBAR");
    expect(shadow().activeElement).toBe(el(".close"));
  });

  test("the collapsed button counts unread messages in its name", () => {
    s.showSidebar("ABC234");
    s.setCollapsedBadge(3);
    expect(toggle().getAttribute("aria-label")).toBe("Open WatchSync sidebar, 3 unread");
    expect(el(".badge").textContent).toBe("3");
    s.setCollapsedBadge(0);
    expect(el(".badge").hidden).toBe(true);
    expect(toggle().getAttribute("aria-label")).toBe("Open WatchSync sidebar");
  });
});
