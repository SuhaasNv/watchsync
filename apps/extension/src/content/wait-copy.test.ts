import { describe, expect, test } from "vitest";
import { type Waiting, waitCopy } from "./wait-copy";

const ad = (name: string, adLeft: number | null = null): Waiting => ({ name, hold: "ad", adLeft });
const load = (name: string): Waiting => ({ name, hold: "buffering", adLeft: null });

describe("waitCopy", () => {
  test("one ad names its owner and how long is left", () => {
    expect(waitCopy([ad("Asha", 20)], false)).toEqual({
      text: "Waiting for Asha's ad",
      detail: "Paused for everyone until the ad ends. About 0:20 left.",
    });
  });

  test("an ad with no time on the page says no time", () => {
    expect(waitCopy([ad("Asha")], false).detail).toBe("Paused for everyone until the ad ends.");
  });

  test("two or more ads say so without names", () => {
    expect(waitCopy([ad("Asha", 20), ad("Ravi", 5)], false)).toEqual({
      text: "Waiting for ads to finish",
      detail: "Paused for everyone until the ads end.",
    });
  });

  test("buffering never says ad", () => {
    const { text, detail } = waitCopy([load("Asha")], false);
    expect(text).toBe("Waiting for Asha to load");
    expect(`${text} ${detail}`).not.toMatch(/\bads?\b/i);
  });

  test("an ad and a slow load together name the first person and don't claim they're all ads", () => {
    expect(waitCopy([load("Asha"), ad("Ravi")], false).text).toBe("Waiting for Asha to load");
  });

  test("after a long wait the card keeps the countdown", () => {
    expect(waitCopy([ad("Asha", 65)], true).detail).toBe(
      "This is taking a while. Play on now and Asha can catch up later. About 1:05 left.",
    );
  });
});
