// Reactions (UC-015) between two profiles: a burst of taps floats as that many separate emojis
// (never more than five) with the sender's name on the first, on both screens, never takes
// clicks, is announced once, and stays still under reduced motion.
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

test("a burst floats as separate emojis with the name on the first; reduced motion stays still", async ({
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
    // Three emojis, not one.
    await expect(layer(tab).locator(".r:not([hidden])")).toHaveCount(3, { timeout: 1000 });
    await expect(layer(tab).locator(".r:not([hidden]) .n")).toHaveCount(1); // the name once
    await expect(layer(tab).getByText("×3")).toHaveCount(0); // no badge
  }
  const frames = await lastFrames(friendTab);
  expect(frames).toContain("translate3d");
  expect(frames).toContain("scale(1.15)");
  await expect(layer(friendTab)).toHaveCSS("pointer-events", "none");
  // Clear of the open chat on the sender's screen.
  await expect(layer(hostTab)).toHaveCSS("right", "360px");
  await expect(friendTab.locator('watchsync-reactions [role="status"]')).toHaveText(
    "Suhaas: Laugh",
  );
  // Each goes at its own time, all within about 4.5 s.
  await expect(layer(friendTab).locator(".r:not([hidden])")).toHaveCount(0, { timeout: 5000 });

  // Many taps never put more than five on screen.
  const most = friendTab.evaluate(
    () =>
      new Promise<number>((done) => {
        const root = document.querySelector("watchsync-reactions")?.shadowRoot;
        let top = 0;
        const t = setInterval(() => {
          top = Math.max(top, root?.querySelectorAll(".r:not([hidden])").length ?? 0);
        }, 25);
        setTimeout(() => {
          clearInterval(t);
          done(top);
        }, 1200);
      }),
  );
  await reaction(hostTab, "Fire").click({ clickCount: 5 });
  await reaction(hostTab, "Fire").click({ clickCount: 5 });
  expect(await most).toBe(5); // ten were sent, five were ever up
  await expect(layer(friendTab).locator(".r:not([hidden])")).toHaveCount(0, { timeout: 6000 });

  await friendTab.emulateMedia({ reducedMotion: "reduce" });
  await reaction(hostTab, "Love").click();
  await expect(layer(friendTab).getByText("❤️")).toBeVisible({ timeout: 1000 });
  const still = await lastFrames(friendTab);
  expect(still).toContain("opacity");
  expect(still).not.toContain("translate");
  await friend.context.close();
});
