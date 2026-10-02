import { expect, test } from "vitest";
import { type NetflixMetadata, netflixTitle } from "./netflix-title";

// The shape window.netflix had on 2 October 2026 (Solo Leveling, S1:E1).
const meta = (show: unknown, episodic: boolean, season?: unknown, episode?: unknown) =>
  ({
    getTitle: () => show,
    getCurrentVideo: () => ({
      isEpisodic: () => episodic,
      _season: { _season: { seq: season } },
      _video: { seq: episode },
    }),
  }) satisfies NetflixMetadata;

test("an episode reads as show, season and episode", () => {
  expect(netflixTitle(meta("Solo Leveling", true, 1, 1))).toBe("Solo Leveling, S1:E1");
});

test("a film is just its title", () => {
  expect(netflixTitle(meta("Dune", false))).toBe("Dune");
});

test("missing or odd player data gives no name, never a throw", () => {
  expect(netflixTitle(undefined)).toBeNull();
  expect(netflixTitle(meta("", false))).toBeNull();
  expect(netflixTitle(meta(42, false))).toBeNull();
  expect(netflixTitle(meta("Solo Leveling", true, "one", 1))).toBe("Solo Leveling");
  const broken = {
    getTitle: () => {
      throw new Error("changed");
    },
    getCurrentVideo: () => null,
  } satisfies NetflixMetadata;
  expect(netflixTitle(broken)).toBeNull();
});
