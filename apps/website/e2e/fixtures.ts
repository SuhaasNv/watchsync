import { test as base, type Page, type Route } from "@playwright/test";

export const PAGES = [
  "/",
  "/features/",
  "/install/",
  "/releases/",
  "/faq/",
  "/privacy/",
  "/terms/",
  "/nope/",
];

export const RELEASE = {
  tag_name: "v0.1.0-rc.1",
  name: "WatchSync v0.1.0",
  html_url: "https://github.com/SuhaasNv/watchsync/releases/tag/v0.1.0-rc.1",
  published_at: "2026-10-02T10:00:00Z",
  draft: false,
  prerelease: true,
  body: '### Added\n- **Rooms**: share a `code` [docs](https://github.com/SuhaasNv/watchsync)\n- <img src=x onerror="window.__xss=1">\n\n### Known issues\n- Live streams aren\'t synced.',
  assets: [
    {
      name: "watchsync-extension.zip",
      browser_download_url:
        "https://github.com/SuhaasNv/watchsync/releases/download/v0.1.0-rc.1/watchsync-extension.zip",
    },
  ],
};

export type GithubAnswer = "empty" | "release" | "offline" | "limited";

export async function answerGithub(page: Page, answer: GithubAnswer) {
  await page.route("https://api.github.com/**", (route: Route) => {
    if (answer === "offline") return route.abort("internetdisconnected");
    if (answer === "limited") return route.fulfill({ status: 403, body: "{}" });
    const body = JSON.stringify(answer === "release" ? [RELEASE] : []);
    return route.fulfill({ status: 200, contentType: "application/json", body });
  });
}

/** Every test starts with GitHub answering "no releases", unless it says otherwise. */
export const test = base.extend<{ github: GithubAnswer }>({
  github: ["empty", { option: true }],
  page: async ({ page, github }, use) => {
    await answerGithub(page, github);
    await use(page);
  },
});

export { expect } from "@playwright/test";
