// Signs the service rules (DEC-038, docs/RULES-SECURITY.md) and writes the two files the website
// serves: rules/v1.json (the exact bytes that are signed) and rules/v1.json.sig (base64).
//   node scripts/sign-rules.mjs <rules.json> <private-key.pem> [--out <dir>]
// <rules.json> is the file to publish (copy the published v1.json, edit, bump "seq"). The
// private key is an Ed25519 PKCS8 PEM and must live OUTSIDE this repository: the script
// refuses a key inside it, and never prints or copies one.
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Node runs the schema as it is (types stripped); it is the same check the extension makes.
import { MAX_LIFETIME_MS, parseRulesFile } from "../apps/extension/src/rules/schema.ts";

const repo = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

function fail(message) {
  console.error(`sign-rules: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out =
  outAt === -1 ? path.join(repo, "apps/website/public/rules") : path.resolve(args[outAt + 1] ?? "");
const [rulesPath, keyPath] = args.filter((a, i) => a !== "--out" && args[i - 1] !== "--out");
if (!rulesPath || !keyPath)
  fail("usage: node scripts/sign-rules.mjs <rules.json> <private-key.pem> [--out <dir>]");

const keyReal = realpathSync(path.resolve(keyPath));
if (keyReal === repo || keyReal.startsWith(repo + path.sep))
  fail("the private key is inside the repository; keep it outside (see docs/RULES-SECURITY.md)");

let input;
try {
  input = JSON.parse(readFileSync(rulesPath, "utf8"));
} catch {
  fail(`${rulesPath} is not readable JSON`);
}
const file = parseRulesFile(input);
if (!file) fail("the rules do not match the schema (unknown, missing or out-of-range values)");
if (Date.parse(file.expires) <= Date.now()) fail("the rules have already expired");
if (Date.parse(file.expires) > Date.now() + MAX_LIFETIME_MS)
  fail("expires is more than 90 days away; the extension would refuse the file");

const privateKey = createPrivateKey(readFileSync(keyReal));
if (privateKey.asymmetricKeyType !== "ed25519") fail("the key is not an Ed25519 key");
const publicKey = createPublicKey(privateKey);
const publicB64 = publicKey
  .export({ type: "spki", format: "der" })
  .subarray(-32)
  .toString("base64");

// A file may only move the sequence up.
const target = path.join(out, "v1.json");
if (existsSync(target)) {
  const published = parseRulesFile(JSON.parse(readFileSync(target, "utf8")));
  if (published && file.seq <= published.seq)
    fail(`seq ${file.seq} is not above the published seq ${published.seq}`);
}

const body = Buffer.from(`${JSON.stringify(file, null, 2)}\n`);
const signature = sign(null, body, privateKey);
if (!verify(null, body, publicKey, signature)) fail("the new signature does not verify");

// Which key the extension trusts: say so when this one is not among them.
const bundled = readFileSync(path.join(repo, "apps/extension/src/rules/public-key.ts"), "utf8");
if (!bundled.includes(`"${publicB64}"`))
  console.warn(
    "sign-rules: WARNING this key is not the one in apps/extension/src/rules/public-key.ts; builds that carry another key will refuse the file",
  );

mkdirSync(out, { recursive: true });
writeFileSync(target, body);
writeFileSync(`${target}.sig`, `${signature.toString("base64")}\n`);
console.log(
  `signed seq ${file.seq}, expires ${file.expires}, ${body.length} bytes, key ${publicB64}`,
);
