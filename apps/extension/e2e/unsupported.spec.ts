// Being in a room while looking at a site WatchSync doesn't work on (US-052): the popup says
// so plainly, and the room carries on in its own tab.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, MOCK, room, test } from "./fixtures";

const chatButton = (tab: Page) => tab.getByRole("button", { name: /^(Open|Close) chat/ });
const frame = (tab: Page) => tab.frameLocator("watchsync-sidebar iframe");
const box = (tab: Page) => frame(tab).getByRole("textbox", { name: "Message" });
const log = (tab: Page) => frame(tab).getByRole("log", { name: "Messages" });

test("in a room on an unsupported site: the popup says so, and chat in the room's tab works", async ({
  ext,
}) => {
  const { host, hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await tab.waitForTimeout(3200);

    // Looking at a supported page: nothing to say.
    await hostTab.bringToFront();
    await expect(host.getByText("This site isn't supported yet")).toHaveCount(0);

    // An unsupported page in front: the popup says so and lists what is supported.
    await ext.context.route("https://elsewhere.example/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Elsewhere</title>" }),
    );
    const elsewhere = await ext.context.newPage();
    await elsewhere.goto("https://elsewhere.example/");
    await expect(
      host.getByRole("heading", { name: "This site isn't supported yet" }),
    ).toBeVisible();
    await expect(
      host.getByText("WatchSync works on Netflix, Prime Video and JioHotstar."),
    ).toBeVisible();

    // The room carries on: Open chat goes back to the room's tab and chat works there. (The
    // popup asks whether a service tab is open when it opens, so open it afresh.)
    await host.reload();
    await expect(host.getByRole("button", { name: "Open chat" })).toBeEnabled();
    await host.getByRole("button", { name: "Open chat" }).click();
    await expect(box(hostTab)).toBeEnabled();
    await box(hostTab).fill("still here");
    await box(hostTab).press("Enter");
    await expect(log(hostTab).getByText("still here", { exact: true })).toBeVisible();
    await expect(chatButton(tab)).toHaveAttribute("aria-label", /, 1 unread$/);
  } finally {
    await friend.context.close();
  }
});

test("saying so asks for no new permission (US-052)", () => {
  const manifest = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "../dist/manifest.json"), "utf8"),
  );
  expect(manifest.permissions).toEqual(["storage", "scripting"]);
  expect(manifest.host_permissions).toEqual(["http://localhost:8000/*"]);
});
