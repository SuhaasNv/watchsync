// @ts-check
import { defineConfig } from "astro/config";

// The public address, for absolute links in social previews and the sitemap.
const site = process.env.PUBLIC_SITE_URL ?? "http://localhost:4321";

export default defineConfig({
  site,
  output: "static",
  // The server's Content-Security-Policy allows scripts and styles from our own origin only,
  // so nothing is inlined into the HTML: every script and stylesheet is a file.
  build: { format: "directory", inlineStylesheets: "never" },
  vite: { build: { assetsInlineLimit: 0 } },
  devToolbar: { enabled: false },
});
