import { font } from "../tokens/values";
import { theme } from "./theme";
import { Card, PageTitle, useStats } from "./ui";
import type { StatsSummary } from "./api";
import { fmtCompact, fmtDuration, fmtNum, newsArticles } from "./format";
import { EmptyState } from "./EmptyState";

// ── Semicircular gauge ───────────────────────────────────────────────────────
function Gauge({ value, max }: { value: number; max: number }) {
  const frac = Math.max(0, Math.min(1, value / max));
  const r = 58;
  const cx = 80;
  const cy = 72;
  const len = Math.PI * r;
  const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <div style={{ position: "relative", width: 160, height: 88, margin: "0 auto" }}>
      <svg width="160" height="88" viewBox="0 0 160 88">
        <path d={d} fill="none" stroke={theme.track} strokeWidth="12" strokeLinecap="round" />
        <path
          d={d}
          fill="none"
          stroke={theme.accent}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - frac)}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 2,
          textAlign: "center",
        }}
      >
        <div style={{ fontFamily: font.serif, fontSize: 34, fontWeight: 600, color: theme.textStrong, lineHeight: 1 }}>
          {fmtNum(value)}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  children,
  foot,
}: {
  label: string;
  children: React.ReactNode;
  foot?: React.ReactNode;
}) {
  return (
    <Card style={{ flex: "1 1 200px", minWidth: 0 }}>
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: theme.textFaint,
          marginBottom: 14,
        }}
      >
        {label}
      </div>
      {children}
      {foot && <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 12, textAlign: "center" }}>{foot}</div>}
    </Card>
  );
}

function BigNumber({ value, accent }: { value: string; accent?: boolean }) {
  return (
    <div
      style={{
        fontFamily: font.serif,
        fontSize: 44,
        fontWeight: 600,
        lineHeight: 1,
        textAlign: "center",
        color: accent ? theme.accentDeep : theme.textStrong,
      }}
    >
      {value}
    </div>
  );
}

// ── 7-day bar chart ──────────────────────────────────────────────────────────
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function ActivityBars({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  const todayIdx = new Date().getDay(); // 0..6, last bar = today
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 120 }}>
        {data.map((v, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
            <div
              title={`${fmtNum(v)} words`}
              style={{
                height: `${v > 0 ? Math.max(6, (v / max) * 100) : 3}%`,
                background: v > 0 ? theme.accent : theme.track,
                borderRadius: 6,
                transition: "height 240ms ease",
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {data.map((_, i) => {
          // Map the 7 bars onto weekday initials ending at today.
          const dow = (todayIdx - (data.length - 1 - i) + 7) % 7;
          return (
            <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10.5, color: theme.textFaint }}>
              {i === data.length - 1 ? "Today" : DOW[dow]}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Week strip (one square per day, real data only) ─────────────────────────

function level(v: number, max: number): number {
  if (v <= 0) return 0;
  const r = v / max;
  if (r < 0.25) return 1;
  if (r < 0.5) return 2;
  if (r < 0.75) return 3;
  return 4;
}

const HEAT_COLORS = [theme.track, "rgba(34,195,182,0.28)", "rgba(34,195,182,0.5)", "rgba(34,195,182,0.72)", theme.accentDeep];

function WeekStrip({ last7 }: { last7: number[] }) {
  const max = Math.max(1, ...last7);
  const todayIdx = new Date().getDay();
  return (
    <div style={{ display: "flex", gap: 5 }}>
      {last7.map((v, i) => {
        const dow = (todayIdx - (last7.length - 1 - i) + 7) % 7;
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div
              title={v > 0 ? `${fmtNum(v)} words` : "no activity"}
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                background: HEAT_COLORS[level(v, max)],
              }}
            />
            <div style={{ fontSize: 9.5, color: theme.textFaint }}>
              {i === last7.length - 1 ? "T" : DOW[dow]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Seven day trend sparkline ────────────────────────────────────────────────
function TrendLine({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  const width = 360;
  const height = 116;
  const points = data.map((value, index) => {
    const x = (index / Math.max(1, data.length - 1)) * width;
    const y = height - 14 - (value / max) * (height - 28);
    return `${x},${y}`;
  }).join(" ");
  const fill = `0,${height} ${points} ${width},${height}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="132" preserveAspectRatio="none" aria-label="Seven day dictation trend" role="img">
      {[0.25, 0.5, 0.75].map((line) => <line key={line} x1="0" x2={width} y1={height * line} y2={height * line} stroke={theme.border} strokeDasharray="3 5" />)}
      <polygon points={fill} fill="rgba(34,195,182,0.13)" />
      <polyline points={points} fill="none" stroke={theme.accentDeep} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((value, index) => {
        const x = (index / Math.max(1, data.length - 1)) * width;
        const y = height - 14 - (value / max) * (height - 28);
        return <circle key={index} cx={x} cy={y} r="4.5" fill={theme.cardBg} stroke={theme.accentDeep} strokeWidth="2.5"><title>{`${fmtNum(value)} words`}</title></circle>;
      })}
    </svg>
  );
}

// ── Consistency ring ─────────────────────────────────────────────────────────
function ConsistencyRing({ activeDays }: { activeDays: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const fraction = activeDays / 7;
  return (
    <div style={{ display: "grid", placeItems: "center", position: "relative", width: 108, height: 108 }}>
      <svg width="108" height="108" viewBox="0 0 108 108" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="54" cy="54" r={radius} fill="none" stroke={theme.track} strokeWidth="10" />
        <circle cx="54" cy="54" r={radius} fill="none" stroke={theme.accent} strokeWidth="10" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - fraction)} />
      </svg>
      <div style={{ position: "absolute", textAlign: "center" }}>
        <div style={{ fontFamily: font.serif, color: theme.textStrong, fontSize: 24, lineHeight: 1 }}>{activeDays}/7</div>
        <div style={{ color: theme.textFaint, fontSize: 10, marginTop: 4 }}>active days</div>
      </div>
    </div>
  );
}


function UsageTab({ stats }: { stats: StatsSummary }) {
  const activeDays = stats.last7_words.filter((value) => value > 0).length;
  const weeklyWords = stats.last7_words.reduce((total, value) => total + value, 0);
  const averageSession = stats.total_sessions > 0 ? Math.round(stats.total_words / stats.total_sessions) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Top row — three stat cards */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
        <StatCard label="Words per minute" foot={`avg ${fmtNum(stats.avg_wpm)} WPM`}>
          <Gauge value={stats.avg_wpm} max={140} />
        </StatCard>

        <StatCard label="Fixes made by WhimprFlow" foot="dictations cleaned">
          <BigNumber value={fmtCompact(stats.total_sessions)} accent />
        </StatCard>

        <StatCard label="Total words dictated" foot={`≈ ${fmtNum(newsArticles(stats.total_words))} news articles`}>
          <BigNumber value={fmtCompact(stats.total_words)} />
        </StatCard>
      </div>

      {/* Bottom row — activity + streak */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
        <Card style={{ flex: "1 1 340px", minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>7-day activity</div>
            <div style={{ fontSize: 12, color: theme.textFaint }}>{fmtNum(stats.words_today)} today</div>
          </div>
          <ActivityBars data={stats.last7_words} />
        </Card>

        <Card style={{ flex: "1 1 300px", minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>Streak</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: theme.accentDeep }}>
              🔥 {stats.day_streak} {stats.day_streak === 1 ? "day" : "days"}
            </div>
          </div>
          <WeekStrip last7={stats.last7_words} />
          <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 14 }}>
            Keep the streak alive by dictating something every day.
          </div>
        </Card>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
        <Card style={{ flex: "2 1 480px", minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>Weekly momentum</div>
            <div style={{ fontSize: 12, color: theme.accentDeep }}>{fmtNum(weeklyWords)} words this week</div>
          </div>
          <TrendLine data={stats.last7_words} />
          <div style={{ display: "flex", justifyContent: "space-between", color: theme.textFaint, fontSize: 11, marginTop: -4 }}><span>6 days ago</span><span>Today</span></div>
        </Card>

        <Card style={{ flex: "1 1 230px", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>Consistency</div>
            <p style={{ margin: "7px 0 0", color: theme.textMuted, fontSize: 12.5, lineHeight: 1.45 }}>A little daily dictation makes the workflow automatic.</p>
          </div>
          <ConsistencyRing activeDays={activeDays} />
        </Card>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
        <StatCard label="Time reclaimed" foot="estimated against typing at 45 WPM">
          <BigNumber value={fmtDuration(stats.time_saved_secs)} accent />
        </StatCard>
        <StatCard label="Average session" foot="words per completed dictation">
          <BigNumber value={fmtNum(averageSession)} />
        </StatCard>
        <StatCard label="Fastest pace" foot={`today: ${fmtNum(stats.wpm_today)} WPM`}>
          <BigNumber value={`${fmtNum(stats.best_wpm)} WPM`} accent />
        </StatCard>
      </div>
    </div>
  );
}

export function Insights() {
  const stats = useStats();
  return (
    <div style={{ maxWidth: 1000 }}>
      <PageTitle>Insights</PageTitle>
      {stats.total_sessions === 0 ? (
        <EmptyState
          title="No dictations yet"
          body="Hold your dictation key and start speaking."
        />
      ) : (
        <UsageTab stats={stats} />
      )}
    </div>
  );
}
