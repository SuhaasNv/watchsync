// "Test my mic" (US-134), on the microphone page: a live level meter, a 3-second recording played
// back and then deleted, a picker when there is more than one microphone (used by voice), and
// no transmitting while it is open. Chrome's fake microphones beep, so the meter has something
// to show.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { type Ext, expect, launchWithExtension, test } from "./fixtures";
import {
  allowAndTalk,
  FAKE_MEDIA,
  heard,
  silence,
  talk,
  talking,
  twoTabs,
  voiceOf,
  voiceView,
  workerOf,
} from "./voice-helpers";

const testPage = (ext: Ext) =>
  `chrome-extension://${ext.extensionId}/voice-permission.html?mode=test`;

/** The meter's reading, 0 to 100. */
const level = async (page: Page) =>
  Number(await page.getByRole("meter", { name: "Input level" }).getAttribute("aria-valuenow"));

test("the meter moves as you speak and says it can hear you", async () => {
  const ext = await launchWithExtension("", {
    args: [...FAKE_MEDIA, `--use-file-for-fake-audio-capture=${talking()}`],
  });
  try {
    const page = await ext.context.newPage();
    await page.goto(testPage(ext));
    await expect(page.getByRole("heading", { name: "Test your microphone" })).toBeVisible();
    await expect(page.getByRole("meter", { name: "Input level" })).toBeVisible();
    await expect.poll(() => level(page), { timeout: 8000 }).toBeGreaterThan(5);
    await expect(page.getByText("We can hear you.")).toBeVisible();
    await expect(
      page.getByText(
        "The test recording stays on this computer, is never sent and is deleted after it plays.",
      ),
    ).toBeVisible();
  } finally {
    await ext.context.close();
  }
});

test("a silent microphone is told so after 5 seconds", async () => {
  const quiet = [...FAKE_MEDIA, `--use-file-for-fake-audio-capture=${silence()}`];
  const ext = await launchWithExtension("", { args: quiet });
  try {
    const page = await ext.context.newPage();
    await page.goto(testPage(ext));
    await expect(page.getByText("Say something.")).toBeVisible();
    await expect(page.getByText("We can't hear anything: check your mic.")).toBeHidden();
    await expect(page.getByText("We can't hear anything: check your mic.")).toBeVisible({
      timeout: 7000,
    });
    expect(await level(page)).toBe(0);
  } finally {
    await ext.context.close();
  }
});

test("the 3-second test plays back, stays in memory, is never sent and ends with the page", async () => {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  try {
    const page = await ext.context.newPage();
    // Every microphone track stopped by the page is logged, to see the mic let go.
    await page.addInitScript(() => {
      const stop = MediaStreamTrack.prototype.stop;
      MediaStreamTrack.prototype.stop = function () {
        console.log("watchsync-test: track stopped");
        stop.call(this);
      };
    });
    const stopped: string[] = [];
    page.on("console", (m) => {
      if (m.text().includes("track stopped")) stopped.push(m.text());
    });
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(testPage(ext));
    const record = page.getByRole("button", { name: "Record a 3-second test" });
    await expect(record).toBeEnabled();
    const open = stopped.length; // opening the mic may let go of a first try; listening now

    await record.click();
    await expect(page.getByRole("button", { name: "Recording… 3 s" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Playing back…" })).toBeDisabled({
      timeout: 5000,
    });
    // The recording plays from memory (a blob), in a page that is still open.
    const audio = page.locator("audio");
    await expect(audio).toHaveCount(1);
    const src = await audio.getAttribute("src");
    expect(src).toMatch(/^blob:chrome-extension:/);
    // Played, then deleted: the element is gone and the blob can no longer be read.
    await expect(record).toBeVisible({ timeout: 8000 });
    await expect(audio).toHaveCount(0);
    expect(
      await page.evaluate(
        (url) =>
          fetch(url ?? "").then(
            () => "readable",
            () => "gone",
          ),
        src,
      ),
    ).toBe("gone");
    // Nothing but the page's own files was ever asked for or sent.
    expect(
      requests.filter((u) => !/^(chrome-extension|blob|data):/.test(u)),
      "no request left the extension",
    ).toEqual([]);

    // Done closes the page and lets go of the mic.
    const closing = page.waitForEvent("close");
    await page.getByRole("button", { name: "Done" }).click();
    await closing;
    expect(stopped.length).toBeGreaterThan(open);
  } finally {
    await ext.context.close();
  }
});

test("with more than one microphone you pick one, and voice uses it", async () => {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  try {
    const page = await ext.context.newPage();
    await page.goto(testPage(ext));
    const picker = page.getByLabel("Microphone");
    await expect(picker).toBeVisible();
    await expect(picker.locator("option")).toHaveCount(3); // System default and the two fakes
    const options = await picker.locator("option").allTextContents();
    expect(options[0]).toBe("System default");
    expect(options.length).toBeGreaterThan(2); // the fake setup has two microphones
    const second = await picker.locator("option").nth(2).getAttribute("value");
    await picker.selectOption({ index: 2 });
    await expect
      .poll(() =>
        page.evaluate(async () => (await chrome.storage.local.get("voiceMicId")).voiceMicId),
      )
      .toBe(second);
    await page.close();

    // In a room, voice opens that microphone and no other.
    const { hostTab, tab, friend } = await twoTabs(ext, "open");
    await expect.poll(async () => (await voiceView(hostTab)).frame, { timeout: 15_000 }).toBe(true);
    await allowAndTalk(hostTab);
    await expect.poll(async () => (await voiceView(hostTab)).mic).toBe("on");
    expect(
      await workerOf(ext).evaluate(() => Reflect.get(globalThis, "watchsyncVoiceProbe")("mic")),
    ).toBe(second);
    await tab.close();
    await friend.context.close();
  } finally {
    await ext.context.close();
  }
});

test("testing never transmits: you stay muted while the test is open and after", async () => {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  try {
    const { hostTab, tab, friend } = await twoTabs(ext, "open");
    await allowAndTalk(hostTab);
    await allowAndTalk(tab);
    // Live in open mic: the friend hears the beeps.
    await expect.poll(async () => voiceOf(friend, "Suhaas")).toBe("live");
    const energy = async () => Object.values(await heard(tab)).reduce((a, b) => a + b, 0);
    const before = await energy();
    await expect.poll(energy, { timeout: 4000 }).toBeGreaterThan(before + 0.01);

    const test = await ext.context.newPage();
    await test.goto(testPage(ext));
    await expect(test.getByRole("button", { name: "Record a 3-second test" })).toBeEnabled();
    // Muted for everyone at once, and the room sees it.
    await expect.poll(async () => voiceOf(friend, "Suhaas")).toBe("muted");
    expect((await voiceView(hostTab)).live).toBe(false);
    // What was on its way plays out; then the friend hears nothing, through a whole test.
    await test.waitForTimeout(3000);
    const quiet = await energy();
    await test.getByRole("button", { name: "Record a 3-second test" }).click();
    await expect(test.getByRole("button", { name: "Record a 3-second test" })).toBeVisible({
      timeout: 12_000,
    });
    expect(await energy()).toBeLessThan(quiet + 0.001);

    // The test is closed: still muted, until the person unmutes.
    await test.close();
    await hostTab.bringToFront();
    await expect(talk(hostTab)).toHaveAttribute("aria-label", "Unmute your mic");
    expect(await voiceOf(friend, "Suhaas")).toBe("muted");
    await friend.context.close();
  } finally {
    await ext.context.close();
  }
});

test("Test mic first (on the first-press question) and Test your mic (in settings) open the test", async () => {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  try {
    const { hostTab, friend } = await twoTabs(ext, "open");
    await expect.poll(async () => (await voiceView(hostTab)).frame, { timeout: 15_000 }).toBe(true);
    await talk(hostTab).click();
    await expect(hostTab.getByRole("dialog", { name: /Talk to Asha/ })).toBeVisible();
    const opened = ext.context.waitForEvent("page");
    await hostTab.getByRole("button", { name: "Test mic first" }).click();
    const page = await opened;
    await expect(page.getByRole("heading", { name: "Test your microphone" })).toBeVisible();
    await page.close();

    const popup = await ext.context.newPage();
    await popup.goto(`chrome-extension://${ext.extensionId}/popup.html`);
    await popup.getByRole("button", { name: "Voice", exact: true }).click();
    const fromSettings = ext.context.waitForEvent("page");
    await popup.getByRole("button", { name: "Test your mic" }).click();
    const second = await fromSettings;
    await expect(second.getByRole("heading", { name: "Test your microphone" })).toBeVisible();
    await friend.context.close();
  } finally {
    await ext.context.close();
  }
});

test("the mic test page passes the WCAG gate and works by keyboard", async () => {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  try {
    const page = await ext.context.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(testPage(ext));
    await expect(page.getByRole("button", { name: "Record a 3-second test" })).toBeEnabled();
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual(
      [],
    );
    // Keyboard: the picker, then the record button, are reachable and press with Enter.
    await page.getByLabel("Microphone").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Record a 3-second test" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /^Recording/ })).toBeVisible();
  } finally {
    await ext.context.close();
  }
});
