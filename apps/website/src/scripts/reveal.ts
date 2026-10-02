/**
 * Adds `.in` to each [data-reveal] section once it is on screen, which starts its one-time
 * CSS animation. With no IntersectionObserver everything is shown at once.
 */
export function revealOnView() {
  // Sections only start hidden once this runs, so without JavaScript nothing is hidden.
  document.documentElement.classList.add("js");
  const targets = document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (!("IntersectionObserver" in window)) {
    for (const t of targets) t.classList.add("in");
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        e.target.dispatchEvent(new CustomEvent("reveal"));
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -20% 0px" },
  );
  for (const t of targets) io.observe(t);
}
