// The dip's envelope and its repairs, on a fake player and fake timers (US-058).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DUCK_FACTORS,
  type DuckEnv,
  Ducker,
  duckFactor,
  HOLD_MS,
  isSaved,
  LEASE_MS,
  type Player,
} from "./duck";

const MEDIUM = DUCK_FACTORS.medium;

function setup(volume = 0.8, factor: number | null = MEDIUM) {
  const film: Player = { volume, muted: false };
  let current: Player | null = film;
  const calls: string[] = [];
  const env: DuckEnv = {
    service: "netflix",
    video: () => current,
    factor: () => factor,
    save: vi.fn(async () => {
      calls.push("save");
    }),
    clear: vi.fn(async () => {
      calls.push("clear");
    }),
    refused: vi.fn(),
  };
  return {
    film,
    env,
    calls,
    duck: new Ducker(env),
    swap: (next: Player | null) => {
      current = next;
    },
  };
}

/** A friend talking: a beat every 250 ms for `ms`. */
async function talk(duck: Ducker, ms: number) {
  for (let t = 0; t < ms; t += 250) {
    duck.beat();
    await vi.advanceTimersByTimeAsync(250);
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the dip", () => {
  it("writes the level down first, then lowers the film to a share of it within 0.2 s", async () => {
    const { film, env, calls, duck } = setup(0.8);
    duck.beat();
    // Nothing moves until the level is saved.
    expect(film.volume).toBe(0.8);
    await vi.advanceTimersByTimeAsync(0);
    expect(env.save).toHaveBeenCalledWith({ service: "netflix", baseline: 0.8, ducking: true });
    expect(calls).toEqual(["save"]);
    await vi.advanceTimersByTimeAsync(200);
    expect(film.volume).toBeCloseTo(0.8 * MEDIUM, 3);
  });

  it("holds 0.6 s after the last word, then comes back over a second, and clears the note", async () => {
    const { film, env, duck } = setup(0.8);
    await talk(duck, 1000);
    expect(film.volume).toBeCloseTo(0.28, 3); // still lowered while they talk
    // The last beat was 250 ms ago. Wait out the hold: the film is still down at 0.6 s.
    await vi.advanceTimersByTimeAsync(HOLD_MS - 250 - 50);
    expect(film.volume).toBeCloseTo(0.28, 3);
    // Part way up one second later, then fully back by 1.5 s after the last word.
    await vi.advanceTimersByTimeAsync(500);
    expect(film.volume).toBeGreaterThan(0.28);
    expect(film.volume).toBeLessThan(0.8);
    await vi.advanceTimersByTimeAsync(LEASE_MS);
    expect(film.volume).toBe(0.8);
    expect(env.clear).toHaveBeenCalled();
  });

  it("dips again from where it is when a word comes while it is coming back", async () => {
    const { film, duck } = setup(1);
    await talk(duck, 500);
    await vi.advanceTimersByTimeAsync(HOLD_MS + 400); // part way up
    const rising = film.volume;
    expect(rising).toBeGreaterThan(MEDIUM);
    duck.beat();
    await vi.advanceTimersByTimeAsync(200);
    expect(film.volume).toBeCloseTo(MEDIUM, 2);
  });

  it("uses the strength chosen", async () => {
    const strong = setup(1, duckFactor(true, "strong"));
    await talk(strong.duck, 500);
    expect(strong.film.volume).toBeCloseTo(0.15, 2);
    const light = setup(1, duckFactor(true, "light"));
    await talk(light.duck, 500);
    expect(light.film.volume).toBeCloseTo(0.6, 2);
  });

  it("restores by the watchdog if the words stop and nothing else says so", async () => {
    const { film, duck } = setup(0.8);
    await talk(duck, 500);
    expect(film.volume).toBeLessThan(0.8);
    await vi.advanceTimersByTimeAsync(LEASE_MS);
    expect(film.volume).toBe(0.8);
  });

  it("brings the film back within 1.5 s when the call ends", async () => {
    const { film, env, duck } = setup(0.8);
    await talk(duck, 500);
    duck.release();
    await vi.advanceTimersByTimeAsync(1100);
    expect(film.volume).toBe(0.8);
    expect(env.clear).toHaveBeenCalled();
  });

  it("puts the level back at once on restore (page hidden, orphaned, setting turned off)", async () => {
    const { film, env, duck } = setup(0.8);
    await talk(duck, 500);
    duck.restore();
    expect(film.volume).toBe(0.8);
    await vi.advanceTimersByTimeAsync(0);
    expect(env.clear).toHaveBeenCalled();
    // Nothing is left running that could lower it again.
    await vi.advanceTimersByTimeAsync(5000);
    expect(film.volume).toBe(0.8);
  });

  it("stop (page going away) puts the level back but keeps the note for the next visit", async () => {
    const { film, env, duck } = setup(0.8);
    await talk(duck, 500);
    duck.stop();
    expect(film.volume).toBe(0.8);
    await vi.advanceTimersByTimeAsync(5000);
    expect(env.clear).not.toHaveBeenCalled();
  });

  it("does not leave the note behind when it ends while still saving", async () => {
    const { env, duck } = setup(0.8);
    let done: () => void = () => {};
    vi.mocked(env.save).mockImplementationOnce(() => new Promise<void>((r) => (done = r)));
    duck.beat();
    await vi.advanceTimersByTimeAsync(0); // the save has started
    duck.restore();
    done();
    await vi.advanceTimersByTimeAsync(0);
    expect(env.clear).toHaveBeenCalled();
  });
});

describe("it never moves a film it should not", () => {
  it("does nothing when the feature is off", async () => {
    const { film, env, duck } = setup(0.8, null);
    await talk(duck, 1000);
    expect(film.volume).toBe(0.8);
    expect(env.save).not.toHaveBeenCalled();
  });

  it("does nothing to a muted film or one at zero", async () => {
    const muted = setup(0.8);
    muted.film.muted = true;
    await talk(muted.duck, 500);
    expect(muted.film.volume).toBe(0.8);
    expect(muted.env.save).not.toHaveBeenCalled();
    const zero = setup(0);
    await talk(zero.duck, 500);
    expect(zero.env.save).not.toHaveBeenCalled();
  });

  it("turning it off in the middle of a dip puts the film back", async () => {
    let factor: number | null = MEDIUM;
    const base = setup(0.8);
    const env: DuckEnv = { ...base.env, factor: () => factor };
    const duck = new Ducker(env);
    await talk(duck, 500);
    expect(base.film.volume).toBeLessThan(0.8);
    factor = null;
    duck.beat();
    expect(base.film.volume).toBe(0.8);
  });

  it("does not lower a film whose save failed", async () => {
    const { film, env, duck } = setup(0.8);
    vi.mocked(env.save).mockRejectedValue(new Error("storage"));
    vi.spyOn(console, "debug").mockImplementation(() => {});
    await talk(duck, 500);
    expect(film.volume).toBe(0.8);
  });
});

describe("the person's own volume", () => {
  it("a change made while it is lowered becomes their level, and is kept", async () => {
    const { film, env, duck } = setup(0.8);
    await talk(duck, 500);
    film.volume = 0.6; // the person drags the slider
    duck.onVolumeChange(film);
    await vi.advanceTimersByTimeAsync(0);
    expect(env.clear).toHaveBeenCalled();
    await talk(duck, 1000); // they keep talking: the film is left where the person put it
    expect(film.volume).toBe(0.6);
    // After a pause the next speech dips from the new level.
    await vi.advanceTimersByTimeAsync(1000);
    await talk(duck, 500);
    expect(film.volume).toBeCloseTo(0.6 * MEDIUM, 2);
  });

  it("a change that no event has announced yet is not written over by the next step", async () => {
    const { film, env, duck } = setup(0.8);
    await talk(duck, 500);
    film.volume = 0.6; // the person moved the slider just before our timer fired
    await vi.advanceTimersByTimeAsync(100);
    expect(film.volume).toBe(0.6);
    expect(env.clear).toHaveBeenCalled();
  });

  it("our own steps are not taken for the person's", async () => {
    const { film, duck } = setup(0.8);
    duck.beat();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(25);
      duck.onVolumeChange(film);
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(film.volume).toBeCloseTo(0.8 * MEDIUM, 2);
  });

  it("muting during a dip brings the level back for when they unmute", async () => {
    const { film, duck } = setup(0.8);
    await talk(duck, 500);
    film.muted = true;
    duck.onVolumeChange(film);
    expect(film.volume).toBe(0.8);
  });

  it("a player replaced mid-dip gets the level, old and new", async () => {
    const { film, duck, swap } = setup(0.8);
    await talk(duck, 500);
    const next: Player = { volume: 0.28, muted: false }; // the service kept the lowered level
    swap(next);
    await vi.advanceTimersByTimeAsync(100);
    expect(next.volume).toBe(0.8);
    expect(film.volume).toBe(0.8);
  });
});

describe("a service that will not take a volume", () => {
  it("says so once and stops lowering", async () => {
    const { film, env, duck } = setup(0.8);
    Object.defineProperty(film, "volume", { get: () => 0.8, set: () => {} });
    await talk(duck, 1000);
    expect(env.refused).toHaveBeenCalledTimes(1);
    await talk(duck, 1000);
    expect(env.refused).toHaveBeenCalledTimes(1);
    expect(film.volume).toBe(0.8);
  });

  it("notices a service that puts its volume straight back, the second time", async () => {
    const { film, env, duck } = setup(0.8);
    for (let round = 0; round < 2; round++) {
      await talk(duck, 400);
      film.volume = 0.8; // the service undoes us
      duck.onVolumeChange(film);
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(env.refused).toHaveBeenCalledTimes(1);
  });
});

describe("repairs after a crash", () => {
  it("puts the saved level on the film once it exists, then clears the note", async () => {
    const { film, env, duck, swap } = setup(0.28);
    swap(null);
    duck.repair(0.8);
    await vi.advanceTimersByTimeAsync(1200);
    expect(film.volume).toBe(0.28);
    swap(film);
    await vi.advanceTimersByTimeAsync(600);
    expect(film.volume).toBe(0.8);
    expect(env.clear).toHaveBeenCalled();
  });

  it("repairs at once when the film is already there", async () => {
    const { film, duck } = setup(0.28);
    duck.repair(0.8);
    expect(film.volume).toBe(0.8);
  });

  it("gives up after 20 s without a film", async () => {
    const { env, duck, swap } = setup();
    swap(null);
    duck.repair(0.8);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(env.clear).not.toHaveBeenCalled();
  });
});

describe("the saved note and the settings", () => {
  it("accepts only a well-formed note", () => {
    expect(isSaved({ service: "netflix", baseline: 0.8, ducking: true })).toBe(true);
    expect(isSaved({ service: "netflix", baseline: 0, ducking: true })).toBe(false);
    expect(isSaved({ service: "netflix", baseline: 1.5, ducking: true })).toBe(false);
    expect(isSaved({ service: "netflix", baseline: 0.8, ducking: false })).toBe(false);
    expect(isSaved({ baseline: 0.8, ducking: true })).toBe(false);
    expect(isSaved(null)).toBe(false);
  });

  it("is on and medium unless the person chose otherwise", () => {
    expect(duckFactor(undefined, undefined)).toBe(0.35);
    expect(duckFactor(true, "light")).toBe(0.6);
    expect(duckFactor(true, "strong")).toBe(0.15);
    expect(duckFactor(true, "loud")).toBe(0.35);
    expect(duckFactor(false, "strong")).toBeNull();
  });
});
