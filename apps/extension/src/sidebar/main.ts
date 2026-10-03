// The chat panel's content (sidebar.html), in an extension frame over the service page
// (DEC-042): keys typed here never reach the service page. It talks to the background itself;
// the content script only places the frame. UC-014: the room's messages and the message box.
import type { AnyServerMessage, ChatMessagePayload, Participant } from "@watchsync/protocol";
import { NOTICES_KEY, noticesOn } from "../shared/activity";
import { CHAT_KEEP, isChatText } from "../shared/chat";
import { svgIcon } from "../shared/icons";
import type { AppState, Push, SidebarEvent } from "../shared/messages";
import { initialOf, toneOf } from "../shared/people";
import { ActivityFeed } from "./activity";
import {
  announcement,
  BOTTOM_SLACK,
  capText,
  namesFor,
  newBelowLabel,
  type Outgoing,
  renderLog,
  unseenAfter,
} from "./chat-view";
import { mountReactions } from "./reactions";

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`sidebar.html is missing #${id}`);
  return el;
}

const close = byId("close", HTMLButtonElement);
const code = byId("code", HTMLButtonElement);
export const body = byId("body", HTMLElement);
const log = byId("log", HTMLDivElement);
const end = byId("end", HTMLDivElement);
const faces = byId("faces", HTMLDivElement);
const empty = byId("empty", HTMLDivElement);
const notice = byId("notice", HTMLParagraphElement);
const more = byId("more", HTMLButtonElement);
const moreLabel = byId("more-label", HTMLSpanElement);
const composer = byId("composer", HTMLFormElement);
const box = byId("box", HTMLTextAreaElement);
const send = byId("send", HTMLButtonElement);
const count = byId("count", HTMLParagraphElement);
const hint = byId("hint", HTMLParagraphElement);
const say = byId("say", HTMLDivElement);
close.append(svgIcon("close", 16));
send.prepend(svgIcon("send", 16));
more.prepend(svgIcon("down", 14));
byId("empty-mark", HTMLSpanElement).append(svgIcon("chat", 20));

// Room notices on the video on or off, for every room from now on (US-114).
const notices = byId("notices", HTMLInputElement);
chrome.storage.local
  .get(NOTICES_KEY)
  .then((got) => {
    notices.checked = noticesOn(got[NOTICES_KEY]);
  })
  .catch(() => {}); // unreadable: the switch shows the default, on
notices.addEventListener("change", (e) => {
  if (!e.isTrusted) return; // only the person's own click
  chrome.storage.local.set({ [NOTICES_KEY]: notices.checked }).catch(() => {
    notices.checked = !notices.checked; // not saved: show what still applies
  });
});

const LIMIT = 500;
const REFUSED: Record<string, string> = {
  rate_limited: "Slow down a little.",
  too_long: "That message is too long.",
  invalid: "That message can't be sent.",
};

let port: chrome.runtime.Port | null = null;
let state: AppState | null = null;
let messages: ChatMessagePayload[] = [];
let outgoing: Outgoing[] = [];
let fresh: string | null = null;
/** The reader is at the bottom of the list (the end sentinel's observer keeps it). */
let atBottom = true;
/** Messages from others that landed below the reader since they scrolled up (the chip). */
let unseen = 0;
/** Messages from others waiting for the next frame's draw. */
let landed = 0;
let covered = false;
let seenVisible = false;
let burst: { name: string; text: string }[] = [];
let frame = 0;
const feed = new ActivityFeed();
const roomView = () => ({
  you: you(),
  media: state?.media ?? null,
  playback: state?.playback ?? null,
  participants: state?.participants ?? [],
});

const you = () => state?.session?.participantId ?? null;
/** The room has ended (not merely: the room's state hasn't arrived yet). */
const ended = () => state !== null && !state.session;

function draw() {
  renderLog(log, {
    messages,
    outgoing,
    you: you(),
    people: state?.participants ?? [],
    fresh,
    activity: feed.items,
  });
  empty.hidden = messages.length > 0 || outgoing.length > 0 || feed.items.length > 0;
}

function drawMore() {
  more.hidden = unseen === 0;
  if (unseen > 0) moreLabel.textContent = newBelowLabel(unseen);
}

/** Back to the newest message: the chip goes and its count clears. */
function toBottom() {
  body.scrollTop = body.scrollHeight;
  atBottom = true;
  unseen = 0;
  drawMore();
}

/**
 * Live changes are drawn once per frame. A reader at the bottom stays there: the list's
 * ResizeObserver writes the scroll position after layout, so nothing here reads layout.
 * A reader who scrolled up gets the chip, counting what landed below them.
 */
function later() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
    unseen = unseenAfter(unseen, atBottom, landed);
    drawMore();
    landed = 0;
    fresh = null;
    const words = announcement(burst);
    burst = [];
    if (words) speak(words);
  });
}

/** Said once by a screen reader (the region stays in the page). */
function speak(words: string) {
  say.textContent = "";
  requestAnimationFrame(() => {
    say.textContent = words;
  });
}

/** A hint above the box; a refused send ("Slow down a little.") is warm, with an alert icon. */
function showHint(text: string | null, warn = false) {
  hint.replaceChildren();
  if (text && warn) hint.append(svgIcon("alert", 12));
  if (text) hint.append(text);
  hint.classList.toggle("warn", Boolean(text) && warn);
  hint.hidden = !text;
}

function drawComposer() {
  const off = ended();
  box.disabled = off;
  box.placeholder = off ? "The room has ended" : "Message the room";
  document.body.classList.toggle("ended", off);
  const n = Array.from(box.value).length;
  count.hidden = n < LIMIT - 50;
  count.textContent = n >= LIMIT ? `${n}/${LIMIT}, at the limit` : `${n}/${LIMIT}`;
  count.classList.toggle("full", n >= LIMIT);
  send.disabled = off || covered || !isChatText(box.value);
}

function onServer(msg: AnyServerMessage) {
  // Room notices: drawn with the next frame, silent (the on-page notice says it, US-113).
  if (feed.onServer(msg, roomView())) return later();
  if (msg.type === "CHAT.HISTORY") {
    const had = messages.length > 0;
    messages = msg.payload.messages.slice(-CHAT_KEEP);
    const arrived = new Set(messages.filter((m) => m.fromId === you()).map((m) => m.clientId));
    outgoing = outgoing.filter((o) => !arrived.has(o.clientId));
    // Our messages vanished with the room's: the service restarted (US-120).
    if (had && messages.length === 0)
      showNotice("WatchSync restarted, so earlier messages are gone.");
    draw(); // earlier messages: drawn without a sound, an animation or the chip
    landed = 0;
    toBottom();
    return;
  }
  if (msg.type === "CHAT.MESSAGE") {
    const m = msg.payload;
    if (messages.some((x) => x.id === m.id)) return;
    messages = [...messages, m].slice(-CHAT_KEEP);
    if (m.fromId === you()) outgoing = outgoing.filter((o) => o.clientId !== m.clientId);
    else {
      const names = namesFor([...(state?.participants ?? []), ...messages], you());
      burst.push({ name: names.get(m.fromId) ?? m.name, text: m.text });
      landed += 1;
    }
    if (atBottom) fresh = m.id;
    later();
    return;
  }
  if (msg.type === "CHAT.REJECTED") {
    const o = outgoing.find((x) => x.clientId === msg.payload.clientId);
    outgoing = outgoing.filter((x) => x !== o);
    // The text goes back in the box, unless something new is being typed there.
    if (o && !box.value) box.value = o.text;
    const words = REFUSED[msg.payload.reason] ?? REFUSED.invalid ?? "";
    showHint(words, true);
    speak(words);
    drawComposer();
    later();
  }
}

function showNotice(text: string) {
  notice.replaceChildren(svgIcon("rejoin", 16), text);
  notice.hidden = false;
}

/** How each person in the room is doing, in the pill's words (drawn here from AppState). */
function presence(p: Participant, s: AppState): { mark: string; label: string } {
  const me = p.id === s.session?.participantId;
  const online = !me || s.connection === "connected";
  const onTitle = p.titleId === (s.media?.titleId ?? null);
  const synced = p.connected && online && p.following && onTitle && !p.hold;
  const words = !p.connected
    ? "away"
    : !online
      ? "reconnecting"
      : p.hold === "ad"
        ? "on an ad"
        : p.hold === "buffering"
          ? "loading"
          : !p.following
            ? "watching on their own"
            : !onTitle
              ? "on another title"
              : "in sync";
  const mark = synced ? "synced" : !p.connected ? "away" : p.hold || !online ? "wait" : "none";
  return { mark, label: `${me ? `${p.name} (you)` : p.name}, ${words}` };
}

/** The header's faces: up to four (three on a short window), then "+N". */
function drawFaces() {
  const s = state;
  if (!s?.session) return faces.replaceChildren();
  const max = matchMedia("(max-height: 480px)").matches ? 3 : 4;
  const people = s.participants;
  const shown = people.length > max ? people.slice(0, max - 1) : people;
  const drawn: HTMLElement[] = shown.map((p, i) => {
    const f = document.createElement("span");
    f.style.zIndex = String(shown.length - i); // each face's status mark stays on top
    const { mark, label } = presence(p, s);
    const tone = toneOf(p.name);
    f.className = "face";
    f.dataset.mark = mark;
    f.textContent = initialOf(p.name);
    f.style.color = tone.fg;
    f.style.background = tone.bg;
    f.title = label;
    f.setAttribute("role", "img");
    f.setAttribute("aria-label", label);
    return f;
  });
  const rest = people.length - shown.length;
  if (rest > 0) {
    const n = document.createElement("span");
    n.className = "face more-people";
    n.textContent = `+${rest}`;
    n.setAttribute("role", "img");
    n.setAttribute("aria-label", `${rest} more`);
    drawn.push(n);
  }
  faces.replaceChildren(...drawn);
}

// The room code copies on click; "Copied" stands in for it for a moment (no toast).
let copiedUntil = 0;
function drawCode() {
  if (Date.now() < copiedUntil) return;
  code.textContent = state?.session?.code ?? "";
  code.hidden = !code.textContent;
}
async function copyCode(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // A frame the page's policy keeps from the clipboard API: the older way still works.
    const t = document.createElement("textarea");
    t.value = text;
    t.className = "sr";
    document.body.append(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    if (!ok) throw new Error("copy refused");
  }
}
code.addEventListener("click", (e) => {
  const room = state?.session?.code;
  if (!e.isTrusted || !room) return;
  copyCode(room)
    .then(() => {
      copiedUntil = Date.now() + 1200;
      code.textContent = "Copied";
      speak("Room code copied");
      setTimeout(drawCode, 1200);
    })
    .catch(() => speak("Couldn't copy the room code"));
});

// Under the message box; a reaction never waits for a connection.
const reactions = mountReactions(composer, (emoji, count) => {
  if (port) post({ kind: "react", emoji, count });
  else reactions.dropped(emoji, "offline");
});

function onPush(m: Push) {
  if (m.kind === "reactionDropped") return reactions.dropped(m.emoji, m.reason);
  if (m.kind === "state") {
    state = m.state;
    feed.sync(roomView());
    drawCode();
    drawFaces();
    drawComposer();
    return;
  }
  if (m.kind === "server") return onServer(m.message);
  if (m.kind === "chatSending" || m.kind === "chatFailed") {
    const o = outgoing.find((x) => x.clientId === m.clientId);
    if (!o) return;
    if (m.kind === "chatSending") o.state = "slow";
    else {
      o.state = "failed";
      o.reason = m.reason === "invalid" ? "It can't be sent as it is." : undefined;
      speak("Not sent");
    }
    later();
  }
}

function post(event: SidebarEvent) {
  port?.postMessage(event);
}

function submit() {
  const text = box.value;
  if (send.disabled || !isChatText(text)) return;
  const clientId = crypto.randomUUID();
  outgoing = [...outgoing, { clientId, text, state: "sending" }];
  if (port) post({ kind: "chat", text, clientId });
  else outgoing = outgoing.map((o) => (o.clientId === clientId ? { ...o, state: "failed" } : o));
  box.value = "";
  showHint(null);
  drawComposer();
  atBottom = true;
  later();
}

/**
 * Connects with the one-time pass the tab's content script put in this frame's address. The
 * background serves no other frame (a service page could frame sidebar.html itself). A pass
 * works once: after a worker restart or a reload the content script puts a new frame with a
 * new pass in this one's place.
 */
function connect() {
  const nonce = location.hash.slice(1);
  if (!nonce || !chrome.runtime?.id) return; // no pass, or replaced by an update
  port = chrome.runtime.connect({ name: "sidebar" });
  port.onMessage.addListener(onPush);
  port.onDisconnect.addListener(() => {
    port = null;
  });
  port.postMessage({ kind: "hello", nonce } satisfies SidebarEvent);
}

/** The page closes the panel and gives focus back to whatever opened it. */
function closePanel() {
  post({ kind: "close" });
}

// Only the person's own input acts: a page that frames or overlays this can't script a click.
close.addEventListener("click", (e) => {
  if (e.isTrusted) closePanel();
});
document.addEventListener("keydown", (e) => {
  if (!e.isTrusted || e.key !== "Escape" || e.isComposing || e.defaultPrevented) return;
  e.preventDefault();
  closePanel();
});

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  if (e.isTrusted || e.submitter === send) submit();
});
box.addEventListener("keydown", (e) => {
  // Enter sends; Shift+Enter is a new line; nothing happens mid-composition (IME).
  if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  if (e.isTrusted) submit();
});
box.addEventListener("input", () => {
  const capped = capText(box.value, LIMIT); // code points, as the room counts them
  if (capped !== box.value) {
    box.value = capped;
    speak(`${LIMIT} characters is the limit.`);
  }
  showHint(null);
  drawComposer();
});
// A page that steals focus mid-message is noticed (the hint goes when typing resumes).
box.addEventListener("blur", () => {
  if (box.value && !covered) showHint("Typing paused");
});
box.addEventListener("focus", () => {
  if (hint.textContent === "Typing paused") showHint(null);
});

log.addEventListener("click", (e) => {
  if (!e.isTrusted || !(e.target instanceof HTMLElement)) return;
  const clientId = e.target.dataset.retry;
  const o = outgoing.find((x) => x.clientId === clientId);
  if (!o || !clientId) return;
  o.state = "sending";
  if (port)
    post({ kind: "chat", text: o.text, clientId }); // the same id: never twice
  else o.state = "failed";
  later();
});
more.addEventListener("click", toBottom);

// The reader is at the bottom while the end of the list is within BOTTOM_SLACK of view (no
// layout reads on scroll). Back at the bottom, the chip goes.
new IntersectionObserver(
  (entries) => {
    const e = entries.at(-1);
    // A closed panel has no size: that says nothing about where the reader is.
    if (!e?.rootBounds?.height) return;
    atBottom = e.isIntersecting;
    if (atBottom && unseen > 0) {
      unseen = 0;
      drawMore();
    }
  },
  { root: body, rootMargin: `0px 0px ${BOTTOM_SLACK}px 0px` },
).observe(end);
// After layout, before paint: the list grew (a new message, or rows skipped by
// content-visibility taking their real height) or the panel changed size (reopened, the box
// grew). A reader at the bottom stays there; the read here costs no extra layout.
const settle = new ResizeObserver(() => {
  if (atBottom) body.scrollTop = body.scrollHeight;
});
settle.observe(body);
settle.observe(log);

// A page that lays something over this frame can't trick a send: Send waits until the box
// and Send are really visible (Intersection Observer v2).
const visibility: IntersectionObserverInit & { trackVisibility: boolean; delay: number } = {
  trackVisibility: true,
  delay: 100,
};
new IntersectionObserver((entries) => {
  const seen = entries.at(-1);
  const visible = seen ? Reflect.get(seen, "isVisible") : undefined;
  if (typeof visible !== "boolean") return; // no v2 here: nothing to judge by
  // Only where the browser has once reported it visible: some (headless) report never-visible
  // for everything, and that must not stop chat. Out of view (closed) is not covered.
  seenVisible ||= visible;
  covered = seenVisible && seen?.isIntersecting === true && !visible;
  if (covered) showHint("Chat is covered by the page");
  else if (hint.textContent === "Chat is covered by the page") showHint(null);
  drawComposer();
}, visibility).observe(send);

/** Opening focuses this frame; focus then goes to the message box. */
function focusFirst() {
  if (document.activeElement && document.activeElement !== document.body) return;
  (document.querySelector<HTMLElement>("[data-focus-first]") ?? close).focus();
}
window.addEventListener("focus", focusFirst);
if (document.hasFocus()) focusFirst();

drawComposer();
connect();
