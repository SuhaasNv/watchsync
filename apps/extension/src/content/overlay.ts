// WatchSync's on-page UI. A shadow root keeps the service's CSS out and ours in;
// the host moves into the fullscreen element so prompts stay visible in fullscreen.

const host = document.createElement("watchsync-overlay");
const root = host.attachShadow({ mode: "open" });
root.innerHTML = `<style>
  :host { all: initial; }
  .wrap { position: fixed; right: 24px; bottom: 96px; z-index: 2147483647; display: flex;
    flex-direction: column; gap: 8px; align-items: flex-end;
    font: 14px/20px -apple-system, system-ui, sans-serif; }
  .card { max-width: 340px; padding: 14px 16px; border-radius: 14px; background: #121a1e;
    color: #ecf2f1; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(214, 236, 240, 0.12);
    animation: in 0.2s ease-out; }
  .row { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; }
  button { height: 34px; border: 0; border-radius: 9px; padding: 0 12px; font: inherit;
    font-weight: 600; cursor: pointer; background: #19242a; color: #ecf2f1; }
  button.primary { background: #ffd25a; color: #1b1503; }
  button:focus-visible { outline: 2px solid #ffd25a; outline-offset: 2px; }
  .pill { position: fixed; top: 16px; z-index: 2147483647; display: flex; align-items: center;
    gap: 6px; padding: 6px; border-radius: 999px; background: #121a1e;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(214, 236, 240, 0.12);
    font: 13px/18px -apple-system, system-ui, sans-serif; color: #ecf2f1;
    transition: opacity 0.3s ease-out; }
  .pill[data-corner="tr"] { right: 16px; }
  .pill[data-corner="tl"] { left: 16px; }
  .pill.idle:not(:hover):not(:focus-within) { opacity: 0; }
  .pill button { height: 28px; min-width: 28px; border-radius: 999px; }
  .face { width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center;
    justify-content: center; background: #2a363c; color: #ecf2f1; font-weight: 600;
    box-shadow: inset 0 0 0 2px #7f9092; }
  .face { position: relative; }
  .face.synced { box-shadow: inset 0 0 0 2px #5ed8c3; }
  /* In sync is shown by a mark as well as colour (WCAG 1.4.1). */
  .face.synced::after { content: "✓"; position: absolute; right: -3px; bottom: -3px; width: 14px;
    height: 14px; border-radius: 50%; background: #5ed8c3; color: #0c1215; font-size: 10px;
    line-height: 14px; text-align: center; }
  @keyframes in { from { opacity: 0; transform: translateY(8px); } }
  @media (prefers-reduced-motion: reduce) { .card { animation: none; } .pill { transition: none; } }
</style><div class="wrap" role="status" aria-live="polite"></div>`;
const wrap = root.querySelector(".wrap") as HTMLDivElement;

function mount() {
  const parent = document.fullscreenElement ?? document.documentElement;
  if (host.parentNode !== parent) parent.append(host);
}
document.addEventListener("fullscreenchange", mount);

function card(message: string): HTMLDivElement {
  mount();
  const c = document.createElement("div");
  c.className = "card";
  c.textContent = message;
  wrap.append(c);
  return c;
}

/** A short notice that disappears on its own. */
export function toast(message: string, ms = 4000) {
  const c = card(message);
  setTimeout(() => c.remove(), ms);
}

export interface Action {
  label: string;
  primary?: boolean;
  run: () => void;
}

let current: { key: string; card: HTMLDivElement; text: Text } | null = null;

/**
 * One question at a time; a new prompt replaces the old one. Showing the same `key` again
 * only updates its text, so a prompt refreshed every second neither flickers nor re-announces.
 */
export function prompt(message: string, actions: Action[], key = message) {
  if (current?.key === key) {
    if (current.text.data !== message) current.text.data = message;
    return;
  }
  current?.card.remove();
  const c = card("");
  const text = document.createTextNode(message);
  c.append(text);
  const row = document.createElement("div");
  row.className = "row";
  for (const a of actions) {
    const b = document.createElement("button");
    b.textContent = a.label;
    if (a.primary) b.className = "primary";
    b.addEventListener("click", () => {
      clearPrompt();
      a.run();
    });
    row.append(b);
  }
  c.append(row);
  current = { key, card: c, text };
}

/** Removes the prompt; with `key`, only if that prompt is the one showing. */
export function clearPrompt(key?: string) {
  if (!current || (key && current.key !== key)) return;
  current.card.remove();
  current = null;
}

export interface PillPerson {
  initial: string;
  /** Spoken and shown on hover, e.g. "Asha, in sync". */
  label: string;
  synced: boolean;
}

export interface PillModel {
  people: PillPerson[];
  following: boolean;
  onSync: () => void;
  onOwn: () => void;
  /** Start together; null hides the button (not on the room's title, or alone). */
  onStart: (() => void) | null;
}

const pill = document.createElement("div");
pill.className = "pill";
pill.setAttribute("role", "region");
pill.setAttribute("aria-label", "WatchSync room");
let corner: "tr" | "tl" = "tr";
let idleTimer: ReturnType<typeof setTimeout> | undefined;

// Like the player's own controls: visible while the mouse moves, faded after 3 s still.
function wake() {
  pill.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => pill.classList.add("idle"), 3000);
}
document.addEventListener("mousemove", wake, { passive: true });

chrome.storage.local.get("pillCorner").then(({ pillCorner }) => {
  if (pillCorner === "tl") corner = "tl";
  pill.dataset.corner = corner;
});

function button(label: string, run: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  if (primary) b.className = "primary";
  b.addEventListener("click", run);
  return b;
}

/** Shows who's here and in sync; null hides it (not in a room). */
export function renderPill(model: PillModel | null) {
  if (!model) return pill.remove();
  mount();
  if (!pill.isConnected) root.append(pill);
  pill.dataset.corner = corner;
  const faces = model.people.map((p) => {
    const f = document.createElement("span");
    f.className = `face${p.synced ? " synced" : ""}`;
    f.textContent = p.initial;
    f.title = p.label;
    f.setAttribute("role", "img");
    f.setAttribute("aria-label", p.label);
    return f;
  });
  const toggle = model.following
    ? button("Watch on my own", model.onOwn)
    : button("Sync", model.onSync, true);
  const move = button(corner === "tr" ? "Move left" : "Move right", () => {
    corner = corner === "tr" ? "tl" : "tr";
    void chrome.storage.local.set({ pillCorner: corner });
    renderPill(model);
  });
  const start = model.onStart ? [button("Start together", model.onStart)] : [];
  pill.replaceChildren(...faces, toggle, ...start, move);
  wake();
}
