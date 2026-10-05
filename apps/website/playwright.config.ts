import { defineConfig } from "@playwright/test";

const PORT = 4329;

export default defineConfig({
  testDir: "e2e",
  // The store build has its own config: playwright.store.config.ts.
  testIgnore: "store.spec.ts",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}` },
  // The built site, served as it will be in production. GitHub is never called: every test
  // answers api.github.com itself (see e2e/fixtures.ts).
  webServer: {
    command: `astro preview --port ${PORT} --ignore-lock`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
