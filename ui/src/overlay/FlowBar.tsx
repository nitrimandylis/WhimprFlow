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

// ponytail: hover action cluster removed — overlay ignores mouse events
// so it never steals focus from the user's app. Dictation is Fn-key-driven.
// Upgrade path: use NSPanel with nonactivatingPanel style if click
// interaction is ever needed without stealing focus.

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

export function FlowBar() {
  const [state, setState] = useState<BarState>("idle");
  const [bars, setBars] = useState<number[]>([]);
  // Set by `whimpr://error`, shown while state === "error". Falls back to a
  // generic line if the error-state event somehow arrives without one (e.g.
  // an older build, or a future ShowBar(Error) call that doesn't go through
  // `diag::report`).
  const [errorText, setErrorText] = useState<ErrorEvent | null>(null);
  // Live provisional text while recording (streaming preview).
  const [partial, setPartial] = useState("");
  // Insertion receipt text (spec: whimpr://receipt), shown for RECEIPT_MS.
  const [receipt, setReceipt] = useState<string | null>(null);
  const receiptTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    let un3: (() => void) | undefined;
    let un4: (() => void) | undefined;
    let un5: (() => void) | undefined;
    tauriListen<StateEvent>("whimpr://flowbar/state", (p) => {
      setState(p.state);
      // A fresh session starts clean: no stale partial or receipt text.
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
    return () => {
      un1?.();
      un2?.();
      un3?.();
      un4?.();
      un5?.();
      window.clearTimeout(receiptTimer.current);
    };
  }, []);

  const recording = state === "recording" || state === "locked";
  // Hold the status form while a receipt is showing: the shell flips the bar
  // back to idle ~500ms after "done", which would otherwise cut the receipt
  // flash (including error detail) short of its full RECEIPT_MS.
  const isIdle = state === "idle" && receipt === null;
  const processing = state === "transcribing";
  const isError = state === "error";
  // The receipt (pasted / noted / error detail) supersedes the generic labels
  // for its ~1.6s flash after a finalize.
  const statusText =
    state === "transcribing"
      ? "Cleaning up…"
      : (receipt ??
        (isError
          ? errorText?.headline ?? "Something's off"
          : state === "cancelled"
            ? "Discarded"
            : "Done"));

  // Pill dimensions per state. Error gets extra width so the specific
  // headline (e.g. "Accessibility permission needed") isn't clipped —
  // truncating it back down to "Something's off" would defeat the point. The
  // idle nub is deliberately tiny so it doesn't nag, but that also made it
  // undiscoverable — so hovering expands it into a labelled affordance that
  // says what a click will do. Recording gets slightly taller while a live
  // partial line shows (streaming preview).
  const showPartial = recording && partial.length > 0;
  const dims = isIdle
    ? { w: 76, h: 16 }
    : recording
      ? { w: 250, h: showPartial ? 62 : 44 }
      : isError
        ? { w: 280, h: 36 }
        : { w: 180, h: 36 };

  return (
    // Bottom-aligned so the resting nub keeps its position and the hover UI grows
    // upwards, rather than the whole cluster jumping when it expands.
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
        // Pointer events only on children, not the invisible overlay area.
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
        {isIdle ? null : recording ? (
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

      {/* Added below the capsule on hover — the capsule stays put. */}
      {/* ponytail: hover action buttons removed — overlay ignores mouse
         events so it never steals focus. Dictation is Fn-key-driven. */}
    </div>
  );
}

const motionEase = "cubic-bezier(0.05,0.6,0.4,0.95)";
