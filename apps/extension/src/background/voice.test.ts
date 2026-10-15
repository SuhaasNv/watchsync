import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("./connection", () => ({ sendServer: vi.fn() }));

const calls: string[] = [];

/** A fresh copy of the module (its "wanted" flag is module state), in a room that offers voice. */
async function room(create: () => Promise<void>) {
  vi.resetModules();
  vi.stubGlobal("chrome", {
    offscreen: {
      Reason: { USER_MEDIA: "USER_MEDIA", WEB_RTC: "WEB_RTC", AUDIO_PLAYBACK: "AUDIO_PLAYBACK" },
      createDocument: vi.fn(() => {
        calls.push("create");
        return create();
      }),
      closeDocument: vi.fn(() => {
        calls.push("close");
        return Promise.resolve();
      }),
    },
  });
  const { state } = await import("./state");
  state.session = { code: "ABC123", token: "t", participantId: "me" };
  state.connection = "connected";
  state.participants = [
    {
      id: "me",
      name: "Me",
      service: "mock",
      titleId: "ep1",
      titleName: null,
      following: true,
      connected: true,
      hold: null,
      adLeft: null,
      canTalk: true,
    },
  ];
  return import("./voice");
}

beforeEach(() => calls.splice(0));
afterEach(() => vi.unstubAllGlobals());

test("a voice document left from before a worker restart is closed and replaced", async () => {
  let first = true;
  const { voiceWatching } = await room(() => {
    if (!first) return Promise.resolve();
    first = false;
    return Promise.reject(new Error("Only a single offscreen document may be created."));
  });
  voiceWatching(true, 1);
  await vi.waitFor(() => expect(calls).toEqual(["create", "close", "create"]));
});

test("with no stale document, it is created once and nothing is closed", async () => {
  const { voiceWatching } = await room(() => Promise.resolve());
  voiceWatching(true, 1);
  await vi.waitFor(() => expect(calls).toEqual(["create"]));
});
