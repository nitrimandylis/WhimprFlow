import { useEffect, useState } from "react";
import { font } from "../tokens/values";
import { theme } from "./theme";
import { Button, Card, PageTitle } from "./ui";
import type { ChordJson, KeyBindings, KeyJson, Settings } from "./api";

const ACTION_ORDER: (keyof KeyBindings)[] = ["cancel", "paste_last", "copy_last", "undo_last"];

const ACTION_LABELS: Record<keyof KeyBindings, { label: string; hint: string }> = {
  cancel: { label: "Cancel dictation", hint: "Discard the current recording without pasting anything." },
  paste_last: { label: "Paste last transcript", hint: "Re-paste your most recent dictation at the cursor." },
  copy_last: { label: "Copy last transcript", hint: "Copy your most recent dictation to the clipboard." },
  undo_last: { label: "Undo last cleanup", hint: "Revert the last cleanup edit back to the raw transcript." },
};

function keyEq(a: KeyJson, b: KeyJson): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "char" && b.kind === "char" ? a.value === b.value : true;
}

function chordEq(a: ChordJson, b: ChordJson): boolean {
  return a.meta === b.meta && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && keyEq(a.key, b.key);
}

function hasAnyModifier(c: ChordJson): boolean {
  return c.meta || c.ctrl || c.alt || c.shift;
}

// Mirrors whimpr-core's KeyBindings::conflict_with: the name of whichever
// binding (if any) already uses this exact chord, excluding "except".
function conflictWith(kb: KeyBindings, chord: ChordJson, except: keyof KeyBindings): keyof KeyBindings | null {
  for (const name of ACTION_ORDER) {
    if (name !== except && chordEq(kb[name], chord)) return name;
  }
  return null;
}

function chordLabel(c: ChordJson): string {
  const mods = [c.meta && "⌘", c.ctrl && "⌃", c.alt && "⌥", c.shift && "⇧"]
    .filter(Boolean)
    .join("");
  const key = c.key.kind === "escape" ? "Esc" : c.key.value;
  return mods + key;
}

// Physical-key codes for the modifiers alone; keep listening, these aren't a
// bindable key on their own.
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

// Prefers "code" (physical key position, stable across keyboard layouts,
// matching the native macOS/Windows keycode lookups) and falls back to "key"
// for the rare case "code" isn't populated (some virtual keyboards/IMEs).
function keyFromEvent(e: KeyboardEvent): KeyJson | null {
  if (e.code === "Escape" || e.key === "Escape") return { kind: "escape" };
  const letter = /^Key([A-Z])$/.exec(e.code);
  if (letter) return { kind: "char", value: letter[1] };
  const digit = /^Digit([0-9])$/.exec(e.code);
  if (digit) return { kind: "char", value: digit[1] };
  if (/^[a-zA-Z0-9]$/.test(e.key)) return { kind: "char", value: e.key.toUpperCase() };
  return null;
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

function BindingRow({
  name,
  chord,
  keybindings,
  recording,
  onStartRecording,
  onStopRecording,
  onSave,
}: {
  name: keyof KeyBindings;
  chord: ChordJson;
  keybindings: KeyBindings;
  recording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onSave: (chord: ChordJson) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) {
      setError(null);
      return;
    }
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (MODIFIER_CODES.has(e.code)) return;
      const key = keyFromEvent(e);
      if (!key) {
        setError("Use a letter, digit, or Escape.");
        return;
      }
      const next: ChordJson = { meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, key };
      if (!hasAnyModifier(next) && next.key.kind !== "escape") {
        setError("Needs at least one modifier.");
        return;
      }
      const conflict = conflictWith(keybindings, next, name);
      if (conflict) {
        setError(`Already used by "${ACTION_LABELS[conflict].label}".`);
        return;
      }
      onSave(next);
      onStopRecording();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording, keybindings, name, onSave, onStopRecording]);

  const { label, hint } = ACTION_LABELS[name];

  return (
    <div style={{ padding: "10px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.textBody }}>{label}</div>
          <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 2 }}>{hint}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {recording ? (
            <>
              <span style={{ fontSize: 12.5, color: theme.accentDeep, fontWeight: 600 }}>Press keys...</span>
              <Button variant="ghost" size="sm" onClick={onStopRecording}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <ChordBadge chord={chord} />
              <Button variant="ghost" size="sm" onClick={onStartRecording}>
                Change
              </Button>
            </>
          )}
        </div>
      </div>
      {error && <div style={{ fontSize: 12, color: "#e5484d", marginTop: 6, textAlign: "right" }}>{error}</div>}
    </div>
  );
}

export function ShortcutsPane({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [recordingName, setRecordingName] = useState<keyof KeyBindings | null>(null);

  const saveBinding = (name: keyof KeyBindings, chord: ChordJson) => {
    onChange({ ...settings, keybindings: { ...settings.keybindings, [name]: chord } });
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <PageTitle sub="Your daily-use keyboard shortcuts. The four below are yours to customize.">
        Shortcuts
      </PageTitle>

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
          Click Change, then press the new key combo. Needs at least one modifier key, unless it's Escape.
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {ACTION_ORDER.map((name, i) => (
            <div key={name}>
              {i > 0 && <div style={{ borderTop: `1px solid ${theme.border}` }} />}
              <BindingRow
                name={name}
                chord={settings.keybindings[name]}
                keybindings={settings.keybindings}
                recording={recordingName === name}
                onStartRecording={() => setRecordingName(name)}
                onStopRecording={() => setRecordingName(null)}
                onSave={(chord) => saveBinding(name, chord)}
              />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
