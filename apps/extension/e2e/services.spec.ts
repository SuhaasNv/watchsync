// Service-specific behaviour, played through the mock player.
import { expect, MOCK, room, test } from "./fixtures";

test("an episode change inside the player (Prime style) asks instead of reloading", async ({
  ext,
}) => {
  const { hostTab, friend } = await room(ext);
  try {
    const setEpisode = (p: typeof hostTab, ep: string) =>
      p.evaluate((e) => {
        let el = document.querySelector<HTMLElement>("[data-episode]");
        if (!el) {
          el = document.createElement("span");
          document.body.append(el);
        }
        el.dataset.episode = e;
      }, ep);
    await setEpisode(hostTab, "Ep. 1");
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/show`);
    await setEpisode(tab, "Ep. 1");
    await hostTab.goto(`${MOCK}/watch/show`); // host opens the show: the room takes it
    await setEpisode(hostTab, "Ep. 1");
    await tab.waitForTimeout(3200);

    await setEpisode(hostTab, "Ep. 2"); // next episode inside the player
    await expect(tab.getByText("Suhaas is on Demo show, Ep. 2. Pick it in the player")).toBeVisible(
      {
        timeout: 6000,
      },
    );
    expect(tab.url()).toBe(`${MOCK}/watch/show`); // no reload

    // The friend picks it in the player: the question goes and both play the episode together.
    await setEpisode(tab, "Ep. 2");
    await expect(tab.getByText(/Pick it in the player/)).toHaveCount(0, { timeout: 4000 });
    const at = (p: typeof tab) =>
      p.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
    await expect
      .poll(async () => Math.abs((await at(tab)) - (await at(hostTab))), { timeout: 8000 })
      .toBeLessThan(1);
  } finally {
    await friend.context.close();
  }
});

test("live streams say they can't be synced yet", async ({ ext }) => {
  const { friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await tab.evaluate(() => {
      document.body.dataset.live = "1";
    });
    await expect(tab.getByText("Live streams can't be synced yet")).toBeVisible({ timeout: 5000 });
  } finally {
    await friend.context.close();
  }
});
