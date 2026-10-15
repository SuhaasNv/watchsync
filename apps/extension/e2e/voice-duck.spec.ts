// The film dips while friends talk (US-058), on the mock player. The friend's fake microphone
// plays talking (a looped file: Chrome's own fake microphone only beeps for 20 ms), so the host's film is lowered while it does; the host's own film is given sound and a
// volume of 0.8 first (the mock player starts muted, and a muted film is never touched).
import type { Page } from "@playwright/test";
import { type Ext, expect, launchWithExtension, MOCK, test } from "./fixtures";
import { allowAndTalk, FAKE_MEDIA, talk, talking, twoTabs, workerOf } from "./voice-helpers";

const volume = (tab: Page) => tab.evaluate(() => document.querySelector("video")?.volume ?? -1);

/** The film with sound, at 0.8: what a person who had set their volume would have. */
async function giveSound(tab: Page) {
  await tab.evaluate(() => {
    const film = document.querySelector("video");
    if (!film) return;
    film.muted = false;
    film.volume = 0.8;
  });
}

/** The level kept while the film is lowered, or undefined. */
const kept = (ext: Ext) =>
  workerOf(ext).evaluate(async () => (await chrome.storage.local.get("duckSaved")).duckSaved);

const setting = (ext: Ext, values: Record<string, unknown>) =>
  workerOf(ext).evaluate((v) => chrome.storage.local.set(v), values);

/** A room where the friend is talking (live, talking) and the host's film has sound. */
async function friendTalking() {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  const room = await twoTabs(ext, "open", [
    ...FAKE_MEDIA,
    `--use-file-for-fake-audio-capture=${talking()}`,
  ]);
  await expect
    .poll(async () => Object.values((await voiceViewOf(room.hostTab)).peers), { timeout: 15_000 })
    .toEqual(["connected"]);
  await giveSound(room.hostTab);
  return { ext, ...room };
}

const voiceViewOf = (tab: Page) =>
  workerOf(tab).evaluate(() => Reflect.get(globalThis, "watchsyncVoiceView")());

test("the film dips while a friend talks, then comes back, and the note is cleared", async () => {
  const { ext, hostTab, tab, friend } = await friendTalking();
  try {
    await allowAndTalk(tab);
    await expect.poll(() => volume(hostTab), { timeout: 10_000 }).toBeLessThan(0.8 * 0.18 + 0.05);
    expect((await kept(ext)) ?? {}).toMatchObject({ baseline: 0.8, ducking: true });
    // The friend mutes: the film comes back to exactly the person's volume, and the note goes.
    await talk(tab).click();
    await expect.poll(() => volume(hostTab), { timeout: 6000 }).toBeCloseTo(0.8, 3);
    await expect.poll(() => kept(ext)).toBeUndefined();
    await hostTab.waitForTimeout(1500);
    expect(await volume(hostTab)).toBeCloseTo(0.8, 3);
  } finally {
    await friend.context.close();
    await ext.context.close();
  }
});

test("with the feature off the volume never changes", async () => {
  const { ext, hostTab, tab, friend } = await friendTalking();
  try {
    await setting(ext, { duckOn: false });
    await allowAndTalk(tab);
    await hostTab.waitForTimeout(5000);
    expect(await volume(hostTab)).toBe(0.8);
    expect(await kept(ext)).toBeUndefined();
  } finally {
    await friend.context.close();
    await ext.context.close();
  }
});

test("a volume the person sets while it is lowered is kept", async () => {
  const { ext, hostTab, tab, friend } = await friendTalking();
  try {
    await allowAndTalk(tab);
    await expect.poll(() => volume(hostTab), { timeout: 10_000 }).toBeLessThan(0.5);
    await hostTab.evaluate(() => {
      const film = document.querySelector("video");
      if (film) film.volume = 0.6;
    });
    await hostTab.waitForTimeout(400);
    expect(await volume(hostTab)).toBeCloseTo(0.6, 3);
    await talk(tab).click(); // the friend stops
    await hostTab.waitForTimeout(3000);
    expect(await volume(hostTab)).toBeCloseTo(0.6, 3);
    expect(await kept(ext)).toBeUndefined();
  } finally {
    await friend.context.close();
    await ext.context.close();
  }
});

test("leaving the room brings the film back within 1.5 seconds", async () => {
  const { ext, host, hostTab, tab, friend } = await friendTalking();
  try {
    await allowAndTalk(tab);
    await expect.poll(() => volume(hostTab), { timeout: 10_000 }).toBeLessThan(0.5);
    await host.getByRole("button", { name: "Leave room" }).click();
    await expect.poll(() => volume(hostTab), { timeout: 1500 }).toBeCloseTo(0.8, 3);
  } finally {
    await friend.context.close();
    await ext.context.close();
  }
});

test("a tab closed in the middle of a dip: the next visit puts the volume back", async () => {
  const { ext, hostTab, tab, friend } = await friendTalking();
  try {
    await allowAndTalk(tab);
    await expect.poll(() => volume(hostTab), { timeout: 10_000 }).toBeLessThan(0.5);
    expect(await kept(ext)).toMatchObject({ baseline: 0.8, ducking: true });
    await hostTab.close(); // killed mid-dip
    await talk(tab).click(); // the friend stops, so nothing dips the next page
    // The note is still there: this page was not given the chance to clear it.
    expect(await kept(ext)).toMatchObject({ baseline: 0.8, ducking: true });
    const next = await ext.context.newPage();
    await next.goto(`${MOCK}/watch/ep1`);
    // A fresh player starts at 1; the note puts it back to the person's 0.8 and is cleared.
    await expect.poll(() => volume(next), { timeout: 5000 }).toBeCloseTo(0.8, 3);
    await expect.poll(() => kept(ext)).toBeUndefined();
  } finally {
    await friend.context.close();
    await ext.context.close();
  }
});

test("the Voice page has the switch and the three strengths, with the words for each", async () => {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  try {
    const page = await ext.context.newPage();
    await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
    await page.getByLabel("Your name").fill("Suhaas");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Voice", exact: true }).click();
    const lower = page.getByRole("switch", { name: "Lower the film while friends talk" });
    await expect(lower).toBeChecked(); // on by default
    await expect(page.getByRole("radio", { name: "Medium" })).toBeChecked();
    const help = (pct: number) =>
      page.getByText(
        `The film drops to ${pct}% of your volume while someone talks, then comes back. Move the volume yourself and that becomes your level.`,
      );
    await expect(help(18)).toBeVisible();
    await page.getByRole("radio", { name: "Light" }).check();
    await expect(help(35)).toBeVisible();
    await page.getByRole("radio", { name: "Strong" }).check();
    await expect(help(8)).toBeVisible();
    expect(
      await page.evaluate(async () => (await chrome.storage.local.get("duckLevel")).duckLevel),
    ).toBe("strong");
    await lower.uncheck();
    await expect(page.getByText("The film stays at your volume while friends talk.")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Strong" })).toBeHidden();
    expect(await page.evaluate(async () => (await chrome.storage.local.get("duckOn")).duckOn)).toBe(
      false,
    );
  } finally {
    await ext.context.close();
  }
});
