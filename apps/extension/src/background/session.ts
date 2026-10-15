// The session's life: restore after a worker restart, start, end, rejoin, leave for now.

import type { JoinRoomRequest } from "@watchsync/protocol";
import { envelope, isRoomTicket } from "@watchsync/protocol";
import { cleanName, type Session } from "../shared/messages";
import type { ChatSeen } from "./chat-relay";
import { api, chat, connect, reset, sendServer } from "./connection";
import { changed, ENDED, state } from "./state";
import { updateGate } from "./updates";

const DAY = 24 * 3600 * 1000;
let lastTicket: Session | null = null;

function isChatSeen(v: unknown): v is ChatSeen & { code: string } {
  if (typeof v !== "object" || v === null) return false;
  const { code, unread, lastSeen } = v as { code?: unknown; unread?: unknown; lastSeen?: unknown };
  return (
    typeof code === "string" &&
    typeof unread === "number" &&
    Number.isInteger(unread) &&
    unread >= 0 &&
    (lastSeen === null || typeof lastSeen === "string")
  );
}

async function restore() {
  const { name } = await chrome.storage.local.get("name");
  const {
    session,
    lastTicket: kept,
    chatSeen,
  } = await chrome.storage.session.get(["session", "lastTicket", "chatSeen"]);
  // A name saved by an older version may hold marks the service now refuses.
  state.name = typeof name === "string" ? cleanName(name) || null : null;
  if (isRoomTicket(session)) {
    state.session = session;
    // The worker restarted in a room: its unread count, recomputed when the history arrives.
    if (isChatSeen(chatSeen) && chatSeen.code === session.code) {
      chat.restore({ unread: chatSeen.unread, lastSeen: chatSeen.lastSeen });
      state.unread = chatSeen.unread;
    }
    connect();
    return;
  }
  // Offer the last room back for a day. Local storage keeps only its code, since content
  // scripts can read it (BUG-044); the token survives in session storage while the browser
  // runs, and without it a Rejoin is a plain join.
  const { lastRoom } = await chrome.storage.local.get("lastRoom");
  if (isSaved(lastRoom) && Date.now() - lastRoom.at < DAY) {
    const ticket = isRoomTicket(kept) && kept.code === lastRoom.code ? kept : null;
    lastTicket = ticket ?? { code: lastRoom.code, token: "", participantId: "" };
    state.lastRoom = lastRoom.code;
  } else if (lastRoom !== undefined) {
    // Stale or malformed, or saved by an older version with its token: forget it.
    await chrome.storage.local.remove("lastRoom");
  }
}

function isSaved(v: unknown): v is { code: string; at: number } {
  if (typeof v !== "object" || v === null) return false;
  const { code, at } = v as { code?: unknown; at?: unknown };
  return typeof at === "number" && typeof code === "string" && /^[A-HJ-NP-Z2-9]{6}$/.test(code);
}
export const ready = restore();

export async function startSession(ticket: Session) {
  reset(); // also covers switching rooms from the invite page
  state.session = ticket;
  state.notice = null;
  state.lastRoom = null;
  lastTicket = ticket;
  await chrome.storage.session.set({ session: ticket });
  await chrome.storage.local.set({ lastRoom: { code: ticket.code, at: Date.now() } });
  connect();
}

export async function endSession(notice: string | null) {
  reset();
  state.session = null;
  state.notice = notice;
  state.lastRoom = null;
  lastTicket = null;
  await chrome.storage.session.remove(["session", "lastTicket"]);
  await chrome.storage.local.remove("lastRoom");
  changed();
  updates.left();
}

// An update mid-room would clear the room ticket and drop us out: wait until we're out. The
// reload waits a moment so the popup gets its answer first.
export const updates = updateGate(() => setTimeout(() => chrome.runtime.reload(), 500));

/**
 * The last browser window closed: leave the room, so friends hear we've gone, but keep the
 * code so the popup and the next title page offer Rejoin. The room waits for us until it
 * expires. If the browser quits too fast for this, the room service notices instead.
 */
export async function leaveForNow() {
  const s = state.session;
  if (!s) return;
  sendServer(envelope("ROOM.LEAVE", { keepRoom: true }));
  reset();
  state.session = null;
  state.notice = null;
  state.lastRoom = s.code;
  lastTicket = s;
  await chrome.storage.session.remove("session");
  await chrome.storage.session.set({ lastTicket: s });
  await chrome.storage.local.set({ lastRoom: { code: s.code, at: Date.now() } });
  changed();
}

/**
 * Back into the last room under our name; the room tells everyone we rejoined. Our last
 * token proves it's us, so the room gives back our place if it still holds it (BUG-041).
 */
export async function rejoin() {
  if (!lastTicket) throw new Error("expired");
  if (!state.name) throw new Error("invalid");
  const { code, token } = lastTicket;
  const body: JoinRoomRequest = { name: state.name, ...(token ? { token } : {}) };
  let ticket: Session;
  try {
    ticket = await api(`/api/v1/rooms/${code}/join`, body);
  } catch (e) {
    const gone = e instanceof Error && (e.message === "expired" || e.message === "not_found");
    if (!gone) throw e;
    return endSession(ENDED); // ended, or the service restarted and forgot it
  }
  await startSession(ticket);
}
