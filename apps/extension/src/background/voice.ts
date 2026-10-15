// Voice, from the worker's side (US-055). The voice frame (voice.html, in a hidden frame on the
// service page) owns the microphone and the connections between browsers; the worker owns the
// room socket, so it passes the frame's set-up messages to the room and the room's to the
// frame, hands it TURN credentials, and keeps the room's row of this person up to date. Set-up
// messages hold network addresses: they go to the frame and nowhere else, and are never logged.

import {
  type AnyServerMessage,
  type ClientMessageOf,
  envelope,
  type IceServer,
  isClientMessage,
} from "@watchsync/protocol";
import type { Push } from "../shared/messages";
import {
  isVoiceOut,
  NO_VOICE,
  type TalkCmd,
  type VoiceIn,
  type VoicePerson,
  type VoiceView,
} from "../voice/messages";
import { fetchTurn, type TurnResult, turnCache } from "../voice/turn";
import { ChatFrames } from "./chat-frames";
import { sendServer } from "./connection";
import { API, ports, push, state } from "./state";

/** Used when the room has no TURN: a plain public STUN server, and then a direct connection. */
const FALLBACK: IceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478"] }];
/** A press that came before the frame was up is held this long. */
const HOLD_MS = 5000;

export const voiceFrames = new ChatFrames(undefined, undefined, "/voice.html");
const turn = turnCache(async (code): Promise<TurnResult> => {
  const token = state.session?.code === code ? state.session.token : "";
  return token ? fetchTurn(API, { code, token }) : { ok: false, reason: "failed" };
});

let frame: chrome.runtime.Port | null = null;
let frameTab: number | undefined;
/** Whether the frame says this person's mic is open: what the room's row should read. */
let rowState: "muted" | "live" = "muted";
let view: VoiceView = NO_VOICE;
let lastPeople = "";
let held: { cmd: TalkCmd; at: number } | null = null;

export const voiceView = () => view;
/** The tab whose page hosts the voice frame, if any. */
export const voiceTab = () => frameTab;

function setView(next: VoiceView) {
  if (JSON.stringify(next) === JSON.stringify(view)) return;
  view = next;
  push({ kind: "voice", view });
}

const toFrame = (msg: VoiceIn) => frame?.postMessage(msg);

function sendRow(voice: "off" | "muted" | "live") {
  const msg = envelope<ClientMessageOf<"VOICE.STATE">>("VOICE.STATE", { state: voice });
  if (isClientMessage(msg)) sendServer(msg);
}

/** Who the frame should be connected with: in voice, connected, and able to talk. */
function peopleNow(): VoicePerson[] {
  const me = state.session?.participantId;
  return state.participants
    .filter((p) => p.id !== me && p.connected && p.canTalk === true)
    .filter((p) => p.voice !== undefined && p.voice !== "off")
    .map((p) => ({ id: p.id, name: p.name }));
}

function sendRoom(force = false) {
  const you = state.session?.participantId;
  if (!frame || !you) return;
  const people = peopleNow();
  const text = JSON.stringify(people);
  if (!force && text === lastPeople) return;
  lastPeople = text;
  toFrame({ kind: "room", you, people });
}

/** The room's own picture of me, so a reconnect or a restarted room service learns it again. */
function myRow(): "off" | "muted" | "live" {
  return state.participants.find((p) => p.id === state.session?.participantId)?.voice ?? "off";
}

/** The participant list changed (a state, a join, a mute): tell the frame, and fix my row. */
export function voiceRoomChanged(opened: boolean) {
  sendRoom();
  const want = frame ? rowState : "off";
  if (opened && myRow() !== want) sendRow(want);
}

/** A VOICE.SIGNAL from the room: to the frame only. */
export function voiceSignal(message: AnyServerMessage) {
  if (message.type === "VOICE.SIGNAL") toFrame({ kind: "signal", message });
}

/** Talk was pressed. Held for a moment if the frame is still starting. */
export function voiceCommand(cmd: TalkCmd) {
  if (frame) return toFrame({ kind: "cmd", cmd });
  held = { cmd, at: Date.now() };
}

/** Leaving the room: forget credentials and the frame's report. The frame goes with the page. */
export function voiceReset() {
  turn.clear();
  lastPeople = "";
  held = null;
  setView(NO_VOICE);
}

async function sendIce() {
  const code = state.session?.code;
  if (!code) return;
  const r = await turn.get(code);
  toFrame({ kind: "ice", iceServers: r.ok ? r.iceServers : FALLBACK });
}

/** A voice frame's port: served only with the pass its tab's content script was given. */
export function admitVoiceFrame(port: chrome.runtime.Port) {
  const silent = setTimeout(() => port.disconnect(), 5000);
  const hello = (e: unknown) => {
    clearTimeout(silent);
    port.onMessage.removeListener(hello);
    const pass = voiceFrames.admit(port.sender, e);
    if (!pass) return port.disconnect();
    const tabId = port.sender?.tab?.id;
    // One voice frame at a time: a newer one (another tab, a reload) takes over.
    const old = frame;
    frame = port;
    frameTab = tabId;
    old?.disconnect();
    rowState = "muted";
    lastPeople = "";
    toTab(tabId, { kind: "voiceFrameReady", frame: pass });
    port.onDisconnect.addListener(() => {
      if (frame !== port) return; // replaced by a newer frame
      frame = null;
      frameTab = undefined;
      lastPeople = "";
      setView(NO_VOICE);
      sendRow("off"); // the others close their connections to me
      toTab(tabId, { kind: "voiceFrameLost", frame: pass });
    });
    port.onMessage.addListener(onFrame);
    sendRoom(true);
    if (held && Date.now() - held.at < HOLD_MS) toFrame({ kind: "cmd", cmd: held.cmd });
    held = null;
  };
  port.onMessage.addListener(hello);
}

function onFrame(m: unknown) {
  if (!isVoiceOut(m)) return;
  if (m.kind === "view") return setView(m.view);
  if (m.kind === "state") {
    rowState = m.state;
    return sendRow(m.state);
  }
  if (m.kind === "needIce") return void sendIce().catch((e: unknown) => console.debug("ice", e));
  if (m.kind === "signal") {
    const msg = envelope<ClientMessageOf<"VOICE.SIGNAL">>("VOICE.SIGNAL", {
      to: m.to,
      signal: m.signal,
    });
    if (isClientMessage(msg)) sendServer(msg);
  }
}

/** Tells the content script of one tab, and no other. */
function toTab(tabId: number | undefined, msg: Push) {
  if (tabId === undefined) return;
  for (const p of ports) if (p.name === "tab" && p.sender?.tab?.id === tabId) p.postMessage(msg);
}

/** The Talk key or button in the popup or the chat frame: the tab hosting voice acts on it. */
export function talkEdge(edge: "down" | "up", tab: number | undefined) {
  toTab(tab ?? frameTab, { kind: "talk", edge });
}
