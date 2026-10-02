import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseChecksums, releaseNotes, verifySection } from "./release-notes.mjs";

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

const SHA_A = "a".repeat(64);
const SHA_B = "0123456789abcdef".repeat(4);
const COMMIT = "4d101475d8b20a2381f78447822ac1eab6504dd8";
const REPO = "https://github.com/SuhaasNv/watchsync";
const RUN = `${REPO}/actions/runs/123/attempts/1`;
const SUMS = `${SHA_A}  watchsync-extension.zip\n${SHA_A}  watchsync-extension-v0.1.0.zip\n`;

test("reads sha256sum output, in text and binary mode, and rejects anything else", () => {
  assert.deepEqual(parseChecksums(`${SHA_A}  a.zip\n${SHA_B} *b-v1.zip\n`), [
    { sha256: SHA_A, file: "a.zip" },
    { sha256: SHA_B, file: "b-v1.zip" },
  ]);
  assert.throws(() => parseChecksums(""), /no checksums/);
  assert.throws(() => parseChecksums(`${SHA_A.slice(1)}  a.zip`), /not a sha256sum line/);
  assert.throws(() => parseChecksums(`${SHA_A}  a zip`), /not a sha256sum line/);
});

test("the check section names the commit, the build and every checksum", () => {
  const section = verifySection({
    checksums: parseChecksums(SUMS),
    commit: COMMIT,
    repoUrl: REPO,
    runUrl: RUN,
  });
  assert.match(section, /^### Check this download$/m);
  assert.ok(
    section.includes(
      `Built by GitHub Actions from commit [4d10147](${REPO}/commit/${COMMIT}) on \`main\`. [See the build](${RUN}).`,
    ),
  );
  assert.ok(section.includes(`- \`watchsync-extension.zip\`: \`${SHA_A}\``));
  assert.ok(section.includes(`- \`watchsync-extension-v0.1.0.zip\`: \`${SHA_A}\``));
  assert.ok(section.includes("`shasum -a 256 watchsync-extension.zip`"));
  assert.ok(section.includes("`certutil -hashfile watchsync-extension.zip SHA256`"));
  assert.ok(
    section.includes("`gh attestation verify watchsync-extension.zip -R SuhaasNv/watchsync`"),
  );
});

test("the check section refuses a short commit or a non-https link", () => {
  const checksums = parseChecksums(SUMS);
  assert.throws(
    () => verifySection({ checksums, commit: "4d10147", repoUrl: REPO, runUrl: RUN }),
    /full commit SHA/,
  );
  assert.throws(
    () => verifySection({ checksums, commit: COMMIT, repoUrl: REPO, runUrl: "http://x/run" }),
    /https URL/,
  );
});

test("the command appends the check section only when every build detail is given", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "release-notes-"));
  try {
    const file = path.join(dir, "CHANGELOG.md");
    const sums = path.join(dir, "SHA256SUMS.txt");
    writeFileSync(file, CHANGELOG);
    writeFileSync(sums, SUMS);
    const build = [
      "--checksums",
      sums,
      "--commit",
      COMMIT,
      "--repo-url",
      `${REPO}/`,
      "--run-url",
      RUN,
    ];
    const out = execFileSync(process.execPath, [SCRIPT, "0.2.0", file, ...build], {
      encoding: "utf8",
    });
    assert.ok(out.startsWith("### Added\n- Chat.\n\n### Check this download\n"));
    assert.ok(out.includes(`(${REPO}/commit/${COMMIT})`));
    const partial = spawnSync(process.execPath, [SCRIPT, "0.2.0", file, "--commit", COMMIT], {
      encoding: "utf8",
    });
    assert.equal(partial.status, 2);
    assert.match(partial.stderr, /go together/);
    writeFileSync(sums, "not a checksum\n");
    const broken = spawnSync(process.execPath, [SCRIPT, "0.2.0", file, ...build], {
      encoding: "utf8",
    });
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /not a sha256sum line/);
    const unknown = spawnSync(process.execPath, [SCRIPT, "0.2.0", file, "--nope"], {
      encoding: "utf8",
    });
    assert.equal(unknown.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses notes that mention planning IDs", () => {
  const log = "# Changelog\n\n## [0.1.0] - 2026-10-03\n\n### Fixed\n- BUG-047: the room moved.\n";
  assert.throws(() => releaseNotes(log, "0.1.0"), /mentions BUG-047/);
  assert.equal(
    releaseNotes(log.replace("BUG-047: t", "T"), "0.1.0"),
    "### Fixed\n- The room moved.",
  );
});

test("the real changelog's 0.1.0 notes have no planning IDs", () => {
  const real = new URL("../CHANGELOG.md", import.meta.url);
  assert.ok(releaseNotes(readFileSync(real, "utf8"), "0.1.0"));
});
