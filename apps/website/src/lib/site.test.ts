import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStoreUrl } from "./site";

describe("parseStoreUrl", () => {
  it("accepts https listings on the Chrome Web Store", () => {
    const listing =
      "https://chromewebstore.google.com/detail/watchsync/abcdefghijklmnopabcdefghijklmnop";
    expect(parseStoreUrl(listing)).toBe(listing);
    expect(parseStoreUrl(`  ${listing}  `)).toBe(listing);
    expect(parseStoreUrl("https://chrome.google.com/webstore/detail/watchsync/abc")).toBe(
      "https://chrome.google.com/webstore/detail/watchsync/abc",
    );
  });

  it("treats a missing or empty value as unset", () => {
    expect(parseStoreUrl(undefined)).toBeNull();
    expect(parseStoreUrl(null)).toBeNull();
    expect(parseStoreUrl("")).toBeNull();
    expect(parseStoreUrl("   ")).toBeNull();
    expect(parseStoreUrl(42)).toBeNull();
  });

  it("refuses anything that isn't https on the store's own hosts", () => {
    for (const bad of [
      "not a url",
      "http://chromewebstore.google.com/detail/watchsync/abc",
      "javascript:alert(1)",
      "https://chromewebstore.google.com.evil.example/detail/watchsync",
      "https://evil.example/chromewebstore.google.com",
      "https://user:pass@chromewebstore.google.com/detail/watchsync",
      "https://chromewebstore.google.com:8443/detail/watchsync",
      "https://chrome.google.com/",
      "https://chrome.google.com/webstorex/detail/watchsync",
      "https://google.com/webstore/detail/watchsync",
      "https://microsoftedge.microsoft.com/addons/detail/watchsync",
    ]) {
      expect(parseStoreUrl(bad), bad).toBeNull();
    }
  });
});

describe("STORE_URL", () => {
  const listing =
    "https://chromewebstore.google.com/detail/watchsync/abcdefghijklmnopabcdefghijklmnop";
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load(env: Record<string, string>) {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.resetModules();
    return import("./site");
  }

  it("is unset by default, so the site keeps the zip", async () => {
    const site = await load({ PUBLIC_STORE_URL: "" });
    expect(site.STORE_URL).toBeNull();
    expect(site.FROM_STORE).toBe(false);
  });

  it("switches the public site to the store", async () => {
    const site = await load({ PUBLIC_STORE_URL: listing });
    expect(site.STORE_URL).toBe(listing);
    expect(site.FROM_STORE).toBe(true);
  });

  it("keeps the dev site on the WatchSync Dev zip even with a store address", async () => {
    const site = await load({ PUBLIC_STORE_URL: listing, PUBLIC_CHANNEL: "dev" });
    expect(site.STORE_URL).toBeNull();
    expect(site.FROM_STORE).toBe(false);
    expect(site.DOWNLOAD_URL).toMatch(/dev-latest\/watchsync-extension-dev\.zip$/);
  });

  it("ignores an address that isn't the store", async () => {
    const site = await load({ PUBLIC_STORE_URL: "https://example.com/watchsync.zip" });
    expect(site.FROM_STORE).toBe(false);
  });
});
