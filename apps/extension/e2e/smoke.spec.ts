import { expect, test } from "./fixtures";

test("extension loads and the popup opens", async ({ ext }) => {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  await expect(page.getByRole("heading", { name: "WatchSync" })).toBeVisible();
});
