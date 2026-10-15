// How voice reaches the other people in the room. The interface is all the rest of the
// extension knows (UC-021): the peer-to-peer mesh below it can be swapped for a media server
// in v0.5 without touching any screen. The room service never carries media; it only passes
// the set-up messages (VoiceSignalBody) between browsers.
import type { IceServer, VoiceSignalBody } from "@watchsync/protocol";
import type { PeerState } from "./messages";

export interface TransportEvents {
  /** A set-up message for one person: send it through the room. */
  signal(to: string, signal: VoiceSignalBody): void;
  /** The connection to someone changed. null: it was closed (they left, or voice stopped). */
  peer(id: string, state: PeerState | null): void;
  /** Someone started or stopped speaking. */
  speaking(id: string, speaking: boolean): void;
  /** Their voice: play it. null: stop playing it. */
  audio(id: string, stream: MediaStream | null): void;
}

export interface MediaTransport {
  /** Who to be connected with: everyone in the list, nobody else. */
  setPeers(ids: readonly string[]): void;
  /** A set-up message from one of them. */
  receive(from: string, signal: VoiceSignalBody): void;
  setIceServers(servers: readonly IceServer[]): void;
  /** My microphone, or none (heard by everyone connected, now and later). */
  setMic(track: MediaStreamTrack | null): void;
  /** Muted: connected, but silent. */
  setMuted(muted: boolean): void;
  /** Start again with everyone who isn't connected (Try again). */
  retry(): void;
  /** Leave voice: close every connection. */
  close(): void;
}
