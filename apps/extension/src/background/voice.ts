// Voice, from the worker's side (US-055). The voice document (voice.html, a Chrome offscreen
// document the worker opens while voice is on offer and closes when it is not) owns the
// microphone, the connections between browsers and the friends' playback, so the microphone
// permission belongs to WatchSync and not to the streaming site. The worker owns the room
// socket, so it passes the document's set-up messages to the room and the room's to the
// document, hands it TURN credentials and the person's settings, and keeps the room's row of
// this person up to date. Set-up messages hold network addresses: they go to the document and
// nowhere else, and are never logged.

import {
  type AnyServerMessage,
  type ClientMessageOf,
  envelope,
  type IceServer,
  isClientMessage,
} from "@watchsync/protocol";
import type { Push } from "../shared/messages";
import { voiceOffer } from "../voice/capability";
import { deviceIdOf, MIC_ID_KEY, MODE_AUTO_KEY, MODE_KEY } from "../voice/echo";
import { MIC_PAGE, micPageUrl } from "../voice/help";
import {
  type BlockedBy,
  isMode,
  isVoiceOut,
  NO_VOICE,
  type Probe,
  type TalkCmd,
  type VoiceIn,
  type VoicePerson,
  type VoiceView,
} from "../voice/messages";
import { fetchTurn, type TurnResult, turnCache } from "../voice/turn";
import { sendServer } from "./connection";
import { API, ports, push, state } from "./state";

/** Used when the room has no TURN: a plain public STUN server, and then a direct connection. */
const FALLBACK: IceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478"] }];
/** A press that came before the voice document was up is held this long. */
const HOLD_MS = 5000;
/** The voice document. */
const DOC = "voice.html";
/** Dev and test builds can send every connection through TURN: set voicePolicy to "relay". */
const POLICY_KEY = "voicePolicy";

const turn = turnCache(async (code): Promise<TurnResult> => {
  const token = state.session?.code === code ? state.session.token : "";
  return token ? fetchTurn(API, { code, token }) : { ok: false, reason: "failed" };
});

let doc: chrome.runtime.Port | null = null;
/** Whether the voice document should exist now, and the chain that opens and closes it. */
let wanted = false;
let work: Promise<void> = Promise.resolve();
/** One of this person's tabs is on a title: voice runs only while watching. */
let watching = false;
/** That tab: the film it plays is lowered while friends talk (US-058). */
let filmTab: number | undefined;
/** The tab that last pressed Talk: where the microphone page sends the person back to. */
let askTab: number | undefined;
/** Whether the document says this person's mic is open: what the room's row should read. */
let rowState: "muted" | "live" = "muted";
let view: VoiceView = NO_VOICE;
let lastPeople = "";
let held: { cmd: TalkCmd; at: number } | null = null;

export const voiceView = () => view;

function setView(next: VoiceView) {
  if (JSON.stringify(next) === JSON.stringify(view)) return;
  view = next;
  push({ kind: "voice", view });
}

const toDoc = (msg: VoiceIn) => doc?.postMessage(msg);

function sendRow(voice: "off" | "muted" | "live") {
  const msg = envelope<ClientMessageOf<"VOICE.STATE">>("VOICE.STATE", { state: voice });
  if (isClientMessage(msg)) sendServer(msg);
}

/** Who the document should be connected with: in voice, connected, and able to talk. */
function peopleNow(): VoicePerson[] {
  const me = state.session?.participantId;
  return state.participants
    .filter((p) => p.id !== me && p.connected && p.canTalk === true)
    .filter((p) => p.voice !== undefined && p.voice !== "off")
    .map((p) => ({ id: p.id, name: p.name }));
}

function sendRoom(force = false) {
  const you = state.session?.participantId;
  if (!doc || !you) return;
  const people = peopleNow();
  const text = JSON.stringify(people);
  if (!force && text === lastPeople) return;
  lastPeople = text;
  toDoc({ kind: "room", you, people });
}

/** The person's voice settings: an offscreen document has no storage of its own. */
export async function sendSettings() {
  const got = await chrome.storage.local.get([MODE_KEY, MODE_AUTO_KEY, POLICY_KEY, MIC_ID_KEY]);
  const mode = (v: unknown) => (isMode(v) ? v : null);
  toDoc({
    kind: "settings",
    chosen: mode(got[MODE_KEY]),
    found: mode(got[MODE_AUTO_KEY]),
    relay: (__CHANNEL__ === "dev" || __MOCK__) && got[POLICY_KEY] === "relay",
    micId: deviceIdOf(got[MIC_ID_KEY]),
  });
}

/** A change to a voice setting (registered with the worker's other listeners). */
export function voiceSettingsChanged(
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) {
  if (
    area !== "local" ||
    !(
      MODE_KEY in changes ||
      MODE_AUTO_KEY in changes ||
      POLICY_KEY in changes ||
      MIC_ID_KEY in changes
    )
  )
    return;
  sendSettings().catch((e: unknown) => console.debug("watchsync: voice settings", e));
}

/** The room's own picture of me, so a reconnect or a restarted room service learns it again. */
function myRow(): "off" | "muted" | "live" {
  return state.participants.find((p) => p.id === state.session?.participantId)?.voice ?? "off";
}

/** Voice runs in a room that offers it, while one of this person's tabs is on a title. */
function wantVoice(): boolean {
  return (
    state.session !== null &&
    state.connection !== "idle" &&
    watching &&
    voiceOffer(state.participants) === "ok"
  );
}

async function openDoc() {
  if (!wanted) return;
  const create = () =>
    chrome.offscreen.createDocument({
      url: DOC,
      reasons: [
        chrome.offscreen.Reason.USER_MEDIA,
        chrome.offscreen.Reason.WEB_RTC,
        chrome.offscreen.Reason.AUDIO_PLAYBACK,
      ],
      justification:
        "Keeps the microphone, the connections to friends and their voices playing while the film is watched.",
    });
  try {
    await create();
  } catch {
    // One from before a worker restart may still be there: replace it.
    await chrome.offscreen.closeDocument().catch(() => {});
    await create();
  }
}

async function closeDoc() {
  if (wanted) return;
  await chrome.offscreen.closeDocument().catch(() => {}); // none open: nothing to close
}

/** Opens the voice document when voice is on offer and closes it when it is not. */
function sync() {
  const want = wantVoice();
  if (want === wanted) return;
  wanted = want;
  work = work
    .then(want ? openDoc : closeDoc)
    .catch((e: unknown) => console.debug("watchsync: voice document", e));
}

/** One of this person's tabs is on a title, or none is (the presence changed). */
export function voiceWatching(on: boolean, tab: number | undefined) {
  watching = on;
  if (filmTab !== tab) toTab(filmTab, { kind: "duck", on: false }); // the old tab's film comes back
  filmTab = tab;
  sync();
}

/** The participant list changed (a state, a join, a mute): tell the document, and fix my row. */
export function voiceRoomChanged(opened: boolean) {
  sync();
  sendRoom();
  const want = doc ? rowState : "off";
  if (opened && myRow() !== want) sendRow(want);
}

/** A VOICE.SIGNAL from the room: to the document only. */
export function voiceSignal(message: AnyServerMessage) {
  if (message.type === "VOICE.SIGNAL") toDoc({ kind: "signal", message });
}

/** Talk was pressed in a tab. Held for a moment if the document is still starting. */
export function voiceCommand(cmd: TalkCmd, tab?: number) {
  askTab = tab;
  if (doc) return toDoc({ kind: "cmd", cmd });
  held = { cmd, at: Date.now() };
}

/** Leaving the room (the connection is already idle): forget credentials, close the document. */
export function voiceReset() {
  turn.clear();
  lastPeople = "";
  held = null;
  setView(NO_VOICE);
  toTab(filmTab, { kind: "duck", on: false }); // the film comes back at once
  sync();
}

async function sendIce() {
  const code = state.session?.code;
  if (!code) return;
  const r = await turn.get(code);
  toDoc({ kind: "ice", iceServers: r.ok ? r.iceServers : FALLBACK });
}

/** The voice document's port: served only from our own offscreen document, never from a tab. */
export function admitVoiceDoc(port: chrome.runtime.Port) {
  if (port.sender?.tab || port.sender?.url !== chrome.runtime.getURL(DOC)) return port.disconnect();
  // One voice document at a time: a newer one takes over.
  const old = doc;
  doc = port;
  old?.disconnect();
  rowState = "muted";
  lastPeople = "";
  port.onDisconnect.addListener(() => {
    if (doc !== port) return; // replaced by a newer document
    doc = null;
    lastPeople = "";
    toTab(filmTab, { kind: "duck", on: false }); // no more words are coming
    setView(NO_VOICE);
    sendRow("off"); // the others close their connections to me
  });
  port.onMessage.addListener(onDoc);
  // The settings first: the connections it makes depend on them.
  sendSettings()
    .then(() => {
      if (doc !== port) return;
      if (testers > 0) toDoc({ kind: "testing", on: true });
      sendRoom(true);
      if (held && Date.now() - held.at < HOLD_MS) toDoc({ kind: "cmd", cmd: held.cmd });
      held = null;
    })
    .catch((e: unknown) => console.debug("watchsync: voice settings", e));
}

function onDoc(m: unknown) {
  if (!isVoiceOut(m)) return;
  if (m.kind === "view") return setView(m.view);
  if (m.kind === "state") {
    rowState = m.state;
    return sendRow(m.state);
  }
  if (m.kind === "duck") return toTab(filmTab, { kind: "duck", on: true });
  if (m.kind === "needIce") return void sendIce().catch((e: unknown) => console.debug("ice", e));
  if (m.kind === "found")
    return void chrome.storage.local
      .set({ [MODE_AUTO_KEY]: m.mode })
      .catch((e: unknown) => console.debug("watchsync: voice mode", e));
  if (m.kind === "needPermission")
    return void openMicPage("ask", askTab).catch((e: unknown) =>
      console.debug("watchsync: mic page", e),
    );
  if (m.kind === "probed") return probes.get(m.id)?.(m.value);
  if (m.kind === "signal") {
    const msg = envelope<ClientMessageOf<"VOICE.SIGNAL">>("VOICE.SIGNAL", {
      to: m.to,
      signal: m.signal,
    });
    if (isClientMessage(msg)) sendServer(msg);
  }
}

/** The tabs showing the microphone page, by what they are for. */
const micPages = new Map<"ask" | "test", number>();

/**
 * Opens the page that asks Chrome for the microphone ("ask") or tests it ("test"), as a tab of
 * its own, and sends the person back to `back` when it is done. One of each at a time: a
 * second press brings the open one forward.
 */
export async function openMicPage(mode: "ask" | "test", back: number | undefined) {
  const open = micPages.get(mode);
  const there = open === undefined ? null : await chrome.tabs.get(open).catch(() => null);
  if (there?.id !== undefined) {
    await chrome.tabs.update(there.id, { active: true });
    return;
  }
  const tab = await chrome.tabs.create({ url: micPageUrl(chrome.runtime.getURL(""), mode, back) });
  if (tab.id !== undefined) micPages.set(mode, tab.id);
}

/** How many mic tests are open. While one is, this person's mic stays muted (US-134). */
let testers = 0;

/**
 * A mic test tab's port, open for as long as the test is: a test never transmits, so the voice
 * document keeps this person muted while it lasts. Only our own microphone page may connect.
 */
export function admitMicTest(port: chrome.runtime.Port) {
  const ours = port.sender?.tab && port.sender.url?.startsWith(chrome.runtime.getURL(MIC_PAGE));
  if (!ours) return port.disconnect();
  testers += 1;
  toDoc({ kind: "testing", on: true });
  port.onDisconnect.addListener(() => {
    testers -= 1;
    toDoc({ kind: "testing", on: testers > 0 });
  });
}

/** The microphone page asked Chrome: open the mic (null) or say why not. */
export function voiceMicAnswer(by: BlockedBy | null) {
  toDoc({ kind: "micAnswer", by });
}

/** Tells the content script of one tab, and no other. */
function toTab(tabId: number | undefined, msg: Push) {
  if (tabId === undefined) return;
  for (const p of ports) if (p.name === "tab" && p.sender?.tab?.id === tabId) p.postMessage(msg);
}

/** The Talk key or button in the popup or the chat frame: the tab given acts on it. */
export function talkEdge(edge: "down" | "up", tab: number | undefined) {
  toTab(tab, { kind: "talk", edge });
}

// Test builds only: lets end-to-end tests read what the voice document hears and plays, and
// the view it last reported.
const probes = new Map<number, (value: unknown) => void>();
if (__MOCK__) {
  let ids = 0;
  Object.assign(globalThis, {
    watchsyncVoiceView: () => view,
    watchsyncVoiceProbe: (what: Probe) =>
      new Promise<unknown>((resolve) => {
        const id = ++ids;
        probes.set(id, resolve);
        toDoc({ kind: "probe", id, what });
        setTimeout(() => resolve(null), 5000);
      }),
  });
}
