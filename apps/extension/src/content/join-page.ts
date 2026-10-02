// Runs on the invite page (${API}/j/CODE): swaps the install steps for a Join form,
// then opens the room's title once we're in.
import { type AppState, ERRORS, type Push, safeTitleUrl, send } from "../shared/messages";

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

async function enter() {
  show(el("p", { textContent: "Joining…" }));
  const state = await connected();
  const url = safeTitleUrl(state?.media?.titleUrl);
  if (state?.media && url) {
    show(el("p", { textContent: `Opening ${state.media.titleName ?? "the title"}…` }));
    location.assign(url);
    return;
  }
  show(
    el("h2", { textContent: "You're in the room" }),
    el("p", {
      textContent:
        "Open Netflix, Prime Video or JioHotstar and play the same title as your friend. WatchSync keeps you in step from there.",
    }),
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
  const button = el("button", { type: "submit", textContent: "Join room" });
  const error = el("p", { role: "alert" });
  const form = el(
    "form",
    {},
    el("label", { htmlFor: "ws-name", textContent: "Your name" }),
    input,
    button,
    error,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    button.disabled = true;
    error.textContent = "";
    const named = await send({ kind: "setName", name: input.value });
    const joined = named.ok ? await send({ kind: "join", code }) : named;
    if (joined.ok) return enter();
    error.textContent = ERRORS[joined.error] ?? ERRORS.unreachable ?? "";
    button.disabled = false;
  });
  show(form);
  input.focus();
}

main();
