// The chat panel's content (sidebar.html), in an extension frame over the service page
// (DEC-042): keys typed here never reach the service page. It talks to the background itself;
// the content script only places the frame. UC-014 adds the messages and the message box.
import { svgIcon } from "../shared/icons";
import type { Push, SidebarEvent } from "../shared/messages";

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`sidebar.html is missing #${id}`);
  return el;
}

const close = byId("close", HTMLButtonElement);
const code = byId("code", HTMLSpanElement);
/** The region UC-014 fills with the room's chat. */
export const body = byId("body", HTMLElement);
close.append(svgIcon("close", 16));

let port: chrome.runtime.Port | null = null;

function onPush(m: Push) {
  if (m.kind !== "state") return;
  const room = m.state.session?.code;
  code.textContent = room ? `Room ${room}` : "";
}

/**
 * Connects with the one-time pass the tab's content script put in this frame's address. The
 * background serves no other frame (a service page could frame sidebar.html itself). A pass
 * works once: after a worker restart or a reload the content script puts a new frame with a
 * new pass in this one's place.
 */
function connect() {
  const nonce = location.hash.slice(1);
  if (!nonce || !chrome.runtime?.id) return; // no pass, or replaced by an update
  port = chrome.runtime.connect({ name: "sidebar" });
  port.onMessage.addListener(onPush);
  port.onDisconnect.addListener(() => {
    port = null;
  });
  port.postMessage({ kind: "hello", nonce } satisfies SidebarEvent);
}

/** The page closes the panel and gives focus back to whatever opened it. */
function closePanel() {
  port?.postMessage({ kind: "close" } satisfies SidebarEvent);
}

// Only the person's own input acts: a page that frames or overlays this can't script a click.
close.addEventListener("click", (e) => {
  if (e.isTrusted) closePanel();
});
document.addEventListener("keydown", (e) => {
  if (!e.isTrusted || e.key !== "Escape" || e.isComposing || e.defaultPrevented) return;
  e.preventDefault();
  closePanel();
});

/** Opening focuses this frame; focus then goes to its first control. */
function focusFirst() {
  if (document.activeElement && document.activeElement !== document.body) return;
  (document.querySelector<HTMLElement>("[data-focus-first]") ?? close).focus();
}
window.addEventListener("focus", focusFirst);
if (document.hasFocus()) focusFirst();

connect();
