import { describe, expect, test } from "vitest";
import {
  CHECK_EVERY,
  compareVersions,
  fromStore,
  isUpdate,
  latestRelease,
  parseRelease,
  parseVersion,
  type UpdateCheck,
} from "./update";

const v = (s: string) => {
  const parsed = parseVersion(s);
  if (!parsed) throw new Error(`bad version ${s}`);
  return parsed;
};
const PAGE = "https://github.com/SuhaasNv/watchsync/releases/tag/v0.1.1";

describe("versions", () => {
  test("parses plain, v-prefixed and release candidate versions", () => {
    expect(parseVersion("0.1.0")).toEqual({ major: 0, minor: 1, patch: 0, rc: null });
    expect(parseVersion("v1.2.3-rc.4")).toEqual({ major: 1, minor: 2, patch: 3, rc: 4 });
    for (const bad of ["", "1.2", "v1.2.3-beta.1", "1.2.3-rc", "1.2.3.4", " 1.2.3", "x1.2.3"])
      expect(parseVersion(bad)).toBeNull();
  });

  test("orders release candidates before their final release", () => {
    const ordered = ["0.1.0-rc.1", "0.1.0-rc.2", "0.1.0-rc.10", "0.1.0", "0.1.1-rc.1", "0.2.0"];
    for (let i = 1; i < ordered.length; i++) {
      const [a, b] = [v(ordered[i - 1] ?? ""), v(ordered[i] ?? "")];
      expect(compareVersions(a, b)).toBeLessThan(0);
      expect(compareVersions(b, a)).toBeGreaterThan(0);
    }
    expect(compareVersions(v("0.1.0"), v("v0.1.0"))).toBe(0);
    expect(compareVersions(v("0.10.0"), v("0.9.9"))).toBeGreaterThan(0);
  });

  test("offers an update only when the release's base version is higher", () => {
    expect(isUpdate("v0.1.1", "0.1.0")).toBe(true);
    expect(isUpdate("v0.2.0-rc.1", "0.1.0")).toBe(true);
    expect(isUpdate("v1.0.0", "0.9.9")).toBe(true);
    // The rc zip carries manifest 0.1.0 too, so neither of these is news.
    expect(isUpdate("v0.1.0", "0.1.0")).toBe(false);
    expect(isUpdate("v0.1.0-rc.2", "0.1.0")).toBe(false);
    expect(isUpdate("v0.0.9", "0.1.0")).toBe(false);
    expect(isUpdate("nonsense", "0.1.0")).toBe(false);
  });
});

describe("release from GitHub", () => {
  test("keeps a well-formed tag and our own release page", () => {
    expect(parseRelease({ tag_name: "v0.1.1", html_url: PAGE, body: "x" })).toEqual({
      version: "0.1.1",
      url: PAGE,
    });
  });

  test("rejects anything else", () => {
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease({ message: "Not Found" })).toBeNull();
    expect(parseRelease({ tag_name: "latest", html_url: PAGE })).toBeNull();
    expect(parseRelease({ tag_name: "v0.1.1", html_url: "https://evil.example/" })).toBeNull();
    expect(parseRelease({ tag_name: "v0.1.1", html_url: "javascript:alert(1)" })).toBeNull();
  });
});

describe("checking at most once a day", () => {
  const NOW = 1_000_000_000_000;
  function deps(cached: unknown, fetchLatest: () => Promise<unknown>) {
    const saved: UpdateCheck[] = [];
    let calls = 0;
    return {
      saved,
      calls: () => calls,
      deps: {
        now: NOW,
        load: async () => cached,
        save: async (c: UpdateCheck) => {
          saved.push(c);
        },
        fetchLatest: () => {
          calls++;
          return fetchLatest();
        },
      },
    };
  }
  const release = async () => ({ tag_name: "v0.1.1", html_url: PAGE });

  test("asks GitHub when nothing is cached, and remembers the answer", async () => {
    const d = deps(undefined, release);
    expect(await latestRelease(d.deps)).toEqual({ version: "0.1.1", url: PAGE });
    expect(d.saved).toEqual([{ checkedAt: NOW, latest: { version: "0.1.1", url: PAGE } }]);
  });

  test("uses a check from under a day ago without asking again", async () => {
    const latest = { version: "0.1.1", url: PAGE };
    const d = deps({ checkedAt: NOW - CHECK_EVERY + 1000, latest }, release);
    expect(await latestRelease(d.deps)).toEqual(latest);
    expect(d.calls()).toBe(0);
    expect(d.saved).toEqual([]);
  });

  test("asks again after a day, or when the clock went backwards", async () => {
    for (const checkedAt of [NOW - CHECK_EVERY, NOW + 60_000]) {
      const d = deps({ checkedAt, latest: null }, release);
      expect(await latestRelease(d.deps)).toEqual({ version: "0.1.1", url: PAGE });
      expect(d.calls()).toBe(1);
    }
  });

  test("a failed lookup keeps what it knew and waits a day before retrying", async () => {
    const latest = { version: "0.1.1", url: PAGE };
    const d = deps({ checkedAt: NOW - 2 * CHECK_EVERY, latest }, () =>
      Promise.reject(new Error("offline")),
    );
    expect(await latestRelease(d.deps)).toEqual(latest);
    expect(d.saved).toEqual([{ checkedAt: NOW, latest }]);
    const fresh = deps(undefined, () => Promise.reject(new Error("timeout")));
    expect(await latestRelease(fresh.deps)).toBeNull();
    expect(fresh.saved).toEqual([{ checkedAt: NOW, latest: null }]);
  });

  test("ignores a malformed cache", async () => {
    for (const bad of [null, "x", { checkedAt: "now" }, { checkedAt: NOW, latest: { url: 1 } }]) {
      const d = deps(bad, release);
      await latestRelease(d.deps);
      expect(d.calls()).toBe(1);
    }
  });
});

describe("store installs", () => {
  test("a manifest with an update_url came from the Chrome Web Store", () => {
    expect(fromStore({ update_url: "https://clients2.google.com/service/update2/crx" })).toBe(true);
    expect(fromStore({})).toBe(false);
    expect(fromStore({ update_url: "" })).toBe(false);
    expect(fromStore({ update_url: 1 })).toBe(false);
  });
});

describe("dev channel (DEC-026)", () => {
  const DEV_PAGE = "https://github.com/SuhaasNv/watchsync/releases/tag/dev-latest";

  test("reads the rolling dev release as its short commit", () => {
    const release = { tag_name: "dev-latest", html_url: DEV_PAGE, target_commitish: "3dc4308aa1" };
    expect(parseRelease(release)).toEqual({ version: "3dc4308", url: DEV_PAGE });
  });

  test("refuses a dev release without a commit or off our pages", () => {
    expect(
      parseRelease({ tag_name: "dev-latest", html_url: DEV_PAGE, target_commitish: "dev" }),
    ).toBeNull();
    expect(
      parseRelease({
        tag_name: "dev-latest",
        html_url: "https://evil.example/",
        target_commitish: "3dc4308",
      }),
    ).toBeNull();
  });
});
