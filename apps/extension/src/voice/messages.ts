// What the voice document (voice.html, a Chrome offscreen document) and the background worker
// say to each other over its "voice" port, and what the rest of the extension is told about
// voice. Every message is checked on receipt, like the room protocol's.
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

/** What the voice document reports about voice: the whole of it, sent whenever any part changes. */
export interface VoiceView {
  /** The voice document is up and connected to the background worker. */
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

/** What a press of Talk means to the voice document once the mic is on. */
export type TalkCmd = "enable" | "down" | "up" | "retry";
const CMDS: readonly string[] = ["enable", "down", "up", "retry"];
export const isTalkCmd = (v: unknown): v is TalkCmd => typeof v === "string" && CMDS.includes(v);

/** A person to connect with: in voice, and their WatchSync can talk. */
export interface VoicePerson {
  id: string;
  name: string;
}

/** What a test build may ask the voice document (the answers are not part of the product). */
export type Probe = "heard" | "policy" | "playing" | "mic";
const PROBES: readonly string[] = ["heard", "policy", "playing", "mic"];

/** Background → voice document. */
export type VoiceIn =
  /** Who to be connected with now, and who I am. Sent again whenever it changes. */
  | { kind: "room"; you: string; people: VoicePerson[] }
  /** A VOICE.SIGNAL from the room, already checked. */
  | { kind: "signal"; message: AnyServerMessage }
  | { kind: "ice"; iceServers: IceServer[] }
  | { kind: "cmd"; cmd: TalkCmd }
  /** The microphone page's answer: null, the mic is allowed (open it); else why it is blocked. */
  | { kind: "micAnswer"; by: BlockedBy | null }
  /**
   * The person's voice settings, read from storage by the worker: an offscreen document has no
   * chrome.storage of its own. Sent first, and again whenever one changes.
   */
  | {
      kind: "settings";
      /** The mode the person chose, else null. */
      chosen: MicMode | null;
      /** The mode this Chrome was found to manage, else null. */
      found: MicMode | null;
      /** relay: send every connection through TURN (dev and test builds only). */
      relay: boolean;
      /** The microphone picked in the mic test, else null (the system's). */
      micId: string | null;
    }
  /** The mic test is open (on) or closed: the mic stays muted, and unheard, while it is. */
  | { kind: "testing"; on: boolean }
  /** Test builds only. */
  | { kind: "probe"; id: number; what: Probe };

/** Voice document → background. */
export type VoiceOut =
  | { kind: "view"; view: VoiceView }
  /** Whether my mic is open to the room: becomes my row's voice state for everyone. */
  | { kind: "state"; state: "muted" | "live" }
  | { kind: "signal"; to: string; signal: VoiceSignalBody }
  /** Ask for TURN credentials (the background owns the room token). */
  | { kind: "needIce" }
  /** What this Chrome was found to manage (DEC-037): the worker saves it. */
  | { kind: "found"; mode: MicMode }
  /** Chrome has not been asked yet, and an offscreen document can't ask: open the microphone page. */
  | { kind: "needPermission" }
  /** The answer to a probe (test builds only). */
  | { kind: "probed"; id: number; value: unknown };

const isObject = (v: unknown): v is object => typeof v === "object" && v !== null;
const field = (v: object, k: string): unknown => Reflect.get(v, k);
const isStr = (v: unknown): v is string => typeof v === "string";
const MIC: readonly string[] = ["off", "asking", "on", "blocked"];
const BLOCKED: readonly string[] = ["chrome", "system", "none"];
const PEER: readonly string[] = ["connecting", "connected", "failed"];

export const isMode = (v: unknown): v is MicMode => v === "open" || v === "ptt";

/** A reason from the microphone page, or null for "allowed". */
export const isBlockedBy = (v: unknown): v is BlockedBy | null =>
  v === null || (isStr(v) && BLOCKED.includes(v));

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
  if (kind === "view") return isVoiceView(field(v, "view"));
  if (kind === "state") return field(v, "state") === "muted" || field(v, "state") === "live";
  if (kind === "signal") {
    const to = field(v, "to");
    return isStr(to) && to.length <= 64 && isSignalBody(field(v, "signal"));
  }
  if (kind === "probed") return Number.isInteger(field(v, "id"));
  if (kind === "found") return isMode(field(v, "mode"));
  return kind === "needIce" || kind === "needPermission";
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
  if (kind === "micAnswer") return isBlockedBy(field(v, "by"));
  if (kind === "settings") {
    const mode = (k: string) => field(v, k) === null || isMode(field(v, k));
    const id = field(v, "micId");
    const idOk = id === null || (isStr(id) && id.length > 0 && id.length <= 512);
    return mode("chosen") && mode("found") && typeof field(v, "relay") === "boolean" && idOk;
  }
  if (kind === "testing") return typeof field(v, "on") === "boolean";
  if (kind === "probe") {
    const what = field(v, "what");
    return Number.isInteger(field(v, "id")) && isStr(what) && PROBES.includes(what);
  }
  return kind === "cmd" && isTalkCmd(field(v, "cmd"));
}
