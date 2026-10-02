// Prints the release notes for one version: its CHANGELOG.md section without the heading and,
// when the build details are given, a "Check this download" section with the commit, the CI run
// and the SHA-256 of every file.
// Usage: node scripts/release-notes.mjs 0.1.0 [CHANGELOG.md]
//          [--checksums SHA256SUMS.txt --commit <sha> --repo-url <url> --run-url <url>]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** The body of `## [version] ...` up to the next `## [`; null when the version has no section. */
export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## ["));
  const notes = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  // Release notes are for people installing WatchSync: planning IDs (BUG-047, DEC-030, US-107)
  // belong in Notion and commits, not here.
  const id = notes.match(/\b(BUG|DEC|US|UC|E)-\d{2,3}\b/);
  if (id) throw new Error(`CHANGELOG ${version} mentions ${id[0]}; describe it in plain words`);
  return notes;
}

/** `sha256sum` output ("<hex>  <file>" per line) as [{ sha256, file }]; throws on anything else. */
export function parseChecksums(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) throw new Error("no checksums");
  return lines.map((line) => {
    const m = /^([0-9a-f]{64}) [ *]([\w.-]+)$/.exec(line.trim());
    if (!m) throw new Error(`not a sha256sum line: ${line}`);
    return { sha256: m[1], file: m[2] };
  });
}

/**
 * Markdown that says where the files came from and how to check them. Kept to the subset the
 * website's release-notes renderer understands: a heading, paragraphs, a list, code and links.
 */
export function verifySection({ checksums, commit, repoUrl, runUrl }) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`not a full commit SHA: ${commit}`);
  for (const url of [repoUrl, runUrl]) {
    if (!/^https:\/\/[^\s()<>"']+$/.test(url)) throw new Error(`not an https URL: ${url}`);
  }
  const repo = new URL(repoUrl).pathname.replace(/^\/|\/$/g, "");
  const zip = checksums.find((c) => c.file === "watchsync-extension.zip") ?? checksums[0];
  const name = zip.file;
  return [
    "### Check this download",
    "",
    `Built by GitHub Actions from commit [${commit.slice(0, 7)}](${repoUrl}/commit/${commit}) on \`main\`. [See the build](${runUrl}).`,
    "",
    "SHA-256 of each file:",
    "",
    ...checksums.map((c) => `- \`${c.file}\`: \`${c.sha256}\``),
    "",
    `To check yours, run \`shasum -a 256 ${name}\` on a Mac or \`certutil -hashfile ${name} SHA256\` on Windows and compare. To check GitHub Actions built it from this repository, run \`gh attestation verify ${name} -R ${repo}\`.`,
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const usage =
    "usage: node scripts/release-notes.mjs <x.y.z> [CHANGELOG.md] [--checksums <file> --commit <sha> --repo-url <url> --run-url <url>]";
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        checksums: { type: "string" },
        commit: { type: "string" },
        "repo-url": { type: "string" },
        "run-url": { type: "string" },
      },
    });
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : e}\n${usage}`);
    process.exit(2);
  }
  const { values, positionals } = parsed;
  const [version, file = "CHANGELOG.md"] = positionals;
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(usage);
    process.exit(2);
  }
  const build = [values.checksums, values.commit, values["repo-url"], values["run-url"]];
  if (build.some(Boolean) && !build.every(Boolean)) {
    console.error(`--checksums, --commit, --repo-url and --run-url go together.\n${usage}`);
    process.exit(2);
  }
  const notes = releaseNotes(readFileSync(file, "utf8"), version);
  if (!notes) {
    console.error(`${file} has no "## [${version}]" section, or it is empty. Add one first.`);
    process.exit(1);
  }
  let out = notes;
  if (values.checksums) {
    try {
      const section = verifySection({
        checksums: parseChecksums(readFileSync(values.checksums, "utf8")),
        commit: values.commit,
        repoUrl: values["repo-url"].replace(/\/$/, ""),
        runUrl: values["run-url"],
      });
      out = `${notes}\n\n${section}`;
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }
  }
  console.log(out);
}
