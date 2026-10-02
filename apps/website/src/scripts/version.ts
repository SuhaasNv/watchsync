import { checksumFor, versionLabel } from "../lib/releases";
import { CHANNEL } from "../lib/site";
import { fetchReleases } from "./github";

/** Fills every [data-version] with the newest published release; keeps the fallback otherwise. */
export function showLatestVersion() {
  const slots = document.querySelectorAll<HTMLElement>("[data-version]");
  // The dev site's download is the rolling dev build, not a numbered release.
  if (!slots.length || CHANNEL === "dev") return;
  fetchReleases()
    .then((releases) => {
      const latest = releases[0];
      if (!latest) return;
      const label = versionLabel(latest.tag);
      for (const slot of slots) slot.textContent = label;
    })
    .catch(() => {
      // Offline or rate limited: the static label stays, which is still true.
    });
}

/**
 * Shows the SHA-256 of the newest release's zip in [data-latest-sum], read from its notes.
 * Stays hidden on the dev site (its download is the dev build) and when there is none.
 */
export function showLatestChecksum() {
  const slot = document.querySelector<HTMLElement>("[data-latest-sum]");
  if (!slot || CHANNEL === "dev") return;
  fetchReleases()
    .then((releases) => {
      const latest = releases[0];
      const sum = latest && checksumFor(latest.body, "watchsync-extension.zip");
      const version = slot.querySelector<HTMLElement>("[data-sum-version]");
      const code = slot.querySelector<HTMLElement>("[data-sum]");
      if (!latest || !sum || !version || !code) return;
      version.textContent = versionLabel(latest.tag);
      code.textContent = sum;
      slot.hidden = false;
    })
    .catch(() => {
      // Offline or rate limited: the release notes page and GitHub still have it.
    });
}
