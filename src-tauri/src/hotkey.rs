//! macOS dictation pipeline: hotkey hook, ASR, cleanup, and paste.
//!
//! Installs an in-process CoreGraphics event tap that feeds Fn key-down/key-up
//! into the [`whimpr_core::StateMachine`]. The machine's actions drive mic
//! capture, on-device or cloud Whisper transcription, LLM cleanup (local/OpenAI/
//! Anthropic), and clipboard-relay paste at the cursor. State transitions emit
//! `whimpr://flowbar/state` events so the overlay pill stays in sync.

/// Dictionary entry shape sent to the Hub UI (auto-learned entries flagged).
#[derive(Clone, serde::Serialize)]
pub struct DictEntryDto {
    pub correct: String,
    pub mishears: Vec<String>,
    pub auto: bool,
}

#[cfg(target_os = "macos")]
mod imp {
    use std::os::raw::c_void;
    use std::path::PathBuf;
    use super::DictEntryDto;
    use std::ptr::{null, null_mut};
    use std::sync::atomic::{AtomicBool, AtomicI64, AtomicPtr, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::time::{Duration, Instant};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use whimpr_core::state::{Action, BarState};
    use whimpr_core::{
        CleanupContext, CleanupMode, CleanupProvider, Input, PipelineEvent, StateMachine,
        TriggerToken,
    };
    use whimpr_core::{BindingId, SessionId};

    const OVERLAY_LABEL: &str = "whimpr_bar";

    // --- CoreGraphics / CoreFoundation FFI (listen-only Fn tap) -----------
    type CFMachPortRef = *mut c_void;
    type CFRunLoopSourceRef = *mut c_void;
    type CFRunLoopRef = *mut c_void;
    type CFStringRef = *const c_void;
    type CFAllocatorRef = *const c_void;
    type CGEventRef = *mut c_void;
    type CGEventTapProxy = *mut c_void;
    type CGEventTapCallBack =
        extern "C" fn(CGEventTapProxy, u32, CGEventRef, *mut c_void) -> CGEventRef;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventTapCreate(
            tap: u32,
            place: u32,
            options: u32,
            events_of_interest: u64,
            callback: CGEventTapCallBack,
            user_info: *mut c_void,
        ) -> CFMachPortRef;
        fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
        fn CGEventGetFlags(event: CGEventRef) -> u64;
        fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFMachPortCreateRunLoopSource(
            allocator: CFAllocatorRef,
            port: CFMachPortRef,
            order: isize,
        ) -> CFRunLoopSourceRef;
        fn CFRunLoopGetCurrent() -> CFRunLoopRef;
        fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFStringRef);
        fn CFRunLoopRun();
        static kCFRunLoopDefaultMode: CFStringRef;
    }

    const K_CG_SESSION_EVENT_TAP: u32 = 1;
    const K_CG_HEAD_INSERT: u32 = 0;
    const K_CG_TAP_OPTION_LISTEN_ONLY: u32 = 1;
    const K_CG_EVENT_FLAGS_CHANGED: u32 = 12;
    const EVENTS_OF_INTEREST: u64 = 1 << K_CG_EVENT_FLAGS_CHANGED;
    const FLAG_SECONDARY_FN: u64 = 0x0080_0000;
    const K_CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;
    const KEYCODE_FN: i64 = 63;
    /// The push-to-talk binding, held in atomics because the tap callback runs on
    /// every flags-changed event and must not take a lock to read it.
    static PTT_KEYCODE: AtomicI64 = AtomicI64::new(KEYCODE_FN);
    static PTT_MASK: AtomicU64 = AtomicU64::new(FLAG_SECONDARY_FN);
    const K_CG_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
    const K_CG_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static MACHINE: OnceLock<Mutex<StateMachine>> = OnceLock::new();
    static CLOCK: OnceLock<Instant> = OnceLock::new();
    static FN_IS_DOWN: AtomicBool = AtomicBool::new(false);
    static TAP_PORT: AtomicPtr<c_void> = AtomicPtr::new(null_mut());
    /// True once the global Fn CGEventTap is actually created and running —
    /// distinct from `AXIsProcessTrusted`, which can report "granted" for a
    /// stale TCC entry that macOS will never honor for this build's signature.
    /// Drives the Hub's `hotkey_wired` status and the stale-grant Fix flow.
    static TAP_LIVE: AtomicBool = AtomicBool::new(false);
    /// Set once at startup if no Whisper model file exists on disk at all —
    /// distinct from "still loading", so the finalize path only shows the
    /// user a loud "no speech model" error for the real case, not a race
    /// against the ~1s background load right after launch.
    static ASR_MODEL_MISSING: AtomicBool = AtomicBool::new(false);
    static TARGET_APP: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    /// The live microphone capture, tagged with the session that owns it, so a
    /// capture that finishes starting after its session was already discarded
    /// (a sub-200ms tap) is stopped instead of leaking with the mic left open.
    static CAPTURE: OnceLock<Mutex<Option<(SessionId, whimpr_audio::CaptureHandle)>>> =
        OnceLock::new();
    static ASR: OnceLock<Mutex<Option<Arc<dyn whimpr_core::AsrEngine>>>> = OnceLock::new();
    /// Bumped on every local-ASR (re)load so a slow, superseded load cannot
    /// overwrite the engine a later settings change installed.
    static ASR_LOAD_GEN: AtomicU64 = AtomicU64::new(0);
    // Providers are behind Arc so a cleanup can clone one out and release the
    // slot lock before the request; holding the lock for a 15s HTTP call (or a
    // local inference) froze every settings write that needed to rebuild them.
    static OPENAI: OnceLock<Mutex<Option<Arc<whimpr_cleanup::OpenAiProvider>>>> = OnceLock::new();
    static ANTHROPIC: OnceLock<Mutex<Option<Arc<whimpr_cleanup::AnthropicProvider>>>> =
        OnceLock::new();
    static LOCAL: OnceLock<Mutex<Option<Arc<Mutex<crate::local_llm::LocalWorker>>>>> =
        OnceLock::new();
    static SETTINGS: OnceLock<Mutex<whimpr_core::Settings>> = OnceLock::new();
    /// Last state pushed to the pill, so UI-driven controls can act correctly.
    static LAST_BAR: OnceLock<Mutex<&'static str>> = OnceLock::new();
    static DICTIONARY: OnceLock<Mutex<whimpr_core::DictionaryStore>> = OnceLock::new();
    static STATS: OnceLock<Mutex<whimpr_core::StatsStore>> = OnceLock::new();

    #[derive(Clone, Serialize)]
    struct WavePayload {
        bars: Vec<f32>,
    }

    #[derive(Clone, Serialize)]
    struct TranscriptPayload {
        text: String,
    }

    /// Whisper model files, best first. Bigger models mis-hear names and
    /// technical terms far less (and better ASR means less for cleanup and the
    /// dictionary to fix downstream). Shared with the Hub's model-status check
    /// and the onboarding download so the three can never disagree.
    pub const MODEL_NAMES: &[&str] = &[
        "ggml-large-v3-turbo.bin",
        "ggml-medium.en.bin",
        "ggml-small.en.bin",
        "ggml-base.bin",
        "ggml-base.en.bin",
    ];

    /// The models directory: `~/Library/Application Support/WhimprFlow/models`.
    pub fn models_dir() -> PathBuf {
        support_dir().join("models")
    }

    /// The whisper ASR model to load: the best one present, else the base model
    /// path (which then does not exist, and the caller reports it).
    pub fn model_path() -> PathBuf {
        let dir = models_dir();
        MODEL_NAMES
            .iter()
            .map(|name| dir.join(name))
            .find(|p| p.exists())
            .unwrap_or_else(|| dir.join("ggml-base.en.bin"))
    }

    fn support_dir() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join("Library/Application Support/WhimprFlow")
    }
    fn settings_path() -> PathBuf {
        support_dir().join("settings.json")
    }
    fn dict_path() -> PathBuf {
        support_dir().join("dictionary.json")
    }
    fn stats_path() -> PathBuf {
        support_dir().join("stats.json")
    }

    /// Seconds since the Unix epoch (UTC), or 0 if the clock is before the epoch.
    fn unix_now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    /// Log one completed dictation to the stats store (words, speaking time, text,
    /// target app) and persist it. Powers both the Hub stats and the history list.
    pub fn record_dictation(text: &str, duration_secs: f32) {
        let words = whimpr_core::stats::count_words(text);
        if words == 0 {
            return;
        }
        let app = TARGET_APP.get().and_then(|m| m.lock().unwrap().clone());
        // History off: keep the counts the stats need, never the words.
        let text = if current_settings().save_history { text.to_string() } else { String::new() };
        if let Some(m) = STATS.get() {
            let mut store = m.lock().unwrap();
            let duration_ms = (duration_secs.max(0.0) * 1000.0) as u32;
            let chars = text.chars().count() as u32;
            store.record(words, duration_ms, chars, unix_now(), text, app);
            let _ = store.save(&stats_path());
        }
    }

    /// The most recent dictations for the Hub Home history list.
    pub fn history(limit: usize) -> Vec<whimpr_core::HistoryItem> {
        STATS
            .get()
            .map(|m| m.lock().unwrap().history(limit))
            .unwrap_or_default()
    }

    /// The dictionary entries for the Hub Dictionary screen (auto-learned flagged).
    pub fn dictionary_entries() -> Vec<DictEntryDto> {
        DICTIONARY
            .get()
            .map(|m| {
                m.lock()
                    .unwrap()
                    .entries
                    .iter()
                    .map(|e| DictEntryDto {
                        correct: e.correct.clone(),
                        mishears: e.mishears.clone(),
                        auto: matches!(e.source, whimpr_core::DictSource::Auto),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Add a manual dictionary entry and persist.
    pub fn dictionary_add(correct: String, mishears: Vec<String>) {
        if let Some(m) = DICTIONARY.get() {
            let mut store = m.lock().unwrap();
            store.add(correct, mishears, whimpr_core::DictSource::Manual);
            let _ = store.save(&dict_path());
        }
    }

    /// Remove a dictionary entry by spelling and persist.
    pub fn dictionary_remove(correct: &str) {
        if let Some(m) = DICTIONARY.get() {
            let mut store = m.lock().unwrap();
            if store.remove(correct) {
                let _ = store.save(&dict_path());
            }
        }
    }

    /// Add an AUTO-learned entry (from the post-paste correction observer) and persist.
    /// Marked ✨ auto in the UI. No-op if it would duplicate an existing entry's data.
    pub fn dictionary_learn(correct: String, mishears: Vec<String>) {
        if let Some(m) = DICTIONARY.get() {
            let mut store = m.lock().unwrap();
            store.add(correct, mishears, whimpr_core::DictSource::Auto);
            let _ = store.save(&dict_path());
        }
    }

    /// Aggregated stats for the Hub. `tz_offset_minutes` is the UI's
    /// `Date.getTimezoneOffset()` so day math matches the user's local clock.
    pub fn stats_summary(tz_offset_minutes: i32) -> whimpr_core::StatsSummary {
        STATS
            .get()
            .map(|m| m.lock().unwrap().summary(tz_offset_minutes, unix_now()))
            .unwrap_or_else(|| {
                whimpr_core::StatsStore::default().summary(tz_offset_minutes, unix_now())
            })
    }

    /// Read an API key from an env var or the OS keychain (never a plaintext file).
    fn read_key(account: &str, env_var: &str) -> Option<String> {
        if let Ok(k) = std::env::var(env_var) {
            let k = k.trim().to_string();
            if !k.is_empty() {
                return Some(k);
            }
        }
        keyring::Entry::new("com.whimpr.whimprflow", account)
            .ok()
            .and_then(|e| e.get_password().ok())
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
    }
    pub fn read_openai_key() -> Option<String> {
        read_key("openai_api_key", "OPENAI_API_KEY")
    }
    pub fn read_anthropic_key() -> Option<String> {
        read_key("anthropic_api_key", "ANTHROPIC_API_KEY")
    }
    /// The cloud-ASR key: its own slot (a Groq key, say), falling back to the
    /// OpenAI key so the old single-key setup keeps working.
    pub fn read_asr_key() -> Option<String> {
        read_key("asr_api_key", "WHIMPR_ASR_API_KEY").or_else(read_openai_key)
    }

    /// A snapshot of the current settings.
    pub fn current_settings() -> whimpr_core::Settings {
        SETTINGS
            .get()
            .map(|m| m.lock().unwrap().clone())
            .unwrap_or_default()
    }
    /// Apply new settings and rebuild the cloud providers (picks up model changes).
    /// The speech engine is only rebuilt when a field it depends on changed:
    /// every save used to reload the 1.5 GB Whisper model, and typing in any
    /// settings field saves every 400ms.
    pub fn update_settings(new: whimpr_core::Settings) {
        let old = current_settings();
        if let Some(m) = SETTINGS.get() {
            *m.lock().unwrap() = new.clone();
        }
        let _ = new.save(&settings_path());
        apply_live_settings(&new);
        rebuild_providers();
        let asr_changed = old.asr_mode != new.asr_mode
            || old.asr_base_url != new.asr_base_url
            || old.asr_model != new.asr_model;
        if asr_changed {
            rebuild_asr(&new);
        }
    }

    // ── Pill controls ────────────────────────────────────────────────────────
    // The pill's Stop and Cancel buttons, and click-to-start, all feed the SAME
    // state machine the Fn key does — rather than a parallel code path that could
    // drift out of sync with it.
    pub fn last_bar() -> &'static str {
        LAST_BAR
            .get()
            .map(|m| *m.lock().unwrap())
            .unwrap_or("idle")
    }

    /// Discard the in-flight dictation. Same input Esc produces.
    pub fn ui_cancel() {
        handle_input(Input::Trigger(TriggerToken::Cancel { at_ms: now_ms() }));
    }

    /// Finish now and insert what has been said so far. `Stop` finalizes a live
    /// recording in either mode, so this needs no guess about which key or
    /// gesture started it.
    pub fn ui_stop() {
        handle_input(Input::Trigger(TriggerToken::Stop { at_ms: now_ms() }));
    }

    /// Start a hands-free dictation from a click on the pill.
    ///
    /// The machine only enters hands-free via a double-tap, so this synthesises
    /// one: a short tap (under HOLD_MIN_MS so it is read as a tap, not a hold),
    /// then a second press inside the DOUBLE_TAP_MS window, which locks it.
    pub fn ui_start() {
        if last_bar() != "idle" {
            return;
        }
        let t = now_ms();
        let ptt = BindingId::PushToTalk;
        handle_input(Input::Trigger(TriggerToken::Down { binding: ptt, at_ms: t }));
        handle_input(Input::Trigger(TriggerToken::Up { binding: ptt, at_ms: t + 10 }));
        handle_input(Input::Trigger(TriggerToken::Down { binding: ptt, at_ms: t + 20 }));
        handle_input(Input::Trigger(TriggerToken::Up { binding: ptt, at_ms: t + 30 }));
    }

    // ── Audio cues ───────────────────────────────────────────────────────────
    #[derive(Clone, Copy)]
    pub enum Cue {
        /// Recording has begun — the "I'm listening" confirmation.
        Start,
        /// Text has been inserted.
        Done,
        /// Cancelled, or nothing usable was heard.
        Cancel,
    }

    /// Play a short macOS system sound.
    ///
    /// `afplay` rather than NSSound: no extra dependency, no main-thread
    /// requirement, and it can be fired from the event-tap thread without any
    /// risk of blocking key handling. The child is reaped on its own thread so
    /// repeated dictations don't leave zombie processes behind.
    fn play_cue(cue: Cue) {
        if !current_settings().sound_on_start {
            return;
        }
        // Chosen to be short and unobtrusive: a soft click to start, a lighter
        // one to confirm, a duller one for a discard.
        let sound = match cue {
            Cue::Start => "Pop",
            Cue::Done => "Tink",
            Cue::Cancel => "Bottle",
        };
        let path = format!("/System/Library/Sounds/{sound}.aiff");
        std::thread::spawn(move || {
            let _ = std::process::Command::new("/usr/bin/afplay")
                .arg(&path)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        });
    }

    /// Push the settings that other subsystems cache into place. Everything here
    /// takes effect immediately — no relaunch, no model reload.
    pub fn apply_live_settings(s: &whimpr_core::Settings) {
        let (keycode, mask) = s.push_to_talk_key.keycode_and_mask();
        PTT_KEYCODE.store(keycode, Ordering::Relaxed);
        PTT_MASK.store(mask, Ordering::Relaxed);

        if let Some(slot) = ASR.get() {
            if let Some(asr) = slot.lock().unwrap().as_ref() {
                asr.set_language(&s.language);
            }
        }
    }

    /// (Re)build the cloud cleanup providers from the current keys + settings. Called
    /// at startup and whenever a key or model changes, so edits take effect live.
    pub fn rebuild_providers() {
        let settings = current_settings();
        let openai = read_openai_key().map(|k| {
            whimpr_cleanup::OpenAiProvider::with_base_url(
                k,
                settings.openai_model.clone(),
                Some(settings.openai_base_url.clone()),
            )
        });
        let anthropic = read_anthropic_key()
            .map(|k| whimpr_cleanup::AnthropicProvider::new(k, settings.anthropic_model.clone()));
        eprintln!(
            "[whimpr] cleanup providers: openai={}, anthropic={}",
            openai.is_some(),
            anthropic.is_some()
        );
        let openai = openai.map(Arc::new);
        let anthropic = anthropic.map(Arc::new);
        match OPENAI.get() {
            Some(m) => *m.lock().unwrap() = openai,
            None => {
                let _ = OPENAI.set(Mutex::new(openai));
            }
        }
        match ANTHROPIC.get() {
            Some(m) => *m.lock().unwrap() = anthropic,
            None => {
                let _ = ANTHROPIC.set(Mutex::new(anthropic));
            }
        }
        sync_local_worker(settings.cleanup_mode);
    }

    /// (Re)build the speech-to-text engine to match the current ASR mode.
    /// Cloud is built synchronously (just an HTTP client); local Whisper loads
    /// off-thread since parsing the model takes ~1s.
    pub fn rebuild_asr(settings: &whimpr_core::Settings) {
        // Any load in flight from an earlier call is now stale.
        let gen = ASR_LOAD_GEN.fetch_add(1, Ordering::SeqCst) + 1;
        match settings.asr_mode {
            whimpr_core::AsrMode::Cloud => {
                let key = read_asr_key();
                let Some(key) = key else {
                    eprintln!(
                        "[whimpr] ASR: cloud mode but no API key saved (set the cloud ASR \
                         key, or the OpenAI key, in Settings)"
                    );
                    return;
                };
                let model = settings.asr_model.clone();
                eprintln!(
                    "[whimpr] ASR: cloud mode, model={model}, base_url={:?}",
                    settings.asr_base_url
                );
                let engine = whimpr_cleanup::CloudAsr::with_base_url(
                    key,
                    model,
                    Some(settings.asr_base_url.clone()),
                );
                let engine: Arc<dyn whimpr_core::AsrEngine> = Arc::new(engine);
                engine.set_language(&settings.language);
                if let Some(slot) = ASR.get() {
                    *slot.lock().unwrap() = Some(engine);
                }
                ASR_MODEL_MISSING.store(false, Ordering::SeqCst);
                eprintln!("[whimpr] ASR ready (cloud)");
            }
            whimpr_core::AsrMode::Local => {
                let language = settings.language.clone();
                std::thread::spawn(move || {
                    let path = model_path();
                    if !path.exists() {
                        eprintln!("[whimpr] ASR model not found at {}", path.display());
                        ASR_MODEL_MISSING.store(true, Ordering::SeqCst);
                        return;
                    }
                    match whimpr_asr::WhisperEngine::load(&path) {
                        Ok(engine) => {
                            if ASR_LOAD_GEN.load(Ordering::SeqCst) != gen {
                                eprintln!("[whimpr] ASR load superseded, discarding");
                                return;
                            }
                            engine.set_language(&language);
                            let engine: Arc<dyn whimpr_core::AsrEngine> = Arc::new(engine);
                            if let Some(slot) = ASR.get() {
                                *slot.lock().unwrap() = Some(engine);
                            }
                            ASR_MODEL_MISSING.store(false, Ordering::SeqCst);
                            eprintln!("[whimpr] ASR ready (local)");
                        }
                        Err(e) => {
                            eprintln!("[whimpr] ASR model load failed: {e}");
                            ASR_MODEL_MISSING.store(true, Ordering::SeqCst);
                        }
                    }
                });
            }
        }
    }

    /// Start (or stop) the local llama.cpp cleanup worker to match the current
    /// cleanup mode — it's only worth the RAM/CPU when `Local` is actually selected.
    fn sync_local_worker(mode: CleanupMode) {
        let Some(slot) = LOCAL.get() else { return };
        if matches!(mode, CleanupMode::Local) {
            if slot.lock().unwrap().is_none() {
                std::thread::spawn(|| {
                    if let Some(w) = crate::local_llm::spawn_default() {
                        if let Some(slot) = LOCAL.get() {
                            let mut guard = slot.lock().unwrap();
                            // Two rapid settings saves can both see an empty slot;
                            // the second worker to arrive is dropped (and killed).
                            if guard.is_none() {
                                *guard = Some(Arc::new(Mutex::new(w)));
                            }
                        }
                    }
                });
            }
        } else {
            // Dropping the Arc here does not kill a worker mid-inference: the
            // cleanup thread holds its own clone until it is done.
            *slot.lock().unwrap() = None;
        }
    }

    /// The local worker, if one is running. Clones the handle out so the slot
    /// lock is not held during inference.
    fn local_worker() -> Option<Arc<Mutex<crate::local_llm::LocalWorker>>> {
        LOCAL.get().and_then(|m| m.lock().unwrap().clone())
    }

    /// After a local cleanup error: if the worker process is gone (crashed, or
    /// killed on timeout), clear the slot and start a fresh one so the NEXT
    /// dictation gets cleanup again instead of failing forever.
    fn respawn_local_worker_if_dead(worker: &Arc<Mutex<crate::local_llm::LocalWorker>>) {
        if !worker.lock().unwrap().is_dead() {
            return;
        }
        eprintln!("[whimpr] local LLM worker died — restarting it");
        if let Some(slot) = LOCAL.get() {
            let mut guard = slot.lock().unwrap();
            if guard.as_ref().is_some_and(|w| Arc::ptr_eq(w, worker)) {
                *guard = None;
            }
        }
        sync_local_worker(current_settings().cleanup_mode);
    }

    /// Clean a raw transcript per the current settings (mode + level), feeding in the
    /// dictionary vocabulary relevant to this utterance. Falls back to raw whenever
    /// cleanup is off, the provider is unavailable, it errors, or the gates reject it.
    fn clean_transcript(raw: &str) -> String {
        let settings = current_settings();
        let level = settings.cleanup_level;
        if matches!(settings.cleanup_mode, CleanupMode::Raw) || level.bypasses_llm() {
            return raw.to_string();
        }
        // Turn explicit spoken layout cues ("new line", "new paragraph") into break
        // markers up front — the model passes an opaque marker through reliably but
        // mangles the literal cue words. The model sees `raw` (with markers); the gate
        // and any raw fallback use `raw_out` (markers restored to real breaks) so we
        // never paste a "[[NL]]" token or lose an explicit break.
        let raw_norm = whimpr_core::cleanup::pre_normalize_layout(raw);
        let raw = raw_norm.as_str();
        let raw_out = whimpr_core::cleanup::post_process(&raw_norm);
        let vocab = DICTIONARY
            .get()
            .map(|d| d.lock().unwrap().prefilter(raw, 15))
            .unwrap_or_default();
        let app_bundle_id = TARGET_APP.get().and_then(|m| m.lock().unwrap().clone());
        if let Some(app) = app_bundle_id.as_deref() {
            eprintln!("[whimpr] cleanup target app: {app}");
        }
        let style = {
            let s = settings.style_instructions.trim();
            if s.is_empty() { None } else { Some(s.to_string()) }
        };
        let ctx = CleanupContext {
            level,
            vocab,
            app_bundle_id,
            style,
            ..Default::default()
        };
        // The selected provider, or None when it is not available (no key saved,
        // local worker not running). Each provider handle is cloned out of its
        // slot first so the request runs without holding the slot lock.
        let result: Option<anyhow::Result<String>> = match settings.cleanup_mode {
            CleanupMode::OpenAi => OPENAI
                .get()
                .and_then(|m| m.lock().unwrap().clone())
                .map(|p| p.cleanup(raw, &ctx)),
            CleanupMode::Anthropic => ANTHROPIC
                .get()
                .and_then(|m| m.lock().unwrap().clone())
                .map(|p| p.cleanup(raw, &ctx)),
            CleanupMode::Local => local_worker().map(|worker| {
                // System prompt + few-shot demonstration turns + the transcript,
                // so the on-device model actually produces newlines/lists and
                // resolves self-corrections instead of just being told to.
                let messages = whimpr_core::cleanup::build_messages(raw, &ctx);
                let out = worker.lock().unwrap().cleanup(&messages);
                if out.is_err() {
                    respawn_local_worker_if_dead(&worker);
                }
                out
            }),
            CleanupMode::Raw => None,
        };
        match result {
            Some(Ok(cleaned)) => {
                // Deterministic safety net: convert any leftover spoken layout cue the
                // model missed into real line breaks, strip stray code fences, cap blank
                // lines. Guarantees no "new line"/"new paragraph" word reaches the cursor.
                let cleaned = whimpr_core::cleanup::post_process(&cleaned);
                if whimpr_core::cleanup::evaluate_gates(&raw_out, &cleaned, level).passed() {
                    cleaned
                } else {
                    eprintln!("[whimpr] cleanup gate rejected the edit — pasting raw");
                    raw_out
                }
            }
            Some(Err(e)) => {
                eprintln!("[whimpr] cleanup failed ({e}) — pasting raw");
                raw_out
            }
            None => {
                if matches!(settings.cleanup_mode, CleanupMode::Local) {
                    eprintln!("[whimpr] local cleanup worker not running — pasting raw");
                } else {
                    eprintln!("[whimpr] no API key for the selected cleanup provider — pasting raw");
                }
                raw_out
            }
        }
    }

    fn now_ms() -> u64 {
        CLOCK.get().map(|c| c.elapsed().as_millis() as u64).unwrap_or(0)
    }

    /// Take the capture handle for `session` out of the slot. A handle from
    /// another session is stopped and not returned.
    ///
    /// With `wait`, polls for up to a second: the stream can still be starting
    /// when a hold ends (a mic-permission prompt, a slow device), and reporting
    /// "no audio" then would lose a real dictation. Only the finalize thread
    /// waits; a discard runs on the key-tap thread and must return at once (a
    /// late-arriving handle is stopped by the capture thread's own check).
    fn take_capture(session: SessionId, wait: bool) -> Option<whimpr_audio::CaptureHandle> {
        let slot = CAPTURE.get_or_init(|| Mutex::new(None));
        let tries = if wait { 50 } else { 1 };
        for i in 0..tries {
            if let Some((owner, handle)) = slot.lock().unwrap().take() {
                if owner == session {
                    return Some(handle);
                }
                eprintln!("[whimpr] dropping capture from stale session {owner:?}");
                let _ = handle.stop();
            }
            if i + 1 < tries {
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        None
    }

    fn bar_name(b: BarState) -> &'static str {
        match b {
            BarState::Idle => "idle",
            BarState::Recording => "recording",
            BarState::Locked => "locked",
            BarState::Transcribing => "transcribing",
            BarState::Done => "done",
            BarState::Cancelled => "cancelled",
            BarState::Error => "error",
        }
    }

    /// Push a bar state; returns the generation stamp (see `crate::bar_gen`).
    fn emit_bar(app: &AppHandle, state: &'static str) -> u64 {
        eprintln!("[whimpr] pill -> {state}");
        // Remembered so `sync_pill_visibility` can re-show the right state.
        *LAST_BAR.get_or_init(|| Mutex::new("idle")).lock().unwrap() = state;
        // Shared emitter also toggles the overlay window: visible for every
        // state except idle, and re-anchors onto the display the user is
        // actually on when a session starts.
        crate::emit_flowbar_state(app, state)
    }

    /// Whether the machine is still in `Finalizing` for `session`, i.e. the
    /// user has not cancelled while the pipeline was running.
    fn session_still_finalizing(session: SessionId) -> bool {
        MACHINE.get().is_some_and(|m| {
            matches!(
                m.lock().unwrap().state(),
                whimpr_core::DictationState::Finalizing { session: s } if s == session
            )
        })
    }

    /// Feed one input into the shared state machine and enact its actions.
    fn handle_input(input: Input) {
        let (Some(app), Some(machine)) = (APP.get(), MACHINE.get()) else {
            return;
        };
        let actions = {
            let mut m = machine.lock().unwrap();
            m.step(input)
        };
        for action in actions {
            apply_action(app, action);
        }
    }

    fn apply_action(app: &AppHandle, action: Action) {
        match action {
            Action::ShowBar(bar) => {
                let gen = emit_bar(app, bar_name(bar));
                // Let the "done" tick linger briefly before returning to idle —
                // unless something newer (a fresh recording) has been shown since.
                if bar == BarState::Done {
                    let app2 = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(500));
                        if crate::bar_gen() == gen {
                            emit_bar(&app2, "idle");
                        }
                    });
                }
            }
            // Start the microphone; stream real RMS bars to the pill waveform.
            // Runs off the tap thread so the mic-permission prompt can't stall keys.
            Action::StartCapture { session, .. } => {
                let app_thread = app.clone();
                std::thread::spawn(move || {
                    let app_cb = app_thread.clone();
                    let device = current_settings().microphone;
                    match whimpr_audio::start_on_device(Some(device), move |bars| {
                        let _ = app_cb.emit_to(
                            OVERLAY_LABEL,
                            "whimpr://audio/waveform",
                            WavePayload { bars: bars.to_vec() },
                        );
                    }) {
                        Ok(handle) => {
                            // Starting the stream takes long enough that a quick tap
                            // can have discarded this session already. Only keep the
                            // handle if the session is still live; otherwise dropping
                            // it here stops the stream, so the mic never stays open.
                            let live = MACHINE.get().is_some_and(|m| {
                                matches!(
                                    m.lock().unwrap().state(),
                                    whimpr_core::DictationState::Recording { session: s, .. }
                                    | whimpr_core::DictationState::Finalizing { session: s }
                                    if s == session
                                )
                            });
                            if live {
                                *CAPTURE.get_or_init(|| Mutex::new(None)).lock().unwrap() =
                                    Some((session, handle));
                            } else {
                                eprintln!("[whimpr] capture for discarded session {session:?} stopped");
                            }
                        }
                        Err(e) => eprintln!("[whimpr] mic capture failed to start: {e}"),
                    }
                });
            }
            // Stop the mic, transcribe the buffered audio, and advance the machine.
            Action::StopCaptureAndFinalize { session } => {
                let app2 = app.clone();
                std::thread::spawn(move || {
                    // Report back into the machine. Committed shows the done tick;
                    // Failed goes straight to idle so an error state already on the
                    // pill stays visible. A session the user cancelled meanwhile is
                    // ignored by the machine either way.
                    let finish = |ok: bool| {
                        let at_ms = now_ms();
                        let ev = if ok {
                            PipelineEvent::Committed { session, at_ms }
                        } else {
                            PipelineEvent::Failed { session, at_ms }
                        };
                        handle_input(Input::Pipeline(ev));
                    };
                    let handle = take_capture(session, true);
                    let Some(res) = handle.and_then(|h| h.stop()) else {
                        eprintln!("[whimpr] no audio captured");
                        finish(false);
                        return;
                    };
                    let peak = res.samples.iter().fold(0f32, |m, &s| m.max(s.abs()));
                    eprintln!(
                        "[whimpr] captured {} samples @ {} Hz (~{:.2}s), peak {:.4}",
                        res.samples.len(),
                        res.sample_rate,
                        res.duration_secs(),
                        peak
                    );
                    // Below ~600ms is very likely an accidental brief tap (the SPEC's
                    // own single-tap-no-op gate), so don't alarm the user over it —
                    // only surface a loud diagnostic for holds long enough to be a
                    // real, intentional dictation attempt.
                    let was_real_attempt = res.duration_secs() >= 0.6;
                    if peak < 0.005 {
                        eprintln!(
                            "[whimpr] ⚠ audio is silent — the mic isn't being captured. Grant \
                             Microphone access to your terminal (System Settings → Privacy & \
                             Security → Microphone), then fully quit + reopen it and rerun."
                        );
                        if was_real_attempt {
                            crate::diag::report(
                                &app2,
                                whimpr_core::InjectionFailure::NoAudioCaptured,
                            );
                        }
                        finish(false);
                        return;
                    }
                    let asr = ASR.get().and_then(|m| m.lock().unwrap().clone());
                    let Some(asr) = asr else {
                        eprintln!("[whimpr] ASR not ready (model still loading or missing)");
                        if was_real_attempt && ASR_MODEL_MISSING.load(Ordering::SeqCst) {
                            crate::diag::report(&app2, whimpr_core::InjectionFailure::AsrUnavailable);
                        }
                        finish(false);
                        return;
                    };
                    let pcm = whimpr_audio::resample_to_16k(&res.samples, res.sample_rate);
                    match asr.transcribe(&pcm) {
                        Ok(t) => {
                            let raw = t.text;
                            eprintln!("[whimpr] TRANSCRIPT: \"{}\"", raw);
                            // Clean the transcript (cloud LLM if configured), then paste.
                            let text = clean_transcript(&raw);
                            if text != raw {
                                eprintln!("[whimpr] CLEANED:   \"{}\"", text);
                            }

                            // The user may have hit ✕ while ASR/cleanup ran. Pasting
                            // now would drop the text into whatever they focused since.
                            if !session_still_finalizing(session) {
                                eprintln!("[whimpr] session cancelled during transcription — not pasting");
                                return;
                            }
                            if !text.is_empty() {
                                if let Err(e) = crate::paste::paste_text(&text) {
                                    eprintln!("[whimpr] paste failed: {e}");
                                    let failure = if !crate::paste::is_trusted() {
                                        whimpr_core::InjectionFailure::AccessibilityNotGranted
                                    } else {
                                        whimpr_core::InjectionFailure::ClipboardUnavailable
                                    };
                                    crate::diag::report(&app2, failure);
                                    // Don't play success chime or log to history on a
                                    // failed paste: the text never reached the cursor.
                                    finish(false);
                                    return;
                                }
                                crate::diag::clear_last_error();
                                play_cue(Cue::Done);
                                record_dictation(&text, res.duration_secs());
                                crate::autolearn::watch_correction(&text);
                            } else if was_real_attempt {
                                crate::diag::report(&app2, whimpr_core::InjectionFailure::EmptyTranscript);
                            }
                            let ok = !text.is_empty();
                            let _ = app2.emit_to(
                                OVERLAY_LABEL,
                                "whimpr://transcript",
                                TranscriptPayload { text },
                            );
                            finish(ok);
                        }
                        Err(e) => {
                            eprintln!("[whimpr] ASR error: {e}");
                            if was_real_attempt {
                                crate::diag::report(&app2, whimpr_core::InjectionFailure::AsrUnavailable);
                            }
                            finish(false);
                        }
                    }
                });
            }
            Action::DiscardCapture { session } => {
                if let Some(handle) = take_capture(session, false) {
                    let _ = handle.stop();
                }
                play_cue(Cue::Cancel);
            }
            // The ASR path (StopCaptureAndFinalize) now drives pipeline completion.
            Action::RunPipeline { .. } => {}
            // The state machine emits this the moment recording starts. It was a
            // no-op, which made the "Play a sound when recording starts" toggle
            // purely decorative.
            Action::PlayPing => play_cue(Cue::Start),
            // WarnSessionCap and anything new: still no-ops.
            _ => {}
        }
    }

    extern "C" fn tap_callback(
        _proxy: CGEventTapProxy,
        etype: u32,
        event: CGEventRef,
        _info: *mut c_void,
    ) -> CGEventRef {
        if etype == K_CG_TAP_DISABLED_BY_TIMEOUT || etype == K_CG_TAP_DISABLED_BY_USER_INPUT {
            let port = TAP_PORT.load(Ordering::SeqCst);
            if !port.is_null() {
                unsafe { CGEventTapEnable(port, true) };
            }
            return event;
        }
        if etype == K_CG_EVENT_FLAGS_CHANGED {
            let keycode =
                unsafe { CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) };
            if keycode == PTT_KEYCODE.load(Ordering::Relaxed) {
                let flags = unsafe { CGEventGetFlags(event) };
                let down = (flags & PTT_MASK.load(Ordering::Relaxed)) != 0;
                let was_down = FN_IS_DOWN.swap(down, Ordering::SeqCst);
                let at_ms = now_ms();
                if down && !was_down {
                    eprintln!("[whimpr] Fn DOWN");
                    // Snapshot the paste target now, while the user's app is focused.
                    let target = crate::appctx::frontmost_bundle_id();
                    *TARGET_APP.get_or_init(|| Mutex::new(None)).lock().unwrap() = target;
                    handle_input(Input::Trigger(TriggerToken::Down {
                        binding: BindingId::PushToTalk,
                        at_ms,
                    }));
                } else if !down && was_down {
                    eprintln!("[whimpr] Fn UP");
                    handle_input(Input::Trigger(TriggerToken::Up {
                        binding: BindingId::PushToTalk,
                        at_ms,
                    }));
                }
            }
        }
        event
    }

    /// Toggle HANDS-FREE (locked) dictation — the customizable global hotkey
    /// (default Cmd+Shift+Space) fires this. The state machine treats a
    /// `HandsFree` press as a toggle: from idle it starts a locked session that
    /// keeps recording with no key held, and while locked it finalizes. This is
    /// the "speak without having to hold down fn" ask from Publik Test 2.
    pub fn trigger_hands_free() {
        handle_input(Input::Trigger(TriggerToken::Down {
            binding: BindingId::HandsFree,
            at_ms: now_ms(),
        }));
    }

    /// Whether the global Fn tap is live (see [`TAP_LIVE`]). `get_status`
    /// surfaces this to the Hub as `hotkey_wired`.
    pub fn tap_live() -> bool {
        TAP_LIVE.load(Ordering::SeqCst)
    }

    /// Called when the Hub's "Fix Accessibility" flow resets the TCC entry: the
    /// old tap (if any) is no longer meaningful until the user re-grants and a
    /// fresh tap is created.
    pub fn mark_tap_stale() {
        TAP_LIVE.store(false, Ordering::SeqCst);
    }

    pub fn install(app: AppHandle) {
        let _ = APP.set(app);
        let _ = MACHINE.set(Mutex::new(StateMachine::new()));
        let _ = CLOCK.set(Instant::now());

        let _ = ASR.set(Mutex::new(None));

        // Load settings + dictionary, and build cloud providers from stored keys.
        let settings = whimpr_core::Settings::load(&settings_path());
        let dict = whimpr_core::DictionaryStore::load(&dict_path());
        eprintln!(
            "[whimpr] cleanup mode: {:?}, level: {:?}",
            settings.cleanup_mode, settings.cleanup_level
        );
        let _ = SETTINGS.set(Mutex::new(settings));
        let _ = DICTIONARY.set(Mutex::new(dict));
        let _ = STATS.set(Mutex::new(whimpr_core::StatsStore::load(&stats_path())));
        // Bind the push-to-talk key before the tap is created.
        apply_live_settings(&current_settings());
        let _ = LOCAL.set(Mutex::new(None));
        rebuild_providers();
        rebuild_asr(&current_settings());

        // Accessibility is the ONE permission that makes the Fn CGEventTap global AND
        // lets us post the Cmd+V paste into other apps. Without it, a keyboard tap is
        // silently limited to frontmost-only — the exact bug. Self-heal up front:
        // "granted in System Settings but the app doesn't acknowledge it" means a
        // stale TCC entry is enforcing an older build's signature, so clear it,
        // re-prompt, and open the pane — the tap thread below picks the fresh grant
        // up the moment it lands, with no relaunch.
        if crate::paste::is_trusted() {
            eprintln!("[whimpr] Accessibility granted — Fn works in every app, paste enabled");
        } else {
            eprintln!(
                "[whimpr] ⚠ Accessibility NOT granted — clearing any stale TCC entry, \
                 re-prompting, and opening System Settings → Privacy & Security → \
                 Accessibility (no relaunch needed)."
            );
            std::thread::spawn(|| {
                // Let the Hub/onboarding window mount first so the user sees it
                // before the Settings pane opens over it.
                std::thread::sleep(Duration::from_millis(800));
                if let Err(e) = crate::reset_and_prompt_accessibility() {
                    eprintln!("[whimpr] accessibility self-heal failed: {e}");
                }
            });
        }
        // Input Monitoring is NOT the gate for a CGEventTap — kept only as diagnostics.
        eprintln!(
            "[whimpr] (info) Input Monitoring: {}",
            crate::paste::input_monitoring_granted()
        );

        // Periodic tick drives the double-tap timeout / session cap.
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_millis(100));
            handle_input(Input::Tick { now_ms: now_ms() });
        });

        // The event tap runs on a thread with its own CFRunLoop. CRITICAL: create it
        // ONLY after the process is trusted for Accessibility. macOS fixes a keyboard
        // tap's privilege at CGEventTapCreate time — a tap born untrusted is
        // permanently frontmost-only and is NOT upgraded when the grant later arrives.
        // Polling here also means the Fn key starts working the moment the user grants
        // Accessibility, without a relaunch.
        std::thread::spawn(|| {
            while !crate::paste::is_trusted() {
                std::thread::sleep(Duration::from_millis(500));
            }
            eprintln!("[whimpr] Accessibility present — creating global Fn tap");
            // Bug fix: this used to try CGEventTapCreate exactly once and, if it
            // came back null despite Accessibility being granted (the real-world
            // stale-TCC-entry case this app's own comments already knew about),
            // give up FOREVER with only an eprintln — the Fn key would then do
            // nothing for the rest of the run, indistinguishable from "text isn't
            // typed" to the user, with zero visible explanation. Now: report it
            // loudly once, and keep retrying — toggling the Accessibility entry
            // off/on in System Settings, or removing and re-adding it, fixes the
            // stale grant without requiring a relaunch, and this way that fix is
            // picked up automatically.
            let mut reported = false;
            let port = loop {
                // Re-check trust inside the retry loop: the Hub's "Fix" button
                // resets the TCC entry, and a tap created while untrusted is
                // permanently frontmost-only — keep waiting for a fresh grant.
                if !crate::paste::is_trusted() {
                    std::thread::sleep(Duration::from_millis(500));
                    continue;
                }
                let port = unsafe {
                    CGEventTapCreate(
                        K_CG_SESSION_EVENT_TAP,
                        K_CG_HEAD_INSERT,
                        K_CG_TAP_OPTION_LISTEN_ONLY,
                        EVENTS_OF_INTEREST,
                        tap_callback,
                        null_mut(),
                    )
                };
                if !port.is_null() {
                    break port;
                }
                eprintln!(
                    "[whimpr] Fn tap null despite Accessibility — likely a stale TCC entry from \
                     an earlier build. Use the Hub's Fix button (or run: tccutil reset \
                     Accessibility com.whimpr.whimprflow), then re-enable WhimprFlow. Retrying…"
                );
                if !reported {
                    if let Some(app) = APP.get() {
                        crate::diag::report(app, whimpr_core::InjectionFailure::HotkeyTapFailed);
                    }
                    reported = true;
                }
                std::thread::sleep(Duration::from_secs(5));
            };
            if reported {
                eprintln!("[whimpr] Fn tap recovered — the key is live now.");
                crate::diag::clear_last_error();
            }
            TAP_LIVE.store(true, Ordering::SeqCst);
            TAP_PORT.store(port, Ordering::SeqCst);
            unsafe {
                let source = CFMachPortCreateRunLoopSource(null(), port, 0);
                CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopDefaultMode);
                CGEventTapEnable(port, true);
                CFRunLoopRun();
            }
        });
    }
}

#[cfg(target_os = "macos")]
pub use imp::{
    current_settings, dictionary_add, dictionary_entries, dictionary_learn,
    dictionary_remove, history, install, last_bar, mark_tap_stale, model_path, models_dir,
    read_anthropic_key, read_openai_key, rebuild_asr, rebuild_providers, stats_summary,
    tap_live, trigger_hands_free, ui_cancel, ui_start, ui_stop, update_settings,
};

// Windows uses the real (but unverified) platform layer in `crate::win`.
#[cfg(target_os = "windows")]
pub use crate::win::{
    cancel_dictation, current_settings, dictionary_add, dictionary_entries, dictionary_learn,
    dictionary_remove, history, install, mark_tap_stale, rebuild_providers, stats_summary,
    stop_dictation, tap_live, trigger_hands_free, update_settings,
};

// Other platforms (Linux, etc.): inert stubs so the crate still builds.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod other {
    pub fn install(_app: tauri::AppHandle) {}
    pub fn current_settings() -> whimpr_core::Settings {
        whimpr_core::Settings::default()
    }
    pub fn update_settings(_new: whimpr_core::Settings) {}
    pub fn rebuild_providers() {}
    pub fn rebuild_asr(_settings: &whimpr_core::Settings) {}
    pub fn stats_summary(tz_offset_minutes: i32) -> whimpr_core::StatsSummary {
        whimpr_core::StatsStore::default().summary(tz_offset_minutes, 0)
    }
    pub fn history(_limit: usize) -> Vec<whimpr_core::HistoryItem> {
        Vec::new()
    }
    pub fn dictionary_entries() -> Vec<super::DictEntryDto> {
        Vec::new()
    }
    pub fn dictionary_add(_correct: String, _mishears: Vec<String>) {}
    pub fn dictionary_remove(_correct: &str) {}
    pub fn dictionary_learn(_correct: String, _mishears: Vec<String>) {}
    pub fn trigger_hands_free() {}
    pub fn ui_cancel() {}
    pub fn ui_stop() {}
    pub fn ui_start() {}
    pub fn tap_live() -> bool {
        true
    }
    pub fn mark_tap_stale() {}
    pub fn last_bar() -> &'static str {
        "idle"
    }
    pub fn models_dir() -> std::path::PathBuf {
        std::path::PathBuf::new()
    }
    pub fn model_path() -> std::path::PathBuf {
        std::path::PathBuf::new()
    }
    pub fn read_openai_key() -> Option<String> {
        None
    }
    pub fn read_anthropic_key() -> Option<String> {
        None
    }
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use other::{
    current_settings, dictionary_add, dictionary_entries, dictionary_learn,
    dictionary_remove, history, install, last_bar, mark_tap_stale, model_path, models_dir,
    read_anthropic_key, read_openai_key, rebuild_asr, rebuild_providers, stats_summary,
    tap_live, trigger_hands_free, ui_cancel, ui_start, ui_stop, update_settings,
};
