// Only the chat frame the tab's own content script loaded is served (UC-013, DEC-042).
import { expect, test } from "vitest";
import { ChatFrames } from "./chat-frames";

const FRAME = "chrome-extension://abcdef/sidebar.html#n1";
const contentScript = { tab: { id: 7 }, frameId: 0, url: "https://www.netflix.com/watch/1" };
const ourFrame = { tab: { id: 7 }, frameId: 3, url: FRAME };
const hello = (nonce: string) => ({ kind: "hello", nonce });

function issued() {
  const frames = new ChatFrames(() => "n1");
  expect(frames.issue(contentScript)).toBe("n1");
  return frames;
}

test("the frame with its tab's pass is served, once", () => {
  const frames = issued();
  expect(frames.admit(ourFrame, hello("n1"))).toBe(true);
  expect(frames.admit(ourFrame, hello("n1"))).toBe(false);
});

test("a wrong or missing pass is refused", () => {
  const frames = issued();
  expect(frames.admit(ourFrame, hello("guess"))).toBe(false);
  expect(frames.admit(ourFrame, { kind: "close" })).toBe(false);
  expect(frames.admit(ourFrame, "n1")).toBe(false);
  expect(frames.admit(ourFrame, hello("n1"))).toBe(true); // a wrong try doesn't burn it
});

test("a pass is only good in the tab it was issued to", () => {
  const frames = issued();
  expect(frames.admit({ ...ourFrame, tab: { id: 8 } }, hello("n1"))).toBe(false);
});

test("the top frame, another page or another extension page can't use it", () => {
  const frames = issued();
  expect(frames.admit({ ...ourFrame, frameId: 0 }, hello("n1"))).toBe(false);
  expect(frames.admit({ ...ourFrame, url: "https://evil.example/sidebar.html" }, hello("n1"))).toBe(
    false,
  );
  expect(
    frames.admit({ ...ourFrame, url: "chrome-extension://abcdef/popup.html" }, hello("n1")),
  ).toBe(false);
  expect(frames.admit(undefined, hello("n1"))).toBe(false);
});

test("only a tab's top frame gets a pass, and a new one replaces the old", () => {
  let n = 0;
  const frames = new ChatFrames(() => `n${++n}`);
  expect(frames.issue({ ...contentScript, frameId: 2 })).toBeNull();
  expect(frames.issue({ frameId: 0 })).toBeNull();
  expect(frames.issue(contentScript)).toBe("n1");
  expect(frames.issue(contentScript)).toBe("n2");
  expect(frames.admit(ourFrame, hello("n1"))).toBe(false);
  expect(frames.admit(ourFrame, hello("n2"))).toBe(true);
});

test("a closed tab's pass is gone", () => {
  const frames = issued();
  frames.forget(7);
  expect(frames.admit(ourFrame, hello("n1"))).toBe(false);
});
