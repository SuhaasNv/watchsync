// Room notices in the chat feed (US-113): who came, went or changed title, in the same words as
// the on-page notices, from this frame's load on (the room service keeps no activity). Play,
// pause and jumps are on-page notices only (owner, 3 Oct). Never counted as unread and never
// announced here: the on-page notice already says it.
import type { AnyServerMessage, Media, Participant, Playback } from "@watchsync/protocol";
import { closedText, joinedText, leftText, movedText, rejoinedText } from "../shared/activity";

export interface ActivityItem {
  id: string;
  text: string;
  /** Server time (ms), to sit in time order with chat messages. */
  at: number;
}

/** A leave and a return within this long show as one line. */
export const MERGE_MS = 120_000;
/** Lines kept; the oldest go first. */
export const KEEP = 200;

export interface RoomView {
  you: string | null;
  media: Media | null;
  playback: Playback | null;
  participants: Participant[];
}

export class ActivityFeed {
  items: ActivityItem[] = [];
  private titles = new Map<string, string | null>();
  private left = new Map<string, ActivityItem>();
  private n = 0;

  /** The room as the frame last heard it, before any message changes it. */
  sync(room: RoomView) {
    for (const p of room.participants) if (!this.titles.has(p.id)) this.titles.set(p.id, p.titleId);
  }

  /** Adds the line a server message makes, if any. True when the feed changed. */
  onServer(msg: AnyServerMessage, room: RoomView): boolean {
    const at = msg.timestamp;
    if (msg.type === "ROOM.MEDIA") {
      const { byId, byName, how, media } = msg.payload;
      if (byId === room.you) return false;
      const title =
        media.titleName ??
        room.participants.find((p) => p.titleId === media.titleId && p.titleName)?.titleName ??
        "a title";
      return this.add(movedText(byName, how, title), at);
    }
    if (msg.type === "ROOM.PARTICIPANT") {
      const { participant: p, event } = msg.payload;
      const was = this.titles.get(p.id);
      this.titles.set(p.id, p.titleId);
      if (p.id === room.you) return false;
      if (event === "left") {
        const item = this.make(leftText(p.name), at);
        this.left.set(p.name, item);
        return this.push(item);
      }
      if (event === "joined" || event === "rejoined") {
        const gone = this.left.get(p.name);
        this.left.delete(p.name);
        // Left and back within 2 minutes: one line, "Asha rejoined", where they came back.
        if (gone && at - gone.at <= MERGE_MS) {
          this.items = this.items.filter((x) => x !== gone);
          return this.add(rejoinedText(p.name), at);
        }
        return this.add(event === "joined" ? joinedText(p.name) : rejoinedText(p.name), at);
      }
      const roomTitle = room.media?.titleId;
      if (roomTitle && p.connected && was === roomTitle && p.titleId === null)
        return this.add(closedText(p.name), at);
    }
    return false;
  }

  private make(text: string, at: number): ActivityItem {
    this.n += 1;
    return { id: `a${this.n}`, text, at };
  }

  private add(text: string, at: number): boolean {
    return this.push(this.make(text, at));
  }

  private push(item: ActivityItem): boolean {
    this.items = [...this.items, item].slice(-KEEP);
    return true;
  }
}
