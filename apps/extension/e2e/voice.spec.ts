// Voice (US-055): two profiles on the mock player with fake microphones. Everyone joins listening
// and muted; Talk asks first, then Chrome (auto-accepted here); the sound goes straight between
// the two browsers.
import { expect, launchWithExtension, test } from "./fixtures";
import {
  allowAndTalk,
  FAKE_MEDIA,
  heard,
  talk,
  twoTabs,
  voiceDocs,
  voiceOf,
  voiceView,
  workerOf,
} from "./voice-helpers";

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

test("voice runs in an offscreen document, never in the streaming page: opened on join, closed on leave", async () => {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  try {
    const { hostTab, host, friend } = await twoTabs(ext);
    // Joined, watching a title, everyone able to talk: one voice document per profile.
    await expect.poll(() => voiceDocs(ext), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => voiceDocs(friend), { timeout: 15_000 }).toBe(1);
    // The page holds no voice frame (not even a hidden one), and the extension no longer
    // offers voice.html to pages: the streaming site can't reach the microphone.
    expect(hostTab.frames()).toHaveLength(1);
    expect(await hostTab.locator("watchsync-voice").count()).toBe(0);
    const page = await ext.context.newPage();
    await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
    const exposed = await page.evaluate(() =>
      (chrome.runtime.getManifest().web_accessible_resources ?? []).flatMap((r) =>
        typeof r === "string" ? [r] : r.resources,
      ),
    );
    expect(exposed).toEqual(["sidebar.html"]);
    expect(
      await page.evaluate(() => chrome.runtime.getManifest().permissions?.includes("offscreen")),
    ).toBe(true);
    await page.close();

    // Leaving the room closes it.
    await host.getByRole("button", { name: "Leave room" }).click();
    await expect.poll(() => voiceDocs(ext), { timeout: 5000 }).toBe(0);
    expect((await voiceView(hostTab)).frame).toBe(false);
    await friend.context.close();
  } finally {
    await ext.context.close();
  }
});

test("the microphone page asks Chrome, says Done, takes the person back to their film and closes", async () => {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  try {
    const { hostTab, friend } = await twoTabs(ext);
    const back = await workerOf(ext).evaluate(() =>
      Reflect.get(globalThis, "watchsyncPresenceTab")(),
    );
    expect(typeof back).toBe("number");
    const page = await ext.context.newPage(); // now the front tab, as the page opened by Talk is
    await page.goto(
      `chrome-extension://${ext.extensionId}/voice-permission.html?mode=ask&tab=${back}`,
    );
    await expect(
      page.getByRole("heading", { name: "Allow WatchSync to use your microphone" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Your voice goes straight to the people in your room. WatchSync never records it and our server never hears it.",
      ),
    ).toBeVisible();
    await expect(page.getByText(/^Done\. You can go back to /)).toBeVisible();
    // Then it returns to the film's tab and closes itself.
    await expect.poll(() => page.isClosed(), { timeout: 5000 }).toBe(true);
    await expect
      .poll(() => hostTab.evaluate(() => document.visibilityState), { timeout: 3000 })
      .toBe("visible");
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
    await workerOf(ext).evaluate(() => {
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
