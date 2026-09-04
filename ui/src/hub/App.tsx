import { useCallback, useEffect, useRef, useState } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Onboarding } from "./Onboarding";
import { Sidebar, type Page } from "./Sidebar";
import { Home } from "./Home";
import { Insights } from "./Insights";
import { DictionaryPane } from "./DictionaryPane";
import { SettingsPane } from "./SettingsPane";
import { SnippetsPane } from "./SnippetsPane";
import { ScratchpadPane } from "./ScratchpadPane";
import { TransformsPane } from "./TransformsPane";
import { StylePane } from "./StylePane";
import { Help } from "./Help";
import { ComingSoon } from "./ComingSoon";
import type { IconName } from "./icons";
import {
  getSettings,
  setSettings,
  getStatus,
  getLastError,
  onPermissions,
  requestAccessibility,
  fixAccessibility,
  type Settings,
  type Status,
  type LastError,
  DEFAULT_SETTINGS,
  UNKNOWN_STATUS,
} from "./api";

// A slim, dismissible warning strip shown above the Hub content whenever
// something is stopping dictation from reaching the cursor — either a
// permission that lapsed after the onboarding gate was already passed (e.g.
// a rebuild invalidated a stale macOS Accessibility grant), or the last loud
// diagnostic reported by the dictation pipeline (`diag::report` in
// src-tauri). Without this, a permission revoked (or a hotkey tap that died)
// mid-session was previously invisible outside the terminal — see the
// "text is not writing where the cursor is" bug reports.
function ErrorBanner({
  headline,
  detail,
  actionLabel,
  onAction,
  onDismiss,
}: {
  headline: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 20px",
        background: "rgba(255,107,107,0.12)",
        borderBottom: `1px solid rgba(255,107,107,0.35)`,
        fontFamily: font.ui,
      }}
    >
      <span style={{ fontSize: 15, flex: "0 0 auto" }}>⚠</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: palette.slate900 }}>{headline}</span>
        <span style={{ fontSize: 13, color: theme.textMuted, marginLeft: 8 }}>{detail}</span>
      </div>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          style={{
            flex: "0 0 auto",
            cursor: "pointer",
            border: "none",
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 12.5,
            fontWeight: 600,
            fontFamily: font.ui,
            color: "#fff",
            background: palette.error,
          }}
        >
          {actionLabel}
        </button>
      )}
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          flex: "0 0 auto",
          cursor: "pointer",
          border: "none",
          background: "transparent",
          color: theme.textFaint,
          fontSize: 14,
          padding: 4,
        }}
      >
        ✕
      </button>
    </div>
  );
}

// Every screen is built now; kept so a future stub has somewhere to live.
const SOON: Partial<Record<Page, { icon: IconName; title: string; desc: string }>> = {};

export function App() {
  const [page, setPage] = useState<Page>("home");
  const [settings, setLocalSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [entered, setEntered] = useState(() => {
    try { return localStorage.getItem("whimpr_onboarding_done") === "1"; } catch { return false; }
  });
  const [status, setStatus] = useState<Status>(UNKNOWN_STATUS);
  const [lastError, setLastError] = useState<LastError | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);

  const markEntered = () => {
    try { localStorage.setItem("whimpr_onboarding_done", "1"); } catch { /* ignore */ }
    setEntered(true);
  };

  // Stable across renders. It used to be rebuilt on every render, which tore
  // down and restarted any interval keyed on it — a poll that resets its own
  // clock on every tick is a poll that can be starved.
  const refresh = useCallback(
    () =>
      getStatus().then((s) => {
        setStatus(s);
        // Auto-enter if both required permissions are already granted so the user
        // never sees the Onboarding gate on a re-open after a successful setup.
        if (s.accessibility && s.microphone) markEntered();
      }),
    [],
  );
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Grace-tracked "wired" check: Accessibility can read as granted while the
  // Fn tap is still dead (stale TCC entry from an earlier build). Only flag it
  // after the tap thread has had a fair chance to spin up.
  const [accSince, setAccSince] = useState<number | null>(null);
  useEffect(() => {
    setAccSince((prev) => (status.accessibility ? (prev ?? Date.now()) : null));
  }, [status.accessibility]);

  useEffect(() => {
    getSettings().then(setLocalSettings);
    refresh();
    getLastError().then(setLastError);
  }, []);

  // The permission heartbeat lives in Rust now (`permissions::watch`) and is
  // pushed here the instant macOS changes its mind. That matters because the
  // reader grants the microphone from *System Settings*, with this window
  // behind it or closed to the tray — and a webview that isn't rendering runs
  // no timers at all. (Measured on 0.1.1: hide the Hub and its status calls
  // stop 4.4s later and never resume, while a Rust thread keeps ticking every
  // half second.) Waiting on our own setInterval was half of why "it didn't
  // recognize that I had given it microphone permissions" happened.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    void onPermissions((p) => {
      setStatus((prev) => {
        const next = { ...prev, ...p };
        if (next.accessibility && next.microphone) markEntered();
        return next;
      });
    }).then((u) => (gone ? u() : (stop = u)));
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  // Coming back to the window is the other moment the reader expects the truth:
  // they just flipped a switch in System Settings and tabbed back here.
  useEffect(() => {
    const sync = () => void refreshRef.current();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  // Backstop poll for the whole session, not just during onboarding — a
  // permission can lapse after `entered` is already true (a rebuild with a new
  // ad-hoc signature invalidates a prior macOS Accessibility grant; see the
  // "stale TCC entry" case in hotkey.rs), and that used to go completely
  // unnoticed until the user dug through logs.
  useEffect(() => {
    const id = setInterval(() => void refreshRef.current(), 5000);
    return () => clearInterval(id);
  }, []);

  // Live-update the moment the dictation pipeline reports a failure
  // (`diag::report` in src-tauri), instead of waiting for the next poll.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<LastError>("whimpr://error", (e) => {
          setLastError(e.payload);
          setErrorDismissed(false);
        }),
      )
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  // Each keystroke in a settings text field calls update(); saving on every one
  // fired overlapping, unawaited Tauri calls (each doing a keyring lookup + HTTP
  // client rebuild) with no ordering guarantee, so a fast typist could have an
  // earlier, shorter value win the disk write over the final one. Debounce the
  // actual save so only the settled value after typing stops gets persisted.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const update = (s: Settings) => {
    setLocalSettings(s);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void setSettings(s), 400);
  };

  // Gate the app behind the setup wizard until the required permissions are granted.
  if (!(status.accessibility && status.microphone) && !entered) {
    return <Onboarding status={status} refresh={refresh} onEnter={markEntered} />;
  }

  const soon = SOON[page];

  // Two independent reasons for the post-onboarding banner: Accessibility
  // lapsed after entry (checked live against `status`, not just the one-time
  // onboarding gate), or the pipeline reported some other failure (hotkey tap
  // dead, paste failed, empty transcript, …). A third case sits between them:
  // Accessibility reads as granted but the tap never wired up (stale TCC
  // entry), which needs the one-click Fix, not a re-grant.
  const accessibilityLapsed = entered && !status.accessibility;
  const staleWired =
    entered &&
    status.accessibility &&
    !status.hotkey_wired &&
    accSince !== null &&
    Date.now() - accSince > 10000;
  const banner = errorDismissed
    ? null
    : accessibilityLapsed
      ? {
          headline: "Accessibility permission needed",
          detail: "WhimprFlow can no longer type into other apps — grant it again to keep dictating.",
          actionLabel: "Grant Accessibility",
          onAction: () => requestAccessibility(),
        }
      : staleWired
        ? {
            headline: "Fn key isn't wired up",
            detail:
              "macOS still holds a permission entry for an older build of WhimprFlow. Click Fix to clear it, then enable WhimprFlow again in the pane that opens.",
            actionLabel: "Fix Accessibility",
            onAction: () => void fixAccessibility(),
          }
        : lastError
          ? { headline: lastError.headline, detail: lastError.detail }
          : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        fontFamily: font.ui,
        color: theme.textBody,
        background: theme.pageBg,
      }}
    >
      {banner && (
        <ErrorBanner
          headline={banner.headline}
          detail={banner.detail}
          actionLabel={banner.actionLabel}
          onAction={banner.onAction}
          onDismiss={() => setErrorDismissed(true)}
        />
      )}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Sidebar page={page} setPage={setPage} />
        <main style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
          <div style={{ padding: "36px 44px", margin: "0 auto", maxWidth: 1120 }}>
            {page === "home" && <Home />}
            {page === "insights" && <Insights />}
            {page === "dictionary" && <DictionaryPane />}
            {page === "snippets" && <SnippetsPane />}
            {page === "scratchpad" && <ScratchpadPane />}
            {page === "transforms" && <TransformsPane />}
            {page === "style" && <StylePane settings={settings} onChange={update} />}
            {page === "settings" && (
              <SettingsPane settings={settings} onChange={update} status={status} refresh={refresh} />
            )}
            {page === "help" && <Help />}
            {soon && <ComingSoon icon={soon.icon} title={soon.title} desc={soon.desc} />}
          </div>
        </main>
      </div>
    </div>
  );
}
