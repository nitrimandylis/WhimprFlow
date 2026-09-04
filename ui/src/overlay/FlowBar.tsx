import { useEffect, useRef, useState } from "react";
import { palette, pillFill, geometry, font } from "../tokens/values";
import type { PartialTranscriptEvent, ReceiptEvent } from "../hub/api";

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

// How long the insertion receipt stays on screen after a finalize.
const RECEIPT_MS = 1600;

// One line of receipt copy per action (spec: whimpr://receipt).
function receiptText(p: ReceiptEvent): string {
  switch (p.action) {
    case "pasted":
      return `Pasted - ${p.words} ${p.words === 1 ? "word" : "words"}`;
    case "noted":
      return "Saved to Studio notes";
    case "clipboard":
      return "Copied to clipboard";
    case "pending":
      return "Awaiting approval";
    case "error":
      return p.message ?? "Something's off";
  }
}

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

// ── Hover action buttons ────────────────────────────────────────────────────
// Shown below the pill on hover. Rust toggles ignoresMouseEvents so these
// receive real clicks without the pill stealing focus at rest.

const LANG_CYCLE = ["en", "hi", "gu", "auto"] as const;
const LANG_NAMES: Record<string, string> = { en: "EN", hi: "हिं", gu: "ગુ", auto: "Auto" };
function langLabel(code: string) { return LANG_NAMES[code] ?? code.toUpperCase(); }

function GlobeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
    </svg>
  );
}

function RoundButton({
  children,
  onActivate,
  title,
  active = false,
}: {
  children: React.ReactNode;
  onActivate: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <div
      title={title}
      {...buttonHandlers(onActivate)}
      style={{
        width: 40,
        height: 40,
        borderRadius: 9999,
        background: active ? palette.accent500 : pillFill.base,
        border: `1px solid rgba(255,255,255,${active ? 0.25 : 0.1})`,
        boxShadow: pillFill.shadow,
        color: active ? "#08201E" : palette.pillText,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flex: "0 0 auto",
      }}
    >
      {children}
    </div>
  );
}

export function FlowBar() {
  const [state, setState] = useState<BarState>("idle");
  const [bars, setBars] = useState<number[]>([]);
  const [errorText, setErrorText] = useState<ErrorEvent | null>(null);
  const [partial, setPartial] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const receiptTimer = useRef<number | undefined>(undefined);
  // Driven by Rust cursor tracking (whimpr://hover). Rust also toggles
  // ignoresMouseEvents so buttons are clickable while hovering.
  const [hover, setHover] = useState(false);
  const [language, setLanguage] = useState("en");

  // Read settings the action buttons display, refreshed each hover.
  useEffect(() => {
    if (!hover) return;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const s = await invoke<{ language: string }>("get_settings");
        setLanguage(s.language);
      } catch { /* browser preview */ }
    })();
  }, [hover]);

  async function cycleLanguage() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const s = await invoke<Record<string, unknown>>("get_settings");
      const cur = String(s.language ?? "en");
      const i = LANG_CYCLE.indexOf(cur as (typeof LANG_CYCLE)[number]);
      const next = LANG_CYCLE[(i + 1) % LANG_CYCLE.length];
      await invoke("set_settings", { settings: { ...s, language: next } });
      setLanguage(next);
    } catch { /* browser preview */ }
  }

  useEffect(() => {
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    let un3: (() => void) | undefined;
    let un4: (() => void) | undefined;
    let un5: (() => void) | undefined;
    let un6: (() => void) | undefined;
    tauriListen<StateEvent>("whimpr://flowbar/state", (p) => {
      setState(p.state);
      if (p.state === "recording") {
        setPartial("");
        setReceipt(null);
      }
    }).then((u) => (un1 = u));
    tauriListen<WaveformEvent>("whimpr://audio/waveform", (p) => setBars(p.bars)).then((u) => (un2 = u));
    tauriListen<ErrorEvent>("whimpr://error", (p) => setErrorText(p)).then((u) => (un3 = u));
    tauriListen<PartialTranscriptEvent>("whimpr://transcript/partial", (p) => setPartial(p.text)).then(
      (u) => (un4 = u),
    );
    tauriListen<ReceiptEvent>("whimpr://receipt", (p) => {
      setReceipt(receiptText(p));
      window.clearTimeout(receiptTimer.current);
      receiptTimer.current = window.setTimeout(() => setReceipt(null), RECEIPT_MS);
    }).then((u) => (un5 = u));
    tauriListen<boolean>("whimpr://hover", (over) => setHover(over)).then((u) => (un6 = u));
    return () => {
      un1?.();
      un2?.();
      un3?.();
      un4?.();
      un5?.();
      un6?.();
      window.clearTimeout(receiptTimer.current);
    };
  }, []);

  const recording = state === "recording" || state === "locked";
  const isIdle = state === "idle" && receipt === null;
  const processing = state === "transcribing";
  const isError = state === "error";
  const statusText =
    state === "transcribing"
      ? "Cleaning up…"
      : (receipt ??
        (isError
          ? errorText?.headline ?? "Something's off"
          : state === "cancelled"
            ? "Discarded"
            : "Done"));

  const showPartial = recording && partial.length > 0;
  const dims = isIdle
    ? hover
      ? { w: 158, h: 38 }
      : { w: 76, h: 16 }
    : recording
      ? { w: 250, h: showPartial ? 62 : 44 }
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
      <div
        aria-label={`WhimprFlow ${state}${isError && errorText ? `: ${errorText.detail}` : ""}`}
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
              <b style={{ fontWeight: 700 }}>fn</b>
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
            {showPartial && (
              <div
                style={{
                  fontSize: 11.5,
                  lineHeight: 1.3,
                  color: palette.pillTextMuted,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  padding: "0 6px 4px",
                }}
              >
                {partial}
              </div>
            )}
          </div>
        ) : processing ? (
          <span style={{ color: palette.pillTextMuted }}>{statusText}</span>
        ) : (
          <span style={{ color: palette.pillTextMuted }}>{statusText}</span>
        )}
      </div>

      {showActions && (
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 9, pointerEvents: "auto" }}>
          <RoundButton title={`Language: ${langLabel(language)}`} onActivate={() => void cycleLanguage()}>
            <GlobeIcon />
          </RoundButton>
        </div>
      )}
    </div>
  );
}

const motionEase = "cubic-bezier(0.05,0.6,0.4,0.95)";
