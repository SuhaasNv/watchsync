import { versionLabel } from "../lib/releases";
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
