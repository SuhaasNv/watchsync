// The background's copy of the room's chat (UC-014): what a tab that opens is shown, and the
// unread count. Memory only: chat text is never written to chrome.storage (DEC-032).
import type { AnyServerMessage, ChatMessagePayload } from "@watchsync/protocol";

/** As many as the room keeps (the service's CHAT_HISTORY). */
export const CHAT_KEEP = 200;

export interface Chat {
  /** Oldest first. */
  messages: ChatMessagePayload[];
  /** Messages from other people since the chat was last opened (US-044). */
  unread: number;
}

/**
 * The chat after a server message. CHAT.HISTORY replaces the list and never counts as unread
 * (earlier messages on a join, reload or reconnect); CHAT.MESSAGE adds one, and one unread
 * unless we sent it (`you` is our participant id).
 */
export function chatAfter(chat: Chat, msg: AnyServerMessage, you: string | null): Chat {
  if (msg.type === "CHAT.HISTORY")
    return { ...chat, messages: msg.payload.messages.slice(-CHAT_KEEP) };
  if (msg.type !== "CHAT.MESSAGE") return chat;
  return {
    messages: [...chat.messages, msg.payload].slice(-CHAT_KEEP),
    unread: chat.unread + (msg.payload.fromId === you ? 0 : 1),
  };
}
