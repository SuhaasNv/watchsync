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

/** One outstanding pass per tab; asking again replaces it. */
export class ChatFrames {
  private readonly nonces = new Map<number, string>();

  constructor(private readonly make: () => string = () => crypto.randomUUID()) {}

  /** A pass for the frame the tab's content script (its top frame) is about to load. */
  issue(sender: FrameSender): string | null {
    const tabId = sender.tab?.id;
    if (tabId === undefined || sender.frameId !== 0) return null;
    const nonce = this.make();
    this.nonces.set(tabId, nonce);
    return nonce;
  }

  /**
   * Our sidebar.html, in a frame (not the top) of the tab the pass was issued to, saying
   * hello with that pass. A pass works once.
   */
  admit(sender: FrameSender | undefined, hello: unknown): boolean {
    const tabId = sender?.tab?.id;
    if (tabId === undefined || !sender?.frameId || !sender.url) return false;
    if (!isSidebarEvent(hello) || hello.kind !== "hello") return false;
    const url = new URL(sender.url);
    if (url.protocol !== "chrome-extension:" || url.pathname !== "/sidebar.html") return false;
    if (this.nonces.get(tabId) !== hello.nonce) return false;
    this.nonces.delete(tabId);
    return true;
  }

  /** The tab closed: its pass goes with it. */
  forget(tabId: number) {
    this.nonces.delete(tabId);
  }
}
