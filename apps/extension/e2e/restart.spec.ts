// A server update mid-room (UC-046): the room service stops with SIGTERM like a Railway
// deploy and starts again; both people come back to the same room by themselves.
//
// The suite's room service (port 8000) belongs to Playwright's webServer and can't be
// restarted from a test, so this spec runs its own on port 8001, with a fixed signing secret
// as production has, and loads a second build of the extension made against it.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { type Ext, expect, launchWithExtension, MOCK, popup, test } from "./fixtures";

const PORT = 8001;
const API = `http://localhost:${PORT}`;
const extension = path.resolve(import.meta.dirname, "..");
const service = path.resolve(import.meta.dirname, "../../../services/signaling");
const build = mkdtempSync(path.join(tmpdir(), "watchsync-restart-"));
const UPDATING = "WatchSync is updating, back in a moment";

let server: ChildProcess | null = null;

async function startService() {
  server = spawn(
    path.join(service, ".venv/bin/python"),
    ["-m", "uvicorn", "app.main:app", "--port", String(PORT)],
    {
      cwd: service,
      stdio: "ignore",
      env: {
        ...process.env,
        ROOM_SIGNING_SECRET: "e2e-restart-secret-0123456789abcdef",
        CREATE_PER_MINUTE: "1000",
        JOIN_PER_MINUTE: "1000",
      },
    },
  );
  await expect
    .poll(
      () =>
        fetch(`${API}/health`).then(
          (r) => r.ok,
          () => false,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
}

/** What a deploy does to the old process: SIGTERM, then wait for it to exit. */
async function stopService() {
  const running = server;
  server = null;
  if (!running || running.exitCode !== null) return;
  const exited = once(running, "exit");
  running.kill("SIGTERM");
  await exited;
}

test.beforeAll(async () => {
  execFileSync("node", ["build.mjs"], {
    cwd: extension,
    env: { ...process.env, WATCHSYNC_API: API, WATCHSYNC_MOCK: "1", WATCHSYNC_OUT: build },
  });
  await startService();
});

test.afterAll(async () => {
  await stopService();
  rmSync(build, { recursive: true, force: true });
});

const position = (p: Page) => p.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
const playing = (p: Page) => p.evaluate(() => !document.querySelector("video")?.paused);

async function onTitle(ext: Ext) {
  const tab = await ext.context.newPage();
  await tab.goto(`${MOCK}/watch/ep1`);
  await expect.poll(() => playing(tab)).toBe(true);
  return tab;
}

test("a server update mid-room: both come back to the same room and stay in sync", async () => {
  const hostExt = await launchWithExtension("", { build });
  const friendExt = await launchWithExtension("", { build });
  try {
    const host = await popup(hostExt, "Suhaas");
    await host.getByRole("button", { name: "Create a room" }).click();
    const code = (await host.getByTestId("room-code").textContent()) ?? "";
    const hostTab = await onTitle(hostExt);
    await expect(host.getByText("Test player · Demo Show, E1")).toBeVisible();

    const friend = await popup(friendExt, "Asha");
    await friend.getByRole("textbox", { name: "Or join a friend's room" }).fill(code);
    await friend.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(friend.getByTestId("room-code")).toHaveText(code);
    const friendTab = await onTitle(friendExt);
    await friendTab.waitForTimeout(3200); // past the arrival window (BUG-004)
    await expect(host.getByRole("heading", { name: "In this room (2)" })).toBeVisible();

    // The room service stops for an update: both pages say so, not "Reconnecting".
    await stopService();
    for (const tab of [hostTab, friendTab]) {
      await expect(tab.getByText(UPDATING)).toBeVisible();
      await expect(tab.getByText("Connection lost. Reconnecting…")).toHaveCount(0);
    }
    await expect(host.getByText("Updating…")).toBeVisible();

    // It comes back: within 10 s both are in the same room, under the same names, without
    // anyone doing anything, and the room still knows its title.
    const restartedAt = Date.now();
    await startService();
    for (const pop of [host, friend]) {
      await expect(pop.getByText("Connected")).toBeVisible({ timeout: 10_000 });
      await expect(pop.getByTestId("room-code")).toHaveText(code);
      await expect(pop.getByRole("heading", { name: "In this room (2)" })).toBeVisible();
      await expect(pop.locator("li .name")).toHaveText([/^Suhaas/, /^Asha/]);
    }
    expect(Date.now() - restartedAt).toBeLessThan(10_000);
    await expect(host.getByText("Test player · Demo Show, E1").first()).toBeVisible();
    for (const tab of [hostTab, friendTab]) await expect(tab.getByText(UPDATING)).toHaveCount(0);

    // And they stay in sync: a jump on one side reaches the other.
    await hostTab.waitForTimeout(3600); // past the restored title's settling window
    await hostTab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 60;
    });
    await expect
      .poll(async () => Math.abs((await position(friendTab)) - (await position(hostTab))))
      .toBeLessThan(1);
  } finally {
    await hostExt.context.close();
    await friendExt.context.close();
  }
});
