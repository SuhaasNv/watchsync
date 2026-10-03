// The guard that keeps a streaming site's player from cutting off typing in the chat (BUG-073).
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  isBrowserShortcut,
  KEYS_MS,
  type KeyLike,
  keysGuarded,
  STEAL_MAX,
  STEAL_PAUSE,
  STEAL_SPAN,
  StealLimiter,
  shouldTakeBack,
  TRUSTED_MS,
  typedChar,
  typingGuard,
  WINBACK_MS,
} from "./typing-guard";

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  keyCode: 0,
  isComposing: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});

describe("when focus is taken back", () => {
  test("only soon after typing, and not when the person just acted on the page", () => {
    const now = 100_000;
    expect(shouldTakeBack(now, now - 1000, -Infinity)).toBe(true);
    expect(shouldTakeBack(now, now - WINBACK_MS - 1, -Infinity)).toBe(false);
    expect(shouldTakeBack(now, -Infinity, -Infinity)).toBe(false); // never typed
    expect(shouldTakeBack(now, now - 1000, now - (TRUSTED_MS - 1))).toBe(false); // a click
    expect(shouldTakeBack(now, now - 1000, now - TRUSTED_MS)).toBe(true);
  });

  test("keys are kept from the page for 2 s after typing", () => {
    expect(keysGuarded(10_000, 10_000 - KEYS_MS + 1)).toBe(true);
    expect(keysGuarded(10_000, 10_000 - KEYS_MS)).toBe(false);
    expect(keysGuarded(10_000, -Infinity)).toBe(false);
  });
});

describe("a page that takes focus again and again", () => {
  test("is given up on after 5 times in 3 s, for 10 s", () => {
    const limiter = new StealLimiter();
    for (let i = 0; i < STEAL_MAX; i++) expect(limiter.allow(1000 + i)).toBe(true);
    expect(limiter.allow(1100)).toBe(false); // the sixth
    expect(limiter.allow(1100 + STEAL_PAUSE - 1)).toBe(false);
    expect(limiter.allow(1100 + STEAL_PAUSE)).toBe(true); // tries again
  });

  test("a slow thief is never given up on", () => {
    const limiter = new StealLimiter();
    for (let i = 0; i < 20; i++) expect(limiter.allow(i * (STEAL_SPAN / 2))).toBe(true);
  });
});

describe("which key presses are typing", () => {
  test("a character is forwarded, including Space and k", () => {
    expect(typedChar(key("a"))).toBe("a");
    expect(typedChar(key("k"))).toBe("k");
    expect(typedChar(key(" "))).toBe(" ");
    expect(typedChar(key("é"))).toBe("é");
    expect(typedChar(key("😀"))).toBe("😀");
    expect(typedChar(key("A", { altKey: false }))).toBe("A");
  });

  test("named keys, shortcuts and IME keys are not", () => {
    for (const named of ["Enter", "Backspace", "ArrowLeft", "Escape", "Tab", "Shift", "F5"])
      expect(typedChar(key(named))).toBeNull();
    expect(typedChar(key("c", { ctrlKey: true }))).toBeNull();
    expect(typedChar(key("v", { metaKey: true }))).toBeNull();
    expect(typedChar(key("a", { isComposing: true }))).toBeNull();
    expect(typedChar(key("a", { keyCode: 229 }))).toBeNull();
    expect(typedChar(key("\u0007"))).toBeNull();
  });

  test("AltGr (Ctrl+Alt) types; Ctrl or Cmd alone is a shortcut", () => {
    expect(isBrowserShortcut(key("@", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(typedChar(key("@", { ctrlKey: true, altKey: true }))).toBe("@");
    expect(isBrowserShortcut(key("f", { metaKey: true }))).toBe(true);
  });
});

describe("the guard on a page", () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    vi.restoreAllMocks();
  });

  test("never acts on events a page script made up (not isTrusted)", () => {
    const host = document.createElement("watchsync-sidebar");
    const forward = vi.fn();
    const refocus = vi.fn();
    const guard = typingGuard(host, { forward, refocus });
    stops.push(() => guard.stop());
    guard.start();
    guard.typing(true);
    const down = new KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true });
    const page = vi.fn();
    document.body.addEventListener("keydown", page);
    document.body.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(page).toHaveBeenCalledOnce();
    expect(forward).not.toHaveBeenCalled();
    expect(refocus).not.toHaveBeenCalled();
    document.body.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(refocus).not.toHaveBeenCalled();
  });

  test("stop takes every listener off", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const guard = typingGuard(document.createElement("watchsync-sidebar"), {
      forward: () => {},
      refocus: () => {},
    });
    guard.start();
    guard.start(); // a second start adds nothing
    const added = add.mock.calls.length;
    guard.stop();
    expect(remove.mock.calls.length).toBe(added);
  });
});
