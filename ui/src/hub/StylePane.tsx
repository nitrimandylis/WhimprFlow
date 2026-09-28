import { useEffect, useState } from "react";
import { Button, Group, GroupTitle, Note, PageHeader } from "./ui";
import { useT } from "../i18n";
import type { Settings } from "./api";

// Free-text style preferences, appended to the cleanup prompt so cleaned text
// keeps sounding like the speaker. Explicit instructions, not an inferred
// voice profile: a half-working inference that silently reshapes writing is
// worse than none.

const EXAMPLE_KEYS = [
  "style.examples.britishSpelling",
  "style.examples.noEmDash",
  "style.examples.shortSentences",
  "style.examples.okSpelling",
  "style.examples.noSoStart",
];

export function StylePane({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const t = useT();
  const examples = EXAMPLE_KEYS.map((k) => t(k));
  const [text, setText] = useState(settings.style_instructions);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setText(settings.style_instructions);
  }, [settings.style_instructions, dirty]);

  function save() {
    onChange({ ...settings, style_instructions: text });
    setDirty(false);
  }

  return (
    <>
      <PageHeader title={t("sidebar.nav.style")}>
        {settings.style_instructions.trim() !== "" && (
          <Button
            onClick={() => {
              setText("");
              onChange({ ...settings, style_instructions: "" });
              setDirty(false);
            }}
          >
            {t("common.clear")}
          </Button>
        )}
        <Button variant="primary" onClick={save} disabled={!dirty}>
          {dirty ? t("common.save") : t("common.saved")}
        </Button>
      </PageHeader>
      <div className="pane-scroll">
        <div className="form">
          <GroupTitle>{t("style.group.title")}</GroupTitle>
          <Group>
            <div className="row row-stack">
              <textarea
                aria-label={t("style.textarea.ariaLabel")}
                value={text}
                onChange={(e) => {
                  setText(e.currentTarget.value);
                  setDirty(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "s" && e.metaKey) {
                    e.preventDefault();
                    save();
                  }
                }}
                placeholder={examples.join("\n")}
              />
            </div>
          </Group>
          <Note>{t("style.note")}</Note>
        </div>
      </div>
    </>
  );
}
