import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { releaseNotes } from "./release-notes.mjs";

const SCRIPT = fileURLToPath(new URL("./release-notes.mjs", import.meta.url));
const CHANGELOG = `# Changelog

## [0.2.0] - Unreleased

### Added
- Chat.

## [0.1.0] - 2 October 2026

Streaming Sync.

### Added
- Rooms.

### Known issues
- Ads on Prime Video only.

## [0.0.1] - 1 September 2026

### Added
- Spike.
`;

test("picks the matching section without its heading", () => {
  assert.equal(
    releaseNotes(CHANGELOG, "0.1.0"),
    "Streaming Sync.\n\n### Added\n- Rooms.\n\n### Known issues\n- Ads on Prime Video only.",
  );
});

test("stops at the next version heading, and runs to the end for the last one", () => {
  assert.equal(releaseNotes(CHANGELOG, "0.2.0"), "### Added\n- Chat.");
  assert.equal(releaseNotes(CHANGELOG, "0.0.1"), "### Added\n- Spike.");
});

test("a missing version has no notes, and 0.1 does not match 0.1.0", () => {
  assert.equal(releaseNotes(CHANGELOG, "0.3.0"), null);
  assert.equal(releaseNotes(CHANGELOG, "0.1"), null);
});

test("the command prints the notes, and fails on a missing version or bad input", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "release-notes-"));
  try {
    const file = path.join(dir, "CHANGELOG.md");
    writeFileSync(file, CHANGELOG);
    const out = execFileSync(process.execPath, [SCRIPT, "0.2.0", file], { encoding: "utf8" });
    assert.equal(out, "### Added\n- Chat.\n");
    const missing = spawnSync(process.execPath, [SCRIPT, "9.9.9", file], { encoding: "utf8" });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /no "## \[9\.9\.9\]" section/);
    const bad = spawnSync(process.execPath, [SCRIPT, "v0.1.0-rc.1", file], { encoding: "utf8" });
    assert.equal(bad.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
