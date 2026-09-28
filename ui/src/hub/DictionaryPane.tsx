import { useEffect, useState } from "react";
import { Button, Empty, Group, GroupTitle, PageHeader, Row } from "./ui";
import { Icon } from "./icons";
import { addDictionaryEntry, getDictionary, removeDictionaryEntry, type DictEntry } from "./api";
import { useT } from "../i18n";

type Tab = "all" | "manual" | "auto";
const TAB_KEYS: { key: Tab; labelKey: string }[] = [
  { key: "all", labelKey: "common.all" },
  { key: "manual", labelKey: "dictionary.tab.manual" },
  { key: "auto", labelKey: "dictionary.tab.auto" },
];

function AddForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [correct, setCorrect] = useState("");
  const [heard, setHeard] = useState("");

  const submit = async () => {
    const word = correct.trim();
    if (!word) return;
    const mishears = heard.split(",").map((s) => s.trim()).filter(Boolean);
    await addDictionaryEntry(word, mishears);
    onDone();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void submit();
    if (e.key === "Escape") onDone();
  };

  return (
    <>
      <GroupTitle>{t("dictionary.addForm.title")}</GroupTitle>
      <Group>
        <Row label={t("dictionary.addForm.word.label")} hint={t("dictionary.addForm.word.hint")}>
          <input autoFocus value={correct} onChange={(e) => setCorrect(e.target.value)} placeholder="WhimprFlow" onKeyDown={onKey} style={{ width: 220 }} />
        </Row>
        <Row label={t("dictionary.addForm.heard.label")} hint={t("dictionary.addForm.heard.hint")}>
          <input value={heard} onChange={(e) => setHeard(e.target.value)} placeholder="whisper flow, wimper flow" onKeyDown={onKey} style={{ width: 220 }} />
        </Row>
        <Row label="">
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!correct.trim()}>{t("dictionary.addForm.addButton")}</Button>
        </Row>
      </Group>
    </>
  );
}

export function DictionaryPane() {
  const t = useT();
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const load = () => getDictionary().then(setEntries);
  useEffect(() => {
    void load();
  }, []);

  const remove = async (correct: string) => {
    await removeDictionaryEntry(correct);
    await load();
  };

  const q = query.trim().toLowerCase();
  const filtered = entries
    .filter((e) => tab === "all" || (tab === "manual" ? !e.auto : e.auto))
    .filter((e) => !q || e.correct.toLowerCase().includes(q))
    .sort((a, b) => a.correct.localeCompare(b.correct));

  return (
    <>
      <PageHeader title={t("sidebar.nav.dictionary")}>
        <input type="search" aria-label={t("dictionary.search.ariaLabel")} placeholder={t("common.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="primary" onClick={() => setAdding((a) => !a)}>
          <Icon name="plus" size={13} strokeWidth={2.2} />
          {t("dictionary.addButton")}
        </Button>
      </PageHeader>
      <div className="pane-scroll">
        <div className="form">
          {adding && (
            <AddForm
              onDone={() => {
                setAdding(false);
                void load();
              }}
            />
          )}

          <GroupTitle>
            <div className="tabs" role="tablist" style={{ marginBottom: 4 }}>
              {TAB_KEYS.map((tabDef) => (
                <button key={tabDef.key} role="tab" aria-selected={tab === tabDef.key} onClick={() => setTab(tabDef.key)}>
                  {t(tabDef.labelKey)}
                </button>
              ))}
            </div>
          </GroupTitle>

          {filtered.length === 0 ? (
            <Group>
              <Empty
                title={entries.length === 0 ? t("dictionary.empty.title.none") : t("common.noMatches")}
                body={
                  entries.length === 0
                    ? t("dictionary.empty.body.none")
                    : t("dictionary.empty.body.noMatches", { query })
                }
              />
            </Group>
          ) : (
            <Group>
              {filtered.map((e) => (
                <div className="row" key={e.correct}>
                  <div className="row-text">
                    <span className="dict-word">{e.correct}</span>
                    {e.mishears.length > 0 && <span className="dict-heard">{t("dictionary.row.heardAs", { mishears: e.mishears.join(", ") })}</span>}
                    {e.auto && <span className="dict-auto">{t("dictionary.tag.learned")}</span>}
                  </div>
                  <div className="row-control dict-remove">
                    <Button variant="plain" title={t("common.remove")} onClick={() => void remove(e.correct)}>
                      <Icon name="close" size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </Group>
          )}
          <div className="group-note">
            {t("dictionary.note")}
          </div>
        </div>
      </div>
    </>
  );
}
