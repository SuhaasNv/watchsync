// Edge cases of a two-person movie night, played through the mock player.
import type { Page } from "@playwright/test";
import { expect, launchWithExtension, MOCK, popup, room, test } from "./fixtures";

const playing = (p: Page) => p.evaluate(() => !document.querySelector("video")?.paused);
const position = (p: Page) => p.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
const gap = async (a: Page, b: Page) => Math.abs((await position(a)) - (await position(b)));
const seek = (p: Page, to: number) =>
  p.evaluate((t) => {
    const v = document.querySelector("video");
    if (v) v.currentTime = t;
  }, to);

/** Resolves true if `text` shows on `page` at any moment in the next `ms` (notices fade). */
const seen = (page: Page, text: string | RegExp, ms: number) =>
  page
    .getByText(text)
    .first()
    .waitFor({ timeout: ms })
    .then(() => true)
    .catch(() => false);

/** Both on ep1, playing in sync from 0:20, past the arrival window (BUG-004). */
async function bothWatching(ext: Parameters<typeof room>[0]) {
  const r = await room(ext);
  const tab = await r.friend.context.newPage();
  await tab.goto(`${MOCK}/watch/ep1`);
  await expect.poll(() => playing(tab)).toBe(true);
  await tab.waitForTimeout(3200);
  await seek(r.hostTab, 20);
  await expect.poll(() => gap(tab, r.hostTab)).toBeLessThan(1);
  await r.hostTab.waitForTimeout(1600);
  return { ...r, tab };
}

type Press = "pause" | "jump" | "pressLate";

/** Each page does its press at the same wall-clock moment (one machine, one clock). */
async function atOnce(a: Page, pressA: Press, b: Page, pressB: Press) {
  const at = Date.now() + 400;
  const schedule = (p: Page, press: Press) =>
    p.evaluate(
      ([when, what]) => {
        const v = document.querySelector("video");
        if (!v) return;
        const run = {
          pause: () => v.pause(),
          jump: () => {
            v.currentTime += 30;
          },
          // 150 ms later, on whatever state the player is in by then: a toggle.
          pressLate: () => setTimeout(() => (v.paused ? void v.play() : v.pause()), 150),
        }[what];
        setTimeout(run, when - Date.now());
      },
      [at, press] as const,
    );
  await Promise.all([schedule(a, pressA), schedule(b, pressB)]);
  await a.waitForTimeout(500);
}

/** Same play state and position, and still so a moment later: no ping-pong. */
async function together(a: Page, b: Page) {
  await a.waitForTimeout(4500); // a mismatch is resolved after 3 s; judge after that
  await expect
    .poll(async () => (await playing(a)) === (await playing(b)), { timeout: 8000 })
    .toBe(true);
  await expect.poll(() => gap(a, b), { timeout: 6000 }).toBeLessThan(1);
  const state = await playing(a);
  for (let i = 0; i < 4; i++) {
    await a.waitForTimeout(500);
    expect(await playing(a)).toBe(state);
    expect(await playing(b)).toBe(state);
  }
}

test("a press just after the friend's pause doesn't leave them apart", async ({ ext }) => {
  const { hostTab, friend, tab } = await bothWatching(ext);
  try {
    // Suhaas pauses; 150 ms later Asha presses too, on a player WatchSync just paused, so
    // her press starts it again. It falls in the echo window and never reaches the room.
    await atOnce(hostTab, "pause", tab, "pressLate");
    await together(hostTab, tab);
  } finally {
    await friend.context.close();
  }
});

test("two changes at the same moment end with both in the same place", async ({ ext }) => {
  const { hostTab, friend, tab } = await bothWatching(ext);
  try {
    // They cross on the wire: each gets the other's change after making their own.
    await atOnce(hostTab, "pause", tab, "jump");
    await together(hostTab, tab);
  } finally {
    await friend.context.close();
  }
});

test("a jump while the friend is loading lands everyone at the new spot", async ({ ext }) => {
  const { hostTab, friend, tab } = await bothWatching(ext);
  try {
    await tab.evaluate(() => (document.body.dataset.buffering = "1"));
    await expect(hostTab.getByText("Waiting for Asha to load")).toBeVisible({ timeout: 4000 });
    await hostTab.waitForTimeout(1600); // past the echo of the room's pause
    await seek(hostTab, 100);
    await hostTab.waitForTimeout(500);
    await tab.evaluate(() => delete document.body.dataset.buffering);
    await expect.poll(() => playing(hostTab), { timeout: 5000 }).toBe(true);
    await expect.poll(() => gap(tab, hostTab), { timeout: 6000 }).toBeLessThan(1);
    expect(await position(tab)).toBeGreaterThan(99);
  } finally {
    await friend.context.close();
  }
});

test("going back to browse mid-film doesn't move the room, and coming back catches up", async ({
  ext,
}) => {
  const { hostTab, friend, tab } = await bothWatching(ext);
  try {
    const before = await position(tab);
    const started = Date.now();
    await hostTab.goto(`${MOCK}/browse`);
    await expect(tab.getByText("Suhaas closed the show")).toBeVisible({ timeout: 8000 });
    // The friend's film runs on undisturbed.
    expect(await playing(tab)).toBe(true);
    const ran = (Date.now() - started) / 1000;
    expect(Math.abs((await position(tab)) - before - ran)).toBeLessThan(1.5);

    const asked = seen(tab, /Open it\?|Suhaas opened/, 6000);
    await hostTab.goto(`${MOCK}/watch/ep1`); // back to the same film
    await expect.poll(() => gap(tab, hostTab), { timeout: 8000 }).toBeLessThan(1);
    expect(await asked).toBe(false);
    expect(tab.url()).toBe(`${MOCK}/watch/ep1`);
  } finally {
    await friend.context.close();
  }
});

test("reloading mid-film catches up without telling anyone anything", async ({ ext }) => {
  const { hostTab, friend, tab } = await bothWatching(ext);
  try {
    // Like Netflix after a load: the title can't be read until its controls show.
    await tab.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        document.body.dataset.loading = "1";
        setTimeout(() => delete document.body.dataset.loading, 1500);
      });
    });
    const noise = seen(hostTab, /^Asha /, 7000);
    await tab.reload();
    await expect.poll(() => gap(tab, hostTab), { timeout: 8000 }).toBeLessThan(1);
    expect(await playing(tab)).toBe(true);
    expect(await noise).toBe(false);
  } finally {
    await friend.context.close();
  }
});

test("moving to the next episode during the start countdown lands both on it, in sync", async ({
  ext,
}) => {
  const { hostTab, friend, tab } = await bothWatching(ext);
  try {
    await hostTab.getByRole("button", { name: "Pause everyone" }).click();
    await expect.poll(() => playing(tab)).toBe(false);
    await hostTab.getByRole("button", { name: "Start with 3-2-1" }).click();
    await expect(tab.getByText(/Starting together in [123]/)).toBeVisible({ timeout: 5000 });
    await hostTab.getByRole("link", { name: "Next episode" }).click();
    await tab.waitForURL(`${MOCK}/watch/ep2`, { timeout: 6000 });
    await expect.poll(() => gap(tab, hostTab), { timeout: 8000 }).toBeLessThan(1);
    expect(await position(hostTab)).toBeLessThan(15); // from the top, not the old spot
    await expect(tab.getByText(/Starting together/)).toHaveCount(0);
  } finally {
    await friend.context.close();
  }
});

test("Bring everyone here while the friend is on an ad waits for the ad", async ({ ext }) => {
  const { hostTab, friend, tab } = await bothWatching(ext);
  try {
    await tab.evaluate(() => {
      const el = document.createElement("div");
      el.dataset.ad = "";
      el.textContent = "Ad 0:30";
      document.body.append(el);
    });
    const bring = hostTab
      .getByRole("region", { name: "WatchSync room" })
      .getByRole("button", { name: "Bring everyone here" });
    // Right as the room's pause for the ad reaches Suhaas, his player lands 30 s on, inside
    // the echo window: he is off from the room, so Bring everyone here shows. (The wait
    // card takes the prompt's place, so the drift prompt itself isn't checked.)
    await expect.poll(() => playing(hostTab), { intervals: [50] }).toBe(false);
    await hostTab.evaluate(() => {
      const v = document.querySelector("video");
      if (v) v.currentTime += 30;
    });
    await expect(hostTab.getByText(/Asha is on an ad/)).toBeVisible({ timeout: 4000 });
    await expect(bring).toBeVisible({ timeout: 4000 });
    const at = await position(hostTab);
    await seek(tab, 200); // the ad moves Asha's player somewhere else
    await bring.click();
    await hostTab.waitForTimeout(1500);
    expect(await playing(hostTab)).toBe(false); // still waiting for the ad, not playing
    await expect(hostTab.getByText(/Asha is on an ad/)).toBeVisible();

    await tab.evaluate(() => document.querySelector("[data-ad]")?.remove());
    await expect.poll(() => playing(hostTab), { timeout: 5000 }).toBe(true);
    await expect.poll(() => gap(tab, hostTab), { timeout: 6000 }).toBeLessThan(1);
    expect(Math.abs((await position(tab)) - at)).toBeLessThan(5);
  } finally {
    await friend.context.close();
  }
});

test("a very long title fits the prompt and the popup", async ({ ext }) => {
  const { hostTab, friend, fpop } = await room(ext);
  try {
    // One long unbroken word too (the mock names a page "Demo <id>"), the hardest to wrap.
    const id = `the-${"extraordinarily-long-".repeat(7)}title`;
    const long = `Demo ${id}`;
    await hostTab.goto(`${MOCK}/watch/${id}`); // the room moves to it
    await hostTab.waitForTimeout(1500);
    const tab = await friend.context.newPage();
    await tab.setViewportSize({ width: 375, height: 667 });
    await tab.goto(`${MOCK}/watch/film`);
    const ask = tab.getByText(`Suhaas is watching ${long}. Open it?`);
    await expect(ask).toBeVisible({ timeout: 6000 });
    const box = await ask.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
    await expect(tab.getByRole("button", { name: "Open", exact: true })).toBeInViewport();

    await fpop.reload();
    await expect(fpop.getByRole("button", { name: /^Open Demo the-extraordinarily/ })).toBeVisible({
      timeout: 5000,
    });
    // The button ends inside the popup's own width rather than running past it.
    const past = await fpop.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        x.textContent?.startsWith("Open Demo the-"),
      );
      return (
        (b?.getBoundingClientRect().right ?? 1e6) - document.body.getBoundingClientRect().right
      );
    });
    expect(past).toBeLessThanOrEqual(0);
  } finally {
    await friend.context.close();
  }
});

test("names with emoji and right-to-left letters show whole", async ({ ext }) => {
  const host = await popup(ext, "Suhaas");
  await host.getByRole("button", { name: "Create a room" }).click();
  const code = (await host.getByTestId("room-code").textContent()) ?? "";
  const hostTab = await ext.context.newPage();
  await hostTab.goto(`${MOCK}/watch/ep1`);
  const friend = await launchWithExtension();
  try {
    const fpop = await popup(friend, "مريم 🎬");
    await fpop.getByRole("textbox", { name: "Or join a friend's room" }).fill(code);
    await fpop.getByRole("button", { name: "Join room", exact: true }).click();
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    const pill = hostTab.getByRole("region", { name: "WatchSync room" });
    await expect(pill.getByRole("img", { name: "مريم 🎬, in sync" })).toBeVisible({
      timeout: 6000,
    });
    // Past the arrival window and the host's first clock for the title (3.5 s after it opens).
    await tab.waitForTimeout(5000);
    await tab.evaluate(() => document.querySelector("video")?.pause());
    await expect(hostTab.getByText("مريم 🎬 paused")).toBeVisible({ timeout: 4000 });
  } finally {
    await friend.context.close();
  }
});
