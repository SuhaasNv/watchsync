import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, launchWithExtension, test } from "./fixtures";

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
