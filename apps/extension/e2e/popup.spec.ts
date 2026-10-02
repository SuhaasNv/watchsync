import { expect, test } from "./fixtures";

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
