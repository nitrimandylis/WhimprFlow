import { useEffect, useState } from "react";
import { font } from "../tokens/values";
import { theme } from "./theme";
import { Card, PageTitle } from "./ui";
import { addSnippet, getSnippets, removeSnippet, type Snippet } from "./api";

// Voice-triggered text expansion. Say the trigger, get the expansion typed.
// Expansion runs after cleanup, so the trigger can be spoken naturally in a
// sentence and still be picked up.

const inputStyle: React.CSSProperties = {
  fontFamily: font.ui,
  fontSize: 13.5,
  color: theme.textBody,
  background: theme.cardBgSubtle,
  border: `1px solid ${theme.borderStrong}`,
  borderRadius: 9,
  padding: "9px 11px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

export function SnippetsPane() {
  const [items, setItems] = useState<Snippet[]>([]);
  const [trigger, setTrigger] = useState("");
  const [expansion, setExpansion] = useState("");

  const reload = () => void getSnippets().then(setItems);
  useEffect(reload, []);

  async function onAdd() {
    const t = trigger.trim();
    if (!t || !expansion.trim()) return;
    await addSnippet(t, expansion);
    setTrigger("");
    setExpansion("");
    reload();
  }

  async function onRemove(t: string) {
    await removeSnippet(t);
    reload();
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <PageTitle>Snippets</PageTitle>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong, marginBottom: 4 }}>
          Add a snippet
        </div>
        <div style={{ fontSize: 12.5, color: theme.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
          Say the trigger while dictating and WhimprFlow types the expansion instead. Matching
          ignores case and only fires on whole phrases, so a trigger of “sig” won’t fire inside
          “design”.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            style={inputStyle}
            placeholder="Trigger — e.g. my address"
            value={trigger}
            onChange={(e) => setTrigger(e.currentTarget.value)}
          />
          <textarea
            style={{ ...inputStyle, minHeight: 78, resize: "vertical" }}
            placeholder="Expansion — what gets typed"
            value={expansion}
            onChange={(e) => setExpansion(e.currentTarget.value)}
          />
          <div>
            <button
              onClick={() => void onAdd()}
              disabled={!trigger.trim() || !expansion.trim()}
              style={{
                cursor: trigger.trim() && expansion.trim() ? "pointer" : "default",
                border: "none",
                borderRadius: 9,
                padding: "9px 16px",
                fontSize: 13.5,
                fontWeight: 700,
                fontFamily: font.ui,
                color: "#fff",
                background:
                  trigger.trim() && expansion.trim() ? theme.accentDeep : theme.textFaint,
              }}
            >
              Add snippet
            </button>
          </div>
        </div>
      </Card>

      <Card pad={0}>
        <div
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: theme.textFaint,
            padding: "16px 18px",
            borderBottom: `1px solid ${theme.border}`,
          }}
        >
          Your snippets
        </div>
        {items.length === 0 ? (
          <div style={{ padding: 26, textAlign: "center", color: theme.textMuted, fontSize: 13.5 }}>
            No snippets yet. Signatures, addresses and boilerplate are the usual first ones.
          </div>
        ) : (
          <div style={{ padding: "4px 18px 12px" }}>
            {items.map((s) => (
              <div
                key={s.trigger}
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "flex-start",
                  padding: "11px 0",
                  borderBottom: `1px solid ${theme.border}`,
                }}
              >
                <div style={{ flex: "0 0 170px", minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.textStrong }}>
                    {s.trigger}
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 13,
                    color: theme.textBody,
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.5,
                  }}
                >
                  {s.expansion}
                </div>
                <button
                  onClick={() => void onRemove(s.trigger)}
                  style={{
                    cursor: "pointer",
                    border: `1px solid ${theme.border}`,
                    background: "transparent",
                    color: theme.textFaint,
                    borderRadius: 7,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "3px 8px",
                    whiteSpace: "nowrap",
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
