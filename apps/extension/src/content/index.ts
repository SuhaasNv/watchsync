// Content script on supported service pages: reports what this tab has open and
// keeps it on the room's title.
import type { Media } from "@watchsync/protocol";
import { DEFAULT_SYNC, decide, expectedPosition } from "@watchsync/sync-engine";
import {
  closedText,
  jumpedText,
  leftText,
  movedText,
  NOTICES_KEY,
  noticesOn,
  playedText,
  rejoinedText,
} from "../shared/activity";
import {
  type AppState,
  type Push,
  SERVICE_LABEL,
  send,
  type TabEvent,
  UNREACHABLE,
} from "../shared/messages";
import { align } from "./align";
import {
  CHAT_OFF,
  chatButton,
  clearPrompt,
  focusedControl,
  notice,
  noticesBesideSidebar,
  prompt,
  renderPill,
  retireOverlay,
  setChatBadge,
  toast,
} from "./overlay";
import { apply, clock, hold, isEcho, listen, seekQuietly } from "./playback";
import { providerFor } from "./providers";
import { reactionsBesideChat, retireReactions, showReaction, showReactions } from "./reactions";
import {
  chatFrameLost,
  chatFrameReady,
  closeSidebar,
  focusFallback,
  isChatOff,
  isSidebarOpen,
  onChatOff,
  onSidebarChange,
  openSidebar,
  renewFrame,
  retireSidebar,
  showSidebar,
  toggleSidebar,
} from "./sidebar";

const provider = providerFor(location.host);

const sameTitle = (a: Media | null, b: Media | null) =>
  a?.titleId === b?.titleId && a?.titleName === b?.titleName;

let port: chrome.runtime.Port | null = null;
let room: AppState | null = null;
let mine: Media | null = null;
let roomMedia: Media | null = null;
let dismissed: string | null = null;
/** Who last moved the room's clock, so drift can say whose position it is. */
let lastActor: { id: string; name: string } | null = null;
/** One person's play, pause and jump messages that arrive close together (a service's skip). */
const BURST_MS = 1500;
let burst: { id: string; at: number; from: number; told: boolean } | null = null;
/** A play or pause notice waits this long, so a skip right after it can replace it. */
const NOTICE_WAIT_MS = 400;
let pendingNotice: ReturnType<typeof setTimeout> | undefined;

/** Room notices on the page (US-114); prompts that need an answer ignore this. */
let roomNotices = true;
chrome.storage.local
  .get(NOTICES_KEY)
  .then((got) => {
    roomNotices = noticesOn(got[NOTICES_KEY]);
  })
  .catch(() => {});
function onSetting(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  const change = changes[NOTICES_KEY];
  if (area === "local" && change) roomNotices = noticesOn(change.newValue);
}
chrome.storage.onChanged.addListener(onSetting);

/** A room notice: play, pause, jumps, people coming and going, title moves. */
function roomNotice(...args: Parameters<typeof toast>) {
  if (roomNotices) toast(...args);
}

function post(event: TabEvent) {
  port?.postMessage(event);
}

function reportPresence() {
  if (provider) post({ kind: "presence", service: provider.service, media: mine });
}

function friendOn(media: Media): string | null {
  const me = room?.session?.participantId;
  return room?.participants.find((x) => x.id !== me && x.titleId === media.titleId)?.name ?? null;
}

function whoIsOn(media: Media): string {
  return friendOn(media) ?? "Your friend";
}

/** The room's title name, or the name someone on that title reported later (BUG-025). */
function nameOf(media: Media): string | null {
  if (media.titleName) return media.titleName;
  return (
    room?.participants.find((x) => x.titleId === media.titleId && x.titleName)?.titleName ?? null
  );
}

/** The last reconcile's input, and whether its prompt had to say "a title" (BUG-025). */
let lastBefore: Media | null = null;
let unnamed = false;

/** Called when the room's title or this tab's title changes. */
function reconcile(roomBefore: Media | null) {
  if (!room?.session || !roomMedia) return clearPrompt("align");
  if (!room.following) return clearPrompt("align"); // watching on my own: no prompts
  const media = roomMedia;
  const step = align(roomBefore, media, mine, room.following);
  if (step.kind === "none") return clearPrompt("align");
  // Nobody is on the room's title any more (they closed it): nothing to offer.
  if (step.kind !== "follow" && !friendOn(media)) return clearPrompt("align");
  lastBefore = roomBefore;
  unnamed = !nameOf(media);
  const title = nameOf(media) ?? "a title";
  if (new URL(step.url).pathname === location.pathname) {
    // Same page, different episode (Prime changes episodes inside its player): there is
    // no address to open, so say where the room is instead of reloading the page.
    if (dismissed === media.titleId) return;
    return prompt(
      `${whoIsOn(media)} is on ${title}. Pick it in the player to watch together.`,
      [{ label: "OK", run: () => (dismissed = media.titleId) }],
      "align",
      { who: friendOn(media), icon: "title" },
    );
  }
  const move = room.mediaMove;
  if (step.kind === "follow" && move?.how === "new") {
    // Someone picked another title (BUG-014): ask, don't drag everyone along.
    const service = SERVICE_LABEL[media.service];
    return prompt(
      service ? `${move.byName} opened ${title} on ${service}.` : `${move.byName} opened ${title}.`,
      [
        { label: "Watch on my own", run: () => follow(false) },
        {
          label: `Continue with ${move.byName}`,
          primary: true,
          run: () => location.assign(step.url),
        },
      ],
      "align",
      { who: move.byName, icon: "title" },
    );
  }
  if (step.kind === "follow") {
    const who = whoIsOn(media);
    roomNotice(`Moving to ${title} with ${who}`, 4000, { who: friendOn(media), icon: "title" });
    // The page load wipes that notice before anyone can read it: the next page says it.
    const arrival: Arrival = { titleId: media.titleId, title, who, at: Date.now() };
    chrome.storage.local
      .set({ arrival })
      .catch(() => {})
      .finally(() => location.assign(step.url));
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
    { who: friendOn(media), icon: "title" },
  );
}

/** Where a followed move went, kept across the page load it causes. */
interface Arrival {
  titleId: string | null;
  title: string;
  who: string;
  at: number;
}

function isArrival(v: unknown): v is Arrival {
  if (typeof v !== "object" || v === null) return false;
  const { titleId, title, who, at } = v as Record<string, unknown>;
  return (
    (typeof titleId === "string" || titleId === null) &&
    typeof title === "string" &&
    typeof who === "string" &&
    typeof at === "number"
  );
}

/** "Moved to Dark, E2 with Maya" once the followed page has its title (read once). */
function sayArrival() {
  chrome.storage.local
    .get("arrival")
    .then(({ arrival }) => {
      if (arrival === undefined) return;
      void chrome.storage.local.remove("arrival");
      if (!isArrival(arrival) || arrival.titleId !== mine?.titleId) return;
      if (Date.now() - arrival.at > 15_000) return; // a load that never finished: stale
      roomNotice(`Moved to ${arrival.title} with ${arrival.who}`, 5000, {
        who: arrival.who,
        icon: "title",
      });
    })
    .catch(() => {});
}

function onPush(m: Push) {
  if (m.kind === "server" && m.message.type === "PLAYBACK.STATE") {
    const { playback, action, byId, byName } = m.message.payload;
    lastActor = { id: byId, name: byName };
    if (!provider || !mine || playback.titleId !== mine.titleId) return;
    if (!room?.following) return; // watching on my own (US-027)
    if (isLive()) return; // live streams aren't synced in v0.1 (US-032)
    if (holdReason) return; // my own buffering or ad; I catch up when it ends
    const serverNow = Date.now() + (room?.clockOffset ?? 0);
    const before = provider.getState()?.position ?? 0;
    apply(provider, playback, serverNow, action === "sync").catch((e: unknown) =>
      toast(e instanceof Error ? e.message : "We couldn't control the player here.", 6000, {
        icon: "alert",
        tone: "bad",
      }),
    );
    const holder = room.participants.find((p) => p.id === byId && p.hold);
    if (holder && action === "pause") return; // the wait card explains it (drawWait)
    if (action === "play" && waitShownAt) return; // drawWait says "Back together"
    if (byId === room.session?.participantId) return; // never a notice about myself (BUG-022)
    // A skip on Netflix arrives as a burst (pause, jump, play) and the first message can
    // already carry the new spot. Judge the jump from where this player was when the burst
    // began, say it once, and drop the burst's play and pause notices.
    const now = Date.now();
    if (!burst || burst.id !== byId || now - burst.at > BURST_MS)
      burst = { id: byId, at: now, from: before, told: false };
    burst.at = now;
    const to = expectedPosition(playback, serverNow);
    if (Math.abs(to - burst.from) >= 1) {
      clearTimeout(pendingNotice); // the jump says it all
      if (burst.told) return;
      burst.told = true;
      const ahead = to > burst.from;
      return roomNotice(jumpedText(byName, ahead, to), 4000, {
        who: byName,
        icon: ahead ? "ahead" : "back",
      });
    }
    if (action === "seek") return; // already there; nothing visibly moved
    clearTimeout(pendingNotice);
    pendingNotice = setTimeout(
      () => roomNotice(playedText(byName, action), 3000, { who: byName, icon: action }),
      NOTICE_WAIT_MS,
    );
    return;
  }
  if (m.kind === "server" && m.message.type === "REACTION.SHOW") {
    const r = m.message.payload;
    showReaction({ ...r, mine: r.fromId === room?.session?.participantId });
    return;
  }
  if (m.kind === "server" && m.message.type === "START.STATE") {
    onStart(m.message.payload);
    return;
  }
  if (m.kind === "server" && m.message.type === "ROOM.MEDIA") {
    // I picked a new title: the room has no clock for it yet, so share where I am once
    // the service has finished its own resume seek, and friends who continue land here.
    const { byId, byName, how, media } = m.message.payload;
    if (byId === room?.session?.participantId) setTimeout(publishMine, 3500);
    else if (room?.session && !room.following && mine) {
      // Watching on my own: the room's move doesn't take me along, but I should know.
      const title = nameOf(media) ?? "a title";
      roomNotice(movedText(byName, how, title), 6000, {
        who: byName,
        icon: "title",
        detail: "You're watching on your own, so you stay here.",
      });
    }
    return;
  }
  if (m.kind === "server" && m.message.type === "ROOM.PARTICIPANT") {
    const { participant, event } = m.message.payload;
    if (event === "left")
      roomNotice(leftText(participant.name), 4000, { who: participant.name, icon: "leave" });
    if (event === "rejoined")
      roomNotice(rejoinedText(participant.name), 4000, { who: participant.name, icon: "rejoin" });
    return;
  }
  if (m.kind === "report") {
    if (mine) reportPresence();
    return;
  }
  if (m.kind === "toggleSidebar") {
    // Focus on a pill button is hidden in the overlay's shadow root: hand it over.
    toggleSidebar(focusedControl() ?? undefined);
    return;
  }
  if (m.kind === "openSidebar") return openSidebar(); // the popup's Open chat
  if (m.kind === "closeSidebar") return closeSidebar(); // Esc or close inside the chat frame
  if (m.kind === "chatFrameReady") return chatFrameReady(m.frame);
  if (m.kind === "chatFrameLost") return chatFrameLost(m.frame);
  if (m.kind !== "state") return;
  noticeClosedShows(room, m.state);
  const wasConnected = room?.connection === "connected";
  const wasFollowing = room?.following;
  room = m.state;
  showSidebar(room.session !== null && room.connection !== "idle");
  // Unread on the chat button (US-044); while chat is open, everything in it is seen.
  if (isSidebarOpen() && room.unread > 0) post({ kind: "chatOpened" });
  else setChatBadge(room.unread);
  showReactions(room.session !== null && room.connection !== "idle");
  showConnection();
  if (room.connection === "connected" && (!wasConnected || (room.following && !wasFollowing)))
    catchUp();
  if (room.following && wasFollowing === false) {
    dismissed = null;
    reconcile(roomMedia); // back from watching on my own: offer the room's title again
  }
  drawPill();
  drawWait();
  offerRejoin();
  const next = room.session ? room.media : null;
  if (next?.titleId !== roomMedia?.titleId) {
    const before = roomMedia;
    roomMedia = next;
    reconcile(before);
  } else if (unnamed && roomMedia && nameOf(roomMedia)) {
    reconcile(lastBefore); // the name arrived after the prompt: say it (BUG-025)
  }
}

/**
 * "Maya closed the show": someone still in the room who was on the room's title now has
 * nothing open (closed the tab or went back to browsing). Compared state to state, because
 * the background sends the new state before the participant message.
 */
function noticeClosedShows(before: AppState | null, after: AppState) {
  const roomTitle = roomMedia?.titleId;
  const me = after.session?.participantId;
  if (!before?.session || !roomTitle) return;
  for (const p of after.participants) {
    const was = before.participants.find((x) => x.id === p.id);
    if (p.id !== me && p.connected && was?.titleId === roomTitle && p.titleId === null)
      roomNotice(closedText(p.name), 4000, { who: p.name, icon: "leave" });
  }
}

let behind: string | null = null;
/** The drift prompt as shown; null while hidden, including after "Stay here". */
let behindShown: string | null = null;
/** Signed drift in seconds at the last check (local minus room). */
let drift = 0;
/** "Stay here": the drift and room clock the person chose to keep, so we don't nag. */
let stayed: { drift: number; updatedAt: number } | null = null;
let nextCorrection = 0;
/** Since when this player has been playing while the room is paused, or the reverse. */
let playStateSince = 0;

/** The line shown while the room connection is down, or null while it's up. */
let lost: string | null = null;

/**
 * A calm line while the room connection is down, and one when it's back (no positions).
 * The line changes only when its words do, so a screen reader hears it once, not per retry.
 */
function showConnection() {
  const down = Boolean(room?.session) && room?.connection === "reconnecting";
  const line = !down
    ? null
    : room?.updating
      ? "WatchSync is updating, back in a moment" // the service is restarting (US-121)
      : room?.unreachable
        ? UNREACHABLE // 2 minutes and still down: retries go on every 10 s
        : "Connection lost. Reconnecting…";
  if (line === lost) return;
  lost = line;
  const tryNow = { label: "Try now", run: () => void send({ kind: "retryNow" }) };
  const actions = line === UNREACHABLE ? [tryNow] : [];
  if (line) return notice("connection", line, { icon: "sync", tone: "warn" }, actions);
  notice("connection", null);
  if (room?.session && room.connection === "connected")
    toast("Back with the room", 3000, { icon: "check", tone: "ok" });
}

const follow = (following: boolean) => void send({ kind: "follow", following });

function publishMine() {
  const st = provider?.getState();
  if (!st || !mine || !room?.following || room.playback?.titleId === mine.titleId) return;
  if (!Number.isFinite(st.duration)) return; // live: not synced
  const status = st.playing ? "playing" : "paused";
  post({
    kind: "playback",
    action: "seek",
    status,
    position: st.position,
    rate: st.rate,
    titleId: mine.titleId,
  });
}

/** Shows who's here and whether each person is with the room (US-028). */
function drawPill() {
  if (!room?.session || !mine) return renderPill(null);
  const me = room.session.participantId;
  const roomTitle = roomMedia?.titleId;
  const people = room.participants.map((p) => {
    const online = room?.connection === "connected";
    const synced =
      p.id === me
        ? online && room?.following === true && behind === null && mine?.titleId === roomTitle
        : p.connected && p.following && p.titleId === roomTitle;
    const state = !p.connected
      ? "away"
      : p.id === me && !online
        ? "reconnecting"
        : p.hold === "ad"
          ? "on an ad"
          : p.hold === "buffering"
            ? "loading"
            : !p.following
              ? "watching on their own"
              : p.titleId !== roomTitle
                ? "on another title"
                : synced
                  ? "in sync"
                  : "catching up";
    const name = p.id === me ? `${p.name} (you)` : p.name;
    const mark = synced
      ? "synced"
      : !p.connected
        ? "away"
        : p.hold || (p.id === me && !online)
          ? "wait"
          : "none";
    return { name: p.name, label: `${name}, ${state}`, mark } as const;
  });
  renderPill({
    people,
    following: room.following,
    onOwn: () => follow(false),
    onSync: () => follow(true),
    onStart:
      room.following && mine.titleId === roomTitle && room.participants.length > 1
        ? startTogether
        : null,
    playing: provider?.getState()?.playing === true,
    onPause: pauseTogether,
    onSyncAll: behind === null ? null : syncEveryone, // only when I'm out of step
    onChat: (from) => toggleSidebar(from),
    chatOpen: isSidebarOpen(),
    chatOff: isChatOff(),
  });
}
onSidebarChange((open) => {
  drawPill();
  noticesBesideSidebar(open);
  if (open) post({ kind: "chatOpened" }); // the unread count clears in every tab
  reactionsBesideChat(open);
});
// Fail closed: the page kept pointing the chat frame elsewhere (DEC-042).
onChatOff(() => {
  drawPill();
  toast(CHAT_OFF, 8000, { icon: "alert", tone: "bad" });
});
// The control that opened chat can be gone by the time it closes: the pill's chat button.
focusFallback(chatButton);

/** Everyone jumps to exactly where I am, without pausing or counting down (owner, 2 Oct). */
function syncEveryone() {
  const st = provider?.getState();
  if (!provider || !st || !mine || !room?.following) return;
  post({
    kind: "playback",
    action: "sync",
    status: st.playing ? "playing" : "paused",
    position: st.position,
    rate: st.rate,
    titleId: mine.titleId,
  });
  toast("Everyone is here with you", 2500, { icon: "sync", tone: "ok" });
}

/**
 * The pill's Pause everyone is always the person's own action. Sent to the room directly:
 * a pause in the first seconds after a page load would otherwise read as autoplay noise
 * (BUG-004) and the room would start the video again.
 */
function pauseTogether() {
  const st = provider?.getState();
  if (!provider || !st || !mine || !room?.following) return;
  post({
    kind: "playback",
    action: "pause",
    status: "paused",
    position: st.position,
    rate: st.rate,
    titleId: mine.titleId,
  });
  provider.pause().catch(() => {});
}
// Media events don't bubble; catch them on the way down so the pill flips Start/Pause.
document.addEventListener("play", () => drawPill(), true);
document.addEventListener("pause", () => drawPill(), true);

function showBehind(text: string | null) {
  if (text === null) stayed = null;
  const quiet =
    text !== null &&
    stayed !== null &&
    stayed.updatedAt === room?.playback?.updatedAt &&
    Math.abs(drift - stayed.drift) <= 10;
  const shown = quiet ? null : text;
  if (text === behind && shown === behindShown) return;
  behind = text;
  behindShown = shown;
  if (shown)
    prompt(
      shown,
      [
        { label: "Stay here", run: () => stay() },
        { label: "Catch up", primary: true, run: () => resync() },
      ],
      "drift",
      { icon: "sync", tone: "accent" },
    );
  else clearPrompt("drift");
  drawPill();
}

/** Keep my position; ask again only if the gap grows by 10 s or the room's clock changes. */
function stay() {
  const updatedAt = room?.playback?.updatedAt;
  if (updatedAt === undefined) return;
  stayed = { drift, updatedAt };
  behindShown = null;
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
  if (holdReason || startPhase || isLive()) return; // not drift: waits, countdowns, live
  if (local.playing !== (playback.status === "playing")) {
    // A press right after the room moved this player is taken as our own echo and never
    // reaches the room (two people pressing at once): don't stay apart, take the room's.
    playStateSince ||= Date.now();
    if (Date.now() - playStateSince >= 3000) {
      playStateSince = 0;
      catchUp(0);
    }
    return;
  }
  playStateSince = 0;
  // A speed tool running this player at another speed than the room (past 4x, BUG-034):
  // positions can't line up, and jumping it back would swallow the person's next press.
  if (Math.abs(local.rate - playback.rate) > 0.01) return showBehind(null);
  const expected = expectedPosition(playback, Date.now() + room.clockOffset);
  const action = decide(local.position, expected, DEFAULT_SYNC);
  if (action === "none") return showBehind(null);
  if (action === "seek") {
    nextCorrection = Date.now() + 3000; // let the player settle before judging again
    seekQuietly(provider, expected).catch(() => {});
    return showBehind(null);
  }
  drift = local.position - expected;
  const n = Math.round(Math.abs(drift));
  const me = room.session.participantId;
  const whose = lastActor && lastActor.id !== me ? lastActor.name : "the room";
  showBehind(`You're ${n} seconds ${drift < 0 ? `behind ${whose}` : `ahead of ${whose}`}`);
}

// ---- Live streams (US-032) ----

let liveSaid = false;

/** A live stream has no fixed timeline to share, so v0.1 doesn't sync it, and says so. */
function isLive(): boolean {
  const live = provider?.getState()?.duration === Number.POSITIVE_INFINITY;
  if (live && room?.session && !liveSaid) {
    liveSaid = true;
    prompt(
      "Live streams can't be synced yet. Everyone is watching live on their own.",
      [{ label: "OK", run: () => {} }],
      "live",
      { icon: "live", tone: "warn" },
    );
  }
  return live;
}

// ---- Nobody gets left behind (UC-042, the flagship) ----

// Offer "Watch without" after 90 s (4 s in test builds, so e2e runs stay short).
const WAIT_CHOICE_MS = __MOCK__ ? 4000 : 90_000;
let holdReason: "buffering" | "ad" | null = null;
let heldAdLeft: number | null = null;
let stallSince = 0;
let cleanSince = 0;
let lastGood = 0;
let waitShownAt = 0;
let waitKey = "";

/**
 * Four times a second: report when this player starts or stops buffering (over 1 s) or
 * showing an ad, so the room can wait for it. Buffering ends after 1 s of clean playback.
 */
function checkHold() {
  if (!provider || !room?.session || !room.following || !mine || isLive()) return setHold(null);
  const now = Date.now();
  const ad = provider.ad();
  const stalled = provider.stalled();
  let next = holdReason;
  if (ad) next = "ad";
  else if (stalled) {
    stallSince ||= now;
    cleanSince = 0;
    if (now - stallSince > 1000) next = "buffering";
  } else {
    stallSince = 0;
    if (holdReason === "ad") next = null;
    if (holdReason === "buffering") {
      cleanSince ||= now;
      if (provider.getState()?.playing && now - cleanSince >= 1000) next = null;
    }
  }
  if (next === null && !stalled) lastGood = provider.getState()?.position ?? lastGood;
  setHold(next, ad?.left ?? null);
}

function setHold(reason: "buffering" | "ad" | null, adLeft: number | null = null) {
  // Ad time is sent in 5 s steps: enough for "about 0:20 left" without chatter.
  const left = adLeft === null ? null : Math.ceil(adLeft / 5) * 5;
  if (reason === holdReason && left === heldAdLeft) return;
  const ended = holdReason !== null && reason === null;
  holdReason = reason;
  heldAdLeft = left;
  stallSince = cleanSince = 0;
  post({ kind: "hold", reason, position: lastGood, adLeft: left });
  if (ended) setTimeout(() => catchUp(), 300); // rejoin wherever the room is now
}

/** The card on everyone else's screen while the room waits (US-102, US-103, US-104). */
function drawWait() {
  const me = room?.session?.participantId;
  const waiting =
    room?.following && room.playback?.status === "paused"
      ? room.participants.filter((p) => p.id !== me && p.hold && p.connected)
      : [];
  const who = waiting[0];
  if (!who) {
    if (waitShownAt) {
      clearPrompt(waitKey); // "wait" or "wait-late", whichever is showing (BUG-021)
      // Not while the room still waits for my own ad or loading.
      if (!holdReason) toast("Back together", 3000, { icon: "check", tone: "ok" });
      waitShownAt = 0;
      waitKey = "";
    }
    return;
  }
  waitShownAt ||= Date.now();
  const left = who.adLeft ? ` · about ${clock(who.adLeft)} left` : "";
  const text =
    who.hold === "ad" ? `${who.name} is on an ad${left}` : `Waiting for ${who.name} to load`;
  const late = Date.now() - waitShownAt > WAIT_CHOICE_MS;
  const key = late ? "wait-late" : "wait";
  const detail = late
    ? `This is taking a while. Play on now and ${who.name} can catch up later.`
    : who.hold === "ad"
      ? "Paused for everyone until the ad ends."
      : `Paused for everyone until ${who.name} catches up.`;
  if (key !== waitKey) clearPrompt(waitKey);
  waitKey = key;
  prompt(
    text,
    late
      ? [
          { label: "Keep waiting", run: () => (waitShownAt = Date.now()) },
          { label: `Watch without ${who.name}`, primary: true, run: () => goOn() },
        ]
      : [],
    key,
    { who: who.name, icon: who.hold === "ad" ? "ad" : "wait", detail },
  );
}

/** "Watch without B": play for everyone but whoever the room is waiting for (DEC-017). */
function goOn() {
  if (!provider || !mine || !room?.playback) return;
  const position = expectedPosition(room.playback, Date.now() + room.clockOffset);
  post({
    kind: "playback",
    action: "play",
    status: "playing",
    position,
    rate: 1,
    titleId: mine.titleId,
  });
  hold(1500);
  provider.play().catch(() => {});
  clearPrompt(waitKey);
  waitShownAt = 0;
  waitKey = "";
}

// ---- Start with 3-2-1 (US-105) ----

let startPhase: "preparing" | "go" | null = null;
let readySent = false;
let countdown: ReturnType<typeof setInterval> | undefined;

function startTogether() {
  const at = provider?.getState()?.position ?? 0;
  if (mine) post({ kind: "start", position: at, titleId: mine.titleId });
}

function onStart(s: {
  phase: "preparing" | "go" | "cancelled";
  byName: string;
  position: number;
  titleId: string | null;
  notReady: string[];
  startAt: number | null;
}) {
  if (s.phase === "cancelled") {
    // Also when I've already moved to another title (the room moved on mid-start):
    // a start left "preparing" would switch off drift checks for good.
    clearInterval(countdown);
    startPhase = null;
    return clearPrompt("start");
  }
  if (!provider || !mine || s.titleId !== mine.titleId || !room?.following) return;
  clearInterval(countdown);
  if (s.phase === "preparing") {
    if (startPhase !== "preparing") {
      startPhase = "preparing";
      readySent = false;
      hold(1500);
      provider.pause().catch(() => {});
      seekQuietly(provider, s.position).catch(() => {});
      sendReadyWhenLoaded();
    }
    const others = s.notReady.filter((n) => n !== room?.name);
    const text = others.length
      ? `Getting ready to start together · waiting for ${others.join(", ")}`
      : "Getting ready to start together";
    return prompt(
      text,
      [{ label: "Start anyway", run: () => post({ kind: "startForce" }) }],
      "start",
      { who: s.byName, icon: "play", detail: "Everyone jumps to the same moment first." },
    );
  }
  // go: count down to one shared server moment, then everyone plays.
  startPhase = "go";
  const startLocal = (s.startAt ?? 0) - (room?.clockOffset ?? 0);
  const tick = () => {
    const n = Math.ceil((startLocal - Date.now()) / 1000);
    if (n > 0)
      return prompt(`Starting together in ${n}`, [], "start", { who: s.byName, icon: "play" });
    clearInterval(countdown);
    clearPrompt("start");
    startPhase = null;
    hold(1500);
    provider?.play().catch(() => {});
  };
  tick();
  countdown = setInterval(tick, 100);
}

/** Tells the room this player has the frame at the start position and can play at once. */
function sendReadyWhenLoaded(tries = 100) {
  const v = provider?.video();
  if (startPhase !== "preparing" || readySent) return;
  if (v && !v.seeking && v.readyState >= 3) {
    readySent = true;
    post({ kind: "startReady" });
    return;
  }
  if (tries > 0) setTimeout(() => sendReadyWhenLoaded(tries - 1), 100);
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
    { icon: "rejoin", tone: "accent" },
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
  // Updated or reloaded: this copy is cut off and the new one runs the page (BUG-052).
  if (!chrome.runtime?.id) return retire();
  port = chrome.runtime.connect({ name: "tab" });
  port.onMessage.addListener(onPush);
  // The background worker can restart; reconnect and report again.
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, 1000);
  });
  // A restarted worker dropped the chat frame's connection too: give it a new pass.
  renewFrame();
  // Only a title is news. A page still reading its title (or a browse page in another
  // tab) would otherwise say "nothing open" over the tab that is watching: a reload
  // looked like closing the show. A tab that closes is reported by the background.
  if (mine) reportPresence();
  // A browse page never gets a title: past the page-load allowance, say we're on the
  // service so friends see it (BUG-049). The background keeps a tab that has a title.
  else
    setTimeout(() => {
      if (!mine) reportPresence();
    }, 5000);
}

/** Back to this tab while the room connection is down: try again now, not at the next retry. */
function wake() {
  if (document.visibilityState === "visible" && room?.connection === "reconnecting")
    post({ kind: "retryNow" });
}

const timers: ReturnType<typeof setInterval>[] = [];

function retire() {
  for (const t of timers) clearInterval(t);
  document.removeEventListener("visibilitychange", wake);
  window.removeEventListener("focus", wake);
  chrome.storage.onChanged.removeListener(onSetting);
  retireOverlay();
  retireSidebar();
  retireReactions();
}

/** When this tab's title went missing; 0 while it has one. */
let goneSince = 0;

function poll() {
  const now = provider?.media() ?? null;
  if (sameTitle(now, mine)) {
    goneSince = 0; // back after a blip: the next gap gets its full 3 s
    return;
  }
  if (!now && mine) {
    // Between episodes the player reloads and its title can't be read for a moment.
    // Reporting "nothing open" then would tell friends I closed the show and make the
    // next episode look like a new pick, so wait 3 s and ignore the player meanwhile.
    goneSince ||= Date.now();
    if (Date.now() - goneSince < 3000) return hold(1500);
  }
  goneSince = 0;
  const titleChanged = now?.titleId !== mine?.titleId;
  mine = now;
  reportPresence();
  if (!titleChanged) return;
  if (mine) sayArrival();
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
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
  listen(provider, (action, playing, position, rate) => {
    const status = playing ? "playing" : "paused";
    if (holdReason) return; // ad seeks and buffering stalls aren't the person's actions
    if (room?.session && room.following && mine)
      post({ kind: "playback", action, status, position, rate, titleId: mine.titleId });
  });
  timers.push(
    setInterval(poll, 1000),
    setInterval(checkDrift, 1000),
    setInterval(() => {
      checkHold();
      drawWait();
    }, 250),
  );
}
