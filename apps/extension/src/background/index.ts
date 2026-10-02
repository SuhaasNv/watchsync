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
};
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
function changed() {
  push({ kind: "state", state });
}

async function restore() {
  const { name } = await chrome.storage.local.get("name");
  const { session } = await chrome.storage.session.get("session");
  state.name = typeof name === "string" ? name : null;
  if (session) {
    state.session = session as Session;
    connect();
  }
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

function connect() {
  const s = state.session;
  if (!s) return;
  state.connection = state.connection === "connected" ? "reconnecting" : "connecting";
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
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    clearInterval(pingTimer);
    state.connection = "idle";
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
    case "ROOM.MEDIA":
      state.media = msg.payload.media;
      break;
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

async function startSession(ticket: Session) {
  socket?.close(); // switching rooms from the invite page
  socket = null;
  seen.clear();
  Object.assign(state, { participants: [], media: null, playback: null });
  state.session = ticket;
  await chrome.storage.session.set({ session: ticket });
  connect();
}

async function handle(req: Request): Promise<Reply> {
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
      case "follow":
        throw new Error("unsupported");
    }
    changed();
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unreachable", state };
  }
}

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
      if (e.kind !== "presence") return;
      clearTimeout(tabGone);
      presencePort = port;
      presence = { service: e.service, media: e.media };
      sendPresence();
    });
  ready.then(() => port.postMessage({ kind: "state", state } satisfies Push));
});
