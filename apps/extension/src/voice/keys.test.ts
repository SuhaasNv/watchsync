import { afterEach, describe, expect, it } from "vitest";
import type { Edge } from "../shared/messages";
import { isTalkKey, isTyping, watchTalkKey } from "./keys";

/** Events the person pressed: jsdom's own are never `isTrusted`, so the test keeps count. */
const pressed = new WeakSet<Event>();

function key(type: "keydown" | "keyup", init: KeyboardEventInit, byPerson = true): KeyboardEvent {
  const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
  if (byPerson) pressed.add(e);
  return e;
}
const altT = { code: "KeyT", key: "†", altKey: true };

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isTalkKey", () => {
  it("is Alt+T and nothing else, by key position so Option+T on a Mac counts", () => {
    expect(isTalkKey(key("keydown", altT))).toBe(true);
    expect(isTalkKey(key("keydown", { code: "KeyT", key: "t" }))).toBe(false);
    expect(isTalkKey(key("keydown", { ...altT, shiftKey: true }))).toBe(false);
    expect(isTalkKey(key("keydown", { ...altT, ctrlKey: true }))).toBe(false);
    expect(isTalkKey(key("keydown", { ...altT, metaKey: true }))).toBe(false);
    // Space is the services' play and pause, never ours.
    expect(isTalkKey(key("keydown", { code: "Space", key: " ", altKey: true }))).toBe(false);
  });
});

describe("isTyping", () => {
  function typing(html: string): boolean {
    document.body.innerHTML = html;
    const el = document.body.firstElementChild;
    if (!(el instanceof HTMLElement)) throw new Error("no element");
    let result = false;
    el.addEventListener("keydown", (e) => {
      result = isTyping(e);
    });
    el.dispatchEvent(key("keydown", altT));
    return result;
  }

  it("is true in a box you type in", () => {
    expect(typing(`<input type="text">`)).toBe(true);
    expect(typing(`<input>`)).toBe(true);
    expect(typing(`<input type="search">`)).toBe(true);
    expect(typing(`<textarea></textarea>`)).toBe(true);
    expect(typing(`<select><option>a</option></select>`)).toBe(true);
    expect(typing(`<div contenteditable="true"></div>`)).toBe(true);
    expect(typing(`<div contenteditable=""></div>`)).toBe(true);
  });

  it("is false anywhere else", () => {
    expect(typing(`<button>Talk</button>`)).toBe(false);
    expect(typing(`<input type="checkbox">`)).toBe(false);
    expect(typing(`<div contenteditable="false"></div>`)).toBe(false);
    expect(typing(`<div></div>`)).toBe(false);
  });
});

describe("watchTalkKey", () => {
  const stops: (() => void)[] = [];
  function watch() {
    const edges: Edge[] = [];
    stops.push(
      watchTalkKey(
        document,
        (e) => edges.push(e),
        (e) => pressed.has(e),
      ),
    );
    return edges;
  }
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
  });

  it("goes down once however long it is held, and up when it is let go", () => {
    const edges = watch();
    document.dispatchEvent(key("keydown", altT));
    document.dispatchEvent(key("keydown", { ...altT, repeat: true }));
    document.dispatchEvent(key("keydown", { ...altT, repeat: true }));
    expect(edges).toEqual(["down"]);
    document.dispatchEvent(key("keyup", { code: "KeyT", key: "†" }));
    expect(edges).toEqual(["down", "up"]);
  });

  it("lets go when Alt is let go first, or the window loses focus", () => {
    const edges = watch();
    document.dispatchEvent(key("keydown", altT));
    document.dispatchEvent(key("keyup", { code: "AltLeft", key: "Alt" }));
    document.dispatchEvent(key("keydown", altT));
    window.dispatchEvent(new Event("blur"));
    expect(edges).toEqual(["down", "up", "down", "up"]);
  });

  it("types in a box and never transmits", () => {
    const edges = watch();
    document.body.innerHTML = `<textarea id="box"></textarea><div contenteditable="true" id="ce"></div>`;
    for (const id of ["box", "ce"]) {
      const e = key("keydown", altT);
      document.getElementById(id)?.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false); // the key does what it does in a box
      document.getElementById(id)?.dispatchEvent(key("keyup", { code: "KeyT" }));
    }
    expect(edges).toEqual([]);
  });

  it("ignores a key a page made up", () => {
    const edges = watch();
    document.dispatchEvent(key("keydown", altT, false));
    expect(edges).toEqual([]);
  });

  it("stops watching, and lets go of a key still held", () => {
    const edges: Edge[] = [];
    const stop = watchTalkKey(
      document,
      (e) => edges.push(e),
      (e) => pressed.has(e),
    );
    document.dispatchEvent(key("keydown", altT));
    stop();
    expect(edges).toEqual(["down", "up"]);
    document.dispatchEvent(key("keydown", altT));
    expect(edges).toEqual(["down", "up"]);
  });
});
