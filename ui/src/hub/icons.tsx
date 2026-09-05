import type { CSSProperties } from "react";

// Tiny inline-SVG icon set (no icon libraries). Stroke-based, inherits
// currentColor so callers control tint via `style.color`.

export type IconName =
  | "history"
  | "insights"
  | "dictionary"
  | "style"
  | "settings"
  | "help"
  | "plus"
  | "close"
  | "copy";

const PATHS: Record<IconName, string[]> = {
  history: ["M12 21a9 9 0 1 0-9-9", "M3 4v5h5", "M12 7v5l3 2"],
  insights: ["M4 20h16", "M8 20v-6", "M12 20V6", "M16 20v-9"],
  dictionary: [
    "M12 7c-1.8-1.2-4-1.5-6-1v11c2-.5 4.2-.2 6 1 1.8-1.2 4-1.5 6-1V6c-2-.5-4.2-.2-6 1z",
    "M12 7v12",
  ],
  style: ["M4 20L14 10", "M15.2 4.8l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z"],
  settings: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-2.9-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.1-2.9H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.1-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.1V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-1.1 2.9H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4.9z",
  ],
  help: [
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
    "M9.6 9.2a2.5 2.5 0 0 1 4.9.8c0 1.7-2.5 2-2.5 3.4",
    "M12 17.4h.01",
  ],
  plus: ["M12 5v14", "M5 12h14"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  copy: ["M9 9h10v10H9z", "M5 15V5h10"],
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
