// Which chat frames the background serves (UC-013, DEC-042). sidebar.html is web-accessible,
// so a service page could frame it itself; only a frame the tab's own content script loaded
// carries the one-time pass that content script was given.
import { isSidebarEvent } from "../shared/messages";

/** The parts of a chrome.runtime.MessageSender the check reads. */
export interface FrameSender {
  tab?: { id?: number };
  frameId?: number;
  url?: string;
}

/** An unused pass stops working after this long: a frame that never said hello leaves none. */
export const PASS_MS = 10_000;

/** One outstanding pass per tab; asking again replaces it. */
export class ChatFrames {
  private readonly passes = new Map<number, { nonce: string; at: number }>();

  constructor(
    private readonly make: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = Date.now,
  ) {}

  /** A pass for the frame the tab's content script (its top frame) is about to load. */
  issue(sender: FrameSender): string | null {
    const tabId = sender.tab?.id;
    if (tabId === undefined || sender.frameId !== 0) return null;
    const nonce = this.make();
    this.passes.set(tabId, { nonce, at: this.now() });
    return nonce;
  }

  /**
   * Our sidebar.html, in a frame (not the top) of the tab the pass was issued to, saying
   * hello with that pass within PASS_MS. A pass works once. Returns the pass it used.
   */
  admit(sender: FrameSender | undefined, hello: unknown): string | null {
    const tabId = sender?.tab?.id;
    if (tabId === undefined || !sender?.frameId || !sender.url) return null;
    if (!isSidebarEvent(hello) || hello.kind !== "hello") return null;
    const url = new URL(sender.url);
    if (url.protocol !== "chrome-extension:" || url.pathname !== "/sidebar.html") return null;
    const pass = this.passes.get(tabId);
    if (!pass || pass.nonce !== hello.nonce) return null;
    this.passes.delete(tabId);
    return this.now() - pass.at <= PASS_MS ? pass.nonce : null;
  }

  /** The tab closed: its pass goes with it. */
  forget(tabId: number) {
    this.passes.delete(tabId);
  }
}

/**
 * Which ports a server message goes to. Chat goes only to admitted chat frames, never to a
 * service page's content script (DEC-042); everything else goes where it always has.
 */
export function wantsServerMessage(portName: string, type: string): boolean {
  if (type.startsWith("CHAT.")) return portName === "sidebar";
  return portName !== "sidebar";
}
