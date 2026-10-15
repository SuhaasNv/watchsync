// Two copies of WatchSync in one Chrome profile (US-133): an old folder still loaded next to the
// new one, say. Both would run on the same film and fight over it. Finding out needs no
// permission: every copy from v0.3 on announces itself on the page with a marker holding its
// extension ID, and an older copy shows itself by its overlay (the on-page UI), which is not
// ours. A copy that finds another warns once; when both announce, only the one whose ID sorts
// last speaks, so the person is told once, not twice. The page can add a marker too, which
// can only cost a needless warning.
const MARK = "watchsync-copy";
const OVERLAY = "watchsync-overlay";

/** Announces this copy on the page; returns what takes the marker off again. */
export function announce(id: string): () => void {
  const mark = document.createElement(MARK);
  mark.setAttribute("data-id", id);
  mark.hidden = true;
  document.documentElement.append(mark);
  return () => mark.remove();
}

/** Whether this copy is the one that should warn about the others on the page. */
export function shouldWarn(id: string, isOwn: (el: Element) => boolean): boolean {
  const others = [...document.querySelectorAll(MARK)]
    .map((m) => m.getAttribute("data-id"))
    .filter((other): other is string => other !== null && other !== id);
  if (others.length > 0) return others.every((other) => id > other);
  // No marker: an older copy, seen only by its overlay.
  return [...document.querySelectorAll(OVERLAY)].some((o) => !isOwn(o));
}

/**
 * Calls `warn` once, as soon as there is another copy on the page, now or later (a copy that
 * starts after this one still shows up). Returns what stops watching.
 */
export function watchCopies(
  id: string,
  isOwn: (el: Element) => boolean,
  warn: () => void,
): () => void {
  let told = false;
  const check = () => {
    if (told || !shouldWarn(id, isOwn)) return;
    told = true;
    warn();
  };
  check();
  const watcher = new MutationObserver(check);
  watcher.observe(document.documentElement, { childList: true });
  return () => watcher.disconnect();
}
