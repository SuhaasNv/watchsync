/** Buttons with data-copy="text" copy it and say so, visibly and to screen readers. */
export function initCopyButtons() {
  let status = document.querySelector<HTMLElement>("[data-copy-status]");
  if (!status) {
    status = document.createElement("p");
    status.className = "sr-only";
    status.setAttribute("role", "status");
    status.dataset.copyStatus = "";
    document.body.append(status);
  }
  const live = status;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    const label = button.querySelector<HTMLElement>("[data-copy-label]") ?? button;
    const original = label.textContent ?? "Copy";
    let timer: ReturnType<typeof setTimeout> | undefined;
    button.addEventListener("click", async () => {
      const text = button.dataset.copy ?? "";
      try {
        await navigator.clipboard.writeText(text);
        label.textContent = "Copied";
        button.dataset.state = "copied";
        live.textContent = `Copied ${text}`;
        // Where the page says what to do next (websites can't open the browser's own pages).
        const hint = button.closest("li")?.querySelector<HTMLElement>("[data-copy-hint]");
        if (hint) {
          const mac = /Mac/.test(navigator.userAgent);
          for (const key of hint.querySelectorAll<HTMLElement>("[data-key]"))
            key.textContent = `${mac ? "⌘" : "Ctrl+"}${(key.dataset.key ?? "").toUpperCase()}`;
          hint.hidden = false;
          const next = (hint.textContent ?? "").replace(/\s+/g, " ").replace(/^\s*Copied\.\s*/, "").trim();
          live.textContent = `Copied ${text}. ${next}`;
        }
      } catch {
        label.textContent = "Select and copy it";
        button.dataset.state = "failed";
        live.textContent = "Couldn't copy. Select the address and copy it yourself.";
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        label.textContent = original;
        delete button.dataset.state;
      }, 2500);
    });
  }
}
