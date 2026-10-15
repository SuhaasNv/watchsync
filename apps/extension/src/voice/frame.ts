// The voice frame (voice.html): an extension page the content script puts in a hidden iframe on
// the service page. Because it is an extension page, the microphone permission belongs to
// WatchSync and not to the service (US-055). It owns the microphone, the connections to the
// other people and their playback; the background worker owns the room socket and passes the
// set-up messages. Nothing here is recorded or sent anywhere but to the people in the room.
import type { IceServer } from "@watchsync/protocol";
import { blockedBy, MODE_AUTO_KEY, MODE_KEY, micMode, openMic } from "./echo";
import { P2PMesh } from "./mesh";
import {
  type BlockedBy,
  isVoiceIn,
  type MicMode,
  type MicState,
  NO_VOICE,
  type PeerState,
  type TalkCmd,
  type VoiceOut,
  type VoiceView,
} from "./messages";
import { webRtcPeer } from "./peer";
import { SpeakingDetector } from "./speaking";

/** Waiting longer than this for TURN credentials, go on without them (a direct connection). */
const ICE_WAIT_MS = 4000;
/** Ask for credentials again this often; the background keeps them until shortly before they end. */
const ICE_EVERY_MS = 30 * 60 * 1000;

const nonce = location.hash.slice(1);
let port: chrome.runtime.Port | null = null;
let mesh: P2PMesh | null = null;
let you = "";
let servers: readonly IceServer[] = [];
let haveServers = false;
let people: readonly string[] = [];

let mic: MicState = "off";
let blocked: BlockedBy | null = null;
let live = false;
let mode: MicMode = "ptt";
let chosen: unknown;
let found: unknown;
let stream: MediaStream | null = null;
let track: MediaStreamTrack | null = null;
const peers = new Map<string, PeerState>();
const speaking = new Set<string>();
const players = new Map<string, HTMLAudioElement>();
let last = "";
let ownLevel: { stop: () => void } | null = null;
const timers: ReturnType<typeof setTimeout>[] = [];

const out = (m: VoiceOut) => port?.postMessage(m);

function publish() {
  const view: VoiceView = {
    frame: true,
    mic,
    blocked,
    mode,
    live,
    speaking: [...speaking],
    peers: Object.fromEntries(peers),
  };
  const text = JSON.stringify(view);
  if (text === last) return;
  last = text;
  out({ kind: "view", view });
}

function setLive(on: boolean) {
  if (!track || live === on) return;
  live = on;
  track.enabled = on;
  mesh?.setMuted(!on);
  if (!on) setSpeaking(you, false);
  out({ kind: "state", state: on ? "live" : "muted" });
  publish();
}

function setSpeaking(id: string, on: boolean) {
  if (on) speaking.add(id);
  else speaking.delete(id);
  publish();
}

/** Plays (or stops playing) one person's voice. It never goes anywhere else. */
function play(id: string, audio: MediaStream | null) {
  players.get(id)?.remove();
  players.delete(id);
  if (!audio) return;
  const el = new Audio();
  el.autoplay = true;
  el.srcObject = audio;
  document.body.append(el);
  players.set(id, el);
  el.play().catch((e: unknown) => console.debug("watchsync: voice playback", e));
}

/** A press of Talk is the person's own action: playback that was held back may start. */
function resumePlayback() {
  for (const el of players.values()) {
    if (el.paused) el.play().catch((e: unknown) => console.debug("watchsync: voice playback", e));
  }
}

function startMesh() {
  if (mesh || !you) return;
  mesh = new P2PMesh({
    you,
    makePeer: webRtcPeer,
    policy: policy(),
    servers,
    events: {
      signal: (to, signal) => out({ kind: "signal", to, signal }),
      peer(id, state) {
        if (state) peers.set(id, state);
        else peers.delete(id);
        publish();
      },
      speaking: setSpeaking,
      audio: play,
    },
  });
  if (track) mesh.setMic(track);
}

/** Which connections are tried. "relay" forces TURN, to test that path (dev and test builds). */
let injectedPolicy: RTCIceTransportPolicy = "all";
const policy = () => injectedPolicy;

function connectPeers() {
  if (haveServers) mesh?.setPeers(people);
}

function onIn(raw: unknown) {
  if (!isVoiceIn(raw)) return;
  if (raw.kind === "room") {
    you = raw.you;
    people = raw.people.map((p) => p.id);
    startMesh();
    connectPeers();
  } else if (raw.kind === "ice") {
    servers = raw.iceServers;
    haveServers = true;
    mesh?.setIceServers(servers);
    connectPeers();
  } else if (raw.kind === "signal" && raw.message.type === "VOICE.SIGNAL") {
    const { from, signal } = raw.message.payload;
    mesh?.receive(from, signal);
  } else if (raw.kind === "cmd") {
    resumePlayback();
    onCmd(raw.cmd);
  }
}

function onCmd(cmd: TalkCmd) {
  if (cmd === "resume") return; // resumePlayback already ran
  if (cmd === "retry") return mesh?.retry();
  if (cmd === "enable") return void enableMic();
  if (mic !== "on") return;
  if (mode === "open") {
    if (cmd === "down") setLive(!live);
  } else setLive(cmd === "down");
}

async function enableMic() {
  if (mic === "on" || mic === "asking") return;
  mic = "asking";
  blocked = null;
  publish();
  let all = false;
  try {
    ({ stream, all } = await openMic());
  } catch (e) {
    blocked = blockedBy(e);
    mic = blocked ? "blocked" : "off";
    publish();
    return;
  }
  const t = stream.getAudioTracks()[0];
  if (!t) return releaseMic();
  track = t;
  track.enabled = false; // everyone starts muted
  track.addEventListener("ended", releaseMic);
  found = all ? "open" : "ptt";
  chrome.storage.local.set({ [MODE_AUTO_KEY]: found }).catch(() => {});
  mode = micMode(chosen, found);
  mic = "on";
  mesh?.setMic(track);
  watchOwnLevel(stream);
  publish();
  if (mode === "open")
    setLive(true); // they pressed Talk: they are live
  else out({ kind: "state", state: "muted" });
}

/** The mic went away (unplugged, or another app took it): back to muted, ready to ask again. */
function releaseMic() {
  ownLevel?.stop();
  ownLevel = null;
  track?.removeEventListener("ended", releaseMic);
  for (const t of stream?.getTracks() ?? []) t.stop();
  stream = null;
  track = null;
  mesh?.setMic(null);
  const wasLive = live;
  live = false;
  mic = "off";
  setSpeaking(you, false);
  if (wasLive) out({ kind: "state", state: "muted" });
  publish();
}

/** My own level from the mic itself, for the ring on my face (only while I am live). */
function watchOwnLevel(s: MediaStream) {
  const ctx = new AudioContext();
  ctx.resume().catch((e: unknown) => console.debug("watchsync: voice level", e));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(s).connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  const detector = new SpeakingDetector();
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const level = live ? Math.sqrt(sum / data.length) : null;
    if (detector.feed(level, performance.now())) setSpeaking(you, detector.speaking);
  }, 100);
  ownLevel = {
    stop() {
      clearInterval(timer);
      ctx.close().catch((e: unknown) => console.debug("watchsync: voice level", e));
    },
  };
}

function onStorage(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area !== "local") return;
  const choice = changes[MODE_KEY];
  if (choice) chosen = choice.newValue;
  if (choice || changes[MODE_AUTO_KEY]) {
    const next = micMode(chosen, found);
    // Open to push-to-talk: never leave the mic open under a mode that says it closes.
    if (next !== mode) {
      mode = next;
      if (mode === "ptt") setLive(false);
      publish();
    }
  }
}

function connect() {
  if (!nonce || !chrome.runtime?.id) return;
  port = chrome.runtime.connect({ name: "voice" });
  port.onMessage.addListener(onIn);
  port.onDisconnect.addListener(() => {
    port = null;
    leave();
  });
  out({ kind: "hello", nonce });
  out({ kind: "state", state: "muted" }); // in voice, listening: everyone starts muted
  out({ kind: "needIce" });
  timers.push(
    setTimeout(() => {
      haveServers = true; // credentials never came: connect directly
      connectPeers();
    }, ICE_WAIT_MS),
  );
  const renew = setInterval(() => out({ kind: "needIce" }), ICE_EVERY_MS);
  timers.push(renew);
  publish();
}

/** Everything goes: connections, microphone, playback, timers. */
function leave() {
  for (const t of timers.splice(0)) {
    clearTimeout(t);
    clearInterval(t);
  }
  mesh?.close();
  mesh = null;
  releaseMic();
  for (const id of [...players.keys()]) play(id, null);
  chrome.storage.onChanged.removeListener(onStorage);
}

async function start() {
  const got = await chrome.storage.local.get([MODE_KEY, MODE_AUTO_KEY, "voicePolicy"]);
  chosen = got[MODE_KEY];
  found = got[MODE_AUTO_KEY];
  mode = micMode(chosen, found);
  // Dev and test builds can force every connection through TURN: set voicePolicy to "relay".
  if ((__CHANNEL__ === "dev" || __MOCK__) && got.voicePolicy === "relay") injectedPolicy = "relay";
  chrome.storage.onChanged.addListener(onStorage);
  window.addEventListener("pagehide", leave);
  connect();
  if (__MOCK__) {
    Object.assign(window, {
      watchsyncVoice: {
        view: () => ({ ...NO_VOICE, mic, live, peers: Object.fromEntries(peers), mode }),
        heard: () => mesh?.heard() ?? Promise.resolve({}),
        policy: () => injectedPolicy,
        playing: () => [...players.values()].map((el) => !el.paused),
      },
    });
  }
}

start().catch((e: unknown) => console.debug("watchsync: voice frame", e));
