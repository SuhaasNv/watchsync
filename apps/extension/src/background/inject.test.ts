import { expect, test } from "vitest";
import { type InjectApi, injectOpenTabs } from "./inject";

test("adds each content script to the open tabs it matches, in its own world (BUG-052)", async () => {
  const done: { tabId: number; files: string[]; world: string }[] = [];
  const api: InjectApi = {
    runtime: {
      getManifest: () =>
        ({
          manifest_version: 3,
          name: "x",
          version: "1",
          content_scripts: [
            { matches: ["https://www.netflix.com/*"], js: ["content.js"] },
            { matches: ["https://www.netflix.com/*"], js: ["netflix-bridge.js"], world: "MAIN" },
            { matches: ["https://join.example/j/*"], css: ["x.css"] },
          ],
        }) as chrome.runtime.Manifest,
    },
    tabs: {
      query: async ({ url }) =>
        url[0] === "https://www.netflix.com/*" ? [{ id: 1 }, { id: 2 }, {}] : [{ id: 9 }],
    },
    scripting: {
      executeScript: async ({ target, files, world }) => {
        if (target.tabId === 2) throw new Error("tab closed");
        done.push({ tabId: target.tabId, files, world });
      },
    },
  };
  await injectOpenTabs(api);
  expect(done).toEqual([
    { tabId: 1, files: ["content.js"], world: "ISOLATED" },
    { tabId: 1, files: ["netflix-bridge.js"], world: "MAIN" },
  ]);
});
