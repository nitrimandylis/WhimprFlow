// Typed wrappers over the Tauri command surface. In a plain browser (vite dev
// without the shell) the invoke import fails and we fall back to defaults so the
// Hub still renders for iteration.

export type CleanupMode = "raw" | "local" | "open_ai" | "anthropic";
export type CleanupLevel = "none" | "light" | "medium" | "high";
export type AsrMode = "local" | "cloud";

// Mirrors whimpr-core's Key enum, serialized via serde's adjacently-tagged
// representation: {"kind":"char","value":"V"} or {"kind":"escape"}.
export type KeyJson = { kind: "char"; value: string } | { kind: "escape" };

// Mirrors whimpr-core's Chord: one modifier combination bound to a rebindable
// action (checked on a plain KeyDown, not a hold gesture).
export interface ChordJson {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: KeyJson;
}

// Mirrors whimpr-core's KeyBindings: the four shortcuts safe to rebind.
export interface KeyBindings {
  cancel: ChordJson;
  paste_last: ChordJson;
  copy_last: ChordJson;
  undo_last: ChordJson;
}

// Mirrors whimpr-core's Formality enum.
export type Formality = "casual" | "neutral" | "formal";

export interface Settings {
  cleanup_mode: CleanupMode;
  cleanup_level: CleanupLevel;
  openai_model: string;
  // API root for "OpenAI" mode — leave blank for OpenAI itself, or point at
  // an OpenAI-compatible endpoint like OpenRouter (https://openrouter.ai/api/v1).
  openai_base_url: string;
  anthropic_model: string;
  // Which engine transcribes speech to text.
  asr_mode: AsrMode;
  // API root for AsrMode "cloud" — leave blank for OpenAI itself, or point at
  // Groq's Whisper endpoint (https://api.groq.com/openai/v1). Reuses the same
  // key as the "OpenAI" cleanup mode.
  asr_base_url: string;
  asr_model: string;
  sound_on_start: boolean;
  // Tauri accelerator that toggles hands-free (locked) dictation — press once to
  // start talking with no key held, again to stop. Default "CmdOrCtrl+Shift+Space".
  // Empty disables it. (Holding Fn and double-tapping Fn always work too.)
  hands_free_hotkey: string;
  // Keep the Flow Bar visible when idle. Off = pill only appears while dictating.
  show_pill_always: boolean;
  // Gap in points between the screen bottom and the pill (clears the Dock).
  pill_bottom_inset: number;
  // User-dragged pill position in physical pixels; null = computed anchor.
  pill_pos: [number, number] | null;
  // Follow the display the frontmost window is on rather than pinning to primary.
  pill_follows_active_display: boolean;
  // Whisper language code, or "auto" to detect. Needs a multilingual model.
  language: string;
  push_to_talk_key: PushToTalkKey;
  launch_at_login: boolean;
  show_in_dock: boolean;
  // Input device name; "" means the system default.
  microphone: string;
  // Free-text style preferences appended to the cleanup prompt.
  style_instructions: string;
  // The four rebindable shortcuts (cancel / paste / copy / undo last).
  keybindings: KeyBindings;
}

export type PushToTalkKey = "fn" | "right_command" | "right_option" | "right_control";

export const PTT_KEYS: { value: PushToTalkKey; label: string }[] = [
  { value: "fn", label: "Fn / Globe" },
  { value: "right_command", label: "Right ⌘" },
  { value: "right_option", label: "Right ⌥" },
  { value: "right_control", label: "Right ⌃" },
];

// Whisper's own language codes. "auto" lets the model detect, which costs a
// little accuracy but handles code-switching mid-sentence.
export const LANGUAGES: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "gu", label: "Gujarati" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "nl", label: "Dutch" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "ar", label: "Arabic" },
  { value: "ru", label: "Russian" },
  { value: "auto", label: "Detect automatically" },
];

// Browser-preview fallback only; the real app always loads the platform's actual
// bindings from the backend. Mirrors whimpr-core's macOS default.
export const DEFAULT_KEYBINDINGS: KeyBindings = {
  cancel: { meta: false, ctrl: false, alt: false, shift: false, key: { kind: "escape" } },
  paste_last: { meta: true, ctrl: false, alt: false, shift: true, key: { kind: "char", value: "V" } },
  copy_last: { meta: true, ctrl: false, alt: false, shift: true, key: { kind: "char", value: "C" } },
  undo_last: { meta: true, ctrl: false, alt: false, shift: true, key: { kind: "char", value: "Z" } },
};

export async function getKeybindings(): Promise<KeyBindings> {
  try {
    return await invoke<KeyBindings>("get_keybindings");
  } catch {
    return DEFAULT_KEYBINDINGS;
  }
}

export async function listMicrophones(): Promise<string[]> {
  try {
    return await invoke<string[]>("list_microphones");
  } catch {
    return [];
  }
}

// Mirrors `permissions::Grant` in src-tauri. A bare boolean couldn't tell
// "nobody has asked yet" from "asked and turned down" — two states with
// completely different instructions for the reader.
export type Grant = "granted" | "not_asked" | "refused";

export interface Status {
  accessibility: boolean;
  microphone: boolean;
  input_monitoring: boolean;
  microphone_grant: Grant;
  // The app macOS is actually judging our microphone request as, when that
  // isn't us (a terminal that launched us, say). Null in the normal case.
  charged_to: string | null;
  // One sentence saying why the microphone row can't go green, when there's
  // something the reader couldn't otherwise have known. Null when there isn't.
  microphone_hint: string | null;
  /** True once the global hotkey (Fn tap / Right Ctrl hook) is actually live —
   *  false for the macOS stale-TCC case where "granted" isn't really working. */
  hotkey_wired: boolean;
  has_openai_key: boolean;
  has_anthropic_key: boolean;
}

// What the Hub falls back to before the first read lands (and in a plain
// browser preview, where there's no shell to ask).
export const UNKNOWN_STATUS: Status = {
  accessibility: false,
  microphone: false,
  input_monitoring: false,
  microphone_grant: "not_asked",
  charged_to: null,
  microphone_hint: null,
  hotkey_wired: false,
  has_openai_key: false,
  has_anthropic_key: false,
};

export interface StatsSummary {
  total_words: number;
  total_sessions: number;
  total_speaking_secs: number;
  avg_wpm: number;
  best_wpm: number;
  words_today: number;
  wpm_today: number;
  day_streak: number;
  time_saved_secs: number;
  last7_words: number[];
}

export const EMPTY_STATS: StatsSummary = {
  total_words: 0,
  total_sessions: 0,
  total_speaking_secs: 0,
  avg_wpm: 0,
  best_wpm: 0,
  words_today: 0,
  wpm_today: 0,
  day_streak: 0,
  time_saved_secs: 0,
  last7_words: [0, 0, 0, 0, 0, 0, 0],
};

export const DEFAULT_SETTINGS: Settings = {
  cleanup_mode: "open_ai",
  cleanup_level: "light",
  openai_model: "gpt-4o-mini",
  openai_base_url: "",
  anthropic_model: "claude-haiku-4-5",
  asr_mode: "local",
  asr_base_url: "",
  asr_model: "whisper-large-v3-turbo",
  sound_on_start: true,
  hands_free_hotkey: "CmdOrCtrl+Shift+Space",
  show_pill_always: true,
  pill_bottom_inset: 96,
  pill_pos: null,
  pill_follows_active_display: true,
  language: "en",
  push_to_talk_key: "fn",
  launch_at_login: false,
  show_in_dock: true,
  microphone: "",
  style_instructions: "",
  keybindings: DEFAULT_KEYBINDINGS,
};

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function getSettings(): Promise<Settings> {
  try {
    return await invoke<Settings>("get_settings");
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function setSettings(settings: Settings): Promise<void> {
  try {
    await invoke<void>("set_settings", { settings });
  } catch {
    /* browser preview — no-op */
  }
}

export async function getStatus(): Promise<Status> {
  try {
    return await invoke<Status>("get_status");
  } catch {
    return UNKNOWN_STATUS;
  }
}

// The permission heartbeat, pushed from Rust (`permissions::watch`) the moment
// macOS changes its mind. This is what makes the setup screen's promise —
// "turns green the moment macOS applies it, no relaunch needed" — true even
// when the Hub's own timer isn't running, which is exactly when the reader is
// off in System Settings doing the granting. Payload is the permission half of
// `Status`; the key fields ride along unchanged.
export type Permissions = Pick<
  Status,
  | "accessibility"
  | "microphone"
  | "input_monitoring"
  | "microphone_grant"
  | "charged_to"
  | "microphone_hint"
>;

export async function onPermissions(cb: (p: Permissions) => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<Permissions>("whimpr://permissions", (e) => cb(e.payload));
  } catch {
    return () => {};
  }
}

/**
 * Fix the macOS stale-Accessibility case: reset the TCC entry, re-prompt, and
 * open the Accessibility pane so the user can enable WhimprFlow fresh.
 */
export async function fixAccessibility(): Promise<void> {
  try {
    await invoke<void>("fix_accessibility");
  } catch {
    /* browser preview */
  }
}

// The most recent loud diagnostic from the dictation pipeline (permission
// missing, hotkey tap dead, paste failed, empty transcript, …). Mirrors
// `diag::ErrorDto` in src-tauri/src/diag.rs.
export interface LastError {
  headline: string;
  detail: string;
}

export async function getLastError(): Promise<LastError | null> {
  try {
    return await invoke<LastError | null>("get_last_error");
  } catch {
    return null;
  }
}

export async function getStats(): Promise<StatsSummary> {
  try {
    const tz = new Date().getTimezoneOffset(); // minutes to add to local -> UTC
    return await invoke<StatsSummary>("get_stats", { tzOffsetMinutes: tz });
  } catch {
    return EMPTY_STATS;
  }
}

export async function requestMicrophone(): Promise<void> {
  try {
    await invoke<void>("request_microphone");
  } catch {
    /* browser preview */
  }
}

export async function requestAccessibility(): Promise<void> {
  try {
    await invoke<void>("request_accessibility");
  } catch {
    /* browser preview */
  }
}

export async function requestInputMonitoring(): Promise<void> {
  try {
    await invoke<void>("request_input_monitoring");
  } catch {
    /* browser preview */
  }
}

// Unlike the other wrappers, this one does NOT swallow errors — saving a key is
// an explicit user action and a silent failure here (e.g. no OS credential store
// available) should surface, not look like a successful save.
export async function setApiKey(provider: "openai" | "anthropic", key: string): Promise<void> {
  await invoke<void>("set_api_key", { provider, key });
}

// ── History ────────────────────────────────────────────────────────────────
// Mirrors whimpr-core's Provenance: where a dictation's text came from.
export interface Provenance {
  // ASR engine + model, e.g. "whisper.cpp:ggml-base.en.bin".
  asr_engine: string;
  // "raw" | "local" | "openai:<model>" | "anthropic:<model>" | "snippet" | "workflow:<name>"
  cleanup: string;
  sent_to_cloud: boolean;
  gate: "passed" | "rejected" | "skipped" | string;
}

export interface HistoryItem {
  ts_unix: number;
  text: string;
  app: string | null;
  words: number;
  // Raw (pre-cleanup) transcript, for the raw-vs-final diff view. Optional —
  // older backend builds don't send it.
  raw?: string;
  provenance?: Provenance;
  confidence?: number | null;
  low_words?: string[];
}

export async function getHistory(limit?: number): Promise<HistoryItem[]> {
  try {
    return await invoke<HistoryItem[]>("get_history", { limit });
  } catch {
    return [];
  }
}

export async function exportHistory(format: "json" | "txt"): Promise<string> {
  return invoke<string>("export_history", { format });
}

/// Quit and relaunch. macOS fixes an app's microphone authorisation at launch,
/// so a grant made while running only takes effect after a restart.
export async function restartApp(): Promise<void> {
  try {
    await invoke<void>("restart_app");
  } catch {
    /* browser preview — no-op */
  }
}

/// Persist a pill position the user dragged to (physical px, window top-left).
export async function setPillPosition(x: number, y: number): Promise<void> {
  try {
    await invoke<void>("set_pill_position", { x, y });
  } catch {
    /* browser preview — no-op */
  }
}

/// Forget the dragged position; the pill returns to its computed anchor.
export async function resetPillPosition(): Promise<void> {
  try {
    await invoke<void>("reset_pill_position");
  } catch {
    /* browser preview — no-op */
  }
}

/// Copy text to the system clipboard. Routed through the Rust side (arboard)
/// rather than navigator.clipboard, which needs a secure context and a user
/// gesture the webview does not always report.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await invoke<void>("copy_to_clipboard", { text });
    return true;
  } catch {
    // Browser preview fallback.
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

// ── Transforms ───────────────────────────────────────────────────────────────
export interface Transform {
  id: string;
  name: string;
  triggers: string[];
  prompt: string;
  enabled: boolean;
}

export async function getTransforms(): Promise<Transform[]> {
  try {
    return await invoke<Transform[]>("get_transforms");
  } catch {
    return [];
  }
}

export async function setTransformEnabled(id: string, enabled: boolean): Promise<void> {
  try {
    await invoke<void>("set_transform_enabled", { id, enabled });
  } catch {
    /* browser preview */
  }
}

// ── Snippets ─────────────────────────────────────────────────────────────────
export interface Snippet {
  trigger: string;
  expansion: string;
}

export async function getSnippets(): Promise<Snippet[]> {
  try {
    return await invoke<Snippet[]>("get_snippets");
  } catch {
    return [];
  }
}

export async function addSnippet(trigger: string, expansion: string): Promise<void> {
  try {
    await invoke<void>("add_snippet", { trigger, expansion });
  } catch {
    /* browser preview */
  }
}

export async function removeSnippet(trigger: string): Promise<void> {
  try {
    await invoke<void>("remove_snippet", { trigger });
  } catch {
    /* browser preview */
  }
}

// ── Scratchpad ───────────────────────────────────────────────────────────────
export async function getScratchpad(): Promise<string> {
  try {
    return await invoke<string>("get_scratchpad");
  } catch {
    return "";
  }
}

export async function setScratchpad(text: string): Promise<void> {
  try {
    await invoke<void>("set_scratchpad", { text });
  } catch {
    /* browser preview */
  }
}

export async function getScratchpadCapture(): Promise<boolean> {
  try {
    return await invoke<boolean>("get_scratchpad_capture");
  } catch {
    return false;
  }
}

export async function setScratchpadCapture(on: boolean): Promise<void> {
  try {
    await invoke<void>("set_scratchpad_capture", { on });
  } catch {
    /* browser preview */
  }
}

// ── Dictionary ───────────────────────────────────────────────────────────────
export interface DictEntry {
  correct: string;
  mishears: string[];
  auto: boolean;
}

export async function getDictionary(): Promise<DictEntry[]> {
  try {
    return await invoke<DictEntry[]>("get_dictionary");
  } catch {
    return [];
  }
}

export async function addDictionaryEntry(correct: string, mishears: string[]): Promise<void> {
  try {
    await invoke<void>("add_dictionary_entry", { correct, mishears });
  } catch {
    /* browser preview — no-op */
  }
}

export async function removeDictionaryEntry(correct: string): Promise<void> {
  try {
    await invoke<void>("remove_dictionary_entry", { correct });
  } catch {
    /* browser preview — no-op */
  }
}

// ── Health ───────────────────────────────────────────────────────────────────
// Is dictation actually ready end to end (ASR model, local LLM, mic +
// accessibility permissions). Mirrors the shell's hotkey::Health.
export interface Health {
  asr_ready: boolean;
  asr_model: string | null;
  local_llm_ready: boolean;
  microphone: boolean;
  accessibility: boolean;
}

export async function getHealth(): Promise<Health> {
  try {
    return await invoke<Health>("get_health");
  } catch {
    return {
      asr_ready: false,
      asr_model: null,
      local_llm_ready: false,
      microphone: false,
      accessibility: false,
    };
  }
}

export interface ModelProgress {
  file_name: string;
  downloaded: number;
  total: number;
}

/** Download recommended Whisper model; listen to `whimpr://model/progress` for bytes. */
export async function downloadAsrModel(modelId?: string): Promise<string> {
  return invoke<string>("download_asr_model", { modelId: modelId ?? null });
}

export async function reloadAsr(): Promise<void> {
  try {
    await invoke("reload_asr");
  } catch (e) {
    console.error("reloadAsr failed", e);
  }
}

export interface BuildInfo {
  version: string;
  git_hash: string;
}

export async function getBuildInfo(): Promise<BuildInfo> {
  try {
    return await invoke<BuildInfo>("get_build_info");
  } catch {
    return { version: "1.0.0", git_hash: "dev" };
  }
}

export async function exportDiagnostics(): Promise<string> {
  return invoke<string>("export_diagnostics");
}

export async function checkNetwork(): Promise<boolean> {
  try {
    return await invoke<boolean>("check_network");
  } catch {
    return true;
  }
}

// ── Shell events ─────────────────────────────────────────────────────────────
// Mirrors src-tauri's payload structs. The overlay pill and the Hub both
// subscribe to these.
export const EVENT_TRANSCRIPT_PARTIAL = "whimpr://transcript/partial";
export const EVENT_RECEIPT = "whimpr://receipt";

// Live provisional text while recording (streaming preview).
export interface PartialTranscriptEvent {
  text: string;
}

export type ReceiptAction = "pasted" | "noted" | "clipboard" | "pending" | "error";

// The insertion receipt emitted after every finalize.
export interface ReceiptEvent {
  ok: boolean;
  action: ReceiptAction;
  app: string | null;
  words: number;
  confidence: number | null;
  low_words: string[];
  message: string | null;
}

// Subscribe to a shell event. In a plain browser the event import fails and
// the returned unsubscribe is a no-op (same fallback pattern as invoke).
export async function listenEvent<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<T>(event, (e) => cb(e.payload as T));
  } catch {
    return () => {};
  }
}

export function onTranscriptPartial(cb: (p: PartialTranscriptEvent) => void): Promise<() => void> {
  return listenEvent<PartialTranscriptEvent>(EVENT_TRANSCRIPT_PARTIAL, cb);
}

export function onReceipt(cb: (p: ReceiptEvent) => void): Promise<() => void> {
  return listenEvent<ReceiptEvent>(EVENT_RECEIPT, cb);
}

