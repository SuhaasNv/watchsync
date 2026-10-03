// Checks a release tag. Main only ever carries finished versions: release candidates and betas
// exist on dev (the "prerelease" label in apps/extension/package.json, shown as
// "0.2.0-rc.1 dev <commit>" in the dev build), never as tags on main. A release is the dev build
// that was tested, with the label removed. Used by .github/workflows/release.yml.
//   vX.Y.Z  the only tag: no "prerelease" label, and the shipped files equal the dev commit that
//           was merged into main (the last merge's second parent); only the label may differ.
// Usage: node scripts/release-guard.mjs vX.Y.Z   (run from a checkout with full history)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TAG = /^v(\d+\.\d+\.\d+)$/;
const PKG = "apps/extension/package.json";
/** What people receive: the extension, the shared packages and the room service. */
const SHIPPED = ["apps/extension/", "packages/", "services/"];

export function parseTag(tag) {
  const m = TAG.exec(tag);
  return m ? { base: m[1] } : null;
}

/** An error message when the tag and apps/extension/package.json disagree; null when they match. */
export function checkVersion(tag, pkg) {
  const p = parseTag(tag);
  if (!p)
    return `Tag ${tag} is not vX.Y.Z. Release candidates and betas live on dev, not as tags on main.`;
  if (p.base !== pkg.version)
    return `Tag ${tag} is for ${p.base} but ${PKG} says ${pkg.version}. Bump the version or fix the tag.`;
  if (pkg.prerelease)
    return `A release has no "prerelease" line in ${PKG} (it has "${pkg.prerelease}"). Remove it in the release commit.`;
  return null;
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

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function main(tag) {
  const pkg = JSON.parse(readFileSync(PKG, "utf8"));
  const wrong = checkVersion(tag, pkg);
  if (wrong) return wrong;
  // The dev commit that was tested: the second parent of the last merge on main's own line.
  const merge = git("log", "--first-parent", "--merges", "-1", "--format=%H", tag);
  const tested = merge ? git("rev-parse", `${merge}^2`) : "";
  if (!tested) return `${tag} has no merge from dev behind it. Merge dev into main, then tag.`;
  const changed = shippedChanges(
    git("diff", "--name-only", tested, tag).split("\n").filter(Boolean),
  );
  if (changed.length)
    return `${tag} changes shipped files since the dev build it was merged from (${tested.slice(0, 7)}): ${changed.join(", ")}. A release is the tested dev build with only the label removed: fix it on dev and merge again.`;
  const before = JSON.parse(git("show", `${tested}:${PKG}`));
  if (!sameButLabel(before, pkg))
    return `${PKG} differs from the dev build ${tested.slice(0, 7)} in more than the "prerelease" label.`;
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
