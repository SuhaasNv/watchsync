// What the card says while the room waits for someone (US-102, US-103, US-126). An ad names its
// owner ("Waiting for Asha's ad"); two or more ads say "Waiting for ads to finish". Buffering,
// and anything an adapter wasn't sure about, never says "ad".
import { clock } from "../shared/activity";

export interface Waiting {
  name: string;
  hold: "buffering" | "ad";
  adLeft: number | null;
}

/** The headline and detail line for the people the room is waiting for (at least one). */
export function waitCopy(
  waiting: [Waiting, ...Waiting[]],
  late: boolean,
): { text: string; detail: string } {
  const [who] = waiting;
  const manyAds = waiting.length > 1 && waiting.every((p) => p.hold === "ad");
  const left = who.adLeft && !manyAds ? ` About ${clock(who.adLeft)} left.` : "";
  const text = manyAds
    ? "Waiting for ads to finish"
    : who.hold === "ad"
      ? `Waiting for ${who.name}'s ad`
      : `Waiting for ${who.name} to load`;
  const detail = late
    ? `This is taking a while. Play on now and ${who.name} can catch up later.${left}`
    : who.hold === "ad"
      ? `Paused for everyone until the ad${manyAds ? "s end" : " ends"}.${left}`
      : `Paused for everyone until ${who.name} catches up.`;
  return { text, detail };
}
