// Owns the room: REST calls, the WebSocket, and fan-out to the popup and the tab.

import type { Media, Service } from "@watchsync/protocol";
import {
  type AnyClientMessage,
  type AnyServerMessage,
  envelope,
  isRoomTicket,
  isServerMessage,
} from "@watchsync/protocol";
import { bestSample, type ClockSample, clockSample } from "@watchsync/sync-engine";
import type { AppState, Push, Reply, Request, Session, TabEvent } from "../shared/messages";

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
};
const ENDED = "This room is no longer available. Ask your friend for a new code.";
const DAY = 24 * 3600 * 1000;
let lastTicket: Session | null = null;
let attempt = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
let socket: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | undefined;
const samples: ClockSample[] = [];
const ports = new Set<chrome.runtime.Port>();
// ponytail: the tab that reported last speaks for this person; one watching tab is the norm.
let presence: { service: Service; media: Media | null } = { service: "none", media: null };
let presencePort: chrome.runtime.Port | null = null;
let tabGone: ReturnType<typeof setTimeout> | undefined;

function sendPresence() {
  sendServer(envelope("PRESENCE.UPDATE", { ...presence, following: state.following }));
}

function push(msg: Push) {
  for (const p of ports) p.postMessage(msg);
}
/** Only the popup may see the room token; pages' content scripts never need it. */
function stateFor(port: chrome.runtime.Port): AppState {
  if (port.name === "popup") return state;
  return { ...state, session: state.session && { ...state.session, token: "" } };
}
function changed() {
  for (const p of ports) p.postMessage({ kind: "state", state: stateFor(p) } satisfies Push);
}

async function restore() {
  const { name } = await chrome.storage.local.get("name");
  const { session } = await chrome.storage.session.get("session");
  state.name = typeof name === "string" ? name : null;
  if (isRoomTicket(session)) {
    state.session = session;
    connect();
    return;
  }
  // The browser restarted (session storage is gone): offer the last room back for a day.
  const { lastRoom } = await chrome.storage.local.get("lastRoom");
  if (isSaved(lastRoom) && Date.now() - lastRoom.at < DAY) {
    lastTicket = lastRoom.ticket;
    state.lastRoom = lastRoom.ticket.code;
  } else if (lastRoom !== undefined) {
    await chrome.storage.local.remove("lastRoom"); // stale or malformed: forget it
  }
}

function isSaved(v: unknown): v is { ticket: Session; at: number } {
  if (typeof v !== "object" || v === null) return false;
  const { ticket, at } = v as { ticket?: unknown; at?: unknown };
  return typeof at === "number" && isRoomTicket(ticket);
}
const ready = restore();

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

/** 1, 2, 4, 8, 16, then every 30 s, each with up to 30% jitter so clients don't stampede. */
const backoff = (n: number) => Math.min(30_000, 1000 * 2 ** n) * (1 + Math.random() * 0.3);

function connect() {
  const s = state.session;
  if (!s) return;
  clearTimeout(retry);
  if (state.connection !== "reconnecting") state.connection = "connecting";
  changed();
  const ws = new WebSocket(
    `${API.replace(/^http/, "ws")}/ws/rooms/${s.code}?token=${encodeURIComponent(s.token)}`,
  );
  socket = ws;
  ws.onmessage = (e) => {
    let msg: unknown;
    try {
      msg = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (isServerMessage(msg)) onServer(msg);
  };
  ws.onopen = () => {
    clearInterval(pingTimer);
    // Pings keep the MV3 worker alive while in a room and feed the clock estimate.
    const ping = () => sendServer(envelope("SYS.PING", { t1: Date.now() }));
    ping();
    pingTimer = setInterval(ping, 20_000);
    sendPresence();
  };
  ws.onclose = (e) => {
    if (socket !== ws) return;
    socket = null;
    clearInterval(pingTimer);
    if (e.code === 1008) {
      // The room ended or our token was revoked; retrying can't help.
      void endSession(ENDED);
    } else if (e.code === 4000) {
      // A newer connection of ours took over (worker restart); it owns the room now.
      state.connection = "idle";
    } else if (state.session) {
      state.connection = "reconnecting";
      retry = setTimeout(connect, backoff(attempt++));
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
    case "ROOM.STATE":
      state.connection = "connected";
      state.mediaMove = null;
      state.notice = null;
      attempt = 0;
      state.participants = msg.payload.participants;
      for (const p of state.participants) order(p.id);
      state.media = msg.payload.media;
      state.playback = msg.payload.playback;
      break;
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
  changed();
  push({ kind: "server", message: msg });
}

function reset() {
  clearTimeout(retry);
  socket?.close(); // onclose ignores it: socket is no longer this one
  socket = null;
  seen.clear();
  attempt = 0;
  Object.assign(state, { participants: [], media: null, playback: null, connection: "idle" });
}

async function startSession(ticket: Session) {
  reset(); // also covers switching rooms from the invite page
  state.session = ticket;
  state.notice = null;
  state.lastRoom = null;
  lastTicket = ticket;
  await chrome.storage.session.set({ session: ticket });
  await chrome.storage.local.set({ lastRoom: { ticket, at: Date.now() } });
  connect();
}

async function endSession(notice: string | null) {
  reset();
  state.session = null;
  state.notice = notice;
  state.lastRoom = null;
  lastTicket = null;
  await chrome.storage.session.remove("session");
  await chrome.storage.local.remove("lastRoom");
  changed();
}

// One request at a time, so a join from the popup and the invite page can't both add a
// participant (resilience audit).
let queue: Promise<unknown> = Promise.resolve();
function handle(req: Request): Promise<Reply> {
  const run = queue.then(() => handleNow(req));
  queue = run.catch(() => {});
  return run;
}

async function handleNow(req: Request): Promise<Reply> {
  await ready;
  try {
    switch (req.kind) {
      case "getState":
        break;
      case "setName": {
        const name = req.name.trim().slice(0, 30);
        if (!name) throw new Error("invalid");
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
        await startSession(await api(`/api/v1/rooms/${code}/join`, { name: state.name }));
        break;
      }
      case "leave":
        sendServer(envelope("ROOM.LEAVE", {})); // revokes our token
        await endSession(null);
        break;
      case "rejoin":
        if (!lastTicket) throw new Error("expired");
        await startSession(lastTicket);
        break;
      case "forgetRoom":
        await endSession(null);
        break;
      case "follow":
        state.following = req.following;
        sendPresence();
        break;
    }
    changed();
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unreachable", state };
  }
}

// Test builds only: lets end-to-end tests cut the connection like a network drop.
if (__MOCK__) Object.assign(globalThis, { watchsyncDropSocket: () => socket?.close() });

chrome.runtime.onMessage.addListener((req: Request, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(req).then(reply);
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id !== chrome.runtime.id) return port.disconnect();
  ports.add(port);
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    if (port !== presencePort) return;
    presencePort = null;
    // A page load (next episode, Open) drops the port for a moment; only report the
    // title as closed if no tab reports again soon, so the room keeps following us.
    tabGone = setTimeout(() => {
      presence = { service: "none", media: null };
      sendPresence();
    }, 3000);
  });
  if (port.name === "tab")
    port.onMessage.addListener((e: TabEvent) => {
      if (e.kind === "playback") {
        const { kind: _, ...update } = e;
        sendServer(envelope("PLAYBACK.UPDATE", update));
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
      clearTimeout(tabGone);
      presencePort = port;
      presence = { service: e.service, media: e.media };
      sendPresence();
    });
  ready.then(() => port.postMessage({ kind: "state", state: stateFor(port) } satisfies Push));
});
