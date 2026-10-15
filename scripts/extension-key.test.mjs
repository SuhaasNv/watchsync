import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extensionId, KEYS } from "../apps/extension/keys.mjs";

/** The IDs people's Chrome shows for WatchSync and WatchSync Dev (chrome://extensions). */
const IDS = { prod: "dgoifalfabkpbnpcmahfngmhjaekcdkj", dev: "ffehhcgkamjnfflfblajdabolliifocj" };

test("each channel's key is a 2048-bit RSA public key and gives its fixed ID", () => {
  for (const [channel, key] of Object.entries(KEYS)) {
    const pub = createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
    assert.equal(pub.asymmetricKeyType, "rsa", channel);
    assert.equal(pub.asymmetricKeyDetails?.modulusLength, 2048, channel);
    assert.equal(extensionId(key), IDS[channel], channel);
  }
});

test("the two channels differ, so WatchSync Dev installs next to WatchSync", () => {
  assert.notEqual(KEYS.prod, KEYS.dev);
  assert.notEqual(IDS.prod, IDS.dev);
});

test("only public keys are in the repository's key file", () => {
  const text = readFileSync(new URL("../apps/extension/keys.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(text, /PRIVATE\sKEY/);
});

test("an ID is 32 letters from a to p", () => {
  assert.match(extensionId(KEYS.prod), /^[a-p]{32}$/);
});
