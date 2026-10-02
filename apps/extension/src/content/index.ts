// Content script on supported service pages: reports what this tab has open and
// keeps it on the room's title.
import type { Media } from "@watchsync/protocol";
import { DEFAULT_SYNC, decide, expectedPosition } from "@watchsync/sync-engine";
import { type AppState, type Push, send, type TabEvent } from "../shared/messages";
import { align } from "./align";
import { clearPrompt, prompt, renderPill, toast } from "./overlay";
import { apply, clock, hold, isEcho, listen, seekQuietly } from "./playback";
import { providerFor } from "./providers";

const provider = providerFor(location.host);

const sameTitle = (a: Media | null, b: Media | null) =>
  a?.titleId === b?.titleId && a?.titleName === b?.titleName;

let port: chrome.runtime.Port | null = null;
let room: AppState | null = null;
let mine: Media | null = null;
let roomMedia: Media | null = null;
let dismissed: string | null = null;

function post(event: TabEvent) {
  port?.postMessage(event);
}

function reportPresence() {
  if (provider) post({ kind: "presence", service: provider.service, media: mine });
}

function whoIsOn(media: Media): string {
  const me = room?.session?.participantId;
  const p = room?.participants.find((x) => x.id !== me && x.titleId === media.titleId);
  return p?.name ?? "Your friend";
}

/** Called when the room's title or this tab's title changes. */
function reconcile(roomBefore: Media | null) {
  if (!room?.session || !roomMedia) return clearPrompt("align");
  const media = roomMedia;
  const step = align(roomBefore, media, mine, room.following);
  if (step.kind === "none") return clearPrompt("align");
  const title = media.titleName ?? "a title";
  if (step.kind === "follow") {
    toast(`Moving to ${title} with ${whoIsOn(media)}`);
    location.assign(step.url);
    return;
  }
  if (dismissed === media.titleId) return;
  prompt(
    `${whoIsOn(media)} is watching ${title}. Open it?`,
    [
      { label: "Not now", run: () => (dismissed = media.titleId) },
      { label: "Open", primary: true, run: () => location.assign(step.url) },
    ],
    "align",
  );
}

const NOTICE = { play: "pressed play", pause: "paused" } as const;

function onPush(m: Push) {
  if (m.kind === "server" && m.message.type === "PLAYBACK.STATE") {
    const { playback, action, byName } = m.message.payload;
    if (!provider || !mine || playback.titleId !== mine.titleId) return;
    if (!room?.following) return; // watching on my own (US-027)
    const serverNow = Date.now() + (room?.clockOffset ?? 0);
    const before = provider.getState()?.position ?? 0;
    apply(provider, playback, serverNow).catch((e: unknown) =>
      toast(e instanceof Error ? e.message : "WatchSync couldn't control the player"),
    );
    if (action !== "seek") return toast(`${byName} ${NOTICE[action]}`, 3000);
    const to = expectedPosition(playback, serverNow);
    if (Math.abs(to - before) < 1) return; // already there; nothing visibly moved
    toast(`${byName} ${to > before ? "skipped ahead" : "went back"} to ${clock(to)}`, 4000);
    return;
  }
  if (m.kind === "server" && m.message.type === "ROOM.PARTICIPANT") {
    const { participant, event } = m.message.payload;
    if (event === "left") toast(`${participant.name} left`);
    return;
  }
  if (m.kind !== "state") return;
  const wasConnected = room?.connection === "connected";
  const wasFollowing = room?.following;
  room = m.state;
  if (room.connection === "connected" && (!wasConnected || (room.following && !wasFollowing)))
    catchUp();
  drawPill();
  offerRejoin();
  const next = room.session ? room.media : null;
  if (next?.titleId !== roomMedia?.titleId) {
    const before = roomMedia;
    roomMedia = next;
    reconcile(before);
  }
}

let behind: string | null = null;
let nextCorrection = 0;

const follow = (following: boolean) => void send({ kind: "follow", following });

/** Shows who's here and whether each person is with the room (US-028). */
function drawPill() {
  if (!room?.session || !mine) return renderPill(null);
  const me = room.session.participantId;
  const roomTitle = roomMedia?.titleId;
  const people = room.participants.map((p) => {
    const synced =
      p.id === me
        ? room?.following === true && behind === null && mine?.titleId === roomTitle
        : p.connected && p.following && p.titleId === roomTitle;
    const state = !p.connected
      ? "away"
      : !p.following
        ? "watching on their own"
        : p.titleId !== roomTitle
          ? "on another title"
          : synced
            ? "in sync"
            : "catching up";
    const name = p.id === me ? `${p.name} (you)` : p.name;
    return { initial: p.name.slice(0, 1).toUpperCase(), label: `${name}, ${state}`, synced };
  });
  renderPill({
    people,
    following: room.following,
    onOwn: () => follow(false),
    onSync: () => follow(true),
  });
}

function showBehind(text: string | null) {
  if (text === behind) return;
  behind = text;
  if (text) prompt(text, [{ label: "Sync", primary: true, run: () => resync() }], "drift");
  else clearPrompt("drift");
  drawPill();
}

function resync() {
  showBehind(null);
  if (room && !room.following) return follow(true); // catch-up runs when following resumes
  catchUp();
}

/**
 * Every second: small drift is corrected with one silent seek; large drift asks first
 * (US-025, US-026). Only while following, on the room's title, and in the same play state,
 * so a pause that hasn't reached the room yet isn't fought.
 */
function checkDrift() {
  const playback = room?.playback;
  if (!provider || !room?.session || !room.following || !mine || !playback) return showBehind(null);
  if (playback.titleId !== mine.titleId) return showBehind(null);
  const local = provider.getState();
  const v = provider.video();
  if (!local || !v || v.seeking || isEcho() || Date.now() < nextCorrection) return;
  if (local.playing !== (playback.status === "playing")) return;
  const expected = expectedPosition(playback, Date.now() + room.clockOffset);
  const action = decide(local.position, expected, DEFAULT_SYNC);
  if (action === "none") return showBehind(null);
  if (action === "seek") {
    nextCorrection = Date.now() + 3000; // let the player settle before judging again
    seekQuietly(provider, expected).catch(() => {});
    return showBehind(null);
  }
  const n = Math.round(Math.abs(local.position - expected));
  showBehind(`You're ${n} seconds ${local.position < expected ? "behind" : "ahead"}`);
}

let rejoinOffered = false;

/** After a browser restart, offer the last room on a title page (US-034). */
function offerRejoin() {
  if (rejoinOffered || !room || room.session || !room.lastRoom || !mine) return;
  rejoinOffered = true;
  prompt(
    `Rejoin room ${room.lastRoom}?`,
    [
      { label: "Not now", run: () => void send({ kind: "forgetRoom" }) },
      { label: "Rejoin", primary: true, run: () => void send({ kind: "rejoin" }) },
    ],
    "rejoin",
  );
}

/**
 * Lands this player at the room's position when we (re)connect or arrive on the room's
 * title. The player may still be loading, so try for a few seconds.
 */
function catchUp(tries = 5) {
  const playback = room?.playback;
  if (!provider || !playback || !mine || playback.titleId !== mine.titleId) return;
  if (!provider.getState()) {
    if (tries > 0) setTimeout(() => catchUp(tries - 1), 1000);
    return;
  }
  apply(provider, playback, Date.now() + (room?.clockOffset ?? 0)).catch(() => {});
}

function connect() {
  port = chrome.runtime.connect({ name: "tab" });
  port.onMessage.addListener(onPush);
  // The background worker can restart; reconnect and report again.
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, 1000);
  });
  reportPresence();
}

function poll() {
  const now = provider?.media() ?? null;
  if (sameTitle(now, mine)) return;
  const titleChanged = now?.titleId !== mine?.titleId;
  mine = now;
  reportPresence();
  if (!titleChanged) return;
  // A page load autoplays from the start; that isn't the person pressing play, and it
  // mustn't pull the room back (BUG-004). Catch-up takes the room's position instead.
  hold(3000);
  // If I moved on with the room (next episode), the room follows me within a moment;
  // only ask once it's clear we're on different titles.
  clearPrompt("align");
  clearTimeout(settle);
  settle = setTimeout(() => reconcile(roomMedia), 2000);
  catchUp();
  offerRejoin();
}
let settle: ReturnType<typeof setTimeout> | undefined;

if (provider) {
  poll(); // read the title first so the first report isn't "nothing open"
  connect();
  listen(provider, (action, playing, position, rate) => {
    const status = playing ? "playing" : "paused";
    if (room?.session && room.following && mine)
      post({ kind: "playback", action, status, position, rate, titleId: mine.titleId });
  });
  setInterval(poll, 1000);
  setInterval(checkDrift, 1000);
}
