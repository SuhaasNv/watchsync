// Owns the room: REST calls, the WebSocket, and fan-out to the popup and the tab.
import {
  type AnyClientMessage,
  type AnyServerMessage,
  envelope,
  isRoomTicket,
  isServerMessage,
} from "@watchsync/protocol";
import { bestSample, type ClockSample, clockSample } from "@watchsync/sync-engine";
import type { AppState, Push, Reply, Request, Session } from "../shared/messages";

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
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    clearInterval(pingTimer);
    state.connection = "idle";
    changed();
  };
}

function onServer(msg: AnyServerMessage) {
  switch (msg.type) {
    case "ROOM.STATE":
      state.connection = "connected";
      state.participants = msg.payload.participants;
      state.media = msg.payload.media;
      state.playback = msg.payload.playback;
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
      case "join":
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
  port.onDisconnect.addListener(() => ports.delete(port));
  ready.then(() => port.postMessage({ kind: "state", state } satisfies Push));
});
