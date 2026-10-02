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
  } finally {
    await friend.context.close();
  }
});
