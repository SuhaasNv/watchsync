import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page, Worker } from "@playwright/test";
import { type Ext, expect, launchWithExtension, MOCK, room, test } from "./fixtures";

const position = (p: Page) => p.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
const playing = (p: Page) => p.evaluate(() => !document.querySelector("video")?.paused);

function worker(ext: Ext): Worker {
  const [w] = ext.context.serviceWorkers();
  if (!w) throw new Error("extension service worker not running");
  return w;
}

async function onTitle(ext: Ext) {
  const tab = await ext.context.newPage();
  await tab.goto(`${MOCK}/watch/ep1`);
  await expect.poll(() => playing(tab)).toBe(true);
  await tab.waitForTimeout(3200); // past the arrival window (BUG-004)
  return tab;
}

test("leaving stops sync and tells the room", async ({ ext }) => {
  const { host, hostTab, friend, fpop } = await room(ext);
  try {
    await onTitle(friend);
    await fpop.getByRole("button", { name: "Leave room" }).click();
    await expect(fpop.getByRole("button", { name: "Create a room" })).toBeVisible();
    await expect(hostTab.getByText("Asha left")).toBeVisible();
    await expect(host.getByText("Asha", { exact: true })).toHaveCount(0);
  } finally {
    await friend.context.close();
  }
});

test("a dropped connection reconnects by itself and stays in sync", async ({ ext }) => {
  const { hostTab, friend, fpop } = await room(ext);
  try {
    const tab = await onTitle(friend);
    await worker(friend).evaluate(() => {
      const drop = Reflect.get(globalThis, "watchsyncDropSocket");
      if (typeof drop === "function") drop();
    });
    await expect(fpop.getByText("Reconnecting…")).toBeVisible();
    await expect(fpop.getByText("Connected")).toBeVisible({ timeout: 5000 });

    // Sync still works after the reconnect.
    await hostTab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 60;
    });
    await expect
      .poll(async () => Math.abs((await position(tab)) - (await position(hostTab))))
      .toBeLessThan(1);
  } finally {
    await friend.context.close();
  }
});

test("after a browser restart, reopening a title offers to rejoin the room", async ({ ext }) => {
  const profile = mkdtempSync(path.join(tmpdir(), "watchsync-friend-"));
  const { host, friend } = await room(ext, profile);
  await friend.context.close(); // quit Chrome: session storage goes, local storage stays
  await expect(host.getByText("Away")).toBeVisible({ timeout: 5000 });

  const again = await launchWithExtension(profile);
  try {
    const tab = await again.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect(tab.getByText(/Rejoin room [A-HJ-NP-Z2-9]{6}\?/)).toBeVisible();
    await tab.getByRole("button", { name: "Rejoin" }).click();
    await expect(host.getByText("Away")).toHaveCount(0, { timeout: 5000 });

    const pop = await again.context.newPage();
    await pop.goto(`chrome-extension://${again.extensionId}/popup.html`);
    await expect(pop.getByText("Connected")).toBeVisible();
  } finally {
    await again.context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test("an ended room says so instead of reconnecting forever (BUG-009)", async ({ ext }) => {
  const profile = mkdtempSync(path.join(tmpdir(), "watchsync-friend-"));
  const { host, friend } = await room(ext, profile);
  await friend.context.close(); // the friend quits Chrome
  await host.getByRole("button", { name: "Leave room" }).click(); // the host leaves too
  await host.waitForTimeout(9000); // the room ends 8 s after it empties (test server)

  const again = await launchWithExtension(profile);
  try {
    const pop = await again.context.newPage();
    await pop.goto(`chrome-extension://${again.extensionId}/popup.html`);
    await pop.getByRole("button", { name: /Rejoin room/ }).click();
    await expect(pop.getByText("This room is no longer available")).toBeVisible({
      timeout: 8000,
    });
    await expect(pop.getByText("Reconnecting…")).toHaveCount(0);
    await expect(pop.getByRole("button", { name: "Create a room" })).toBeVisible();
  } finally {
    await again.context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
