// What the adapters do with stored rules (US-124): use them when they are good and in date,
// and the bundled ones in every other case.
import { afterEach, expect, test, vi } from "vitest";
import { netflixMedia } from "../content/providers";
import { adoptStoredRules, rules } from "./active";
import { BUNDLED_RULES } from "./bundled";
import type { RulesFile } from "./schema";

const stored = (
  over: Partial<RulesFile["rules"]["netflix"]>,
  expires = "2099-01-01T00:00:00Z",
) => ({
  nextCheckAt: 0,
  file: {
    schema: 1,
    seq: 4,
    expires,
    rules: { ...BUNDLED_RULES, netflix: { ...BUNDLED_RULES.netflix, ...over } },
  },
});

function storage(value: unknown) {
  vi.stubGlobal("chrome", { storage: { local: { get: async () => ({ rules: value }) } } });
}

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const URL_ = new URL("https://www.netflix.com/watch/1");

afterEach(async () => {
  storage(undefined);
  await adoptStoredRules();
  vi.unstubAllGlobals();
});

test("stored rules change what the adapter reads, with no new code", async () => {
  const page = doc(`<div class="new-title">Dark</div><div data-uia="video-title">Old</div>`);
  expect(netflixMedia(URL_, page, null)?.titleName).toBe("Old");
  storage(stored({ titleSelector: ".new-title", driftToleranceSec: 0.3 }));
  await adoptStoredRules();
  expect(netflixMedia(URL_, page, null)?.titleName).toBe("Dark");
  expect(rules().netflix.driftToleranceSec).toBe(0.3);
});

test("an expired file, a selector the page can't parse, or junk leaves the bundled rules", async () => {
  for (const value of [
    stored({ titleSelector: ".x" }, "2020-01-01T00:00:00Z"),
    stored({ titleSelector: "div[" }),
    { nextCheckAt: 0, file: { seq: 1 } },
    "junk",
  ]) {
    storage(value);
    await adoptStoredRules();
    expect(rules()).toEqual(BUNDLED_RULES);
  }
});

test("storage that fails leaves the bundled rules", async () => {
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async () => {
          throw new Error("storage gone");
        },
      },
    },
  });
  await adoptStoredRules();
  expect(rules()).toEqual(BUNDLED_RULES);
});
