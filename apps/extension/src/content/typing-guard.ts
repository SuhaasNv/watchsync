// Keeps typing in the chat panel from being cut off by the streaming site's player (BUG-073).
// Some players take focus on a timer or when their controls hide; the next keys then go to the
// player (Space pauses, k, f, m, Enter and the arrows do their jobs) instead of the message.
// While the person has just been typing in the chat frame, this takes focus back to the frame
// and keeps those keys away from the page. It runs in the content script's shell and acts only
// on events the person made (isTrusted): a page script can't fake its way into the chat box.

/** Focus the page takes within this long of typing in the chat is taken back. */
export const WINBACK_MS = 5000;
/** Keys that land on the page within this long of typing in the chat never reach the page. */
export const KEYS_MS = 2000;
/** A click, tap or key on the page this recently means focus moved by the person's own doing. */
export const TRUSTED_MS = 400;
/** More than STEAL_MAX takings back within STEAL_SPAN ms is a page that loops: stop for a while. */
export const STEAL_MAX = 5;
export const STEAL_SPAN = 3000;
export const STEAL_PAUSE = 10_000;

/**
 * Focus has landed on the page: take it back to the chat frame only if the person was typing in
 * it lately and didn't do anything on the page that explains the move.
 */
export function shouldTakeBack(now: number, typedAt: number, trustedAt: number): boolean {
  return now - typedAt < WINBACK_MS && now - trustedAt >= TRUSTED_MS;
}

/** Whether the keys are still being kept from the page. */
export const keysGuarded = (now: number, typedAt: number): boolean => now - typedAt < KEYS_MS;

/** Gives up on a page that takes focus again and again, so we never fight the person. */
export class StealLimiter {
  private readonly times: number[] = [];
  private pausedUntil = 0;

  /** True if focus may be taken back now (and counts it); false while we've given up. */
  allow(now: number): boolean {
    if (now < this.pausedUntil) return false;
    while (this.times.length && now - (this.times[0] ?? now) > STEAL_SPAN) this.times.shift();
    this.times.push(now);
    if (this.times.length <= STEAL_MAX) return true;
    this.times.length = 0;
    this.pausedUntil = now + STEAL_PAUSE;
    return false;
  }
}

/** The parts of a KeyboardEvent the checks below read. */
export interface KeyLike {
  key: string;
  keyCode: number;
  isComposing: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** Ctrl or Cmd with a key (Alt too is AltGr, which types): the browser's shortcut, not typing. */
export const isBrowserShortcut = (e: KeyLike): boolean => (e.ctrlKey || e.metaKey) && !e.altKey;

/**
 * The character a key press types, to be put in the message box instead; null for any other key
 * (Enter, arrows, Backspace) and for anything mid-composition (an IME owns those keys).
 */
export function typedChar(e: KeyLike): string | null {
  if (e.isComposing || e.keyCode === 229 || isBrowserShortcut(e)) return null;
  return Array.from(e.key).length === 1 && !/\p{Cc}/u.test(e.key) ? e.key : null;
}

export interface GuardHooks {
  /** Puts focus back in the chat frame. */
  refocus: () => void;
  /** Types this character into the chat frame's message box. */
  forward: (text: string) => void;
  now?: () => number;
}

/**
 * The guard for one chat panel. `host` is our shadow host: an event whose target is the host
 * came from our own panel (the page sees a closed shadow root's events retargeted to it), and
 * is never touched. `start` and `stop` bracket the time the panel is open.
 */
export function typingGuard(host: Element, hooks: GuardHooks) {
  const now = hooks.now ?? Date.now;
  const limiter = new StealLimiter();
  let typedAt = Number.NEGATIVE_INFINITY;
  let trustedAt = Number.NEGATIVE_INFINITY;
  let running = false;

  /** The person pressed, tapped or clicked on the page: they are not typing in the chat now. */
  const onPointer = (e: Event) => {
    if (!e.isTrusted || e.target === host) return;
    trustedAt = now();
    typedAt = Number.NEGATIVE_INFINITY;
  };

  const onKey = (e: Event) => {
    if (!(e instanceof KeyboardEvent) || !e.isTrusted || e.target === host) return;
    if (!keysGuarded(now(), typedAt) || isBrowserShortcut(e)) {
      if (e.type === "keydown") trustedAt = now();
      return;
    }
    // Every key, key up and key press alike (Enter's key up can reach a player too).
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type !== "keydown") return;
    const char = typedChar(e);
    if (char) {
      typedAt = now();
      hooks.forward(char);
    }
    if (limiter.allow(now())) hooks.refocus();
  };

  const onFocus = (e: Event) => {
    // The window's own focus (the page getting it back); elements are caught by focusin.
    if (e.type === "focus" && e.target !== window) return;
    if (!e.isTrusted || document.activeElement === host) return;
    // After the page's own focus() call has finished: focus given back inside it is taken away
    // again by the rest of that call.
    queueMicrotask(() => {
      const t = now();
      if (!running || document.activeElement === host) return;
      if (shouldTakeBack(t, typedAt, trustedAt) && limiter.allow(t)) hooks.refocus();
    });
  };

  const pointers = ["pointerdown", "mousedown", "touchstart"];
  const keys = ["keydown", "keyup", "keypress"];

  return {
    start() {
      if (running) return;
      running = true;
      for (const type of pointers) window.addEventListener(type, onPointer, true);
      for (const type of keys) window.addEventListener(type, onKey, true);
      document.addEventListener("focusin", onFocus, true);
      window.addEventListener("focus", onFocus, true);
    },
    stop() {
      running = false;
      typedAt = Number.NEGATIVE_INFINITY;
      trustedAt = Number.NEGATIVE_INFINITY;
      for (const type of pointers) window.removeEventListener(type, onPointer, true);
      for (const type of keys) window.removeEventListener(type, onKey, true);
      document.removeEventListener("focusin", onFocus, true);
      window.removeEventListener("focus", onFocus, true);
    },
    /** The chat frame reports typing (on), or leaving the message box with Tab (off). */
    typing(on: boolean) {
      typedAt = on ? now() : Number.NEGATIVE_INFINITY;
    },
  };
}
