// Reactions floating over the video (US-045, US-046). One fixed layer in its own shadow root
// that follows the player into full screen, never takes clicks and keeps clear of subtitles;
// at most five on screen, reusing five nodes. A burst of taps floats as that many separate
// emojis, like live hearts. Incoming ones are announced politely, merged.
import type { Emoji } from "@watchsync/protocol";
import { announcement, MAX_COUNT } from "../shared/reactions";

export const POOL = 5;
/** Reduced motion: fade in, stay put, fade out. */
const FADE_MS = 150;
const STILL_MS = 1500;
/** A lone tap (count 1) from one sender floats at most once in this long. */
const PER_SENDER_MS = 300;
/** Reactions heard within this long are said in one line. */
const SAY_MS = 1500;
/** Width of the lane the emojis start in, and the widest sideways sway. */
const LANE = 200;
const MAX_SWAY = 28;

/** The random look of one floating emoji, chosen when it spawns. */
export interface Variation {
  /** Start offset of the emoji's left side from the lane's left edge, px. */
  left: number;
  /** How far it rises, px. */
  rise: number;
  /** How long it lives, ms. */
  duration: number;
  /** Sideways offsets (px, left or right) it passes through on the way up. */
  sway: number[];
  /** Font size, px. */
  size: number;
  /** Gap after the previous emoji of a burst, ms. */
  delay: number;
}

const between = (random: () => number, lo: number, hi: number) =>
  Math.round(lo + random() * (hi - lo));

/** One emoji's random size, lane position, rise, lifetime, sway and stagger. */
export function variation(random: () => number = Math.random): Variation {
  const size = between(random, 26, 34);
  const left = between(random, MAX_SWAY, LANE - MAX_SWAY - size);
  const rise = between(random, 200, 320);
  const duration = between(random, 2400, 4200);
  const points = random() < 0.5 ? 3 : 4;
  const sway = Array.from(
    { length: points },
    () => (random() < 0.5 ? -1 : 1) * between(random, 12, 28),
  );
  const delay = between(random, 70, 140);
  return { left, rise, duration, sway, size, delay };
}

const host = document.createElement("watchsync-reactions");
const root = host.attachShadow({ mode: __MOCK__ ? "open" : "closed" });
root.innerHTML = `<style>
  :host { all: initial !important; }
  .layer { position: fixed; z-index: 2147483645; right: 24px; bottom: 120px; width: ${LANE}px;
    height: max(50vh, 360px); pointer-events: none; contain: strict; }
  /* Beside the chat panel (16 px from the edge, 320 to 360 px wide). */
  .layer.beside { right: max(360px, calc(clamp(320px, 26vw, 360px) + 24px)); }
  .r { position: absolute; bottom: 0; opacity: 0;
    font: 30px/1 -apple-system, system-ui, "Segoe UI", sans-serif;
    text-shadow: 0 1px 2px rgb(0 0 0 / 0.5); }
  .r[hidden] { display: none; }
  /* The name hangs centred under the emoji without widening its box. */
  .n { position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
    margin-top: 2px; width: max-content; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
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
/** Spawns of a burst that are still waiting their turn. */
const queued = new Set<ReturnType<typeof setTimeout>>();
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
  for (const t of queued) clearTimeout(t);
  queued.clear();
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

/** Keyframes of a float: a pop at the start, a gentle sway on the way up, then it fades. */
function floatFrames(v: Variation): Keyframe[] {
  const settled = 0.16;
  const frames: Keyframe[] = [
    { offset: 0, transform: "translate3d(0, 0, 0) scale(0.8)", opacity: 0 },
    {
      offset: 0.08,
      transform: `translate3d(0, ${-Math.round(v.rise * 0.08)}px, 0) scale(1.15)`,
      opacity: 1,
    },
    {
      offset: settled,
      transform: `translate3d(0, ${-Math.round(v.rise * settled)}px, 0) scale(1)`,
    },
    { offset: 0.7, opacity: 1 },
  ];
  v.sway.forEach((x, i) => {
    const at = settled + ((1 - settled) * (i + 1)) / v.sway.length;
    frames.push({
      offset: at,
      transform: `translate3d(${x}px, ${-Math.round(v.rise * at)}px, 0) scale(1)`,
      ...(i === v.sway.length - 1 ? { opacity: 0 } : {}),
    });
  });
  return frames.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
}

/** Puts one emoji on screen; only the first of a burst is given the sender's name. */
function float(emoji: Emoji, name: string | null, v: Variation) {
  const slot = take();
  const glyph = document.createElement("span");
  glyph.textContent = emoji;
  const parts: HTMLElement[] = [glyph];
  let who: HTMLSpanElement | null = null;
  if (name !== null) {
    who = document.createElement("span");
    who.className = "n";
    who.dir = "auto";
    who.textContent = name;
    parts.push(who);
  }
  slot.node.replaceChildren(...parts);
  slot.node.style.fontSize = `${v.size}px`;
  slot.node.hidden = false;
  slot.at = ++taken;
  // Keep the emoji, its name chip and its sway inside the lane.
  const edge = MAX_SWAY + Math.max(v.size, who?.offsetWidth ?? 0) / 2;
  const centre = Math.min(Math.max(v.left + v.size / 2, edge), LANE - edge);
  slot.node.style.left = `${Math.round(centre - v.size / 2)}px`;

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const total = STILL_MS + 2 * FADE_MS;
  const anim = still
    ? slot.node.animate(
        [
          { opacity: 0 },
          { opacity: 1, offset: FADE_MS / total },
          { opacity: 1, offset: (STILL_MS + FADE_MS) / total },
          { opacity: 0 },
        ],
        { duration: total, easing: "linear" },
      )
    : slot.node.animate(floatFrames(v), {
        duration: v.duration,
        easing: "cubic-bezier(0.2, 0.6, 0.3, 1)",
      });
  slot.anim = anim;
  anim.finished
    .then(() => {
      if (slot.anim === anim) release(slot);
    })
    .catch(() => {}); // cancelled: its node was taken for a newer reaction
}

/**
 * Floats a burst as that many separate emojis (1 to 5), 70 to 140 ms apart, each with its own
 * look. Only the first carries the sender's name. `mine` is not announced back to its sender.
 */
export function showReaction(r: {
  fromId: string;
  name: string;
  emoji: Emoji;
  count: number;
  mine: boolean;
}) {
  if (!placed || document.hidden) return;
  const n = Number.isFinite(r.count)
    ? Math.min(Math.max(Math.floor(r.count), 1), POOL, MAX_COUNT)
    : 1;
  // A burst message is already a batch; only lone taps racing each other are dropped.
  if (n === 1) {
    const now = performance.now();
    if (now - (lastFrom.get(r.fromId) ?? -Infinity) < PER_SENDER_MS) return;
    lastFrom.set(r.fromId, now);
  }
  if (!r.mine) hear(r.name, r.emoji);

  keepClearOfSubtitles();
  float(r.emoji, r.name, variation());
  let wait = 0;
  for (let i = 1; i < n; i++) {
    const v = variation();
    wait += v.delay;
    const timer = setTimeout(() => {
      queued.delete(timer);
      if (placed && !document.hidden) float(r.emoji, null, v);
    }, wait);
    queued.add(timer);
  }
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
