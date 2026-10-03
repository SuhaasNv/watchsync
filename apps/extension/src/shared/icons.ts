// One small icon set (24 px grid, 2 px strokes) for the popup and the on-page overlay.
// Icons are always decorative: the text beside them says the same thing.

export type IconName =
  | "play"
  | "pause"
  | "ahead"
  | "back"
  | "wait"
  | "ad"
  | "sync"
  | "check"
  | "alert"
  | "live"
  | "title"
  | "leave"
  | "rejoin"
  | "link"
  | "copy"
  | "left"
  | "right"
  | "chat"
  | "close";

interface IconDef {
  d: string;
  /** Filled shapes instead of strokes. */
  fill?: boolean;
}

export const ICONS: Record<IconName, IconDef> = {
  play: {
    d: "M8 5.2v13.6a.6.6 0 0 0 .9.5l10.7-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z",
    fill: true,
  },
  pause: { d: "M7 5h3.2v14H7zM13.8 5H17v14h-3.2z", fill: true },
  ahead: { d: "M3.5 6.6v10.8L11 12zM12.5 6.6v10.8L20 12z", fill: true },
  back: { d: "M20.5 6.6v10.8L13 12zM11.5 6.6v10.8L4 12z", fill: true },
  wait: { d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2" },
  ad: { d: "M4 6.5h16v11H4zM8.5 21h7M10 10l4 2-4 2z" },
  sync: {
    d: "M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1M17.5 3.5v3.4h-3.4M6.5 20.5v-3.4h3.4",
  },
  check: { d: "M5 12.5l4.5 4.5L19 7.5" },
  alert: { d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5.5M12 16.5v.01" },
  live: {
    d: "M12 12h.01M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8",
  },
  title: { d: "M4 5.5h16v13H4zM10.2 9.4v5.2l4.3-2.6z" },
  leave: { d: "M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10M15 16l4-4-4-4M19 12H9.5" },
  rejoin: { d: "M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4" },
  link: {
    d: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  },
  copy: { d: "M9 9h10.5v10.5H9zM5 15V4.5h10.5" },
  left: { d: "M14.5 6l-6 6 6 6" },
  right: { d: "M9.5 6l6 6-6 6" },
  chat: {
    d: "M5.5 5h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 3.5V17h-1a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  },
  close: { d: "M6.5 6.5l11 11M17.5 6.5l-11 11" },
};

const SVG = "http://www.w3.org/2000/svg";

/** An inline SVG element for DOM code (the overlay). */
export function svgIcon(name: IconName, size = 16): SVGSVGElement {
  const { d, fill } = ICONS[name];
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", d);
  if (fill) path.setAttribute("fill", "currentColor");
  else {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
  }
  svg.append(path);
  return svg;
}
