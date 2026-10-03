// Only the chat frame the tab's own content script loaded is served, and chat goes only to
// chat frames (UC-013, DEC-042).
import { expect, test } from "vitest";
import { ChatFrames, PASS_MS, wantsServerMessage } from "./chat-frames";

const FRAME = "chrome-extension://abcdef/sidebar.html#n1";
const contentScript = { tab: { id: 7 }, frameId: 0, url: "https://www.netflix.com/watch/1" };
const ourFrame = { tab: { id: 7 }, frameId: 3, url: FRAME };
const hello = (nonce: string) => ({ kind: "hello", nonce });

function issued(now: () => number = () => 0) {
  const frames = new ChatFrames(() => "n1", now);
  expect(frames.issue(contentScript)).toBe("n1");
  return frames;
}

test("the frame with its tab's pass is served, once", () => {
  const frames = issued();
  expect(frames.admit(ourFrame, hello("n1"))).toBe("n1");
  expect(frames.admit(ourFrame, hello("n1"))).toBeNull();
});

test("a wrong or missing pass is refused", () => {
  const frames = issued();
  expect(frames.admit(ourFrame, hello("guess"))).toBeNull();
  expect(frames.admit(ourFrame, { kind: "close" })).toBeNull();
  expect(frames.admit(ourFrame, "n1")).toBeNull();
  expect(frames.admit(ourFrame, hello("n1"))).toBe("n1"); // a wrong try doesn't burn it
});

test("a pass is only good in the tab it was issued to", () => {
  const frames = issued();
  expect(frames.admit({ ...ourFrame, tab: { id: 8 } }, hello("n1"))).toBeNull();
});

test("the top frame, another page or another extension page can't use it", () => {
  const frames = issued();
  expect(frames.admit({ ...ourFrame, frameId: 0 }, hello("n1"))).toBeNull();
  expect(
    frames.admit({ ...ourFrame, url: "https://evil.example/sidebar.html" }, hello("n1")),
  ).toBeNull();
  expect(
    frames.admit({ ...ourFrame, url: "chrome-extension://abcdef/popup.html" }, hello("n1")),
  ).toBeNull();
  expect(frames.admit(undefined, hello("n1"))).toBeNull();
});

test("only a tab's top frame gets a pass, and a new one replaces the old", () => {
  let n = 0;
  const frames = new ChatFrames(() => `n${++n}`);
  expect(frames.issue({ ...contentScript, frameId: 2 })).toBeNull();
  expect(frames.issue({ frameId: 0 })).toBeNull();
  expect(frames.issue(contentScript)).toBe("n1");
  expect(frames.issue(contentScript)).toBe("n2");
  expect(frames.admit(ourFrame, hello("n1"))).toBeNull();
  expect(frames.admit(ourFrame, hello("n2"))).toBe("n2");
});

test("a closed tab's pass is gone", () => {
  const frames = issued();
  frames.forget(7);
  expect(frames.admit(ourFrame, hello("n1"))).toBeNull();
});

test("an unused pass expires after 10 s, and an expired try burns it", () => {
  let now = 0;
  const frames = issued(() => now);
  now = PASS_MS + 1;
  expect(frames.admit(ourFrame, hello("n1"))).toBeNull();
  now = 0;
  expect(frames.admit(ourFrame, hello("n1"))).toBeNull(); // gone, not left behind
  const fresh = issued(() => now);
  now = PASS_MS;
  expect(fresh.admit(ourFrame, hello("n1"))).toBe("n1");
});

test("chat goes only to chat frames; the rest never to them", () => {
  expect(wantsServerMessage("sidebar", "CHAT.MESSAGE")).toBe(true);
  expect(wantsServerMessage("sidebar", "CHAT.HISTORY")).toBe(true);
  expect(wantsServerMessage("tab", "CHAT.MESSAGE")).toBe(false);
  expect(wantsServerMessage("tab", "CHAT.HISTORY")).toBe(false);
  expect(wantsServerMessage("popup", "CHAT.MESSAGE")).toBe(false);
  expect(wantsServerMessage("tab", "PLAYBACK.STATE")).toBe(true);
  expect(wantsServerMessage("popup", "ROOM.STATE")).toBe(true);
  // The feed's room notices (US-113); nothing else that isn't chat.
  expect(wantsServerMessage("sidebar", "PLAYBACK.STATE")).toBe(true);
  expect(wantsServerMessage("sidebar", "ROOM.PARTICIPANT")).toBe(true);
  expect(wantsServerMessage("sidebar", "ROOM.MEDIA")).toBe(true);
  expect(wantsServerMessage("sidebar", "ROOM.STATE")).toBe(false);
  expect(wantsServerMessage("sidebar", "START.STATE")).toBe(false);
});
