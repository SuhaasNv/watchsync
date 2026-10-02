// How a person looks on every WatchSync surface: an initial on a colour picked from their
// name, so Asha is the same colour in the popup, the pill and every notice.

export interface Tone {
  /** Text colour, at least 7:1 on `bg`. */
  fg: string;
  bg: string;
}

export const TONES: readonly Tone[] = [
  { fg: "#ffd98a", bg: "#3a2f14" },
  { fg: "#86e6d5", bg: "#123430" },
  { fg: "#a6cdff", bg: "#172a40" },
  { fg: "#cfbcff", bg: "#2b2342" },
  { fg: "#ffb6c8", bg: "#3d1e29" },
  { fg: "#c8eb92", bg: "#25331a" },
  { fg: "#ffbda3", bg: "#3d2419" },
  { fg: "#bcd0d9", bg: "#22313a" },
];

/** The first character a reader would see (a whole grapheme, so Tamil and emoji stay intact). */
export function initialOf(name: string): string {
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name.trim());
  const first = segments[Symbol.iterator]().next();
  return first.done ? "?" : first.value.segment.toUpperCase();
}

/** The same name always gets the same tone. */
export function toneOf(name: string): Tone {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return TONES[h % TONES.length] ?? { fg: "#ecf2f1", bg: "#19242a" };
}
