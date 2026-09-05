import { useEffect, useState } from "react";
import { Button, Group, GroupTitle, Note, PageHeader } from "./ui";
import type { Settings } from "./api";

// Free-text style preferences, appended to the cleanup prompt so cleaned text
// keeps sounding like the speaker. Explicit instructions, not an inferred
// voice profile: a half-working inference that silently reshapes writing is
// worse than none.

const EXAMPLES = [
  "Use British spelling.",
  "Never use em dashes.",
  "Keep sentences short. Prefer plain words over jargon.",
  "Write “OK”, never “okay”.",
  "Don't start sentences with “So”.",
];

export function StylePane({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
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
      <PageHeader title="Style">
        {settings.style_instructions.trim() !== "" && (
          <Button
            onClick={() => {
              setText("");
              onChange({ ...settings, style_instructions: "" });
              setDirty(false);
            }}
          >
            Clear
          </Button>
        )}
        <Button variant="primary" onClick={save} disabled={!dirty}>
          {dirty ? "Save" : "Saved"}
        </Button>
      </PageHeader>
      <div className="pane-scroll">
        <div className="form">
          <GroupTitle>How your text should read</GroupTitle>
          <Group>
            <div className="row row-stack">
              <textarea
                aria-label="Style instructions"
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
                placeholder={EXAMPLES.join("\n")}
              />
            </div>
          </Group>
          <Note>
            Plain English, one instruction per line. Added to the cleanup prompt for every dictation.
            If the instructions seem ignored, raise Cleanup strength to Medium in Settings. At Light the
            model leaves text as spoken whenever it is unsure. Instructions that would add facts,
            greetings or sign-offs you did not say are always refused.
          </Note>
        </div>
      </div>
    </>
  );
}
