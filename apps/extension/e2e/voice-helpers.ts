// Shared by the voice specs: two profiles on the mock player with fake microphones.
import type { Frame, Page } from "@playwright/test";
import { type Ext, MOCK, room } from "./fixtures";

/** Chrome answers the microphone question itself, and gives a fake microphone that beeps. */
export const FAKE_MEDIA = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];

export interface VoiceView {
  mic: string;
  live: boolean;
  mode: string;
  peers: Record<string, string>;
}

/** The voice frame of a tab (an invisible extension frame), once it exists. */
export const voiceFrame = (tab: Page): Frame | undefined =>
  tab.frames().find((f) => f.url().includes("/voice.html"));

/** What the voice frame reports (test builds expose it on window.watchsyncVoice). */
export async function voiceView(tab: Page): Promise<VoiceView | undefined> {
  return voiceFrame(tab)?.evaluate(() => Reflect.get(window, "watchsyncVoice").view());
}

/** Audio energy heard from each person so far: it only grows while someone is heard. */
export async function heard(tab: Page): Promise<Record<string, number>> {
  return (
    (await voiceFrame(tab)?.evaluate(() => Reflect.get(window, "watchsyncVoice").heard())) ?? {}
  );
}

/** The Talk button in the pill (a notice can have a Talk button of its own). */
export const talk = (tab: Page) => tab.locator(".pill button.talk");

export async function setMode(ext: Ext, mode: "open" | "ptt") {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  await page.evaluate((m) => chrome.storage.local.set({ voiceMode: m }), mode);
  await page.close();
}

/** Suhaas (host) and Asha, each on the mock player, in one room, with fake microphones. */
export async function twoTabs(ext: Ext, mode: "open" | "ptt" = "open", args = FAKE_MEDIA) {
  const { hostTab, friend, host, fpop } = await room(ext, "", args);
  await setMode(ext, mode);
  await setMode(friend, mode);
  const tab = await friend.context.newPage();
  await tab.goto(`${MOCK}/watch/ep1`);
  return { hostTab, tab, friend, host, fpop };
}

/** What the room says `who` is doing in voice, as `ext`'s worker last heard it. */
export async function voiceOf(ext: Ext, who: string): Promise<string | undefined> {
  const page = await ext.context.newPage();
  try {
    await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
    return await page.evaluate(async (name) => {
      const reply = await chrome.runtime.sendMessage({ kind: "getState" });
      const people: { name: string; voice?: string }[] = reply.state.participants;
      return people.find((p) => p.name === name)?.voice;
    }, who);
  } finally {
    await page.close();
  }
}

/** Press Talk for the first time and agree to the question. */
export async function allowAndTalk(tab: Page) {
  await talk(tab).click();
  await tab.getByRole("button", { name: "Allow and talk" }).click();
}
