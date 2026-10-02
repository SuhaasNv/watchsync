// Content script on supported service pages: reports what this tab has open and
// keeps it on the room's title.
import type { Media } from "@watchsync/protocol";
import { expectedPosition } from "@watchsync/sync-engine";
import { type AppState, type Push, send, type TabEvent } from "../shared/messages";
import { align } from "./align";
import { clearPrompt, prompt, toast } from "./overlay";
import { apply, clock, listen } from "./playback";
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
  if (!room?.session || !roomMedia) return clearPrompt();
  const media = roomMedia;
  const step = align(roomBefore, media, mine, room.following);
  if (step.kind === "none") return clearPrompt();
  const title = media.titleName ?? "a title";
  if (step.kind === "follow") {
    toast(`Moving to ${title} with ${whoIsOn(media)}`);
    location.assign(step.url);
    return;
  }
  if (dismissed === media.titleId) return;
  prompt(`${whoIsOn(media)} is watching ${title}. Open it?`, [
    { label: "Not now", run: () => (dismissed = media.titleId) },
    { label: "Open", primary: true, run: () => location.assign(step.url) },
  ]);
}

const NOTICE = { play: "pressed play", pause: "paused" } as const;

function onPush(m: Push) {
  if (m.kind === "server" && m.message.type === "PLAYBACK.STATE") {
    const { playback, action, byName } = m.message.payload;
    if (!provider || !mine || playback.titleId !== mine.titleId) return;
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
  room = m.state;
  if (room.connection === "connected" && !wasConnected) catchUp();
  offerRejoin();
  const next = room.session ? room.media : null;
  if (next?.titleId !== roomMedia?.titleId) {
    const before = roomMedia;
    roomMedia = next;
    reconcile(before);
  }
}

let rejoinOffered = false;

/** After a browser restart, offer the last room on a title page (US-034). */
function offerRejoin() {
  if (rejoinOffered || !room || room.session || !room.lastRoom || !mine) return;
  rejoinOffered = true;
  prompt(`Rejoin room ${room.lastRoom}?`, [
    { label: "Not now", run: () => void send({ kind: "forgetRoom" }) },
    { label: "Rejoin", primary: true, run: () => void send({ kind: "rejoin" }) },
  ]);
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
  // If I moved on with the room (next episode), the room follows me within a moment;
  // only ask once it's clear we're on different titles.
  clearPrompt();
  clearTimeout(settle);
  settle = setTimeout(() => reconcile(roomMedia), 2000);
  catchUp();
  offerRejoin();
}
let settle: ReturnType<typeof setTimeout> | undefined;

if (provider) {
  poll(); // read the title first so the first report isn't "nothing open"
  connect();
  listen(provider, (action, position, rate) => {
    if (room?.session && mine)
      post({ kind: "playback", action, position, rate, titleId: mine.titleId });
  });
  setInterval(poll, 1000);
}
