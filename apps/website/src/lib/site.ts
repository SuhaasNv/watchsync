/** Facts the whole site shares. One place, so a new release or URL is a one-line change. */

export const REPO_URL = "https://github.com/SuhaasNv/watchsync";
export const RELEASES_URL = `${REPO_URL}/releases`;
/** "dev" on the testing site (DEC-026), "prod" on watchsync.space. */
export const CHANNEL: "dev" | "prod" = import.meta.env.PUBLIC_CHANNEL === "dev" ? "dev" : "prod";
/** Dev builds live in one rolling pre-release; the public site serves the latest release. */
export const DOWNLOAD_URL =
  CHANNEL === "dev"
    ? `${REPO_URL}/releases/download/dev-latest/watchsync-extension-dev.zip`
    : `${REPO_URL}/releases/latest/download/watchsync-extension.zip`;

/**
 * The Chrome Web Store listing, from PUBLIC_STORE_URL. Only an https address on the store's own
 * hosts counts; anything else (empty, a typo, another site) counts as unset, so a bad value can
 * never send people somewhere else.
 */
export function parseStoreUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.hostname === "chromewebstore.google.com") return url.href;
  const legacy = url.pathname === "/webstore" || url.pathname.startsWith("/webstore/");
  if (url.hostname === "chrome.google.com" && legacy) return url.href;
  return null;
}

/**
 * Set once the listing is approved. The dev site always keeps the WatchSync Dev zip, so friends
 * can test builds the store doesn't have yet.
 */
export const STORE_URL: string | null =
  CHANNEL === "dev" ? null : parseStoreUrl(import.meta.env.PUBLIC_STORE_URL);
/** True when installs go through the Chrome Web Store; false for the zip and Developer mode. */
export const FROM_STORE: boolean = STORE_URL !== null;
export const RELEASES_API = "https://api.github.com/repos/SuhaasNv/watchsync/releases?per_page=20";

/** Shown until (or instead of, when GitHub can't be reached) the live release label. */
export const FALLBACK_VERSION = CHANNEL === "dev" ? "Dev build" : "v0.2.1";

export const OPERATOR = "Suhaas Nv";
export const CONTACT_EMAIL = "suhaasnvs@gmail.com";

export const NOT_AFFILIATED = "Not affiliated with Netflix, Amazon or JioStar";

export interface NavLink {
  href: string;
  label: string;
}

export const NAV: NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/features/", label: "Features" },
  { href: "/install/", label: "Install" },
  { href: "/releases/", label: "Release notes" },
  { href: "/faq/", label: "FAQ" },
];
