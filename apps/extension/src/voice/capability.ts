// Who in the room can use voice (US-132). Rooms mix WatchSync versions: the room service sends
// `canTalk` only to v0.3+ clients, and says false for anyone on an older WatchSync. A room
// service from before v0.3 sends no `canTalk` at all, which reads as "can't": voice stays off
// rather than offering a call nobody can join.
import type { Participant } from "@watchsync/protocol";

/** People whose WatchSync can't talk (an older version, or a room service that predates voice). */
export const cannotTalk = (people: readonly Participant[]): Participant[] =>
  people.filter((p) => p.canTalk !== true);

/** Voice is offered only when everyone in the room can use it. */
export const voiceAvailable = (people: readonly Participant[]): boolean =>
  people.length > 0 && cannotTalk(people).length === 0;

/** People in voice at once: a full mesh stays small (the room service holds the same number). */
export const VOICE_MAX = 4;

/** ok: voice can run. update: someone's WatchSync can't talk. full: more people than voice holds. */
export type VoiceOffer = "ok" | "update" | "full";

/** What voice can be in this room right now. People who are away don't count either way. */
export function voiceOffer(people: readonly Participant[]): VoiceOffer {
  const here = people.filter((p) => p.connected);
  if (!voiceAvailable(here)) return "update";
  return here.length > VOICE_MAX ? "full" : "ok";
}

/** "Asha needs to update WatchSync to talk." / "Asha and Ben need to ..." / "A, B and C need ...". */
export function updateToTalk(names: readonly string[]): string {
  const [last, ...rest] = [...names].reverse();
  if (last === undefined) return "";
  const who = rest.length === 0 ? last : `${rest.reverse().join(", ")} and ${last}`;
  return `${who} ${rest.length === 0 ? "needs" : "need"} to update WatchSync to talk.`;
}
