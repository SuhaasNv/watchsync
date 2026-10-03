import { renderMarkdown } from "../lib/markdown";
import { checksumFor, formatDate, type Release, versionLabel } from "../lib/releases";
import { CHANNEL } from "../lib/site";
import { fetchDevBuild, fetchReleases, GithubError } from "./github";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(href: string, text: string, className: string): HTMLAnchorElement {
  const a = el("a", className, text);
  a.href = href;
  a.rel = "noopener";
  return a;
}

function card(r: Release, latest: boolean, dev = false): HTMLLIElement {
  const li = el("li", "release");
  const meta = el("div", "release-meta");
  const name = el("h3", "release-name", r.name);
  const tag = el("p", "release-tag", [r.tag, formatDate(r.date)].filter(Boolean).join(" · "));
  const badges = el("p", "release-badges");
  if (dev) badges.append(el("span", "badge rc", "Dev build"));
  else {
    if (latest) badges.append(el("span", "badge latest", "Latest"));
    if (r.prerelease) badges.append(el("span", "badge rc", "Release candidate"));
  }

  const links = el("p", "release-links");
  const zip = r.assets.find((a) => a.name.endsWith(".zip"));
  if (zip) {
    const a = link(
      zip.url,
      dev ? "Download this dev build" : `Download ${versionLabel(r.tag)}`,
      "btn primary",
    );
    links.append(a);
  }
  links.append(link(r.url, "On GitHub", "btn ghost"));
  meta.append(name, tag);
  if (badges.childElementCount) meta.append(badges);
  meta.append(links);

  // The SHA-256 from the notes, next to the download it belongs to (scripts/release-notes.mjs).
  const sum = zip ? checksumFor(r.body, zip.name) : null;
  if (zip && sum) {
    const box = el("div", "release-sum");
    box.append(el("p", "release-sum-label", `SHA-256 of ${zip.name}`), el("code", "", sum));
    box.append(link("/install/#check", "How to check your download", "release-sum-how"));
    meta.append(box);
  }

  const notes = el("div", "prose");
  // renderMarkdown escapes the release text before adding its own few tags (see lib/markdown).
  notes.innerHTML = r.body.trim()
    ? renderMarkdown(r.body, { headingOffset: 1 })
    : "<p>No notes for this release.</p>";

  li.append(meta, notes);
  return li;
}

export function initReleases() {
  const root = document.querySelector<HTMLElement>("[data-releases]");
  const list = root?.querySelector<HTMLOListElement>("[data-list]");
  if (!root || !list) return;
  const show = (state: "loading" | "empty" | "error" | "list") => {
    for (const s of root.querySelectorAll<HTMLElement>("[data-state]")) {
      s.hidden = s.dataset.state !== state;
    }
    root.setAttribute("aria-busy", String(state === "loading"));
  };

  // The dev site lists its rolling dev build first, then the published releases.
  const devBuild = CHANNEL === "dev" ? fetchDevBuild().catch(() => null) : Promise.resolve(null);
  Promise.all([fetchReleases(), devBuild])
    .then(([releases, dev]) => {
      if (!releases.length && !dev) return show("empty");
      const cards = releases.map((r, i) => card(r, i === 0));
      if (dev) cards.unshift(card(dev, false, true));
      list.replaceChildren(...cards);
      show("list");
      // The build-time changelog is only a fallback for when GitHub has nothing to show.
      const changelog = document.querySelector<HTMLElement>("[data-changelog]");
      if (changelog) changelog.hidden = true;
    })
    .catch((e: unknown) => {
      const text = root.querySelector<HTMLElement>("[data-error-text]");
      if (text) {
        text.textContent =
          e instanceof GithubError && e.rateLimited
            ? "GitHub is asking us to slow down. Try again in a little while."
            : "We couldn't reach GitHub just now. You may be offline.";
      }
      show("error");
    });
}
