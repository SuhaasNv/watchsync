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
}

/** One-shot requests to the background (chrome.runtime.sendMessage). */
export type Request =
  | { kind: "getState" }
  | { kind: "setName"; name: string }
  | { kind: "create" }
  | { kind: "join"; code: string }
  | { kind: "leave" }
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

export const send = (req: Request): Promise<Reply> => chrome.runtime.sendMessage(req);
