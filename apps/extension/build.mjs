// Builds the MV3 extension into dist/. Usage: node build.mjs [--watch] [--zip]
// Env: WATCHSYNC_API (room service URL), WATCHSYNC_MOCK=1 (adds the local mock player for tests),
// WATCHSYNC_CHANNEL=dev (the "WatchSync Dev" build for testers, DEC-026; default prod),
// WATCHSYNC_OUT (output folder, default dist; the restart e2e builds a second copy).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const api = (process.env.WATCHSYNC_API ?? "http://localhost:8000").replace(/\/$/, "");
const mock = process.env.WATCHSYNC_MOCK === "1";
const out = process.env.WATCHSYNC_OUT ?? "dist";
const watch = process.argv.includes("--watch");
const zip = process.argv.includes("--zip");
const channel = process.env.WATCHSYNC_CHANNEL === "dev" ? "dev" : "prod";
if (zip && !process.env.WATCHSYNC_API) throw new Error("Set WATCHSYNC_API for a zip build");
// Dev builds name their commit, so the popup can tell a tester a newer dev build is out.
const build =
  channel === "dev"
    ? execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim()
    : "";

const services = {
  netflix: ["https://www.netflix.com/*"],
  prime: [
    "https://www.primevideo.com/*",
    "https://www.amazon.com/gp/video/*",
    "https://www.amazon.in/gp/video/*",
    "https://www.amazon.co.uk/gp/video/*",
    "https://www.amazon.de/gp/video/*",
  ],
  jiohotstar: ["https://www.jiohotstar.com/*", "https://www.hotstar.com/*"],
};
const serviceMatches = [
  ...Object.values(services).flat(),
  ...(mock ? ["http://localhost:4173/*"] : []),
];

const manifest = {
  manifest_version: 3,
  name: channel === "dev" ? "WatchSync Dev" : "WatchSync",
  version: pkg.version,
  ...(channel === "dev" ? { version_name: `${pkg.version} dev ${build}` } : {}),
  description:
    "Watch in sync with friends, each on your own account. Works with Netflix, Prime Video and JioHotstar. Not affiliated with them.",
  icons: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" },
  action: { default_popup: "popup.html", default_icon: { 16: "icons/16.png", 32: "icons/32.png" } },
  background: { service_worker: "background.js", type: "module" },
  // scripting: add WatchSync to service tabs already open at install or update (BUG-052).
  permissions: ["storage", "scripting"],
  host_permissions: [`${api}/*`],
  content_scripts: [
    { matches: serviceMatches, js: ["content.js"], run_at: "document_idle" },
    {
      matches: services.netflix,
      js: ["netflix-bridge.js"],
      world: "MAIN",
      run_at: "document_idle",
    },
    { matches: [`${api}/j/*`], js: ["join-page.js"], run_at: "document_idle" },
  ],
};

// The Chrome Web Store refuses a package whose description is over 132 characters (BUG-059).
if (manifest.description.length > 132)
  throw new Error(
    `manifest description is ${manifest.description.length} characters; the store allows 132`,
  );

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
cpSync("public", out, { recursive: true });
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
// The website for this channel; the dev site's address comes from CI (repository variable
// DEV_SITE_URL), not the source.
const site =
  channel === "dev" && process.env.WATCHSYNC_SITE
    ? process.env.WATCHSYNC_SITE
    : "https://watchsync.space";
// The welcome page links to the website's privacy notice.
const welcome = readFileSync(`${out}/welcome.html`, "utf8");
writeFileSync(`${out}/welcome.html`, welcome.replaceAll("__SITE_URL__", site));

const common = {
  bundle: true,
  target: "chrome120",
  define: {
    __API_URL__: JSON.stringify(api),
    __MOCK__: String(mock),
    __CHANNEL__: JSON.stringify(channel),
    __BUILD__: JSON.stringify(build),
    __SITE_URL__: JSON.stringify(site),
  },
  logLevel: "warning",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
};
const builds = [
  { entryPoints: { background: "src/background/index.ts" }, format: "esm" },
  {
    entryPoints: {
      content: "src/content/index.ts",
      "netflix-bridge": "src/page/netflix-bridge.ts",
      "join-page": "src/content/join-page.ts",
      popup: "src/popup/main.tsx",
      welcome: "src/welcome/main.ts",
    },
    format: "iife",
  },
];
for (const b of builds) {
  const opts = { ...common, ...b, outdir: out };
  if (watch) await (await esbuild.context(opts)).watch();
  else await esbuild.build(opts);
}

if (zip && mock) {
  // A release must never carry the test player, its localhost permission or test hooks.
  throw new Error("Refusing to zip a WATCHSYNC_MOCK build");
}
if (zip) {
  const name =
    channel === "dev" ? "watchsync-extension-dev.zip" : `watchsync-extension-v${pkg.version}.zip`;
  execFileSync("zip", ["-qr", `../${name}`, "."], { cwd: out });
  console.log(`packed ${name} (${channel}, API ${api})`);
} else {
  console.log(`built dist/ (API ${api}${mock ? ", mock player" : ""})${watch ? ", watching" : ""}`);
}
