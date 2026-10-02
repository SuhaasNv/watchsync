/**
 * Install guide progress: a step's big number fills in once you have scrolled to it, and
 * stays filled for the steps above, so the numbers show how far down the guide you are.
 */
export function initStepsProgress() {
  if (!("IntersectionObserver" in window)) return;
  const steps = document.querySelectorAll<HTMLElement>(".guide .step");
  if (!steps.length) return;
  // Watch the top half of the screen: a step counts as reached while any part of it is
  // there, and once it has scrolled past the top.
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const reached = e.isIntersecting || e.boundingClientRect.top < 0;
        e.target.toggleAttribute("data-reached", reached);
      }
    },
    { rootMargin: "0px 0px -50% 0px" },
  );
  for (const s of steps) io.observe(s);
}
