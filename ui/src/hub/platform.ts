/** Reliable OS detection inside Tauri WebViews (do not trust UA alone). */

export type HubPlatform = "windows" | "macos" | "linux" | "unknown";

type NavigatorUaData = {
  platform?: string;
};

function fromPlatformString(p: string): HubPlatform {
  const s = p.toLowerCase();
  if (s.includes("win")) return "windows";
  if (s.includes("mac") || s.includes("darwin")) return "macos";
  if (s.includes("linux")) return "linux";
  return "unknown";
}

export async function detectPlatform(): Promise<HubPlatform> {
  // Prefer userAgentData.platform (Chromium/WebView2) over legacy UA strings.
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUaData }).userAgentData;
  const fromUaData = fromPlatformString(uaData?.platform ?? "");
  if (fromUaData !== "unknown") return fromUaData;

  const fromNav = fromPlatformString(navigator.platform ?? "");
  if (fromNav !== "unknown") return fromNav;

  return fromPlatformString(navigator.userAgent);
}

export function detectPlatformSync(): HubPlatform {
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUaData }).userAgentData;
  const fromUaData = fromPlatformString(uaData?.platform ?? "");
  if (fromUaData !== "unknown") return fromUaData;
  const fromNav = fromPlatformString(navigator.platform ?? "");
  if (fromNav !== "unknown") return fromNav;
  return fromPlatformString(navigator.userAgent);
}

export function isWindowsSyncFallback(): boolean {
  return detectPlatformSync() === "windows";
}
