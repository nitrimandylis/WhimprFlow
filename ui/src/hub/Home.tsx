import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Button, Dot, useStats } from "./ui";
import { Icon } from "./icons";
import { listen } from "@tauri-apps/api/event";
import {
  addDictionaryEntry,
  checkNetwork,
  downloadAsrModel,
  exportHistory,
  getHealth,
  getHistory,
  onReceipt,
  reloadAsr,
  type Health,
  type HistoryItem,
  type ModelProgress,
  type Provenance,
  type ReceiptEvent,
} from "./api";
import { toast } from "./Toast";
import { dayKey, dayLabel, fmtDuration, fmtNum, fmtTimeOfDay } from "./format";
import { gsap, prefersReduced, scrollerEl, EASE, EASE_EXPO } from "./anim";
import { detectPlatformSync } from "./platform";
import { EmptyState } from "./EmptyState";

// Only the clip container for the headline reveal stays in CSS; GSAP drives motion.
const HOME_CSS = `
  .home-line { display: block; overflow: hidden; padding-bottom: 0.06em; }
  .home-dot { will-change: transform, opacity; }
`;

// ── Full-page ambient canvas: flowing "voice ribbons" at rest. Warm teal on the
//    app's cream, pointer-reactive. Tied to the product, not a gradient/orb field.
function VoiceField() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = prefersReduced();
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    const pointer = { x: -9999, active: 0 };

    const size = () => {
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const RIBBONS = [
      { yr: 0.16, amp: 30, waves: [[0.0015, 1.0, 3.3], [0.0038, 0.5, 2.2]], speed: 0.11, alpha: 0.14, teal: true },
      { yr: 0.30, amp: 30, waves: [[0.0016, 1.0, 0.0], [0.0041, 0.5, 1.7]], speed: 0.10, alpha: 0.18, teal: false },
      { yr: 0.44, amp: 40, waves: [[0.0012, 1.0, 2.1], [0.0033, 0.55, 0.4]], speed: 0.15, alpha: 0.26, teal: true },
      { yr: 0.57, amp: 34, waves: [[0.0019, 0.9, 4.2], [0.0047, 0.45, 2.9]], speed: 0.13, alpha: 0.22, teal: true },
      { yr: 0.70, amp: 46, waves: [[0.0010, 1.0, 1.1], [0.0028, 0.6, 3.6]], speed: 0.17, alpha: 0.15, teal: false },
      { yr: 0.84, amp: 30, waves: [[0.0022, 0.85, 5.0], [0.0052, 0.4, 0.9]], speed: 0.14, alpha: 0.20, teal: true },
      { yr: 0.94, amp: 24, waves: [[0.0026, 0.8, 1.4], [0.0060, 0.4, 4.1]], speed: 0.12, alpha: 0.12, teal: true },
    ];

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const step = Math.max(6, Math.floor(w / 180));
      for (const r of RIBBONS) {
        const baseY = h * r.yr;
        ctx.beginPath();
        for (let x = -step; x <= w + step; x += step) {
          let y = baseY;
          for (const [f, a, ph] of r.waves) y += Math.sin(x * f + t * r.speed + ph) * r.amp * a;
          if (pointer.active > 0) {
            const d = (x - pointer.x) / 120;
            y -= Math.exp(-d * d) * 46 * pointer.active * Math.sin(t * 0.5 + x * 0.02);
          }
          if (x <= -step) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        const dark = document.documentElement.dataset.theme === "dark";
        const c = r.teal ? "58,232,216" : dark ? "150,162,178" : "90,102,117";
        grad.addColorStop(0, `rgba(${c},0)`);
        grad.addColorStop(0.5, `rgba(${c},${r.alpha})`);
        grad.addColorStop(1, `rgba(${c},0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = "round";
        ctx.stroke();
      }
    };

    let raf = 0;
    let start = 0;
    const loop = (ms: number) => {
      if (!start) start = ms;
      const t = (ms - start) / 1000;
      pointer.active += ((pointer.x > -9999 ? 1 : 0) - pointer.active) * 0.06;
      draw(t);
      raf = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
    };
    const onLeave = () => { pointer.x = -9999; };

    size();
    const ro = new ResizeObserver(size);
    ro.observe(wrap);
    if (reduce) {
      draw(2.2);
    } else {
      raf = requestAnimationFrame(loop);
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerleave", onLeave);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={wrapRef} aria-hidden style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{ fontFamily: font.mono, fontSize: 12, color: theme.textStrong, padding: "2px 7px", margin: "0 2px", borderRadius: 6, border: `1px solid ${theme.borderStrong}`, background: theme.cardBg, boxShadow: theme.shadowSoft }}>
      {children}
    </kbd>
  );
}

// Visually hidden but read by screen readers (state text behind the dots).
const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

// ── Health chips ──────────────────────────────────────────────────────────────
// Dot only knows ok/error; health degradations are "needs attention", not
// failures, so the not-ok state mirrors Dot's geometry with the warn amber.
function HealthDot({ ok }: { ok: boolean }) {
  if (ok) return <Dot ok size={8} />;
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: 9999,
        background: palette.warn,
        marginRight: 8,
        flex: "0 0 auto",
      }}
    />
  );
}

function HealthChip({ ok, label, detail }: { ok: boolean; label: string; detail?: string | null }) {
  return (
    <span
      title={ok ? "Ready" : "Needs attention"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 12,
        fontWeight: 600,
        color: theme.textBody,
        background: theme.cardBg,
        border: `1px solid ${theme.border}`,
        borderRadius: 999,
        padding: "5px 12px 5px 10px",
        boxShadow: theme.shadowSoft,
      }}
    >
      <HealthDot ok={ok} />
      {label}
      {detail && (
        <span style={{ fontFamily: font.mono, fontWeight: 500, fontSize: 11, color: theme.textFaint, marginLeft: 6 }}>
          {detail}
        </span>
      )}
      <span style={SR_ONLY}>{ok ? " - ready" : " - needs attention"}</span>
    </span>
  );
}

function HealthChips({
  health,
  networkOk,
  onDownloadModel,
  downloading,
  progressPct,
}: {
  health: Health;
  networkOk: boolean;
  onDownloadModel: () => void;
  downloading: boolean;
  progressPct: number | null;
}) {
  // Model paths come back absolute; the filename is the useful part (also handle `\`).
  const model = health.asr_model
    ? health.asr_model.replace(/\\/g, "/").split("/").pop()
    : null;
  return (
    <div
      className="home-health"
      role="status"
      aria-live="polite"
      style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 22 }}
    >
      <HealthChip ok={health.asr_ready} label="ASR model" detail={model} />
      <HealthChip ok={health.local_llm_ready} label="Local cleanup" />
      <HealthChip ok={health.microphone} label="Microphone" />
      <HealthChip ok={health.accessibility} label="Accessibility" />
      <span
        title={
          networkOk
            ? "Network online"
            : "Cloud cleanup unavailable — dictations will use local cleanup."
        }
        role="status"
        aria-label={networkOk ? "Network online" : "Network offline"}
      >
        <HealthChip ok={networkOk} label="Network" />
      </span>
      {!health.asr_ready && (
        <button
          onClick={onDownloadModel}
          disabled={downloading}
          style={{
            cursor: downloading ? "default" : "pointer",
            border: `1px solid ${theme.accentSoftBorder}`,
            borderRadius: 999,
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: font.ui,
            color: theme.accentDeep,
            background: theme.accentSoft,
          }}
        >
          {downloading
            ? `Downloading model${progressPct != null ? ` ${progressPct}%` : "..."}`
            : "Download speech model"}
        </button>
      )}
    </div>
  );
}

// ── Receipt banner ────────────────────────────────────────────────────────────
const RECEIPT_ACTION_LABEL: Record<string, string> = {
  pasted: "Pasted",
  noted: "Saved to notes",
  clipboard: "Copied to clipboard",
  pending: "Held for approval",
  error: "Not inserted",
};

function ReceiptBanner({ r, onDismiss }: { r: ReceiptEvent; onDismiss: () => void }) {
  const tint = r.ok ? theme.accentDeep : palette.error;
  const bits: string[] = [`${r.words} ${r.words === 1 ? "word" : "words"}`];
  if (r.confidence != null) bits.push(`${Math.round(r.confidence * 100)}% confidence`);
  if (r.low_words.length > 0) {
    bits.push(`${r.low_words.length} low-confidence ${r.low_words.length === 1 ? "word" : "words"}`);
  }
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "relative",
        zIndex: 1,
        marginTop: 48,
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 14,
        background: r.ok ? theme.accentSoft : "rgba(255,107,107,0.10)",
        border: `1px solid ${r.ok ? theme.accentSoftBorder : "rgba(255,107,107,0.35)"}`,
        boxShadow: theme.shadowSoft,
      }}
    >
      <Icon name={r.ok ? "check" : "close"} size={16} strokeWidth={2} style={{ color: tint, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: theme.textStrong }}>
          {RECEIPT_ACTION_LABEL[r.action] ?? r.action}
          {r.app ? ` in ${r.app}` : ""}
        </span>
        <span style={{ fontSize: 12.5, color: theme.textMuted, marginLeft: 8 }}>{bits.join(", ")}</span>
        {r.message && (
          <div style={{ fontSize: 12.5, color: r.ok ? theme.textMuted : palette.error, marginTop: 2 }}>{r.message}</div>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss receipt"
        style={{ background: "none", border: "none", cursor: "pointer", color: theme.textFaint, padding: 2, display: "inline-flex" }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

// ── Provenance badge ──────────────────────────────────────────────────────────
// Maps whimpr-core's Provenance.cleanup route to a short badge label.
function provenanceLabel(cleanup: string): string | null {
  if (!cleanup) return null; // pre-provenance history entries
  if (cleanup === "raw") return "Raw";
  if (cleanup === "local") return "Local";
  if (cleanup.startsWith("openai:")) return "OpenAI";
  if (cleanup.startsWith("anthropic:")) return "Anthropic";
  if (cleanup === "snippet") return "Snippet";
  if (cleanup.startsWith("workflow:")) return "Workflow";
  return cleanup; // unknown routes render verbatim rather than hiding
}

const BADGE_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  borderRadius: 999,
  padding: "2px 8px",
};

function ProvenanceBadge({ p }: { p?: Provenance }) {
  if (!p) return null;
  const label = provenanceLabel(p.cleanup);
  if (!label) return null;
  return (
    <>
      <span style={{ ...BADGE_STYLE, color: theme.textMuted, background: theme.cardBgSubtle, border: `1px solid ${theme.border}` }}>
        {label}
        {p.sent_to_cloud && (
          <span role="img" aria-label="Sent to cloud" title="Sent to cloud" style={{ display: "inline-flex" }}>
            <Icon name="cloud" size={11} style={{ color: theme.textFaint }} />
          </span>
        )}
      </span>
      {p.gate === "rejected" && (
        <span style={{ ...BADGE_STYLE, color: palette.error, background: "rgba(255,107,107,0.10)", border: "1px solid rgba(255,107,107,0.35)" }}>
          Gate rejected
        </span>
      )}
    </>
  );
}

// ── Raw vs final word diff ────────────────────────────────────────────────────
type DiffOp = { kind: "same" | "del" | "ins"; word: string };

// ponytail: LCS diff is O(n*m) DP, capped at 400 words per side; past the cap
// the tails render as one bulk delete + insert. Upgrade path: Myers O(ND) if
// long-form meeting transcripts make the cap visible.
const DIFF_CAP = 400;

function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] vs b[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", word: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "del", word: a[i] });
      i++;
    } else {
      ops.push({ kind: "ins", word: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "del", word: a[i++] });
  while (j < m) ops.push({ kind: "ins", word: b[j++] });
  return ops;
}

function diffWords(rawText: string, finalText: string): DiffOp[] {
  const a = rawText.split(/\s+/).filter(Boolean);
  const b = finalText.split(/\s+/).filter(Boolean);
  const ops = lcsDiff(a.slice(0, DIFF_CAP), b.slice(0, DIFF_CAP));
  for (const word of a.slice(DIFF_CAP)) ops.push({ kind: "del", word });
  for (const word of b.slice(DIFF_CAP)) ops.push({ kind: "ins", word });
  return ops;
}

function WordDiff({ raw, final }: { raw: string; final: string }) {
  const ops = useMemo(() => diffWords(raw, final), [raw, final]);
  return (
    <div style={{ fontSize: 13, lineHeight: 1.7, color: theme.textBody }}>
      {ops.map((op, i) => (
        <span key={i}>
          {op.kind === "del" ? (
            <span style={{ color: palette.error, textDecoration: "line-through", opacity: 0.85 }}>{op.word}</span>
          ) : op.kind === "ins" ? (
            <span style={{ background: theme.accentSoft, color: theme.accentDeep, borderRadius: 4, padding: "0 3px" }}>
              {op.word}
            </span>
          ) : (
            op.word
          )}
          {i < ops.length - 1 ? " " : ""}
        </span>
      ))}
    </div>
  );
}

// ── Low-confidence words + add-to-dictionary popover ──────────────────────────
// "Hello," -> "Hello": strip edge punctuation, keeping the original casing so
// the popover can pre-fill proper nouns as spoken.
function stripEdgePunct(w: string): string {
  return w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

// Lowercased on top, so low_words entries match tokens case-insensitively.
function normWord(w: string): string {
  return stripEdgePunct(w).toLowerCase();
}

function DictPopover({ word, onClose }: { word: string; onClose: () => void }) {
  const [correct, setCorrect] = useState(word);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const fixed = correct.trim();
    if (!fixed || busy) return;
    setBusy(true);
    // The heard form only counts as a mishear when the spelling was changed.
    await addDictionaryEntry(fixed, fixed.toLowerCase() === word.toLowerCase() ? [] : [word]);
    onClose();
  };
  return (
    <div
      role="dialog"
      aria-label={`Add "${word}" to dictionary`}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 20,
        width: 236,
        background: theme.cardBg,
        border: `1px solid ${theme.borderStrong}`,
        borderRadius: 12,
        boxShadow: theme.shadow,
        padding: 12,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: theme.textFaint, marginBottom: 7 }}>
        Add to dictionary
      </div>
      <input
        autoFocus
        value={correct}
        onChange={(e) => setCorrect(e.target.value)}
        aria-label="Correct spelling"
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") onClose();
        }}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: theme.cardBgSubtle,
          border: `1px solid ${theme.border}`,
          borderRadius: 9,
          padding: "7px 10px",
          color: theme.textBody,
          fontFamily: font.ui,
          fontSize: 13,
          outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
        <Button size="sm" variant="accent" disabled={busy || !correct.trim()} onClick={() => void save()}>
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function LowWordText({ text, lowWords }: { text: string; lowWords: string[] }) {
  const [pick, setPick] = useState<number | null>(null);
  if (!lowWords || lowWords.length === 0) return <>{text}</>;
  const low = new Set(lowWords.map(normWord).filter(Boolean));
  const tokens = text.split(/(\s+)/);
  return (
    <>
      {tokens.map((tok, idx) => {
        const w = normWord(tok);
        if (!tok.trim() || !w || !low.has(w)) return <span key={idx}>{tok}</span>;
        // Case-preserved for the popover: an unedited Add must not teach the
        // dictionary a lowercased "kubernetes" for a spoken "Kubernetes".
        const word = stripEdgePunct(tok);
        return (
          <span key={idx} style={{ position: "relative", display: "inline-block" }}>
            <button
              onClick={() => setPick(pick === idx ? null : idx)}
              aria-label={`Add "${word}" to dictionary`}
              title="Low confidence - click to add to dictionary"
              style={{
                background: "none",
                border: "none",
                padding: 0,
                margin: 0,
                cursor: "pointer",
                font: "inherit",
                color: "inherit",
                textDecorationLine: "underline",
                textDecorationStyle: "dotted",
                textDecorationColor: palette.warn,
                textDecorationThickness: 2,
                textUnderlineOffset: 3,
              }}
            >
              {tok}
            </button>
            {pick === idx && <DictPopover word={word} onClose={() => setPick(null)} />}
          </span>
        );
      })}
    </>
  );
}

// ── History row ───────────────────────────────────────────────────────────────
function HistoryRow({ it }: { it: HistoryItem }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyRaw = () => {
    navigator.clipboard
      .writeText(it.raw ?? "")
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <div style={{ display: "flex", gap: 14, padding: "11px 4px", borderBottom: `1px solid ${theme.border}` }}>
      <div style={{ flex: "0 0 72px", fontSize: 12, color: theme.textFaint, fontVariantNumeric: "tabular-nums", paddingTop: 1 }}>
        {fmtTimeOfDay(new Date(it.ts_unix * 1000))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: theme.textBody }}>
          <LowWordText text={it.text} lowWords={it.low_words ?? []} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
          {it.app && <span style={{ fontSize: 11, color: theme.textFaint }}>{it.app}</span>}
          <ProvenanceBadge p={it.provenance} />
          {it.raw && (
            <button
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 11, fontWeight: 600, color: theme.accentDeep, fontFamily: font.ui }}
            >
              {open ? "Hide raw" : "Raw vs final"}
            </button>
          )}
        </div>
        {open && it.raw && (
          <div style={{ marginTop: 8, background: theme.cardBgSubtle, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: theme.textFaint }}>
                Raw vs final
              </span>
              <Button size="sm" variant="ghost" onClick={copyRaw}>
                {copied ? "Copied" : "Copy raw"}
              </Button>
            </div>
            <WordDiff raw={it.raw} final={it.text} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Recent dictations ─────────────────────────────────────────────────────────
type Group = { key: string; label: string; items: HistoryItem[] };
function groupByDay(items: HistoryItem[]): Group[] {
  const now = new Date();
  const groups: Group[] = [];
  const index = new Map<string, Group>();
  for (const it of items) {
    const d = new Date(it.ts_unix * 1000);
    const k = dayKey(d);
    let g = index.get(k);
    if (!g) { g = { key: k, label: dayLabel(d, now), items: [] }; index.set(k, g); groups.push(g); }
    g.items.push(it);
  }
  return groups;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function Home() {
  const stats = useStats();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [networkOk, setNetworkOk] = useState(true);
  const [health, setHealth] = useState<Health>({
    asr_ready: false,
    asr_model: null,
    local_llm_ready: false,
    microphone: false,
    accessibility: false,
  });
  const [receipt, setReceipt] = useState<ReceiptEvent | null>(null);
  const [downloadingModel, setDownloadingModel] = useState(false);
  const [modelPct, setModelPct] = useState<number | null>(null);
  const [corruptModel, setCorruptModel] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isWindows = detectPlatformSync() === "windows";
  const pttLabel = isWindows ? "Right Ctrl" : "Fn";
  const wordsRef = useRef<HTMLDivElement | null>(null);
  const wpmRef = useRef<HTMLDivElement | null>(null);
  const streakRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => getHistory().then((h) => alive && setHistory(h));
    load();
    const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      void checkNetwork().then((ok) => {
        if (alive) setNetworkOk(ok);
      });
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Health chips poll on the same cadence as history (permissions and model
  // readiness can change while the Hub is open).
  useEffect(() => {
    let alive = true;
    const load = () => getHealth().then((h) => alive && setHealth(h));
    load();
    const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Insertion receipts arrive as live shell events only (no polling); a new
  // receipt replaces the last one, dismissing clears the strip.
  useEffect(() => {
    let alive = true;
    let off: (() => void) | null = null;
    onReceipt((r) => {
      if (alive) setReceipt(r);
    }).then((un) => {
      if (alive) off = un;
      else un();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  useEffect(() => {
    let un: (() => void) | undefined;
    void listen<ModelProgress>("whimpr://model/progress", (e) => {
      const { downloaded, total } = e.payload;
      if (total > 0) setModelPct(Math.min(100, Math.round((downloaded / total) * 100)));
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, []);

  useEffect(() => {
    let un: (() => void) | undefined;
    void listen<{ path?: string; error?: string }>("whimpr://model/corrupt", (e) => {
      setCorruptModel(e.payload?.path || "speech model");
      toast.error("Speech model appears corrupt");
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, []);

  const downloadModel = async () => {
    setDownloadingModel(true);
    setModelPct(0);
    try {
      await downloadAsrModel("base.en");
      const h = await getHealth();
      setHealth(h);
    } catch {
      /* toast surface lands later; health chip stays red */
    } finally {
      setDownloadingModel(false);
      setModelPct(null);
    }
  };

  // Entrance timeline + scroll-reveal (advanced GSAP: staggered clip reveal,
  // hairline draw, and ScrollTrigger-driven row reveals on the <main> scroller).
  useLayoutEffect(() => {
    if (prefersReduced() || document.hidden) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: EASE } });
      tl.from(".home-eyebrow", { opacity: 0, y: 12, duration: 0.6 })
        .from(".home-line > span", { yPercent: 115, duration: 0.9, stagger: 0.12, ease: EASE_EXPO }, "-=0.35")
        .from(".home-sub", { opacity: 0, y: 16, duration: 0.6 }, "-=0.5")
        .from(".home-cta > *", { opacity: 0, y: 14, duration: 0.5, stagger: 0.08 }, "-=0.35")
        .from(".home-health > *", { opacity: 0, y: 10, duration: 0.45, stagger: 0.06 }, "-=0.3")
        .from(".home-hairline", { scaleX: 0, transformOrigin: "left center", duration: 0.8, ease: "power4.inOut" }, "-=0.3")
        .from(".home-figure", { opacity: 0, y: 20, duration: 0.6, stagger: 0.09 }, "-=0.55");

      const scroller = scrollerEl() || undefined;
      gsap.utils.toArray<HTMLElement>(".home-reveal").forEach((el) => {
        gsap.from(el, {
          opacity: 0, y: 26, duration: 0.7, ease: EASE,
          scrollTrigger: { trigger: el, scroller, start: "top 92%", once: true },
        });
      });
    }, rootRef);
    return () => ctx.revert();
  }, []);

  // GSAP count-up on the stat figures; re-runs as polled stats change.
  useEffect(() => {
    const targets: [HTMLDivElement | null, number][] = [
      [wordsRef.current, stats.total_words],
      [wpmRef.current, stats.avg_wpm],
      [streakRef.current, stats.day_streak],
    ];
    if (prefersReduced() || document.hidden) {
      targets.forEach(([el, v], i) => { if (el) el.textContent = i === 2 ? `${v}${v === 1 ? " day" : " days"}` : fmtNum(v); });
      return;
    }
    const tweens = targets.map(([el, target], i) => {
      if (!el) return null;
      const obj = { v: Number(el.dataset.v || 0) };
      return gsap.to(obj, {
        v: target, duration: 1.1, ease: EASE,
        onUpdate: () => {
          const n = Math.round(obj.v);
          el.dataset.v = String(n);
          el.textContent = i === 2 ? `${n}${n === 1 ? " day" : " days"}` : fmtNum(n);
        },
      });
    });
    return () => { tweens.forEach((t) => t && t.kill()); };
  }, [stats.total_words, stats.avg_wpm, stats.day_streak]);

  const today = stats.words_today;
  const q = debouncedQuery;
  const filtered = q ? history.filter((h) => h.text.toLowerCase().includes(q)) : history;
  const groups = groupByDay(filtered);
  const lines = ["Speak it.", "See it typed."];

  return (
    <div ref={rootRef} style={{ position: "relative", minHeight: "calc(100vh - 72px)" }}>
      <style>{HOME_CSS}</style>
      <VoiceField />

      {/* Hero */}
      <div style={{ position: "relative", zIndex: 1, paddingTop: 8 }}>
        <div className="home-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 9, fontFamily: font.ui, fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: theme.accentDeep }}>
          <span className="home-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: theme.accent, display: "inline-block" }} />
          Ready to dictate
        </div>

        <h1 style={{ fontFamily: font.serif, fontWeight: 600, letterSpacing: -2.4, lineHeight: 0.92, color: theme.textStrong, fontSize: "clamp(48px, 8.2vw, 92px)", margin: "18px 0 0" }}>
          {lines.map((line, i) => (
            <span className="home-line" key={i}>
              <span style={{ display: "block", color: i === lines.length - 1 ? theme.accentDeep : theme.textStrong }}>{line}</span>
            </span>
          ))}
        </h1>

        <p className="home-sub" style={{ maxWidth: 528, margin: "22px 0 0", fontSize: 16, lineHeight: 1.62, color: theme.textMuted }}>
          Hold <Kbd>{pttLabel}</Kbd> and speak. WhimprFlow removes filler and false starts, then places clean text at your cursor. No window to open, nothing to paste.
        </p>

        <div className="home-cta" style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 26, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "10px 15px", borderRadius: 999, background: theme.solidBg, color: theme.solidText, fontSize: 13.5, fontWeight: 600, boxShadow: theme.shadow }}>
            <Icon name="mic" size={16} strokeWidth={1.9} style={{ color: theme.accentBright }} />
            Hold {pttLabel} to dictate
          </span>
          {today > 0 && (
            <span style={{ fontSize: 13.5, color: theme.textMuted }}>
              <b style={{ color: theme.textStrong, fontVariantNumeric: "tabular-nums" }}>{fmtNum(today)}</b> words dictated today
            </span>
          )}
        </div>

        <HealthChips
          health={health}
          networkOk={networkOk}
          onDownloadModel={() => void downloadModel()}
          downloading={downloadingModel}
          progressPct={modelPct}
        />
      </div>

      {/* Editorial stat strip */}
      <div style={{ position: "relative", zIndex: 1, marginTop: 44 }}>
        <div className="home-hairline" style={{ height: 1, background: theme.borderStrong, marginBottom: 22 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "26px 52px" }}>
          <Figure numRef={wordsRef} label="words dictated" accent />
          <Figure numRef={wpmRef} label="avg words / min" />
          <Figure numRef={streakRef} label="current streak" />
          <Figure staticValue={stats.time_saved_secs > 0 ? fmtDuration(stats.time_saved_secs) : "0 min"} label="saved vs typing" />
        </div>
      </div>

      {/* Insertion receipt (live event; dismissible) */}
      {receipt && <ReceiptBanner r={receipt} onDismiss={() => setReceipt(null)} />}

      {corruptModel && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            position: "relative",
            zIndex: 1,
            marginTop: 16,
            padding: "14px 16px",
            borderRadius: 14,
            border: "1px solid rgba(180, 35, 24, 0.35)",
            background: "rgba(180, 35, 24, 0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13.5, color: theme.textStrong }}>
            Speech model appears corrupt.
          </div>
          <Button
            onClick={() => {
              void (async () => {
                setDownloadingModel(true);
                try {
                  await downloadAsrModel("base.en");
                  await reloadAsr();
                  setCorruptModel(null);
                  toast.success("Model re-downloaded");
                  setHealth(await getHealth());
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : String(e));
                } finally {
                  setDownloadingModel(false);
                }
              })();
            }}
          >
            Re-download
          </Button>
        </div>
      )}

      {/* Recent dictations. overflow stays visible so the add-to-dictionary
          popover can escape the card edge (no child paints past the radius). */}
      <div className="home-reveal" style={{ position: "relative", zIndex: 1, marginTop: receipt ? 16 : 48, background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 18, boxShadow: theme.shadow }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 20px", borderBottom: `1px solid ${theme.border}`, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.7, textTransform: "uppercase", color: theme.textFaint }}>Recent dictations</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              aria-label="Export transcripts"
              onClick={() => {
                void exportHistory("txt")
                  .then((path) => toast.success(`Exported to ${path}`))
                  .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
              }}
              style={{
                cursor: "pointer",
                border: `1px solid ${theme.border}`,
                borderRadius: 9,
                padding: "6px 10px",
                fontSize: 12.5,
                fontWeight: 600,
                fontFamily: font.ui,
                color: theme.textStrong,
                background: theme.cardBgSubtle,
              }}
            >
              Export transcripts
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 7, background: theme.cardBgSubtle, border: `1px solid ${theme.border}`, borderRadius: 9, padding: "6px 10px", minWidth: 180 }}>
              <Icon name="search" size={15} style={{ color: theme.textFaint }} />
              <input
                aria-label="Search history"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search history"
                style={{ border: "none", outline: "none", background: "transparent", fontFamily: font.ui, fontSize: 13, color: theme.textBody, width: "100%" }}
              />
            </div>
          </div>
        </div>
        <div style={{ padding: "4px 20px 16px" }}>
          {history.length === 0 ? (
            <div style={{ padding: "16px 0" }}>
              <EmptyState
                title="No dictations yet"
                body={`Hold your dictation key (${pttLabel}) and start speaking.`}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "44px 8px", textAlign: "center", color: theme.textFaint, fontSize: 13.5 }}>No dictations match “{query}”.</div>
          ) : (
            groups.map((g) => (
              <div key={g.key} style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: theme.accentDeep, marginBottom: 2 }}>{g.label}</div>
                {g.items.map((it, i) => (
                  <HistoryRow key={`${it.ts_unix}-${i}`} it={it} />
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Figure({ numRef, staticValue, label, accent }: { numRef?: React.Ref<HTMLDivElement>; staticValue?: string; label: string; accent?: boolean }) {
  return (
    <div className="home-figure" style={{ minWidth: 0 }}>
      <div
        ref={numRef}
        data-v="0"
        style={{ fontFamily: font.serif, fontSize: "clamp(30px, 4.4vw, 46px)", fontWeight: 600, lineHeight: 1, letterSpacing: -1, color: accent ? theme.accentDeep : theme.textStrong, fontVariantNumeric: "tabular-nums" }}
      >
        {staticValue ?? "0"}
      </div>
      <div style={{ marginTop: 9, fontSize: 11, fontWeight: 600, letterSpacing: 0.8, textTransform: "uppercase", color: theme.textFaint }}>{label}</div>
    </div>
  );
}
