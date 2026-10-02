import { describe, expect, it } from "vitest";
import { checksumFor, parseReleases, safeGithubUrl, versionLabel } from "./releases";

const release = {
  tag_name: "v0.1.0-rc.1",
  name: "WatchSync v0.1.0",
  html_url: "https://github.com/SuhaasNv/watchsync/releases/tag/v0.1.0-rc.1",
  published_at: "2026-10-02T10:00:00Z",
  body: "### Added\n- Rooms",
  draft: false,
  prerelease: false,
  assets: [
    {
      name: "watchsync-extension.zip",
      browser_download_url:
        "https://github.com/SuhaasNv/watchsync/releases/download/v0.1.0-rc.1/watchsync-extension.zip",
    },
    { name: "evil.zip", browser_download_url: "javascript:alert(1)" },
  ],
};

describe("parseReleases", () => {
  it("reads a release and marks an -rc tag as a candidate", () => {
    const [r] = parseReleases([release]);
    expect(r?.tag).toBe("v0.1.0-rc.1");
    expect(r?.prerelease).toBe(true);
    expect(r?.assets).toHaveLength(1);
  });

  it("drops drafts, malformed entries and non-array input", () => {
    expect(parseReleases([{ ...release, draft: true }, null, 3, { name: "x" }])).toEqual([]);
    expect(parseReleases({ message: "API rate limit exceeded" })).toEqual([]);
  });

  it("falls back to the tag when the name is empty", () => {
    expect(parseReleases([{ ...release, name: " " }])[0]?.name).toBe("v0.1.0-rc.1");
  });
});

describe("safeGithubUrl", () => {
  it("accepts GitHub https links only", () => {
    expect(safeGithubUrl("https://github.com/a")).toBe("https://github.com/a");
    expect(safeGithubUrl("https://objects.github.com/a")).toBe("https://objects.github.com/a");
    expect(safeGithubUrl("http://github.com/a")).toBeNull();
    expect(safeGithubUrl("https://github.com.evil.io/a")).toBeNull();
    expect(safeGithubUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("versionLabel", () => {
  it("spells out release candidates", () => {
    expect(versionLabel("v0.1.0-rc.2")).toBe("v0.1.0 release candidate");
    expect(versionLabel("v0.2.0")).toBe("v0.2.0");
  });
});

describe("checksumFor", () => {
  const hash = "0123456789abcdef".repeat(4);
  const other = "f".repeat(64);
  const body = [
    "### Check this download",
    `- \`watchsync-extension.zip\`: \`${hash.toUpperCase()}\``,
    `- \`watchsync-extension-v0.1.0.zip\`: \`${other}\``,
  ].join("\n");

  it("finds the hash on the line that names the file, in lower case", () => {
    expect(checksumFor(body, "watchsync-extension.zip")).toBe(hash);
    expect(checksumFor(body, "watchsync-extension-v0.1.0.zip")).toBe(other);
  });

  it("reads sha256sum output too", () => {
    expect(checksumFor(`${hash}  watchsync-extension.zip`, "watchsync-extension.zip")).toBe(hash);
  });

  it("does not match a longer file name, a short hash or a missing one", () => {
    expect(
      checksumFor(`- my-watchsync-extension.zip: ${hash}`, "watchsync-extension.zip"),
    ).toBeNull();
    expect(
      checksumFor(`- watchsync-extension.zip: ${hash.slice(1)}`, "watchsync-extension.zip"),
    ).toBeNull();
    expect(
      checksumFor(`- watchsync-extension.zip: ${hash}0`, "watchsync-extension.zip"),
    ).toBeNull();
    expect(checksumFor("### Added\n- Rooms", "watchsync-extension.zip")).toBeNull();
  });
});
