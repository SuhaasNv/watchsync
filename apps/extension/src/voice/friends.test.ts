import { describe, expect, it } from "vitest";
import {
  changeFriend,
  type FriendSetting,
  type FriendStore,
  FULL,
  friendHeard,
  friendKey,
  isPeople,
  KEEP_MS,
  muteToggle,
  playback,
  readFriends,
  roomFriends,
  settingOf,
  silenced,
  tidy,
  volumePatch,
} from "./friends";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("friend settings are kept per room and per name", () => {
  it("is case and space blind, so a rejoin under a new member id finds the setting", () => {
    expect(friendKey("  Asha ")).toBe("asha");
    const store = changeFriend({}, "ROOM1", "Asha", { muted: true }, NOW);
    expect(settingOf(store, "ROOM1", "ASHA")).toEqual({ muted: true, volume: 100 });
    expect(settingOf(store, "ROOM1", " asha ")).toEqual({ muted: true, volume: 100 });
  });

  it("starts a new room, or a new name, at full volume", () => {
    const store = changeFriend({}, "ROOM1", "Asha", { muted: true }, NOW);
    expect(settingOf(store, "ROOM2", "Asha")).toEqual(FULL);
    expect(settingOf(store, "ROOM1", "Ben")).toEqual(FULL);
  });

  it("keeps the volume when muting, and forgets a friend put back to the default", () => {
    let store = changeFriend({}, "R", "Asha", { volume: 40 }, NOW);
    store = changeFriend(store, "R", "Asha", { muted: true }, NOW);
    expect(settingOf(store, "R", "Asha")).toEqual({ muted: true, volume: 40 });
    store = changeFriend(store, "R", "Asha", { muted: false, volume: 100 }, NOW);
    expect(store).toEqual({});
  });

  it("holds the volume between 0 and 100", () => {
    expect(settingOf(changeFriend({}, "R", "A", { volume: 250 }, NOW), "R", "A").volume).toBe(100);
    expect(settingOf(changeFriend({}, "R", "A", { volume: -5 }, NOW), "R", "A").volume).toBe(0);
    expect(settingOf(changeFriend({}, "R", "A", { volume: 33.4 }, NOW), "R", "A").volume).toBe(33);
  });

  it("gives the room's people to the voice document", () => {
    const store = changeFriend({}, "R", "Asha", { volume: 20 }, NOW);
    expect(roomFriends(store, "R")).toEqual({ asha: { muted: false, volume: 20 } });
    expect(roomFriends(store, "other")).toEqual({});
  });
});

describe("muting and the volume", () => {
  it("0 counts as muted, and Unmute for me brings a silenced friend back to something audible", () => {
    expect(silenced({ muted: false, volume: 0 })).toBe(true);
    expect(silenced({ muted: true, volume: 80 })).toBe(true);
    expect(silenced({ muted: false, volume: 1 })).toBe(false);
    expect(muteToggle(FULL)).toEqual({ muted: true });
    expect(muteToggle({ muted: true, volume: 60 })).toEqual({ muted: false, volume: 60 });
    expect(muteToggle({ muted: false, volume: 0 })).toEqual({ muted: false, volume: 100 });
  });

  it("raising the volume of a muted friend un-mutes them", () => {
    expect(volumePatch(30)).toEqual({ volume: 30, muted: false });
  });

  it("sets the audio element, never the track", () => {
    expect(playback(FULL)).toEqual({ muted: false, volume: 1 });
    expect(playback({ muted: false, volume: 35 })).toEqual({ muted: false, volume: 0.35 });
    expect(playback({ muted: true, volume: 80 })).toEqual({ muted: true, volume: 0.8 });
    expect(playback({ muted: false, volume: 0 })).toEqual({ muted: true, volume: 0 });
  });
});

describe("rooms not seen for 30 days are forgotten", () => {
  const setting: FriendSetting = { muted: true, volume: 100 };
  const store: FriendStore = {
    OLD: { seen: NOW - KEEP_MS - 1, people: { asha: setting } },
    EDGE: { seen: NOW - KEEP_MS, people: { asha: setting } },
    NEW: { seen: NOW - DAY, people: { ben: setting } },
  };

  it("drops only the rooms past the limit", () => {
    const kept = tidy(store, undefined, NOW);
    expect(Object.keys(kept).sort()).toEqual(["EDGE", "NEW"]);
  });

  it("notes the room in use as seen, once a day at most", () => {
    const touched = tidy(store, "EDGE", NOW);
    expect(touched.EDGE?.seen).toBe(NOW);
    const soon = { R: { seen: NOW - 1000, people: { a: setting } } };
    expect(tidy(soon, "R", NOW)).toBe(soon);
  });

  it("gives back the same object when there is nothing to do", () => {
    const fresh = { R: { seen: NOW, people: { a: setting } } };
    expect(tidy(fresh, "R", NOW)).toBe(fresh);
  });

  it("changing a friend marks the room as seen now", () => {
    const next = changeFriend(store, "NEW", "Ben", { volume: 10 }, NOW);
    expect(next.NEW?.seen).toBe(NOW);
  });
});

describe("what storage may hold", () => {
  it("keeps what is well formed and drops the rest", () => {
    const store = readFriends({
      R: {
        seen: 5,
        people: { asha: { muted: true, volume: 20 }, ben: { muted: "yes", volume: 20 } },
      },
      BAD: { seen: "x", people: {} },
      WORSE: 7,
    });
    expect(store).toEqual({ R: { seen: 5, people: { asha: { muted: true, volume: 20 } } } });
    expect(readFriends(null)).toEqual({});
    expect(readFriends([1, 2])).toEqual({});
  });

  it("checks the people it sends to the voice document", () => {
    expect(isPeople({})).toBe(true);
    expect(isPeople({ asha: { muted: false, volume: 50 } })).toBe(true);
    expect(isPeople({ asha: { muted: false, volume: 150 } })).toBe(false);
    expect(isPeople({ asha: { muted: false, volume: 0.5 } })).toBe(false);
    expect(isPeople({ asha: { muted: 0, volume: 50 } })).toBe(false);
    expect(isPeople(null)).toBe(false);
    expect(isPeople([])).toBe(false);
  });
});

describe("the film dips only for a friend I can hear", () => {
  const ids: Record<string, FriendSetting> = {
    asha: { muted: true, volume: 100 },
    ben: { muted: false, volume: 0 },
    cy: { muted: false, volume: 30 },
  };
  const of = (id: string) => ids[id] ?? FULL;

  it("ignores a friend I muted or turned to 0", () => {
    expect(friendHeard(["asha"], "me", of)).toBe(false);
    expect(friendHeard(["ben"], "me", of)).toBe(false);
  });

  it("still dips for a friend turned down but not to 0", () => {
    expect(friendHeard(["cy"], "me", of)).toBe(true);
  });

  it("dips if any one of several speakers can be heard, and never for me", () => {
    expect(friendHeard(["asha", "dee"], "me", of)).toBe(true);
    expect(friendHeard(["me"], "me", of)).toBe(false);
    expect(friendHeard([], "me", of)).toBe(false);
  });
});
