// Messages between the extension's own contexts (popup, content scripts, background).
import type { AnyServerMessage, Media, Participant, Playback, Service } from "@watchsync/protocol";

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
  /** Why we're no longer in a room, shown once in the popup. */
  notice: string | null;
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
      action: "play" | "pause" | "seek";
      position: number;
      rate: number;
      titleId: string | null;
    };

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

/** A room's titleUrl comes from another person; only follow it to a supported service page. */
export function safeTitleUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return __TITLE_PAGES__.some((pattern) => url.startsWith(pattern.replace(/\*$/, ""))) ? url : null;
}

export const send = (req: Request): Promise<Reply> => chrome.runtime.sendMessage(req);
