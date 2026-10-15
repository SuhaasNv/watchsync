import { envelope, isServerMessage, type Participant } from "@watchsync/protocol";
import { describe, expect, it } from "vitest";
import { cannotTalk, updateToTalk, voiceAvailable, voiceOffer } from "./capability";

const person = (name: string, extra: Partial<Participant> = {}): Participant => ({
  id: name,
  name,
  service: "none",
  titleId: null,
  titleName: null,
  following: true,
  connected: true,
  hold: null,
  adLeft: null,
  ...extra,
});

/** What a v0.2 room service sends: no canTalk (a v0.3 service does the same to old clients). */
const oldShape = [person("Asha"), person("Ben")];
const newShape = [person("Asha", { canTalk: true }), person("Ben", { canTalk: false })];

const state = (participants: Participant[]) => ({
  id: "1",
  type: "ROOM.STATE",
  timestamp: 1,
  payload: {
    code: "ABCDEF",
    you: "Asha",
    participants,
    media: null,
    playback: null,
    serverTime: 1,
  },
});

describe("the v0.3 client accepts both room shapes (US-132)", () => {
  it("takes a ROOM.STATE without canTalk, as an older room service sends it", () => {
    expect(isServerMessage(state(oldShape))).toBe(true);
  });

  it("takes a ROOM.STATE with canTalk", () => {
    expect(isServerMessage(state(newShape))).toBe(true);
  });

  it("takes a ROOM.PARTICIPANT in either shape", () => {
    for (const participant of [oldShape[0], newShape[0]]) {
      const msg = envelope("ROOM.PARTICIPANT", { participant, event: "updated" });
      expect(isServerMessage(msg)).toBe(true);
    }
  });

  it("still refuses a field it does not know", () => {
    const stranger = { ...person("Asha"), voiceLevel: 3 };
    expect(isServerMessage(state([stranger]))).toBe(false);
  });
});

describe("who can talk", () => {
  it("offers voice only when everyone can", () => {
    expect(voiceAvailable([person("A", { canTalk: true }), person("B", { canTalk: true })])).toBe(
      true,
    );
    expect(voiceAvailable(newShape)).toBe(false);
    expect(voiceAvailable([])).toBe(false);
  });

  it("reads a missing canTalk as can't, so an older room service never offers a call", () => {
    expect(voiceAvailable(oldShape)).toBe(false);
    expect(cannotTalk(oldShape).map((p) => p.name)).toEqual(["Asha", "Ben"]);
  });

  it("offers voice for up to four people who are here, and says why not otherwise", () => {
    const can = (name: string, extra: Partial<Participant> = {}) =>
      person(name, { canTalk: true, ...extra });
    const four = ["A", "B", "C", "D"].map((n) => can(n));
    expect(voiceOffer(four)).toBe("ok");
    expect(voiceOffer([...four, can("E")])).toBe("full");
    // Someone away doesn't take a place, and doesn't block voice either.
    expect(voiceOffer([...four, can("E", { connected: false })])).toBe("ok");
    expect(voiceOffer([...four.slice(0, 2), person("Old")])).toBe("update");
    expect(voiceOffer([...four.slice(0, 2), person("Old", { connected: false })])).toBe("ok");
    // An old person wins over a crowd: they must update first.
    expect(voiceOffer([...four, person("Old")])).toBe("update");
  });

  it("names who needs to update", () => {
    expect(cannotTalk(newShape).map((p) => p.name)).toEqual(["Ben"]);
    expect(updateToTalk(["Asha"])).toBe("Asha needs to update WatchSync to talk.");
    expect(updateToTalk(["Asha", "Ben"])).toBe("Asha and Ben need to update WatchSync to talk.");
    expect(updateToTalk(["Asha", "Ben", "Cy"])).toBe(
      "Asha, Ben and Cy need to update WatchSync to talk.",
    );
    expect(updateToTalk([])).toBe("");
  });
});
