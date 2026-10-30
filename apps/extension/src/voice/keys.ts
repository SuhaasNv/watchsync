// The talk key (US-056): Alt+T, or another from a short list (US-138). Not Space, which the
// streaming services use for play and pause.
// Held down it talks (push-to-talk); in open mic one press mutes or unmutes. It works wherever
// the person is: the page (also in full screen), the chat frame and the popup. When focus is in
// a box you type in, the key is a letter and nothing else: it never starts voice.
import type { Edge } from "../shared/messages";

/**
 * The keys the person can pick, always with Alt. Never Alt+F, E or D (Chrome's menus on Windows
 * and Linux), and none of the Mac's Option dead keys (E, I, U, N).
 */
export const TALK_KEYS = ["KeyT", "KeyV", "KeyY", "KeyG", "KeyB"] as const;
export type TalkKey = (typeof TALK_KEYS)[number];
export const DEFAULT_TALK_KEY: TalkKey = "KeyT";
/** chrome.storage.local: the one key holding the choice. */
export const TALK_KEY_KEY = "talkKey";

export const isTalkKeyCode = (v: unknown): v is TalkKey => TALK_KEYS.some((k) => k === v);
/** The stored value, or Alt+T when it is missing or not on the list. */
export const talkKeyOf = (v: unknown): TalkKey => (isTalkKeyCode(v) ? v : DEFAULT_TALK_KEY);
/** "Alt+T": for text, and for aria-keyshortcuts. */
export const talkKeyLabel = (key: TalkKey): string => `Alt+${key.slice(3)}`;

/** The chosen key with Alt and no other modifier. `code`, because Option+T types "†" on a Mac. */
export const isTalkKey = (e: KeyboardEvent, key: TalkKey = DEFAULT_TALK_KEY): boolean =>
  e.code === key && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;

/**
 * The chosen key, kept current: `get()` is it now, `onChange` hears each change (and the first
 * read from storage when it is not Alt+T). `stop()` removes the storage listener.
 */
export function trackTalkKey(onChange?: (key: TalkKey) => void): {
  get: () => TalkKey;
  stop: () => void;
} {
  let key = DEFAULT_TALK_KEY;
  let stopped = false;
  const set = (next: TalkKey) => {
    if (stopped || next === key) return;
    key = next;
    onChange?.(next);
  };
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    const change = changes[TALK_KEY_KEY];
    if (area === "local" && change) set(talkKeyOf(change.newValue));
  };
  chrome.storage.onChanged.addListener(changed);
  chrome.storage.local
    .get(TALK_KEY_KEY)
    .then((got) => set(talkKeyOf(got[TALK_KEY_KEY])))
    .catch(() => {});
  return {
    get: () => key,
    stop: () => {
      stopped = true;
      chrome.storage.onChanged.removeListener(changed);
    },
  };
}

/** Input types that take no typing: a key press there is not text. */
const NOT_TEXT = new Set(["button", "checkbox", "radio", "range", "color", "file", "image"]);

/** Whether the key went to something the person types in: a box, a select or editable text. */
export function isTyping(e: Event): boolean {
  const target = e.composedPath()[0];
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !NOT_TEXT.has(target.type);
  if (target.isContentEditable) return true;
  const editable = target.closest("[contenteditable]");
  return editable !== null && editable.getAttribute("contenteditable")?.toLowerCase() !== "false";
}

/**
 * Calls `edge("down")` when the talk key goes down and `edge("up")` when it is let go (or Alt
 * is, or the window loses focus, so the mic is never left open). Only keys the person pressed
 * count: a page can make up key events, but they are not `trusted`. `key` is read on every
 * press, so a change of key applies at once. Returns what removes it.
 */
export function watchTalkKey(
  doc: Document,
  edge: (e: Edge) => void,
  trusted: (e: Event) => boolean = (e) => e.isTrusted,
  key: () => TalkKey = () => DEFAULT_TALK_KEY,
): () => void {
  /** The key that went down, so a change of key mid-hold still lets go of that one. */
  let held: string | null = null;
  const release = () => {
    if (held === null) return;
    held = null;
    edge("up");
  };
  const down = (e: KeyboardEvent) => {
    if (!trusted(e) || !isTalkKey(e, key()) || isTyping(e)) return;
    e.preventDefault(); // no menu on Windows, no "†" anywhere
    e.stopPropagation();
    if (e.repeat || held !== null) return;
    held = e.code;
    edge("down");
  };
  const up = (e: KeyboardEvent) => {
    if (e.code === held || e.key === "Alt") release();
  };
  doc.addEventListener("keydown", down, true);
  doc.addEventListener("keyup", up, true);
  const win = doc.defaultView;
  win?.addEventListener("blur", release);
  return () => {
    doc.removeEventListener("keydown", down, true);
    doc.removeEventListener("keyup", up, true);
    win?.removeEventListener("blur", release);
    release();
  };
}
