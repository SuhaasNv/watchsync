// The six reaction buttons in the chat frame (US-045). Taps on one within 250 ms go out as
// one send with a count; a dropped send makes its button shake (still under reduced motion)
// and is said once (US-046).
import type { Emoji } from "@watchsync/protocol";
import { Burst, REACTIONS } from "../shared/reactions";

export interface ReactionBar {
  /** The background dropped this reaction: show it on its button and say why, once. */
  dropped(emoji: Emoji, reason: "offline" | "limit"): void;
}

const SAY = { offline: "Not sent. Reconnecting.", limit: "Slow down a little." } as const;

/** Builds the bar right after `above` (the message box). */
export function mountReactions(
  above: HTMLElement,
  sendOut: (emoji: Emoji, count: number) => void,
): ReactionBar {
  const bar = document.createElement("div");
  bar.className = "reactions";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Send a reaction");
  const status = document.createElement("p");
  status.className = "sr";
  status.setAttribute("role", "status");
  const burst = new Burst(sendOut);
  const buttons = new Map<Emoji, HTMLButtonElement>();
  for (const { emoji, name } of REACTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "reaction";
    b.textContent = emoji;
    b.title = name;
    b.setAttribute("aria-label", name);
    // Only the person's own input acts: a page that frames this can't script a tap.
    b.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      burst.tap(emoji);
      b.classList.add("sent"); // a brief warm flash: it went
    });
    b.addEventListener("animationend", () => b.classList.remove("dropped", "sent"));
    buttons.set(emoji, b);
    bar.append(b);
  }
  bar.append(status);
  above.after(bar);
  let quiet: ReturnType<typeof setTimeout> | undefined;
  return {
    dropped(emoji, reason) {
      const b = buttons.get(emoji);
      if (b) {
        b.classList.remove("dropped");
        void b.offsetWidth; // restart the shake on a repeat drop
        b.classList.add("dropped");
      }
      // Said once while it keeps happening; cleared after a quiet spell so a later one is too.
      if (status.textContent !== SAY[reason]) status.textContent = SAY[reason];
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        status.textContent = "";
      }, 3000);
    },
  };
}
