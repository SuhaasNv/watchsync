// Room notices in the chat feed (US-113): same words as the page, merged leave and return,
// nothing about myself, and in time order with chat.
import {
  type AnyServerMessage,
  isServerMessage,
  type Participant,
  type Playback,
} from "@watchsync/protocol";
import { expect, test } from "vitest";
import { ActivityFeed, type RoomView } from "./activity";
import { renderLog } from "./chat-view";

const person = (id: string, name: string, titleId: string | null = "t1"): Participant => ({
  id,
  name,
  service: "mock",
  titleId,
  titleName: titleId && "Demo Show, E1",
  following: true,
  connected: true,
  hold: null,
  adLeft: null,
});
const clock = (position: number, status: "playing" | "paused" = "paused"): Playback => ({
  status,
  position,
  rate: 1,
  updatedAt: 0,
  titleId: "t1",
});
const view = (over: Partial<RoomView> = {}): RoomView => ({
  you: "me",
  media: { service: "mock", titleId: "t1", titleName: "Demo Show, E1", titleUrl: null },
  playback: clock(100),
  participants: [person("me", "Suhaas"), person("p1", "Maya")],
  ...over,
});
function msg(type: string, payload: unknown, timestamp = 1000): AnyServerMessage {
  const m = { id: "x", type, timestamp, payload };
  if (!isServerMessage(m)) throw new Error(`not a valid ${type}`);
  return m;
}
const playback = (action: string, at: number, byId = "p1") =>
  msg("PLAYBACK.STATE", { playback: clock(at), action, byId, byName: "Maya", serverTime: 0 });
const event = (event: string, p: Participant, timestamp: number) =>
  msg("ROOM.PARTICIPANT", { participant: p, event }, timestamp);

test("play, pause and jumps read as the on-page notices; my own are left out", () => {
  const feed = new ActivityFeed();
  feed.sync(view());
  feed.onServer(playback("pause", 100), view());
  feed.onServer(playback("seek", 2530), view());
  feed.onServer(playback("seek", 60), view());
  feed.onServer(playback("seek", 60.5), view()); // nothing visibly moved
  feed.onServer(playback("play", 60, "me"), view());
  expect(feed.items.map((i) => i.text)).toEqual([
    "Maya paused",
    "Maya skipped ahead to 42:10",
    "Maya went back to 1:00",
  ]);
});

test("joins, leaves, closing the show and the next episode; leave and return merge", () => {
  const feed = new ActivityFeed();
  feed.sync(view());
  const asha = person("p2", "Asha");
  feed.onServer(event("joined", asha, 1000), view());
  feed.onServer(event("left", asha, 2000), view());
  feed.onServer(event("rejoined", asha, 2000 + 60_000), view()); // within 2 min: one line
  feed.onServer(event("left", asha, 200_000), view());
  feed.onServer(event("rejoined", asha, 200_000 + 130_000), view()); // later: both lines
  feed.onServer(event("updated", person("p1", "Maya", null), 400_000), view());
  const media = { service: "mock", titleId: "t2", titleName: "Demo Show, E2", titleUrl: null };
  feed.onServer(msg("ROOM.MEDIA", { media, byId: "p1", byName: "Maya", how: "next" }), view());
  expect(feed.items.map((i) => i.text)).toEqual([
    "Asha joined",
    "Asha rejoined",
    "Asha left",
    "Asha rejoined",
    "Maya closed the show",
    "Maya moved on to Demo Show, E2",
  ]);
});

test("notices sit among chat messages in time order, styled apart", () => {
  const list = document.createElement("div");
  const chat = (id: string, serverTime: number) => ({
    id,
    clientId: id,
    fromId: "p1",
    name: "Maya",
    text: `msg ${id}`,
    movieTime: null,
    titleId: null,
    serverTime,
  });
  renderLog(list, {
    messages: [chat("1", 1000), chat("2", 3000)],
    outgoing: [],
    you: "me",
    people: [],
    fresh: null,
    activity: [
      { id: "a1", text: "Maya paused", at: 2000 },
      { id: "a2", text: "Asha joined", at: 4000 },
    ],
  });
  expect([...list.children].map((c) => `${c.className}:${c.textContent}`)).toEqual([
    "group:MMayamsg 1",
    "activity:Maya paused",
    "group:MMayamsg 2",
    "activity:Asha joined",
  ]);
});
