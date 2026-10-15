// The film dips while friends talk (US-058). Only the player's volume is commanded, as the
// person's own slider would: the film's audio is never captured or processed. The voice
// document says "a friend is speaking" every 250 ms; this lowers the film to a share of the
// person's own volume within 0.2 s, holds it 0.6 s after the last word and brings it back over a
// second. The streaming services keep a changed volume as the person's choice (Netflix saves
// it), so every dip is written down first and always undone: after the call, a crash or a
// closed tab (the next page load puts it back), and by a watchdog if the words stop coming.

export type DuckLevel = "light" | "medium" | "strong";
/** How much of the person's volume is left while someone talks. */
export const DUCK_FACTORS: Record<DuckLevel, number> = { light: 0.6, medium: 0.35, strong: 0.15 };
export const isDuckLevel = (v: unknown): v is DuckLevel =>
  v === "light" || v === "medium" || v === "strong";

/** chrome.storage.local keys: the two settings, and the level kept while the film is lowered. */
export const DUCK_ON_KEY = "duckOn";
export const DUCK_LEVEL_KEY = "duckLevel";
export const DUCK_SAVED_KEY = "duckSaved";

/** On unless the person turned it off; any other stored value counts as the default. */
export const duckOn = (v: unknown): boolean => v !== false;
/** The factor to drop to, or null when the feature is off. */
export const duckFactor = (on: unknown, level: unknown): number | null =>
  duckOn(on) ? DUCK_FACTORS[isDuckLevel(level) ? level : "medium"] : null;

/** What is kept while the film is lowered: where to put it back, and on which service. */
export interface Saved {
  service: string;
  baseline: number;
  ducking: true;
}
export function isSaved(v: unknown): v is Saved {
  if (typeof v !== "object" || v === null) return false;
  const { service, baseline, ducking } = v as Record<string, unknown>;
  return (
    typeof service === "string" &&
    typeof baseline === "number" &&
    baseline > 0 &&
    baseline <= 1 &&
    ducking === true
  );
}

export const STEP_MS = 50;
/** The way down, the wait after the last word, the way up. */
export const DOWN_MS = 150;
export const HOLD_MS = 600;
export const UP_MS = 1000;
/** When the call ends or the room is left there is no reason to wait: back in half a second. */
export const RELEASE_MS = 500;
/** No word for this long: everything is put back, whatever state the fade is in. */
export const LEASE_MS = 1500;
/** A volume this close to the last one we wrote is ours. */
const SAME = 0.015;
/** A change this soon after one of ours, back to where it was, is the service undoing us. */
const REVERT_MS = 300;

/** The part of the <video> the dip touches. */
export interface Player {
  volume: number;
  muted: boolean;
}

export interface DuckEnv {
  service: string;
  /** The film's player now, or null while there is none. */
  video(): Player | null;
  /** The share of the person's volume to drop to; null when the feature is off. */
  factor(): number | null;
  save(saved: Saved): Promise<void>;
  clear(): Promise<void>;
  /** The service takes no volume from us: tell the person once. */
  refused(): void;
}

type Phase = "idle" | "saving" | "down" | "held" | "up";

export class Ducker {
  private phase: Phase = "idle";
  private el: Player | null = null;
  /** The person's own volume: what every dip returns to. */
  private baseline = 1;
  private target = 1;
  private ramp: { from: number; to: number; start: number; ms: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private repairTimer: ReturnType<typeof setTimeout> | undefined;
  private beatAt = 0;
  /** The volume we expect to find: the last one we wrote. */
  private wrote = 1;
  private wroteAt = 0;
  /** The person moved the volume during this speech: leave it alone until the next one. */
  private quiet = false;
  private reverts = 0;
  private refusedBy = false;
  /** Storage writes, one after another, so a clear never overtakes the save before it. */
  private io: Promise<void> = Promise.resolve();

  constructor(private readonly env: DuckEnv) {}

  /** A friend is speaking (said every 250 ms while they do). */
  beat() {
    const now = Date.now();
    const gap = now - this.beatAt;
    this.beatAt = now;
    if (this.refusedBy) return;
    const factor = this.env.factor();
    if (factor === null) return this.restore(); // off: the volume never moves
    if (this.quiet) {
      if (gap < HOLD_MS) return; // still the same speech
      this.quiet = false;
    }
    if (this.phase === "idle") return this.begin(factor);
    if (this.phase === "held" || this.phase === "up") {
      this.phase = "down";
      this.rampTo(this.baseline * factor, DOWN_MS);
    }
  }

  /** The call is over (or I left the room): the film comes back now, over half a second. */
  release() {
    if (this.phase === "down" || this.phase === "held") {
      this.phase = "up";
      this.rampTo(this.baseline, RELEASE_MS);
    } else if (this.phase === "saving") this.restore();
  }

  /**
   * Puts the level back at once and forgets the dip. `keepNote`: leave the saved note for the
   * next page load to act on too, when this page may not live to finish clearing it.
   */
  restore(keepNote = false) {
    const was = this.phase;
    this.stopTimers();
    this.phase = "idle";
    this.ramp = null;
    if (this.el && was !== "idle" && was !== "saving") this.write(this.el, this.baseline);
    this.el = null;
    if (was !== "idle" && !keepNote) this.forget();
  }

  /** The person's own volume change, from the player's `volumechange`. */
  onVolumeChange(target: unknown) {
    const el = this.el;
    if (this.phase === "idle" || !el || target !== el) return;
    if (el.muted) return this.restore(); // muted: it comes back at their level, unheard
    const v = el.volume;
    if (Math.abs(v - this.wrote) <= SAME) return; // our own step
    if (Date.now() - this.wroteAt < REVERT_MS && Math.abs(v - this.baseline) <= SAME) {
      // The service put its volume back right after we changed it.
      this.reverts += 1;
      if (this.reverts >= 2) {
        this.refusedBy = true;
        this.env.refused();
      }
    }
    // Not ours: it is the person's choice now. Keep it, and stop lowering it.
    this.baseline = v;
    this.quiet = true;
    this.stopTimers();
    this.phase = "idle";
    this.ramp = null;
    this.el = null;
    this.forget();
  }

  /**
   * Puts `baseline` on the film as soon as there is one, for up to 20 s: on a page load after a
   * dip that was never undone, or when the player was replaced mid-dip.
   */
  repair(baseline: number) {
    clearTimeout(this.repairTimer);
    let tries = 40;
    const go = () => {
      this.repairTimer = undefined;
      const el = this.env.video();
      if (el) {
        this.write(el, baseline);
        this.forget();
        return;
      }
      tries -= 1;
      if (tries > 0) this.repairTimer = setTimeout(go, 500);
    };
    go();
  }

  /**
   * Everything stops: the page is going (hidden for good, or this copy was replaced). The note
   * stays, so the next visit puts the level back even if this write came too late.
   */
  stop() {
    this.restore(true);
    clearTimeout(this.repairTimer);
    this.repairTimer = undefined;
  }

  private begin(factor: number) {
    clearTimeout(this.repairTimer); // a new dip starts from what the film is at now
    const el = this.env.video();
    if (!el || el.muted || el.volume <= 0) return; // a muted film has nothing to lower
    this.el = el;
    this.baseline = el.volume;
    this.wrote = el.volume;
    this.wroteAt = 0;
    this.target = this.baseline * factor;
    this.phase = "saving";
    const saved: Saved = { service: this.env.service, baseline: this.baseline, ducking: true };
    // Written down before the first step: a crash from here on still gets repaired.
    this.io = this.io
      .then(() => this.env.save(saved))
      .then(() => {
        if (this.phase !== "saving" || this.el !== el) return; // it ended while saving
        this.phase = "down";
        this.rampTo(this.target, DOWN_MS);
      })
      .catch((e: unknown) => {
        console.debug("watchsync: film volume", e);
        if (this.el === el) this.cancel(); // can't promise to undo it: don't lower it
      });
  }

  private cancel() {
    this.stopTimers();
    this.phase = "idle";
    this.ramp = null;
    this.el = null;
  }

  private rampTo(to: number, ms: number) {
    const el = this.el;
    if (!el) return;
    this.ramp = { from: Math.max(el.volume, 0.001), to, start: Date.now(), ms };
    this.timer ??= setTimeout(this.tick, STEP_MS);
  }

  private tick = () => {
    this.timer = undefined;
    if (this.phase === "idle" || this.phase === "saving") return;
    if (this.refusedBy) return this.restore();
    const now = Date.now();
    const current = this.env.video();
    if (current !== this.el) return this.replaced(current);
    if (now - this.beatAt >= LEASE_MS) return this.restore(); // the words stopped coming
    const el = this.el;
    // Changed under us (the person, or a service) before its event came in: not ours to write over.
    if (el && Math.abs(el.volume - this.wrote) > SAME) return this.onVolumeChange(el);
    if (el && this.ramp) {
      const r = this.ramp;
      const p = Math.min(1, (now - r.start) / r.ms);
      // Even to the ear: the fade is steady in ratio, not in amplitude.
      this.write(el, r.from * (r.to / r.from) ** p);
      if (p >= 1) {
        this.ramp = null;
        if (this.phase === "up") return this.restore();
        this.phase = "held";
      }
    }
    if (this.phase === "held" && now - this.beatAt >= HOLD_MS) {
      this.phase = "up";
      this.rampTo(this.baseline, UP_MS);
    }
    this.timer = setTimeout(this.tick, STEP_MS);
  };

  /** The player made a new <video> (next episode, an ad): the level goes back on whatever exists. */
  private replaced(current: Player | null) {
    const old = this.el;
    const baseline = this.baseline;
    this.stopTimers();
    this.phase = "idle";
    this.ramp = null;
    this.el = null;
    if (old) this.write(old, baseline);
    if (current) {
      this.write(current, baseline);
      this.forget();
    } else this.repair(baseline); // none yet: the level waits for the next one
  }

  private write(el: Player, v: number) {
    const to = Math.min(1, Math.max(0, v));
    el.volume = to;
    this.wrote = el.volume;
    this.wroteAt = Date.now();
    // A service that holds its volume (the write didn't take) is one we can't lower.
    if (Math.abs(this.wrote - to) > 0.05 && !this.refusedBy) {
      this.refusedBy = true;
      this.env.refused();
    }
  }

  private stopTimers() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private forget() {
    this.io = this.io
      .then(() => this.env.clear())
      .catch((e: unknown) => {
        console.debug("watchsync: film volume", e);
      });
  }
}
