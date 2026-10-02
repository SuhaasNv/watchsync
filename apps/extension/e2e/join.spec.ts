import type { BrowserContext, Page } from "@playwright/test";
import { expect, launchWithExtension, test } from "./fixtures";

const API = "http://localhost:8000";

async function popup(ext: { context: BrowserContext; extensionId: string }, name: string) {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  return page;
}

async function hostRoom(page: Page) {
  await page.getByRole("button", { name: "Create a room" }).click();
  return (await page.getByTestId("room-code").textContent()) ?? "";
}

test("friend joins by typing the code and the host sees them arrive", async ({ ext }) => {
  const host = await popup(ext, "Suhaas");
  const code = await hostRoom(host);

  const friend = await launchWithExtension();
  try {
    const page = await popup(friend, "Asha");
    await page.getByRole("textbox", { name: "Or join a friend's room" }).fill(code.toLowerCase());
    await page.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(page.getByTestId("room-code")).toHaveText(code);
    await expect(page.getByText("Asha (you)")).toBeVisible();
    await expect(host.getByText("Asha", { exact: true })).toBeVisible({ timeout: 1000 });
    // With others in the room, both popups lead with the people, not the invite (BUG-016).
    for (const p of [page, host]) {
      await expect(p.getByRole("heading", { name: "In this room (2)" })).toBeVisible();
      await expect(p.getByText("Send this to your friends")).toHaveCount(0);
      await expect(p.getByText("Invite more")).toBeVisible();
    }
  } finally {
    await friend.context.close();
  }
  // Closing the friend's browser takes them out of the room.
  await expect(host.getByText("Asha", { exact: true })).toHaveCount(0, { timeout: 5000 });
  await expect(host.getByRole("heading", { name: "In this room (1)" })).toBeVisible();
});

test("a wrong code gets a plain message", async ({ ext }) => {
  const page = await popup(ext, "Asha");
  const box = page.getByRole("textbox", { name: "Or join a friend's room" });
  await box.fill("ZZZZZZ");
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "We can't find that room. Check the code with your friend.",
  );
});

test("invite link joins the room and opens the room's title", async ({ ext }) => {
  const host = await popup(ext, "Suhaas");
  const code = await hostRoom(host);
  await expect(host.getByText("Connected")).toBeVisible();

  // Stand in for title detection (UC-005): tell the room what the host is watching.
  const [worker] = ext.context.serviceWorkers();
  if (!worker) throw new Error("extension service worker not running");
  const token = await worker.evaluate(async () => {
    const { session } = await chrome.storage.session.get("session");
    return (session as { token: string }).token;
  });
  const titleUrl = "http://localhost:4173/watch/demo";
  const ws = new WebSocket(`ws://localhost:8000/ws/rooms/${code}?token=${token}`);
  await new Promise((r) => ws.addEventListener("open", r));
  const media = { service: "mock", titleId: "demo", titleName: "Demo Film", titleUrl };
  ws.send(
    JSON.stringify({
      id: "t1",
      type: "PRESENCE.UPDATE",
      timestamp: Date.now(),
      payload: { service: "mock", following: true, media },
    }),
  );

  const friend = await launchWithExtension();
  try {
    const page = await friend.context.newPage();
    await page.goto(`${API}/j/${code}`);
    await expect(page.getByText("New to WatchSync?")).toHaveCount(0);
    await page.getByLabel("Your name").fill("Asha");
    await page.getByRole("button", { name: "Join room" }).click();
    await page.waitForURL(titleUrl);

    // The friend's popup shows what the host has open.
    const pop = await friend.context.newPage();
    await pop.goto(`chrome-extension://${friend.extensionId}/popup.html`);
    await expect(pop.getByText("Test player · Demo Film")).toBeVisible();
  } finally {
    ws.close();
    await friend.context.close();
  }
});

test("invite link without the extension sends you to get WatchSync first (BUG-060)", async ({
  page,
}) => {
  await page.goto(`${API}/j/ABC234`);
  await expect(page.getByText("ABC234")).toBeVisible();
  await expect(page.getByRole("link", { name: "Get WatchSync for Chrome" })).toHaveAttribute(
    "href",
    "https://watchsync.space/install/",
  );
  await expect(page.getByText("Come back to this link and join with your name.")).toBeVisible();
});
