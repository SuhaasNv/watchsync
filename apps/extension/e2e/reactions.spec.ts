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

/**
 * Counts emojis as they are put on screen, so a test never depends on several being up at the
 * same instant (a loaded machine can let the first float away first). The five nodes are reused,
 * so each float shows up as one childList change on its node: the glyph, plus the name chip on
 * the first of a burst.
 */
const watchFloats = (tab: Page) =>
  tab.evaluate(() => {
    const root = document.querySelector("watchsync-reactions")?.shadowRoot;
    const seen = { emojis: [] as string[], names: [] as string[] };
    new MutationObserver((records) => {
      for (const rec of records)
        for (const n of rec.addedNodes)
          if (n instanceof HTMLElement)
            (n.className === "n" ? seen.names : seen.emojis).push(n.textContent ?? "");
    }).observe(root?.querySelector(".layer") ?? document, { childList: true, subtree: true });
    Object.assign(window, { seen });
  });
const floated = (tab: Page) =>
  tab.evaluate(() => (window as unknown as { seen: { emojis: string[]; names: string[] } }).seen);

test("a burst floats as separate emojis with the name on the first; reduced motion stays still", async ({
  ext,
}) => {
  const { hostTab, friend } = await room(ext);
  const friendTab = await friend.context.newPage();
  await friendTab.goto(`${MOCK}/watch/ep1`);
  await hostTab.getByRole("button", { name: /^Open chat/ }).click();
  await expect(reaction(hostTab, "Laugh")).toHaveAttribute("title", "Laugh");

  for (const tab of [friendTab, hostTab]) await watchFloats(tab);
  await reaction(hostTab, "Laugh").click({ clickCount: 3 }); // three taps within 250 ms
  for (const tab of [friendTab, hostTab]) {
    // Three separate emojis, not one, and the name once.
    await expect
      .poll(() => floated(tab), { timeout: 5000 })
      .toEqual({
        emojis: ["😂", "😂", "😂"],
        names: ["Suhaas"],
      });
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
  for (const tab of [friendTab, hostTab]) expect((await floated(tab)).emojis).toHaveLength(3); // no fourth

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
