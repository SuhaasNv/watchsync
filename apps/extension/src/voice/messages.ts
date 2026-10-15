// What the voice frame (voice.html) and the background worker say to each other over the
// frame's "voice" port, and what the rest of the extension is told about voice. Every message
// is checked on receipt, like the room protocol's.
import {
  type AnyServerMessage,
  type IceServer,
  isClientMessage,
  isServerMessage,
  isTurnCredentials,
  type VoiceSignalBody,
} from "@watchsync/protocol";

/** Where the microphone stands. off: not asked yet. asking: waiting for Chrome's answer. */
export type MicState = "off" | "asking" | "on" | "blocked";
/** Why it is blocked: Chrome (or the person) said no, the system said no, or there is no mic. */
export type BlockedBy = "chrome" | "system" | "none";
/** open: one press unmutes and the mic stays open. ptt: it is open only while Talk is held. */
export type MicMode = "open" | "ptt";
export type PeerState = "connecting" | "connected" | "failed";

/** What the frame reports about voice: the whole of it, sent whenever any part changes. */
export interface VoiceView {
  /** The voice frame is up and connected to the background worker. */
  frame: boolean;
  mic: MicState;
  blocked: BlockedBy | null;
  /** The mode in force: the person's choice, else what this Chrome can do (DEC-037). */
  mode: MicMode;
  /** My mic is open to the room right now. */
  live: boolean;
  /** People heard speaking right now, by participant id. Mine included. */
  speaking: string[];
  /** The direct connection to each person in voice, by participant id. */
  peers: Record<string, PeerState>;
}

export const NO_VOICE: VoiceView = {
  frame: false,
  mic: "off",
  blocked: null,
  mode: "ptt",
  live: false,
  speaking: [],
  peers: {},
};

/**
 * What a press of Talk means to the frame once the mic is on. "resume": the person used the
 * page, so sound that Chrome held back until then may play (Chrome's autoplay rule).
 */
export type TalkCmd = "enable" | "down" | "up" | "retry" | "resume";
const CMDS: readonly string[] = ["enable", "down", "up", "retry", "resume"];
export const isTalkCmd = (v: unknown): v is TalkCmd => typeof v === "string" && CMDS.includes(v);

/** A person to connect with: in voice, and their WatchSync can talk. */
export interface VoicePerson {
  id: string;
  name: string;
}

/** Background → frame. */
export type VoiceIn =
  /** Who to be connected with now, and who I am. Sent again whenever it changes. */
  | { kind: "room"; you: string; people: VoicePerson[] }
  /** A VOICE.SIGNAL from the room, already checked. */
  | { kind: "signal"; message: AnyServerMessage }
  | { kind: "ice"; iceServers: IceServer[] }
  | { kind: "cmd"; cmd: TalkCmd };

/** Frame → background. The first message is `hello` with the pass the content script loaded it with. */
export type VoiceOut =
  | { kind: "hello"; nonce: string }
  | { kind: "view"; view: VoiceView }
  /** Whether my mic is open to the room: becomes my row's voice state for everyone. */
  | { kind: "state"; state: "muted" | "live" }
  | { kind: "signal"; to: string; signal: VoiceSignalBody }
  /** Ask for TURN credentials (the background owns the room token). */
  | { kind: "needIce" };

const isObject = (v: unknown): v is object => typeof v === "object" && v !== null;
const field = (v: object, k: string): unknown => Reflect.get(v, k);
const isStr = (v: unknown): v is string => typeof v === "string";
const MIC: readonly string[] = ["off", "asking", "on", "blocked"];
const BLOCKED: readonly string[] = ["chrome", "system", "none"];
const PEER: readonly string[] = ["connecting", "connected", "failed"];

export function isVoiceView(v: unknown): v is VoiceView {
  if (!isObject(v)) return false;
  const mic = field(v, "mic");
  const blocked = field(v, "blocked");
  const mode = field(v, "mode");
  const speaking = field(v, "speaking");
  const peers = field(v, "peers");
  if (typeof field(v, "frame") !== "boolean" || typeof field(v, "live") !== "boolean") return false;
  if (!isStr(mic) || !MIC.includes(mic)) return false;
  if (blocked !== null && !(isStr(blocked) && BLOCKED.includes(blocked))) return false;
  if (mode !== "open" && mode !== "ptt") return false;
  if (!Array.isArray(speaking) || speaking.length > 16 || !speaking.every(isStr)) return false;
  if (!isObject(peers) || Array.isArray(peers)) return false;
  const states = Object.values(peers);
  return states.length <= 16 && states.every((s) => isStr(s) && PEER.includes(s));
}

/** The signals a frame may send: the same shapes the room service takes (VoiceSignalBody). */
function isSignalBody(v: unknown): v is VoiceSignalBody {
  // Checked by the protocol's own validator, inside a VOICE.SIGNAL envelope.
  return isClientSignal({ to: "x", signal: v });
}

function isClientSignal(payload: unknown): boolean {
  return isClientMessage({ id: "x", type: "VOICE.SIGNAL", timestamp: 0, payload });
}

export function isVoiceOut(v: unknown): v is VoiceOut {
  if (!isObject(v)) return false;
  const kind = field(v, "kind");
  if (kind === "hello") return isStr(field(v, "nonce"));
  if (kind === "view") return isVoiceView(field(v, "view"));
  if (kind === "state") return field(v, "state") === "muted" || field(v, "state") === "live";
  if (kind === "signal") {
    const to = field(v, "to");
    return isStr(to) && to.length <= 64 && isSignalBody(field(v, "signal"));
  }
  return kind === "needIce";
}

export function isVoiceIn(v: unknown): v is VoiceIn {
  if (!isObject(v)) return false;
  const kind = field(v, "kind");
  if (kind === "room") {
    const people = field(v, "people");
    return (
      isStr(field(v, "you")) &&
      Array.isArray(people) &&
      people.length <= 16 &&
      people.every((p) => isObject(p) && isStr(field(p, "id")) && isStr(field(p, "name")))
    );
  }
  if (kind === "signal") {
    const m = field(v, "message");
    return isServerMessage(m) && m.type === "VOICE.SIGNAL";
  }
  // The same check the room service's credentials pass.
  if (kind === "ice") return isTurnCredentials({ iceServers: field(v, "iceServers"), ttl: 60 });
  return kind === "cmd" && isTalkCmd(field(v, "cmd"));
}
