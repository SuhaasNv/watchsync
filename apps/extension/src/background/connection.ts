// The room connection: REST calls, the WebSocket, the clock estimate and the retry.

import type { Emoji } from "@watchsync/protocol";
import {
  type AnyClientMessage,
  type AnyServerMessage,
  type ClientMessageOf,
  envelope,
  isClientMessage,
  isRoomTicket,
  isServerMessage,
} from "@watchsync/protocol";
import {
  CLOCK_MAX_AGE_MS,
  CLOCK_WINDOW,
  clockSample,
  estimateOffset,
  freshSamples,
  nextPingDelay,
  smoothOffset,
  type TimedSample,
  toWallOffset,
} from "@watchsync/sync-engine";
import { salvageHistory } from "../shared/chat";
import type { Push } from "../shared/messages";
import { RateWindow, REACTIONS_PER_5S } from "../shared/reactions";
import { wantsServerMessage } from "./chat-frames";
import { chatRelay } from "./chat-relay";
import { restoreMessage } from "./restore";
import { RESTARTING, Retry } from "./retry";
import { endSession } from "./session";
import { API, changed, ENDED, ports, state } from "./state";
import { sendPresence } from "./tabs";

export let socket: WebSocket | null = null;
let pingTimer: ReturnType<typeof setTimeout> | undefined;
/** Ping round trips on the monotonic clock (performance.now), so a system clock change can't skew them. */
let samples: TimedSample[] = [];
/** False until a pong has set clockOffset, and again when its samples are too old to trust. */
let clockKnown = false;

export const chat = chatRelay({
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

export async function api(path: string, body: unknown) {
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

export function sendServer(msg: AnyClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

/** Our share of the room service's reaction limit, so a dropped one can say so (US-046). */
const reactions = new RateWindow(REACTIONS_PER_5S, 5000);

/** A reaction goes out now or not at all: never queued or retried after a drop (US-046). */
export function react(emoji: Emoji, count: number, from: chrome.runtime.Port) {
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
export function retryNow() {
  if (state.connection !== "reconnecting" || !state.session) return;
  retry.now();
}

export function connect() {
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
    clearTimeout(pingTimer);
    // An estimate older than 2 minutes isn't trusted: the burst below replaces it.
    samples = freshSamples(samples, performance.now(), CLOCK_MAX_AGE_MS);
    if (samples.length === 0) {
      clockKnown = false;
      state.clockUncertainty = null;
    }
    // Pings keep the MV3 worker alive while in a room and feed the clock estimate: a quick
    // burst on every (re)connect for a good first estimate, then one every 5 s.
    let sent = 0;
    const ping = () => {
      sendServer(envelope("SYS.PING", { t1: performance.now() }));
      sent += 1;
      pingTimer = setTimeout(ping, nextPingDelay(sent));
    };
    ping();
    sendPresence();
    chat.onSocketOpen(); // messages typed while reconnecting go out now
  };
  ws.onclose = (e) => {
    if (socket !== ws) return;
    socket = null;
    clearTimeout(pingTimer);
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
      const t4 = performance.now();
      samples.push({ ...clockSample(msg.payload.t1, msg.payload.serverTime, t4), at: t4 });
      if (samples.length > CLOCK_WINDOW) samples.shift();
      const best = estimateOffset(samples);
      if (best) {
        // The samples are server time minus monotonic time; callers add the offset to Date.now().
        const wall = toWallOffset(best.offset, Date.now(), t4);
        state.clockOffset = smoothOffset(clockKnown ? state.clockOffset : null, wall);
        state.clockUncertainty = best.rtt / 2;
        clockKnown = true;
      }
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

export function reset() {
  retry.reset();
  clearTimeout(pingTimer); // onclose below ignores this socket, so it can't stop the pings
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
