// The chat's message list (UC-014, US-042): grouping, names, movie times, sending states and
// what a screen reader hears. Plain DOM (DEC-041); user text only ever goes in textContent.
import type { ChatMessagePayload } from "@watchsync/protocol";
import { CHAT_KEEP } from "../shared/chat-text";
import { svgIcon } from "../shared/icons";
import { initialOf, toneOf } from "../shared/people";

/** Messages from one person this close together share one header. */
export const GROUP_MS = 120_000;

/** A movie time as the player shows it: 42:10, or 1:42:10 past the first hour. */
export function movieClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

export interface Person {
  id: string;
  name: string;
}

/**
 * What each sender is called: "You" for us; two people with the same name are told apart by
 * when they first appeared ("Maya", "Maya (2)").
 */
export function namesFor(people: Person[], you: string | null): Map<string, string> {
  const seen = new Map<string, string[]>();
  const names = new Map<string, string>();
  for (const { id, name } of people) {
    if (names.has(id)) continue;
    if (id === you) {
      names.set(id, "You");
      continue;
    }
    const ids = seen.get(name) ?? [];
    ids.push(id);
    seen.set(name, ids);
    names.set(id, ids.length > 1 ? `${name} (${ids.length})` : name);
  }
  return names;
}

/** A message of ours that the room hasn't confirmed yet. */
export interface Outgoing {
  clientId: string;
  text: string;
  state: "sending" | "slow" | "failed";
  /** Why it failed, when Retry can't help. */
  reason?: string;
}

export interface LogModel {
  messages: ChatMessagePayload[];
  outgoing: Outgoing[];
  you: string | null;
  /** Everyone in the room now, in arrival order (for telling namesakes apart). */
  people: Person[];
  /** Id of the one message to animate in (a live message while the reader is at the bottom). */
  fresh: string | null;
  /** Room notices (US-113), placed among the messages by server time. */
  activity?: { id: string; text: string; at: number }[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function header(label: string, sender: string, movieTime: number | null): HTMLElement {
  const head = el("div", "who");
  const tone = toneOf(sender);
  const mark = el("span", "mark", initialOf(sender));
  mark.style.color = tone.fg;
  mark.style.background = tone.bg;
  mark.setAttribute("aria-hidden", "true");
  const name = el("span", "name", label);
  name.dir = "auto";
  if (label === "You") name.classList.add("you");
  // A little toward the text colour, so a busy room doesn't read as a rainbow.
  else name.style.color = `color-mix(in srgb, ${tone.fg} 80%, #ecf2f1)`;
  head.append(mark, name);
  // The leading space keeps "Maya 42:10" apart for a screen reader; the layout ignores it.
  if (movieTime !== null) head.append(el("span", "time", ` ${movieClock(movieTime)}`));
  return head;
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
/** One segmenter for every row (making one per row is slow). */
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** One to three emoji and nothing else: shown larger. */
export function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 40 || !PICTOGRAPHIC.test(t)) return false; // the quick no
  const parts = [...graphemes.segment(t)];
  return parts.length <= 3 && parts.every((p) => PICTOGRAPHIC.test(p.segment));
}

// 24-hour, so the time fits beside the text in every locale ("16:52", not "04:52 PM").
const clock = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The wall-clock time a message was sent ("21:04"). */
export function clockOf(serverTime: number): string {
  return clock.format(serverTime);
}

function row(text: string): HTMLElement {
  const p = el("p", "msg", text);
  p.dir = "auto";
  if (isEmojiOnly(text)) p.classList.add("emoji");
  return p;
}

/**
 * Draws the list. Returns nothing to announce: the caller decides that, because history must
 * stay silent. Retry buttons carry data-retry with the message's clientId.
 */
export function renderLog(list: HTMLElement, model: LogModel): void {
  const people = [...model.people, ...model.messages.map((m) => ({ id: m.fromId, name: m.name }))];
  const names = namesFor(people, model.you);
  const groups: HTMLElement[] = [];
  let last: ChatMessagePayload | null = null;
  let group: HTMLElement | null = null;
  const lines = [...(model.activity ?? [])];
  const notice = (a: { text: string }) => {
    const p = el("p", "activity");
    const words = el("span", "activity-text", a.text);
    words.dir = "auto";
    p.append(words);
    groups.push(p);
    group = null; // a notice ends a run of messages
  };
  for (const m of model.messages.slice(-CHAT_KEEP)) {
    for (let a = lines[0]; a && a.at < m.serverTime; a = lines[0]) notice(lines.shift() ?? a);
    const joined =
      group && last && last.fromId === m.fromId && m.serverTime - last.serverTime <= GROUP_MS;
    if (!joined || !group) {
      // Right after the same person's last group: drawn closer (4 px, not 12).
      const same = groups.at(-1)?.dataset.from === m.fromId;
      group = el("div", m.fromId === model.you ? "group mine" : "group");
      if (same) group.classList.add("same");
      group.dataset.from = m.fromId;
      group.append(header(names.get(m.fromId) ?? m.name, m.name, m.movieTime));
      groups.push(group);
    }
    const r = row(m.text);
    // Shown on the right on hover (CSS, kept out of the text); the title says it in words.
    const at = clockOf(m.serverTime);
    r.dataset.sent = at;
    r.title = `Sent ${at}`;
    if (m.id === model.fresh) r.classList.add("fresh");
    group.append(r);
    last = m;
  }
  for (const a of lines) notice(a);
  if (model.outgoing.length > 0) {
    const mine = el("div", "group mine");
    if (model.you && groups.at(-1)?.dataset.from === model.you) mine.classList.add("same");
    mine.append(header("You", youName(model), null));
    for (const o of model.outgoing) {
      const r = row(o.text);
      r.classList.add("pending");
      // Quietly on its way at first; after 5 s with no echo it says so.
      if (o.state === "slow") r.append(el("span", "status", "Sending…"));
      if (o.state === "failed") {
        const why = el("span", "status failed");
        why.append(svgIcon("alert", 12), o.reason ? `Not sent. ${o.reason}` : "Not sent");
        r.append(why);
      }
      if (o.state === "failed" && !o.reason) {
        const retry = el("button", "retry", "Retry");
        retry.type = "button";
        retry.dataset.retry = o.clientId;
        r.append(retry);
      }
      mine.append(r);
    }
    groups.push(mine);
  }
  list.replaceChildren(...groups);
}

function youName(model: LogModel): string {
  return model.people.find((p) => p.id === model.you)?.name ?? "You";
}

/** How near the end still counts as reading the newest message, in px. */
export const BOTTOM_SLACK = 24;

/**
 * Messages below the reader that they haven't seen, after `arrived` new ones land. At the
 * bottom the list follows the newest message, so nothing is ever waiting below.
 */
export function unseenAfter(unseen: number, atBottom: boolean, arrived: number): number {
  return atBottom ? 0 : unseen + arrived;
}

/** The "new messages" chip's words: "1 new message", "2 new messages". */
export function newBelowLabel(n: number): string {
  return n === 1 ? "1 new message" : `${n} new messages`;
}

/** What a screen reader hears for a burst of live messages from other people. */
export function announcement(burst: { name: string; text: string }[]): string {
  if (burst.length === 0) return "";
  const [first] = burst;
  if (burst.length === 1 && first) return `${first.name}: ${first.text}`;
  const one = burst.every((b) => b.name === first?.name);
  return one ? `${burst.length} new messages from ${first?.name}` : `${burst.length} new messages`;
}

/** At most 500 characters (code points), never cutting a character cluster in half. */
export function capText(text: string, max = 500): string {
  if (Array.from(text).length <= max) return text;
  let out = "";
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
    text,
  )) {
    if (Array.from(out + segment).length > max) break;
    out += segment;
  }
  return out;
}
