import type { ChatMessagePayload } from "@watchsync/protocol";
import { describe, expect, test } from "vitest";
import {
  announcement,
  capText,
  isEmojiOnly,
  type LogModel,
  movieClock,
  namesFor,
  newBelowLabel,
  renderLog,
  unseenAfter,
} from "./chat-view";

let n = 0;
const said = (
  fromId: string,
  name: string,
  text: string,
  movieTime: number | null = 2530,
  serverTime = 1000,
): ChatMessagePayload => ({
  id: `m${++n}`,
  clientId: `c${n}`,
  fromId,
  name,
  text,
  movieTime,
  titleId: "1",
  serverTime,
});

function draw(model: Partial<LogModel>): HTMLElement {
  const list = document.createElement("div");
  renderLog(list, { messages: [], outgoing: [], you: "me", people: [], fresh: null, ...model });
  return list;
}
const headers = (list: HTMLElement) => [...list.querySelectorAll(".who")].map((h) => h.textContent);
const rows = (list: HTMLElement) => [...list.querySelectorAll(".msg")].map((r) => r.textContent);

describe("chat list (US-042)", () => {
  test("movie times as the player shows them", () => {
    expect(movieClock(2530)).toBe("42:10");
    expect(movieClock(6130.9)).toBe("1:42:10");
    expect(movieClock(5)).toBe("0:05");
  });

  test("a header per sender with name and movie time; You for my own", () => {
    const list = draw({
      messages: [said("a", "Maya", "hi"), said("me", "Suhaas", "hello", null)],
    });
    expect(headers(list)).toEqual(["MMaya 42:10", "SYou"]);
    expect(list.querySelectorAll(".group.mine")).toHaveLength(1);
  });

  test("groups one person's messages within 2 minutes", () => {
    const list = draw({
      messages: [
        said("a", "Maya", "one", 10, 0),
        said("a", "Maya", "two", 20, 60_000),
        said("a", "Maya", "three", 30, 300_000),
      ],
    });
    expect(list.querySelectorAll(".group")).toHaveLength(2);
    expect(rows(list)).toEqual(["one", "two", "three"]);
  });

  test("tells namesakes apart in order of arrival", () => {
    const names = namesFor(
      [
        { id: "a", name: "Maya" },
        { id: "b", name: "Maya" },
        { id: "me", name: "Maya" },
        { id: "a", name: "Maya" },
      ],
      "me",
    );
    expect([...names.values()]).toEqual(["Maya", "Maya (2)", "You"]);
  });

  test("text is only ever text: HTML and links stay inert", () => {
    const evil = `<img src=x onerror="alert(1)"><a href="https://x.y">link</a>`;
    const list = draw({ messages: [said("a", `<b>Maya</b>`, evil)] });
    expect(list.querySelector("img, a, b")).toBeNull();
    expect(rows(list)).toEqual([evil]);
    expect(list.querySelector(".name")?.textContent).toBe("<b>Maya</b>");
    for (const el of list.querySelectorAll(".msg, .name"))
      expect(el.getAttribute("dir")).toBe("auto");
  });

  test("only the fresh live message animates", () => {
    const a = said("a", "Maya", "old");
    const b = said("a", "Maya", "new");
    const list = draw({ messages: [a, b], fresh: b.id });
    expect([...list.querySelectorAll(".fresh")].map((r) => r.textContent)).toEqual(["new"]);
  });

  test("sending states: quiet, then Sending…, then Not sent with Retry or a reason", () => {
    const list = draw({
      outgoing: [
        { clientId: "c-1", text: "one", state: "sending" },
        { clientId: "c-2", text: "two", state: "slow" },
        { clientId: "c-3", text: "three", state: "failed" },
        { clientId: "c-4", text: "four", state: "failed", reason: "It can't be sent as it is." },
      ],
    });
    expect(rows(list)).toEqual([
      "one",
      "twoSending…",
      "threeNot sentRetry",
      "fourNot sent. It can't be sent as it is.",
    ]);
    const retry = list.querySelectorAll<HTMLButtonElement>("button[data-retry]");
    expect([...retry].map((b) => b.dataset.retry)).toEqual(["c-3"]);
  });

  test("keeps at most 200 messages", () => {
    const many = Array.from({ length: 205 }, (_, i) =>
      said("a", "Maya", `m${i}`, null, i * 999_999),
    );
    const list = draw({ messages: many });
    expect(list.querySelectorAll(".msg")).toHaveLength(200);
  });
});

describe("announcements and the length cap", () => {
  test("one message is read out; a burst is summed up", () => {
    expect(announcement([])).toBe("");
    expect(announcement([{ name: "Asha", text: "hi" }])).toBe("Asha: hi");
    const asha = { name: "Asha", text: "x" };
    expect(announcement([asha, asha, asha])).toBe("3 new messages from Asha");
    expect(announcement([asha, { name: "Ravi", text: "y" }])).toBe("2 new messages");
  });

  test("500 characters, counted in code points, never splitting an emoji", () => {
    expect(capText("x".repeat(600))).toHaveLength(500);
    const emoji = "😀".repeat(501);
    expect(Array.from(capText(emoji))).toHaveLength(500);
    const family = "👨\u{200d}👩\u{200d}👧"; // 5 code points, one character
    const capped = capText(`${"x".repeat(497)}${family}`);
    expect(capped).toBe("x".repeat(497)); // the family doesn't fit whole: it isn't cut
    expect(capText("short")).toBe("short");
  });
});

test("one person's next group sits closer than another person's", () => {
  const list = draw({
    messages: [
      said("a", "Maya", "one", null, 1000),
      said("a", "Maya", "later", null, 1000 + 5 * 60_000),
      said("b", "Asha", "hi", null, 1000 + 6 * 60_000),
    ],
  });
  const groups = [...list.querySelectorAll(".group")];
  expect(groups.map((g) => g.classList.contains("same"))).toEqual([false, true, false]);
});

describe("emoji-only messages", () => {
  test("one to three emoji, nothing else, show larger", () => {
    expect(isEmojiOnly("😂😂")).toBe(true);
    expect(isEmojiOnly(" 👨‍👩‍👧❤️🔥 ")).toBe(true); // a family is one character
    expect(isEmojiOnly("😂😂😂😂")).toBe(false);
    expect(isEmojiOnly("lol 😂")).toBe(false);
    expect(isEmojiOnly("12")).toBe(false);
    expect(isEmojiOnly("")).toBe(false);
  });

  test("the row gets the emoji class", () => {
    const list = draw({ messages: [said("a", "Maya", "😂😂")] });
    expect(list.querySelector(".msg")?.classList.contains("emoji")).toBe(true);
  });
});

describe("the new messages chip", () => {
  test("never counts at the bottom; counts what lands below a reader who scrolled up", () => {
    expect(unseenAfter(0, true, 3)).toBe(0);
    expect(unseenAfter(2, true, 1)).toBe(0);
    expect(unseenAfter(0, false, 1)).toBe(1);
    expect(unseenAfter(1, false, 2)).toBe(3);
    expect(unseenAfter(0, false, 0)).toBe(0); // a room notice or a resend is not a new message
  });

  test("says how many", () => {
    expect(newBelowLabel(1)).toBe("1 new message");
    expect(newBelowLabel(2)).toBe("2 new messages");
  });
});
