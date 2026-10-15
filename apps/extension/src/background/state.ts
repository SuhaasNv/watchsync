// The worker's shared state: what every other module here reads and writes.

import type { AppState, Push } from "../shared/messages";
import { badgeText } from "./badge";

export const API = __API_URL__;

export const state: AppState = {
  name: null,
  session: null,
  connection: "idle",
  participants: [],
  media: null,
  playback: null,
  following: true,
  clockOffset: 0,
  clockUncertainty: null,
  lastRoom: null,
  notice: null,
  mediaMove: null,
  update: null,
  updating: false,
  unreachable: false,
  unread: 0,
};
export const ENDED = "This room is no longer available. Ask your friend for a new code.";
export const ports = new Set<chrome.runtime.Port>();

export function push(msg: Push) {
  for (const p of ports) p.postMessage(msg);
}

/**
 * The state other contexts see: never the room token. Only this worker uses it, and a port's
 * name or a reply can reach a content script on a service page (BUG-044).
 */
export function shared(): AppState {
  return { ...state, session: state.session && { ...state.session, token: "" } };
}
export function changed() {
  for (const p of ports) p.postMessage({ kind: "state", state: shared() } satisfies Push);
  showBadge();
}

let badge: string | null = null;
/**
 * The toolbar badge (US-116): the same unread count as the chat button (US-044), 9+ past
 * nine, none out of a room; dev builds show DEV at 0.
 */
export function showBadge() {
  const text = badgeText(state.session ? state.unread : 0, __CHANNEL__);
  if (text === badge) return;
  badge = text;
  chrome.action.setBadgeText({ text }).catch(() => {});
}
