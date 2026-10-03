import type { Media, Playback } from "@watchsync/protocol";
import { expect, test } from "vitest";
import { restoreMessage } from "./restore";

const media: Media = { service: "mock", titleId: "ep1", titleName: "Demo", titleUrl: null };
const playing: Playback = {
  status: "playing",
  position: 100,
  rate: 1,
  updatedAt: 1_000_000,
  titleId: "ep1",
};

test("after a restarting close, tells the room what it was watching, moved on to now", () => {
  const msg = restoreMessage({ media, playback: playing }, null, true, 1_010_000);
  expect(msg?.type).toBe("ROOM.RESTORE");
  expect(msg?.payload.media).toEqual(media);
  expect(msg?.payload.playback?.position).toBe(110); // 10 s later at 1x
  expect(msg?.payload.knownAt).toBe(1_000_000); // how recent: the old service's time
});

test("a paused clock stays where it was", () => {
  const paused: Playback = { ...playing, status: "paused" };
  const msg = restoreMessage({ media, playback: paused }, null, true, 1_010_000);
  expect(msg?.payload.playback?.position).toBe(100);
});

test("no restore without a restarting close: an offline client must not rewind the room", () => {
  expect(restoreMessage({ media, playback: playing }, null, false, 1_010_000)).toBeNull();
});

test("no restore when the room has its title, or when we knew none", () => {
  expect(restoreMessage({ media, playback: playing }, media, true, 1_010_000)).toBeNull();
  expect(restoreMessage({ media: null, playback: null }, null, true, 1_010_000)).toBeNull();
});

test("a title without a clock is still worth telling, as the oldest knowledge", () => {
  const msg = restoreMessage({ media, playback: null }, null, true, 1_010_000);
  expect(msg?.payload).toEqual({ media, playback: null, knownAt: 0 });
});
