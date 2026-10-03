// WatchSync's on-page UI. A shadow root keeps the service's CSS out and ours in;
// the host moves into the fullscreen element so prompts stay visible in fullscreen.
import { type IconName, svgIcon } from "../shared/icons";
import { initialOf, toneOf } from "../shared/people";

const host = document.createElement("watchsync-overlay");
// Closed, so the service page can't read who is in the room; test builds open it so
// Playwright can reach the overlay.
const root = host.attachShadow({ mode: __MOCK__ ? "open" : "closed" });
let retired = false;

/** This copy of the extension was replaced by an update: take its UI off the page for good. */
export function retireOverlay() {
  retired = true;
  host.remove();
}
root.innerHTML = `<style>
  :host { all: initial; }
  .wrap, .pill { font: 14px/20px -apple-system, system-ui, "Segoe UI", sans-serif; color: #ecf2f1;
    -webkit-font-smoothing: antialiased; z-index: 2147483647; }
  /* Bottom right, above the player's own controls; notices stack upwards, newest on top. */
  .wrap { position: fixed; right: 24px; bottom: 96px; width: 340px; max-width: calc(100vw - 32px);
    display: flex; flex-direction: column; gap: 8px; align-items: flex-end; pointer-events: none;
    transition: transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  /* Chat is open on the right edge: notices move aside, not over it. On a narrow window
     there is no room beside it: passing notices wait, prompts and lasting lines stay. */
  @media (min-width: 720px) {
    .wrap.beside { transform: translateX(calc(-8px - clamp(320px, 26vw, 360px))); } }
  @media (max-width: 719.98px) { .wrap.beside .notices .card:not(.sticky) { display: none; } }
  .notices, .asks { display: flex; flex-direction: column; gap: 8px; align-items: flex-end;
    width: 100%; }
  .asks .card, .notices .card.ask { pointer-events: auto; }
  .card { box-sizing: border-box; display: grid; grid-template-columns: 32px minmax(0, 1fr);
    column-gap: 12px; align-items: start;
    max-width: 100%; padding: 12px 16px 12px 12px; border-radius: 16px;
    background: rgba(18, 26, 30, 0.95); backdrop-filter: blur(16px) saturate(140%);
    -webkit-backdrop-filter: blur(16px) saturate(140%);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(214, 236, 240, 0.1);
    animation: in 200ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  .card.out { opacity: 0; transform: translateY(4px);
    transition: opacity 160ms ease-in, transform 160ms ease-in; }
  /* A question: a warm edge so it reads as "needs you", unlike a passing notice. */
  .card.ask { box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 210, 90, 0.4); }
  .text { min-width: 0; padding-top: 6px; }
  .msg { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
  .detail { margin: 2px 0 0; color: #a9b8b9; font-size: 13px; line-height: 18px; }
  .mark { flex: none; position: relative; width: 32px; height: 32px; border-radius: 50%;
    display: grid; place-items: center; font-weight: 650; font-size: 14px; line-height: 1;
    background: rgba(214, 236, 240, 0.08); color: #ecf2f1; }
  .mark.ok { background: rgba(94, 216, 195, 0.16); color: #5ed8c3; }
  .mark.warn { background: rgba(255, 159, 74, 0.16); color: #ff9f4a; }
  .mark.bad { background: rgba(255, 107, 107, 0.16); color: #ff6b6b; }
  .mark.accent { background: rgba(255, 210, 90, 0.16); color: #ffd25a; }
  .badge { position: absolute; right: -5px; bottom: -5px; width: 18px; height: 18px;
    border-radius: 50%; display: grid; place-items: center; background: #ecf2f1; color: #0c1215;
    box-shadow: 0 0 0 2px #151d21; }
  .actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px;
    justify-content: flex-end; margin-top: 12px; }
  /* A lasting line's action (Try now): small and quiet, at the right of its words. */
  .card.inline { grid-template-columns: 32px minmax(0, 1fr) auto; }
  .card.inline .actions { grid-column: auto; align-self: center; margin: 0 0 0 4px; }
  .card.inline .actions button { height: 28px; min-height: 24px; padding: 0 10px;
    font-size: 13px; font-weight: 600; border-radius: 10px; }
  button { height: 36px; border: 0; border-radius: 12px; padding: 0 14px; font: inherit;
    font-weight: 650; cursor: pointer; background: rgba(214, 236, 240, 0.1); color: #ecf2f1;
    display: inline-flex; align-items: center; gap: 6px; transition: background 120ms; }
  button:hover { background: rgba(214, 236, 240, 0.17); }
  button.primary { background: #ffd25a; color: #1b1503; }
  button.primary:hover { background: #ffdd80; }
  /* A dark halo keeps the ring visible over a bright picture. */
  button:focus-visible { outline: 2px solid #ffd25a; outline-offset: 2px;
    box-shadow: 0 0 0 6px rgb(0 0 0 / 0.6); }

  .pill { position: fixed; top: 16px; display: flex; align-items: center; gap: 4px; padding: 4px;
    border-radius: 999px; background: rgba(18, 26, 30, 0.95); backdrop-filter: blur(16px) saturate(140%);
    -webkit-backdrop-filter: blur(16px) saturate(140%);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(214, 236, 240, 0.1);
    font-size: 13px; line-height: 18px; transition: opacity 150ms ease-out; }
  .pill[data-corner="tr"] { right: 16px; }
  .pill[data-corner="tl"] { left: 16px; }
  .pill.idle:not(:hover):not(:focus-within) { opacity: 0; transition: opacity 300ms ease-in; }
  .faces { display: flex; padding: 0 6px 0 2px; }
  .face { position: relative; box-sizing: border-box; width: 28px; height: 28px; border-radius: 50%;
    display: grid; place-items: center; font-weight: 650; font-size: 12px; line-height: 1;
    box-shadow: 0 0 0 2px #151d21; }
  .face + .face { margin-left: 6px; }
  .face[data-mark="away"] { border: 1.5px dashed rgba(236, 242, 241, 0.55); }
  /* State is shown by a mark as well as colour (WCAG 1.4.1). */
  .face[data-mark="synced"]::after, .face[data-mark="wait"]::after { position: absolute;
    right: -3px; bottom: -3px; width: 13px; height: 13px; border-radius: 50%; color: #0c1215;
    font-size: 9px; font-weight: 800; line-height: 13px; text-align: center;
    box-shadow: 0 0 0 2px #151d21; }
  .face[data-mark="synced"]::after { content: "✓"; background: #5ed8c3; }
  .face[data-mark="wait"]::after { content: "…"; background: #ff9f4a; line-height: 9px; }
  .sep { width: 1px; height: 20px; background: rgba(214, 236, 240, 0.14); margin: 0 2px; }
  .pill button { height: 32px; border-radius: 999px; padding: 0 12px; font-size: 13px; }
  .pill button.bare { width: 32px; padding: 0; justify-content: center; background: transparent;
    color: #a9b8b9; }
  .pill button.bare:hover { background: rgba(214, 236, 240, 0.1); color: #ecf2f1; }
  /* Icon and a visible "Chat"; yellow only while messages wait unread. */
  .pill button.chat { position: relative; padding: 0 12px 0 10px; }
  .pill button.chat[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
  .pill button.chat[aria-disabled="true"]:hover { background: rgba(214, 236, 240, 0.1); }
  .pill button.chat.primary .count { background: #ecf2f1; color: #0c1215; }
  /* Unread messages on the chat button (UC-014); 9+ past nine. */
  .count { position: absolute; top: -3px; right: -3px; box-sizing: border-box; min-width: 16px;
    height: 16px; padding: 0 4px; border-radius: 8px; background: #ffd25a; color: #1b1503;
    font-size: 10px; font-weight: 750; line-height: 16px; text-align: center;
    font-variant-numeric: tabular-nums; box-shadow: 0 0 0 2px #151d21; }
  .count[hidden] { display: none; }
  .count.pop { animation: pop 160ms ease-out; }
  @keyframes pop { from { transform: scale(0.8); } }
  @keyframes in { from { opacity: 0; transform: translateY(8px) scale(0.98); } }
  @media (prefers-reduced-motion: reduce) {
    .card, .count.pop { animation: none; }
    .card.out, .pill, .pill.idle:not(:hover):not(:focus-within), button, .wrap { transition: none; }
    .card.out { transform: none; }
  }
</style><div class="wrap"><div class="notices" role="status" aria-live="polite"></div><div class="asks" aria-live="polite"></div></div>`;
const notices = root.querySelector(".notices") as HTMLDivElement;
const asks = root.querySelector(".asks") as HTMLDivElement;

/** Keeps notices and prompts beside the open chat panel rather than over it. */
export function noticesBesideSidebar(open: boolean) {
  root.querySelector(".wrap")?.classList.toggle("beside", open);
}

function mount() {
  if (retired) return;
  const parent = document.fullscreenElement ?? document.documentElement;
  if (host.parentNode !== parent) parent.append(host);
}
document.addEventListener("fullscreenchange", mount);

export interface CardLook {
  /** Who acted: their initial leads the card. */
  who?: string | null;
  icon?: IconName;
  /** Colour of the icon when nobody acted. */
  tone?: "ok" | "warn" | "bad" | "accent";
  /** A quieter second line. */
  detail?: string;
}

function mark({ who, icon, tone }: CardLook): HTMLSpanElement {
  const m = document.createElement("span");
  m.className = "mark";
  m.setAttribute("aria-hidden", "true");
  if (who) {
    const t = toneOf(who);
    m.textContent = initialOf(who);
    m.style.color = t.fg;
    m.style.background = t.bg;
    if (icon) {
      const b = document.createElement("span");
      b.className = "badge";
      b.append(svgIcon(icon, 11));
      m.append(b);
    }
  } else {
    if (tone) m.classList.add(tone);
    m.append(svgIcon(icon ?? "sync", 16));
  }
  return m;
}

interface Card {
  card: HTMLDivElement;
  text: Text;
  detail: HTMLParagraphElement;
}

let ids = 0;

function card(message: string, look: CardLook): Card {
  mount();
  const c = document.createElement("div");
  c.className = "card";
  const body = document.createElement("div");
  body.className = "text";
  const msg = document.createElement("p");
  msg.className = "msg";
  msg.id = `ws-msg-${++ids}`;
  const text = document.createTextNode(message);
  msg.append(text);
  const detail = document.createElement("p");
  detail.className = "detail";
  detail.textContent = look.detail ?? "";
  detail.hidden = !look.detail;
  body.append(msg, detail);
  c.append(mark(look), body);
  return { card: c, text, detail };
}

const MAX_NOTICES = 3;

/** A short notice that disappears on its own. Newest on top; at most three at once. */
export function toast(message: string, ms = 4000, look: CardLook = {}) {
  const { card: c } = card(message, look);
  notices.prepend(c);
  const passing = notices.querySelectorAll(".card:not(.sticky)");
  for (const old of Array.from(passing).slice(MAX_NOTICES)) old.remove();
  setTimeout(() => {
    c.classList.add("out");
    setTimeout(() => c.remove(), 160);
  }, ms);
}

const sticky = new Map<string, Card>();

/**
 * A line that stays until cleared (null), e.g. while the connection is down, with optional
 * buttons. New words replace the old ones in place, so a screen reader hears each once.
 */
export function notice(
  key: string,
  message: string | null,
  look: CardLook = {},
  actions: Action[] = [],
) {
  const shown = sticky.get(key);
  if (message === null) {
    shown?.card.remove();
    sticky.delete(key);
    return;
  }
  if (shown) {
    if (shown.text.data === message) return;
    shown.text.data = message;
    setActions(shown.card, actions, false);
    return;
  }
  const made = card(message, look);
  made.card.classList.add("sticky", "inline");
  setActions(made.card, actions, false);
  notices.append(made.card);
  sticky.set(key, made);
}

export interface Action {
  label: string;
  primary?: boolean;
  run: () => void;
}

let current: {
  key: string;
  card: HTMLDivElement;
  text: Text;
  detail: HTMLParagraphElement;
  labels: string;
} | null = null;

/** Puts the buttons on a card, replacing any it had; a prompt's go away on a click. */
function setActions(c: HTMLDivElement, actions: Action[], closesPrompt = true) {
  c.querySelector(".actions")?.remove();
  c.classList.toggle("ask", actions.length > 0);
  if (!actions.length) {
    c.removeAttribute("role");
    c.removeAttribute("aria-labelledby");
    return;
  }
  // Buttons need their question: a group named by the message gives them that context.
  c.setAttribute("role", "group");
  c.setAttribute("aria-labelledby", c.querySelector(".msg")?.id ?? "");
  const row = document.createElement("div");
  row.className = "actions";
  for (const a of actions) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = a.label;
    if (a.primary) b.className = "primary";
    b.addEventListener("click", () => {
      if (closesPrompt) clearPrompt();
      a.run();
    });
    row.append(b);
  }
  c.append(row);
}

const labelsOf = (actions: Action[]) => actions.map((a) => a.label).join("\n");

/**
 * One question at a time; a new prompt replaces the old one. Showing the same `key` again
 * only updates its text, so a prompt refreshed every second neither flickers nor re-announces.
 * Prompts never take focus: they wait for a click or for the person to Tab to them.
 */
export function prompt(message: string, actions: Action[], key = message, look: CardLook = {}) {
  const labels = labelsOf(actions);
  if (current?.key === key) {
    if (current.text.data !== message) current.text.data = message;
    const detail = look.detail ?? "";
    if (current.detail.textContent !== detail) {
      current.detail.textContent = detail;
      current.detail.hidden = !detail;
    }
    // A prompt can change stage under one key (getting ready, then the countdown).
    if (current.labels !== labels) {
      setActions(current.card, actions);
      current.labels = labels;
    }
    return;
  }
  current?.card.remove();
  const made = card(message, look);
  setActions(made.card, actions);
  asks.append(made.card);
  current = { key, card: made.card, text: made.text, detail: made.detail, labels };
}

/** Removes the prompt; with `key`, only if that prompt is the one showing. */
export function clearPrompt(key?: string) {
  if (!current || (key && current.key !== key)) return;
  current.card.remove();
  current = null;
}

export interface PillPerson {
  name: string;
  /** Spoken and shown on hover, e.g. "Asha, in sync". */
  label: string;
  /** In sync, being waited for (loading or an ad), away, or none of these. */
  mark: "synced" | "wait" | "away" | "none";
}

export interface PillModel {
  people: PillPerson[];
  following: boolean;
  onSync: () => void;
  onOwn: () => void;
  /** Start with 3-2-1; null hides the button (not on the room's title, or alone). */
  onStart: (() => void) | null;
  /** This tab's player is playing: the start button becomes Pause everyone. */
  playing: boolean;
  onPause: () => void;
  /**
   * Bring everyone here: jump the room to my exact position, no pause or countdown. Null
   * hides it while I'm in step: small drift is fixed on its own, and the room can't see
   * friends' exact positions, so it shows only when my player is off from the room's.
   */
  onSyncAll: (() => void) | null;
  /** Open or close chat; opened from here, the button gets focus back when it closes. */
  onChat: (from: HTMLElement) => void;
  chatOpen: boolean;
  /** Chat was turned off on this page because the page interfered with it. */
  chatOff: boolean;
}

export const CHAT_OFF = "Chat is turned off on this page because the page interfered with it.";

const pill = document.createElement("div");
pill.className = "pill";
pill.setAttribute("role", "region");
pill.setAttribute("aria-label", "WatchSync room");
let corner: "tr" | "tl" = "tr";
/** Folded down to the faces, so the pill stays out of the way of the player (owner, 2 Oct). */
let collapsed = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let idle = false;

// Like the player's own controls: visible while the mouse moves, faded after 3 s still. The
// class flips only when the state does, and the listener captures, so a player that stops
// mouse events on the way still wakes it.
function wake() {
  if (idle) {
    idle = false;
    pill.classList.remove("idle");
  }
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idle = true;
    pill.classList.add("idle");
  }, 3000);
}
document.addEventListener("mousemove", wake, { passive: true, capture: true });

let lastModel: PillModel | null = null;
chrome.storage.local.get(["pillCorner", "pillCollapsed"]).then(({ pillCorner, pillCollapsed }) => {
  if (pillCorner === "tl") corner = "tl"; // set by earlier versions, which could move the pill
  pill.dataset.corner = corner;
  if (pillCollapsed === true) {
    collapsed = true;
    if (lastModel) renderPill(lastModel);
  }
});

interface ButtonLook {
  primary?: boolean;
  /** A longer explanation, shown on hover. */
  hint?: string;
  icon?: IconName;
  /** Icon only: the label becomes the accessible name and tooltip. */
  bare?: boolean;
}

function button(label: string, run: () => void, look: ButtonLook = {}): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  if (look.icon) b.append(svgIcon(look.icon, look.bare ? 16 : 14));
  if (look.bare) {
    b.setAttribute("aria-label", label);
    b.title = label;
  } else b.append(label);
  if (look.hint) b.title = look.hint;
  b.className = [look.primary && "primary", look.bare && "bare"].filter(Boolean).join(" ");
  b.addEventListener("click", run);
  return b;
}

/** The chat shortcut as Chrome suggests it on this system (build.mjs `commands`). */
const SHORTCUT = /Mac/.test(navigator.platform) ? "Control+Shift+W" : "Alt+Shift+W";

// The one way into chat on the page (with the shortcut). One lasting button, so focus can
// come back to it after chat closes even though the pill redraws in between.
// Icon plus a visible "Chat"; the accessible name (set in drawChat) says more and contains it.
const chat = button("Chat", () => lastModel?.onChat(chat), { icon: "chat" });
chat.classList.add("chat");
chat.setAttribute("aria-keyshortcuts", SHORTCUT);
// Space or Enter on this button opens chat; it mustn't also play or pause the player.
for (const type of ["keydown", "keyup", "keypress"])
  chat.addEventListener(type, (e) => {
    if (e instanceof KeyboardEvent && (e.key === " " || e.key === "Enter")) e.stopPropagation();
  });
const count = document.createElement("span");
count.className = "count";
count.setAttribute("aria-hidden", "true");
count.hidden = true;
chat.append(count);
let unread = 0;

function drawChat() {
  const open = lastModel?.chatOpen === true;
  const off = lastModel?.chatOff === true;
  const base = off ? CHAT_OFF : open ? "Close chat" : `Open chat (${SHORTCUT})`;
  const label = unread && !off ? `${base}, ${unread} unread` : base;
  chat.setAttribute("aria-label", label);
  chat.title = label;
  chat.setAttribute("aria-expanded", String(open));
  // Still focusable and named, so the reason can be found; it does nothing when pressed.
  if (off) chat.setAttribute("aria-disabled", "true");
  else chat.removeAttribute("aria-disabled");
  count.hidden = unread === 0 || off;
  chat.classList.toggle("primary", !count.hidden);
  count.textContent = unread > 9 ? "9+" : String(unread);
}

/** Unread messages on the chat button; 0 hides the count. It pops only when the first arrives. */
export function setChatBadge(n: number) {
  const next = Math.max(0, Math.floor(n));
  if (unread === 0 && next > 0) {
    count.classList.remove("pop");
    count.addEventListener("animationend", () => count.classList.remove("pop"), { once: true });
    requestAnimationFrame(() => count.classList.add("pop"));
  }
  unread = next;
  drawChat();
}

/** The chat button while it's on the page: where focus goes when chat closes. */
export function chatButton(): HTMLElement | null {
  return chat.isConnected ? chat : null;
}

/** The overlay control that has focus, if any (its shadow root hides it from the page). */
export function focusedControl(): HTMLElement | null {
  return root.activeElement instanceof HTMLElement ? root.activeElement : null;
}

/** Shows who's here and in sync; null hides it (not in a room). */
export function renderPill(model: PillModel | null) {
  lastModel = model;
  if (!model) return pill.remove();
  mount();
  if (!pill.isConnected) root.append(pill);
  pill.dataset.corner = corner;
  const faces = document.createElement("span");
  faces.className = "faces";
  for (const p of model.people) {
    const f = document.createElement("span");
    const t = toneOf(p.name);
    f.className = "face";
    f.dataset.mark = p.mark;
    f.textContent = initialOf(p.name);
    f.style.color = t.fg;
    f.style.background = t.bg;
    f.title = p.label;
    f.setAttribute("role", "img");
    f.setAttribute("aria-label", p.label);
    faces.append(f);
  }
  // The fold arrow points to the edge the pill tucks into, and back out when folded.
  const toEdge: IconName = corner === "tr" ? "right" : "left";
  const fromEdge: IconName = corner === "tr" ? "left" : "right";
  const fold = button(
    collapsed ? "Show room controls" : "Hide room controls",
    () => {
      collapsed = !collapsed;
      void chrome.storage.local.set({ pillCollapsed: collapsed });
      renderPill(model);
      pill.querySelector<HTMLButtonElement>("button:last-of-type")?.focus();
    },
    { icon: collapsed ? fromEdge : toEdge, bare: true },
  );
  fold.setAttribute("aria-expanded", String(!collapsed));
  pill.classList.toggle("folded", collapsed);
  drawChat();
  // Redrawing takes the chat button out and back in, which drops its focus: keep it.
  const chatFocused = root.activeElement === chat;
  // Chat stays reachable when the pill is folded: it is the only button for it.
  if (collapsed) {
    pill.replaceChildren(faces, chat, fold);
    if (chatFocused) chat.focus();
    return wake();
  }
  const sep = document.createElement("span");
  sep.className = "sep";
  sep.setAttribute("aria-hidden", "true");
  const toggle = model.following
    ? button("Watch on my own", model.onOwn, {
        hint: "Play, pause and jump just for you. The room carries on.",
      })
    : button("Watch with the room", model.onSync, {
        primary: true,
        icon: "sync",
        hint: "Follow the room again, from where it is now.",
      });
  // Start with 3-2-1 while paused; once everyone is playing, the same place pauses everyone.
  const together = model.onStart
    ? [
        model.playing
          ? button("Pause everyone", model.onPause, {
              primary: true,
              icon: "pause",
              hint: "Pause everyone in the room",
            })
          : button("Start with 3-2-1", model.onStart, {
              primary: true,
              icon: "play",
              hint: "Pause everyone, count down 3-2-1, start at the same moment",
            }),
      ]
    : [];
  const syncAll =
    model.onStart && model.onSyncAll
      ? [
          button("Bring everyone here", model.onSyncAll, {
            icon: "sync",
            hint: "Bring everyone to exactly where you are, without pausing",
          }),
        ]
      : [];
  // Chat first after the faces: the one control people reach for most.
  pill.replaceChildren(faces, sep, chat, toggle, ...syncAll, ...together, fold);
  if (chatFocused) chat.focus();
  wake();
}
