// The words of room notices (US-022, US-024, US-033), shared by the on-page notices and the
// chat feed (US-113) so both say exactly the same thing.

/** 1:05 or 1:02:05. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

const DID = { play: "pressed play", pause: "paused", sync: "synced everyone" } as const;

export const playedText = (name: string, action: keyof typeof DID) => `${name} ${DID[action]}`;
export const jumpedText = (name: string, ahead: boolean, to: number) =>
  `${name} ${ahead ? "skipped ahead" : "went back"} to ${clock(to)}`;
export const joinedText = (name: string) => `${name} joined`;
export const leftText = (name: string) => `${name} left`;
export const rejoinedText = (name: string) => `${name} rejoined`;
export const closedText = (name: string) => `${name} closed the show`;
export const movedText = (name: string, how: "next" | "new", title: string) =>
  how === "next" ? `${name} moved on to ${title}` : `${name} opened ${title}`;

/** Someone follows the room on another service: the lasting line on both screens (US-053). */
export const serviceText = (name: string, theirs: string, mine: string) =>
  `${name} is on ${theirs}, you're on ${mine}. Sync works only on the same title.`;

/**
 * Room notices on the page on or off (US-114): a setting in chrome.storage.local, on unless
 * turned off in chat. Only the notices above; waiting, reconnecting, Sync and follow prompts
 * always show, and the chat feed always records.
 */
export const NOTICES_KEY = "roomNotices";
export const noticesOn = (stored: unknown): boolean => stored !== false;
