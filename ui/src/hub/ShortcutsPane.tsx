import { font } from "../tokens/values";
import { theme } from "./theme";
import { Card, PageTitle } from "./ui";
import { DEFAULT_KEYBINDINGS } from "./api";
import type { ChordJson, KeyBindings, Settings } from "./api";

const ACTION_ORDER: (keyof KeyBindings)[] = ["cancel", "paste_last", "copy_last", "undo_last"];

const ACTION_LABELS: Record<keyof KeyBindings, { label: string; hint: string }> = {
  cancel: { label: "Cancel dictation", hint: "Discard the current recording without pasting anything." },
  paste_last: { label: "Paste last transcript", hint: "Re-paste your most recent dictation at the cursor." },
  copy_last: { label: "Copy last transcript", hint: "Copy your most recent dictation to the clipboard." },
  undo_last: { label: "Undo last cleanup", hint: "Revert the last cleanup edit back to the raw transcript." },
};

function chordLabel(c: ChordJson): string {
  const mods = [c.meta && "⌘", c.ctrl && "⌃", c.alt && "⌥", c.shift && "⇧"]
    .filter(Boolean)
    .join("");
  const key = c.key.kind === "escape" ? "Esc" : c.key.value;
  return mods + key;
}

function ChordBadge({ chord }: { chord: ChordJson }) {
  return (
    <span
      style={{
        fontFamily: font.mono,
        fontSize: 13,
        fontWeight: 600,
        color: theme.textStrong,
        background: theme.cardBgSubtle,
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        padding: "5px 10px",
        minWidth: 44,
        textAlign: "center",
      }}
    >
      {chordLabel(chord)}
    </span>
  );
}

function FixedRow({ label, hint }: { label: string; hint: string }) {
  return (
    <div style={{ padding: "10px 0" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.textBody }}>{label}</div>
      <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 2 }}>{hint}</div>
    </div>
  );
}

// ponytail: rebinding is gone — the backend has no command to persist a
// changed chord, so this row is display-only. Upgrade path: bring back
// recording + save once a set_keybindings command exists.
function BindingRow({ name, chord }: { name: keyof KeyBindings; chord: ChordJson }) {
  const { label, hint } = ACTION_LABELS[name];

  return (
    <div style={{ padding: "10px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.textBody }}>{label}</div>
          <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 2 }}>{hint}</div>
        </div>
        <ChordBadge chord={chord} />
      </div>
    </div>
  );
}

export function ShortcutsPane({ settings }: { settings: Settings; onChange: (s: Settings) => void }) {
  // Guard: keybindings may be missing if the backend doesn't have the field yet.
  const kb: KeyBindings = settings.keybindings ?? DEFAULT_KEYBINDINGS;

  return (
    <div style={{ maxWidth: 720 }}>
      <PageTitle sub="Your daily-use keyboard shortcuts.">Shortcuts</PageTitle>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: theme.textStrong, marginBottom: 4 }}>Recording</div>
        <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 6 }}>
          Tied to each platform's hold gesture; not rebindable.
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <FixedRow
            label="Push-to-talk"
            hint="Hold Fn (macOS) or Right Ctrl (Windows) to record. Release to stop and paste."
          />
          <div style={{ borderTop: `1px solid ${theme.border}` }} />
          <FixedRow
            label="Hands-free lock"
            hint="Double-tap the push-to-talk key to lock hands-free. Press it again to stop."
          />
          <div style={{ borderTop: `1px solid ${theme.border}` }} />
          <FixedRow
            label="Command Mode"
            hint="Select text, then hold Fn+Ctrl (macOS), or press Ctrl+Alt+Space (Windows, in progress), speak an edit instruction, release."
          />
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 15, fontWeight: 600, color: theme.textStrong, marginBottom: 4 }}>Customizable</div>
        <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 6 }}>
          These shortcuts are fixed for now.
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {ACTION_ORDER.map((name, i) => (
            <div key={name}>
              {i > 0 && <div style={{ borderTop: `1px solid ${theme.border}` }} />}
              <BindingRow name={name} chord={kb[name]} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
