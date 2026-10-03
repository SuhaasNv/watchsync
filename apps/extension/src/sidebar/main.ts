// The chat panel's content (sidebar.html), in an extension frame over the service page
// (DEC-042): keys typed here never reach the service page. It talks to the background itself;
// the content script only places the frame. UC-014: the room's messages and the message box.
import type { AnyServerMessage, ChatMessagePayload } from "@watchsync/protocol";
import { CHAT_KEEP, isChatText } from "../shared/chat";
import { svgIcon } from "../shared/icons";
import type { AppState, Push, SidebarEvent } from "../shared/messages";
import { announcement, capText, namesFor, type Outgoing, renderLog } from "./chat-view";

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`sidebar.html is missing #${id}`);
  return el;
}

const close = byId("close", HTMLButtonElement);
const code = byId("code", HTMLSpanElement);
export const body = byId("body", HTMLElement);
const log = byId("log", HTMLDivElement);
const empty = byId("empty", HTMLParagraphElement);
const notice = byId("notice", HTMLParagraphElement);
const end = byId("end", HTMLDivElement);
const more = byId("more", HTMLButtonElement);
const composer = byId("composer", HTMLFormElement);
const box = byId("box", HTMLTextAreaElement);
const send = byId("send", HTMLButtonElement);
const count = byId("count", HTMLParagraphElement);
const hint = byId("hint", HTMLParagraphElement);
const say = byId("say", HTMLDivElement);
close.append(svgIcon("close", 16));

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
let atBottom = true;
let covered = false;
let seenVisible = false;
let burst: { name: string; text: string }[] = [];
let frame = 0;

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
  });
  empty.hidden = messages.length > 0 || outgoing.length > 0;
}

function toBottom() {
  body.scrollTop = body.scrollHeight;
  more.hidden = true;
}

/** Live changes are drawn once per frame: insert, then one scroll write if at the bottom. */
function later() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
    if (atBottom) toBottom();
    else more.hidden = false;
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

function showHint(text: string | null) {
  hint.textContent = text ?? "";
  hint.hidden = !text;
}

function drawComposer() {
  const off = ended();
  box.disabled = off;
  box.placeholder = off ? "The room has ended." : "Message";
  const n = Array.from(box.value).length;
  count.hidden = n < LIMIT - 50;
  count.textContent = n >= LIMIT ? `${n}/${LIMIT}, at the limit` : `${n}/${LIMIT}`;
  count.classList.toggle("full", n >= LIMIT);
  send.disabled = off || covered || !isChatText(box.value);
}

function onServer(msg: AnyServerMessage) {
  if (msg.type === "CHAT.HISTORY") {
    const had = messages.length > 0;
    messages = msg.payload.messages.slice(-CHAT_KEEP);
    const arrived = new Set(messages.filter((m) => m.fromId === you()).map((m) => m.clientId));
    outgoing = outgoing.filter((o) => !arrived.has(o.clientId));
    // Our messages vanished with the room's: the service restarted (US-120).
    if (had && messages.length === 0) showNotice("WatchSync restarted; earlier messages are gone.");
    draw(); // earlier messages: drawn without a sound or an animation
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
    showHint(words);
    speak(words);
    drawComposer();
    later();
  }
}

function showNotice(text: string) {
  notice.textContent = text;
  notice.hidden = false;
}

function onPush(m: Push) {
  if (m.kind === "state") {
    state = m.state;
    const room = m.state.session?.code;
    code.textContent = room ? `Room ${room}` : "";
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

// The reader is at the bottom while its end is in view (no layout reads on scroll).
new IntersectionObserver(
  (entries) => {
    atBottom = entries.some((x) => x.isIntersecting);
    if (atBottom) more.hidden = true;
  },
  { root: body },
).observe(end);

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
