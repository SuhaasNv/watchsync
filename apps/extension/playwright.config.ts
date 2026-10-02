import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  // One retry in CI; a test that passes only on retry is reported as flaky, not hidden.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // The room service the built extension talks to (API http://localhost:8000).
  webServer: {
    // The suite creates many rooms from one IP, so it runs with high rate limits;
    // the limits themselves are covered by the service's pytest suite.
    command: "CREATE_PER_MINUTE=1000 JOIN_PER_MINUTE=1000 uv run uvicorn app.main:app --port 8000",
    cwd: "../../services/signaling",
    url: "http://localhost:8000/health",
    // Always a fresh server, so a stale one from earlier never hides a change.
    reuseExistingServer: false,
  },
});
