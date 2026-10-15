// Who is speaking, from audio levels (0 to 1, linear). A level counts as speech from 0.02 once
// it has held for 150 ms, and stops counting below 0.008; between the two, a person who is
// speaking keeps speaking, so a pause between words doesn't flicker the ring.

export const START_LEVEL = 0.02;
export const START_FOR_MS = 150;
export const STOP_LEVEL = 0.008;
/** A level reported longer ago than this is a source that has gone quiet. */
export const FRESH_MS = 300;

export class SpeakingDetector {
  speaking = false;
  private since: number | null = null;

  /** One reading at time `at` (ms); null when there is no fresh source. True when `speaking` changed. */
  feed(level: number | null, at: number): boolean {
    const was = this.speaking;
    const l = level ?? 0;
    if (this.speaking) {
      if (l < STOP_LEVEL) {
        this.speaking = false;
        this.since = null;
      }
    } else if (l >= START_LEVEL) {
      this.since ??= at;
      if (at - this.since >= START_FOR_MS) this.speaking = true;
    } else {
      this.since = null;
    }
    return this.speaking !== was;
  }
}

/** The loudest of the sources heard within FRESH_MS of `now`; null when none was. */
export function freshLevel(
  sources: readonly { audioLevel?: number; timestamp: number }[],
  now: number,
): number | null {
  let loudest: number | null = null;
  for (const s of sources) {
    if (s.audioLevel === undefined || now - s.timestamp >= FRESH_MS) continue;
    loudest = Math.max(loudest ?? 0, s.audioLevel);
  }
  return loudest;
}
