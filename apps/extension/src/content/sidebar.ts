// The shell of the WatchSync chat panel (UC-013) over the right edge of the page. The panel's
// content lives in an extension page in an iframe (DEC-042): a service page can read keys typed
// into its own document, shadow roots included, but never into another origin's frame. This
// shell only places the frame, animates it open and closed, and follows the player into full
// screen. It never carries chat or room data; the frame talks to the background itself.
import type { ChatNonceReply, ChatNonceRequest } from "../shared/messages";

/** Unread messages, shown on the pill's chat button (the one way into chat on the page). */
export { setChatBadge as setCollapsedBadge } from "./overlay";

const host = document.createElement("watchsync-sidebar");
// Closed, so the service page can't reach the frame element; test builds open it.
const root = host.attachShadow({ mode: __MOCK__ ? "open" : "closed" });
// The host's own look is ours: the page can't hide or move it with its own styles, since
// important rules from inside the shadow root win over the page's, inline ones included.
root.innerHTML = `<style>
  :host { all: initial !important; }
  /* Just below the pill (top 16px, 40px tall) and above the player's bottom controls, so
     neither is covered, with room for as many messages as fit. One under the overlay, so a
     waiting or Sync prompt stays visible over it on narrow windows. */
  .panel { position: fixed; z-index: 2147483646; right: 16px; top: 64px; bottom: 96px;
    width: clamp(320px, 26vw, 360px); max-width: calc(100vw - 32px); min-height: 160px;
    box-sizing: border-box; border-radius: 16px; overflow: hidden; background: #121a1e;
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.3);
    contain: layout paint style; animation: in 200ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  /* The edge, drawn over the frame so the frame's own colour can't hide it. */
  .panel::after { content: ""; position: absolute; inset: 0; border-radius: inherit;
    box-shadow: inset 0 0 0 1px rgba(214, 236, 240, 0.08); pointer-events: none; }
  @media (max-width: 719.98px) { .panel { right: 8px; max-width: calc(100vw - 16px); } }
  .panel[hidden] { display: none; }
  .panel.closing { animation: out 140ms cubic-bezier(0.4, 0, 1, 1) forwards; pointer-events: none; }
  iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; }
  @keyframes in { from { opacity: 0; transform: translateX(16px); } }
  @keyframes out { to { opacity: 0; transform: translateX(12px); } }
  @keyframes fade-in { from { opacity: 0; } }
  @keyframes fade-out { to { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .panel { animation: fade-in 150ms ease-out; }
    .panel.closing { animation: fade-out 140ms ease-in forwards; }
  }
</style><div class="panel" role="region" aria-label="WatchSync" hidden></div>`;

const panel = root.querySelector(".panel") as HTMLDivElement;
let frame: HTMLIFrameElement | null = null;
/** The pass of the frame on the page; news about any other frame is about one we removed. */
let current: string | null = null;
/** The pass whose frame has connected (said hello to the background). */
let greeted: string | null = null;
/** Bumped with every request for a pass: a reply that isn't the latest is dropped. */
let asked = 0;
/** We re-appended the host, which reloads the frame: losing it is ours, not the page's doing. */
let ourReload = false;
let helloDue: ReturnType<typeof setTimeout> | undefined;
/** Chat is off on this page: it interfered with the frame too often (fail closed). */
let off = false;
/** When the page last interfered with the frame, within the last minute. */
const interference: number[] = [];
const offWatchers: (() => void)[] = [];

let inRoom = false;
let open = false;
let retired = false;
/** The host belongs on the page: it was placed and hasn't been taken off by us. */
let placed = false;
/** Opening asked for focus before the frame existed: give it once the frame is there. */
let focusWhenReady = false;
/** Where focus was before the panel opened, to give it back on close. */
let returnTo: HTMLElement | null = null;
/** Where focus goes when `returnTo` is gone (the pill redrew, or the room ended). */
let fallback: () => HTMLElement | null = () => null;
let closing: ReturnType<typeof setTimeout> | undefined;
const openers: (() => void)[] = [];
const watchers: ((open: boolean) => void)[] = [];

const where = () => document.fullscreenElement ?? document.documentElement;

// If the page takes the host off or moves it, put it back. Child list of its parent only.
const guard = new MutationObserver(() => {
  if (placed && host.parentNode !== where()) mount();
});

function mount() {
  if (retired || !inRoom) return;
  placed = true;
  const parent = where();
  if (host.parentNode === parent) return;
  guard.disconnect();
  guard.observe(parent, { childList: true });
  // moveBefore (Chrome 133+) keeps the frame loaded, focused and scrolled. A plain append
  // reloads the frame, which is then replaced by a new one with a new pass (frameTrouble).
  if (host.isConnected && "moveBefore" in parent) {
    try {
      return parent.moveBefore(host, null);
    } catch {
      // A move the browser refuses (another document): fall back to a plain append.
    }
  }
  const focused = root.activeElement;
  if (frame) ourReload = true;
  parent.append(host);
  if (focused instanceof HTMLElement) focused.focus();
}

function unmount() {
  placed = false;
  guard.disconnect();
  host.remove();
}

/** A one-time pass from the background for the frame we load; null if it won't give one. */
async function pass(): Promise<string | null> {
  const reply: ChatNonceReply = await chrome.runtime.sendMessage({
    kind: "chatNonce",
  } satisfies ChatNonceRequest);
  const nonce = typeof reply === "object" && reply !== null ? reply.nonce : null;
  return typeof nonce === "string" && /^[\w-]{8,64}$/.test(nonce) ? nonce : null;
}

const frameUrl = (nonce: string) => `${chrome.runtime.getURL("sidebar.html")}#${nonce}`;

/** Takes the frame off the page at once. */
function dropFrame() {
  clearTimeout(helloDue);
  frame?.remove();
  frame = null;
  current = null;
  ourReload = false;
}

/** Loads a new frame with a fresh pass, in place of any frame there was. */
async function loadFrame() {
  const ticket = ++asked;
  const nonce = await pass();
  // Only the latest request counts: an older reply arriving late would load a frame whose pass
  // the background has already replaced, and that frame could never connect.
  if (ticket !== asked || !nonce || retired || !inRoom || off) return;
  dropFrame();
  const f = document.createElement("iframe");
  f.title = "WatchSync chat";
  f.src = frameUrl(nonce);
  let loaded = false;
  f.addEventListener("load", () => {
    // A second load means the frame's page was replaced: by our own re-append, or by the
    // service page pointing the frame elsewhere. Either way it can't be trusted any more.
    if (loaded) return frameTrouble(nonce);
    loaded = true;
    // Focus given to the frame before its page loaded doesn't reach that page: give it again.
    if (focusWhenReady && open) focusFrame(f);
    focusWhenReady = false;
    helloWithin(nonce, 2000);
  });
  frame = f;
  current = nonce;
  panel.append(f);
  helloWithin(nonce, 5000); // a frame that never even loads
  if (focusWhenReady && open) f.focus(); // off the page's control at once
}

/** The frame must have connected within `ms`, or it isn't ours any more. */
function helloWithin(nonce: string, ms: number) {
  clearTimeout(helloDue);
  helloDue = setTimeout(() => {
    if (greeted !== nonce) frameTrouble(nonce);
  }, ms);
}

/** Focus into the frame's page; it then puts focus on its first control. */
function focusFrame(f: HTMLIFrameElement) {
  f.focus();
  f.contentWindow?.focus();
}

/**
 * The frame on the page is no longer the one we loaded, or no longer connected: take it off at
 * once (nothing the page loaded stays in our panel) and put a new one with a new pass in its
 * place. If the page did this three times in a minute, chat turns off on this page.
 */
function frameTrouble(nonce: string) {
  if (nonce !== current) return; // a frame we already replaced or removed
  const ours = ourReload;
  const hadFocus = open && root.activeElement === frame;
  dropFrame();
  if (!ours && interfered()) {
    if (hadFocus) giveFocusBack();
    return;
  }
  if (hadFocus) focusWhenReady = true;
  loadFrame().catch((e: unknown) => console.debug("watchsync: chat frame", e));
}

/** Counts one interference; true if that's three within a minute and chat is now off. */
function interfered(): boolean {
  const now = Date.now();
  interference.push(now);
  while (interference.length && now - (interference[0] ?? now) > 60_000) interference.shift();
  if (interference.length < 3) return false;
  off = true;
  const was = open;
  open = false;
  returnTo = null;
  focusWhenReady = false;
  clearTimeout(closing);
  panel.classList.remove("closing");
  panel.hidden = true;
  unmount();
  for (const cb of offWatchers) cb();
  if (was) changed();
  return true;
}

/** The background says the frame with this pass connected. */
export function chatFrameReady(nonce: string) {
  if (nonce === current) greeted = nonce;
}

/** The background says the frame with this pass lost its connection without our doing. */
export function chatFrameLost(nonce: string) {
  frameTrouble(nonce);
}

/**
 * The background worker restarted, dropping the frame's connection: a new frame with a new
 * pass replaces it (our doing, not the page's).
 */
export function renewFrame() {
  if (!current) return;
  ourReload = true;
  frameTrouble(current);
}

/** Chat was turned off on this page because the page interfered with it. */
export const isChatOff = () => off;

/** Called once if chat turns off on this page. */
export function onChatOff(cb: () => void) {
  offWatchers.push(cb);
}

function changed() {
  for (const cb of watchers) cb(open);
}

/** Gives focus back after the panel closes or goes away, if focus was in it. */
function giveFocusBack() {
  const back = returnTo;
  returnTo = null;
  const target = back?.isConnected && back !== document.body ? back : fallback();
  if (target?.isConnected) target.focus();
  else if (root.activeElement instanceof HTMLElement) root.activeElement.blur();
}

/** In a room the panel can open; out of one, it and its frame leave the page. */
export function showSidebar(room: boolean) {
  if (retired || room === inRoom) return;
  inRoom = room;
  if (room) return;
  const was = open;
  if (root.activeElement) giveFocusBack();
  open = false;
  returnTo = null;
  focusWhenReady = false;
  clearTimeout(closing);
  panel.classList.remove("closing");
  panel.hidden = true;
  asked++; // a pass still on its way is for this room's frame: drop it
  dropFrame(); // its port closes with it; a new room gets a fresh frame
  unmount();
  if (was) changed();
}

/**
 * Opens the chat panel and moves focus into it. `from` gets focus back on close; it defaults to
 * whatever had focus. Already open: just moves focus in.
 */
export function openSidebar(from: HTMLElement | null = focusedOnPage()) {
  if (retired || !inRoom || off) return;
  if (!open) {
    returnTo = from;
    open = true;
    clearTimeout(closing); // reopened mid-close: the close animation gives way
    panel.classList.remove("closing");
    panel.hidden = false;
    mount();
    for (const cb of openers) cb();
    changed();
  }
  // The frame puts focus on its first control when it gets focus.
  if (frame) return focusFrame(frame);
  focusWhenReady = true;
  loadFrame().catch((e: unknown) => console.debug("watchsync: chat frame", e));
}

/** Closes the panel; focus goes back where it was if it was in the panel. */
export function closeSidebar() {
  if (!open) return;
  open = false;
  focusWhenReady = false;
  const inside = root.activeElement !== null;
  changed(); // the pill redraws first, so focus lands on its button as it now stands
  if (inside) giveFocusBack();
  panel.classList.add("closing");
  const done = () => {
    clearTimeout(closing);
    panel.removeEventListener("animationend", done);
    if (open) return;
    panel.classList.remove("closing");
    panel.hidden = true;
  };
  panel.addEventListener("animationend", done);
  closing = setTimeout(done, 200); // no animation end (hidden tab, animations off)
}

export function toggleSidebar(from?: HTMLElement | null) {
  if (open) closeSidebar();
  else openSidebar(from);
}

export const isSidebarOpen = () => open;

/** Called each time the panel opens (UC-014 clears unread then). */
export function onSidebarOpen(cb: () => void) {
  openers.push(cb);
}

/** Called each time the panel opens or closes. */
export function onSidebarChange(cb: (open: boolean) => void) {
  watchers.push(cb);
}

/** Where focus goes on close when the control that opened the panel is gone. */
export function focusFallback(find: () => HTMLElement | null) {
  fallback = find;
}

/** This copy of the extension was replaced by an update: take the panel off for good. */
export function retireSidebar() {
  retired = true;
  clearTimeout(closing);
  clearTimeout(helloDue);
  unmount();
  document.removeEventListener("fullscreenchange", onFullscreen);
}

/** The element with focus on the page, outside our own UI. */
function focusedOnPage(): HTMLElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== host ? el : null;
}

function onFullscreen() {
  if (placed) mount();
}
document.addEventListener("fullscreenchange", onFullscreen);
