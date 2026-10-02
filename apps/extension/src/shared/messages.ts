// Messages between the extension's own contexts (popup, content scripts, background).
import type { AnyServerMessage, Media, Participant, Playback, Service } from "@watchsync/protocol";
import type { Update } from "./update";

export interface Session {
  code: string;
  token: string;
  participantId: string;
}

export type Connection = "idle" | "connecting" | "connected" | "reconnecting";

export interface AppState {
  name: string | null;
  session: Session | null;
  connection: Connection;
  participants: Participant[];
  media: Media | null;
  playback: Playback | null;
  following: boolean;
  /** server clock minus local clock, ms */
  clockOffset: number;
  /** A room we can go back to after the browser restarted (US-034). */
  lastRoom: string | null;
  /** How the room last changed title: straight on (next episode) or a newly picked one. */
  mediaMove: { how: "next" | "new"; byId: string; byName: string } | null;
  /** Why we're no longer in a room, shown once in the popup. */
  notice: string | null;
  /** A newer release than this install, from the daily GitHub check (UC-012). */
  update: Update | null;
}

/** One-shot requests to the background (chrome.runtime.sendMessage). */
export type Request =
  | { kind: "getState" }
  | { kind: "setName"; name: string }
  | { kind: "create" }
  | { kind: "join"; code: string }
  | { kind: "leave" }
  | { kind: "rejoin" }
  | { kind: "forgetRoom" }
  | { kind: "follow"; following: boolean };

export type Reply = { ok: true; state: AppState } | { ok: false; error: string; state: AppState };

/** Background → popup and content scripts, over a long-lived port. */
export type Push =
  | { kind: "state"; state: AppState }
  | { kind: "server"; message: AnyServerMessage };

/** Content script → background, over its port. */
export type TabEvent =
  | { kind: "presence"; service: Service; media: Media | null }
  | {
      kind: "playback";
      /** "sync": everyone jumps to the sender's exact position, without pausing. */
      action: "play" | "pause" | "seek" | "sync";
      status: "playing" | "paused";
      position: number;
      rate: number;
      titleId: string | null;
    }
  | { kind: "hold"; reason: "buffering" | "ad" | null; position: number; adLeft: number | null }
  | { kind: "start"; position: number; titleId: string | null }
  | { kind: "startReady" }
  | { kind: "startForce" };

/** Plain messages for background error codes, shared by the popup and the invite page. */
export const ERRORS: Record<string, string> = {
  unreachable: "We couldn't reach WatchSync. Check your connection and try again.",
  rate_limited: "Too many tries. Wait a minute and try again.",
  invalid: "Enter a name of 1 to 30 characters.",
  not_found: "We can't find that room. Check the code with your friend.",
  expired: "This room is no longer available. Ask your friend for a new code.",
  full: "This room is full.",
};

export const SERVICE_LABEL: Record<Service, string> = {
  netflix: "Netflix",
  prime: "Prime Video",
  jiohotstar: "JioHotstar",
  mock: "Test player",
  none: "",
};

/** The test player's pages, in mock builds only. */
const MOCK_PAGE: [Service, RegExp] = [
  "mock",
  /^http:\/\/localhost:4173\/watch\/[A-Za-z0-9_-]{1,100}$/,
];

/**
 * The title pages each service's provider reports (content/providers.ts), whole URL: exact
 * origin and path, no credentials, port, query, fragment or "..". The room service checks the
 * same shapes (app/rooms.py TITLE_PAGES).
 */
const TITLE_PAGES: [Service, RegExp][] = [
  ["netflix", /^https:\/\/www\.netflix\.com\/watch\/[0-9]{1,20}$/],
  [
    "prime",
    /^https:\/\/www\.(primevideo\.com|amazon\.(com|in|co\.uk|de))(\/gp\/video)?\/detail\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/,
  ],
  [
    "jiohotstar",
    /^https:\/\/www\.(jio)?hotstar\.com(\/[A-Za-z0-9_-]{1,200}){0,10}\/[0-9]{6,20}\/watch$/,
  ],
  ...(__MOCK__ ? [MOCK_PAGE] : []),
];

/**
 * A room's titleUrl comes from another person: only follow it to a title page of a supported
 * service (of `service`, when given), in the exact form our providers produce (BUG-039).
 */
export function safeTitleUrl(url: string | null | undefined, service?: Service): string | null {
  if (!url) return null;
  const ok = TITLE_PAGES.some(([s, page]) => (service ?? s) === s && page.test(url));
  if (!ok) return null;
  try {
    // The parser must read it back unchanged: no encoded tricks that resolve elsewhere.
    return new URL(url).href === url ? url : null;
  } catch {
    return null;
  }
}

/** Control and invisible format characters (bidi marks, ZWJ): the Name schema refuses them. */
const NOT_IN_NAMES = /[\p{Cc}\p{Cf}]/gu;

/** A display name the room service accepts: no invisible marks, 1 to 30 characters, or "". */
export function cleanName(raw: string): string {
  return Array.from(raw.replace(NOT_IN_NAMES, "").trim()).slice(0, 30).join("").trim();
}

/** The room code in what someone typed or pasted: a code, a spaced code or an invite link. */
export function codeFrom(text: string): string {
  const fromLink = text.match(/\/j\/([A-Za-z0-9]{6})(?![A-Za-z0-9])/)?.[1];
  return (fromLink ?? text)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

export const send = (req: Request): Promise<Reply> => chrome.runtime.sendMessage(req);
