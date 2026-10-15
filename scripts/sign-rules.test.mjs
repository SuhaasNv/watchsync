// The rules signing tool: signs valid rules, and refuses a key inside the repository, a bad
// schema, and a sequence that does not go up. Keys are made fresh and kept in a temp folder.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tool = path.join(repo, "scripts/sign-rules.mjs");
const dir = mkdtempSync(path.join(tmpdir(), "sign-rules-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const keyPath = path.join(dir, "key.pem");
writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });

const rules = (seq, extra = {}) => ({
  schema: 1,
  seq,
  expires: new Date(Date.now() + 30 * 864e5).toISOString().replace(/\.\d+Z$/, "Z"),
  rules: {
    filmMinSec: 300,
    netflix: { titleSelector: ".t", driftToleranceSec: 0.15 },
    prime: {
      titleSelectors: [".a"],
      episodeSelector: ".b",
      adTimerSelector: ".c",
      driftToleranceSec: 0.25,
    },
    jiohotstar: { driftToleranceSec: 0.5 },
  },
  ...extra,
});
const input = (name, value) => {
  const p = path.join(dir, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
};
const run = (rulesPath, key = keyPath, out = path.join(dir, "out")) => {
  try {
    execFileSync("node", [tool, rulesPath, key, "--out", out], { stdio: "pipe" });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e.stderr) };
  }
};

test("signs valid rules so the public key verifies the exact bytes written", () => {
  assert.equal(run(input("a.json", rules(1))).ok, true);
  const body = readFileSync(path.join(dir, "out/v1.json"));
  const sig = Buffer.from(readFileSync(path.join(dir, "out/v1.json.sig"), "utf8").trim(), "base64");
  assert.equal(verify(null, body, publicKey, sig), true);
  assert.equal(JSON.parse(body).seq, 1);
});

test("a sequence that does not go up is refused, and one that does is signed", () => {
  assert.match(run(input("same.json", rules(1))).message, /not above the published seq 1/);
  assert.equal(run(input("up.json", rules(2))).ok, true);
});

test("rules outside the schema are refused", () => {
  assert.match(
    run(input("x.json", rules(9, { extra: 1 })), keyPath, path.join(dir, "o2")).message,
    /schema/,
  );
});

test("a private key inside the repository is refused", () => {
  const inside = path.join(repo, "scripts/.test-key.pem");
  writeFileSync(inside, "not a key: the location is refused before the file is read");
  try {
    mkdirSync(path.join(dir, "o3"), { recursive: true });
    assert.match(
      run(input("k.json", rules(1)), inside, path.join(dir, "o3")).message,
      /inside the repository/,
    );
  } finally {
    rmSync(inside, { force: true });
  }
});
