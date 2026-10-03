import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkVersion,
  latestRc,
  parseTag,
  sameButLabel,
  shippedChanges,
} from "./release-guard.mjs";

test("tags: final, beta and rc parse; anything else does not", () => {
  assert.deepEqual(parseTag("v0.2.0"), { base: "0.2.0", stage: "final", n: null, label: null });
  assert.deepEqual(parseTag("v0.2.0-rc.1"), { base: "0.2.0", stage: "rc", n: 1, label: "rc.1" });
  assert.equal(parseTag("v0.2.0-beta.12")?.label, "beta.12");
  for (const bad of ["0.2.0", "v0.2", "v0.2.0-alpha.1", "v0.2.0-rc", "v0.2.0-rc.1-x"])
    assert.equal(parseTag(bad), null, bad);
});

test("the version and the prerelease label must match the tag", () => {
  const rc = { version: "0.2.0", prerelease: "rc.1" };
  assert.equal(checkVersion("v0.2.0-rc.1", rc), null);
  assert.match(checkVersion("v0.2.0-rc.2", rc) ?? "", /needs "prerelease": "rc.2"/);
  assert.match(checkVersion("v0.2.0", rc) ?? "", /no "prerelease" line/);
  assert.equal(checkVersion("v0.2.0", { version: "0.2.0" }), null);
  assert.match(checkVersion("v0.3.0", { version: "0.2.0" }) ?? "", /for 0.3.0 but/);
  assert.match(checkVersion("v0.2.0-beta.1", { version: "0.2.0" }) ?? "", /needs "prerelease"/);
});

test("a final may change docs, the site and the changelog, but not what ships", () => {
  assert.deepEqual(
    shippedChanges([
      "CHANGELOG.md",
      "docs/RELEASING.md",
      "apps/website/src/pages/index.astro",
      "apps/extension/package.json",
    ]),
    [],
  );
  assert.deepEqual(
    shippedChanges([
      "apps/extension/src/content/index.ts",
      "services/signaling/app/rooms.py",
      "docs/x.md",
    ]),
    ["apps/extension/src/content/index.ts", "services/signaling/app/rooms.py"],
  );
});

test("package.json may lose only the prerelease label", () => {
  assert.equal(
    sameButLabel({ version: "0.2.0", prerelease: "rc.1", a: 1 }, { version: "0.2.0", a: 1 }),
    true,
  );
  assert.equal(sameButLabel({ version: "0.2.0", prerelease: "rc.1" }, { version: "0.2.1" }), false);
});

test("the newest rc of the same version is picked", () => {
  const tags = [
    "v0.2.0-rc.1",
    "v0.2.0-rc.10",
    "v0.2.0-rc.2",
    "v0.3.0-rc.5",
    "v0.2.0-beta.4",
    "v0.1.0",
  ];
  assert.equal(latestRc(tags, "0.2.0"), "v0.2.0-rc.10");
  assert.equal(latestRc(tags, "0.4.0"), null);
});
