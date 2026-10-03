// First-run welcome page (opened by the background on install). Static content lives in
// welcome.html; this file adds the step tour, scroll reveals, pin status and the name form.
import { ERRORS, nameProblem, send } from "../shared/messages";

function $<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`welcome: missing ${selector}`);
  return el;
}

const reduce = matchMedia("(prefers-reduced-motion: reduce)");
document.documentElement.classList.add("js");

// ---- Step tour: the ARIA tabs pattern, plus Back / Next buttons. ----
const tour = $<HTMLDivElement>(".tour");
const tabs = [...tour.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const panels = tabs.map((t) => $<HTMLDivElement>(`#${t.getAttribute("aria-controls")}`));
const back = $<HTMLButtonElement>("#back");
const next = $<HTMLButtonElement>("#next");
const live = $<HTMLParagraphElement>("#tour-live");
let step = 0;

function show(i: number, announce: boolean) {
  step = Math.max(0, Math.min(tabs.length - 1, i));
  tabs.forEach((tab, n) => {
    const on = n === step;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    tab.classList.toggle("past", n < step);
    const panel = panels[n];
    if (panel) panel.hidden = !on;
  });
  back.disabled = step === 0;
  next.textContent = step === tabs.length - 1 ? "Finish" : "Next";
  if (announce) {
    const title = panels[step]?.querySelector("h3")?.textContent ?? "";
    live.textContent = `Step ${step + 1} of ${tabs.length}: ${title}`;
  }
}

tabs.forEach((tab, n) => {
  tab.addEventListener("click", () => show(n, false));
  tab.addEventListener("keydown", (e) => {
    const to: Record<string, number> = {
      ArrowRight: (n + 1) % tabs.length,
      ArrowLeft: (n - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = to[e.key];
    if (target === undefined) return;
    e.preventDefault();
    show(target, false);
    tabs[target]?.focus();
  });
});
back.addEventListener("click", () => show(step - 1, true));
next.addEventListener("click", () => {
  if (step < tabs.length - 1) return show(step + 1, true);
  const finish = $<HTMLHeadingElement>("#finish-title");
  finish.scrollIntoView({ behavior: reduce.matches ? "auto" : "smooth", block: "start" });
  finish.focus({ preventScroll: true });
});
$<HTMLButtonElement>("#replay").addEventListener("click", () => {
  const stage = panels[step]?.querySelector<HTMLElement>(".stage");
  if (!stage) return;
  // A fresh copy of the scene plays its CSS animations again from the first frame.
  stage.replaceWith(stage.cloneNode(true));
});

// ---- Reveals: sections rise in as they scroll into view; the tour's first scene waits. ----
const seen = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      // The tour's first scene starts when the tour comes into view, not on page load.
      e.target.classList.add("in", "seen");
      seen.unobserve(e.target);
    }
  },
  { threshold: 0.2 },
);
for (const el of document.querySelectorAll("[data-reveal]")) seen.observe(el);

// ---- Pinned or not: Chrome reports it, so the page can confirm instead of guessing. ----
// Chrome has no way for an extension to pin itself; the page points at the puzzle icon and
// checks every 1.5 s while it's open (and when it comes back into view) whether it's done.
const pinState = $<HTMLSpanElement>("#pin-state");
const pinText = $<HTMLSpanElement>("#pin-text");
const pointer = $<HTMLDivElement>("#pointer");
/** The pointer shows itself once, the first time Chrome says WatchSync isn't pinned. */
let pointedOnce = false;

async function refreshPin() {
  let pinned: boolean | null = null;
  try {
    pinned = (await chrome.action.getUserSettings()).isOnToolbar;
  } catch {
    // Older Chrome: leave the status neutral rather than guess.
  }
  pinState.dataset.state = pinned === null ? "unknown" : pinned ? "yes" : "no";
  pinText.textContent =
    pinned === null
      ? "Pin status unknown"
      : pinned
        ? "Pinned. You'll find WatchSync up there."
        : "Not pinned yet";
  if (pinned) pointer.hidden = true;
  else if (pinned === false && !pointedOnce) {
    pointedOnce = true;
    pointer.hidden = false;
  }
}
void refreshPin();
let poll: ReturnType<typeof setInterval> | undefined;
function watchPin() {
  clearInterval(poll);
  poll = document.hidden ? undefined : setInterval(() => void refreshPin(), 1500);
}
watchPin();
// The change event arrived in Chrome 130; the poll and focus cover earlier versions.
chrome.action.onUserSettingsChanged?.addListener(() => void refreshPin());
addEventListener("focus", () => void refreshPin());
document.addEventListener("visibilitychange", () => {
  watchPin();
  if (!document.hidden) void refreshPin();
});

$<HTMLButtonElement>("#show-me").addEventListener("click", () => {
  pointer.hidden = false;
  $<HTMLButtonElement>("#pointer-close").focus();
});
$<HTMLButtonElement>("#pointer-close").addEventListener("click", () => {
  pointer.hidden = true;
  $<HTMLButtonElement>("#show-me").focus();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !pointer.hidden) {
    pointer.hidden = true;
    $<HTMLButtonElement>("#show-me").focus();
  }
});

// ---- Name: saved here, the popup opens straight on Create a room. ----
const form = $<HTMLFormElement>("#name-form");
const input = $<HTMLInputElement>("#name");
const save = $<HTMLButtonElement>("#save-name");
const status = $<HTMLParagraphElement>("#name-status");
let savedName = "";

send({ kind: "getState" })
  .then((r) => {
    savedName = r.state.name ?? "";
    if (!input.value) input.value = savedName;
  })
  .catch(() => {
    // The background is starting up; the field simply starts empty.
  });

async function saveName(): Promise<boolean> {
  const name = input.value.trim();
  const problem = nameProblem(name);
  if (problem) {
    status.classList.add("error");
    status.textContent = problem;
    input.setAttribute("aria-invalid", "true");
    return false;
  }
  save.disabled = true;
  status.classList.remove("error");
  try {
    const r = await send({ kind: "setName", name });
    if (!r.ok) throw new Error(r.error);
    savedName = r.state.name ?? name;
    input.value = savedName;
    status.textContent = `Saved. Friends will see you as ${savedName}.`;
    input.removeAttribute("aria-invalid");
    return true;
  } catch (e) {
    const code = e instanceof Error ? e.message : "unreachable";
    status.classList.add("error");
    status.textContent = ERRORS[code] ?? ERRORS.unreachable ?? "";
    input.setAttribute("aria-invalid", "true");
    return false;
  } finally {
    save.disabled = false;
  }
}
form.addEventListener("submit", (e) => {
  e.preventDefault();
  void saveName();
});

// ---- Leaving: both close this tab; "let's go" keeps a name typed but not yet saved. ----
async function closeTab() {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
  else window.close();
}
$<HTMLButtonElement>("#go").addEventListener("click", async () => {
  const typed = input.value.trim();
  if (typed && typed !== savedName && !(await saveName())) return input.focus();
  await closeTab();
});
$<HTMLButtonElement>("#skip").addEventListener("click", () => void closeTab());

show(0, false);
