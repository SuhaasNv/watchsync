// Voice (US-055): two profiles on the mock player with fake microphones. Everyone joins listening
// and muted; Talk asks first, then Chrome (auto-accepted here); the sound goes straight between
// the two browsers.
import type { Worker } from "@playwright/test";
import { type Ext, expect, launchWithExtension, test } from "./fixtures";
import {
  allowAndTalk,
  FAKE_MEDIA,
  heard,
  talk,
  twoTabs,
  voiceOf,
  voiceView,
} from "./voice-helpers";

function worker(ext: Ext): Worker {
  const [w] = ext.context.serviceWorkers();
  if (!w) throw new Error("extension service worker not running");
  return w;
}

test("two people press Talk and hear each other, straight between the browsers", async () => {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  try {
    const { hostTab, tab, friend } = await twoTabs(ext);
    // Everyone joins listening: the connection is up before anyone presses Talk.
    await expect
      .poll(async () => Object.values((await voiceView(hostTab))?.peers ?? {}), {
        timeout: 15_000,
      })
      .toEqual(["connected"]);
    // Everyone starts muted.
    await expect(talk(hostTab)).toHaveText("Talk");
    await expect(talk(tab)).toHaveText("Talk");
    expect(await voiceOf(ext, "Asha")).toBe("muted");

    // The first press asks first; Chrome's own question comes after "Allow and talk".
    await talk(hostTab).click();
    await expect(hostTab.getByRole("dialog", { name: /Talk to Asha/ })).toBeVisible();
    await hostTab.getByRole("button", { name: "Allow and talk" }).click();
    await expect(talk(hostTab)).toHaveAttribute("aria-label", "Mute your mic");
    await expect(talk(hostTab)).toHaveAttribute("aria-pressed", "true");

    await allowAndTalk(tab);
    await expect(talk(tab)).toHaveAttribute("aria-pressed", "true");

    // Each hears the other's voice (the fake mic beeps) within 3 seconds.
    for (const t of [hostTab, tab]) {
      await expect
        .poll(async () => Object.values(await heard(t)).some((e) => e > 0), { timeout: 3000 })
        .toBe(true);
    }
    await friend.context.close();
  } finally {
    await ext.context.close();
  }
});

test("someone who closes their page stops being connected within 2 seconds", async () => {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  try {
    const { hostTab, tab, friend } = await twoTabs(ext);
    await expect
      .poll(async () => Object.values((await voiceView(hostTab))?.peers ?? {}), {
        timeout: 15_000,
      })
      .toEqual(["connected"]);
    await allowAndTalk(tab);
    await tab.close();
    await expect
      .poll(async () => Object.keys((await voiceView(hostTab))?.peers ?? {}), { timeout: 2000 })
      .toEqual([]);
    await friend.context.close();
  } finally {
    await ext.context.close();
  }
});

test("a dropped room connection keeps voice: it comes back without pressing Talk again", async () => {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  try {
    const { hostTab, tab, friend } = await twoTabs(ext);
    await allowAndTalk(hostTab);
    await allowAndTalk(tab);
    await expect.poll(async () => voiceOf(friend, "Suhaas")).toBe("live");
    await worker(ext).evaluate(() => {
      const drop = Reflect.get(globalThis, "watchsyncDropSocket");
      if (typeof drop === "function") drop();
    });
    await expect(hostTab.getByText("Back with the room")).toBeVisible({ timeout: 8000 });
    // The room still says Suhaas is live, the connection is still up, and the mic is open.
    await expect.poll(async () => voiceOf(friend, "Suhaas")).toBe("live");
    expect(Object.values((await voiceView(hostTab))?.peers ?? {})).toEqual(["connected"]);
    await expect(talk(hostTab)).toHaveAttribute("aria-pressed", "true");
    await friend.context.close();
  } finally {
    await ext.context.close();
  }
});
