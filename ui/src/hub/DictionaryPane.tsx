import { useEffect, useState } from "react";
import { Button, Empty, Group, GroupTitle, PageHeader, Row } from "./ui";
import { Icon } from "./icons";
import { addDictionaryEntry, getDictionary, removeDictionaryEntry, type DictEntry } from "./api";

type Tab = "all" | "manual" | "auto";
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "manual", label: "Added by you" },
  { key: "auto", label: "Learned" },
];

function AddForm({ onDone }: { onDone: () => void }) {
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
      <GroupTitle>New word</GroupTitle>
      <Group>
        <Row label="Word" hint="Spelled the way you want it typed.">
          <input autoFocus value={correct} onChange={(e) => setCorrect(e.target.value)} placeholder="WhimprFlow" onKeyDown={onKey} style={{ width: 220 }} />
        </Row>
        <Row label="Often heard as" hint="Optional. Separate variants with commas.">
          <input value={heard} onChange={(e) => setHeard(e.target.value)} placeholder="whisper flow, wimper flow" onKeyDown={onKey} style={{ width: 220 }} />
        </Row>
        <Row label="">
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!correct.trim()}>Add word</Button>
        </Row>
      </Group>
    </>
  );
}

export function DictionaryPane() {
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
      <PageHeader title="Dictionary">
        <input type="search" aria-label="Search words" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="primary" onClick={() => setAdding((a) => !a)}>
          <Icon name="plus" size={13} strokeWidth={2.2} />
          Add
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
              {TABS.map((t) => (
                <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
          </GroupTitle>

          {filtered.length === 0 ? (
            <Group>
              <Empty
                title={entries.length === 0 ? "No words yet" : "No matches"}
                body={
                  entries.length === 0
                    ? "Add names and jargon it keeps getting wrong. WhimprFlow also learns words you correct right after a paste."
                    : `Nothing here matches “${query}”.`
                }
              />
            </Group>
          ) : (
            <Group>
              {filtered.map((e) => (
                <div className="row" key={e.correct}>
                  <div className="row-text">
                    <span className="dict-word">{e.correct}</span>
                    {e.mishears.length > 0 && <span className="dict-heard">heard as {e.mishears.join(", ")}</span>}
                    {e.auto && <span className="dict-auto">learned</span>}
                  </div>
                  <div className="row-control dict-remove">
                    <Button variant="plain" title="Remove" onClick={() => void remove(e.correct)}>
                      <Icon name="close" size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </Group>
          )}
          <div className="group-note">
            Words here are corrected in every dictation before the text is typed.
          </div>
        </div>
      </div>
    </>
  );
}
