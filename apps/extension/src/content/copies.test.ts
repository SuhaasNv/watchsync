import { afterEach, describe, expect, it, vi } from "vitest";
import { announce, shouldWarn, watchCopies } from "./copies";

const page = () => document.documentElement;
const none = () => false;
const marker = (id: string) => {
  const m = document.createElement("watchsync-copy");
  m.setAttribute("data-id", id);
  page().append(m);
  return m;
};

afterEach(() => {
  for (const el of document.querySelectorAll("watchsync-copy, watchsync-overlay")) el.remove();
});

describe("finding another copy", () => {
  it("alone on the page: nothing to warn about", () => {
    const stop = announce("bbb");
    expect(shouldWarn("bbb", none)).toBe(false);
    stop();
    expect(document.querySelector("watchsync-copy")).toBeNull();
  });

  it("two announced copies: only the one whose ID sorts last warns", () => {
    announce("aaa");
    marker("ccc");
    expect(shouldWarn("aaa", none)).toBe(false);
    expect(shouldWarn("ccc", none)).toBe(true);
  });

  it("an older copy shows only as an overlay that is not ours", () => {
    announce("aaa");
    const ours = document.createElement("watchsync-overlay");
    page().append(ours);
    expect(shouldWarn("aaa", (el) => el === ours)).toBe(false);
    page().append(document.createElement("watchsync-overlay"));
    expect(shouldWarn("aaa", (el) => el === ours)).toBe(true);
  });
});

describe("watching", () => {
  it("warns once, also for a copy that starts later", async () => {
    announce("bbb");
    const warn = vi.fn();
    const stop = watchCopies("bbb", none, warn);
    expect(warn).not.toHaveBeenCalled();
    marker("aaa"); // sorts before us: we are the one to speak
    await Promise.resolve();
    marker("zzz");
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(1);
    stop();
  });

  it("warns at once when the other copy is already there", () => {
    marker("aaa");
    const warn = vi.fn();
    watchCopies("bbb", none, warn)();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
