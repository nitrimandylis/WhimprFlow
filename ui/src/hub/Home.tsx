import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { font } from "../tokens/values";
import { theme } from "./theme";
import { useStats } from "./ui";
import { Icon } from "./icons";
import { getHistory, type HistoryItem } from "./api";
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

// ── History row ───────────────────────────────────────────────────────────────
function HistoryRow({ it }: { it: HistoryItem }) {
  return (
    <div style={{ display: "flex", gap: 14, padding: "11px 4px", borderBottom: `1px solid ${theme.border}` }}>
      <div style={{ flex: "0 0 72px", fontSize: 12, color: theme.textFaint, fontVariantNumeric: "tabular-nums", paddingTop: 1 }}>
        {fmtTimeOfDay(new Date(it.ts_unix * 1000))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: theme.textBody }}>{it.text}</div>
        {it.app && (
          <div style={{ fontSize: 11, color: theme.textFaint, marginTop: 4 }}>{it.app}</div>
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

      {/* Recent dictations */}
      <div className="home-reveal" style={{ position: "relative", zIndex: 1, marginTop: 48, background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 18, boxShadow: theme.shadow }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 20px", borderBottom: `1px solid ${theme.border}`, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.7, textTransform: "uppercase", color: theme.textFaint }}>Recent dictations</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
