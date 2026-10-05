import { defineConfig } from "@playwright/test";
import { TEST_STORE_URL } from "./e2e/fixtures";

const PORT = 4331;

// The site as it will be once PUBLIC_STORE_URL is set in production: built into its own
// folder so the zip build in dist/ (playwright.config.ts) stays untouched.
export default defineConfig({
  testDir: "e2e",
  testMatch: "store.spec.ts",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `astro build --outDir dist-store && astro preview --port ${PORT} --outDir dist-store --ignore-lock`,
    url: `http://localhost:${PORT}/`,
    env: { PUBLIC_STORE_URL: TEST_STORE_URL, PUBLIC_CHANNEL: "prod" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
