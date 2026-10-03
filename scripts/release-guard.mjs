// Checks a release tag the way Apple treats its builds: a final release is the last release
// candidate, unchanged. Used by .github/workflows/release.yml.
//   vX.Y.Z-beta.N  outside testers, a pre-release
//   vX.Y.Z-rc.N    release candidate: ships as is if nothing blocking turns up
//   vX.Y.Z         final: the last rc with only the "prerelease" label removed
// Usage: node scripts/release-guard.mjs vX.Y.Z[-rc.N]   (run from a checkout with all tags)
// Set RELEASE_GUARD_SKIP_RC=1 for an urgent hotfix that has no candidate (say so in the notes).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TAG = /^v(\d+\.\d+\.\d+)(?:-(beta|rc)\.(\d+))?$/;
const PKG = "apps/extension/package.json";
/** What people receive: the extension, the shared packages and the room service. */
const SHIPPED = ["apps/extension/", "packages/", "services/"];

export function parseTag(tag) {
  const m = TAG.exec(tag);
  if (!m) return null;
  return {
    base: m[1],
    stage: m[2] ?? "final",
    n: m[3] ? Number(m[3]) : null,
    label: m[2] ? `${m[2]}.${m[3]}` : null,
  };
}

/** An error message when the tag and apps/extension/package.json disagree; null when they match. */
export function checkVersion(tag, pkg) {
  const p = parseTag(tag);
  if (!p) return `Tag ${tag} is not vX.Y.Z, vX.Y.Z-beta.N or vX.Y.Z-rc.N.`;
  if (p.base !== pkg.version)
    return `Tag ${tag} is for ${p.base} but ${PKG} says ${pkg.version}. Bump the version or fix the tag.`;
  const have = pkg.prerelease ?? null;
  if (have === p.label) return null;
  return p.label
    ? `${tag} needs "prerelease": "${p.label}" in ${PKG} (it has ${JSON.stringify(have)}).`
    : `A final release has no "prerelease" line in ${PKG} (it has "${have}"). Remove it.`;
}

/** Changed files that would reach people (everything else, like docs and the site, may change). */
export function shippedChanges(files) {
  return files.filter((f) => f !== PKG && SHIPPED.some((dir) => f.startsWith(dir)));
}

/** True when the two package.json files differ in nothing but the "prerelease" label. */
export function sameButLabel(before, after) {
  const strip = ({ prerelease: _drop, ...rest }) => JSON.stringify(rest);
  return strip(before) === strip(after);
}

/** The newest release candidate tag for a version, or null. */
export function latestRc(tags, base) {
  const rcs = tags
    .map((t) => ({ t, p: parseTag(t) }))
    .filter(({ p }) => p && p.base === base && p.stage === "rc")
    .sort((a, b) => b.p.n - a.p.n);
  return rcs[0]?.t ?? null;
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function main(tag) {
  const pkg = JSON.parse(readFileSync(PKG, "utf8"));
  const wrong = checkVersion(tag, pkg);
  if (wrong) return wrong;
  const p = parseTag(tag);
  if (p.stage !== "final") return null;
  const rc = latestRc(git("tag", "-l", `v${p.base}-rc.*`).split("\n").filter(Boolean), p.base);
  if (!rc)
    return process.env.RELEASE_GUARD_SKIP_RC === "1"
      ? null
      : `No release candidate for ${p.base}. Tag v${p.base}-rc.1 first, let it prove itself, then tag the final.`;
  const changed = shippedChanges(git("diff", "--name-only", rc, tag).split("\n").filter(Boolean));
  if (changed.length)
    return `${tag} changes shipped files since ${rc}: ${changed.join(", ")}. A final is the last candidate unchanged: fix it in a new rc.`;
  const before = JSON.parse(git("show", `${rc}:${PKG}`));
  if (!sameButLabel(before, pkg))
    return `${PKG} differs from ${rc} in more than the "prerelease" label. A final is the last candidate unchanged.`;
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2] ?? "";
  const error = main(tag);
  if (error) {
    console.error(`::error::${error}`);
    process.exit(1);
  }
  console.log(`${tag}: ok`);
}
