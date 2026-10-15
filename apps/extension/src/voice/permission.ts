// The microphone page (voice-permission.html), opened in a tab of its own. Voice runs in an
// extension document, so Chrome's question has to be asked by an extension page too: asked
// here, the permission belongs to WatchSync, never to the streaming site (US-055). The page
// asks, tells the voice document the answer, shows "Done", returns the person to the tab they
// came from and closes itself.
import type { MicAnswerRequest } from "../shared/messages";
import { blockedBy } from "./echo";
import type { BlockedBy } from "./messages";
import {
  appRoot,
  backName,
  backTab,
  blockedCard,
  button,
  el,
  heading,
  PROMISE,
  returnTo,
} from "./mic-page";
import { micTest } from "./mic-test";

/** How long "Done" shows before the person is taken back. */
const DONE_MS = 1500;

async function ask() {
  const app = appRoot();
  const status = el("p", { className: "status" });
  status.setAttribute("role", "status");
  const again = button("Try again", "btn primary");
  const row = el("div", { className: "row" }, again);
  row.hidden = true;
  const title = heading("Allow WatchSync to use your microphone");
  app.replaceChildren(title, el("p", { className: "hint", text: PROMISE }), status, row);
  title.focus();
  const back = backTab();

  const tell = (by: BlockedBy | null) =>
    chrome.runtime
      .sendMessage({ kind: "micAnswer", by } satisfies MicAnswerRequest)
      .catch((e: unknown) => console.debug("watchsync: mic answer", e));

  async function run() {
    row.hidden = true;
    status.className = "status";
    status.textContent = "Waiting for Chrome…";
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const by = blockedBy(e);
      if (by === null) {
        // The question was closed without an answer: nothing is decided, ask again on request.
        status.textContent = "Chrome didn't get an answer.";
        row.hidden = false;
        again.focus();
        return;
      }
      status.textContent = "";
      app.append(blockedCard(by));
      await tell(by);
      return;
    }
    for (const t of stream.getTracks()) t.stop(); // the permission is all this page wanted
    await tell(null);
    status.className = "status done";
    status.textContent = `Done. You can go back to ${await backName(back)}.`;
    await new Promise((resolve) => setTimeout(resolve, DONE_MS));
    if (await returnTo(back)) return;
    status.textContent = "Done. You can close this tab.";
  }

  again.addEventListener("click", () => void run());
  await run();
}

const mode = new URLSearchParams(location.search).get("mode");
if (mode === "ask") ask().catch((e: unknown) => console.debug("watchsync: mic page", e));
if (mode === "test") micTest().catch((e: unknown) => console.debug("watchsync: mic test", e));
