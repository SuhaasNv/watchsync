import { afterEach, describe, expect, it } from "vitest";
import type { Edge } from "../shared/messages";
import {
  DEFAULT_TALK_KEY,
  isTalkKey,
  isTalkKeyCode,
  isTyping,
  TALK_KEYS,
  talkKeyLabel,
  talkKeyOf,
  watchTalkKey,
} from "./keys";

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

describe("the key list (US-138)", () => {
  it("is Alt+T by default, then V, Y, G and B; never the keys Chrome or a Mac's Option uses", () => {
    expect(DEFAULT_TALK_KEY).toBe("KeyT");
    expect(TALK_KEYS.map(talkKeyLabel)).toEqual(["Alt+T", "Alt+V", "Alt+Y", "Alt+G", "Alt+B"]);
    for (const taken of ["KeyF", "KeyE", "KeyD", "KeyI", "KeyU", "KeyN"]) {
      expect(isTalkKeyCode(taken)).toBe(false);
    }
  });

  it("reads a stored value, and falls back to Alt+T for anything else", () => {
    expect(talkKeyOf("KeyG")).toBe("KeyG");
    expect(talkKeyOf("KeyF")).toBe("KeyT");
    expect(talkKeyOf(undefined)).toBe("KeyT");
    expect(talkKeyOf(7)).toBe("KeyT");
  });

  it("matches only the chosen key", () => {
    const altV = { code: "KeyV", key: "√", altKey: true };
    expect(isTalkKey(key("keydown", altV), "KeyV")).toBe(true);
    expect(isTalkKey(key("keydown", altV))).toBe(false); // Alt+T is the default
    expect(isTalkKey(key("keydown", altT), "KeyV")).toBe(false);
    expect(isTalkKey(key("keydown", { ...altV, shiftKey: true }), "KeyV")).toBe(false);
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

  it("follows the chosen key as it changes, and the old one no longer talks", () => {
    const edges: Edge[] = [];
    let chosen: (typeof TALK_KEYS)[number] = "KeyT";
    stops.push(
      watchTalkKey(
        document,
        (e) => edges.push(e),
        (e) => pressed.has(e),
        () => chosen,
      ),
    );
    chosen = "KeyV";
    document.dispatchEvent(key("keydown", altT));
    expect(edges).toEqual([]);
    document.dispatchEvent(key("keydown", { code: "KeyV", key: "√", altKey: true }));
    expect(edges).toEqual(["down"]);
    chosen = "KeyG"; // changed while held: the key that went down still lets go
    document.dispatchEvent(key("keyup", { code: "KeyV", key: "√" }));
    expect(edges).toEqual(["down", "up"]);
  });

  it("types in a box and never transmits, whatever the chosen key", () => {
    const edges: Edge[] = [];
    stops.push(
      watchTalkKey(
        document,
        (e) => edges.push(e),
        (e) => pressed.has(e),
        () => "KeyB",
      ),
    );
    document.body.innerHTML = `<textarea id="box"></textarea>`;
    document
      .getElementById("box")
      ?.dispatchEvent(key("keydown", { code: "KeyB", key: "∫", altKey: true }));
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
