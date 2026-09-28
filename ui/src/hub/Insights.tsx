import { useState } from "react";
import { Empty, Group, GroupTitle, PageHeader, Row, useStats } from "./ui";
import { fmtDuration, fmtNum } from "./format";
import { useT, type T } from "../i18n";

const DOW_KEYS = ["insights.dow.sun", "insights.dow.mon", "insights.dow.tue", "insights.dow.wed", "insights.dow.thu", "insights.dow.fri", "insights.dow.sat"];

/// Words per day for the last seven days. One series, so the title names it
/// and there is no legend; the figures below double as the table view.
function WeekChart({ data, today, t }: { data: number[]; today: number; t: T }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data);
  const todayIdx = new Date().getDay();
  const label = (i: number) => (i === data.length - 1 ? t("common.today") : t(DOW_KEYS[(todayIdx - (data.length - 1 - i) + 7) % 7]));
  return (
    <div className="chart" role="img" aria-label={t("insights.chart.ariaLabel")}>
      <div className="chart-title">
        {t("insights.chart.title")}
        <span>{t("insights.chart.todayCount", { count: fmtNum(today) })}</span>
      </div>
      <div className="chart-plot">
        {data.map((v, i) => (
          <div
            key={i}
            className="chart-col"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {hover === i && <div className="chart-tip">{t("insights.chart.wordsTip", { count: fmtNum(v) })}</div>}
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
  const t = useT();
  const stats = useStats();
  const activeDays = stats.last7_words.filter((v) => v > 0).length;
  const averageSession = stats.total_sessions > 0 ? Math.round(stats.total_words / stats.total_sessions) : 0;

  return (
    <>
      <PageHeader title={t("sidebar.nav.insights")} />
      <div className="pane-scroll">
        {stats.total_sessions === 0 ? (
          <Empty title={t("insights.empty.title")} body={t("insights.empty.body")} />
        ) : (
          <div className="form">
            <Group>
              <WeekChart data={stats.last7_words} today={stats.words_today} t={t} />
            </Group>

            <GroupTitle>{t("insights.group.thisWeek")}</GroupTitle>
            <Group>
              <Figure label={t("insights.figure.activeDays")} value={t("insights.figure.activeDaysValue", { count: activeDays })} />
              <Figure
                label={t("insights.figure.streak")}
                value={`${stats.day_streak} ${stats.day_streak === 1 ? t("common.day") : t("common.days")}`}
                hint={t("insights.figure.streak.hint")}
              />
              <Figure label={t("insights.figure.paceToday")} value={t("insights.unit.wordsPerMin", { count: fmtNum(stats.wpm_today) })} />
            </Group>

            <GroupTitle>{t("insights.group.allTime")}</GroupTitle>
            <Group>
              <Figure label={t("insights.figure.wordsDictated")} value={fmtNum(stats.total_words)} />
              <Figure label={t("insights.figure.dictations")} value={fmtNum(stats.total_sessions)} />
              <Figure label={t("insights.figure.avgDictation")} value={t("insights.unit.words", { count: fmtNum(averageSession) })} />
              <Figure label={t("insights.figure.avgPace")} value={t("insights.unit.wordsPerMin", { count: fmtNum(stats.avg_wpm) })} />
              <Figure label={t("insights.figure.bestPace")} value={t("insights.unit.wordsPerMin", { count: fmtNum(stats.best_wpm) })} />
              <Figure label={t("insights.figure.timeSaved")} value={fmtDuration(stats.time_saved_secs)} hint={t("insights.figure.timeSaved.hint")} />
            </Group>
          </div>
        )}
      </div>
    </>
  );
}
