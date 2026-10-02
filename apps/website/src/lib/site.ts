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
export const RELEASES_API = "https://api.github.com/repos/SuhaasNv/watchsync/releases?per_page=20";

/** Shown until (or instead of, when GitHub can't be reached) the live release label. */
export const FALLBACK_VERSION = CHANNEL === "dev" ? "Dev build" : "v0.1.0 release candidate";

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
