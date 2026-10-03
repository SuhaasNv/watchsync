// The rules for chat text, with no protocol import so the chat frame (sidebar.js) doesn't carry
// the generated validators. The background's chat state re-exports them from shared/chat.ts.

/** As many as the room keeps (the service's CHAT_HISTORY). */
export const CHAT_KEEP = 200;

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
