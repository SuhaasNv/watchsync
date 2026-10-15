// A blocked microphone (US-057): Chrome says no, Talk shows the exact steps for this system,
// sync and chat carry on, and once it is fixed Talk starts voice without a reload.
import { expect, launchWithExtension, MOCK, test } from "./fixtures";
import { talk, twoTabs, voiceView } from "./voice-helpers";

/** A fake microphone exists, but Chrome refuses every question about it (as if blocked). */
const DENIED = ["--use-fake-device-for-media-stream", "--deny-permission-prompts"];

test("Chrome denies the mic: the steps appear, chat still works, and fixing it needs no reload", async () => {
  const ext = await launchWithExtension("", { args: DENIED });
  try {
    const { hostTab, tab, friend } = await twoTabs(ext, "open", DENIED);
    await expect.poll(async () => (await voiceView(hostTab))?.mic).toBe("off"); // listening

    await talk(hostTab).click();
    await hostTab.getByRole("button", { name: "Allow and talk" }).click();
    // One line, one way to the steps.
    await expect(hostTab.getByText("Chrome blocked your microphone.")).toBeVisible();
    await hostTab.getByRole("button", { name: "Show me how" }).click();
    const help = hostTab.getByRole("dialog", { name: "Turn your mic back on" });
    await expect(help).toBeVisible();
    const steps = await help.getByRole("listitem").allInnerTexts();
    expect(steps[0]).toMatch(/Chrome's settings for WatchSync/);
    expect(steps[1]).toBe("Set Microphone to Allow.");
    // This machine is a Mac: its step shows, and the Windows one does not.
    const mac = process.platform === "darwin";
    expect(steps.join("\n")).toMatch(
      mac ? /System Settings › Privacy & Security › Microphone/ : /Come back/,
    );
    if (mac) expect(steps.join("\n")).not.toMatch(/desktop apps/);
    expect(steps.at(-1)).toBe("Come back and press Talk.");
    await expect(help.getByText("Sync and chat keep working without a mic.")).toBeVisible();
    expect((await voiceView(hostTab))?.mic).toBe("blocked");

    // The button opens Chrome's settings for WatchSync itself.
    const opened = ext.context.waitForEvent("page");
    await help.getByRole("button", { name: "Open mic settings" }).click();
    const settings = await opened;
    expect(decodeURIComponent(settings.url())).toBe(
      `chrome://settings/content/siteDetails?site=chrome-extension://${ext.extensionId}`,
    );
    await settings.close();

    // The popup says it too.
    const popup = await ext.context.newPage();
    await popup.goto(`chrome-extension://${ext.extensionId}/popup.html`);
    await expect(popup.getByRole("heading", { name: "Turn your mic back on" })).toBeVisible();
    await expect(popup.getByRole("button", { name: "Open mic settings" })).toBeVisible();
    await popup.close();

    // Sync and chat keep working: a message reaches the friend.
    await hostTab.locator("button", { hasText: "Chat" }).first().click();
    const box = hostTab
      .frameLocator("watchsync-sidebar iframe")
      .getByRole("textbox", { name: "Message" });
    await expect(box).toBeEnabled();
    await box.fill("still here");
    await box.press("Enter");
    await expect(tab.getByRole("button", { name: /^Open chat.*1 unread$/ })).toBeVisible();

    // Fixed in Chrome's settings: pressing Talk again works at once, with no reload. (Playwright
    // can only grant a web origin, not an extension's: it grants the page's. That this unblocks
    // the extension's frame says Chrome judges a framed page's microphone by the top-level site;
    // see the report on which settings page the help should open.)
    await ext.context.grantPermissions(["microphone"], { origin: MOCK });
    await talk(hostTab).click();
    await expect(talk(hostTab)).toHaveAttribute("aria-pressed", "true");
    expect((await voiceView(hostTab))?.mic).toBe("on");
    await expect(help).toBeHidden();
    await friend.context.close();
  } finally {
    await ext.context.close();
  }
});
