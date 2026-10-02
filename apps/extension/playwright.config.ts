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
    command: "uv run uvicorn app.main:app --port 8000",
    cwd: "../../services/signaling",
    url: "http://localhost:8000/health",
    reuseExistingServer: true,
  },
});
