// Friend controls (US-135): mute a friend, or turn them down, for me alone, from the room pill
// (also in full screen) and from the popup's member row. The friend's fake microphone plays
// talking, so the host's film dips while Asha is heard, and must not dip for Asha once Suhaas has
// muted her.
import type { Page } from "@playwright/test";
import { type Ext, expect, launchWithExtension, test } from "./fixtures";
import { allowAndTalk, FAKE_MEDIA, talking, twoTabs, workerOf } from "./voice-helpers";

const volume = (tab: Page) => tab.evaluate(() => document.querySelector("video")?.volume ?? -1);

/** The film with sound, at 0.8: what a person who had set their volume would have. */
async function giveSound(tab: Page) {
  await tab.evaluate(() => {
    const film = document.querySelector("video");
    if (!film) return;
    film.muted = false;
    film.volume = 0.8;
  });
}

const voiceViewOf = (tab: Page): Promise<{ speaking: string[]; peers: Record<string, string> }> =>
  workerOf(tab).evaluate(() => Reflect.get(globalThis, "watchsyncVoiceView")());

/** How the host's voice document plays each friend: muted, and 0 to 1 (test builds). */
const levels = (tab: Page): Promise<{ muted: boolean; volume: number }[]> =>
  workerOf(tab).evaluate(async () => {
    const got = await Reflect.get(globalThis, "watchsyncVoiceProbe")("levels");
    return Array.isArray(got) ? got : [];
  });

const saved = (ext: Ext) =>
  workerOf(ext).evaluate(async () => (await chrome.storage.local.get("voiceFriends")).voiceFriends);

/** Asha's face in Suhaas's pill, a button because she is in voice. */
const face = (tab: Page) => tab.locator('.pill button.face[aria-label^="Asha"]');
const menu = (tab: Page) => tab.locator(".friend");

/** The room code the popup shows. */
const code = (popup: Page) =>
  popup
    .getByTestId("room-code")
    .textContent()
    .then((t) => t ?? "");

/** The shadow root's focused element, as a short description. */
const focused = (tab: Page) =>
  tab.evaluate(() => {
    const el = document.querySelector("watchsync-overlay")?.shadowRoot?.activeElement;
    return el ? `${el.tagName.toLowerCase()}.${el.className}` : null;
  });

async function room(talks = true) {
  const ext = await launchWithExtension("", { args: FAKE_MEDIA });
  const args = talks
    ? [...FAKE_MEDIA, `--use-file-for-fake-audio-capture=${talking()}`]
    : FAKE_MEDIA;
  const r = await twoTabs(ext, "open", args);
  await expect
    .poll(async () => Object.values((await voiceViewOf(r.hostTab)).peers), { timeout: 15_000 })
    .toEqual(["connected"]);
  await expect(face(r.hostTab)).toBeVisible({ timeout: 10_000 });
  await giveSound(r.hostTab);
  return { ext, ...r };
}

async function close({ ext, friend }: { ext: Ext; friend: Ext }) {
  await friend.context.close();
  await ext.context.close();
}

test("mute for me: no dip, the ring stays, and the face says so", async () => {
  const r = await room();
  try {
    const { hostTab, tab } = r;
    await face(hostTab).click();
    await expect(menu(hostTab)).toBeVisible();
    await menu(hostTab).getByRole("button", { name: "Mute for me" }).click();
    // The mark on the face, in words, and the button turns round.
    await expect(face(hostTab)).toHaveAttribute("aria-label", /muted for you/i);
    await expect(face(hostTab).locator(".quiet")).toBeVisible();
    await expect(menu(hostTab).getByRole("button", { name: "Unmute for me" })).toBeVisible();
    await expect(menu(hostTab).getByText("Muted for you")).toBeVisible();
    // Only what Suhaas hears changed: Asha's voice is muted on his side, the track is not touched.
    await expect.poll(() => saved(r.ext)).toMatchObject({ [await code(r.host)]: {} });

    await expect.poll(async () => (await levels(hostTab))[0]?.muted).toBe(true);

    await allowAndTalk(tab); // Asha talks (open mic): a few seconds of speech
    // She is heard speaking, so her ring shows even though she is muted for me...
    await expect(face(hostTab)).toHaveAttribute("data-speaking", "true", { timeout: 10_000 });
    // ...and the film does not dip for a voice I can't hear (a dip starts within a second).
    for (let i = 0; i < 5; i++) {
      expect(await volume(hostTab)).toBeCloseTo(0.8, 3);
      await hostTab.waitForTimeout(250);
    }

    await menu(hostTab).getByRole("button", { name: "Unmute for me" }).click();
    await expect(face(hostTab)).not.toHaveAttribute("aria-label", /muted for you/i);
    await expect(face(hostTab).locator(".quiet")).toHaveCount(0);
    await expect.poll(async () => (await levels(hostTab))[0]).toEqual({ muted: false, volume: 1 });
  } finally {
    await close(r);
  }
});

test("the menu works by keyboard and in full screen, and Escape gives focus back", async () => {
  const r = await room(false);
  try {
    const { hostTab } = r;
    await hostTab.getByRole("button", { name: "Full screen" }).click();
    await expect
      .poll(() =>
        hostTab.evaluate(
          () => document.querySelector("watchsync-overlay")?.parentElement?.id ?? null,
        ),
      )
      .toBe("player"); // the overlay has moved into the full screen element
    // The pill is inside the full screen element, and the face opens the menu from the keyboard.
    await face(hostTab).focus();
    await hostTab.keyboard.press("Enter");
    await expect(menu(hostTab)).toBeVisible();
    await expect(face(hostTab)).toHaveAttribute("aria-expanded", "true");
    expect(await focused(hostTab)).toBe("button.mute");
    await hostTab.keyboard.press("Space"); // Mute for me
    await expect(face(hostTab)).toHaveAttribute("aria-label", /muted for you/i);
    // Space and Enter did not play or pause the film behind the menu.
    expect(await hostTab.evaluate(() => document.querySelector("video")?.paused)).toBe(false);
    await expect(menu(hostTab)).toBeVisible(); // the redraw did not take the menu away
    // The pill fades 3 s after the last mouse move; with a menu open it stays.
    await hostTab.waitForTimeout(3500);
    await expect(hostTab.locator(".pill")).not.toHaveClass(/idle/);
    await hostTab.keyboard.press("Tab"); // the slider
    await expect(menu(hostTab).getByLabel("Asha's volume")).toBeFocused();
    await hostTab.keyboard.press("Escape");
    await expect(menu(hostTab)).toBeHidden();
    expect(await focused(hostTab)).toBe("button.face");
    await expect(face(hostTab)).toHaveAttribute("aria-expanded", "false");
    expect(await hostTab.evaluate(() => document.fullscreenElement?.id ?? null)).toBe("player");
    await hostTab.evaluate(() => document.exitFullscreen());
  } finally {
    await close(r);
  }
});

test("a volume for each friend: 0 to 100, a friend turned down still dips the film, 0 does not", async () => {
  const r = await room();
  try {
    const { hostTab, tab } = r;
    await face(hostTab).click();
    const slider = menu(hostTab).getByLabel("Asha's volume");
    await expect(slider).toHaveValue("100");
    await slider.fill("40");
    await expect
      .poll(async () => (await levels(hostTab))[0])
      .toEqual({ muted: false, volume: 0.4 });
    await expect(face(hostTab)).not.toHaveAttribute("aria-label", /muted for you/i);
    await allowAndTalk(tab);
    // Turned down, not off: she can still be heard, so the film still dips.
    await expect.poll(() => volume(hostTab), { timeout: 10_000 }).toBeLessThan(0.5);
    // All the way down counts as muted for me: the mark shows and the film comes back.
    await slider.fill("0");
    await expect(face(hostTab)).toHaveAttribute("aria-label", /muted for you/i);
    await expect.poll(async () => (await levels(hostTab))[0]?.muted).toBe(true);
    await expect.poll(() => volume(hostTab), { timeout: 8000 }).toBeCloseTo(0.8, 3);
    await expect(menu(hostTab).getByRole("button", { name: "Unmute for me" })).toBeVisible();
    // Unmuting someone at 0 brings them back to full.
    await menu(hostTab).getByRole("button", { name: "Unmute for me" }).click();
    await expect(slider).toHaveValue("100");
    await expect.poll(async () => (await levels(hostTab))[0]).toEqual({ muted: false, volume: 1 });
  } finally {
    await close(r);
  }
});

test("the setting is remembered for the room: it survives a reload, and the popup row has the same controls", async () => {
  const r = await room(false);
  try {
    const { hostTab, host } = r;
    await face(hostTab).click();
    await menu(hostTab).getByLabel("Asha's volume").fill("60");
    await menu(hostTab).getByRole("button", { name: "Mute for me" }).click();
    const roomCode = await code(host);
    await expect
      .poll(() => saved(r.ext))
      .toMatchObject({ [roomCode]: { people: { asha: { muted: true, volume: 60 } } } });

    await hostTab.reload();
    await expect(face(hostTab)).toHaveAttribute("aria-label", /muted for you/i, {
      timeout: 15_000,
    });
    await expect.poll(async () => (await levels(hostTab))[0]).toEqual({ muted: true, volume: 0.6 });

    // The popup's member row shows the same, and its button undoes it for the pill too.
    await expect(host.getByText("Muted for you")).toBeVisible();
    await expect(host.getByLabel("Asha's volume")).toHaveValue("60");
    await host.getByRole("button", { name: "Unmute for me" }).click();
    await expect(face(hostTab)).not.toHaveAttribute("aria-label", /muted for you/i);
    await expect
      .poll(async () => (await levels(hostTab))[0])
      .toEqual({ muted: false, volume: 0.6 });
    await host.getByLabel("Asha's volume").fill("100");
    await expect.poll(() => saved(r.ext)).toEqual({}); // back at the default: nothing is kept
  } finally {
    await close(r);
  }
});
