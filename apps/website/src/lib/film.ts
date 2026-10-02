/**
 * The stand-in "film" in the hero: a train crossing hills at dusk, drawn in SVG.
 * Everything visible is a function of the film position, so three screens showing the
 * same position show the same frame. Geometry is built once at build time.
 */

export const W = 320;
export const H = 180;

/** A ridge that repeats every W units, drawn twice so it can scroll forever. */
export function ridge(base: number, waves: [freq: number, amp: number, phase: number][]): string {
  const pts: string[] = [];
  for (let x = 0; x <= W * 2; x += 4) {
    let y = base;
    for (const [f, a, p] of waves) y += a * Math.sin((x / W) * Math.PI * 2 * f + p);
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return `M0,${H} L${pts.join(" L")} L${W * 2},${H} Z`;
}

export const RIDGES = {
  far: ridge(104, [
    [2, 9, 0.4],
    [5, 4, 1.8],
    [9, 1.6, 0.2],
  ]),
  mid: ridge(126, [
    [3, 7, 2.1],
    [7, 3, 0.7],
  ]),
  near: ridge(150, [
    [2, 6, 1.1],
    [6, 3.5, 2.6],
    [13, 1.2, 0.5],
  ]),
};

/** Deterministic star field. */
export function stars(count: number): { x: number; y: number; r: number }[] {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: count }, () => ({
    x: Math.round(rand() * W * 10) / 10,
    y: Math.round(rand() * 80 * 10) / 10,
    r: Math.round((0.35 + rand() * 0.6) * 100) / 100,
  }));
}

/** Train cars: x offsets within the train group. */
export const CARS = [0, 30, 60, 90, 120];

/** How fast each layer moves, in film units per film second. */
export const SPEED = { far: 1.6, mid: 5, near: 14, train: 18 };

type Rgb = [number, number, number];

function hex(c: string): Rgb {
  const n = Number.parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, k: number): string {
  const [ar, ag, ab] = hex(a);
  const [br, bg, bb] = hex(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * k);
  return `rgb(${m(ar, br)},${m(ag, bg)},${m(ab, bb)})`;
}

/** Dusk to night across the stretch of film the demo shows. */
export const PALETTE = {
  skyTop: ["#1d4350", "#060c12"],
  skyMid: ["#d27a5a", "#13242e"],
  skyLow: ["#ffd08a", "#28414a"],
  far: ["#4b6168", "#1a2a32"],
  mid: ["#2a3d44", "#0f1b20"],
  near: ["#111c21", "#060b0e"],
} as const;

export function nightness(position: number): number {
  const k = (position - 2440) / 150;
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
}
