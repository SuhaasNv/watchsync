// What Talk does on the page (US-055): the button in the pill, the first-press sheet, and the
// notices about voice. The voice frame holds the mic and the connections; this decides what a
// press means from the room and from what the frame reports. Voice is offered only when every
// person's WatchSync can talk, and for up to four people.
import type { Participant } from "@watchsync/protocol";
import type { AppState, Edge, TabEvent } from "../shared/messages";
import { updateToTalk, VOICE_MAX, voiceOffer } from "../voice/capability";
import { NO_VOICE, type TalkCmd, type VoiceView } from "../voice/messages";
import { closeSheet, type PillVoice, showSheet, toast } from "./overlay";
import { isVoiceOff, showVoiceFrame } from "./voice-frame";

/** Saved in chrome.storage.local: the first-press sheet has been answered, once ever. */
const SHEET_KEY = "voiceSheetSeen";
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

chrome.storage.local
  .get(SHEET_KEY)
  .then((got) => {
    sheetSeen = got[SHEET_KEY] === true;
  })
  .catch(() => {});

/** The tab's connection to the background, and how to redraw the pill when voice changes. */
export function initTalk(env: { post: (e: TabEvent) => void; redraw: () => void }) {
  post = env.post;
  redraw = env.redraw;
}

const others = (): Participant[] =>
  room?.participants.filter((p) => p.id !== room?.session?.participantId && p.connected) ?? [];

const names = (people: readonly Participant[]) => {
  const list = people.map((p) => p.name);
  const last = list.pop();
  if (last === undefined) return "the room";
  return list.length === 0 ? last : `${list.join(", ")} and ${last}`;
};

// Chrome holds back sound until the person has used the page. The voice frame can't see the
// page's clicks, so when they use it, it is told it may play what it has been holding.
let lastResume = 0;
function gesture(e: Event) {
  const now = Date.now();
  if (!e.isTrusted || !view.frame || now - lastResume < 3000) return;
  lastResume = now;
  cmd("resume");
}
let watching = false;
function watchGestures(on: boolean) {
  if (on === watching) return;
  watching = on;
  for (const type of ["pointerdown", "keydown"]) {
    if (on) document.addEventListener(type, gesture, { capture: true, passive: true });
    else document.removeEventListener(type, gesture, { capture: true });
  }
}

/** The room changed: the voice frame is on the page exactly while voice is on offer. */
export function talkRoom(next: AppState | null, hasTitle: boolean) {
  room = next;
  const live = next?.session != null && next.connection !== "idle" && hasTitle;
  const on = live && voiceOffer(next.participants) === "ok" && !isVoiceOff();
  showVoiceFrame(on);
  watchGestures(on);
  if (!live) {
    closeSheet("talk");
    toldReady = null;
    toldFailed.clear();
    toldConnecting.clear();
  }
  checkFailures();
}

/** The voice frame reported. */
export function talkView(next: VoiceView) {
  const before = view;
  view = next;
  if (next.mic === "blocked" && before.mic !== "blocked") {
    toast("Chrome blocked your microphone.", 8000, { icon: "alert", tone: "warn" });
  }
  if (next.frame && !before.frame) sayReady();
  watchConnecting();
  checkFailures();
  redraw();
}

/** Joined muted: once per room, one line on how to start. */
function sayReady() {
  const code = room?.session?.code;
  if (!code || toldReady === code) return;
  toldReady = code;
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

/** Asks first; the real prompt comes from Chrome only after "Allow and talk". */
function askFirst() {
  showSheet("talk", {
    title: `Talk to ${names(others())}`,
    text: "Chrome will ask to use your microphone. WatchSync only sends your voice to people in this room, never to our server.",
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
  const on = view.mic === "on";
  const open = view.mode === "open";
  const connecting =
    on &&
    Object.entries(view.peers).some(([id, s]) => s === "connecting" && toldConnecting.has(id));
  let text = "Talk";
  let label = "Talk";
  if (on) {
    if (open) {
      text = view.live ? "Mute" : "Unmute";
      label = view.live ? "Mute your mic" : "Unmute your mic";
    } else {
      text = view.live ? "Talking" : "Hold to talk";
      label = "Hold to talk";
    }
  }
  if (connecting && !view.live) text = "Connecting";
  return { text, label, live: view.live, busy: view.mic === "asking", press };
}

/** Leaving: nothing more to do, the frame goes with the room. */
export function retireTalk() {
  clearTimeout(slow);
  watchGestures(false);
  closeSheet("talk");
}
