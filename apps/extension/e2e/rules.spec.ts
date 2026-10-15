// Signed service rules (US-124, DEC-038). A test server stands in for watchsync.space and a
// throwaway key stands in for the owner's; the built extension fetches, verifies and stores the
// rules, and its adapter then reads a different ad marker without any update.

import { generateKeyPairSync, sign } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { BrowserContext, Worker } from "@playwright/test";
import { expect, MOCK, room, test } from "./fixtures";

const AD_MARK = "[data-rules-ad]";

function newKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicB64: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"),
  };
}

/** The same values as the bundled rules, except the Prime ad marker. */
const inDays = (days: number) =>
  new Date(Date.now() + days * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
const rulesBody = (seq: number, expires = inDays(30)) =>
  JSON.stringify({
    schema: 1,
    seq,
    expires,
    rules: {
      filmMinSec: 300,
      netflix: { titleSelector: '[data-uia="video-title"]', driftToleranceSec: 0.15 },
      prime: {
        titleSelectors: [".atvwebplayersdk-title-text", '[data-automation-id="title"]'],
        episodeSelector: ".atvwebplayersdk-subtitle-text",
        adTimerSelector: AD_MARK,
        driftToleranceSec: 0.25,
      },
      jiohotstar: { driftToleranceSec: 0.5 },
    },
  });

/** Serves /rules/v1.json and .sig with CORS, like the website; the answer can change per test. */
async function rulesSite() {
  let body = "";
  let sig = "";
  const server: Server = createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    if (req.url === "/rules/v1.json") res.end(body);
    else if (req.url === "/rules/v1.json.sig") res.end(sig);
    else res.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("no port");
  const url = `http://127.0.0.1:${address.port}/rules/v1.json`;
  return {
    url,
    publish(text: string, key: ReturnType<typeof newKey>, tamper = false) {
      sig = sign(null, Buffer.from(text), key.privateKey).toString("base64");
      body = tamper ? text.replace('"seq":', '"seq": ') : text;
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

async function workerOf(context: BrowserContext): Promise<Worker> {
  const [worker] = context.serviceWorkers();
  return worker ?? (await context.waitForEvent("serviceworker"));
}

/** Runs the daily check now, as if a day had passed, against the test site and key. */
async function checkNow(worker: Worker, url: string, publicKey: string) {
  await worker.evaluate(
    async ([u, k]) => {
      const { rules } = await chrome.storage.local.get("rules");
      if (rules) await chrome.storage.local.set({ rules: { ...rules, nextCheckAt: 0 } });
      // The hook exists only in test builds (background/rules.ts).
      await Reflect.get(globalThis, "watchsyncCheckRules")(u, k);
    },
    [url, publicKey],
  );
}

/** The sequence number of the rules stored by the worker, or null while there are none. */
async function storedSeq(worker: Worker): Promise<number | null> {
  const stored = await worker.evaluate(async () =>
    JSON.stringify((await chrome.storage.local.get("rules")).rules ?? null),
  );
  const state: unknown = JSON.parse(stored);
  if (typeof state !== "object" || state === null || !("file" in state)) return null;
  const { file } = state;
  if (typeof file !== "object" || file === null || !("seq" in file)) return null;
  return typeof file.seq === "number" ? file.seq : null;
}

test("only a newer, correctly signed file is taken; everything else keeps the last good rules", async ({
  ext,
}) => {
  const site = await rulesSite();
  const key = newKey();
  const worker = await workerOf(ext.context);
  try {
    expect(await storedSeq(worker)).toBeNull(); // nothing yet: the bundled rules

    site.publish(rulesBody(2), key);
    await checkNow(worker, site.url, key.publicB64);
    expect(await storedSeq(worker)).toBe(2);

    site.publish(rulesBody(1), key); // older, signed
    await checkNow(worker, site.url, key.publicB64);
    expect(await storedSeq(worker)).toBe(2);

    site.publish(rulesBody(5), newKey()); // newer, signed by someone else
    await checkNow(worker, site.url, key.publicB64);
    expect(await storedSeq(worker)).toBe(2);

    site.publish(rulesBody(6), key, true); // newer, changed after signing
    await checkNow(worker, site.url, key.publicB64);
    expect(await storedSeq(worker)).toBe(2);

    site.publish(rulesBody(7, "2020-01-01T00:00:00Z"), key); // newer but expired
    await checkNow(worker, site.url, key.publicB64);
    expect(await storedSeq(worker)).toBe(2);

    site.publish(rulesBody(8), key);
    await checkNow(worker, "http://127.0.0.1:1/rules/v1.json", key.publicB64); // no network
    expect(await storedSeq(worker)).toBe(2);

    site.publish(rulesBody(9), key); // newer and good: taken
    await checkNow(worker, site.url, key.publicB64);
    expect(await storedSeq(worker)).toBe(9);
  } finally {
    await site.close();
  }
});

test("signed rules change what the adapter sees, without an extension update", async ({ ext }) => {
  const site = await rulesSite();
  const key = newKey();
  const { hostTab, friend } = await room(ext);
  try {
    const tab = await friend.context.newPage();
    await tab.goto(`${MOCK}/watch/ep1`);
    await expect
      .poll(() => tab.evaluate(() => !document.querySelector("video")?.paused))
      .toBe(true);
    await tab.waitForTimeout(3200); // past the arrival window (BUG-004)
    const mark = () =>
      tab.evaluate(() => {
        const el = document.createElement("div");
        el.setAttribute("data-rules-ad", "");
        el.textContent = "Ad 0:18";
        document.body.append(el);
      });

    // Bundled rules: this marker means nothing, so the host never hears of an ad.
    await mark();
    await expect(hostTab.getByText("Waiting for Asha's ad")).toHaveCount(0, { timeout: 2500 });
    await tab.evaluate((sel) => document.querySelector(sel)?.remove(), AD_MARK);

    site.publish(rulesBody(1), key);
    await checkNow(await workerOf(friend.context), site.url, key.publicB64);
    await tab.reload(); // content scripts read the stored rules when they start
    await expect
      .poll(() => tab.evaluate(() => !document.querySelector("video")?.paused))
      .toBe(true);
    await tab.waitForTimeout(3200);

    await mark();
    await expect(hostTab.getByText("Waiting for Asha's ad")).toBeVisible({ timeout: 5000 });
  } finally {
    await friend.context.close();
    await site.close();
  }
});
