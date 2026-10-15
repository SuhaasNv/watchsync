// The tabs: which one we watch in, the chat frames, Open chat, and what each port may say.

import type { Media, Service } from "@watchsync/protocol";
import { type ClientMessageOf, envelope, isClientMessage } from "@watchsync/protocol";
import { isTypedText } from "../shared/chat";
import { isSidebarEvent, type Push, type TabEvent } from "../shared/messages";
import { ChatFrames } from "./chat-frames";
import { chat, react, retryNow, sendServer } from "./connection";
import { ready } from "./session";
import { changed, ports, push, shared, state } from "./state";

// ponytail: the tab that reported last speaks for this person; one watching tab is the norm.
export let presence: { service: Service; media: Media | null } = { service: "none", media: null };
let presencePort: chrome.runtime.Port | null = null;
/** The tab our presence comes from, kept after its port drops so a close can be told apart. */
export let presenceTabId: number | undefined;
let tabGone: ReturnType<typeof setTimeout> | undefined;

export function sendPresence() {
  sendServer(envelope("PRESENCE.UPDATE", { ...presence, following: state.following }));
}

/** Tells the content script of one tab, and no other, about its chat panel. */
function toTab(tabId: number | undefined, msg: Push) {
  if (tabId === undefined) return;
  for (const p of ports) if (p.name === "tab" && p.sender?.tab?.id === tabId) p.postMessage(msg);
}

/** Tells the chat frames (admitted ones only) of one tab, and no other. */
function toChatFrames(tabId: number | undefined, msg: Push) {
  if (tabId === undefined) return;
  for (const p of ports)
    if (p.name === "sidebar" && p.sender?.tab?.id === tabId) p.postMessage(msg);
}

/** The chat shortcut (US-040): only the tab it was pressed in opens or closes its panel. */
export async function onCommand(command: string, tab?: chrome.tabs.Tab) {
  if (command !== "toggle-sidebar") return;
  const id = tab?.id ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
  toTab(id, { kind: "toggleSidebar" });
}

export const chatFrames = new ChatFrames();

/** The title each service tab last reported, for Open chat (US-115). */
export const tabTitles = new Map<number, string | null>();

/** Service tabs with our content script running, newest first. */
export async function serviceTabs(): Promise<chrome.tabs.Tab[]> {
  const ids = new Set<number>();
  for (const p of ports) if (p.name === "tab" && p.sender?.tab?.id) ids.add(p.sender.tab.id);
  const tabs = await Promise.all([...ids].map((id) => chrome.tabs.get(id).catch(() => null)));
  return tabs
    .filter((t): t is chrome.tabs.Tab => t !== null)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
}

/**
 * Brings forward the tab playing the room's title (else the most recent service tab) and
 * opens chat there with focus in it (US-115). False when there is no service tab.
 */
export async function openChat(): Promise<boolean> {
  const tabs = await serviceTabs();
  const title = state.media?.titleId;
  const tab = tabs.find((t) => t.id !== undefined && title && tabTitles.get(t.id) === title);
  const target = tab ?? tabs[0];
  if (target?.id === undefined) return false;
  await chrome.tabs.update(target.id, { active: true });
  await chrome.windows.update(target.windowId, { focused: true });
  toTab(target.id, { kind: "openSidebar" });
  return true;
}

/** The tab we were watching in is gone: say "nothing open" now (BUG-026). */
export function presenceTabClosed() {
  clearTimeout(tabGone);
  presencePort = null;
  presenceTabId = undefined;
  if (presence.media === null) return;
  titleTabGone();
}

/**
 * The tab with our title is gone. Another tab still playing a title takes over; only if none
 * answers is nothing open (BUG-051): it reported once, on its own title change, long ago.
 */
function titleTabGone() {
  presenceTabId = undefined;
  presence = { service: "none", media: null };
  push({ kind: "report" });
  setTimeout(() => {
    if (presenceTabId === undefined) sendPresence();
  }, 500);
}

/**
 * Where this person's player is, for a chat message's movie time: the room's clock when the
 * tab we watch in is on the room's title and not in an ad; otherwise no time (name only).
 */
function myTime(): { movieTime: number | null; titleId: string | null } {
  const titleId = presence.media?.titleId ?? null;
  const pb = state.playback;
  const me = state.participants.find((p) => p.id === state.session?.participantId);
  if (titleId === null || !pb || pb.titleId !== titleId || me?.hold === "ad")
    return { movieTime: null, titleId };
  const now = Date.now() + state.clockOffset;
  const elapsed = pb.status === "playing" ? ((now - pb.updatedAt) / 1000) * pb.rate : 0;
  return { movieTime: Math.max(0, pb.position + elapsed), titleId };
}

/**
 * A chat frame's port is served only after it says hello with the pass its tab's content
 * script was given (DEC-042); anything else, or silence, is disconnected unserved.
 */
export function admitChatFrame(port: chrome.runtime.Port) {
  const silent = setTimeout(() => port.disconnect(), 5000);
  const hello = (e: unknown) => {
    clearTimeout(silent);
    port.onMessage.removeListener(hello);
    const frame = chatFrames.admit(port.sender, e);
    if (!frame) return port.disconnect();
    const tabId = port.sender?.tab?.id;
    ports.add(port);
    toTab(tabId, { kind: "chatFrameReady", frame });
    // Gone without the content script removing it (the page pointed the frame elsewhere):
    // tell the tab at once, so it puts the real frame back. Its own removals it ignores.
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      toTab(tabId, { kind: "chatFrameLost", frame });
    });
    // Its close goes only to the content script of the tab it sits in.
    port.onMessage.addListener((m: unknown) => {
      if (!isSidebarEvent(m)) return;
      if (m.kind === "close") toTab(port.sender?.tab?.id, { kind: "closeSidebar" });
      if (m.kind === "chat")
        chat.onTabEvent(port, { kind: "chat", text: m.text, clientId: m.clientId, ...myTime() });
      if (m.kind === "react") react(m.emoji, m.count, port);
      if (m.kind === "typing") toTab(port.sender?.tab?.id, { kind: "chatTyping", on: m.on });
    });
    ready.then(() => {
      port.postMessage({ kind: "state", state: shared() } satisfies Push);
      chat.onPortConnected(port); // the room's earlier messages, once known
    });
  };
  port.onMessage.addListener(hello);
}

export function onConnect(port: chrome.runtime.Port) {
  if (port.sender?.id !== chrome.runtime.id) return port.disconnect();
  if (port.name === "sidebar") return admitChatFrame(port);
  ports.add(port);
  retryNow();
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    if (port !== presencePort) return;
    presencePort = null;
    // A page load (next episode, Open) drops the port for a moment; only report the
    // title as closed if no tab reports again soon, so the room keeps following us.
    tabGone = setTimeout(titleTabGone, 3000);
  });
  if (port.name === "tab")
    port.onMessage.addListener((e: TabEvent) => {
      if (e.kind === "playback") {
        const { kind: _, ...update } = e;
        // A speed tool can run the player past the protocol's 0.25-4x, and the room would
        // refuse the whole play, pause or jump; share it at the nearest allowed rate.
        update.rate = Math.min(4, Math.max(0.25, update.rate));
        const msg = envelope<ClientMessageOf<"PLAYBACK.UPDATE">>("PLAYBACK.UPDATE", update);
        if (!isClientMessage(msg)) return; // a NaN or out-of-range position: never our clock
        sendServer(msg);
        // The room tells everyone but the sender; keep our own copy of its clock current
        // too, or our drift check and wait card judge against the old one (BUG-006).
        const { status, position, rate, titleId } = update;
        state.playback = {
          status,
          position,
          rate,
          titleId,
          updatedAt: update.at ?? Date.now() + state.clockOffset,
        };
        changed();
        return;
      }
      if (e.kind === "hold") {
        const { kind: _, ...hold } = e;
        return sendServer(envelope("HOLD.UPDATE", hold));
      }
      if (e.kind === "start")
        return sendServer(envelope("START.REQUEST", { position: e.position, titleId: e.titleId }));
      if (e.kind === "startReady") return sendServer(envelope("START.READY", {}));
      if (e.kind === "startForce") return sendServer(envelope("START.FORCE", {}));
      if (e.kind === "retryNow") return retryNow();
      if (e.kind === "chat") return chat.onTabEvent(port, e);
      if (e.kind === "chatOpened") {
        chat.onTabEvent(port, e);
        return changed();
      }
      if (e.kind === "react") return react(e.emoji, e.count, port);
      if (e.kind === "chatType") {
        // From this tab's content script to this tab's chat frames, and only if it is text.
        if (isTypedText(e.text))
          toChatFrames(port.sender?.tab?.id, { kind: "chatInsert", text: e.text });
        return;
      }
      const tabId = port.sender?.tab?.id;
      if (tabId !== undefined) tabTitles.set(tabId, e.media?.titleId ?? null);
      // A browse page in another tab mustn't hide the tab still playing a title; that
      // tab's close is reported by tabs.onRemoved (BUG-049).
      if (!e.media && presence.media && presenceTabId !== undefined && tabId !== presenceTabId)
        return;
      clearTimeout(tabGone);
      presencePort = port;
      presenceTabId = tabId;
      presence = { service: e.service, media: e.media };
      sendPresence();
    });
  ready.then(() => port.postMessage({ kind: "state", state: shared() } satisfies Push));
}
