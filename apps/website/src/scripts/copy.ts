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
        live.textContent = `Copied ${text}`;
      } catch {
        label.textContent = "Select and copy it";
        live.textContent = "Couldn't copy. Select the address and copy it yourself.";
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        label.textContent = original;
      }, 2500);
    });
  }
}
