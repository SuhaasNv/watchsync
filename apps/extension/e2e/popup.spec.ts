import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, launchWithExtension, MOCK, popup, test } from "./fixtures";

test("the name field says what's wrong and only continues with a usable name", async ({ ext }) => {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  const name = page.getByLabel("Your name");
  const go = page.getByRole("button", { name: "Continue" });
  await expect(go).toBeDisabled();
  await name.fill("...!!");
  await name.blur();
  await expect(page.getByText("Use at least one letter or number.")).toBeVisible();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(go).toBeDisabled();
  await name.fill("\u200b  ");
  await expect(page.getByText("Enter your name.")).toBeVisible();
  await name.fill("Maya 😀");
  await expect(name).not.toHaveAttribute("aria-invalid", "true");
  await go.click();
  await expect(page.getByText("You're Maya 😀")).toBeVisible();
});

test("name can be changed after first run", async ({ ext }) => {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  await page.getByLabel("Your name").fill("Suhaas");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Change name" }).click();
  await expect(page.getByLabel("Your name")).toHaveValue("Suhaas");
  await page.getByLabel("Your name").fill("Asha");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("You're Asha")).toBeVisible();
});

test("footer links go to the website", async ({ ext }) => {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  const link = (name: string) => page.getByRole("link", { name, exact: true });
  await expect(link("watchsync.space")).toHaveAttribute("href", "https://watchsync.space");
  await expect(link("Privacy")).toHaveAttribute("href", "https://watchsync.space/privacy/");
  await expect(link("Terms")).toHaveAttribute("href", "https://watchsync.space/terms/");
});

test("create shows a retry message when the service is down", async ({ ext }) => {
  await ext.context.route("**/api/v1/rooms", (route) => route.abort());
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  await page.getByLabel("Your name").fill("Suhaas");
  await page.getByRole("button", { name: "Continue" }).click();

  const create = page.getByRole("button", { name: "Create a room" });
  await create.click();
  await expect(page.getByRole("alert")).toHaveText("We couldn't create the room. Try again.");
  await expect(create).toBeEnabled();
});

test("the popup says when a newer release is out (UC-012)", async () => {
  const profile = mkdtempSync(path.join(tmpdir(), "watchsync-update-"));
  const url = "https://github.com/SuhaasNv/watchsync/releases/tag/v9.0.0";
  try {
    // First run: wait for the worker's own check (offline in test builds), then plant the
    // answer GitHub would give as the daily cache the next start reads.
    const first = await launchWithExtension(profile);
    const [worker] = first.context.serviceWorkers();
    if (!worker) throw new Error("no service worker");
    const cached = () =>
      worker.evaluate(async () => (await chrome.storage.local.get("updateCheck")).updateCheck);
    await expect.poll(cached).toBeTruthy();
    await worker.evaluate(
      (url) =>
        chrome.storage.local.set({
          updateCheck: { checkedAt: Date.now(), latest: { version: "9.0.0", url } },
        }),
      url,
    );
    await first.context.close();

    const again = await launchWithExtension(profile);
    try {
      const page = await again.context.newPage();
      await page.goto(`chrome-extension://${again.extensionId}/popup.html`);
      await expect(page.getByText("WatchSync 9.0.0 is out")).toBeVisible();
      const link = page.getByRole("link", { name: "Download" });
      await expect(link).toHaveAttribute("href", url);
      await expect(link).toHaveAttribute("target", "_blank");
      // Let the screen's fade-in finish: axe reads mid-fade colours as low contrast.
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY)
            .map((a) => a.finished),
        ),
      );
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(violations.map((v) => v.id)).toEqual([]);
    } finally {
      await again.context.close();
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test("Open chat brings the room's tab forward with chat open and focused (US-115)", async ({
  ext,
}) => {
  const pop = await popup(ext, "Suhaas");
  await pop.getByRole("button", { name: "Create a room" }).click();
  const open = pop.getByRole("button", { name: "Open chat" });
  await expect(open).toBeDisabled();
  await expect(pop.getByText("Open the title on a supported service first.")).toBeVisible();

  const [worker] = ext.context.serviceWorkers();
  if (!worker) throw new Error("extension service worker not running");
  const tabIds = () => worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id));
  const before = await tabIds();
  const tab = await ext.context.newPage();
  await tab.goto(`${MOCK}/watch/ep1`);
  await expect(pop.getByText("Test player · Demo Show, E1")).toBeVisible();
  const id = (await tabIds()).find((t) => !before.includes(t));
  const active = () => worker.evaluate(async (id) => (await chrome.tabs.get(id ?? -1)).active, id);
  const other = await ext.context.newPage(); // another tab in front of the player
  await other.goto("about:blank");
  await expect.poll(active).toBe(false);
  await pop.reload();
  await pop.getByRole("button", { name: "Open chat" }).click();

  await expect.poll(active).toBe(true);
  await expect(tab.getByRole("region", { name: "WatchSync", exact: true })).toBeVisible();
  const chat = tab.frameLocator("watchsync-sidebar iframe");
  await expect(chat.getByRole("textbox", { name: "Message" })).toBeFocused();
});
