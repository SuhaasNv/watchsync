import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";

/** The footer shows the version with its label, as package.json has them ("0.2.1-rc.1"). */
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
  prerelease?: string;
};
const shown = pkg.prerelease ? `v${pkg.version}-${pkg.prerelease}` : `v${pkg.version}`;

test("first run asks for a name, then creates a room", async ({ ext }) => {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  await expect(page.getByRole("heading", { name: "Watch together, in sync" })).toBeVisible();
  await expect(page.getByText(shown)).toBeVisible(); // US-038

  const cont = page.getByRole("button", { name: "Continue" });
  await expect(cont).toBeDisabled();
  await page.getByLabel("Your name").fill("Suhaas");
  await cont.click();

  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.getByTestId("room-code")).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
  await expect(page.getByText("Connected")).toBeVisible();
  await expect(page.getByText("Suhaas (you)")).toBeVisible();

  // The room survives closing and reopening the popup.
  await page.reload();
  await expect(page.getByTestId("room-code")).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
});
