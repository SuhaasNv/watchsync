// Pieces the microphone page (voice-permission.html) shares between its two modes: asking Chrome
// for the microphone, and testing it.
import { detectOs, micHelp, micSettingsUrl } from "./help";
import type { BlockedBy } from "./messages";

/** The page's one container. */
export function appRoot(): HTMLElement {
  const app = document.getElementById("app");
  if (!app) throw new Error("voice-permission: missing #app");
  return app;
}

/** The tab to go back to, from the page's address (`?tab=`), or undefined. */
export function backTab(): number | undefined {
  const raw = new URLSearchParams(location.search).get("tab");
  return raw !== null && /^\d{1,10}$/.test(raw) ? Number(raw) : undefined;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  ...children: Node[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  node.append(...children);
  return node;
}

export function button(text: string, className = "btn"): HTMLButtonElement {
  const b = el("button", { className, text });
  b.type = "button";
  return b;
}

export function heading(title: string): HTMLHeadingElement {
  const h = el("h1", { className: "title", text: title });
  h.tabIndex = -1;
  return h;
}

export const PROMISE =
  "Your voice goes straight to the people in your room. WatchSync never records it and our server never hears it.";

/** Back to the tab the person came from, then this one closes. False if that tab is gone. */
export async function returnTo(tab: number | undefined): Promise<boolean> {
  if (tab === undefined) return false;
  const there = await chrome.tabs.get(tab).catch(() => null);
  if (!there?.id) return false;
  await chrome.tabs.update(there.id, { active: true });
  await chrome.windows.update(there.windowId, { focused: true });
  const me = await chrome.tabs.getCurrent();
  if (me?.id !== undefined) await chrome.tabs.remove(me.id);
  return true;
}

/** The title of the tab to go back to, for "You can go back to ...". */
export async function backName(tab: number | undefined): Promise<string> {
  const there = tab === undefined ? null : await chrome.tabs.get(tab).catch(() => null);
  return there?.title?.trim() || "your film";
}

/** The steps for a blocked mic, with a button to Chrome's settings for WatchSync. */
export function blockedCard(by: BlockedBy): HTMLElement {
  const help = micHelp(detectOs(navigator.platform), by);
  const list = el("ol");
  for (const step of help.steps) list.append(el("li", { text: step }));
  const card = el(
    "section",
    { className: "mic-help" },
    el("h2", { className: "mic-help-title", text: help.title }),
    el("p", { className: "hint", text: help.text }),
    list,
  );
  if (help.button) {
    const open = button(help.button, "btn primary");
    open.addEventListener("click", () => {
      chrome.tabs.create({ url: micSettingsUrl(location.origin) }).catch(() => {});
    });
    card.append(open);
  }
  card.append(el("p", { className: "hint", text: help.footer }));
  return card;
}
