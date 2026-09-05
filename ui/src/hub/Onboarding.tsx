import { useEffect, useRef, useState } from "react";
import { Button, Group, Status } from "./ui";
import {
  fixAccessibility,
  requestAccessibility,
  requestMicrophone,
  requestInputMonitoring,
  restartApp,
  checkModelStatus,
  downloadModel,
  onModelProgress,
  onModelDone,
  type Status as StatusT,
} from "./api";

// The permission gate. Steps unlock in order and their state polls live. Not a
// hard block: Settings, Dictionary and History work with no permissions, so
// "Skip" is always available.

function Step({
  n,
  title,
  detail,
  done,
  locked,
  optional,
  action,
}: {
  n: number;
  title: string;
  detail: string;
  done: boolean;
  locked: boolean;
  optional?: boolean;
  action: React.ReactNode;
}) {
  return (
    <div className={`row${locked ? " locked" : ""}`}>
      <div className={`step-num${done ? " done" : ""}`}>{done ? "✓" : n}</div>
      <div className="row-text">
        <div className="row-label">
          {title}
          {optional && <span className="dict-auto">optional</span>}
        </div>
        <div className="row-hint">{detail}</div>
      </div>
      <div className="row-control">{done ? <Status ok>Done</Status> : action}</div>
    </div>
  );
}

function ModelStep({ n, locked }: { n: number; locked: boolean }) {
  const [hasModel, setHasModel] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void checkModelStatus().then(setHasModel);
  }, []);

  useEffect(() => {
    if (!downloading) return;
    let stop1: (() => void) | undefined;
    let stop2: (() => void) | undefined;
    void onModelProgress((p) => setPercent(p.percent)).then((u) => (stop1 = u));
    void onModelDone((p) => {
      setDownloading(false);
      if (p.ok) {
        setHasModel(true);
        setPercent(100);
      } else {
        setError(p.error ?? "Download failed");
      }
    }).then((u) => (stop2 = u));
    return () => {
      stop1?.();
      stop2?.();
    };
  }, [downloading]);

  const done = hasModel === true;
  return (
    <div className={`row${locked ? " locked" : ""}`}>
      <div className={`step-num${done ? " done" : ""}`}>{done ? "✓" : n}</div>
      <div className="row-text">
        <div className="row-label">Speech model</div>
        <div className="row-hint">
          {downloading ? `Downloading, ${percent}%` : error ?? "A 148 MB model for on-device transcription."}
        </div>
        {downloading && (
          <div className="progress">
            <div style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      <div className="row-control">
        {done ? (
          <Status ok>Installed</Status>
        ) : (
          <Button
            disabled={locked || downloading}
            onClick={() => {
              setError(null);
              setDownloading(true);
              setPercent(0);
              void downloadModel();
            }}
          >
            {error ? "Retry" : "Download"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function Onboarding({ status, refresh, onEnter }: { status: StatusT; refresh: () => void; onEnter: () => void }) {
  // Backstop poll. The real signal is the heartbeat Rust pushes, since this
  // webview stops running timers when its window is hidden behind System
  // Settings, which is exactly where the reader is while granting.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const id = setInterval(() => refreshRef.current(), 1200);
    return () => clearInterval(id);
  }, []);

  const acc = status.accessibility;
  const mic = status.microphone;
  const canEnter = acc && mic;

  // Stale grant: macOS says granted, but the key tap never came up because TCC
  // is enforcing an older build's signature. Only flag after a grace period.
  const [accSince, setAccSince] = useState<number | null>(null);
  useEffect(() => {
    setAccSince((prev) => (acc ? (prev ?? Date.now()) : null));
  }, [acc]);
  const staleGrant = acc && !status.hotkey_wired && accSince !== null && Date.now() - accSince > 7000;

  return (
    <div className="setup">
      <div className="setup-body">
        <h1>Set up WhimprFlow</h1>
        <p>
          Two permissions and a model, in order. Accessibility applies the moment macOS grants it.
          Microphone usually needs a relaunch, because macOS decides an app's microphone access
          when it starts. Use Quit and Reopen after turning it on.
        </p>

        {staleGrant && (
          <div className="banner" style={{ borderRadius: 8, marginBottom: 14 }}>
            <div className="banner-text">
              <b>Accessibility is granted but the key is not wired up.</b>
              <span>macOS is enforcing an older build's permission. Fix clears it and reopens the pane.</span>
            </div>
            <Button variant="danger" onClick={() => void fixAccessibility()}>Fix</Button>
          </div>
        )}

        <Group>
          <Step
            n={1}
            title="Accessibility"
            detail="Reads the dictation key in every app and types your words."
            done={acc}
            locked={false}
            action={<Button onClick={() => requestAccessibility()}>Grant</Button>}
          />
          <Step
            n={2}
            title="Microphone"
            detail={status.microphone_hint ?? "Hears what you say."}
            done={mic}
            locked={!acc}
            action={<Button disabled={!acc} onClick={() => requestMicrophone()}>Grant</Button>}
          />
          <ModelStep n={3} locked={!(acc && mic)} />
          <Step
            n={4}
            title="Input Monitoring"
            detail="Makes key detection more reliable."
            done={status.input_monitoring}
            locked={!(acc && mic)}
            optional
            action={<Button disabled={!(acc && mic)} onClick={() => requestInputMonitoring()}>Grant</Button>}
          />
        </Group>

        <div className="setup-actions">
          <Button size="lg" onClick={() => void restartApp()}>Quit and Reopen</Button>
          {canEnter ? (
            <Button size="lg" variant="primary" onClick={onEnter}>Start using WhimprFlow</Button>
          ) : (
            <Button size="lg" onClick={onEnter}>Skip for now</Button>
          )}
        </div>

        <p className="hint" style={{ marginTop: 16 }}>
          If Accessibility stays off even though System Settings shows it on, click Grant again.
          WhimprFlow clears the stale entry from older builds and asks again.
        </p>
      </div>
    </div>
  );
}
