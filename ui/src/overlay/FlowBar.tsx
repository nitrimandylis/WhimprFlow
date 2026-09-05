import { useEffect, useRef, useState } from "react";
import { palette, pillFill, geometry, font } from "../tokens/values";
import { LANGUAGES, type Settings } from "../hub/api";

// Visual states, mirroring the Rust `BarState`.
export type BarState =
  | "idle"
  | "recording"
  | "locked"
  | "transcribing"
  | "done"
  | "cancelled"
  | "error";

type StateEvent = { state: BarState };
type WaveformEvent = { bars: number[] };
// Mirrors `diag::ErrorDto` in src-tauri/src/diag.rs.
type ErrorEvent = { headline: string; detail: string };

async function tauriListen<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<T>(event, (e) => cb(e.payload as T));
  } catch {
    return () => {};
  }
}

// ponytail: drag removed — overlay ignores mouse events. If drag-to-reposition
// is needed later, use NSPanel with nonactivatingPanel style first.

// A row of dot-like rounded bars driven by mic RMS — Wispr's dotted-waveform look:
// small dots when quiet, rising into a waveform when speaking.
function DottedWaveform({ bars }: { bars: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barsRef = useRef<number[]>(bars);
  barsRef.current = bars;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const N = 16;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const dotW = 2.4;
      const gap = (w - N * dotW) / (N - 1);
      const t = performance.now();
      ctx.fillStyle = palette.waveBar;
      for (let i = 0; i < N; i++) {
        const real = barsRef.current[barsRef.current.length - 1 - (i % barsRef.current.length)];
        // Idle shimmer so the dotted line reads as "listening" even in near-silence.
        const shimmer = 0.12 + 0.06 * Math.abs(Math.sin(t / 260 + i * 0.7));
        const amp = Math.max(shimmer, real ?? 0);
        const bh = 3 + amp * 20; // 3px dot → up to ~23px bar
        const x = i * (dotW + gap);
        const y = (h - bh) / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, dotW, bh, dotW / 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100%", height: 28 }} />;
}

async function pillCommand(cmd: "pill_cancel" | "pill_stop" | "pill_start") {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(cmd);
  } catch {
    /* browser preview */
  }
}

/// Stop propagation so a press on a button never reaches the pill's drag handler.
function buttonHandlers(onActivate: () => void) {
  return {
    onMouseDown: (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onActivate();
    },
  };
}

function CancelButton() {
  return (
    <div
      title="Cancel (Esc)"
      className="pill-btn"
      {...buttonHandlers(() => void pillCommand("pill_cancel"))}
      style={{
        cursor: "pointer",
        flex: "0 0 auto",
        width: 26,
        height: 26,
        borderRadius: 9999,
        background: "rgba(255,255,255,0.16)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: 15,
        lineHeight: 1,
      }}
    >
      ✕
    </div>
  );
}

function StopButton() {
  return (
    <div
      title="Stop and insert"
      className="pill-btn"
      {...buttonHandlers(() => void pillCommand("pill_stop"))}
      style={{
        cursor: "pointer",
        flex: "0 0 auto",
        width: 26,
        height: 26,
        borderRadius: 9999,
        background: "#FF5A52",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: 9, height: 9, borderRadius: 2, background: "#fff" }} />
    </div>
  );
}

// ── Hover quick controls ────────────────────────────────────────────────────
// Shown below the pill on hover. Rust toggles ignoresMouseEvents so these
// receive real clicks without the pill stealing focus at rest.

const PTT_LABEL: Record<string, string> = {
  fn: "fn",
  right_command: "right ⌘",
  right_option: "right ⌥",
  right_control: "right ⌃",
};

const CLEANUP_OPTIONS = [
  { value: "raw", label: "Raw" },
  { value: "local", label: "Local" },
  { value: "open_ai", label: "OpenAI" },
  { value: "anthropic", label: "Claude" },
] as const;

async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd, args);
  } catch {
    return undefined; /* browser preview */
  }
}

/// Hold the hover open while a native <select> popup is up: the cursor leaves
/// the pill to pick an item, and without this Rust would collapse the cluster.
function lockHandlers() {
  return {
    onFocus: () => void invokeSafe("set_pill_hover_lock", { locked: true }),
    onBlur: () => void invokeSafe("set_pill_hover_lock", { locked: false }),
  };
}

const chipStyle: React.CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 30,
  padding: "0 11px",
  borderRadius: 9999,
  background: pillFill.base,
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow: pillFill.shadow,
  color: palette.pillText,
  fontSize: 12.5,
  fontWeight: 500,
  whiteSpace: "nowrap",
  cursor: "pointer",
  flex: "0 0 auto",
};

// A styled chip with an invisible native <select> on top. The popup is the
// real macOS menu (can extend past the overlay window), the chip controls
// the closed width so long microphone names don't blow out the row.
function Chip({
  icon,
  text,
  title,
  value,
  options,
  onChange,
  maxWidth,
}: {
  icon: React.ReactNode;
  text: string;
  title: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
  maxWidth?: number;
}) {
  return (
    <label title={title} className="qc-chip" style={chipStyle}>
      <span style={{ display: "flex", flex: "0 0 auto" }}>{icon}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth }}>{text}</span>
      <select
        aria-label={title}
        value={value}
        {...lockHandlers()}
        onChange={(e) => {
          onChange(e.currentTarget.value);
          e.currentTarget.blur();
        }}
        style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer" }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </svg>
  );
}

function QuickControls({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [mics, setMics] = useState<string[]>([]);
  useEffect(() => {
    void invokeSafe<string[]>("list_microphones").then((m) => setMics(m ?? []));
  }, []);
  const micOptions = [{ value: "", label: "System default" }, ...mics.map((m) => ({ value: m, label: m }))];
  const lang = LANGUAGES.find((l) => l.value === settings.language);
  const cleanup = CLEANUP_OPTIONS.find((c) => c.value === settings.cleanup_mode);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, pointerEvents: "auto" }}>
      <Chip
        icon={<MicIcon />}
        text={settings.microphone || "Default"}
        title="Microphone"
        value={settings.microphone}
        options={micOptions}
        onChange={(v) => onChange({ ...settings, microphone: v })}
        maxWidth={90}
      />
      <Chip
        icon={<GlobeIcon />}
        text={settings.language === "auto" ? "Auto" : settings.language.toUpperCase()}
        title={`Language: ${lang?.label ?? settings.language}`}
        value={settings.language}
        options={LANGUAGES}
        onChange={(v) => onChange({ ...settings, language: v })}
      />
      <Chip
        icon={<SparkIcon />}
        text={cleanup?.label ?? settings.cleanup_mode}
        title="Cleanup"
        value={settings.cleanup_mode}
        options={CLEANUP_OPTIONS}
        onChange={(v) => onChange({ ...settings, cleanup_mode: v as Settings["cleanup_mode"] })}
      />
      <div
        title="Open settings"
        className="qc-chip"
        {...buttonHandlers(() => void invokeSafe("open_hub_settings"))}
        style={{ ...chipStyle, width: 30, padding: 0, justifyContent: "center" }}
      >
        <GearIcon />
      </div>
    </div>
  );
}

export function FlowBar() {
  const [state, setState] = useState<BarState>("idle");
  const [bars, setBars] = useState<number[]>([]);
  const [errorText, setErrorText] = useState<ErrorEvent | null>(null);
  // Driven by Rust cursor tracking (whimpr://hover). Rust also toggles
  // ignoresMouseEvents so buttons are clickable while hovering.
  const [hover, setHover] = useState(false);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const clusterRef = useRef<HTMLDivElement | null>(null);

  // Read settings the quick controls display, refreshed each hover.
  useEffect(() => {
    if (!hover) return;
    void invokeSafe<Settings>("get_settings").then((s) => s && setSettingsState(s));
  }, [hover]);

  function saveSettings(next: Settings) {
    setSettingsState(next);
    void invokeSafe("set_settings", { settings: next });
  }

  // Report the cluster's box to Rust after every size change (the morph
  // transition included) so the hover zone is exactly the pill, never the
  // transparent window around it.
  useEffect(() => {
    const el = clusterRef.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      void invokeSafe("set_pill_hit_rect", { x: r.left, y: r.top, w: r.width, h: r.height });
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    let un3: (() => void) | undefined;
    let un4: (() => void) | undefined;
    tauriListen<StateEvent>("whimpr://flowbar/state", (p) => setState(p.state)).then((u) => (un1 = u));
    tauriListen<WaveformEvent>("whimpr://audio/waveform", (p) => setBars(p.bars)).then((u) => (un2 = u));
    tauriListen<ErrorEvent>("whimpr://error", (p) => setErrorText(p)).then((u) => (un3 = u));
    tauriListen<boolean>("whimpr://hover", (over) => setHover(over)).then((u) => (un4 = u));
    return () => {
      un1?.();
      un2?.();
      un3?.();
      un4?.();
    };
  }, []);

  const recording = state === "recording" || state === "locked";
  const isIdle = state === "idle";
  const processing = state === "transcribing";
  const isError = state === "error";
  const statusText =
    state === "transcribing"
      ? "Cleaning up…"
      : isError
        ? errorText?.headline ?? "Something's off"
        : state === "cancelled"
          ? "Discarded"
          : "Done";

  const dims = isIdle
    ? hover
      ? { w: 158, h: 38 }
      : { w: 76, h: 16 }
    : recording
      ? { w: 250, h: 44 }
      : isError
        ? { w: 280, h: 36 }
        : { w: 180, h: 36 };

  const showActions = isIdle && hover;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingBottom: 4,
        fontFamily: font.ui,
        userSelect: "none",
        pointerEvents: "none",
      }}
    >
      <div ref={clusterRef} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div
        aria-label={`WhimprFlow ${state}${isError && errorText ? `: ${errorText.detail}` : ""}`}
        {...(isIdle ? buttonHandlers(() => void pillCommand("pill_start")) : {})}
        title={isError ? errorText?.detail : ""}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: recording ? "space-between" : "center",
          gap: 10,
          height: dims.h,
          width: dims.w,
          padding: recording ? "0 8px" : 0,
          background: pillFill.base,
          border: `1px solid rgba(255,255,255,0.10)`,
          borderRadius: 9999,
          boxShadow: pillFill.shadow,
          color: palette.pillText,
          transition: `width ${geometry.morphMs}ms ${motionEase}, height ${geometry.morphMs}ms ${motionEase}`,
          overflow: "hidden",
          fontSize: 13,
          cursor: "pointer",
          pointerEvents: "auto",
        }}
      >
        {isIdle ? (
          hover ? (
            <div
              className="pill-label"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "0 15px",
                whiteSpace: "nowrap",
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              <span>Dictate</span>
              <b style={{ fontWeight: 700 }}>{PTT_LABEL[settings?.push_to_talk_key ?? "fn"] ?? "fn"}</b>
            </div>
          ) : null
        ) : recording ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              width: "100%",
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
              <CancelButton />
              <div style={{ flex: 1, minWidth: 0 }}>
                <DottedWaveform bars={bars} />
              </div>
              <StopButton />
            </div>
          </div>
        ) : processing ? (
          <span style={{ color: palette.pillTextMuted }}>{statusText}</span>
        ) : (
          <span style={{ color: palette.pillTextMuted }}>{statusText}</span>
        )}
      </div>

      {showActions && settings && <QuickControls settings={settings} onChange={saveSettings} />}
      </div>
    </div>
  );
}

const motionEase = "cubic-bezier(0.23, 1, 0.32, 1)";
