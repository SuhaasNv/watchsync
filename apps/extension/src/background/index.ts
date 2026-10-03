// Owns the room: REST calls, the WebSocket, and fan-out to the popup and the tab.

import type { Emoji, JoinRoomRequest, Media, Service } from "@watchsync/protocol";
import {
  type AnyClientMessage,
  type AnyServerMessage,
  type ClientMessageOf,
  envelope,
  isClientMessage,
  isRoomTicket,
  isServerMessage,
} from "@watchsync/protocol";
import { bestSample, type ClockSample, clockSample } from "@watchsync/sync-engine";
import { isTypedText, salvageHistory } from "../shared/chat";
import {
  type AppState,
  type ChatNonceReply,
  type ChatNonceRequest,
  type ChatTabRequest,
  cleanName,
  isSidebarEvent,
  nameProblem,
  type Push,
  type Reply,
  type Request,
  type Session,
  type TabEvent,
} from "../shared/messages";
import { RateWindow, REACTIONS_PER_5S } from "../shared/reactions";
import {
  DEV_RELEASE_API,
  isUpdate,
  latestRelease,
  RELEASES_API,
  type UpdateCheck,
} from "../shared/update";
import { badgeText } from "./badge";
import { ChatFrames, wantsServerMessage } from "./chat-frames";
import { type ChatSeen, chatRelay } from "./chat-relay";
import { injectOpenTabs } from "./inject";
import { restoreMessage } from "./restore";
import { RESTARTING, Retry } from "./retry";
import { updateGate } from "./updates";

const API = __API_URL__;

const state: AppState = {
  name: null,
  session: null,
  connection: "idle",
  participants: [],
  media: null,
  playback: null,
  following: true,
  clockOffset: 0,
  lastRoom: null,
  notice: null,
  mediaMove: null,
  update: null,
  updating: false,
  unreachable: false,
  unread: 0,
};
const ENDED = "This room is no longer available. Ask your friend for a new code.";
const DAY = 24 * 3600 * 1000;
let lastTicket: Session | null = null;
let socket: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | undefined;
const samples: ClockSample[] = [];
const ports = new Set<chrome.runtime.Port>();
// ponytail: the tab that reported last speaks for this person; one watching tab is the norm.
let presence: { service: Service; media: Media | null } = { service: "none", media: null };
let presencePort: chrome.runtime.Port | null = null;
/** The tab our presence comes from, kept after its port drops so a close can be told apart. */
let presenceTabId: number | undefined;
let tabGone: ReturnType<typeof setTimeout> | undefined;

function sendPresence() {
  sendServer(envelope("PRESENCE.UPDATE", { ...presence, following: state.following }));
}

function push(msg: Push) {
  for (const p of ports) p.postMessage(msg);
}

const chat = chatRelay({
  send(msg) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(msg));
    return true;
  },
  link: () =>
    socket?.readyState === WebSocket.OPEN ? "open" : state.session ? "reconnecting" : "closed",
  you: () => state.session?.participantId ?? null,
  seen(seen) {
    state.unread = seen.unread;
    // Ids and counts only, never text, so a worker restart keeps the count (DEC-032).
    const code = state.session?.code;
    if (code) chrome.storage.session.set({ chatSeen: { code, ...seen } }).catch(() => {});
  },
  connected: (port) => [...ports].some((p) => p === port),
});

function isChatSeen(v: unknown): v is ChatSeen & { code: string } {
  if (typeof v !== "object" || v === null) return false;
  const { code, unread, lastSeen } = v as { code?: unknown; unread?: unknown; lastSeen?: unknown };
  return (
    typeof code === "string" &&
    typeof unread === "number" &&
    Number.isInteger(unread) &&
    unread >= 0 &&
    (lastSeen === null || typeof lastSeen === "string")
  );
}
/**
 * The state other contexts see: never the room token. Only this worker uses it, and a port's
 * name or a reply can reach a content script on a service page (BUG-044).
 */
function shared(): AppState {
  return { ...state, session: state.session && { ...state.session, token: "" } };
}
function changed() {
  for (const p of ports) p.postMessage({ kind: "state", state: shared() } satisfies Push);
  showBadge();
}

let badge: string | null = null;
/**
 * The toolbar badge (US-116): the same unread count as the chat button (US-044), 9+ past
 * nine, none out of a room; dev builds show DEV at 0.
 */
function showBadge() {
  const text = badgeText(state.session ? state.unread : 0, __CHANNEL__);
  if (text === badge) return;
  badge = text;
  chrome.action.setBadgeText({ text }).catch(() => {});
}

async function restore() {
  const { name } = await chrome.storage.local.get("name");
  const {
    session,
    lastTicket: kept,
    chatSeen,
  } = await chrome.storage.session.get(["session", "lastTicket", "chatSeen"]);
  // A name saved by an older version may hold marks the service now refuses.
  state.name = typeof name === "string" ? cleanName(name) || null : null;
  if (isRoomTicket(session)) {
    state.session = session;
    // The worker restarted in a room: its unread count, recomputed when the history arrives.
    if (isChatSeen(chatSeen) && chatSeen.code === session.code) {
      chat.restore({ unread: chatSeen.unread, lastSeen: chatSeen.lastSeen });
      state.unread = chatSeen.unread;
    }
    connect();
    return;
  }
  // Offer the last room back for a day. Local storage keeps only its code, since content
  // scripts can read it (BUG-044); the token survives in session storage while the browser
  // runs, and without it a Rejoin is a plain join.
  const { lastRoom } = await chrome.storage.local.get("lastRoom");
  if (isSaved(lastRoom) && Date.now() - lastRoom.at < DAY) {
    const ticket = isRoomTicket(kept) && kept.code === lastRoom.code ? kept : null;
    lastTicket = ticket ?? { code: lastRoom.code, token: "", participantId: "" };
    state.lastRoom = lastRoom.code;
  } else if (lastRoom !== undefined) {
    // Stale or malformed, or saved by an older version with its token: forget it.
    await chrome.storage.local.remove("lastRoom");
  }
}

function isSaved(v: unknown): v is { code: string; at: number } {
  if (typeof v !== "object" || v === null) return false;
  const { code, at } = v as { code?: unknown; at?: unknown };
  return typeof at === "number" && typeof code === "string" && /^[A-HJ-NP-Z2-9]{6}$/.test(code);
}
const ready = restore();

/** Looks for a newer release at most once a day; any failure just means no notice. */
async function checkForUpdate() {
  const latest = await latestRelease({
    now: Date.now(),
    load: async () => (await chrome.storage.local.get("updateCheck")).updateCheck,
    save: (updateCheck: UpdateCheck) => chrome.storage.local.set({ updateCheck }),
    fetchLatest: async () => {
      // Test builds stay off the network; they read only what a test put in the cache.
      if (__MOCK__) throw new Error("offline in tests");
      const res = await fetch(__CHANNEL__ === "dev" ? DEV_RELEASE_API : RELEASES_API, {
        headers: { accept: "application/vnd.github+json" },
        credentials: "omit",
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`releases ${res.status}`);
      return res.json();
    },
  });
  const installed = chrome.runtime.getManifest().version;
  await ready; // never push a half-restored state to an open popup
  // Dev builds compare commits: any other dev build is the newer one (only dev-latest is read).
  const fresh =
    __CHANNEL__ === "dev"
      ? latest?.version !== __BUILD__
      : isUpdate(latest?.version ?? "", installed);
  state.update = latest && fresh ? latest : null;
  changed();
}
checkForUpdate().catch(() => {});

// Testers run "WatchSync Dev" next to the real one; its badge says DEV while nothing is unread.
chrome.action.setBadgeBackgroundColor({ color: "#ffd25a" }).catch(() => {});
showBadge();

async function api(path: string, body: unknown) {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("unreachable");
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorFor(res.status, data));
  if (!isRoomTicket(data)) throw new Error("unreachable");
  return data;
}

function errorFor(status: number, data: unknown): string {
  if (status === 404) return "not_found";
  if (status === 409) return "full";
  if (status === 410) return "expired";
  if (status === 429) return "rate_limited";
  const detail = (data as { detail?: unknown } | null)?.detail;
  return typeof detail === "string" && status === 422 ? "invalid" : "unreachable";
}

function sendServer(msg: AnyClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

/** Our share of the room service's reaction limit, so a dropped one can say so (US-046). */
const reactions = new RateWindow(REACTIONS_PER_5S, 5000);

/** A reaction goes out now or not at all: never queued or retried after a drop (US-046). */
function react(emoji: Emoji, count: number, from: chrome.runtime.Port) {
  const msg = envelope<ClientMessageOf<"REACTION.SEND">>("REACTION.SEND", { emoji, count });
  if (!isClientMessage(msg)) return;
  const online = state.connection === "connected" && socket?.readyState === WebSocket.OPEN;
  const reason = !online ? "offline" : reactions.allow() ? null : "limit";
  if (reason) return from.postMessage({ kind: "reactionDropped", emoji, reason } satisfies Push);
  sendServer(msg);
}

// Backoff 1, 2, 4, 8, then every 10 s with jitter: a friend back on Wi-Fi rejoins quickly
// (BUG-018) and a room's clients don't all retry at once. After 2 minutes down, the page and
// popup say so plainly (test builds: 15 s, so end-to-end tests can see it).
const retry = new Retry(
  () => connect(),
  () => {
    if (state.connection !== "reconnecting") return;
    state.unreachable = retry.status().unreachable;
    changed();
  },
  __MOCK__ ? 15_000 : 120_000,
);
/** The service told us it was restarting since we last heard the room (US-120). */
let sawRestart = false;

/** Network back, the popup or a service tab opened or came into view, or Try now. */
function retryNow() {
  if (state.connection !== "reconnecting" || !state.session) return;
  retry.now();
}
// The browser saying the network is back is the best moment to retry.
self.addEventListener("online", retryNow);

function connect() {
  const s = state.session;
  if (!s) return;
  if (state.connection !== "reconnecting") state.connection = "connecting";
  changed();
  // The token goes as a subprotocol next to ours, never in the URL, so no log that prints
  // URLs holds it. A token that isn't a valid subprotocol would throw: the room refuses us.
  const token = /^[A-Za-z0-9_.-]+$/.test(s.token) ? [s.token] : [];
  // A try still hanging (Try now, a tab coming into view) is dropped, never left open.
  const hanging = socket;
  socket = null;
  hanging?.close();
  const ws = new WebSocket(`${API.replace(/^http/, "ws")}/ws/rooms/${s.code}`, [
    "watchsync.v1",
    ...token,
  ]);
  socket = ws;
  ws.onmessage = (e) => {
    let msg: unknown;
    try {
      msg = JSON.parse(String(e.data));
    } catch {
      return;
    }
    const valid = isServerMessage(msg) ? msg : salvageHistory(msg);
    if (valid) onServer(valid);
  };
  ws.onopen = () => {
    clearInterval(pingTimer);
    // Pings keep the MV3 worker alive while in a room and feed the clock estimate.
    const ping = () => sendServer(envelope("SYS.PING", { t1: Date.now() }));
    ping();
    pingTimer = setInterval(ping, 20_000);
    sendPresence();
    chat.onSocketOpen(); // messages typed while reconnecting go out now
  };
  ws.onclose = (e) => {
    if (socket !== ws) return;
    socket = null;
    clearInterval(pingTimer);
    chat.onSocketClosed(); // sends with no echo yet go again on the next connection
    if (e.code === 1008) {
      // The room ended or our token was revoked; retrying can't help.
      void endSession(ENDED);
    } else if (e.code === 4000) {
      // A newer connection of ours took over (worker restart); it owns the room now.
      state.connection = "idle";
    } else if (state.session) {
      // Network trouble, flooding (4001) or a restart (4002/1012): a restart retries within
      // 1 to 3 s for a minute, the rest back off (retry.ts).
      state.connection = "reconnecting";
      if (RESTARTING.has(e.code)) sawRestart = true;
      Object.assign(state, retry.closed(e.code));
    }
    changed();
  };
}

// Keeps the people list in arrival order when someone's row is replaced.
const seen = new Map<string, number>();
const order = (id: string) => {
  if (!seen.has(id)) seen.set(id, seen.size);
  return seen.get(id) ?? 0;
};

function onServer(msg: AnyServerMessage) {
  switch (msg.type) {
    case "ROOM.STATE": {
      const known = { media: state.media, playback: state.playback };
      state.connection = "connected";
      state.mediaMove = null;
      state.notice = null;
      retry.reset();
      state.updating = false;
      state.unreachable = false;
      state.participants = msg.payload.participants;
      for (const p of state.participants) order(p.id);
      state.media = msg.payload.media;
      state.playback = msg.payload.playback;
      // Back in a room the restarted service brought back from our token (US-120): it
      // knows who we are but not what we watched. Tell it what we knew.
      const restore = restoreMessage(
        known,
        msg.payload.media,
        sawRestart,
        Date.now() + state.clockOffset,
      );
      sawRestart = false;
      if (restore) sendServer(restore);
      break;
    }
    case "ROOM.PARTICIPANT": {
      const { participant, event } = msg.payload;
      const others = state.participants.filter((p) => p.id !== participant.id);
      state.participants = event === "left" ? others : [...others, participant];
      if (event !== "left") state.participants.sort((a, b) => order(a.id) - order(b.id));
      break;
    }
    case "ROOM.MEDIA": {
      const { media, how, byId, byName } = msg.payload;
      state.media = media;
      state.mediaMove = { how, byId, byName };
      break;
    }
    case "PLAYBACK.STATE":
      state.playback = msg.payload.playback;
      break;
    case "START.STATE": {
      // Mirror the room's clock: paused while getting ready, playing from startAt on go.
      const { phase, position, titleId, startAt } = msg.payload;
      if (phase === "cancelled") break;
      const status = phase === "go" ? "playing" : "paused";
      const updatedAt = startAt ?? Date.now() + state.clockOffset;
      state.playback = { status, position, rate: 1, updatedAt, titleId };
      break;
    }
    case "SYS.PONG": {
      samples.push(clockSample(msg.payload.t1, msg.payload.serverTime, Date.now()));
      if (samples.length > 10) samples.shift();
      state.clockOffset = bestSample(samples)?.offset ?? 0;
      break;
    }
  }
  const to = chat.onServer(msg); // chat: unread count, and a refusal for its own tab only
  if (msg.type !== "REACTION.SHOW") changed(); // a reaction changes no state: no pill rebuild
  // Chat goes only to the chat frames, never to a service page's content script (DEC-042),
  // and a refusal only to the frame whose message it was.
  if (to === "all") {
    for (const p of ports)
      if (wantsServerMessage(p.name, msg.type)) p.postMessage({ kind: "server", message: msg });
  } else to?.postMessage({ kind: "server", message: msg } satisfies Push);
}

function reset() {
  retry.reset();
  socket?.close(); // onclose ignores it: socket is no longer this one
  socket = null;
  seen.clear();
  sawRestart = false;
  chat.reset(); // a room's chat stays with it: leaving, ending or switching forgets it
  chrome.storage.session.remove("chatSeen").catch(() => {});
  Object.assign(state, {
    participants: [],
    media: null,
    playback: null,
    connection: "idle",
    updating: false,
    unreachable: false,
    unread: 0,
  });
}

async function startSession(ticket: Session) {
  reset(); // also covers switching rooms from the invite page
  state.session = ticket;
  state.notice = null;
  state.lastRoom = null;
  lastTicket = ticket;
  await chrome.storage.session.set({ session: ticket });
  await chrome.storage.local.set({ lastRoom: { code: ticket.code, at: Date.now() } });
  connect();
}

async function endSession(notice: string | null) {
  reset();
  state.session = null;
  state.notice = notice;
  state.lastRoom = null;
  lastTicket = null;
  await chrome.storage.session.remove(["session", "lastTicket"]);
  await chrome.storage.local.remove("lastRoom");
  changed();
  updates.left();
}

// An update mid-room would clear the room ticket and drop us out: wait until we're out. The
// reload waits a moment so the popup gets its answer first.
const updates = updateGate(() => setTimeout(() => chrome.runtime.reload(), 500));
chrome.runtime.onUpdateAvailable.addListener(() => updates.available(state.session !== null));

// One request at a time, so a join from the popup and the invite page can't both add a
// participant (resilience audit).
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.catch(() => {});
  return run;
}
const handle = (req: Request) => serial(() => handleNow(req));

/**
 * The last browser window closed: leave the room, so friends hear we've gone, but keep the
 * code so the popup and the next title page offer Rejoin. The room waits for us until it
 * expires. If the browser quits too fast for this, the room service notices instead.
 */
async function leaveForNow() {
  const s = state.session;
  if (!s) return;
  sendServer(envelope("ROOM.LEAVE", { keepRoom: true }));
  reset();
  state.session = null;
  state.notice = null;
  state.lastRoom = s.code;
  lastTicket = s;
  await chrome.storage.session.remove("session");
  await chrome.storage.session.set({ lastTicket: s });
  await chrome.storage.local.set({ lastRoom: { code: s.code, at: Date.now() } });
  changed();
}

chrome.windows.onRemoved.addListener(() => {
  chrome.windows
    .getAll({ windowTypes: ["normal"] })
    .then((open) => (open.length === 0 ? serial(leaveForNow) : undefined))
    .catch(() => {});
});

/**
 * Back into the last room under our name; the room tells everyone we rejoined. Our last
 * token proves it's us, so the room gives back our place if it still holds it (BUG-041).
 */
async function rejoin() {
  if (!lastTicket) throw new Error("expired");
  if (!state.name) throw new Error("invalid");
  const { code, token } = lastTicket;
  const body: JoinRoomRequest = { name: state.name, ...(token ? { token } : {}) };
  let ticket: Session;
  try {
    ticket = await api(`/api/v1/rooms/${code}/join`, body);
  } catch (e) {
    const gone = e instanceof Error && (e.message === "expired" || e.message === "not_found");
    if (!gone) throw e;
    return endSession(ENDED); // ended, or the service restarted and forgot it
  }
  await startSession(ticket);
}

async function handleNow(req: Request): Promise<Reply> {
  await ready;
  try {
    switch (req.kind) {
      case "getState":
        break;
      case "setName": {
        const name = cleanName(req.name);
        if (nameProblem(req.name)) throw new Error("invalid"); // same rule as every name field
        state.name = name;
        await chrome.storage.local.set({ name });
        break;
      }
      case "create":
        if (!state.name) throw new Error("invalid");
        await startSession(await api("/api/v1/rooms", { name: state.name }));
        break;
      case "join": {
        const code = req.code.trim().toUpperCase();
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error("not_found");
        if (!state.name) throw new Error("invalid");
        if (state.session?.code === code) break;
        const ticket = await api(`/api/v1/rooms/${code}/join`, { name: state.name });
        // Switching rooms from an invite page: leave the old one for good, not as "Away".
        if (state.session) sendServer(envelope("ROOM.LEAVE", {}));
        await startSession(ticket);
        break;
      }
      case "leave":
        sendServer(envelope("ROOM.LEAVE", {})); // revokes our token
        await endSession(null);
        break;
      case "rejoin":
        await rejoin();
        break;
      case "forgetRoom":
        await endSession(null);
        break;
      case "follow":
        state.following = req.following;
        sendPresence();
        break;
      case "retryNow":
        retryNow();
        break;
      case "openChat":
        if (!(await openChat())) throw new Error("no_tab");
        break;
    }
    changed();
    return { ok: true, state: shared() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unreachable", state: shared() };
  }
}

// First install only (not updates or reloads): show what WatchSync does and how to start.
// On removal Chrome opens a thank-you page with answers to common reasons. Nothing is sent.
chrome.runtime.setUninstallURL(`${__SITE_URL__}/goodbye/`).catch(() => {});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") void chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  void injectOpenTabs(chrome);
});

/** Tells the content script of one tab, and no other, about its chat panel. */
function toTab(tabId: number | undefined, msg: Push) {
  if (tabId === undefined) return;
  for (const p of ports) if (p.name === "tab" && p.sender?.tab?.id === tabId) p.postMessage(msg);
}

/** Tells the chat frames (admitted ones only) of one tab, and no other. */
function toChatFrames(tabId: number | undefined, msg: Push) {
  if (tabId === undefined) return;
  for (const p of ports)
    if (p.name === "sidebar" && p.sender?.tab?.id === tabId) p.postMessage(msg);
}

/** The chat shortcut (US-040): only the tab it was pressed in opens or closes its panel. */
async function onCommand(command: string, tab?: chrome.tabs.Tab) {
  if (command !== "toggle-sidebar") return;
  const id = tab?.id ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
  toTab(id, { kind: "toggleSidebar" });
}
chrome.commands.onCommand.addListener((command, tab) => {
  onCommand(command, tab).catch((e: unknown) => console.debug("watchsync: shortcut", e));
});

// Test builds only: lets end-to-end tests cut the connection like a network drop, and press
// the chat shortcut (Playwright can't press extension commands).
if (__MOCK__)
  Object.assign(globalThis, {
    watchsyncDropSocket: () => socket?.close(),
    watchsyncCommand: onCommand,
  });

const chatFrames = new ChatFrames();

/** The title each service tab last reported, for Open chat (US-115). */
const tabTitles = new Map<number, string | null>();

/** Service tabs with our content script running, newest first. */
async function serviceTabs(): Promise<chrome.tabs.Tab[]> {
  const ids = new Set<number>();
  for (const p of ports) if (p.name === "tab" && p.sender?.tab?.id) ids.add(p.sender.tab.id);
  const tabs = await Promise.all([...ids].map((id) => chrome.tabs.get(id).catch(() => null)));
  return tabs
    .filter((t): t is chrome.tabs.Tab => t !== null)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
}

/**
 * Brings forward the tab playing the room's title (else the most recent service tab) and
 * opens chat there with focus in it (US-115). False when there is no service tab.
 */
async function openChat(): Promise<boolean> {
  const tabs = await serviceTabs();
  const title = state.media?.titleId;
  const tab = tabs.find((t) => t.id !== undefined && title && tabTitles.get(t.id) === title);
  const target = tab ?? tabs[0];
  if (target?.id === undefined) return false;
  await chrome.tabs.update(target.id, { active: true });
  await chrome.windows.update(target.windowId, { focused: true });
  toTab(target.id, { kind: "openSidebar" });
  return true;
}

chrome.runtime.onMessage.addListener(
  (req: Request | ChatNonceRequest | ChatTabRequest, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (req.kind === "hasChatTab") {
      serviceTabs()
        .then((tabs) => reply(tabs.length > 0))
        .catch(() => reply(false));
      return true;
    }
    if (req.kind === "chatNonce") {
      // Only a tab's content script (its top frame) gets a pass for its chat frame.
      const nonce = chatFrames.issue(sender);
      reply((nonce ? { nonce } : null) satisfies ChatNonceReply);
      return false;
    }
    handle(req).then(reply);
    return true;
  },
);

/** The tab we were watching in is gone: say "nothing open" now (BUG-026). */
function presenceTabClosed() {
  clearTimeout(tabGone);
  presencePort = null;
  presenceTabId = undefined;
  if (presence.media === null) return;
  titleTabGone();
}

/**
 * The tab with our title is gone. Another tab still playing a title takes over; only if none
 * answers is nothing open (BUG-051): it reported once, on its own title change, long ago.
 */
function titleTabGone() {
  presenceTabId = undefined;
  presence = { service: "none", media: null };
  push({ kind: "report" });
  setTimeout(() => {
    if (presenceTabId === undefined) sendPresence();
  }, 500);
}

// Closing the tab: no need to wait out the 3 s page-load allowance below.
chrome.tabs.onRemoved.addListener((tabId) => {
  chatFrames.forget(tabId);
  tabTitles.delete(tabId);
  if (tabId === presenceTabId) presenceTabClosed();
});
// The retry: every 15 s make sure that tab still exists, so a missed close event can't
// leave a title showing for someone who closed it (BUG-026).
setInterval(() => {
  if (presenceTabId === undefined || presence.media === null) return;
  chrome.tabs.get(presenceTabId).catch(presenceTabClosed);
}, 15_000);

/**
 * Where this person's player is, for a chat message's movie time: the room's clock when the
 * tab we watch in is on the room's title and not in an ad; otherwise no time (name only).
 */
function myTime(): { movieTime: number | null; titleId: string | null } {
  const titleId = presence.media?.titleId ?? null;
  const pb = state.playback;
  const me = state.participants.find((p) => p.id === state.session?.participantId);
  if (titleId === null || !pb || pb.titleId !== titleId || me?.hold === "ad")
    return { movieTime: null, titleId };
  const now = Date.now() + state.clockOffset;
  const elapsed = pb.status === "playing" ? ((now - pb.updatedAt) / 1000) * pb.rate : 0;
  return { movieTime: Math.max(0, pb.position + elapsed), titleId };
}

/**
 * A chat frame's port is served only after it says hello with the pass its tab's content
 * script was given (DEC-042); anything else, or silence, is disconnected unserved.
 */
function admitChatFrame(port: chrome.runtime.Port) {
  const silent = setTimeout(() => port.disconnect(), 5000);
  const hello = (e: unknown) => {
    clearTimeout(silent);
    port.onMessage.removeListener(hello);
    const frame = chatFrames.admit(port.sender, e);
    if (!frame) return port.disconnect();
    const tabId = port.sender?.tab?.id;
    ports.add(port);
    toTab(tabId, { kind: "chatFrameReady", frame });
    // Gone without the content script removing it (the page pointed the frame elsewhere):
    // tell the tab at once, so it puts the real frame back. Its own removals it ignores.
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      toTab(tabId, { kind: "chatFrameLost", frame });
    });
    // Its close goes only to the content script of the tab it sits in.
    port.onMessage.addListener((m: unknown) => {
      if (!isSidebarEvent(m)) return;
      if (m.kind === "close") toTab(port.sender?.tab?.id, { kind: "closeSidebar" });
      if (m.kind === "chat")
        chat.onTabEvent(port, { kind: "chat", text: m.text, clientId: m.clientId, ...myTime() });
      if (m.kind === "react") react(m.emoji, m.count, port);
      if (m.kind === "typing") toTab(port.sender?.tab?.id, { kind: "chatTyping", on: m.on });
    });
    ready.then(() => {
      port.postMessage({ kind: "state", state: shared() } satisfies Push);
      chat.onPortConnected(port); // the room's earlier messages, once known
    });
  };
  port.onMessage.addListener(hello);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id !== chrome.runtime.id) return port.disconnect();
  if (port.name === "sidebar") return admitChatFrame(port);
  ports.add(port);
  retryNow();
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    if (port !== presencePort) return;
    presencePort = null;
    // A page load (next episode, Open) drops the port for a moment; only report the
    // title as closed if no tab reports again soon, so the room keeps following us.
    tabGone = setTimeout(titleTabGone, 3000);
  });
  if (port.name === "tab")
    port.onMessage.addListener((e: TabEvent) => {
      if (e.kind === "playback") {
        const { kind: _, ...update } = e;
        // A speed tool can run the player past the protocol's 0.25-4x, and the room would
        // refuse the whole play, pause or jump; share it at the nearest allowed rate.
        update.rate = Math.min(4, Math.max(0.25, update.rate));
        const msg = envelope<ClientMessageOf<"PLAYBACK.UPDATE">>("PLAYBACK.UPDATE", update);
        if (!isClientMessage(msg)) return; // a NaN or out-of-range position: never our clock
        sendServer(msg);
        // The room tells everyone but the sender; keep our own copy of its clock current
        // too, or our drift check and wait card judge against the old one (BUG-006).
        const { status, position, rate, titleId } = update;
        state.playback = {
          status,
          position,
          rate,
          titleId,
          updatedAt: Date.now() + state.clockOffset,
        };
        changed();
        return;
      }
      if (e.kind === "hold") {
        const { kind: _, ...hold } = e;
        return sendServer(envelope("HOLD.UPDATE", hold));
      }
      if (e.kind === "start")
        return sendServer(envelope("START.REQUEST", { position: e.position, titleId: e.titleId }));
      if (e.kind === "startReady") return sendServer(envelope("START.READY", {}));
      if (e.kind === "startForce") return sendServer(envelope("START.FORCE", {}));
      if (e.kind === "retryNow") return retryNow();
      if (e.kind === "chat") return chat.onTabEvent(port, e);
      if (e.kind === "chatOpened") {
        chat.onTabEvent(port, e);
        return changed();
      }
      if (e.kind === "react") return react(e.emoji, e.count, port);
      if (e.kind === "chatType") {
        // From this tab's content script to this tab's chat frames, and only if it is text.
        if (isTypedText(e.text))
          toChatFrames(port.sender?.tab?.id, { kind: "chatInsert", text: e.text });
        return;
      }
      const tabId = port.sender?.tab?.id;
      if (tabId !== undefined) tabTitles.set(tabId, e.media?.titleId ?? null);
      // A browse page in another tab mustn't hide the tab still playing a title; that
      // tab's close is reported by tabs.onRemoved (BUG-049).
      if (!e.media && presence.media && presenceTabId !== undefined && tabId !== presenceTabId)
        return;
      clearTimeout(tabGone);
      presencePort = port;
      presenceTabId = tabId;
      presence = { service: e.service, media: e.media };
      sendPresence();
    });
  ready.then(() => port.postMessage({ kind: "state", state: shared() } satisfies Push));
});
