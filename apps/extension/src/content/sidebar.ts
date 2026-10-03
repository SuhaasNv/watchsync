// The WatchSync sidebar (UC-013): a slim panel over the right edge of the page, or one small
// round button while collapsed. Its own shadow root keeps the service's CSS out and ours in;
// the host moves into the fullscreen element so it stays visible in full screen.
import { svgIcon } from "../shared/icons";

const host = document.createElement("watchsync-sidebar");
// Closed, so the service page can't read the room; test builds open it for Playwright.
const root = host.attachShadow({ mode: __MOCK__ ? "open" : "closed" });
root.innerHTML = `<style>
  :host { all: initial; }
  .panel, .toggle { font: 14px/20px -apple-system, system-ui, "Segoe UI", sans-serif;
    color: #ecf2f1; -webkit-font-smoothing: antialiased; z-index: 2147483647; position: fixed; }
  /* Below the pill and above the player's bottom controls, so neither is covered. */
  .panel { right: 16px; top: 72px; bottom: 120px; width: 320px; max-width: calc(100vw - 32px);
    min-height: 160px; box-sizing: border-box; display: flex; flex-direction: column;
    border-radius: 16px; background: rgba(18, 26, 30, 0.95);
    backdrop-filter: blur(16px) saturate(140%); -webkit-backdrop-filter: blur(16px) saturate(140%);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(214, 236, 240, 0.1);
    animation: in 200ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  .panel[hidden], .toggle[hidden], .badge[hidden] { display: none; }
  .head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 12px 16px;
    border-bottom: 1px solid rgba(214, 236, 240, 0.1); }
  h2 { margin: 0; font-size: 15px; line-height: 20px; font-weight: 650; }
  .code { color: #a9b8b9; font-size: 13px; line-height: 18px; letter-spacing: 0.04em; }
  .body { flex: 1; min-height: 0; overflow: auto; }
  button { border: 0; padding: 0; font: inherit; cursor: pointer; display: grid;
    place-items: center; transition: background 120ms; }
  button:focus-visible { outline: 2px solid #ffd25a; outline-offset: 2px; }
  .close { margin-left: auto; width: 32px; height: 32px; border-radius: 999px;
    background: transparent; color: #a9b8b9; }
  .close:hover { background: rgba(214, 236, 240, 0.1); color: #ecf2f1; }
  .toggle { right: 16px; top: 50%; margin-top: -20px; width: 40px; height: 40px;
    border-radius: 50%; background: rgba(18, 26, 30, 0.95); color: #ecf2f1;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(214, 236, 240, 0.1);
    transition: background 120ms, opacity 0.3s ease-out; }
  .toggle:hover { background: rgba(38, 50, 56, 0.95); }
  .toggle.idle:not(:hover):not(:focus-visible) { opacity: 0; }
  .badge { position: absolute; top: -4px; right: -4px; box-sizing: border-box; min-width: 18px;
    height: 18px; padding: 0 5px; border-radius: 9px; background: #ffd25a; color: #1b1503;
    font-size: 11px; font-weight: 750; line-height: 18px; text-align: center; }
  @keyframes in { from { opacity: 0; transform: translateX(16px); } }
</style>
<button type="button" class="toggle" aria-expanded="false" aria-controls="ws-sidebar"
  hidden><span class="badge" aria-hidden="true" hidden></span></button>
<div class="panel" id="ws-sidebar" role="region" aria-labelledby="ws-sidebar-title" hidden>
  <div class="head">
    <h2 id="ws-sidebar-title">WatchSync</h2>
    <span class="code"></span>
    <button type="button" class="close" aria-label="Close WatchSync sidebar" title="Close"
      aria-expanded="true" aria-controls="ws-sidebar"></button>
  </div>
  <!-- UC-014 fills this with the room's chat. -->
  <section class="body" id="ws-sidebar-body" data-sidebar-body aria-label="Chat"></section>
</div>`;

const panel = root.querySelector(".panel") as HTMLDivElement;
const toggle = root.querySelector(".toggle") as HTMLButtonElement;
const badge = root.querySelector(".badge") as HTMLSpanElement;
const close = root.querySelector(".close") as HTMLButtonElement;
const codeText = root.querySelector(".code") as HTMLSpanElement;
const body = root.querySelector(".body") as HTMLElement;
toggle.prepend(svgIcon("chat", 18));
close.append(svgIcon("close", 16));

/** The room this sidebar belongs to; null while not in a room (nothing on the page). */
let code: string | null = null;
let open = false;
let retired = false;
let unread = 0;
/** Where focus was before the sidebar opened, to give it back on close. */
let returnTo: HTMLElement | null = null;
const openers: (() => void)[] = [];
const watchers: ((open: boolean) => void)[] = [];

function mount() {
  if (retired || !code) return;
  const parent = document.fullscreenElement ?? document.documentElement;
  if (host.parentNode === parent) return;
  // Moving the host in or out of full screen drops focus: keep it on the same control.
  const focused = root.activeElement;
  parent.append(host);
  if (focused instanceof HTMLElement) focused.focus();
}

let idleTimer: ReturnType<typeof setTimeout> | undefined;

// Like the pill and the player's own controls: the collapsed button fades after 3 s still.
function wake() {
  toggle.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => toggle.classList.add("idle"), 3000);
}

function render() {
  panel.hidden = !open;
  toggle.hidden = open;
  badge.hidden = unread === 0;
  badge.textContent = unread > 99 ? "99+" : String(unread);
  const label = "Open WatchSync sidebar";
  toggle.setAttribute("aria-label", unread ? `${label}, ${unread} unread` : label);
  toggle.title = label;
}

function changed() {
  for (const cb of watchers) cb(open);
}

/** In a room: show the sidebar's button with this room code. null takes it all off the page. */
export function showSidebar(roomCode: string | null) {
  if (retired || roomCode === code) return;
  code = roomCode;
  if (!roomCode) {
    const was = open;
    open = false;
    returnTo = null;
    host.remove();
    render();
    if (was) changed();
    return;
  }
  codeText.textContent = `Room ${roomCode}`;
  render();
  mount();
  wake();
}

/**
 * Opens the sidebar and moves focus into it. `from` gets focus back on close; it defaults to
 * whatever had focus. Already open: just moves focus in.
 */
export function openSidebar(from: HTMLElement | null = focusedOnPage()) {
  if (retired || !code) return;
  if (!open) {
    returnTo = from;
    open = true;
    render();
    mount();
    for (const cb of openers) cb();
    changed();
  }
  // UC-014 can mark its message box to take focus first.
  (root.querySelector<HTMLElement>("[data-focus-first]") ?? close).focus();
}

/** Collapses to the small button; focus goes back where it was if it was in the sidebar. */
export function closeSidebar() {
  if (!open) return;
  const inside = root.activeElement !== null;
  const back = returnTo;
  returnTo = null;
  if (inside && root.activeElement instanceof HTMLElement) root.activeElement.blur();
  open = false;
  render();
  changed();
  if (inside && back?.isConnected && back !== document.body) back.focus();
}

export function toggleSidebar(from?: HTMLElement | null) {
  if (open) closeSidebar();
  else openSidebar(from);
}

export const isSidebarOpen = () => open;

/** The empty region UC-014 fills with chat. */
export const sidebarBody = (): HTMLElement => body;

/** Unread messages, shown on the collapsed button; 0 hides the count. */
export function setCollapsedBadge(n: number) {
  unread = Math.max(0, Math.floor(n));
  render();
}

/** Called each time the sidebar opens (UC-014 clears unread then). */
export function onSidebarOpen(cb: () => void) {
  openers.push(cb);
}

/** Called each time the sidebar opens or collapses. */
export function onSidebarChange(cb: (open: boolean) => void) {
  watchers.push(cb);
}

/** This copy of the extension was replaced by an update: take the sidebar off for good. */
export function retireSidebar() {
  retired = true;
  host.remove();
  clearTimeout(idleTimer);
  document.removeEventListener("fullscreenchange", mount);
  document.removeEventListener("mousemove", wake);
}

/** The element with focus on the page, outside our own UI. */
function focusedOnPage(): HTMLElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== host ? el : null;
}

toggle.addEventListener("click", () => openSidebar(toggle));
close.addEventListener("click", closeSidebar);
root.addEventListener("keydown", (e) => {
  if (e instanceof KeyboardEvent && e.key === "Escape" && open) {
    e.preventDefault();
    closeSidebar();
  }
});
document.addEventListener("fullscreenchange", mount);
document.addEventListener("mousemove", wake, { passive: true });
