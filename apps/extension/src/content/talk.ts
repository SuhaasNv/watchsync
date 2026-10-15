// What Talk does on the page (US-055): the button in the pill, the first-press sheet, and the
// notices about voice. The voice document (an offscreen document the background worker runs)
// holds the mic and the connections; this decides what a press means from the room and from
// what the document reports. Voice is offered only when every person's WatchSync can talk,
// and for up to four people.
import type { Participant } from "@watchsync/protocol";
import type { AppState, Edge, TabEvent } from "../shared/messages";
import { joinNames, updateToTalk, VOICE_MAX, voiceOffer } from "../voice/capability";
import { MODE_KEY } from "../voice/echo";
import { detectOs, micHelp } from "../voice/help";
import { NO_VOICE, type TalkCmd, type VoiceView } from "../voice/messages";
import { talkWords } from "../voice/words";
import { closeSheet, notice, type PillVoice, showSheet, toast } from "./overlay";

/** Saved in chrome.storage.local: the first-press sheet has been answered, once ever. */
const SHEET_KEY = "voiceSheetSeen";
/** Likewise: the push-to-talk hint, and the first "You're live", have been shown once. */
const HINT_KEY = "voiceHintSeen";
const LIVE_KEY = "voiceLiveSeen";
/** The room that was last told "Voice is ready", so a page load doesn't say it again. */
const READY_KEY = "voiceReadyFor";
/** A connection still being set up this long after the mic opened is worth saying. */
const SLOW_MS = 1500;

let room: AppState | null = null;
let view: VoiceView = NO_VOICE;
let post: (e: TabEvent) => void = () => {};
let redraw: () => void = () => {};
let sheetSeen = false;
let slow: ReturnType<typeof setTimeout> | undefined;
/** Rooms (by code) already told "Voice is ready", and people already told "couldn't connect". */
let toldReady: string | null = null;
const toldFailed = new Set<string>();
const toldConnecting = new Set<string>();

let hintSeen = false;
let liveSeen = false;
let chosenMode = false;
chrome.storage.local
  .get([SHEET_KEY, HINT_KEY, LIVE_KEY, READY_KEY, MODE_KEY])
  .then((got) => {
    sheetSeen = got[SHEET_KEY] === true;
    hintSeen = got[HINT_KEY] === true;
    liveSeen = got[LIVE_KEY] === true;
    chosenMode = got[MODE_KEY] === "open" || got[MODE_KEY] === "ptt";
    if (typeof got[READY_KEY] === "string") toldReady = got[READY_KEY];
  })
  .catch(() => {});
// The person's own choice of mic mode, in the popup: no default hint for a choice made.
chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[MODE_KEY];
  if (area === "local" && change) {
    chosenMode = change.newValue === "open" || change.newValue === "ptt";
  }
});

/** The tab's connection to the background, and how to redraw the pill when voice changes. */
export function initTalk(env: { post: (e: TabEvent) => void; redraw: () => void }) {
  post = env.post;
  redraw = env.redraw;
}

const others = (): Participant[] =>
  room?.participants.filter((p) => p.id !== room?.session?.participantId && p.connected) ?? [];

const names = (people: readonly Participant[]) =>
  joinNames(people.map((p) => p.name)) || "the room";

/** The room changed: out of a room, the sheets and notices about voice go. */
export function talkRoom(next: AppState | null, hasTitle: boolean) {
  room = next;
  const live = next?.session != null && next.connection !== "idle" && hasTitle;
  if (!live) {
    closeSheet("talk");
    toldReady = null;
    toldBlocked = false;
    closeSheet("mic-help");
    toldFailed.clear();
    toldConnecting.clear();
  }
  checkFailures();
}

/** The voice document reported. */
export function talkView(next: VoiceView) {
  const before = view;
  view = next;
  if (next.mic === "blocked" && before.mic !== "blocked") sayBlocked();
  if (next.mic === "on") closeSheet("mic-help"); // fixed: Talk worked, no reload
  if (next.frame && !before.frame) sayReady();
  if (next.mic === "on" && before.mic !== "on") sayHint();
  if (next.live && !before.live) sayLive();
  // Open mic stays open until it is closed: say so for as long as it is. Holding to talk
  // shows on the button itself.
  notice("live", next.live && next.mode === "open" ? "You're live" : null, {
    icon: "live",
    tone: "ok",
  });
  watchConnecting();
  checkFailures();
  redraw();
}

/**
 * Chrome (or the system) said no (US-057). The first time: one line and one way to the steps.
 * Pressing Talk again and being refused again: the steps at once. Sync and chat go on.
 */
let toldBlocked = false;
function sayBlocked() {
  if (view.blocked === "none") toldBlocked = true; // nothing the settings can do: the steps say so
  if (toldBlocked) return showHelp();
  toldBlocked = true;
  toast("Chrome blocked your microphone.", 10_000, { icon: "alert", tone: "warn" }, [
    { label: "Show me how", primary: true, run: showHelp },
  ]);
}

/** The exact steps, for this system, with a button that opens Chrome's settings for WatchSync. */
function showHelp() {
  const help = micHelp(detectOs(navigator.platform), view.blocked ?? "chrome");
  const actions = [{ label: "Close", run: () => {} }];
  const open = help.button;
  if (open) actions.unshift({ label: open, run: () => post({ kind: "micSettings" }) });
  showSheet("mic-help", {
    title: help.title,
    text: help.text,
    steps: help.steps,
    footer: help.footer,
    actions,
  });
}

/** Push-to-talk by default, the first time the mic opens: how to talk, and the way out. */
function sayHint() {
  if (view.mode !== "ptt" || chosenMode || hintSeen) return;
  hintSeen = true;
  chrome.storage.local.set({ [HINT_KEY]: true }).catch(() => {});
  toast(
    "Hold Talk, or Alt+T, while you talk. With headphones you can leave the mic open.",
    12_000,
    { icon: "live", tone: "accent" },
    [
      {
        label: "Use open mic",
        run: () => void chrome.storage.local.set({ [MODE_KEY]: "open" }).catch(() => {}),
      },
      { label: "Got it", primary: true, run: () => {} },
    ],
  );
}

/** Open mic, the first time you are live: who hears you, and that the film does not. */
function sayLive() {
  if (view.mode !== "open" || liveSeen) return;
  liveSeen = true;
  chrome.storage.local.set({ [LIVE_KEY]: true }).catch(() => {});
  const who = others().filter((p) => p.canTalk === true);
  const hear = who.length > 1 ? "hear" : "hears";
  toast(`You're live. ${names(who)} ${hear} you; the film stays out of your mic.`, 6000, {
    icon: "live",
    tone: "ok",
  });
}

/** What the pill shows on someone's face: whether their mic is open, and whether they speak. */
export function talkMark(p: Participant): { mic: "on" | "off" | null; speaking: boolean } {
  const me = p.id === room?.session?.participantId;
  const inVoice = p.connected && p.canTalk === true && p.voice !== undefined && p.voice !== "off";
  // My own state is mine to know at once, before the room says it back.
  const mic = me && view.mic === "on" ? (view.live ? "on" : "off") : inVoice ? voiceOn(p) : null;
  return { mic, speaking: view.speaking.includes(p.id) };
}
const voiceOn = (p: Participant) => (p.voice === "live" ? "on" : "off");

/** Joined muted: once per room, one line on how to start. */
function sayReady() {
  const code = room?.session?.code;
  if (!code || toldReady === code) return;
  toldReady = code;
  chrome.storage.local.set({ [READY_KEY]: code }).catch(() => {});
  toast("Voice is ready. Press Talk when you want to talk.", 7000, { icon: "live", tone: "ok" }, [
    { label: "Talk", run: () => press("down") },
  ]);
}

/** Someone is still connecting a moment after my mic opened: say with whom, once each. */
function watchConnecting() {
  const waiting =
    view.mic === "on" &&
    Object.entries(view.peers).some(([id, s]) => s === "connecting" && !toldConnecting.has(id));
  if (!waiting) {
    clearTimeout(slow);
    slow = undefined;
    return;
  }
  if (slow !== undefined) return; // already counting
  slow = setTimeout(() => {
    slow = undefined;
    for (const [id, s] of Object.entries(view.peers)) {
      if (s !== "connecting" || toldConnecting.has(id)) continue;
      toldConnecting.add(id);
      const who = room?.participants.find((p) => p.id === id)?.name;
      if (who) toast(`Connecting voice with ${who}…`, 4000, { icon: "live", tone: "accent" });
    }
    redraw();
  }, SLOW_MS);
}

/** A connection that could not be made, once per person until it works. */
function checkFailures() {
  for (const [id, s] of Object.entries(view.peers)) {
    if (s === "connected") {
      toldFailed.delete(id);
      toldConnecting.delete(id);
    }
    if (s !== "failed" || toldFailed.has(id) || view.mic !== "on") continue;
    toldFailed.add(id);
    const who = room?.participants.find((p) => p.id === id)?.name;
    if (!who) continue;
    toast(
      `We couldn't connect voice with ${who}. Sync and chat still work.`,
      9000,
      { icon: "alert", tone: "warn" },
      [{ label: "Try again", run: () => cmd("retry") }],
    );
  }
}

const cmd = (c: TalkCmd) => post({ kind: "voice", cmd: c });

/**
 * Asks first; Chrome's question comes only after "Allow and talk", from a WatchSync page that
 * opens in a new tab (so the permission is WatchSync's, never the streaming site's) and sends
 * the person back here.
 */
function askFirst() {
  showSheet("talk", {
    title: `Talk to ${names(others())}`,
    text: "Chrome will ask to let WatchSync use your microphone, in a new tab that brings you back here. WatchSync only sends your voice to people in this room, never to our server.",
    actions: [
      { label: "Not now", run: () => {} },
      {
        label: "Allow and talk",
        primary: true,
        run: () => {
          sheetSeen = true;
          chrome.storage.local.set({ [SHEET_KEY]: true }).catch(() => {});
          cmd("enable");
        },
      },
    ],
  });
}

/** The Talk button or key went down or up. */
export function press(edge: Edge) {
  if (!room?.session) return;
  const offer = voiceOffer(room.participants);
  if (offer !== "ok") {
    if (edge === "up") return;
    if (offer === "full") {
      toast(`Voice is for up to ${VOICE_MAX} people for now. Sync and chat still work.`, 7000, {
        icon: "alert",
        tone: "warn",
      });
      return;
    }
    const old = room.participants.filter((p) => p.connected && p.canTalk !== true);
    post({ kind: "voiceWant" }); // the room tells them how to update, in words their version shows
    toast(updateToTalk(old.map((p) => p.name)), 9000, { icon: "alert", tone: "warn" }, [
      { label: "Copy update link", run: () => copyUpdateLink() },
    ]);
    return;
  }
  if (view.mic === "asking") return;
  if (view.mic === "on") return cmd(edge === "down" ? "down" : "up");
  // No mic yet (never asked, or blocked: pressing again asks Chrome again, so a fix in
  // Chrome's settings works without a reload).
  if (edge === "up") return;
  if (view.mic === "off" && !sheetSeen) return askFirst();
  cmd("enable");
}

function copyUpdateLink() {
  navigator.clipboard
    .writeText(__SITE_URL__)
    .then(() => toast("Link copied", 3000, { icon: "check", tone: "ok" }))
    .catch(() => toast(`Update link: ${__SITE_URL__}`, 9000, { icon: "link" }));
}

/** The Talk button as the pill draws it. */
export function talkPill(): PillVoice | null {
  if (!room?.session) return null;
  const connecting =
    view.mic === "on" &&
    Object.entries(view.peers).some(([id, s]) => s === "connecting" && toldConnecting.has(id));
  const { text, label } = talkWords(view);
  return {
    text: connecting && !view.live ? "Connecting" : text,
    label,
    live: view.live,
    busy: view.mic === "asking",
    press,
  };
}

/** Leaving: nothing more to do, the frame goes with the room. */
export function retireTalk() {
  clearTimeout(slow);
  closeSheet("talk");
}
