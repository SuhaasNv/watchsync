// Looks for a newer release.

import {
  DEV_RELEASE_API,
  fromStore,
  isUpdate,
  latestRelease,
  RELEASES_API,
  type UpdateCheck,
} from "../shared/update";
import { ready } from "./session";
import { changed, state } from "./state";

/** Looks for a newer release at most once a day; any failure just means no notice. Store installs skip it. */
export async function checkForUpdate() {
  // Chrome updates a Web Store install itself: no GitHub lookup, no notice.
  if (fromStore(chrome.runtime.getManifest())) return;
  const latest = await latestRelease({
    now: Date.now(),
    load: async () => (await chrome.storage.local.get("updateCheck")).updateCheck,
    save: (updateCheck: UpdateCheck) => chrome.storage.local.set({ updateCheck }),
    fetchLatest: async () => {
      // Test builds stay off the network; they read only what a test put in the cache.
      if (__MOCK__) throw new Error("offline in tests");
      const res = await fetch(__CHANNEL__ === "dev" ? DEV_RELEASE_API : RELEASES_API, {
        headers: { accept: "application/vnd.github+json" },
        credentials: "omit",
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`releases ${res.status}`);
      return res.json();
    },
  });
  const installed = chrome.runtime.getManifest().version;
  await ready; // never push a half-restored state to an open popup
  // Dev builds compare commits: any other dev build is the newer one (only dev-latest is read).
  const fresh =
    __CHANNEL__ === "dev"
      ? latest?.version !== __BUILD__
      : isUpdate(latest?.version ?? "", installed);
  state.update = latest && fresh ? latest : null;
  changed();
}
