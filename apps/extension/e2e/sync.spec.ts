import type { Page } from "@playwright/test";
import { expect, MOCK, room, test } from "./fixtures";

const position = (p: Page) => p.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
const playing = (p: Page) => p.evaluate(() => !document.querySelector("video")?.paused);
const gap = async (a: Page, b: Page) => Math.abs((await position(a)) - (await position(b)));
/** Runs the player fast for a moment: drift without any play, pause or seek event. */
const drift = (p: Page, rate: number, ms: number) =>
  p.evaluate(
    ([r, t]) =>
      new Promise<void>((done) => {
        const v = document.querySelector("video");
        if (!v) return done();
        v.playbackRate = r;
        setTimeout(() => {
          v.playbackRate = 1;
          done();
        }, t);
      }),
    [rate, ms] as const,
  );

test("small drift is corrected silently", async ({ ext }) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)
    await hostTab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 10; // a shared starting point
    });
    await expect.poll(() => gap(tab, hostTab)).toBeLessThan(1);
    await hostTab.waitForTimeout(1600);

    await drift(tab, 3, 1000); // about 2 s ahead
    await expect.poll(() => gap(tab, hostTab), { timeout: 6000 }).toBeLessThan(1);
    await expect(tab.getByText("seconds ahead")).toHaveCount(0);
    await expect(hostTab.getByText(/Asha (skipped|went back)/)).toHaveCount(0);
  } finally {
    await friend.context.close();
  }
});

/** Puts the friend's tab 9 s ahead of the room without it counting as the friend's jump. */
async function landAhead(hostTab: Page, tab: Page) {
  await tab.goto(`${MOCK}/watch/ep1`);
  await expect.poll(() => playing(tab)).toBe(true);
  await tab.waitForTimeout(3200); // past the arrival window (BUG-004)
  await hostTab.evaluate(() => {
    const v = document.querySelector("video");
    if (v) v.currentTime = 10;
  });
  await expect.poll(() => gap(tab, hostTab)).toBeLessThan(1);
  await hostTab.waitForTimeout(1600);

  // The friend lands 9 s ahead right after applying the host's play, inside the echo
  // window, so it counts as drift rather than as the friend's own jump.
  await hostTab.evaluate(() => document.querySelector("video")?.pause());
  await expect.poll(() => playing(tab)).toBe(false);
  await hostTab.waitForTimeout(1600);
  await hostTab.evaluate(() => document.querySelector("video")?.play());
  await expect.poll(() => playing(tab), { intervals: [50] }).toBe(true);
  await tab.evaluate(() => {
    const v = document.querySelector("video");
    if (v) v.currentTime += 9;
  });
  await expect(tab.getByText(/You're \d+ seconds ahead of Suhaas/)).toBeVisible({ timeout: 4000 });
}

test("large drift asks, and Catch up snaps back", async ({ ext }) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await landAhead(hostTab, tab);
    await tab.getByRole("button", { name: "Catch up" }).click();
    await expect.poll(() => gap(tab, hostTab)).toBeLessThan(1);
    await expect(tab.getByText(/seconds ahead/)).toHaveCount(0);
  } finally {
    await friend.context.close();
  }
});

test("Stay here keeps my position and stops asking", async ({ ext }) => {
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await landAhead(hostTab, tab);
    await tab.getByRole("button", { name: "Stay here" }).click();
    await expect(tab.getByText(/seconds ahead/)).toHaveCount(0);
    await tab.waitForTimeout(2500); // drift is checked every second: it must not come back
    await expect(tab.getByText(/seconds ahead/)).toHaveCount(0);
    expect(await gap(tab, hostTab)).toBeGreaterThan(5);
  } finally {
    await friend.context.close();
  }
});

test("watching on my own stops following until Rejoin the room", async ({ ext }) => {
  const { host, hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)

    await tab.getByRole("button", { name: "Watch on my own" }).click();
    await expect(host.getByText(/On their own/)).toBeVisible();

    // The host pauses; the friend keeps playing and isn't pulled back.
    await hostTab.evaluate(() => document.querySelector("video")?.pause());
    await tab.waitForTimeout(1500);
    expect(await playing(tab)).toBe(true);
    // The friend jumps; the host doesn't move.
    const hostAt = await position(hostTab);
    await tab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime = 90;
    });
    await tab.waitForTimeout(1500);
    expect(Math.abs((await position(hostTab)) - hostAt)).toBeLessThan(0.5);

    await tab.getByRole("button", { name: "Rejoin the room" }).click();
    await expect.poll(() => playing(tab)).toBe(false);
    await expect.poll(() => gap(tab, hostTab)).toBeLessThan(1);
    await expect(host.getByText(/On their own/)).toHaveCount(0);
  } finally {
    await friend.context.close();
  }
});

test("the pill shows who is here, folds away, and stays in full screen", async ({ ext }) => {
  const { friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    const region = tab.getByRole("region", { name: "WatchSync room" });
    await expect(region.getByRole("img", { name: "Suhaas, in sync" })).toBeVisible();
    await expect(region.getByRole("img", { name: "Asha (you), in sync" })).toBeVisible();

    // The arrow folds the pill down to the faces, and back (owner, 2 October 2026).
    await region.getByRole("button", { name: "Hide room controls" }).click();
    await expect(region.getByRole("button", { name: "Watch on my own" })).toHaveCount(0);
    await expect(region.getByRole("img", { name: "Suhaas, in sync" })).toBeVisible();
    await region.getByRole("button", { name: "Show room controls" }).click();
    await expect(region.getByRole("button", { name: "Watch on my own" })).toBeVisible();

    // Playing together, the start button pauses everyone instead; paused, it starts again.
    const pauseAll = region.getByRole("button", { name: "Pause everyone" });
    await expect(pauseAll).toBeVisible();
    await pauseAll.click();
    await expect.poll(() => playing(tab)).toBe(false);
    await expect(region.getByRole("button", { name: "Start with 3-2-1" })).toBeVisible();

    await tab.getByRole("button", { name: "Full screen" }).click();
    await expect
      .poll(() =>
        tab.evaluate(
          () =>
            document.fullscreenElement?.contains(document.querySelector("watchsync-overlay")) ??
            false,
        ),
      )
      .toBe(true);
  } finally {
    await friend.context.close();
  }
});

test("Pause everyone right after a page loads still pauses everyone", async ({ ext }) => {
  const { friend, hostTab } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    // Inside the first seconds after a load, where autoplay is ignored (BUG-004): the press
    // is still the person's own and must not be undone.
    const region = tab.getByRole("region", { name: "WatchSync room" });
    await region.getByRole("button", { name: "Pause everyone" }).click();
    await tab.waitForTimeout(4000);
    expect(await playing(tab)).toBe(false);
    expect(await playing(hostTab)).toBe(false);
    await expect(region.getByRole("button", { name: "Start with 3-2-1" })).toBeVisible();
  } finally {
    await friend.context.close();
  }
});

test("Bring everyone here shows only when I'm off, and brings the room to my exact spot", async ({
  ext,
}) => {
  const { friend, hostTab } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    const bring = (p: Page) =>
      p
        .getByRole("region", { name: "WatchSync room" })
        .getByRole("button", { name: "Bring everyone here" });
    await landAhead(hostTab, tab);
    // In step, nobody is offered it: small drift fixes itself.
    await expect(bring(hostTab)).toHaveCount(0);
    // 9 s ahead of the room, the friend can bring everyone to where they are instead.
    await expect(bring(tab)).toBeVisible();
    await bring(tab).click();
    await expect(tab.getByText("Everyone is here with you")).toBeVisible();
    // Nine seconds is a jump for Suhaas, so he's told where Asha took him (one notice).
    await expect(hostTab.getByText(/Asha skipped ahead to/)).toBeVisible();
    await expect.poll(() => gap(tab, hostTab)).toBeLessThan(0.2);
    expect(await playing(tab)).toBe(true);
    expect(await playing(hostTab)).toBe(true);
    // Back in step: the drift prompt and the button go away.
    await expect(tab.getByText(/seconds ahead/)).toHaveCount(0);
    await expect(bring(tab)).toHaveCount(0);
  } finally {
    await friend.context.close();
  }
});

test("closing the show tells the others, and nobody is offered a title no one watches", async ({
  ext,
}) => {
  const { friend, hostTab, host } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect.poll(() => playing(tab)).toBe(true);
    await tab.close(); // Asha closes the show but stays in the room
    await expect(hostTab.getByText("Asha closed the show")).toBeVisible({ timeout: 8000 });

    // Suhaas closes it too: the room remembers ep1, but nobody is watching it.
    await hostTab.close();
    const fpopPage = await friend.context.newPage();
    await fpopPage.goto(`chrome-extension://${friend.extensionId}/popup.html`);
    await expect(fpopPage.getByRole("heading", { name: "In this room (2)" })).toBeVisible();
    await fpopPage.waitForTimeout(4000); // the closed tab reports "nothing open" after 3 s
    await expect(fpopPage.getByRole("button", { name: /^Open (?!chat)/ })).toHaveCount(0);
    await expect(host.getByRole("button", { name: /^Open (?!chat)/ })).toHaveCount(0);
  } finally {
    await friend.context.close();
  }
});
