// Netflix's player data, as read in the page (netflix-bridge.ts). Kept apart so it can be
// tested without a page. Reads only the title and episode numbers, never the stream.

/** The parts of window.netflix's video metadata that name what's playing. */
export interface NetflixMetadata {
  getTitle(): unknown;
  getCurrentVideo(): {
    isEpisodic?(): unknown;
    /** A season wrapper: the number is one level down (_season._season.seq). */
    _season?: { seq?: unknown; _season?: { seq?: unknown } };
    _video?: { seq?: unknown };
  } | null;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** "Solo Leveling, S1:E1" for an episode, "Dune" for a film; null if it can't be read. */
export function netflixTitle(meta: NetflixMetadata | null | undefined): string | null {
  try {
    const show = meta?.getTitle();
    if (typeof show !== "string" || !show.trim()) return null;
    const name = show.trim().slice(0, 200);
    const cur = meta?.getCurrentVideo();
    const season = cur?._season?._season?.seq ?? cur?._season?.seq;
    const episode = cur?._video?.seq;
    if (cur?.isEpisodic?.() === true && isNumber(season) && isNumber(episode))
      return `${name}, S${season}:E${episode}`;
    return name;
  } catch {
    return null; // Netflix changed its player data: fall back to the page text
  }
}
