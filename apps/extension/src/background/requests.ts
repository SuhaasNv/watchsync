// What the popup, the invite page and the content scripts ask of the worker.

import { envelope } from "@watchsync/protocol";
import {
  type ChatNonceReply,
  type ChatNonceRequest,
  type ChatTabRequest,
  cleanName,
  type MicAnswerRequest,
  nameProblem,
  type Reply,
  type Request,
  type TabSupportedRequest,
} from "../shared/messages";
import { MIC_PAGE } from "../voice/help";
import { isBlockedBy } from "../voice/messages";
import { api, retryNow, sendServer } from "./connection";
import { endSession, ready, rejoin, startSession } from "./session";
import { changed, shared, state } from "./state";
import { chatFrames, openChat, sendPresence, serviceTabs, talk } from "./tabs";
import { voiceMicAnswer } from "./voice";

// One request at a time, so a join from the popup and the invite page can't both add a
// participant (resilience audit).
let queue: Promise<unknown> = Promise.resolve();
export function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.catch(() => {});
  return run;
}
const handle = (req: Request) => serial(() => handleNow(req));

async function handleNow(req: Request): Promise<Reply> {
  await ready;
  try {
    switch (req.kind) {
      case "getState":
        break;
      case "setName": {
        const name = cleanName(req.name);
        if (nameProblem(req.name)) throw new Error("invalid"); // same rule as every name field
        state.name = name;
        await chrome.storage.local.set({ name });
        break;
      }
      case "create":
        if (!state.name) throw new Error("invalid");
        await startSession(await api("/api/v1/rooms", { name: state.name }));
        break;
      case "join": {
        const code = req.code.trim().toUpperCase();
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error("not_found");
        if (!state.name) throw new Error("invalid");
        if (state.session?.code === code) break;
        const ticket = await api(`/api/v1/rooms/${code}/join`, { name: state.name });
        // Switching rooms from an invite page: leave the old one for good, not as "Away".
        if (state.session) sendServer(envelope("ROOM.LEAVE", {}));
        await startSession(ticket);
        break;
      }
      case "leave":
        sendServer(envelope("ROOM.LEAVE", {})); // revokes our token
        await endSession(null);
        break;
      case "rejoin":
        await rejoin();
        break;
      case "forgetRoom":
        await endSession(null);
        break;
      case "follow":
        state.following = req.following;
        sendPresence();
        break;
      case "retryNow":
        retryNow();
        break;
      case "openChat":
        if (!(await openChat())) throw new Error("no_tab");
        break;
      case "talk":
        await talk(req.edge);
        break;
    }
    changed();
    return { ok: true, state: shared() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unreachable", state: shared() };
  }
}

export function onMessage(
  req: Request | ChatNonceRequest | MicAnswerRequest | ChatTabRequest | TabSupportedRequest,
  sender: chrome.runtime.MessageSender,
  reply: (response?: unknown) => void,
) {
  if (sender.id !== chrome.runtime.id) return false;
  if (req.kind === "micAnswer") {
    // Chrome's answer about the microphone: only from our own microphone page, in a tab.
    const ours = sender.tab && sender.url?.startsWith(chrome.runtime.getURL(MIC_PAGE));
    if (ours && isBlockedBy(req.by)) voiceMicAnswer(req.by);
    return false;
  }
  if (req.kind === "hasChatTab") {
    serviceTabs()
      .then((tabs) => reply(tabs.length > 0))
      .catch(() => reply(false));
    return true;
  }
  if (req.kind === "tabSupported") {
    // The tabs that hold a content script of ours are the supported pages: that is known
    // without the tabs permission and without reading any page address.
    serviceTabs()
      .then((tabs) => reply(tabs.some((t) => t.id === req.tabId)))
      .catch(() => reply(null));
    return true;
  }
  if (req.kind === "chatNonce") {
    // Only a tab's content script (its top frame) gets a pass for its chat frame.
    const nonce = chatFrames.issue(sender);
    reply((nonce ? { nonce } : null) satisfies ChatNonceReply);
    return false;
  }
  handle(req).then(reply);
  return true;
}
