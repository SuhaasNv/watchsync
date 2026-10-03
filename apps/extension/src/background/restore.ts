// What to tell a room the restarted room service brought back from our token (US-120).
import {
  type ClientMessageOf,
  envelope,
  isClientMessage,
  type Media,
  type Playback,
} from "@watchsync/protocol";
import { expectedPosition } from "@watchsync/sync-engine";

/** The room as this worker knew it before the connection closed. */
export interface Known {
  media: Media | null;
  playback: Playback | null;
}

/**
 * The ROOM.RESTORE to send on a ROOM.STATE, or null. Only a client the old service told it
 * was restarting (close 4002 or 1012 while connected) speaks: one that was offline then holds
 * an old clock and must not rewind everyone. A room's title never goes back to none, so a
 * room without one after that close is a room brought back. The clock is moved on to now;
 * knownAt says how recent it is, so the room takes the newest one.
 */
export function restoreMessage(
  known: Known,
  roomMedia: Media | null,
  sawRestart: boolean,
  serverNow: number,
): ClientMessageOf<"ROOM.RESTORE"> | null {
  if (!sawRestart || roomMedia !== null || known.media === null) return null;
  const { playback } = known;
  const now = playback && { ...playback, position: expectedPosition(playback, serverNow) };
  const msg = envelope<ClientMessageOf<"ROOM.RESTORE">>("ROOM.RESTORE", {
    media: known.media,
    playback: now,
    knownAt: playback?.updatedAt ?? 0,
  });
  return isClientMessage(msg) ? msg : null;
}
