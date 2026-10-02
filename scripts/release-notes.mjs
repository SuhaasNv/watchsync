// Prints the CHANGELOG.md section for one version, without its heading, for a GitHub Release.
// Usage: node scripts/release-notes.mjs 0.1.0 [path/to/CHANGELOG.md]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The body of `## [version] ...` up to the next `## [`; null when the version has no section. */
export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## ["));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, file = "CHANGELOG.md"] = process.argv.slice(2);
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error("usage: node scripts/release-notes.mjs <x.y.z> [CHANGELOG.md]");
    process.exit(2);
  }
  const notes = releaseNotes(readFileSync(file, "utf8"), version);
  if (!notes) {
    console.error(`${file} has no "## [${version}]" section, or it is empty. Add one first.`);
    process.exit(1);
  }
  console.log(notes);
}
