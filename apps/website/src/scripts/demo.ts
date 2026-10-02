import {
  CURSOR,
  type CursorMove,
  clock,
  type DemoState,
  DURATION,
  LOOP,
  STEPS,
  stateAt,
  type Who,
} from "../lib/demo-script";
import { mix, nightness, PALETTE, SPEED, W } from "../lib/film";

interface ScreenEls {
  root: HTMLElement;
  notice: HTMLElement;
  fill: HTMLElement;
  head: HTMLElement;
  time: HTMLElement;
  adLeft: HTMLElement | null;
  play: HTMLElement;
  track: HTMLElement;
  faces: Map<Who, HTMLElement>;
}

const WHO: Who[] = ["suhaas", "asha", "ravi"];
const isWho = (v: string | undefined): v is Who => v === "suhaas" || v === "asha" || v === "ravi";

function req<T extends Element>(root: ParentNode, selector: string, type: new () => T): T {
  const el = root.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`demo: missing ${selector}`);
  return el;
}

function ease(k: number): number {
  const c = Math.min(1, Math.max(0, k));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

/** Draws the film at a position: one symbol, so every screen changes at once. */
function filmPainter() {
  const byId = (id: string) => document.getElementById(id);
  const sky = [byId("ws-sky0"), byId("ws-sky1"), byId("ws-sky2")];
  const stars = byId("ws-stars");
  const sun = byId("ws-sun");
  const far = byId("ws-far");
  const mid = byId("ws-mid");
  const near = byId("ws-near");
  const train = byId("ws-train");
  let last = Number.NaN;

  return (position: number) => {
    if (position === last) return;
    last = position;
    const n = nightness(position);
    const skyKeys = ["skyTop", "skyMid", "skyLow"] as const;
    sky.forEach((stop, i) => {
      const key = skyKeys[i];
      if (stop && key) stop.setAttribute("stop-color", mix(PALETTE[key][0], PALETTE[key][1], n));
    });
    stars?.setAttribute("opacity", String(Math.max(0, n * 1.3 - 0.3).toFixed(2)));
    sun?.setAttribute("transform", `translate(${212 - n * 18} ${92 + n * 70})`);
    const scroll = (el: HTMLElement | null, speed: number) =>
      el?.setAttribute("transform", `translate(${-((position * speed) % W).toFixed(2)} 0)`);
    scroll(far, SPEED.far);
    scroll(mid, SPEED.mid);
    scroll(near, SPEED.near);
    far?.setAttribute("fill", mix(PALETTE.far[0], PALETTE.far[1], n));
    mid?.setAttribute("fill", mix(PALETTE.mid[0], PALETTE.mid[1], n));
    near?.setAttribute("fill", mix(PALETTE.near[0], PALETTE.near[1], n));
    // The train crosses right to left every 30 film seconds.
    const x = W + 20 - ((position * SPEED.train) % (W + 200));
    train?.setAttribute("transform", `translate(${x.toFixed(2)} 0)`);
  };
}

export function startDemo(root: HTMLElement) {
  const stage = req(root, ".stage", HTMLElement);
  const cursor = req(root, "[data-cursor]", HTMLElement);
  const ripple = req(cursor, ".ripple", HTMLElement);
  const toggle = req(root, "[data-toggle]", HTMLButtonElement);
  const toggleLabel = req(root, "[data-toggle-label]", HTMLElement);
  const caption = req(root, "[data-caption]", HTMLElement);
  const stepButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-step]")];

  const screens = new Map<Who, ScreenEls>();
  for (const who of WHO) {
    const el = req(root, `[data-screen="${who}"]`, HTMLElement);
    const faces = new Map<Who, HTMLElement>();
    for (const f of el.querySelectorAll<HTMLElement>("[data-face]")) {
      if (isWho(f.dataset.face)) faces.set(f.dataset.face, f);
    }
    screens.set(who, {
      root: el,
      notice: req(el, "[data-notice]", HTMLElement),
      fill: req(el, "[data-fill]", HTMLElement),
      head: req(el, "[data-head]", HTMLElement),
      time: req(el, "[data-time]", HTMLElement),
      adLeft: el.querySelector<HTMLElement>("[data-ad-left]"),
      play: req(el, "[data-play]", HTMLElement),
      track: req(el, "[data-track]", HTMLElement),
      faces,
    });
  }

  const paint = filmPainter();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  let t = 0;
  let userPaused = reduce.matches;
  let visible = false;
  let frame = 0;
  let prev = 0;
  let lastTime = "";
  let lastStep = -1;

  function setToggle() {
    toggle.setAttribute("aria-pressed", String(userPaused));
    toggleLabel.textContent = userPaused ? "Play demo" : "Pause demo";
  }

  function renderScreens(s: DemoState) {
    const frac = s.position / DURATION;
    const time = clock(s.position);
    for (const [who, el] of screens) {
      const sc = s.screens[who];
      el.root.classList.toggle("paused", !s.playing);
      el.root.classList.toggle("on-ad", sc.ad !== null);
      el.root.classList.toggle("is-loading", sc.loading);
      if (el.adLeft && sc.ad !== null) el.adLeft.textContent = clock(sc.ad);
      el.fill.style.transform = `scaleX(${frac})`;
      el.head.style.transform = `translateX(${frac * 100}%)`;
      if (time !== lastTime) el.time.textContent = time;
      if (sc.notice) {
        if (el.notice.textContent !== sc.notice.text) el.notice.textContent = sc.notice.text;
        el.notice.classList.toggle("wait", sc.notice.kind === "wait");
      }
      el.notice.classList.toggle("show", sc.notice !== null);
      for (const [id, face] of el.faces) {
        face.classList.toggle("synced", s.synced[id]);
      }
    }
    lastTime = time;
  }

  function targetPoint(move: CursorMove): { x: number; y: number } | null {
    const el = screens.get(move.screen);
    if (!el) return null;
    const box = stage.getBoundingClientRect();
    if (move.target === "play") {
      const r = el.play.getBoundingClientRect();
      return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
    }
    const r = el.track.getBoundingClientRect();
    return { x: r.left - box.left + r.width * move.target, y: r.top - box.top + r.height / 2 };
  }

  function renderCursor() {
    const move = CURSOR.find((m) => t >= m.start && t <= m.leave + 0.4);
    if (!move) {
      cursor.style.opacity = "0";
      return;
    }
    const to = targetPoint(move);
    if (!to) return;
    const k = ease((t - move.start) / (move.arrive - move.start));
    const from = { x: to.x + 70, y: to.y + 60 };
    const x = from.x + (to.x - from.x) * k;
    const y = from.y + (to.y - from.y) * k;
    const fadeIn = Math.min(1, (t - move.start) / 0.25);
    const fadeOut = 1 - Math.min(1, Math.max(0, (t - move.leave) / 0.4));
    cursor.style.opacity = String(Math.min(fadeIn, fadeOut));
    // The arrow's tip is at (5, 3) in its 24px box.
    cursor.style.transform = `translate(${x - 5}px, ${y - 3}px)`;
    const since = t - move.click;
    const r = since >= 0 && since < 0.5 ? since / 0.5 : -1;
    ripple.style.opacity = r < 0 ? "0" : String(1 - r);
    ripple.style.transform = `scale(${r < 0 ? 0.3 : 0.3 + r * 0.9})`;
  }

  function render() {
    const s = stateAt(t);
    paint(s.position);
    renderScreens(s);
    renderCursor();
    if (s.step !== lastStep) {
      lastStep = s.step;
      caption.textContent = STEPS[s.step]?.caption ?? "";
      stepButtons.forEach((b, i) => {
        if (i === s.step) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
      });
    }
  }

  function tick(now: number) {
    frame = 0;
    const dt = Math.min(0.1, (now - prev) / 1000);
    prev = now;
    t += dt;
    if (t >= LOOP) {
      t = 0;
      // A quick fade while the film rewinds, so the loop doesn't read as a skip.
      for (const el of screens.values()) el.root.classList.add("rewinding");
      setTimeout(() => {
        for (const el of screens.values()) el.root.classList.remove("rewinding");
      }, 350);
    }
    render();
    schedule();
  }

  function schedule() {
    const run = visible && !userPaused && !document.hidden;
    if (run && !frame) {
      prev = performance.now();
      frame = requestAnimationFrame(tick);
    } else if (!run && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  toggle.addEventListener("click", () => {
    userPaused = !userPaused;
    setToggle();
    schedule();
  });

  stepButtons.forEach((b, i) => {
    b.addEventListener("click", () => {
      const step = STEPS[i];
      if (!step) return;
      // Playing: start the step from its beginning. Paused or reduced motion: show its still.
      const running = !userPaused;
      t = running ? step.at : step.still;
      render();
    });
  });

  reduce.addEventListener("change", () => {
    if (reduce.matches) userPaused = true;
    setToggle();
    if (reduce.matches) t = STEPS[lastStep]?.still ?? t;
    render();
    schedule();
  });

  new IntersectionObserver(
    ([entry]) => {
      visible = entry?.isIntersecting ?? false;
      schedule();
    },
    { threshold: 0.15 },
  ).observe(stage);

  document.addEventListener("visibilitychange", schedule);

  if (reduce.matches) t = STEPS[0]?.still ?? 0;
  setToggle();
  render();
}
