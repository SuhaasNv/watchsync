// Owns the room: REST calls, the WebSocket, and fan-out to the popup and the tab.
// The work is split by job (connection, session, requests, tabs, update-check); this file
// registers every chrome.* listener at the worker's top level, in the first turn of the event
// loop, as MV3 requires.

import { retryNow, socket } from "./connection";
import { injectOpenTabs } from "./inject";
import { onMessage, serial } from "./requests";
import { checkRules } from "./rules";
import { leaveForNow, updates } from "./session";
import { showBadge, state } from "./state";
import {
  chatFrames,
  onCommand,
  onConnect,
  presence,
  presenceTabClosed,
  presenceTabId,
  tabTitles,
} from "./tabs";
import { checkForUpdate } from "./update-check";
import { voiceFrames } from "./voice";

checkForUpdate().catch(() => {});
checkRules();

// Testers run "WatchSync Dev" next to the real one; its badge says DEV while nothing is unread.
chrome.action.setBadgeBackgroundColor({ color: "#ffd25a" }).catch(() => {});
showBadge();

// The browser saying the network is back is the best moment to retry.
self.addEventListener("online", retryNow);

chrome.runtime.onUpdateAvailable.addListener(() => updates.available(state.session !== null));

chrome.windows.onRemoved.addListener(() => {
  chrome.windows
    .getAll({ windowTypes: ["normal"] })
    .then((open) => (open.length === 0 ? serial(leaveForNow) : undefined))
    .catch(() => {});
});

// First install only (not updates or reloads): show what WatchSync does and how to start.
// On removal Chrome opens a thank-you page with answers to common reasons. Nothing is sent.
chrome.runtime.setUninstallURL(`${__SITE_URL__}/goodbye/`).catch(() => {});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") void chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  void injectOpenTabs(chrome);
});

chrome.commands.onCommand.addListener((command, tab) => {
  onCommand(command, tab).catch((e: unknown) => console.debug("watchsync: shortcut", e));
});

// Test builds only: lets end-to-end tests cut the connection like a network drop, and press
// the chat shortcut (Playwright can't press extension commands).
if (__MOCK__)
  Object.assign(globalThis, {
    watchsyncDropSocket: () => socket?.close(),
    watchsyncCommand: onCommand,
  });

chrome.runtime.onMessage.addListener(onMessage);

// Closing the tab: no need to wait out the 3 s page-load allowance below.
chrome.tabs.onRemoved.addListener((tabId) => {
  chatFrames.forget(tabId);
  voiceFrames.forget(tabId);
  tabTitles.delete(tabId);
  if (tabId === presenceTabId) presenceTabClosed();
});
// The retry: every 15 s make sure that tab still exists, so a missed close event can't
// leave a title showing for someone who closed it (BUG-026).
setInterval(() => {
  if (presenceTabId === undefined || presence.media === null) return;
  chrome.tabs.get(presenceTabId).catch(presenceTabClosed);
}, 15_000);

chrome.runtime.onConnect.addListener(onConnect);
