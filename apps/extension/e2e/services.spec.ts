// Service-specific behaviour, played through the mock player.
import { expect, launchWithExtension, MOCK, popup, room, test } from "./fixtures";

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

// Two people on different services (US-053). The mock player claims a service with
// ?service=, and keeps the same title ID on both so only the service tells them apart.
test("different services: both are told, nothing crosses, and it clears on the same title", async ({
  ext,
}) => {
  const host = await popup(ext, "Suhaas");
  await host.getByRole("button", { name: "Create a room" }).click();
  const code = (await host.getByTestId("room-code").textContent()) ?? "";
  const hostTab = await ext.context.newPage();
  await hostTab.goto(`${MOCK}/watch/ep1?service=netflix`);
  await expect(host.getByText("Netflix · Demo Show, E1")).toBeVisible();

  const friend = await launchWithExtension();
  try {
    const fpop = await popup(friend, "Asha");
    await fpop.getByRole("textbox", { name: "Or join a friend's room" }).fill(code);
    await fpop.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(fpop.getByTestId("room-code")).toHaveText(code);
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1?service=prime`);

    // Within 2 s of arriving, both say who is where and why nothing syncs.
    const line = (who: string, theirs: string, ours: string) =>
      `${who} is on ${theirs}, you're on ${ours}. Sync works only on the same title.`;
    await expect(tab.getByText(line("Suhaas", "Netflix", "Prime Video"))).toBeVisible({
      timeout: 2000,
    });
    await expect(hostTab.getByText(line("Asha", "Prime Video", "Netflix"))).toBeVisible({
      timeout: 2000,
    });

    // No play, pause or jump crosses, in either direction.
    await hostTab.waitForTimeout(3200); // past the arrival window (BUG-004)
    const at = (p: typeof tab) =>
      p.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
    const playing = (p: typeof tab) => p.evaluate(() => !document.querySelector("video")?.paused);
    await hostTab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 20;
    });
    await tab.evaluate(() => document.querySelector("video")?.pause());
    await tab.waitForTimeout(2500);
    expect(await at(tab)).toBeLessThan(10); // did not follow the host's jump to 20
    expect(await playing(hostTab)).toBe(true); // her pause did not reach him
    await tab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) {
        v.currentTime = 40;
        void v.play();
      }
    });
    await hostTab.waitForTimeout(2500);
    expect(Math.abs((await at(hostTab)) - 40)).toBeGreaterThan(5); // nor her jump

    // Same title on the same service: the line goes and sync works.
    await tab.goto(`${MOCK}/watch/ep1?service=netflix`);
    await expect(tab.getByText(/Sync works only on the same title/)).toHaveCount(0, {
      timeout: 5000,
    });
    await expect(hostTab.getByText(/Sync works only on the same title/)).toHaveCount(0, {
      timeout: 5000,
    });
    await tab.waitForTimeout(3200);
    await hostTab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 30;
    });
    await expect
      .poll(async () => Math.abs((await at(tab)) - (await at(hostTab))), { timeout: 8000 })
      .toBeLessThan(1.5);
  } finally {
    await friend.context.close();
  }
});
