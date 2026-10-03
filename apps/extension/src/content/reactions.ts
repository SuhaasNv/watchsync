// Reactions floating over the video (US-045, US-046). One fixed layer in its own shadow root
// that follows the player into full screen, never takes clicks and keeps clear of subtitles;
// at most five on screen, reusing five nodes. Incoming ones are announced politely, merged.
import type { Emoji } from "@watchsync/protocol";
import { announcement } from "../shared/reactions";

export const POOL = 5;
const FLOAT_MS = 2800;
const STILL_MS = 1500;
/** One float per sender in this long; the rest of a burst rides on the count. */
const PER_SENDER_MS = 300;
/** Reactions heard within this long are said in one line. */
const SAY_MS = 1500;

const host = document.createElement("watchsync-reactions");
const root = host.attachShadow({ mode: __MOCK__ ? "open" : "closed" });
root.innerHTML = `<style>
  :host { all: initial !important; }
  .layer { position: fixed; z-index: 2147483645; right: 24px; bottom: 120px; width: 96px;
    height: 50vh; pointer-events: none; contain: strict; }
  .layer.beside { right: 360px; }
  .r { position: absolute; bottom: 0; display: grid; justify-items: center; gap: 2px;
    opacity: 0; font: 30px/1 -apple-system, system-ui, "Segoe UI", sans-serif;
    text-shadow: 0 1px 2px rgb(0 0 0 / 0.5); }
  .r[hidden] { display: none; }
  .x { font-size: 14px; font-weight: 600; color: #ecf2f1; }
  .n { max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    padding: 2px 6px; border-radius: 12px; background: rgba(18, 26, 30, 0.95);
    color: #ecf2f1; font-size: 12px; line-height: 16px; text-shadow: none;
    unicode-bidi: isolate; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style><div class="layer" aria-hidden="true"></div><p class="sr" role="status"></p>`;

const layer = root.querySelector(".layer") as HTMLDivElement;
const say = root.querySelector(".sr") as HTMLParagraphElement;

interface Slot {
  node: HTMLSpanElement;
  anim: Animation | null;
  at: number;
}
const slots: Slot[] = Array.from({ length: POOL }, () => {
  const node = document.createElement("span");
  node.className = "r";
  node.hidden = true;
  layer.append(node);
  return { node, anim: null, at: 0 };
});
const lastFrom = new Map<string, number>();
let heard: { name: string; emoji: Emoji }[] = [];
let saying: ReturnType<typeof setTimeout> | undefined;
let placed = false;
/** Order the nodes were taken in, so the oldest gives way first. */
let taken = 0;

const where = () => document.fullscreenElement ?? document.documentElement;

function mount() {
  if (!placed) return;
  const parent = where();
  if (host.parentNode !== parent) parent.append(host);
}
document.addEventListener("fullscreenchange", mount);

/** In a room the layer is on the page; out of one it and its announcements go. */
export function showReactions(room: boolean) {
  placed = room;
  if (room) return mount();
  for (const s of slots) release(s);
  clearTimeout(saying);
  heard = [];
  say.textContent = "";
  host.remove();
}

/** Clear of the chat panel when it is open (it is 320px wide at 16px from the edge). */
export function reactionsBesideChat(open: boolean) {
  layer.classList.toggle("beside", open);
}

/** This copy was replaced by an update: off the page for good. */
export function retireReactions() {
  showReactions(false);
  document.removeEventListener("fullscreenchange", mount);
}

function release(s: Slot) {
  s.anim?.cancel();
  s.anim = null;
  s.node.hidden = true;
}

/** A free node, or the oldest one when five are already up. */
function take(): Slot {
  const free = slots.find((s) => s.anim === null);
  if (free) return free;
  const oldest = slots.reduce((a, b) => (b.at < a.at ? b : a));
  release(oldest);
  return oldest;
}

/** Above the player's bottom fifth, where subtitles sit, and never below 120px. */
function keepClearOfSubtitles() {
  const video = document.querySelector("video");
  const r = video?.getBoundingClientRect();
  const clear = r && r.height > 0 ? innerHeight - r.bottom + r.height * 0.2 : 0;
  layer.style.bottom = `${Math.max(120, Math.round(clear))}px`;
}

/** Floats a reaction with the sender's name; `mine` is not announced back to its sender. */
export function showReaction(r: {
  fromId: string;
  name: string;
  emoji: Emoji;
  count: number;
  mine: boolean;
}) {
  if (!placed || document.hidden) return;
  const now = performance.now();
  if (now - (lastFrom.get(r.fromId) ?? -Infinity) < PER_SENDER_MS) return;
  lastFrom.set(r.fromId, now);
  if (!r.mine) hear(r.name, r.emoji);

  keepClearOfSubtitles();
  const slot = take();
  const emoji = document.createElement("span");
  emoji.textContent = r.emoji;
  const parts: HTMLElement[] = [emoji];
  if (r.count > 1) {
    const x = document.createElement("span");
    x.className = "x";
    x.textContent = `×${r.count}`;
    parts.push(x);
  }
  const who = document.createElement("span");
  who.className = "n";
  who.dir = "auto";
  who.textContent = r.name;
  parts.push(who);
  slot.node.replaceChildren(...parts);
  slot.node.style.left = `${Math.round(Math.random() * 24)}px`;
  slot.node.hidden = false;
  slot.at = ++taken;

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const drift = Math.random() < 0.5 ? -16 : 16;
  const anim = still
    ? slot.node.animate(
        [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }],
        {
          duration: STILL_MS,
          easing: "linear",
        },
      )
    : slot.node.animate(
        [
          { transform: "translate3d(0, 0, 0) scale(0.8)", opacity: 0 },
          { transform: "translate3d(0, -24px, 0) scale(1)", opacity: 1, offset: 0.1 },
          { opacity: 1, offset: 0.75 },
          { transform: `translate3d(${drift}px, -240px, 0) scale(1)`, opacity: 0 },
        ],
        { duration: FLOAT_MS, easing: "cubic-bezier(0.2, 0.6, 0.3, 1)" },
      );
  slot.anim = anim;
  anim.finished
    .then(() => {
      if (slot.anim === anim) release(slot);
    })
    .catch(() => {}); // cancelled: its node was taken for a newer reaction
}

/** Gathers reactions for a moment and says them in one line ("Asha and 2 others: Laugh"). */
function hear(name: string, emoji: Emoji) {
  heard.push({ name, emoji });
  if (saying !== undefined) return;
  saying = setTimeout(() => {
    saying = undefined;
    say.textContent = announcement(heard);
    heard = [];
  }, SAY_MS);
}
