import { useEffect, useState } from "react";
import { font } from "../tokens/values";
import { theme } from "./theme";
import { Card, PageTitle } from "./ui";
import type { Settings } from "./api";

// Free-text style preferences, appended to the cleanup system prompt so cleaned
// text keeps sounding like the speaker.
//
// This is NOT an automatically learned voice profile. Inferring a style from
// edits reliably is a genuinely hard problem, and a half-working version that
// silently reshapes your writing is worse than none — so this asks you to say
// what you want instead of guessing.

const EXAMPLES = [
  "Use British spelling.",
  "Never use em dashes.",
  "Keep sentences short. Prefer plain words over jargon.",
  "Write “OK”, never “okay”.",
  "Don't start sentences with “So”.",
];

export function StylePane({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const [text, setText] = useState(settings.style_instructions);
  const [dirty, setDirty] = useState(false);

  // Adopt external changes (e.g. first load) while the field is untouched.
  useEffect(() => {
    if (!dirty) setText(settings.style_instructions);
  }, [settings.style_instructions, dirty]);

  function save() {
    onChange({ ...settings, style_instructions: text });
    setDirty(false);
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <PageTitle>Style</PageTitle>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong, marginBottom: 4 }}>
          Your style preferences
        </div>
        <div style={{ fontSize: 12.5, color: theme.textMuted, marginBottom: 12, lineHeight: 1.55 }}>
          Written in plain English, one instruction per line. These are added to the cleanup
          prompt for every dictation, and to Transforms as well.
        </div>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setDirty(true);
          }}
          placeholder={EXAMPLES.join("\n")}
          style={{
            width: "100%",
            boxSizing: "border-box",
            minHeight: 170,
            resize: "vertical",
            fontFamily: font.ui,
            fontSize: 13.5,
            lineHeight: 1.6,
            color: theme.textBody,
            background: theme.cardBgSubtle,
            border: `1px solid ${theme.borderStrong}`,
            borderRadius: 9,
            padding: "10px 12px",
            outline: "none",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
          <button
            onClick={save}
            disabled={!dirty}
            style={{
              cursor: dirty ? "pointer" : "default",
              border: "none",
              borderRadius: 9,
              padding: "9px 16px",
              fontSize: 13.5,
              fontWeight: 700,
              fontFamily: font.ui,
              color: "#fff",
              background: dirty ? theme.accentDeep : theme.textFaint,
            }}
          >
            {dirty ? "Save style" : "Saved"}
          </button>
          {settings.style_instructions.trim() !== "" && (
            <button
              onClick={() => {
                setText("");
                onChange({ ...settings, style_instructions: "" });
                setDirty(false);
              }}
              style={{
                cursor: "pointer",
                border: `1px solid ${theme.borderStrong}`,
                background: "transparent",
                color: theme.textBody,
                borderRadius: 9,
                fontSize: 12.5,
                fontWeight: 600,
                padding: "8px 14px",
              }}
            >
              Clear
            </button>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 13, color: theme.textMuted, lineHeight: 1.6 }}>
          <b style={{ color: theme.textStrong }}>If your style seems to be ignored</b>, raise Auto
          Cleanup to Medium in Settings. At Light the model is explicitly told to leave the text as
          spoken whenever it is unsure, which overrides most style requests. Instructions that
          would add facts, greetings or sign-offs you didn’t say are always refused.
        </div>
      </Card>
    </div>
  );
}
