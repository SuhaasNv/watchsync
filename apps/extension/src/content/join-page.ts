// Runs on the invite page (${API}/j/CODE): swaps the install steps for a Join form,
// then opens the room's title once we're in.
import { svgIcon } from "../shared/icons";
import {
  type AppState,
  ERRORS,
  nameProblem,
  type Push,
  safeTitleUrl,
  send,
} from "../shared/messages";

const code = location.pathname.split("/").pop()?.toUpperCase() ?? "";
const slot = document.getElementById("watchsync-join");
const install = document.getElementById("install");

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** Resolves with the first pushed state that is connected to `code`, or null after 5 seconds. */
function connected(): Promise<AppState | null> {
  return new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: "join-page" });
    const done = (s: AppState | null) => {
      clearTimeout(timer);
      port.disconnect();
      resolve(s);
    };
    const timer = setTimeout(() => done(null), 5000);
    port.onMessage.addListener((m: Push) => {
      if (
        m.kind === "state" &&
        m.state.session?.code === code &&
        m.state.connection === "connected"
      )
        done(m.state);
    });
  });
}

function show(...children: (Node | string)[]) {
  slot?.replaceChildren(...children);
}

/** A one-line progress state with a spinner. */
function busy(text: string): HTMLParagraphElement {
  const spinner = el("span", { className: "spinner" });
  spinner.setAttribute("aria-hidden", "true");
  return el("p", { className: "busy" }, spinner, text);
}

function inRoom(text: string): HTMLDivElement {
  const mark = el("span", { className: "state-mark" }, svgIcon("check", 20));
  mark.setAttribute("aria-hidden", "true");
  return el(
    "div",
    { className: "state" },
    mark,
    el("div", {}, el("h2", { textContent: "You're in the room" }), el("p", { textContent: text })),
  );
}

/** Opens the room's title if it has one we may follow; true if it did. */
function openTitle(state: AppState | null): boolean {
  const url = safeTitleUrl(state?.media?.titleUrl);
  if (!state?.media || !url) return false;
  show(busy(`Opening ${state.media.titleName ?? "the title"}…`));
  location.assign(url);
  return true;
}

/** Stays on the page until someone in the room picks a title, then opens it. */
function waitForTitle() {
  const port = chrome.runtime.connect({ name: "join-page" });
  port.onMessage.addListener((m: Push) => {
    if (m.kind === "state" && m.state.session?.code === code && openTitle(m.state))
      port.disconnect();
  });
}

async function enter() {
  show(busy("Joining…"));
  const state = await connected();
  if (openTitle(state)) return;
  if (state && !state.media) {
    const me = state.session?.participantId;
    const friend = state.participants.find((p) => p.id !== me)?.name ?? "Your friend";
    show(
      inRoom(
        `${friend} hasn't picked a title yet. Open Netflix, Prime Video or JioHotstar, or wait here.`,
      ),
    );
    waitForTitle();
    return;
  }
  show(
    inRoom(
      "Open Netflix, Prime Video or JioHotstar and play the same title as your friend. WatchSync keeps you in step from there.",
    ),
  );
}

async function main() {
  if (!slot || !/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return;
  install?.remove();
  slot.style.display = "block";

  const { state } = await send({ kind: "getState" });
  if (state.session?.code === code) return enter();

  const input = el("input", {
    id: "ws-name",
    value: state.name ?? "",
    maxLength: 30,
    autocomplete: "off",
  });
  input.setAttribute("aria-describedby", "ws-name-hint");
  const button = el("button", { type: "submit", textContent: "Join room" });
  const error = el("p", { role: "alert" });
  const form = el(
    "form",
    { className: "join-form" },
    el("label", { htmlFor: "ws-name", textContent: "Your name" }),
    input,
    el("p", {
      id: "ws-name-hint",
      className: "hint",
      textContent: "Friends see this in the room.",
    }),
    button,
    error,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const problem = nameProblem(input.value);
    if (problem) {
      error.textContent = problem;
      input.setAttribute("aria-invalid", "true");
      return input.focus();
    }
    input.removeAttribute("aria-invalid");
    button.disabled = true;
    button.textContent = "Joining…";
    error.textContent = "";
    const named = await send({ kind: "setName", name: input.value });
    const joined = named.ok ? await send({ kind: "join", code }) : named;
    if (joined.ok) return enter();
    error.textContent = ERRORS[joined.error] ?? ERRORS.unreachable ?? "";
    button.disabled = false;
    button.textContent = "Join room";
  });
  show(form);
  input.focus();
}

main();
