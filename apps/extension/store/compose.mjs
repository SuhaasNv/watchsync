// Builds the Chrome Web Store images from the real captures in store/raw (see
// e2e/store-shots.spec.ts): 1280x800 screenshots and the 440x280 promo tile.
// Usage, from apps/extension: node store/compose.mjs
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const here = import.meta.dirname;
const fonts = path.resolve(here, "../../website/node_modules/@fontsource-variable");
const out = path.join(here, "images");
mkdirSync(out, { recursive: true });

const dataUrl = (file, type) => `data:${type};base64,${readFileSync(file).toString("base64")}`;
const font = (pkg, file) => dataUrl(path.join(fonts, pkg, "files", file), "font/woff2");
const raw = (name) => dataUrl(path.join(here, "raw", name), "image/png");

const css = `
@font-face { font-family: Fraunces; src: url(${font("fraunces", "fraunces-latin-full-normal.woff2")}); font-weight: 100 900; }
@font-face { font-family: Fraunces; font-style: italic; src: url(${font("fraunces", "fraunces-latin-full-italic.woff2")}); font-weight: 100 900; }
@font-face { font-family: Figtree; src: url(${font("figtree", "figtree-latin-wght-normal.woff2")}); font-weight: 300 900; }
@font-face { font-family: Mono; src: url(${font("jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2")}); font-weight: 100 800; }
* { box-sizing: border-box; margin: 0; }
body { width: var(--w); height: var(--h); overflow: hidden; color: #ecf2f1; font-family: Figtree, sans-serif;
  background: radial-gradient(90% 70% at 75% 110%, rgba(255, 210, 90, 0.12), transparent 60%), #0c1215; }
.frame { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 72px; height: 100%; padding: 0 96px; }
.kicker { font-family: Mono; font-size: 15px; letter-spacing: 0.16em; text-transform: uppercase; color: #a9b8b9; }
h1 { font-family: Fraunces; font-variation-settings: "opsz" 144, "SOFT" 40; font-weight: 600; font-size: 76px;
  line-height: 0.98; letter-spacing: -0.035em; margin-top: 22px; }
h1 em { display: block; font-weight: 380; color: #ffd25a; }
p { margin-top: 26px; font-size: 24px; line-height: 1.45; color: #a9b8b9; max-width: 30ch; }
.shot { max-height: 680px; width: 420px; object-fit: contain; object-position: top; border-radius: 22px; box-shadow: 0 0 0 1px rgba(214, 236, 240, 0.14), 0 40px 90px -30px #000; }
`;

const frame = (kicker, title, accent, text, img) => `
<div class="frame"><div><p class="kicker">${kicker}</p><h1>${title}<em>${accent}</em></h1><p>${text}</p></div>
<img class="shot" src="${img}" alt="" /></div>`;

const shots = [
  {
    name: "1-watch-together.png",
    html: frame(
      "WatchSync",
      "Watch together,",
      "in sync.",
      "Netflix, Prime Video and JioHotstar with friends in other cities, each on your own account.",
      raw("popup-home.png"),
    ),
  },
  {
    name: "2-send-the-link.png",
    html: frame(
      "Make a room",
      "Send the link.",
      "Press play.",
      "Friends join from the link or a six-letter code. Play, pause and skips reach everyone.",
      raw("popup-invite.png"),
    ),
  },
  {
    name: "3-welcome.png",
    html: `<img src="${raw("welcome.png")}" width="1280" height="800" alt="" />`,
  },
];

const tile = `
<div style="display:grid;align-content:center;gap:10px;height:100%;padding:0 34px">
  <p class="kicker" style="font-size:12px;display:flex;align-items:center;gap:10px">
    <img src="${dataUrl(path.join(here, "../public/icons/128.png"), "image/png")}" width="28" height="28" alt="" />WatchSync</p>
  <h1 style="font-size:46px;margin:0">Press play here.<em>It plays there.</em></h1>
</div>`;

const browser = await chromium.launch();
async function render(name, html, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<style>:root{--w:${w}px;--h:${h}px}${css}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, name) });
  await page.close();
}
for (const s of shots) await render(s.name, s.html, 1280, 800);
await render("promo-tile-440x280.png", tile, 440, 280);
await browser.close();
console.log(`wrote ${shots.length + 1} images to ${out}`);
