import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Onboarding } from "./Onboarding";
import { Sidebar, type Page } from "./Sidebar";
import { History } from "./History";
import { Insights } from "./Insights";
import { DictionaryPane } from "./DictionaryPane";
import { SettingsPane } from "./SettingsPane";
import { StylePane } from "./StylePane";
import { Help } from "./Help";
import { Button } from "./ui";
import { gsap, prefersReduced, EASE } from "./anim";
import {
  getSettings,
  setSettings,
  getStatus,
  getLastError,
  onPermissions,
  requestAccessibility,
  fixAccessibility,
  listenEvent,
  checkModelStatus,
  type Settings,
  type Status,
  type LastError,
  DEFAULT_SETTINGS,
  UNKNOWN_STATUS,
} from "./api";

// A slim, dismissible strip above the content whenever something is stopping
// dictation from reaching the cursor: a permission that lapsed after setup, or
// the last loud diagnostic from the pipeline (`diag::report` in src-tauri).
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
    <div className="banner">
      <div className="banner-text">
        <b>{headline}</b>
        <span>{detail}</span>
      </div>
      {actionLabel && onAction && <Button variant="danger" onClick={onAction}>{actionLabel}</Button>}
      <Button variant="plain" onClick={onDismiss} title="Dismiss">✕</Button>
    </div>
  );
}

// Remounted per navigation (key={page}). The pane's groups rise in with a
// short stagger, the one piece of motion the Hub keeps.
function RoutedPage({ page, children }: { page: Page; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (prefersReduced() || document.hidden || !ref.current) return;
    const targets = ref.current.querySelectorAll(".group, .group-title, .history section, .empty");
    if (targets.length === 0) return;
    const ctx = gsap.context(() => {
      gsap.from(targets, { opacity: 0, y: 6, duration: 0.25, ease: EASE, stagger: 0.03, clearProps: "transform,opacity" });
    }, ref);
    return () => ctx.revert();
  }, [page]);
  return (
    <div ref={ref} className="pane">
      {children}
    </div>
  );
}

export function App() {
  const [page, setPage] = useState<Page>("history");
  const [settings, setLocalSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [entered, setEntered] = useState(() => {
    try {
      return localStorage.getItem("whimpr_onboarding_done") === "1";
    } catch {
      return false;
    }
  });
  const [status, setStatus] = useState<Status>(UNKNOWN_STATUS);
  const [lastError, setLastError] = useState<LastError | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);

  const markEntered = () => {
    try {
      localStorage.setItem("whimpr_onboarding_done", "1");
    } catch {
      /* ignore */
    }
    setEntered(true);
  };

  // The pill's gear button asks Rust to show the Hub on Settings.
  useEffect(() => {
    let un: (() => void) | undefined;
    void listenEvent<Page>("whimpr://navigate", setPage).then((u) => (un = u));
    return () => un?.();
  }, []);

  // Stable across renders so the poll below is not restarted every render.
  const refresh = useCallback(
    () =>
      getStatus().then(async (s) => {
        setStatus(s);
        // Skip the gate on re-open once permissions + model are all set.
        if (s.accessibility && s.microphone && (await checkModelStatus())) {
          markEntered();
        }
      }),
    [],
  );
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Accessibility can read as granted while the key tap is still dead (stale
  // TCC entry from an earlier build). Only flag it after a grace period.
  const [accSince, setAccSince] = useState<number | null>(null);
  useEffect(() => {
    setAccSince((prev) => (status.accessibility ? (prev ?? Date.now()) : null));
  }, [status.accessibility]);

  useEffect(() => {
    getSettings().then(setLocalSettings);
    refresh();
    getLastError().then(setLastError);
  }, []);

  // Permission heartbeat pushed from Rust (`permissions::watch`). A webview
  // that is not rendering runs no timers, and the reader grants from System
  // Settings with this window behind it, so Rust has to be the one ticking.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    void onPermissions((p) => {
      setStatus((prev) => {
        const next = { ...prev, ...p };
        if (next.accessibility && next.microphone) {
          void checkModelStatus().then((ok) => { if (ok) markEntered(); });
        }
        return next;
      });
    }).then((u) => (gone ? u() : (stop = u)));
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  // Coming back to the window: they just flipped a switch and tabbed back.
  useEffect(() => {
    const sync = () => void refreshRef.current();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  // Backstop poll for the whole session: a permission can lapse after entry.
  useEffect(() => {
    const id = setInterval(() => void refreshRef.current(), 5000);
    return () => clearInterval(id);
  }, []);

  // Live pipeline failures, instead of waiting for the next poll.
  useEffect(() => {
    let un: (() => void) | undefined;
    void listenEvent<LastError>("whimpr://error", (e) => {
      setLastError(e);
      setErrorDismissed(false);
    }).then((u) => (un = u));
    return () => un?.();
  }, []);

  // Debounced save: text fields call update() per keystroke, and overlapping
  // unawaited saves had no ordering guarantee.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const update = (s: Settings) => {
    setLocalSettings(s);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void setSettings(s), 400);
  };

  if (!(status.accessibility && status.microphone) && !entered) {
    return <Onboarding status={status} refresh={refresh} onEnter={markEntered} />;
  }

  const accessibilityLapsed = entered && !status.accessibility;
  const staleWired =
    entered && status.accessibility && !status.hotkey_wired && accSince !== null && Date.now() - accSince > 10000;
  const banner = errorDismissed
    ? null
    : accessibilityLapsed
      ? {
          headline: "Accessibility permission needed",
          detail: "WhimprFlow can no longer type into other apps.",
          actionLabel: "Grant",
          onAction: () => requestAccessibility(),
        }
      : staleWired
        ? {
            headline: "Dictation key is not wired up",
            detail: "macOS still holds a permission entry for an older build. Fix clears it and reopens the pane.",
            actionLabel: "Fix",
            onAction: () => void fixAccessibility(),
          }
        : lastError
          ? { headline: lastError.headline, detail: lastError.detail }
          : null;

  return (
    <div className="shell">
      <Sidebar page={page} setPage={setPage} />
      <RoutedPage key={page} page={page}>
        {banner && (
          <ErrorBanner
            headline={banner.headline}
            detail={banner.detail}
            actionLabel={banner.actionLabel}
            onAction={banner.onAction}
            onDismiss={() => setErrorDismissed(true)}
          />
        )}
        {page === "history" && <History settings={settings} />}
        {page === "insights" && <Insights />}
        {page === "dictionary" && <DictionaryPane />}
        {page === "style" && <StylePane settings={settings} onChange={update} />}
        {page === "settings" && <SettingsPane settings={settings} onChange={update} status={status} refresh={() => void refresh()} />}
        {page === "help" && <Help />}
      </RoutedPage>
    </div>
  );
}
