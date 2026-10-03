// Reactions (UC-015) between two profiles: a burst of taps floats once with a count and the
// sender's name on both screens, never takes clicks, is announced once, and stays still under
// reduced motion.
import type { Page } from "@playwright/test";
import { expect, MOCK, room, test } from "./fixtures";

const layer = (tab: Page) => tab.locator("watchsync-reactions .layer");
const reaction = (tab: Page, name: string) =>
  tab.frameLocator("watchsync-sidebar iframe").getByRole("button", { name, exact: true });

/** Keyframes of the newest float on the page, as JSON. */
const lastFrames = (tab: Page) =>
  tab.evaluate(() => {
    const root = document.querySelector("watchsync-reactions")?.shadowRoot;
    const anims = [...(root?.querySelectorAll(".r") ?? [])].flatMap((n) => n.getAnimations());
    const effect = anims.at(-1)?.effect;
    return effect instanceof KeyframeEffect ? JSON.stringify(effect.getKeyframes()) : "";
  });

test("a burst floats once with a count and the name; reduced motion stays still", async ({
  ext,
}) => {
  const { hostTab, friend } = await room(ext);
  const friendTab = await friend.context.newPage();
  await friendTab.goto(`${MOCK}/watch/ep1`);
  await hostTab.getByRole("button", { name: /^Open chat/ }).click();
  await expect(reaction(hostTab, "Laugh")).toHaveAttribute("title", "Laugh");

  await reaction(hostTab, "Laugh").click({ clickCount: 3 }); // three taps within 250 ms
  for (const tab of [friendTab, hostTab]) {
    await expect(layer(tab).getByText("Suhaas")).toBeVisible({ timeout: 1000 });
    await expect(layer(tab).getByText("×3")).toBeVisible();
    await expect(layer(tab).locator(".r:not([hidden])")).toHaveCount(1); // one send, not three
  }
  expect(await lastFrames(friendTab)).toContain("-240px");
  await expect(layer(friendTab)).toHaveCSS("pointer-events", "none");
  // Clear of the open chat on the sender's screen.
  await expect(layer(hostTab)).toHaveCSS("right", "360px");
  await expect(friendTab.locator('watchsync-reactions [role="status"]')).toHaveText(
    "Suhaas: Laugh",
  );
  // Gone by itself after about 3 s.
  await expect(layer(friendTab).locator(".r:not([hidden])")).toHaveCount(0, { timeout: 4000 });

  await friendTab.emulateMedia({ reducedMotion: "reduce" });
  await reaction(hostTab, "Love").click();
  await expect(layer(friendTab).getByText("❤️")).toBeVisible({ timeout: 1000 });
  const still = await lastFrames(friendTab);
  expect(still).toContain("opacity");
  expect(still).not.toContain("translate");
  await friend.context.close();
});
