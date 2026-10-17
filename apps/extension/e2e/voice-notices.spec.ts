// BUG-085: the voice notices that only inform ("Voice is ready", "Connecting voice with…") follow
// the room notices switch (US-114).
import type { Page } from "@playwright/test";
import { expect, launchWithExtension, MOCK, test } from "./fixtures";
import { FAKE_MEDIA, twoTabs, workerOf } from "./voice-helpers";

const peersOf = (tab: Page): Promise<Record<string, string>> =>
  workerOf(tab).evaluate(() => Reflect.get(globalThis, "watchsyncVoiceView")().peers);

test("Voice is ready follows the room notices switch, and is said later if it was held back", async () => {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  try {
    await workerOf(ext).evaluate(() => chrome.storage.local.set({ roomNotices: false }));
    const r = await twoTabs(ext, "open");
    try {
      await expect.poll(async () => await peersOf(r.hostTab), { timeout: 15_000 }).not.toEqual({});
      await r.hostTab.waitForTimeout(2000);
      await expect(r.hostTab.getByText("Voice is ready")).toHaveCount(0);
      // Not shown, so not counted as told.
      expect(
        await workerOf(ext).evaluate(
          async () => (await chrome.storage.local.get("voiceReadyFor")).voiceReadyFor,
        ),
      ).toBeUndefined();

      // Switched on, the next time voice starts in the room says it.
      await workerOf(ext).evaluate(() => chrome.storage.local.set({ roomNotices: true }));
      await r.hostTab.goto(`${MOCK}/watch/ep1`);
      await expect(r.hostTab.getByText("Voice is ready")).toBeVisible({ timeout: 20_000 });
    } finally {
      await r.friend.context.close();
    }
  } finally {
    await ext.context.close();
  }
});
