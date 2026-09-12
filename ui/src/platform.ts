import { useEffect, useState } from "react";

// Which OS the app is running on, driven by Rust (`get_platform` →
// `std::env::consts::OS`). "other" covers Linux and any unknown target.
export type Platform = "macos" | "windows" | "linux" | "other";

/// Synchronous guess from the webview's own UA data, so the UI can render the
/// right labels before the async command resolves (no Mac-symbol flash on
/// Windows, no "Right Control" flash on macOS). WebView2 reports "Win32",
/// WKWebView reports "MacIntel", so this matches the real platform.
function guessPlatform(): Platform {
  const ua = typeof navigator !== "undefined" ? navigator.platform : "";
  if (/^mac/i.test(ua)) return "macos";
  if (/^win/i.test(ua)) return "windows";
  return "other";
}

let cached: Platform | null = null;

export async function getPlatform(): Promise<Platform> {
  if (cached) return cached;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const os = await invoke<string>("get_platform");
    cached = os === "macos" || os === "windows" || os === "linux" ? os : "other";
  } catch {
    // Plain browser (vite dev without the shell) — the UA guess is good enough.
    cached = guessPlatform();
  }
  return cached;
}

export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>(guessPlatform);
  useEffect(() => {
    let alive = true;
    void getPlatform().then((p) => alive && setPlatform(p));
    return () => {
      alive = false;
    };
  }, []);
  return platform;
}