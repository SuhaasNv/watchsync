// The background's copy of the room's chat (UC-014): what a tab that opens is shown, and the
// unread count. Text stays in memory only: chrome.storage never holds it (DEC-032).
import {
  type AnyServerMessage,
  type ChatMessagePayload,
  envelope,
  isServerMessage,
  type ServerMessageOf,
} from "@watchsync/protocol";

/** As many as the room keeps (the service's CHAT_HISTORY). */
export const CHAT_KEEP = 200;
/**
 * Chat sends (the v0.2 retry policy): no echo after CHAT_SENDING_MS, the tab says "Sending…";
 * none CHAT_GIVE_UP_MS after the first send, "Not sent". Up to CHAT_QUEUE_MAX messages wait
 * while reconnecting (memory only) and go out once, spaced by CHAT_FLUSH_GAP_MS so the room's
 * 5-in-5-seconds limit never refuses them, with the same clientId (the room never keeps one
 * twice).
 */
export const CHAT_SENDING_MS = 5000;
export const CHAT_GIVE_UP_MS = 30_000;
export const CHAT_QUEUE_MAX = 10;
export const CHAT_FLUSH_GAP_MS = 1100;

export interface Chat {
  /** Oldest first. */
  messages: ChatMessagePayload[];
  /** Messages from other people after the last one this person has seen (US-044). */
  unread: number;
  /**
   * Id of the last message this person has seen: null until the room's first history sets it
   * (earlier messages never count); "" when there was none, so everything after counts.
   */
  lastSeen: string | null;
}

export const NO_CHAT: Chat = { messages: [], unread: 0, lastSeen: null };

/**
 * The chat after a server message. CHAT.HISTORY replaces the list: the first one (a join)
 * marks everything in it as seen; later ones (a reconnect, or a worker restart with the stored
 * last-seen id) count other people's messages after the last seen one. CHAT.MESSAGE adds one,
 * and one unread unless we sent it; a message already here (a retry's echo) changes nothing.
 */
export function chatAfter(chat: Chat, msg: AnyServerMessage, you: string | null): Chat {
  if (msg.type === "CHAT.HISTORY") {
    const messages = msg.payload.messages.slice(-CHAT_KEEP);
    if (chat.lastSeen === null)
      return { messages, unread: chat.unread, lastSeen: messages.at(-1)?.id ?? "" };
    // Not found (none seen yet, or pushed out of the history): every message here is newer.
    const newer = messages.slice(messages.findIndex((m) => m.id === chat.lastSeen) + 1);
    return { ...chat, messages, unread: newer.filter((m) => m.fromId !== you).length };
  }
  if (msg.type !== "CHAT.MESSAGE" || chat.messages.some((m) => m.id === msg.payload.id))
    return chat;
  return {
    ...chat,
    messages: [...chat.messages, msg.payload].slice(-CHAT_KEEP),
    unread: chat.unread + (msg.payload.fromId === you ? 0 : 1),
  };
}

/** The chat was opened: everything in it is seen. */
export function chatOpened(chat: Chat): Chat {
  return { ...chat, unread: 0, lastSeen: chat.messages.at(-1)?.id ?? chat.lastSeen ?? "" };
}

/** The unread count as the collapsed button shows it. */
export const unreadLabel = (unread: number): string => (unread > 9 ? "9+" : String(unread));

const cp = String.fromCodePoint;
/** Letters and symbols that draw nothing: Hangul fillers and the blank braille pattern. */
const BLANKS = new Set([0x115f, 0x1160, 0x3164, 0xffa0, 0x2800].map((c) => cp(c)));
/** Zero-width non-joiner and joiner: only between two visible characters. */
const JOINERS = new Set([cp(0x200c), cp(0x200d)]);
/** Text and emoji presentation selectors: only right after a visible character. */
const SELECTORS = new Set([cp(0xfe0e), cp(0xfe0f)]);
const MAX_MARKS = 8;

/** Nothing a joiner or selector can attach to (the room service's _bare). */
const bare = (c: string | undefined) =>
  c === undefined || /\s|\p{Cc}/u.test(c) || BLANKS.has(c) || JOINERS.has(c);

/**
 * The room service's own check on chat text (app/protocol.py is_chat_text), run before
 * sending so the tab hears "invalid" at once: no control character but a line break,
 * something visible, at most 8 combining marks in a row, each joiner between two characters it
 * can join, each variation selector right after one. The schema (isClientMessage) checks the
 * rest; both sides read the same cases (packages/protocol/src/chat-text-cases.json).
 */
export function isChatText(text: string): boolean {
  const chars = Array.from(text);
  let marks = 0;
  let visible = false;
  for (const [i, c] of chars.entries()) {
    if (/\p{Cc}/u.test(c) && c !== "\n") return false;
    const before = chars[i - 1];
    if (JOINERS.has(c) && (bare(before) || bare(chars[i + 1]))) return false;
    if (SELECTORS.has(c) && (bare(before) || (before !== undefined && SELECTORS.has(before))))
      return false;
    marks = /\p{Mn}|\p{Me}/u.test(c) ? marks + 1 : 0;
    if (marks > MAX_MARKS) return false;
    visible ||= /[\p{L}\p{N}\p{P}\p{S}]/u.test(c) && !BLANKS.has(c);
  }
  return visible;
}

/** The most a chat message holds, in code points (the chat frame's own limit). */
export const CHAT_MAX_CHARS = 500;

/**
 * Text a tab's page hands the message box (BUG-073): a few typed characters. Not empty, within
 * the message limit, no control characters (a line break or tab is never typed this way).
 */
export const isTypedText = (v: unknown): v is string =>
  typeof v === "string" &&
  Array.from(v).length >= 1 &&
  Array.from(v).length <= CHAT_MAX_CHARS &&
  !/\p{Cc}/u.test(v);

/** Line breaks as the room keeps them (\n), and tabs as spaces, before validating. */
export const normalizeChatText = (text: string): string =>
  text.replace(/\r\n?/g, "\n").replace(/\t/g, " ");

/**
 * The movie time a message carries: the tab's position, or null when the protocol can't take
 * it (a live stream reports Infinity, an ad a strange value). It never stops a message.
 */
export const safeMovieTime = (t: number | null): number | null =>
  t !== null && Number.isFinite(t) && t >= 0 && t <= 86_400 ? t : null;

const isChatMessage = (item: unknown): item is ChatMessagePayload =>
  isServerMessage({ id: "h", type: "CHAT.MESSAGE", timestamp: 0, payload: item });

/**
 * A CHAT.HISTORY that fails validation as a whole, rebuilt from the messages in it that are
 * valid on their own: one bad message must not cost the whole history. Null for anything that
 * isn't a chat history at all.
 */
export function salvageHistory(msg: unknown): ServerMessageOf<"CHAT.HISTORY"> | null {
  if (typeof msg !== "object" || msg === null) return null;
  const { type, payload } = msg as { type?: unknown; payload?: unknown };
  if (type !== "CHAT.HISTORY" || typeof payload !== "object" || payload === null) return null;
  const { messages } = payload as { messages?: unknown };
  if (!Array.isArray(messages)) return null;
  const valid = messages.filter(isChatMessage).slice(-CHAT_KEEP);
  const history = envelope<ServerMessageOf<"CHAT.HISTORY">>("CHAT.HISTORY", { messages: valid });
  return isServerMessage(history) ? history : null;
}
