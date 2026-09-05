import { useEffect, useState } from "react";
import { Button, Empty, Kbd, PageHeader } from "./ui";
import { Icon } from "./icons";
import { copyToClipboard, getHistory, type HistoryItem, type Settings } from "./api";
import { dayKey, dayLabel, fmtTimeOfDay } from "./format";
import { useToast } from "./Toast";

type Group = { key: string; label: string; items: HistoryItem[] };

function groupByDay(items: HistoryItem[]): Group[] {
  const now = new Date();
  const groups: Group[] = [];
  const index = new Map<string, Group>();
  for (const it of items) {
    const d = new Date(it.ts_unix * 1000);
    const k = dayKey(d);
    let g = index.get(k);
    if (!g) {
      g = { key: k, label: dayLabel(d, now), items: [] };
      index.set(k, g);
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}

const PTT_LABEL: Record<Settings["push_to_talk_key"], string> = {
  fn: "fn",
  right_command: "right ⌘",
  right_option: "right ⌥",
  right_control: "right ⌃",
};

export function History({ settings }: { settings: Settings }) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    const load = () => getHistory(500).then((h) => alive && setHistory(h));
    load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? history.filter((h) => h.text.toLowerCase().includes(q)) : history;
  const groups = groupByDay(filtered);
  const key = PTT_LABEL[settings.push_to_talk_key];

  async function copy(text: string) {
    if (await copyToClipboard(text)) toast.success("Copied");
  }

  return (
    <>
      <PageHeader title="History">
        <input
          type="search"
          aria-label="Search history"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </PageHeader>
      <div className="pane-scroll">
        {history.length === 0 ? (
          <Empty title="Nothing dictated yet" body={<>Hold <Kbd>{key}</Kbd> in any app and speak. Your text lands at the cursor and a copy shows up here.</>} />
        ) : filtered.length === 0 ? (
          <Empty title="No matches" body={`Nothing in your history contains “${query}”.`} />
        ) : (
          <div className="history">
            {groups.map((g) => (
              <section key={g.key}>
                <div className="history-day">{g.label}</div>
                {g.items.map((it, i) => (
                  <div className="history-item" key={`${it.ts_unix}-${i}`}>
                    <div className="history-time">{fmtTimeOfDay(new Date(it.ts_unix * 1000))}</div>
                    <div className="history-text">
                      {it.text}
                      {it.app && <div className="history-app">{it.app}</div>}
                    </div>
                    <div className="history-copy">
                      <Button variant="plain" title="Copy" onClick={() => void copy(it.text)}>
                        <Icon name="copy" size={14} />
                      </Button>
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
