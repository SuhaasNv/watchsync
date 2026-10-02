// Builds the MV3 extension into dist/. Usage: node build.mjs [--watch] [--zip]
// Env: WATCHSYNC_API (room service URL), WATCHSYNC_MOCK=1 (adds the local mock player for tests).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const api = (process.env.WATCHSYNC_API ?? "http://localhost:8000").replace(/\/$/, "");
const mock = process.env.WATCHSYNC_MOCK === "1";
const watch = process.argv.includes("--watch");

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
  name: "WatchSync",
  version: pkg.version,
  description:
    "Watch together in sync with friends, each on your own account. Works with Netflix, Prime Video and JioHotstar. Not affiliated with them.",
  icons: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" },
  action: { default_popup: "popup.html", default_icon: { 16: "icons/16.png", 32: "icons/32.png" } },
  background: { service_worker: "background.js", type: "module" },
  permissions: ["storage"],
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

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("public", "dist", { recursive: true });
writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));

const common = {
  bundle: true,
  target: "chrome120",
  define: {
    __API_URL__: JSON.stringify(api),
    __MOCK__: String(mock),
    __TITLE_PAGES__: JSON.stringify(serviceMatches),
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
    },
    format: "iife",
  },
];
for (const b of builds) {
  const opts = { ...common, ...b, outdir: "dist" };
  if (watch) await (await esbuild.context(opts)).watch();
  else await esbuild.build(opts);
}

if (process.argv.includes("--zip") && mock) {
  // A release must never carry the test player, its localhost permission or test hooks.
  throw new Error("Refusing to zip a WATCHSYNC_MOCK build");
}
if (process.argv.includes("--zip")) {
  const name = `watchsync-extension-v${pkg.version}.zip`;
  execFileSync("zip", ["-qr", `../${name}`, "."], { cwd: "dist" });
  console.log(`packed ${name} (API ${api})`);
} else {
  console.log(`built dist/ (API ${api}${mock ? ", mock player" : ""})${watch ? ", watching" : ""}`);
}
