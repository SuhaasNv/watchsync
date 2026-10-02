/**
 * The hero demo as data. `stateAt(clock)` is a pure function of the demo clock, so the
 * animation, the step buttons and the reduced-motion stills all show exactly the same thing.
 * The wording of every notice is the extension's own (apps/extension/src/content/index.ts).
 */

export type Who = "sam" | "maya" | "leo";

export const PEOPLE: { id: Who; name: string; place: string; time: string }[] = [
  { id: "sam", name: "Sam", place: "Bengaluru", time: "9:30 pm" },
  { id: "maya", name: "Maya", place: "Dubai", time: "8:00 pm" },
  { id: "leo", name: "Leo", place: "London", time: "5:00 pm" },
];

const WHO: Who[] = ["sam", "maya", "leo"];

const NAMES: Record<Who, string> = { sam: "Sam", maya: "Maya", leo: "Leo" };

/** The film is 1:52:00 long and the demo starts at 40:50. */
export const DURATION = 6720;
export const START = 2450;
export const LOOP = 32;

type Event =
  | { at: number; kind: "pause" | "play"; by: Who }
  | { at: number; kind: "seek"; by: Who; to: number }
  | { at: number; kind: "hold"; by: Who; reason: "ad" | "loading"; until: number };

export const EVENTS: Event[] = [
  { at: 3.4, kind: "pause", by: "maya" },
  { at: 6.8, kind: "play", by: "sam" },
  { at: 10.6, kind: "seek", by: "leo", to: 2530 },
  { at: 14.5, kind: "hold", by: "maya", reason: "ad", until: 22.5 },
  { at: 26, kind: "hold", by: "leo", reason: "loading", until: 28.6 },
];

export interface Step {
  /** Where the step starts while the demo plays. */
  at: number;
  /** The moment shown when someone picks the step, or as a still with reduced motion. */
  still: number;
  caption: string;
}

export const STEPS: Step[] = [
  { at: 0, still: 1.2, caption: "Three friends in three cities, on the same film." },
  { at: 3, still: 4.4, caption: "Maya pauses. Everyone pauses, and sees who did it." },
  { at: 6.4, still: 7.8, caption: "Sam presses play. Everyone plays." },
  { at: 10.2, still: 11.6, caption: "Leo skips ahead. Everyone lands on 42:10." },
  { at: 14.2, still: 16.6, caption: "Maya gets an ad. The room waits for her and says why." },
  { at: 22.3, still: 23.2, caption: "Her ad ends. Everyone starts again, together." },
  { at: 25.8, still: 27.2, caption: "Leo's video is loading. The room waits for him too." },
];

export interface CursorMove {
  start: number;
  arrive: number;
  click: number;
  leave: number;
  screen: Who;
  /** The play button, or a point along the progress bar (0 to 1). */
  target: "play" | number;
}

export const CURSOR: CursorMove[] = [
  { start: 2.3, arrive: 3.2, click: 3.4, leave: 4.4, screen: "maya", target: "play" },
  { start: 5.7, arrive: 6.6, click: 6.8, leave: 7.8, screen: "sam", target: "play" },
  { start: 9.4, arrive: 10.4, click: 10.6, leave: 11.8, screen: "leo", target: 2530 / DURATION },
];

export interface Notice {
  text: string;
  /** A wait card stays while the room waits; a toast comes and goes. */
  kind: "toast" | "wait";
}

export interface ScreenState {
  notice: Notice | null;
  /** Seconds of ad left on this person's own screen. */
  ad: number | null;
  loading: boolean;
}

export interface DemoState {
  position: number;
  playing: boolean;
  screens: Record<Who, ScreenState>;
  /** Who is in sync, for the pill on every screen. */
  synced: Record<Who, boolean>;
  step: number;
}

const TOAST_DELAY = 0.15;
const TOAST_FOR = 2.6;

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function toastText(e: Event): string {
  const name = NAMES[e.by];
  if (e.kind === "pause") return `${name} paused`;
  if (e.kind === "play") return `${name} pressed play`;
  if (e.kind === "seek") return `${name} skipped ahead to ${clock(e.to)}`;
  return "";
}

export function stateAt(t: number): DemoState {
  let position = START;
  let playing = true;
  let last = 0;
  const screens: Record<Who, ScreenState> = {
    sam: { notice: null, ad: null, loading: false },
    maya: { notice: null, ad: null, loading: false },
    leo: { notice: null, ad: null, loading: false },
  };
  const synced: Record<Who, boolean> = { sam: true, maya: true, leo: true };
  const others = (who: Who) => WHO.filter((w) => w !== who);

  for (const e of EVENTS) {
    if (e.at > t) break;
    if (playing) position += e.at - last;
    last = e.at;

    if (e.kind === "hold") {
      const end = Math.min(t, e.until);
      // The room pauses at the moment of the hold and plays again when it ends.
      if (t < e.until) {
        playing = false;
        synced[e.by] = false;
        const left = Math.ceil(e.until - t);
        if (e.reason === "ad") screens[e.by].ad = left;
        else screens[e.by].loading = true;
        const text =
          e.reason === "ad"
            ? `${NAMES[e.by]} is on an ad · about ${clock(left)} left`
            : `Waiting for ${NAMES[e.by]} to load`;
        for (const w of others(e.by)) screens[w].notice = { text, kind: "wait" };
      } else {
        last = end;
        playing = true;
        if (t - e.until < TOAST_FOR) {
          for (const w of others(e.by))
            screens[w].notice = { text: "Back together", kind: "toast" };
        }
      }
      continue;
    }

    if (e.kind === "seek") position = e.to;
    else playing = e.kind === "play";
    const since = t - e.at;
    if (since >= TOAST_DELAY && since < TOAST_DELAY + TOAST_FOR) {
      for (const w of others(e.by)) screens[w].notice = { text: toastText(e), kind: "toast" };
    }
  }
  if (playing) position += t - last;

  let step = 0;
  STEPS.forEach((s, i) => {
    if (t >= s.at) step = i;
  });
  return { position, playing, screens, synced, step };
}
