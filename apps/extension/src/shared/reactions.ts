// Reactions (UC-015): the six emoji, how taps become one send, and the per-person limit.
import type { Emoji } from "@watchsync/protocol";

/** The six reactions in button order, with the name people see and hear. */
export const REACTIONS: readonly { emoji: Emoji; name: string }[] = [
  { emoji: "❤️", name: "Love" },
  { emoji: "😂", name: "Laugh" },
  { emoji: "😭", name: "Cry" },
  { emoji: "🔥", name: "Fire" },
  { emoji: "😱", name: "Shocked" },
  { emoji: "👏", name: "Clap" },
];

export const reactionName = (emoji: Emoji): string =>
  REACTIONS.find((r) => r.emoji === emoji)?.name ?? "";

export function isEmoji(v: unknown): v is Emoji {
  return REACTIONS.some((r) => r.emoji === v);
}

/** Taps on the same reaction within this long go out as one send with a count (US-045). */
export const BURST_MS = 250;
export const MAX_COUNT = 5;
/** Matches the room service's REACTIONS_PER_5S (US-046). */
export const REACTIONS_PER_5S = 8;

/**
 * Coalesces a burst of taps: the first tap opens a 250 ms window, taps on the same emoji in it
 * add to the count (up to 5, which sends at once), and a different emoji sends the open burst
 * first.
 */
export class Burst {
  private open: { emoji: Emoji; count: number; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(private readonly sendOut: (emoji: Emoji, count: number) => void) {}

  tap(emoji: Emoji) {
    if (this.open && this.open.emoji !== emoji) this.flush();
    if (this.open) this.open.count += 1;
    else this.open = { emoji, count: 1, timer: setTimeout(() => this.flush(), BURST_MS) };
    if (this.open.count >= MAX_COUNT) this.flush();
  }

  flush() {
    const open = this.open;
    if (!open) return;
    clearTimeout(open.timer);
    this.open = null;
    this.sendOut(open.emoji, open.count);
  }
}

/** A sliding window: at most `limit` hits in `windowMs`. */
export class RateWindow {
  private readonly hits: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(): boolean {
    const t = this.now();
    while (this.hits.length && t - (this.hits[0] ?? t) >= this.windowMs) this.hits.shift();
    if (this.hits.length >= this.limit) return false;
    this.hits.push(t);
    return true;
  }
}

/** One spoken line for reactions that arrived together: "Asha and 2 others: Laugh". */
export function announcement(batch: readonly { name: string; emoji: Emoji }[]): string {
  const byEmoji = new Map<Emoji, string[]>();
  for (const { name, emoji } of batch) {
    const names = byEmoji.get(emoji) ?? [];
    if (!names.includes(name)) names.push(name);
    byEmoji.set(emoji, names);
  }
  return [...byEmoji]
    .map(([emoji, names]) => {
      const others = names.length - 1;
      const who =
        others === 0 ? names[0] : `${names[0]} and ${others} other${others === 1 ? "" : "s"}`;
      return `${who}: ${reactionName(emoji)}`;
    })
    .join(". ");
}
