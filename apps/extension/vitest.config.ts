import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __API_URL__: JSON.stringify("http://localhost:8000"),
    __MOCK__: "false",
    __CHANNEL__: JSON.stringify("prod"),
    __BUILD__: JSON.stringify(""),
    __SITE_URL__: JSON.stringify("https://watchsync.space"),
    __TITLE_PAGES__: JSON.stringify([
      "https://www.netflix.com/*",
      "https://www.amazon.in/gp/video/*",
    ]),
  },
  test: { include: ["src/**/*.test.ts"], environment: "jsdom", passWithNoTests: true },
});
