// The talk key (US-056): Alt+T. Not Space, which the streaming services use for play and pause.
// Held down it talks (push-to-talk); in open mic one press mutes or unmutes. It works wherever
// the person is: the page (also in full screen), the chat frame and the popup. When focus is in
// a box you type in, the key is a letter and nothing else: it never starts voice.
import type { Edge } from "../shared/messages";

/** Alt+T, with no other modifier. `code`, because Option+T types "†" on a Mac. */
export const isTalkKey = (e: KeyboardEvent): boolean =>
  e.code === "KeyT" && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;

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
 * count: a page can make up key events, but they are not `trusted`. Returns what removes it.
 */
export function watchTalkKey(
  doc: Document,
  edge: (e: Edge) => void,
  trusted: (e: Event) => boolean = (e) => e.isTrusted,
): () => void {
  let held = false;
  const release = () => {
    if (!held) return;
    held = false;
    edge("up");
  };
  const down = (e: KeyboardEvent) => {
    if (!trusted(e) || !isTalkKey(e) || isTyping(e)) return;
    e.preventDefault(); // no menu on Windows, no "†" anywhere
    e.stopPropagation();
    if (e.repeat || held) return;
    held = true;
    edge("down");
  };
  const up = (e: KeyboardEvent) => {
    if (e.code === "KeyT" || e.key === "Alt") release();
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
