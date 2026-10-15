// Shared by the voice specs: two profiles on the mock player with fake microphones.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page, Worker } from "@playwright/test";
import { type Ext, MOCK, room } from "./fixtures";

/** Chrome answers the microphone question itself, and gives a fake microphone that beeps. */
export const FAKE_MEDIA = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];

/**
 * A WAV file of `seconds` of sound, for a fake microphone to play in a loop
 * (--use-file-for-fake-audio-capture): Chrome's own fake microphone only beeps for 20 ms.
 */
function wav(sample: (t: number) => number, seconds = 10): string {
  const rate = 48_000;
  const samples = rate * seconds;
  const file = Buffer.alloc(44 + samples * 2);
  file.write("RIFF", 0);
  file.writeUInt32LE(36 + samples * 2, 4);
  file.write("WAVEfmt ", 8);
  file.writeUInt32LE(16, 16);
  file.writeUInt16LE(1, 20); // PCM
  file.writeUInt16LE(1, 22); // mono
  file.writeUInt32LE(rate, 24);
  file.writeUInt32LE(rate * 2, 28);
  file.writeUInt16LE(2, 32);
  file.writeUInt16LE(16, 34);
  file.write("data", 36);
  file.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const v = Math.max(-1, Math.min(1, sample(i / rate)));
    file.writeInt16LE(Math.round(v * 32_767), 44 + i * 2);
  }
  const out = path.join(mkdtempSync(path.join(tmpdir(), "watchsync-audio-")), "mic.wav");
  writeFileSync(out, file);
  return out;
}

/** A microphone that hears nothing. */
export const silence = (): string => wav(() => 0);

/**
 * A microphone that sounds like someone talking, all the time: a voiced tone with a few
 * harmonics whose loudness rises and falls three times a second, so noise suppression does not
 * take it for steady noise.
 */
export const talking = (): string =>
  wav((t) => {
    const voice = [1, 2, 3, 4].reduce((sum, n) => sum + Math.sin(2 * Math.PI * 180 * n * t) / n, 0);
    return 0.35 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t)) * voice;
  });

export interface VoiceView {
  /** The voice document is up and connected to the worker. */
  frame: boolean;
  mic: string;
  live: boolean;
  mode: string;
  peers: Record<string, string>;
}

/** The extension's worker for the profile a tab belongs to. */
export function workerOf(of: Ext | Page): Worker {
  const context = "extensionId" in of ? of.context : of.context();
  const [w] = context.serviceWorkers();
  if (!w) throw new Error("extension service worker not running");
  return w;
}

/** The offscreen voice documents the profile has open (the page itself has no voice frame). */
export const voiceDocs = (tab: Page | Ext): Promise<number> =>
  workerOf(tab).evaluate(
    async () => (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length,
  );

/** What the voice document reports (test builds expose the worker's copy of it). */
export async function voiceView(tab: Page): Promise<VoiceView> {
  return workerOf(tab).evaluate(() => Reflect.get(globalThis, "watchsyncVoiceView")());
}

/** Audio energy heard from each person so far: it only grows while someone is heard. */
export async function heard(tab: Page): Promise<Record<string, number>> {
  const got = await workerOf(tab).evaluate(() =>
    Reflect.get(globalThis, "watchsyncVoiceProbe")("heard"),
  );
  return typeof got === "object" && got !== null ? { ...got } : {};
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
