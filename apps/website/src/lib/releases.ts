/** GitHub releases, read from untrusted JSON without casts. */

export interface ReleaseAsset {
  name: string;
  url: string;
}

export interface Release {
  name: string;
  tag: string;
  /** ISO date, or null when GitHub hasn't published it. */
  date: string | null;
  body: string;
  url: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Only https links on GitHub's own hosts make it into an href. */
export function safeGithubUrl(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  try {
    const u = new URL(s);
    const ok =
      u.protocol === "https:" &&
      (u.hostname === "github.com" || u.hostname.endsWith(".github.com"));
    return ok ? u.href : null;
  } catch {
    return null;
  }
}

function parseAsset(value: unknown): ReleaseAsset | null {
  if (!isRecord(value)) return null;
  const name = str(value.name);
  const url = safeGithubUrl(value.browser_download_url);
  return name && url ? { name, url } : null;
}

function parseRelease(value: unknown): Release | null {
  if (!isRecord(value) || value.draft === true) return null;
  const tag = str(value.tag_name);
  const url = safeGithubUrl(value.html_url);
  // The rolling dev build (DEC-026) is for testers, not a release with notes.
  if (!tag || !url || tag === "dev-latest") return null;
  const assets = Array.isArray(value.assets)
    ? value.assets.map(parseAsset).filter((a): a is ReleaseAsset => a !== null)
    : [];
  return {
    name: str(value.name)?.trim() || tag,
    tag,
    date: str(value.published_at) ?? str(value.created_at),
    body: str(value.body) ?? "",
    url,
    prerelease: value.prerelease === true || isCandidate(tag),
    assets,
  };
}

export function parseReleases(json: unknown): Release[] {
  if (!Array.isArray(json)) return [];
  return json.map(parseRelease).filter((r): r is Release => r !== null);
}

export function isCandidate(tag: string): boolean {
  return /-rc/i.test(tag);
}

/** "v0.1.0-rc.1" becomes "v0.1.0 release candidate"; a final tag stays as it is. */
export function versionLabel(tag: string): string {
  const base = tag.replace(/-rc.*$/i, "");
  return isCandidate(tag) ? `${base} release candidate` : tag;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
