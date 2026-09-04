// Hub theme, driven by CSS custom properties so a single `data-theme` flip on
// <html> re-themes the whole app (every component reads these via inline
// `var(--wf-*)`, so no per-component rewiring is needed).
//
// Light is the warm cream + teal identity. Dark reuses the cohesive cool-slate
// scale of the floating pill, keeping the teal accent for continuity.

export type ThemeMode = "light" | "dark";

// Consumers keep using `theme.pageBg` etc.; each value resolves to a live CSS var.
type Keys =
  | "pageBg" | "sidebarBg" | "sidebarGradient" | "cardBg" | "cardBgSubtle" | "track" | "hover"
  | "border" | "borderStrong"
  | "textStrong" | "textBody" | "textMuted" | "textFaint"
  | "accent" | "accentDeep" | "accentBright" | "accentSoft" | "accentSoftHover" | "accentSoftBorder"
  | "shadow" | "shadowSoft"
  | "bannerFrom" | "bannerVia" | "bannerTo"
  | "solidBg" | "solidText";

const KEYS: Keys[] = [
  "pageBg", "sidebarBg", "sidebarGradient", "cardBg", "cardBgSubtle", "track", "hover",
  "border", "borderStrong",
  "textStrong", "textBody", "textMuted", "textFaint",
  "accent", "accentDeep", "accentBright", "accentSoft", "accentSoftHover", "accentSoftBorder",
  "shadow", "shadowSoft",
  "bannerFrom", "bannerVia", "bannerTo",
  "solidBg", "solidText",
];

export const theme = Object.fromEntries(KEYS.map((k) => [k, `var(--wf-${k})`])) as Record<Keys, string>;

const LIGHT: Record<Keys, string> = {
  pageBg: "#F6F4EF",
  sidebarBg: "#F1ECE3",
  sidebarGradient: "linear-gradient(165deg, #F7F2E9 0%, #EEF3EF 48%, #E6F4F0 100%)",
  cardBg: "#FFFFFF",
  cardBgSubtle: "#FBFAF7",
  track: "#ECE7DD",
  hover: "#F1EDE5",
  border: "#E7E1D6",
  borderStrong: "#DAD3C6",
  textStrong: "#111419",
  textBody: "#1C212A",
  textMuted: "#5A6675",
  textFaint: "#8A93A3",
  accent: "#22C3B6",
  accentDeep: "#12A99D",
  accentBright: "#3FE0D0",
  accentSoft: "rgba(34,195,182,0.12)",
  accentSoftHover: "rgba(34,195,182,0.18)",
  accentSoftBorder: "rgba(34,195,182,0.30)",
  shadow: "0 1px 2px rgba(17,20,25,0.04), 0 6px 20px rgba(17,20,25,0.05)",
  shadowSoft: "0 1px 2px rgba(17,20,25,0.05)",
  bannerFrom: "#111419",
  bannerVia: "#1C212A",
  bannerTo: "#28303B",
  solidBg: "#17181C",
  solidText: "#F7F9FB",
};

const DARK: Record<Keys, string> = {
  pageBg: "#0F1217",
  sidebarBg: "#0B0E12",
  sidebarGradient: "linear-gradient(165deg, #111823 0%, #0C151A 48%, #0B1216 100%)",
  cardBg: "#171B22",
  cardBgSubtle: "#13161C",
  track: "#1E232C",
  hover: "#1B212A",
  border: "#272D38",
  borderStrong: "#3A424F",
  textStrong: "#F3F6F9",
  textBody: "#CDD4DE",
  textMuted: "#93A0B0",
  textFaint: "#6A7585",
  accent: "#3FE0D0",
  accentDeep: "#34D6C7",
  accentBright: "#6BF0E2",
  accentSoft: "rgba(63,224,208,0.14)",
  accentSoftHover: "rgba(63,224,208,0.22)",
  accentSoftBorder: "rgba(63,224,208,0.34)",
  shadow: "0 1px 2px rgba(0,0,0,0.5), 0 8px 26px rgba(0,0,0,0.55)",
  shadowSoft: "0 1px 2px rgba(0,0,0,0.55)",
  bannerFrom: "#0C0E12",
  bannerVia: "#141821",
  bannerTo: "#222A34",
  solidBg: "#F2F5F8",
  solidText: "#0F1217",
};

const toVars = (m: Record<Keys, string>) => KEYS.map((k) => `--wf-${k}: ${m[k]};`).join(" ");

// Injected once (see main.tsx). Light is the default; [data-theme="dark"] overrides.
export const THEME_CSS = `
  :root { color-scheme: light; ${toVars(LIGHT)} }
  :root[data-theme="dark"] { color-scheme: dark; ${toVars(DARK)} }
  :root { transition: none; }
`;

const STORAGE_KEY = "whimpr:appearance";

export function getStoredTheme(): ThemeMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable; theme still applies for this session */
  }
}

/** Apply the persisted theme immediately (call before first render to avoid a flash). */
export function applyStoredTheme(): void {
  document.documentElement.dataset.theme = getStoredTheme();
}
