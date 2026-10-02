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
  @keyframes in { from { opacity: 0; transform: translateY(8px); } }
  @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
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

let current: HTMLDivElement | null = null;

/** One question at a time; a new prompt replaces the old one. */
export function prompt(message: string, actions: Action[]) {
  current?.remove();
  const c = card(message);
  const row = document.createElement("div");
  row.className = "row";
  for (const a of actions) {
    const b = document.createElement("button");
    b.textContent = a.label;
    if (a.primary) b.className = "primary";
    b.addEventListener("click", () => {
      c.remove();
      a.run();
    });
    row.append(b);
  }
  c.append(row);
  current = c;
}

export function clearPrompt() {
  current?.remove();
  current = null;
}
