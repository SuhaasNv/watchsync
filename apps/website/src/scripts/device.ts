/**
 * Friends often open an invite on their phone first. WatchSync runs in Chrome or Brave on a
 * computer, so on a phone or another browser the download blocks explain that and offer to
 * share or copy this page's link, instead of a download that leads nowhere.
 */

interface UaData {
  mobile: boolean | null;
  brands: string[];
}

/** navigator.userAgentData where the browser has it (Chromium), read without trusting its shape. */
function uaData(): UaData | null {
  const data: unknown = Reflect.get(navigator, "userAgentData");
  if (typeof data !== "object" || data === null) return null;
  const mobile: unknown = Reflect.get(data, "mobile");
  const brands: unknown = Reflect.get(data, "brands");
  return {
    mobile: typeof mobile === "boolean" ? mobile : null,
    brands: Array.isArray(brands)
      ? brands.flatMap((b: unknown) => {
          const name: unknown =
            typeof b === "object" && b !== null ? Reflect.get(b, "brand") : null;
          return typeof name === "string" ? [name] : [];
        })
      : [],
  };
}

export function isPhoneOrTablet(): boolean {
  const data = uaData();
  if (data?.mobile === true) return true;
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points give it away.
  const iPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return iPad || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export function isChromium(): boolean {
  const brands = uaData()?.brands ?? [];
  if (brands.length) return brands.some((b) => /Chromium|Google Chrome|Brave/.test(b));
  return /Chrome\//.test(navigator.userAgent) && !/Firefox|FxiOS/.test(navigator.userAgent);
}

async function shareOrCopy(button: HTMLButtonElement, label: HTMLElement, status: HTMLElement) {
  const url = window.location.href;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "WatchSync", url });
      return;
    } catch (e) {
      // Cancelling the share sheet is fine; anything else falls through to copying.
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    label.textContent = "Link copied";
    status.textContent = "Link copied. Paste it into a message to yourself.";
  } catch {
    label.textContent = "Copy failed: copy the address bar instead";
    status.textContent = "Couldn't copy. Copy the address from the address bar instead.";
  }
  setTimeout(() => {
    label.textContent = button.dataset.label ?? "Copy the link to this page";
  }, 3000);
}

export function adaptToDevice() {
  const phone = isPhoneOrTablet();
  const chromium = isChromium();
  if (!phone && chromium) return;

  document.documentElement.classList.toggle("on-phone", phone);
  const text = phone
    ? "You're on a phone. WatchSync runs on your computer, in Chrome or Brave. Send yourself this page and open it there."
    : "WatchSync runs in Chrome or Brave. Open this page in one of them to install it.";

  for (const note of document.querySelectorAll<HTMLElement>("[data-device-note]")) {
    const p = note.querySelector<HTMLElement>("[data-device-text]");
    const button = note.querySelector<HTMLButtonElement>("[data-share-page]");
    const label = note.querySelector<HTMLElement>("[data-share-label]");
    const status = note.querySelector<HTMLElement>("[data-share-status]");
    if (!p || !button || !label || !status) continue;
    p.textContent = text;
    const initial =
      phone && typeof navigator.share === "function"
        ? "Send this page to yourself"
        : "Copy the link to this page";
    label.textContent = initial;
    button.dataset.label = initial;
    button.addEventListener("click", () => void shareOrCopy(button, label, status));
    note.hidden = false;
  }
}
