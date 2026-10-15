// Hosts the voice frame (voice.html) on the service page. The frame is an extension page, so the
// microphone permission belongs to WatchSync and not to the service, and the page can neither
// read it nor hear it (UC-021). Like the chat frame (sidebar.ts) it is loaded with a one-time
// pass the background checks. Unlike the chat panel it has nothing to show: it is a 1 px,
// invisible frame that stays where it is when a player goes full screen, so a call carries on
// through it. The host is never moved; if the page takes it off, a new frame replaces it.
import type { ChatNonceReply, VoiceNonceRequest } from "../shared/messages";

const host = document.createElement("watchsync-voice");
// Closed, so the service page can't reach the frame element; test builds open it.
const root = host.attachShadow({ mode: __MOCK__ ? "open" : "closed" });
root.innerHTML = `<style>
  :host { all: initial !important; }
  iframe { position: fixed !important; left: 0; top: 0; width: 1px; height: 1px; border: 0;
    opacity: 0; pointer-events: none; }
</style>`;

let wanted = false;
let retired = false;
let frame: HTMLIFrameElement | null = null;
/** The pass of the frame on the page; news about any other frame is about one we removed. */
let current: string | null = null;
/** The pass whose frame has connected (said hello to the background). */
let greeted: string | null = null;
/** Bumped with every request for a pass: a reply that isn't the latest is dropped. */
let asked = 0;
let helloDue: ReturnType<typeof setTimeout> | undefined;
/** We replaced the frame ourselves (the worker restarted): losing it is not the page's doing. */
let ourReload = false;
/** When the page last interfered with the frame, within the last minute. */
const interference: number[] = [];
let off = false;
const offWatchers: (() => void)[] = [];

/** Takes the host off the page if it is put back after it is taken away by the page. */
const guard = new MutationObserver(() => {
  if (wanted && !host.isConnected) {
    document.documentElement.append(host);
    if (current) frameTrouble(current);
  }
});

async function pass(): Promise<string | null> {
  const reply: ChatNonceReply = await chrome.runtime.sendMessage({
    kind: "voiceNonce",
  } satisfies VoiceNonceRequest);
  const nonce = typeof reply === "object" && reply !== null ? reply.nonce : null;
  return typeof nonce === "string" && /^[\w-]{8,64}$/.test(nonce) ? nonce : null;
}

function dropFrame() {
  clearTimeout(helloDue);
  frame?.remove();
  frame = null;
  current = null;
  greeted = null;
  ourReload = false;
}

async function loadFrame() {
  const ticket = ++asked;
  const nonce = await pass();
  // Only the latest request counts: an older reply would load a frame whose pass is replaced.
  if (ticket !== asked || !nonce || retired || !wanted || off) return;
  dropFrame();
  const f = document.createElement("iframe");
  f.title = "WatchSync voice";
  f.setAttribute("aria-hidden", "true");
  f.tabIndex = -1;
  f.inert = true; // nothing to see or press: never a place focus can go
  // The microphone for this frame, and sound out; nothing else is delegated to it.
  const origin = new URL(chrome.runtime.getURL("")).origin;
  f.allow = `microphone ${origin}; autoplay ${origin}`;
  f.src = `${chrome.runtime.getURL("voice.html")}#${nonce}`;
  let loaded = false;
  f.addEventListener("load", () => {
    // A second load means the frame's page was replaced: by the service page pointing it
    // elsewhere. It can't be trusted any more.
    if (loaded) return frameTrouble(nonce);
    loaded = true;
    helloWithin(nonce, 3000);
  });
  frame = f;
  current = nonce;
  root.append(f);
  if (!host.isConnected) document.documentElement.append(host);
  helloWithin(nonce, 6000); // a frame that never even loads
}

/** The frame must have connected within `ms`, or it isn't ours any more. */
function helloWithin(nonce: string, ms: number) {
  clearTimeout(helloDue);
  helloDue = setTimeout(() => {
    if (greeted !== nonce) frameTrouble(nonce);
  }, ms);
}

/**
 * The frame on the page is no longer the one we loaded, or never connected: take it off and
 * put a new one with a new pass in its place. If the page did this three times in a minute,
 * voice turns off on this page.
 */
function frameTrouble(nonce: string) {
  if (nonce !== current) return;
  const ours = ourReload;
  dropFrame();
  if (!ours && interfered()) return;
  loadFrame().catch((e: unknown) => console.debug("watchsync: voice frame", e));
}

/** Counts one interference; true if that's three within a minute and voice is now off. */
function interfered(): boolean {
  const now = Date.now();
  interference.push(now);
  while (interference.length && now - (interference[0] ?? now) > 60_000) interference.shift();
  if (interference.length < 3) return false;
  off = true;
  host.remove();
  for (const cb of offWatchers) cb();
  return true;
}

/** Whether voice is turned off on this page because the page interfered with its frame. */
export const isVoiceOff = () => off;

/** Called once if voice turns off on this page. */
export function onVoiceOff(cb: () => void) {
  offWatchers.push(cb);
}

/** In a room that offers voice, the frame is on the page; otherwise it is not. */
export function showVoiceFrame(on: boolean) {
  if (retired || on === wanted) return;
  wanted = on;
  if (on) {
    guard.observe(document.documentElement, { childList: true });
    loadFrame().catch((e: unknown) => console.debug("watchsync: voice frame", e));
    return;
  }
  asked++; // a pass still on its way is for this room's frame: drop it
  dropFrame(); // its port closes with it: the others close their connections to us
  host.remove();
  guard.disconnect();
}

/** The background says the frame with this pass connected. */
export function voiceFrameReady(nonce: string) {
  if (nonce === current) greeted = nonce;
}

/** The background says the frame with this pass lost its connection without our doing. */
export function voiceFrameLost(nonce: string) {
  frameTrouble(nonce);
}

/** The background worker restarted, dropping the frame's connection: a new frame replaces it. */
export function renewVoiceFrame() {
  if (!current) return;
  ourReload = true;
  frameTrouble(current);
}

/** This copy of the extension was replaced by an update: take the frame off for good. */
export function retireVoiceFrame() {
  retired = true;
  wanted = false;
  clearTimeout(helloDue);
  guard.disconnect();
  host.remove();
}
