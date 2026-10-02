import type { Page } from "@playwright/test";
import { expect, launchWithExtension, MOCK, popup, test } from "./fixtures";

const playing = (p: Page) => p.evaluate(() => !document.querySelector("video")?.paused);
const noSideScroll = (p: Page) =>
  p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("a pasted invite link fills the code box", async ({ ext }) => {
  const page = await popup(ext, "Asha");
  const box = page.getByRole("textbox", { name: "Or join a friend's room" });
  await box.fill("http://localhost:8000/j/xk4m9q");
  await expect(box).toHaveValue("XK4M9Q");
  await box.fill(" XK4 M9Q ");
  await expect(box).toHaveValue("XK4M9Q");
  await expect(page.getByRole("button", { name: "Join room", exact: true })).toBeEnabled();
});

test("an emoji name joined with ZWJ can still create a room", async ({ ext }) => {
  const page = await popup(ext, "Dev 👩\u200d💻");
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.getByTestId("room-code")).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
});

test("30-character names never scroll the popup sideways", async ({ ext }) => {
  const long = "W".repeat(30);
  const host = await popup(ext, long);
  expect(await noSideScroll(host)).toBe(true); // home: "You're WWW… · Change name"
  await host.getByRole("button", { name: "Create a room" }).click();
  const code = (await host.getByTestId("room-code").textContent()) ?? "";
  const friend = await launchWithExtension();
  try {
    const fpop = await popup(friend, "M".repeat(30));
    await fpop.getByRole("textbox", { name: "Or join a friend's room" }).fill(code);
    await fpop.getByRole("button", { name: "Join room", exact: true }).click();
    const hostTab = await ext.context.newPage();
    await hostTab.goto(`${MOCK}/watch/ep1`);
    // The room line names the friend: "MMM… hasn't opened a title yet."
    await expect(host.getByText(/M{30} hasn't opened a title yet/)).toBeVisible();
    expect(await noSideScroll(host)).toBe(true);
    expect(await noSideScroll(fpop)).toBe(true);
  } finally {
    await friend.context.close();
  }
});

test("a pause still reaches friends when a speed tool runs the player past 4x", async ({ ext }) => {
  const host = await popup(ext, "Suhaas");
  await host.getByRole("button", { name: "Create a room" }).click();
  const code = (await host.getByTestId("room-code").textContent()) ?? "";
  const hostTab = await ext.context.newPage();
  await hostTab.goto(`${MOCK}/watch/ep1`);
  const friend = await launchWithExtension();
  try {
    const fpop = await popup(friend, "Asha");
    await fpop.getByRole("textbox", { name: "Or join a friend's room" }).fill(code);
    await fpop.getByRole("button", { name: "Join room", exact: true }).click();
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)

    await hostTab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.playbackRate = 8;
    });
    await hostTab.waitForTimeout(500);
    await hostTab.evaluate(() => document.querySelector("video")?.pause());
    await expect.poll(() => playing(tab), { timeout: 5000 }).toBe(false);
  } finally {
    await friend.context.close();
  }
});

test("joining another room from its invite link leaves the first one", async ({ ext }) => {
  const host = await popup(ext, "Suhaas");
  await host.getByRole("button", { name: "Create a room" }).click();
  const first = (await host.getByTestId("room-code").textContent()) ?? "";
  const other = await launchWithExtension();
  const friend = await launchWithExtension();
  try {
    const otherPop = await popup(other, "Ravi");
    await otherPop.getByRole("button", { name: "Create a room" }).click();
    const second = (await otherPop.getByTestId("room-code").textContent()) ?? "";

    const fpop = await popup(friend, "Asha");
    await fpop.getByRole("textbox", { name: "Or join a friend's room" }).fill(first);
    await fpop.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(host.getByText("In this room (2)")).toBeVisible();

    const invite = await friend.context.newPage();
    await invite.goto(`http://localhost:8000/j/${second}`);
    await invite.getByRole("button", { name: "Join room" }).click();
    await expect(otherPop.getByText("In this room (2)")).toBeVisible();
    // Gone from the first room, not left behind as "Away".
    const people = host.getByRole("list", { name: "People in the room" });
    await expect(people.getByText("Asha")).toHaveCount(0);
  } finally {
    await other.context.close();
    await friend.context.close();
  }
});
