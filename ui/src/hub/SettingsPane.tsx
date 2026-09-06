import { useEffect, useState } from "react";
import { Button, Group, GroupTitle, Note, PageHeader, Row, Select, Status, Switch } from "./ui";
import {
  LANGUAGES,
  listMicrophones,
  listModels,
  downloadModel,
  onModelProgress,
  onModelDone,
  openModelsFolder,
  type ModelInfo,
  PTT_KEYS,
  requestAccessibility,
  requestInputMonitoring,
  requestMicrophone,
  resetPillPosition,
  setApiKey,
  type Appearance,
  type AsrMode,
  type CleanupLevel,
  type CleanupMode,
  type Settings,
  type Status as StatusT,
} from "./api";

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: "system", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const ASR_MODES: { value: AsrMode; label: string }[] = [
  { value: "local", label: "On this Mac" },
  { value: "cloud", label: "Cloud" },
];

const MODES: { value: CleanupMode; label: string }[] = [
  { value: "raw", label: "Off" },
  { value: "local", label: "On this Mac" },
  { value: "open_ai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
];

const LEVELS: { value: CleanupLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "light", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const LEVEL_HINT: Record<CleanupLevel, string> = {
  none: "Types exactly what was heard, mistakes included.",
  light: "Removes fillers and fixes grammar. Leaves wording alone.",
  medium: "Also edits for clarity and length.",
  high: "Rewrites for brevity and polish.",
};

// A physical key from a KeyboardEvent.code, as a Tauri accelerator key name.
function keyNameFromCode(code: string): string | null {
  if (code === "Space") return "Space";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F[0-9]{1,2}$/.test(code)) return code;
  return null;
}

// A KeyboardEvent as a Tauri accelerator string, or null until a modifier
// plus a real key is down. A bare key makes a terrible global hotkey.
function acceleratorFromEvent(e: KeyboardEvent): string | null {
  const key = keyNameFromCode(e.code);
  if (!key) return null;
  const parts: string[] = [];
  if (e.metaKey) parts.push("CmdOrCtrl");
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (parts.length === 0) return null;
  parts.push(key);
  return parts.join("+");
}

const SYMBOLS: Record<string, string> = {
  CmdOrCtrl: "⌘", Cmd: "⌘", Command: "⌘", Super: "⌘",
  Ctrl: "⌃", Control: "⌃", Alt: "⌥", Option: "⌥", Shift: "⇧",
};

function prettyAccelerator(accelerator: string): string {
  if (!accelerator.trim()) return "None";
  return accelerator.split("+").map((p) => SYMBOLS[p] ?? p).join(" ");
}

function HotkeyRecorder({ value, onChange }: { value: string; onChange: (a: string) => void }) {
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(false);
      const acc = acceleratorFromEvent(e);
      if (acc) {
        onChange(acc);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onChange]);
  return (
    <>
      {value.trim() !== "" && !recording && <Button variant="plain" onClick={() => onChange("")}>Remove</Button>}
      <Button onClick={() => setRecording((on) => !on)}>{recording ? "Press keys…" : prettyAccelerator(value)}</Button>
    </>
  );
}

function KeyRow({
  label,
  configured,
  onSave,
}: {
  label: string;
  configured: boolean;
  onSave: (key: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  return (
    <Row
      label={label}
      hint={error ? "Could not save. The keychain may be unavailable." : configured ? "Saved in the macOS keychain." : "Not set."}
    >
      <input
        type="password"
        className="mono"
        value={value}
        placeholder={configured ? "Replace key" : "Paste key"}
        onChange={(e) => {
          setValue(e.target.value);
          setError(false);
        }}
        style={{ width: 200 }}
      />
      <Button
        disabled={!value}
        onClick={async () => {
          try {
            await onSave(value);
            setValue("");
          } catch {
            setError(true);
          }
        }}
      >
        Save
      </Button>
    </Row>
  );
}

function PermRow({ ok, label, detail, onClick }: { ok: boolean; label: string; detail: string; onClick: () => void }) {
  return (
    <Row label={label} hint={detail}>
      {ok ? <Status ok>Granted</Status> : <Button onClick={onClick}>Grant</Button>}
    </Row>
  );
}

function ModelDownloadButton({ models, onDone }: { models: ModelInfo[]; onDone: () => void }) {
  const [selected, setSelected] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    if (!downloading) return;
    let s1: (() => void) | undefined;
    let s2: (() => void) | undefined;
    void onModelProgress((p) => setPercent(p.percent)).then((u) => (s1 = u));
    void onModelDone((p) => {
      setDownloading(false);
      if (p.ok) onDone();
    }).then((u) => (s2 = u));
    return () => { s1?.(); s2?.(); };
  }, [downloading, onDone]);

  const notInstalled = models.filter((m) => !m.installed);
  if (notInstalled.length === 0 && !downloading) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {!downloading && (
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{ fontSize: 13, borderRadius: 6, padding: "3px 6px" }}
        >
          <option value="">Download a model</option>
          {notInstalled.map((m) => (
            <option key={m.name} value={m.name}>
              {m.label} ({m.size_mb >= 1000 ? `${(m.size_mb / 1000).toFixed(1)} GB` : `${m.size_mb} MB`})
            </option>
          ))}
        </select>
      )}
      {downloading ? (
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{percent}%</span>
      ) : (
        <Button
                    disabled={!selected}
          onClick={() => {
            if (!selected) return;
            setDownloading(true);
            setPercent(0);
            void downloadModel(selected);
          }}
        >
          Download
        </Button>
      )}
    </div>
  );
}

export function SettingsPane({
  settings,
  onChange,
  status,
  refresh,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  status: StatusT;
  refresh: () => void;
}) {
  const [mics, setMics] = useState<string[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => {
    void listMicrophones().then(setMics);
    void listModels().then(setModels);
  }, []);
  const micOptions = [{ value: "", label: "System default" }, ...mics.map((m) => ({ value: m, label: m }))];
  const installedModels = models.filter((m) => m.installed);
  const modelOptions = [
    { value: "", label: "Auto (best installed)" },
    ...installedModels.map((m) => ({
      value: m.name,
      label: `${m.label} (${m.size_mb >= 1000 ? `${(m.size_mb / 1000).toFixed(1)} GB` : `${m.size_mb} MB`})`,
    })),
  ];
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });

  return (
    <>
      <PageHeader title="Settings" />
      <div className="pane-scroll">
        <div className="form">
          <GroupTitle>Dictation</GroupTitle>
          <Group>
            <Row label="Hold to talk" hint="Only modifier keys work here. If double-tapping fn opens Apple Dictation, turn that off in System Settings › Keyboard.">
              <Select label="Hold to talk key" value={settings.push_to_talk_key} options={PTT_KEYS} onChange={(v) => set("push_to_talk_key", v)} />
            </Row>
            <Row label="Hands-free shortcut" hint="Press once to start, again to stop. Double-tapping the key above also works.">
              <HotkeyRecorder value={settings.hands_free_hotkey ?? ""} onChange={(a) => set("hands_free_hotkey", a)} />
            </Row>
            <Row label="Language" hint="Needs a multilingual model. Models ending in .en are English only.">
              <Select label="Language" value={settings.language} options={LANGUAGES} onChange={(v) => set("language", v)} />
            </Row>
            <Row label="Microphone" hint="Falls back to the system default if this device is unplugged.">
              <Select label="Microphone" value={settings.microphone} options={micOptions} onChange={(v) => set("microphone", v)} />
            </Row>
            <Row label="Sounds" hint="A click when recording starts and when text lands.">
              <Switch label="Sounds" checked={settings.sound_on_start} onChange={(v) => set("sound_on_start", v)} />
            </Row>
          </Group>

          <GroupTitle>Speech to text</GroupTitle>
          <Group>
            <Row label="Engine" hint={settings.asr_mode === "local" ? "Whisper runs on this Mac. Works offline." : "An OpenAI-compatible transcription API, such as Groq."}>
              <Select label="Speech engine" value={settings.asr_mode} options={ASR_MODES} onChange={(v) => set("asr_mode", v)} />
            </Row>
            {settings.asr_mode === "local" && (
              <>
                {installedModels.length > 0 && (
                  <Row label="Model" hint="Which Whisper model to use for transcription.">
                    <Select label="Whisper model" value={settings.whisper_model} options={modelOptions} onChange={(v) => set("whisper_model", v)} />
                  </Row>
                )}
                <Row label="Models folder" hint="Add your own .bin files here, or download one.">
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button onClick={() => void openModelsFolder()}>Open folder</Button>
                    <ModelDownloadButton models={models} onDone={() => void listModels().then(setModels)} />
                  </div>
                </Row>
              </>
            )}
            {settings.asr_mode === "cloud" && (
              <>
                <Row label="Server" hint="Leave blank for OpenAI.">
                  <input type="text" className="mono" value={settings.asr_base_url} placeholder="https://api.groq.com/openai/v1" onChange={(e) => set("asr_base_url", e.target.value)} style={{ width: 260 }} />
                </Row>
                <Row label="Model">
                  <input type="text" className="mono" value={settings.asr_model} placeholder="whisper-large-v3-turbo" onChange={(e) => set("asr_model", e.target.value)} style={{ width: 260 }} />
                </Row>
                <KeyRow
                  label="API key"
                  configured={status.has_asr_key}
                  onSave={async (k) => {
                    await setApiKey("asr", k);
                    setTimeout(refresh, 400);
                  }}
                />
              </>
            )}
          </Group>

          <GroupTitle>Cleanup</GroupTitle>
          <Group>
            <Row label="Engine" hint="Removes fillers, applies self-corrections, adds punctuation.">
              <Select label="Cleanup engine" value={settings.cleanup_mode} options={MODES} onChange={(v) => set("cleanup_mode", v)} />
            </Row>
            {settings.cleanup_mode !== "raw" && (
              <Row label="Strength" hint={LEVEL_HINT[settings.cleanup_level]}>
                <Select label="Cleanup strength" value={settings.cleanup_level} options={LEVELS} onChange={(v) => set("cleanup_level", v)} />
              </Row>
            )}
            {settings.cleanup_mode === "open_ai" && (
              <>
                <Row label="Server" hint="Leave blank for OpenAI, or any compatible API such as OpenRouter.">
                  <input type="text" className="mono" value={settings.openai_base_url} placeholder="https://openrouter.ai/api/v1" onChange={(e) => set("openai_base_url", e.target.value)} style={{ width: 260 }} />
                </Row>
                <Row label="Model">
                  <input type="text" className="mono" value={settings.openai_model} placeholder="gpt-4o-mini" onChange={(e) => set("openai_model", e.target.value)} style={{ width: 260 }} />
                </Row>
                <KeyRow
                  label="OpenAI API key"
                  configured={status.has_openai_key}
                  onSave={async (k) => {
                    await setApiKey("openai", k);
                    setTimeout(refresh, 400);
                  }}
                />
              </>
            )}
            {settings.cleanup_mode === "anthropic" && (
              <>
                <Row label="Model">
                  <input type="text" className="mono" value={settings.anthropic_model} placeholder="claude-haiku-4-5" onChange={(e) => set("anthropic_model", e.target.value)} style={{ width: 260 }} />
                </Row>
                <KeyRow
                  label="Anthropic API key"
                  configured={status.has_anthropic_key}
                  onSave={async (k) => {
                    await setApiKey("anthropic", k);
                    setTimeout(refresh, 400);
                  }}
                />
              </>
            )}
          </Group>

          <GroupTitle>Pill</GroupTitle>
          <Group>
            <Row label="Always show" hint="Off hides the pill until a dictation starts.">
              <Switch label="Always show pill" checked={settings.show_pill_always} onChange={(v) => set("show_pill_always", v)} />
            </Row>
            <Row label="Follow the active display" hint="Otherwise it stays on the main display.">
              <Switch label="Follow the active display" checked={settings.pill_follows_active_display} onChange={(v) => set("pill_follows_active_display", v)} />
            </Row>
            <Row label="Gap above the Dock" hint={`${Math.round(settings.pill_bottom_inset)} pt`}>
              <input type="range" aria-label="Gap above the Dock" min={8} max={220} step={4} value={settings.pill_bottom_inset} onChange={(e) => set("pill_bottom_inset", Number(e.currentTarget.value))} />
            </Row>
            {settings.pill_pos && (
              <Row label="Position" hint="Pinned where you dragged it. The options above are paused.">
                <Button
                  onClick={() => {
                    void resetPillPosition();
                    set("pill_pos", null);
                  }}
                >
                  Reset
                </Button>
              </Row>
            )}
          </Group>

          <GroupTitle>App</GroupTitle>
          <Group>
            <Row label="Appearance">
              <Select label="Appearance" value={settings.appearance} options={APPEARANCES} onChange={(v) => set("appearance", v)} />
            </Row>
            <Row label="Open at login">
              <Switch label="Open at login" checked={settings.launch_at_login} onChange={(v) => set("launch_at_login", v)} />
            </Row>
            <Row label="Show in Dock" hint="Off makes WhimprFlow a menu bar app.">
              <Switch label="Show in Dock" checked={settings.show_in_dock} onChange={(v) => set("show_in_dock", v)} />
            </Row>
            <Row label="Keep history" hint="Stores the text of your last 500 dictations on this Mac. Off keeps only counts and timing.">
              <Switch label="Keep history" checked={settings.save_history} onChange={(v) => set("save_history", v)} />
            </Row>
          </Group>

          <GroupTitle>Permissions</GroupTitle>
          <Group>
            <PermRow
              ok={status.accessibility}
              label="Accessibility"
              detail="Reads the dictation key in every app and types your words."
              onClick={() => {
                requestAccessibility();
                setTimeout(refresh, 800);
              }}
            />
            <PermRow
              ok={status.microphone}
              label="Microphone"
              detail={status.microphone ? "Hears what you say." : (status.microphone_hint ?? "Hears what you say.")}
              onClick={() => {
                requestMicrophone();
                setTimeout(refresh, 1000);
              }}
            />
            <PermRow
              ok={status.input_monitoring}
              label="Input Monitoring"
              detail="Optional. Makes key detection more reliable."
              onClick={() => {
                requestInputMonitoring();
                setTimeout(refresh, 1000);
              }}
            />
          </Group>
          <Note>Status updates within a few seconds of a change in System Settings.</Note>
        </div>
      </div>
    </>
  );
}
