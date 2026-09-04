import type { CSSProperties } from "react";

// Tiny inline-SVG icon set (no icon libraries). Stroke-based, inherits
// currentColor so callers control tint via `style.color`.

export type IconName =
  | "home"
  | "insights"
  | "dictionary"
  | "snippets"
  | "style"
  | "transforms"
  | "scratchpad"
  | "settings"
  | "help"
  | "search"
  | "sort"
  | "plus"
  | "close"
  | "mic"
  | "sparkles"
  | "book"
  | "cloud"
  | "shield"
  | "keyboard"
  | "archive"
  | "check"
  | "lock"
  | "shortcuts"
  | "user"
  | "panelLeft"
  | "panelRight";

const PATHS: Record<IconName, string[]> = {
  home: ["M4 11l8-7 8 7", "M6 10v10h12V10"],
  insights: ["M4 20h16", "M8 20v-6", "M12 20V6", "M16 20v-9"],
  dictionary: [
    "M12 7c-1.8-1.2-4-1.5-6-1v11c2-.5 4.2-.2 6 1 1.8-1.2 4-1.5 6-1V6c-2-.5-4.2-.2-6 1z",
    "M12 7v12",
  ],
  snippets: ["M8 8l-4 4 4 4", "M16 8l4 4-4 4"],
  style: ["M4 20L14 10", "M15.2 4.8l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z"],
  transforms: ["M7 5L4 8l3 3", "M4 8h11a3 3 0 0 1 3 3", "M17 19l3-3-3-3", "M20 16H9a3 3 0 0 1-3-3"],
  scratchpad: ["M4 20l1-4L15 5l3 3L8 19l-4 1z", "M13 7l3 3"],
  settings: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-2.9-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.1-2.9H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.1-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.1V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-1.1 2.9H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4.9z",
  ],
  help: [
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
    "M9.6 9.2a2.5 2.5 0 0 1 4.9.8c0 1.7-2.5 2-2.5 3.4",
    "M12 17.4h.01",
  ],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-3.6-3.6"],
  sort: ["M5 7h14", "M7 12h10", "M9 17h6"],
  plus: ["M12 5v14", "M5 12h14"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  mic: ["M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z", "M6 11a6 6 0 0 0 12 0", "M12 17v4"],
  sparkles: [
    "M12 4l1.5 4.5L18 10l-4.5 1.5L12 16l-1.5-4.5L6 10l4.5-1.5z",
    "M19 4l.8 2.2L22 7l-2.2.8L19 10l-.8-2.2L16 7l2.2-.8z",
    "M5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8z",
  ],
  book: ["M6 4h11a3 3 0 0 1 3 3v13H8a2 2 0 0 0-2 2V4z", "M8 20V6h12"],
  cloud: ["M7 18h9a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 6.4 8.5 3.5 3.5 0 0 0 7 18z"],
  shield: ["M12 3l7 3v6c0 5-3.1 8.9-7 10-3.9-1.1-7-5-7-10V6l7-3z", "M9.5 12l1.9 1.9L15 10.3"],
  keyboard: ["M4 7h16v10H4z", "M7 10h.01", "M10 10h.01", "M14 10h.01", "M17 10h.01", "M7 13h10"],
  archive: ["M4 7h16v4H4z", "M6 11v8h12v-8", "M10 14h4"],
  check: ["M5 12l4 4 10-10"],
  lock: ["M7 11V8a5 5 0 0 1 10 0v3", "M6 11h12v9H6z", "M12 15v2"],
  shortcuts: ["M4 6h16v12H4z", "M7 10h.01", "M11 10h.01", "M15 10h.01", "M7 14h10"],
  user: ["M20 21a8 8 0 0 0-16 0", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  panelLeft: ["M4 4h16v16H4z", "M9 4v16", "M6.5 10l-2 2 2 2"],
  panelRight: ["M4 4h16v16H4z", "M15 4v16", "M17.5 10l2 2-2 2"],
};

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.7,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "0 0 auto", ...style }}
      aria-hidden
    >
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
