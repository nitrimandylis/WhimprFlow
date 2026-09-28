import { useEffect, useState } from "react";
import { Button, Group, GroupTitle, Note, PageHeader, Row, Select, Status, Switch } from "./ui";
import { useT, type T } from "../i18n";
import {
  LANGUAGES,
  listMicrophones,
  listModels,
  downloadModel,
  onModelProgress,
  onModelDone,
  openModelsFolder,
  type ModelInfo,
  pttOptions,
  requestAccessibility,
  requestInputMonitoring,
  requestMicrophone,
  resetPillPosition,
  setApiKey,
  UI_LANGUAGES,
  type Appearance,
  type AsrMode,
  type CleanupLevel,
  type CleanupMode,
  type Settings,
  type Status as StatusT,
} from "./api";
import { usePlatform, type Platform } from "../platform";

function appearances(t: T): { value: Appearance; label: string }[] {
  return [
    { value: "system", label: t("common.matchSystem") },
    { value: "light", label: t("settings.appearance.light") },
    { value: "dark", label: t("settings.appearance.dark") },
  ];
}

function asrModes(t: T, platform: Platform): { value: AsrMode; label: string }[] {
  return [
    { value: "local", label: platform === "macos" ? t("common.onThisMac") : t("common.onThisComputer") },
    { value: "cloud", label: t("settings.asr.engine.cloud") },
  ];
}

function cleanupModes(t: T, platform: Platform): { value: CleanupMode; label: string }[] {
  return [
    { value: "raw", label: t("settings.cleanup.engine.off") },
    { value: "local", label: platform === "macos" ? t("common.onThisMac") : t("common.onThisComputer") },
    { value: "open_ai", label: t("settings.cleanup.engine.openai") },
    { value: "anthropic", label: t("settings.cleanup.engine.anthropic") },
  ];
}

function levels(t: T): { value: CleanupLevel; label: string }[] {
  return [
    { value: "none", label: t("settings.cleanup.level.none") },
    { value: "light", label: t("settings.cleanup.level.light") },
    { value: "medium", label: t("settings.cleanup.level.medium") },
    { value: "high", label: t("settings.cleanup.level.high") },
  ];
}

function levelHint(t: T): Record<CleanupLevel, string> {
  return {
    none: t("settings.cleanup.level.none.hint"),
    light: t("settings.cleanup.level.light.hint"),
    medium: t("settings.cleanup.level.medium.hint"),
    high: t("settings.cleanup.level.high.hint"),
  };
}

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
// On macOS the meta key is Command (recorded as CmdOrCtrl); on Windows it is
// the Win key, which must be recorded as "Super" — "CmdOrCtrl" would parse as
// Ctrl there and register a different chord than the one the user pressed.
function acceleratorFromEvent(e: KeyboardEvent, platform: Platform): string | null {
  const key = keyNameFromCode(e.code);
  if (!key) return null;
  const parts: string[] = [];
  if (e.metaKey) parts.push(platform === "macos" ? "CmdOrCtrl" : "Super");
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (parts.length === 0) return null;
  parts.push(key);
  return parts.join("+");
}

const SYMBOLS_MAC: Record<string, string> = {
  CmdOrCtrl: "⌘", Cmd: "⌘", Command: "⌘", Super: "⌘", Meta: "⌘",
  Ctrl: "⌃", Control: "⌃", Alt: "⌥", Option: "⌥", Shift: "⇧",
};

// No Apple symbols on Windows: ⌘ doesn't exist there and ⌃ reads as the Mac
// Control glyph. Plain text matches what the OS actually calls each key.
const SYMBOLS_WINDOWS: Record<string, string> = {
  CmdOrCtrl: "Ctrl", Cmd: "Win", Command: "Win", Super: "Win", Meta: "Win",
  Ctrl: "Ctrl", Control: "Ctrl", Alt: "Alt", Option: "Alt", Shift: "Shift",
};

function prettyAccelerator(accelerator: string, platform: Platform, t: T): string {
  if (!accelerator.trim()) return t("common.none");
  const symbols = platform === "macos" ? SYMBOLS_MAC : SYMBOLS_WINDOWS;
  return accelerator.split("+").map((p) => symbols[p] ?? p).join(" ");
}

function HotkeyRecorder({ value, onChange }: { value: string; onChange: (a: string) => void }) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const platform = usePlatform();
  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(false);
      const acc = acceleratorFromEvent(e, platform);
      if (acc) {
        onChange(acc);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onChange, platform]);
  return (
    <>
      {value.trim() !== "" && !recording && <Button variant="plain" onClick={() => onChange("")}>{t("common.remove")}</Button>}
      <Button onClick={() => setRecording((on) => !on)}>{recording ? t("settings.hotkey.recording") : prettyAccelerator(value, platform, t)}</Button>
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
  const t = useT();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const platform = usePlatform();
  return (
    <Row
      label={label}
      hint={
        error
          ? t("settings.apiKey.hint.error")
          : configured
            ? platform === "macos"
              ? t("settings.apiKey.hint.savedMac")
              : t("settings.apiKey.hint.savedOther")
            : t("settings.apiKey.hint.notSet")
      }
    >
      <input
        type="password"
        className="mono"
        value={value}
        placeholder={configured ? t("settings.apiKey.placeholder.replace") : t("settings.apiKey.placeholder.paste")}
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
        {t("common.save")}
      </Button>
    </Row>
  );
}

function PermRow({ ok, label, detail, onClick }: { ok: boolean; label: string; detail: string; onClick: () => void }) {
  const t = useT();
  return (
    <Row label={label} hint={detail}>
      {ok ? <Status ok>{t("common.granted")}</Status> : <Button onClick={onClick}>{t("common.grant")}</Button>}
    </Row>
  );
}

function ModelDownloadButton({ models, onDone }: { models: ModelInfo[]; onDone: () => void }) {
  const t = useT();
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
          <option value="">{t("settings.model.downloadPlaceholder")}</option>
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
          {t("common.download")}
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
  const t = useT();
  const [mics, setMics] = useState<string[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const platform = usePlatform();
  useEffect(() => {
    void listMicrophones().then(setMics);
    void listModels().then(setModels);
  }, []);
  const micOptions = [{ value: "", label: t("common.systemDefault") }, ...mics.map((m) => ({ value: m, label: m }))];
  const installedModels = models.filter((m) => m.installed);
  const modelOptions = [
    { value: "", label: t("settings.model.autoOption") },
    ...installedModels.map((m) => ({
      value: m.name,
      label: `${m.label} (${m.size_mb >= 1000 ? `${(m.size_mb / 1000).toFixed(1)} GB` : `${m.size_mb} MB`})`,
    })),
  ];
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });

  return (
    <>
      <PageHeader title={t("sidebar.nav.settings")} />
      <div className="pane-scroll">
        <div className="form">
          <GroupTitle>{t("settings.group.dictation")}</GroupTitle>
          <Group>
            <Row
              label={t("settings.row.holdToTalk.label")}
              hint={
                platform === "macos"
                  ? t("settings.row.holdToTalk.hint.mac")
                  : t("settings.row.holdToTalk.hint.other")
              }
            >
              <Select label={t("settings.row.holdToTalk.selectLabel")} value={settings.push_to_talk_key} options={pttOptions(platform)} onChange={(v) => set("push_to_talk_key", v)} />
            </Row>
            <Row label={t("settings.row.handsFree.label")} hint={t("settings.row.handsFree.hint")}>
              <HotkeyRecorder value={settings.hands_free_hotkey ?? ""} onChange={(a) => set("hands_free_hotkey", a)} />
            </Row>
            <Row label={t("settings.row.dictationLanguage.label")} hint={t("settings.row.dictationLanguage.hint")}>
              <Select label={t("settings.row.dictationLanguage.label")} value={settings.language} options={LANGUAGES} onChange={(v) => set("language", v)} />
            </Row>
            <Row label={t("common.microphone")} hint={t("settings.row.microphone.hint")}>
              <Select label={t("common.microphone")} value={settings.microphone} options={micOptions} onChange={(v) => set("microphone", v)} />
            </Row>
            <Row label={t("settings.row.sounds.label")} hint={t("settings.row.sounds.hint")}>
              <Switch label={t("settings.row.sounds.label")} checked={settings.sound_on_start} onChange={(v) => set("sound_on_start", v)} />
            </Row>
          </Group>

          <GroupTitle>{t("settings.group.speechToText")}</GroupTitle>
          <Group>
            <Row
              label={t("common.engine")}
              hint={
                settings.asr_mode === "local"
                  ? platform === "macos"
                    ? t("settings.row.asrEngine.hint.mac")
                    : t("settings.row.asrEngine.hint.other")
                  : t("settings.row.asrEngine.hint.cloud")
              }
            >
              <Select label={t("settings.row.asrEngine.selectLabel")} value={settings.asr_mode} options={asrModes(t, platform)} onChange={(v) => set("asr_mode", v)} />
            </Row>
            {settings.asr_mode === "local" && (
              <>
                {installedModels.length > 0 && (
                  <Row label={t("common.model")} hint={t("settings.row.model.hint")}>
                    <Select label={t("settings.row.model.selectLabel")} value={settings.whisper_model} options={modelOptions} onChange={(v) => set("whisper_model", v)} />
                  </Row>
                )}
                <Row label={t("settings.row.modelsFolder.label")} hint={t("settings.row.modelsFolder.hint")}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button onClick={() => void openModelsFolder()}>{t("settings.row.modelsFolder.openButton")}</Button>
                    <ModelDownloadButton models={models} onDone={() => void listModels().then(setModels)} />
                  </div>
                </Row>
              </>
            )}
            {settings.asr_mode === "cloud" && (
              <>
                <Row label={t("common.server")} hint={t("settings.row.asrServer.hint")}>
                  <input type="text" className="mono" value={settings.asr_base_url} placeholder="https://api.groq.com/openai/v1" onChange={(e) => set("asr_base_url", e.target.value)} style={{ width: 260 }} />
                </Row>
                <Row label={t("common.model")}>
                  <input type="text" className="mono" value={settings.asr_model} placeholder="whisper-large-v3-turbo" onChange={(e) => set("asr_model", e.target.value)} style={{ width: 260 }} />
                </Row>
                <KeyRow
                  label={t("settings.apiKey.asr.label")}
                  configured={status.has_asr_key}
                  onSave={async (k) => {
                    await setApiKey("asr", k);
                    setTimeout(refresh, 400);
                  }}
                />
              </>
            )}
          </Group>

          <GroupTitle>{t("settings.group.cleanup")}</GroupTitle>
          <Group>
            <Row label={t("common.engine")} hint={t("settings.row.cleanupEngine.hint")}>
              <Select label={t("settings.row.cleanupEngine.selectLabel")} value={settings.cleanup_mode} options={cleanupModes(t, platform)} onChange={(v) => set("cleanup_mode", v)} />
            </Row>
            {settings.cleanup_mode !== "raw" && (
              <Row label={t("settings.row.strength.label")} hint={levelHint(t)[settings.cleanup_level]}>
                <Select label={t("settings.row.strength.selectLabel")} value={settings.cleanup_level} options={levels(t)} onChange={(v) => set("cleanup_level", v)} />
              </Row>
            )}
            {settings.cleanup_mode === "open_ai" && (
              <>
                <Row label={t("common.server")} hint={t("settings.row.openaiServer.hint")}>
                  <input type="text" className="mono" value={settings.openai_base_url} placeholder="https://openrouter.ai/api/v1" onChange={(e) => set("openai_base_url", e.target.value)} style={{ width: 260 }} />
                </Row>
                <Row label={t("common.model")}>
                  <input type="text" className="mono" value={settings.openai_model} placeholder="gpt-4o-mini" onChange={(e) => set("openai_model", e.target.value)} style={{ width: 260 }} />
                </Row>
                <KeyRow
                  label={t("settings.apiKey.openai.label")}
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
                <Row label={t("common.model")}>
                  <input type="text" className="mono" value={settings.anthropic_model} placeholder="claude-haiku-4-5" onChange={(e) => set("anthropic_model", e.target.value)} style={{ width: 260 }} />
                </Row>
                <KeyRow
                  label={t("settings.apiKey.anthropic.label")}
                  configured={status.has_anthropic_key}
                  onSave={async (k) => {
                    await setApiKey("anthropic", k);
                    setTimeout(refresh, 400);
                  }}
                />
              </>
            )}
          </Group>

          <GroupTitle>{t("settings.group.pill")}</GroupTitle>
          <Group>
            <Row label={t("settings.row.alwaysShow.label")} hint={t("settings.row.alwaysShow.hint")}>
              <Switch label={t("settings.row.alwaysShow.switchLabel")} checked={settings.show_pill_always} onChange={(v) => set("show_pill_always", v)} />
            </Row>
            <Row label={t("settings.row.followDisplay.label")} hint={t("settings.row.followDisplay.hint")}>
              <Switch label={t("settings.row.followDisplay.label")} checked={settings.pill_follows_active_display} onChange={(v) => set("pill_follows_active_display", v)} />
            </Row>
            <Row label={platform === "macos" ? t("settings.row.gap.labelMac") : t("settings.row.gap.labelOther")} hint={`${Math.round(settings.pill_bottom_inset)} pt`}>
              <input type="range" aria-label={t("settings.row.gap.labelMac")} min={8} max={220} step={4} value={settings.pill_bottom_inset} onChange={(e) => set("pill_bottom_inset", Number(e.currentTarget.value))} />
            </Row>
            {settings.pill_pos && (
              <Row label={t("settings.row.pillPosition.label")} hint={t("settings.row.pillPosition.hint")}>
                <Button
                  onClick={() => {
                    void resetPillPosition();
                    set("pill_pos", null);
                  }}
                >
                  {t("common.reset")}
                </Button>
              </Row>
            )}
          </Group>

          <GroupTitle>{t("settings.group.app")}</GroupTitle>
          <Group>
            <Row label={t("settings.row.appearance.label")}>
              <Select label={t("settings.row.appearance.label")} value={settings.appearance} options={appearances(t)} onChange={(v) => set("appearance", v)} />
            </Row>
            <Row label={t("settings.row.uiLanguage.label")} hint={t("settings.row.uiLanguage.hint")}>
              <Select label={t("settings.row.uiLanguage.label")} value={settings.ui_language} options={UI_LANGUAGES} onChange={(v) => set("ui_language", v)} />
            </Row>
            <Row label={t("settings.row.launchAtLogin.label")}>
              <Switch label={t("settings.row.launchAtLogin.label")} checked={settings.launch_at_login} onChange={(v) => set("launch_at_login", v)} />
            </Row>
            <Row label={t("settings.row.showInDock.label")} hint={t("settings.row.showInDock.hint")}>
              <Switch label={t("settings.row.showInDock.label")} checked={settings.show_in_dock} onChange={(v) => set("show_in_dock", v)} />
            </Row>
            <Row label={t("settings.row.keepHistory.label")} hint={platform === "macos" ? t("settings.row.keepHistory.hint.mac") : t("settings.row.keepHistory.hint.other")}>
              <Switch label={t("settings.row.keepHistory.label")} checked={settings.save_history} onChange={(v) => set("save_history", v)} />
            </Row>
          </Group>

          <GroupTitle>{t("settings.group.permissions")}</GroupTitle>
          <Group>
            <PermRow
              ok={status.accessibility}
              label={t("common.accessibility")}
              detail={t("permissions.accessibility.detail")}
              onClick={() => {
                requestAccessibility();
                setTimeout(refresh, 800);
              }}
            />
            <PermRow
              ok={status.microphone}
              label={t("common.microphone")}
              detail={status.microphone ? t("common.microphoneHint") : (status.microphone_hint ?? t("common.microphoneHint"))}
              onClick={() => {
                requestMicrophone();
                setTimeout(refresh, 1000);
              }}
            />
            <PermRow
              ok={status.input_monitoring}
              label={t("common.inputMonitoring")}
              detail={t("settings.perm.inputMonitoring.detail")}
              onClick={() => {
                requestInputMonitoring();
                setTimeout(refresh, 1000);
              }}
            />
          </Group>
          <Note>{platform === "macos" ? t("settings.note.statusUpdates.mac") : t("settings.note.statusUpdates.other")}</Note>
        </div>
      </div>
    </>
  );
}
