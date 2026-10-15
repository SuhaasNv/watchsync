// Mute and push to talk (US-056): hold to talk with the button and with Alt+T (also in full
// screen), the key types in the chat box and never transmits, and everyone's mute shows for
// everyone within a second.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
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

/** A face in the pill with its mic badge, as another person sees it. */
const badge = (tab: Page, name: string) => tab.locator(`.pill .face[aria-label^="${name}"] .mic`);

const energy = async (tab: Page) => Object.values(await heard(tab)).reduce((a, b) => a + b, 0);

async function connected(tab: Page) {
  await expect
    .poll(async () => Object.values((await voiceView(tab))?.peers ?? {}), { timeout: 15_000 })
    .toEqual(["connected"]);
}

/** Both have pressed Talk once. In push-to-talk that leaves them muted; in open mic, live. */
async function bothAllowed(hostTab: Page, tab: Page) {
  await connected(hostTab);
  await allowAndTalk(hostTab);
  await allowAndTalk(tab);
  await expect.poll(async () => (await voiceView(hostTab))?.mic).toBe("on");
  await expect.poll(async () => (await voiceView(tab))?.mic).toBe("on");
}

async function withRoom(
  mode: "open" | "ptt",
  run: (r: Awaited<ReturnType<typeof twoTabs>> & { ext: Ext }) => Promise<void>,
) {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  try {
    const r = await twoTabs(ext, mode);
    try {
      await run({ ...r, ext });
    } finally {
      await r.friend.context.close();
    }
  } finally {
    await ext.context.close();
  }
}

test("push to talk: heard only while the button is held", async () => {
  await withRoom("ptt", async ({ hostTab, tab, friend }) => {
    await bothAllowed(hostTab, tab);
    // Allowed, and still muted: the hint for hands, not an open mic.
    await expect(talk(hostTab)).toHaveText("Hold to talk");
    await expect(talk(hostTab)).toHaveAttribute("aria-pressed", "false");
    expect(await voiceOf(friend, "Suhaas")).toBe("muted");
    const silent = await energy(tab);
    await hostTab.waitForTimeout(1500);
    expect(await energy(tab)).toBeLessThan(silent + 0.001);

    await talk(hostTab).hover();
    await hostTab.mouse.down();
    await expect(talk(hostTab)).toHaveAttribute("aria-pressed", "true");
    await expect(talk(hostTab)).toHaveText("Talking");
    // Everyone sees it within a second: the mic badge on Suhaas's face turns on.
    await expect(badge(tab, "Suhaas")).toHaveAttribute("data-on", "true", { timeout: 1000 });
    await expect.poll(async () => energy(tab), { timeout: 3000 }).toBeGreaterThan(silent + 0.01);

    await hostTab.mouse.up();
    await expect(talk(hostTab)).toHaveAttribute("aria-pressed", "false");
    await expect(badge(tab, "Suhaas")).toHaveAttribute("data-on", "false", { timeout: 1000 });
    // What was already on its way still plays out (a second or three of buffer); then silence.
    await hostTab.waitForTimeout(4500);
    const after = await energy(tab);
    await hostTab.waitForTimeout(1500);
    expect(await energy(tab)).toBeLessThan(after + 0.001);
  });
});

test("Alt+T talks while held and stays out of the way of typing, also in full screen", async () => {
  await withRoom("ptt", async ({ hostTab, tab, friend }) => {
    await bothAllowed(hostTab, tab);
    await hostTab.bringToFront();
    await hostTab.keyboard.down("Alt");
    await hostTab.keyboard.down("KeyT");
    await expect(talk(hostTab)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => voiceOf(friend, "Suhaas")).toBe("live");
    await hostTab.keyboard.up("KeyT");
    await hostTab.keyboard.up("Alt");
    await expect(talk(hostTab)).toHaveAttribute("aria-pressed", "false");

    // Full screen: the key still works, and the button is still there to see it.
    await hostTab.getByRole("button", { name: "Full screen" }).click();
    await expect
      .poll(() => hostTab.evaluate(() => document.fullscreenElement?.id ?? null))
      .toBe("player");
    await hostTab.keyboard.down("Alt");
    await hostTab.keyboard.down("KeyT");
    await expect(talk(hostTab)).toHaveAttribute("aria-pressed", "true");
    await hostTab.keyboard.up("KeyT");
    await hostTab.keyboard.up("Alt");
    await expect(talk(hostTab)).toHaveAttribute("aria-pressed", "false");
    await hostTab.evaluate(() => document.exitFullscreen());
  });
});

test("with the chat box focused, Alt+T types and never transmits", async () => {
  await withRoom("ptt", async ({ hostTab, tab, friend }) => {
    await bothAllowed(hostTab, tab);
    await hostTab.locator("button", { hasText: "Chat" }).first().click();
    const box = hostTab
      .frameLocator("watchsync-sidebar iframe")
      .getByRole("textbox", { name: "Message" });
    await expect(box).toBeEnabled();
    await box.focus();
    await hostTab.keyboard.down("Alt");
    await hostTab.keyboard.down("KeyT");
    await hostTab.waitForTimeout(600);
    expect((await voiceView(hostTab))?.live).toBe(false);
    await expect(talk(hostTab)).toHaveAttribute("aria-pressed", "false");
    expect(await voiceOf(friend, "Suhaas")).toBe("muted");
    await hostTab.keyboard.up("KeyT");
    await hostTab.keyboard.up("Alt");
  });
});

test("open mic: one click mutes and unmutes, and everyone sees it within a second", async () => {
  await withRoom("open", async ({ hostTab, tab, friend, ext }) => {
    await bothAllowed(hostTab, tab);
    // Pressing Talk the first time left them live.
    await expect(talk(hostTab)).toHaveAttribute("aria-label", "Mute your mic");
    await expect(badge(tab, "Suhaas")).toHaveAttribute("data-on", "true");
    await expect(hostTab.getByText("You're live", { exact: true })).toBeVisible();
    expect(await voiceOf(friend, "Suhaas")).toBe("live");

    await talk(hostTab).click();
    await expect(talk(hostTab)).toHaveAttribute("aria-label", "Unmute your mic");
    await expect(badge(tab, "Suhaas")).toHaveAttribute("data-on", "false", { timeout: 1000 });
    await expect(hostTab.getByText("You're live", { exact: true })).toBeHidden();

    await talk(hostTab).click();
    await expect(talk(hostTab)).toHaveAttribute("aria-label", "Mute your mic");
    await expect(badge(tab, "Suhaas")).toHaveAttribute("data-on", "true", { timeout: 1000 });

    // The popup says the same in words, and has its own Talk button.
    const popup = await ext.context.newPage();
    await popup.goto(`chrome-extension://${ext.extensionId}/popup.html`);
    await expect(popup.locator(".people li", { hasText: "Asha" }).locator(".voice")).toHaveText(
      "Talking",
    );
    await expect(popup.getByRole("button", { name: "Mute your mic" })).toBeVisible();
    await tab.getByRole("button", { name: "Mute your mic" }).click();
    await expect(popup.locator(".people li", { hasText: "Asha" }).locator(".voice")).toHaveText(
      "Muted",
    );
    await popup.close();
  });
});

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page: Page, include?: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const builder = new AxeBuilder({ page }).withTags(WCAG);
  const { violations } = await (include ? builder.include(include) : builder).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

test("the voice surfaces pass the WCAG gate: the question, the pill, the popup and settings", async () => {
  await withRoom("open", async ({ hostTab, tab, ext }) => {
    await connected(hostTab);
    await talk(hostTab).click(); // the first press asks first
    await expect(hostTab.getByRole("dialog", { name: /Talk to Asha/ })).toBeVisible();
    await audit(hostTab, "watchsync-overlay");
    await hostTab.getByRole("button", { name: "Allow and talk" }).click();
    await allowAndTalk(tab);
    await expect(badge(tab, "Suhaas")).toHaveAttribute("data-on", "true");
    await audit(hostTab, "watchsync-overlay"); // mint Talk, badges, "You're live"
    const popup = await ext.context.newPage();
    await popup.goto(`chrome-extension://${ext.extensionId}/popup.html`);
    await expect(popup.getByRole("button", { name: "Mute your mic" })).toBeVisible();
    await audit(popup);
    await popup.getByRole("button", { name: "Voice", exact: true }).click();
    await expect(popup.getByRole("group", { name: "Microphone" })).toBeVisible();
    await audit(popup);
  });
});

test("voice settings: open mic or push to talk, saved", async () => {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  try {
    const page = await ext.context.newPage();
    await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
    await page.getByLabel("Your name").fill("Suhaas");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Voice", exact: true }).click();
    await expect(page.getByRole("group", { name: "Microphone" })).toBeVisible();
    // Until Chrome has shown it can keep the film out of the mic, push to talk is the default.
    await expect(page.getByRole("radio", { name: "Push to talk" })).toBeChecked();
    await expect(
      page.getByText("Hold Talk, or Alt+T, while you talk. Best on laptop speakers."),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Open mic" }).check();
    await expect(
      page.getByText("Unmute once and talk freely. Chrome keeps the film out of your mic."),
    ).toBeVisible();
    expect(
      await page.evaluate(async () => (await chrome.storage.local.get("voiceMode")).voiceMode),
    ).toBe("open");
    await expect(
      page.getByText(
        "Your voice goes straight to the people in the room. WatchSync never records it and our server never hears it.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("button", { name: "Create a room" })).toBeVisible();
  } finally {
    await ext.context.close();
  }
});
