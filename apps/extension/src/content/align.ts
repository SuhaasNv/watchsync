import type { Media } from "@watchsync/protocol";
import { safeTitleUrl } from "../shared/messages";

export type Alignment =
  | { kind: "none" }
  | { kind: "follow"; url: string }
  | { kind: "prompt"; url: string };

/**
 * What to do when the room's title and this tab's title differ.
 * Someone who was watching with the room and is still on the room's previous title
 * follows automatically (next episode); anyone else is asked first.
 */
export function align(
  roomBefore: Media | null,
  room: Media | null,
  mine: Media | null,
  following: boolean,
): Alignment {
  if (!room || mine?.titleId === room.titleId) return { kind: "none" };
  const url = safeTitleUrl(room.titleUrl, room.service);
  if (!url) return { kind: "none" };
  const wasWithRoom = mine !== null && roomBefore !== null && mine.titleId === roomBefore.titleId;
  if (following && wasWithRoom && mine.service === room.service) return { kind: "follow", url };
  return { kind: "prompt", url };
}
