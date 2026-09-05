import { useState } from "react";
import { Empty, Group, GroupTitle, PageHeader, Row, useStats } from "./ui";
import { fmtDuration, fmtNum } from "./format";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/// Words per day for the last seven days. One series, so the title names it
/// and there is no legend; the figures below double as the table view.
function WeekChart({ data, today }: { data: number[]; today: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data);
  const todayIdx = new Date().getDay();
  const label = (i: number) => (i === data.length - 1 ? "Today" : DOW[(todayIdx - (data.length - 1 - i) + 7) % 7]);
  return (
    <div className="chart" role="img" aria-label="Words dictated per day, last seven days">
      <div className="chart-title">
        Words per day
        <span>{fmtNum(today)} today</span>
      </div>
      <div className="chart-plot">
        {data.map((v, i) => (
          <div
            key={i}
            className="chart-col"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {hover === i && <div className="chart-tip">{fmtNum(v)} words</div>}
            <div className={`chart-bar${v > 0 ? "" : " zero"}`} style={{ height: `${v > 0 ? Math.max(3, (v / max) * 100) : 2}%` }} />
          </div>
        ))}
      </div>
      <div className="chart-axis">
        {data.map((_, i) => <div key={i}>{label(i)}</div>)}
      </div>
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Row label={label} hint={hint}>
      <span className="figure">{value}</span>
    </Row>
  );
}

export function Insights() {
  const stats = useStats();
  const activeDays = stats.last7_words.filter((v) => v > 0).length;
  const averageSession = stats.total_sessions > 0 ? Math.round(stats.total_words / stats.total_sessions) : 0;

  return (
    <>
      <PageHeader title="Insights" />
      <div className="pane-scroll">
        {stats.total_sessions === 0 ? (
          <Empty title="No data yet" body="Numbers show up here after your first dictation." />
        ) : (
          <div className="form">
            <Group>
              <WeekChart data={stats.last7_words} today={stats.words_today} />
            </Group>

            <GroupTitle>This week</GroupTitle>
            <Group>
              <Figure label="Active days" value={`${activeDays} of 7`} />
              <Figure label="Streak" value={`${stats.day_streak} ${stats.day_streak === 1 ? "day" : "days"}`} hint="Consecutive days with at least one dictation." />
              <Figure label="Pace today" value={`${fmtNum(stats.wpm_today)} words/min`} />
            </Group>

            <GroupTitle>All time</GroupTitle>
            <Group>
              <Figure label="Words dictated" value={fmtNum(stats.total_words)} />
              <Figure label="Dictations" value={fmtNum(stats.total_sessions)} />
              <Figure label="Average dictation" value={`${fmtNum(averageSession)} words`} />
              <Figure label="Average pace" value={`${fmtNum(stats.avg_wpm)} words/min`} />
              <Figure label="Best pace" value={`${fmtNum(stats.best_wpm)} words/min`} />
              <Figure label="Time saved" value={fmtDuration(stats.time_saved_secs)} hint="Compared with typing at 45 words per minute." />
            </Group>
          </div>
        )}
      </div>
    </>
  );
}
