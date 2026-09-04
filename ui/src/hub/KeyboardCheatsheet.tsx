import { useEffect, useState } from "react";
import { font } from "../tokens/values";
import { theme } from "./theme";
import { getKeybindings, type ChordJson, type KeyBindings } from "./api";
import type { Page } from "./Sidebar";

function chordLabel(c: ChordJson): string {
  const parts: string[] = [];
  if (c.meta) parts.push("Cmd");
  if (c.ctrl) parts.push("Ctrl");
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("Shift");
  if (c.key.kind === "escape") parts.push("Esc");
  else parts.push(c.key.value.toUpperCase());
  return parts.join("+");
}

const ACTIONS: { key: keyof KeyBindings; label: string }[] = [
  { key: "cancel", label: "Cancel dictation" },
  { key: "paste_last", label: "Paste last transcript" },
  { key: "copy_last", label: "Copy last transcript" },
  { key: "undo_last", label: "Undo last cleanup" },
];

export function KeyboardCheatsheet({
  open,
  onClose,
  setPage,
}: {
  open: boolean;
  onClose: () => void;
  setPage: (p: Page) => void;
}) {
  const [kb, setKb] = useState<KeyBindings | null>(null);
  useEffect(() => {
    if (!open) return;
    void getKeybindings().then(setKb);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 18, 16, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: "100%",
          background: theme.cardBg,
          border: `1px solid ${theme.border}`,
          borderRadius: 16,
          boxShadow: theme.shadow,
          padding: 22,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: theme.textStrong }}>Keyboard shortcuts</div>
          <button
            type="button"
            aria-label="Close cheatsheet"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: theme.textMuted,
              fontSize: 18,
            }}
          >
            ×
          </button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: font.ui, fontSize: 13.5 }}>
          <thead>
            <tr style={{ color: theme.textFaint, textAlign: "left" }}>
              <th style={{ padding: "8px 0", fontWeight: 600 }}>Action</th>
              <th style={{ padding: "8px 0", fontWeight: 600 }}>Keys</th>
              <th style={{ padding: "8px 0", fontWeight: 600 }} />
            </tr>
          </thead>
          <tbody>
            {ACTIONS.map((a) => (
              <tr key={a.key} style={{ borderTop: `1px solid ${theme.border}` }}>
                <td style={{ padding: "10px 0", color: theme.textStrong }}>{a.label}</td>
                <td style={{ padding: "10px 0", fontFamily: font.mono, color: theme.textMuted }}>
                  {kb ? chordLabel(kb[a.key]) : "…"}
                </td>
                <td style={{ padding: "10px 0", textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setPage("shortcuts");
                      onClose();
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      color: theme.accentDeep,
                      fontWeight: 600,
                      fontFamily: font.ui,
                      fontSize: 12.5,
                    }}
                  >
                    Click to rebind
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ margin: "14px 0 0", fontSize: 12.5, color: theme.textFaint }}>
          Press <kbd>?</kbd> anytime to open this cheatsheet.
        </p>
      </div>
    </div>
  );
}
