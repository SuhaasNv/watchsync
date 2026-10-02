/** The parts of the chrome API injectOpenTabs uses, so tests can pass a fake. */
export interface InjectApi {
  runtime: { getManifest(): chrome.runtime.Manifest };
  tabs: { query(q: { url: string[] }): Promise<{ id?: number }[]> };
  scripting: {
    executeScript(injection: {
      target: { tabId: number };
      files: string[];
      world: "MAIN" | "ISOLATED";
    }): Promise<unknown>;
  };
}

/**
 * Chrome adds content scripts only to pages loaded after install or update, so tabs already
 * open on a service would need a reload (BUG-052). Adds the manifest's scripts to them now.
 */
export async function injectOpenTabs(api: InjectApi): Promise<void> {
  for (const script of api.runtime.getManifest().content_scripts ?? []) {
    const files = script.js;
    if (!script.matches || !files) continue;
    const world = "world" in script && script.world === "MAIN" ? "MAIN" : "ISOLATED";
    const tabs = await api.tabs.query({ url: script.matches });
    for (const tab of tabs)
      if (tab.id !== undefined)
        // A tab that closed meanwhile or can't take scripts: nothing to fix.
        await api.scripting
          .executeScript({ target: { tabId: tab.id }, files, world })
          .catch(() => {});
  }
}
