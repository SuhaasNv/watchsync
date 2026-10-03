import assert from "node:assert/strict";
import { test } from "node:test";
import { checkVersion, parseTag, sameButLabel, shippedChanges } from "./release-guard.mjs";

test("only vX.Y.Z is a release tag; candidates and betas are not tags", () => {
  assert.deepEqual(parseTag("v0.2.0"), { base: "0.2.0" });
  for (const bad of ["0.2.0", "v0.2", "v0.2.0-rc.1", "v0.2.0-beta.2", "v0.2.0-x", "v0.2.0.1"])
    assert.equal(parseTag(bad), null, bad);
});

test("the tag must match the version, and a release carries no prerelease label", () => {
  assert.equal(checkVersion("v0.2.0", { version: "0.2.0" }), null);
  assert.match(
    checkVersion("v0.2.0", { version: "0.2.0", prerelease: "rc.1" }) ?? "",
    /no "prerelease"/,
  );
  assert.match(checkVersion("v0.3.0", { version: "0.2.0" }) ?? "", /for 0.3.0 but/);
  assert.match(checkVersion("v0.2.0-rc.1", { version: "0.2.0" }) ?? "", /live on dev/);
});

test("a release may change docs, the site and the changelog, but not what ships", () => {
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
