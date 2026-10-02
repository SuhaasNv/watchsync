import { describe, expect, it } from "vitest";
import { parseReleases, safeGithubUrl, versionLabel } from "./releases";

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
