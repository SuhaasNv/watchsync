// The dev-build drift tag in the pill: the sign and size of the gap, in place, and gone when null.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Overlay = typeof import("./overlay");
let o: Overlay;
let shadow: ShadowRoot | null = null;

beforeEach(async () => {
  document.body.innerHTML = "";
  vi.stubGlobal("__CHANNEL__", "dev");
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://abc/${path}` },
    storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
  });
  const attach = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (
    this: HTMLElement,
    init: ShadowRootInit,
  ) {
    shadow = attach.call(this, init);
    return shadow;
  });
  vi.resetModules();
  o = await import("./overlay");
  o.renderPill({
    people: [],
    following: true,
    playing: false,
    onSync: () => {},
    onOwn: () => {},
    onStart: null,
    onPause: () => {},
    onSyncAll: null,
    onChat: () => {},
    chatOpen: false,
    chatOff: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const tag = () => shadow?.querySelector<HTMLElement>(".drift") ?? null;

test("shows the gap with its sign, and hides on null", () => {
  o.showDrift(37);
  expect(tag()?.textContent).toBe("+37 ms");
  expect(tag()?.getAttribute("aria-hidden")).toBe("true");
  o.showDrift(-12);
  expect(tag()?.textContent).toBe("−12 ms");
  o.showDrift(2);
  expect(tag()?.textContent).toBe("±0 ms");
  o.showDrift(null);
  expect(tag()).toBeNull();
});
