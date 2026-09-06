//! User settings, persisted as JSON. Drives the cleanup engine (which provider,
//! how aggressive) and other behavior. Kept dependency-light so it lives in core.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::cleanup::CleanupLevel;

/// Which cleanup engine processes transcripts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CleanupMode {
    /// Paste the raw transcript (no cleanup).
    Raw,
    /// Local on-device model (default — works offline, no API key).
    #[default]
    Local,
    /// OpenAI cloud.
    OpenAi,
    /// Anthropic cloud.
    Anthropic,
}

/// Convert one display's reported geometry into a logical-point work area.
///
/// Tauri/tao report macOS displays in MIXED units, verified against a real
/// three-display setup (2× built-in at (0,0), 1× at x=1728, 1× at x=4288 — those
/// x origins are the *logical* widths stacked up, while the sizes are physical
/// pixels):
///
/// * `position`             — logical points, global
/// * `size`                 — physical pixels
/// * `work_area.position.x` — logical points, global (equals `position.x`)
/// * `work_area.position.y` — physical pixels, inset from the top of THIS display
/// * `work_area.size`       — physical pixels
///
/// Returns `(left, top, width, height)` in logical points. It lives here, away
/// from the windowing code, so it can be tested with no display attached.
pub fn work_area_points(
    monitor_y: i32,
    work_x: i32,
    work_y: i32,
    work_w: u32,
    work_h: u32,
    scale: f64,
) -> (f64, f64, f64, f64) {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    (
        work_x as f64,
        monitor_y as f64 + work_y as f64 / scale,
        work_w as f64 / scale,
        work_h as f64 / scale,
    )
}

/// Bottom-centre placement for a window of `win_w` × `win_h` logical points,
/// clamped so it can never sit outside the work area — i.e. never under the Dock.
pub fn pill_placement(
    area: (f64, f64, f64, f64),
    win_w: f64,
    win_h: f64,
    bottom_inset: f64,
) -> (f64, f64) {
    let (ax, ay, aw, ah) = area;
    let x = ax + (aw - win_w) / 2.0;
    let y = ay + ah - win_h - bottom_inset;
    // The upper bounds are floored at the work-area origin so that a window
    // LARGER than the work area pins to its top-left rather than being pushed off
    // the top of the screen — and so `clamp` is never handed min > max, which
    // would panic.
    let max_x = (ax + aw - win_w).max(ax);
    let max_y = (ay + ah - win_h).max(ay);
    (x.clamp(ax, max_x), y.clamp(ay, max_y))
}

/// Which key is held to dictate.
///
/// The event tap only subscribes to `flagsChanged`, so every option here has to
/// be a modifier. Left/right variants have distinct keycodes, which is what lets
/// us bind the right-hand keys without swallowing the left-hand ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PushToTalkKey {
    #[default]
    Fn,
    RightCommand,
    RightOption,
    RightControl,
}

impl PushToTalkKey {
    /// `(CGKeyCode, CGEventFlags mask)` for the flags-changed tap.
    pub fn keycode_and_mask(self) -> (i64, u64) {
        match self {
            PushToTalkKey::Fn => (63, 0x0080_0000),
            PushToTalkKey::RightCommand => (54, 0x0010_0000),
            PushToTalkKey::RightOption => (61, 0x0008_0000),
            PushToTalkKey::RightControl => (62, 0x0004_0000),
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            PushToTalkKey::Fn => "Fn / Globe",
            PushToTalkKey::RightCommand => "Right Command",
            PushToTalkKey::RightOption => "Right Option",
            PushToTalkKey::RightControl => "Right Control",
        }
    }
}

/// Which speech-to-text engine transcribes the recorded audio.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AsrMode {
    /// Local on-device Whisper via whisper.cpp (default — works offline, no API key).
    #[default]
    Local,
    /// Cloud speech-to-text via an OpenAI-compatible `/audio/transcriptions` API
    /// (OpenAI itself, or Groq's Whisper endpoint, or any compatible host).
    /// Reuses the same key as the "OpenAI" cleanup mode.
    Cloud,
}

/// Hub window appearance. `System` follows macOS; the others pin it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

fn default_asr_model() -> String {
    "whisper-large-v3-turbo".to_string()
}

/// Persisted user configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub cleanup_mode: CleanupMode,
    pub cleanup_level: CleanupLevel,
    pub openai_model: String,
    /// API root for the "OpenAI" cleanup mode, e.g. `https://openrouter.ai/api/v1`
    /// to route through OpenRouter instead of OpenAI directly (same wire format).
    /// Empty string (the default) means OpenAI's own endpoint.
    #[serde(default)]
    pub openai_base_url: String,
    pub anthropic_model: String,
    /// Which engine transcribes speech to text.
    #[serde(default)]
    pub asr_mode: AsrMode,
    /// API root for `AsrMode::Cloud`, e.g. `https://api.groq.com/openai/v1` for
    /// Groq's fast Whisper endpoint. Empty string means OpenAI's own endpoint.
    /// Uses the same stored key as the "OpenAI" cleanup mode.
    #[serde(default)]
    pub asr_base_url: String,
    #[serde(default = "default_asr_model")]
    pub asr_model: String,
    /// Play the record-start ping.
    pub sound_on_start: bool,
    /// The global hotkey that toggles HANDS-FREE (locked) dictation — press once
    /// to start talking, press again to stop, with no key held down. An
    /// accelerator string in Tauri's format (e.g. "CmdOrCtrl+Shift+Space", the
    /// default). This is the "speak without holding fn … a combination of
    /// buttons … customization in settings" ask from Publik Test 2. Holding Fn
    /// (push-to-talk) and double-tapping Fn (hands-free) still work regardless.
    /// An empty string disables the hands-free hotkey.
    #[serde(default = "default_hands_free_hotkey")]
    pub hands_free_hotkey: String,
    /// Keep the Flow Bar on screen when idle. When false the pill is hidden
    /// until a dictation starts, then hidden again once it finishes.
    /// `serde(default = ...)` so settings.json files written before this field
    /// existed still deserialize (a plain `default` would give `false`).
    #[serde(default = "default_true")]
    pub show_pill_always: bool,
    /// Gap in points between the bottom of the screen's *work area* and the
    /// pill. The work area already excludes the Dock and menu bar, so this is a
    /// small breathing gap, not a Dock allowance. Ignored when `pill_pos` is set.
    #[serde(default = "default_pill_inset")]
    pub pill_bottom_inset: f64,
    /// User-dragged pill position in physical pixels, as (x, y) of the window's
    /// top-left. `None` means "use the computed bottom-center anchor".
    #[serde(default)]
    pub pill_pos: Option<(i32, i32)>,
    /// Move the pill to whichever display the frontmost window is on, instead of
    /// pinning it to the primary display. Ignored when `pill_pos` is set.
    #[serde(default = "default_true")]
    pub pill_follows_active_display: bool,

    /// Whisper language code ("en", "gu", "hi", …) or "auto" to let the model
    /// detect it. Only meaningful with a multilingual model such as
    /// `ggml-large-v3-turbo.bin`; the `.en` models are English-only regardless.
    #[serde(default = "default_language")]
    pub language: String,
    /// Which key is held to dictate.
    #[serde(default)]
    pub push_to_talk_key: PushToTalkKey,
    /// Start WhimprFlow automatically at login (managed via a LaunchAgent).
    #[serde(default)]
    pub launch_at_login: bool,
    /// Show the app in the Dock. Off makes it a menu-bar-only accessory app.
    #[serde(default = "default_true")]
    pub show_in_dock: bool,
    /// Input device name; empty means the system default microphone.
    #[serde(default)]
    pub microphone: String,
    /// Free-text style preferences appended to the cleanup prompt, e.g.
    /// "British spelling, no em dashes, keep sentences short".
    #[serde(default)]
    pub style_instructions: String,
    /// Keep the text of each dictation on disk for the Hub's history list. Off
    /// still records word counts and timing for the stats, but no text.
    #[serde(default = "default_true")]
    pub save_history: bool,
    /// Hub appearance: follow the system, or pin light or dark.
    #[serde(default)]
    pub appearance: Appearance,
    /// Local Whisper model filename (e.g. "ggml-large-v3-turbo.bin"). Empty
    /// means auto-pick the best installed model.
    #[serde(default)]
    pub whisper_model: String,
}

/// The out-of-the-box hands-free hotkey. Chosen to match what the cofounder
/// already expected to work ("command-shift space for the hands-off
/// transcribing") and to stay clear of the common macOS system shortcuts
/// (Cmd+Space is Spotlight, Ctrl+Cmd+Space is the emoji picker).
pub fn default_hands_free_hotkey() -> String {
    "CmdOrCtrl+Shift+Space".to_string()
}

fn default_language() -> String {
    "en".to_string()
}

fn default_true() -> bool {
    true
}

/// Measured from the bottom of the work area (already above the Dock), so this
/// only needs to be a small visual gap.
fn default_pill_inset() -> f64 {
    12.0
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            cleanup_mode: CleanupMode::default(),
            cleanup_level: CleanupLevel::Light,
            openai_model: "gpt-4o-mini".to_string(),
            openai_base_url: String::new(),
            anthropic_model: "claude-haiku-4-5".to_string(),
            asr_mode: AsrMode::default(),
            asr_base_url: String::new(),
            asr_model: default_asr_model(),
            sound_on_start: true,
            hands_free_hotkey: default_hands_free_hotkey(),
            show_pill_always: true,
            pill_bottom_inset: default_pill_inset(),
            pill_pos: None,
            pill_follows_active_display: true,
            language: default_language(),
            push_to_talk_key: PushToTalkKey::default(),
            launch_at_login: false,
            show_in_dock: true,
            microphone: String::new(),
            style_instructions: String::new(),
            save_history: true,
            appearance: Appearance::default(),
            whisper_model: String::new(),
        }
    }
}

impl Settings {
    /// Load settings from disk. If the file is missing, returns defaults and
    /// writes them. If the file exists but is corrupt, returns defaults but
    /// does NOT overwrite the broken file (so the user can fix or recover it).
    pub fn load(path: &Path) -> Self {
        let content = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(_) => {
                // File missing or unreadable: first launch or permissions issue.
                let defaults = Self::default();
                let _ = defaults.save(path);
                return defaults;
            }
        };
        match serde_json::from_str(&content) {
            Ok(settings) => settings,
            Err(e) => {
                eprintln!(
                    "[whimpr] settings.json is corrupt ({}), using defaults. \
                     The broken file was NOT overwritten, fix or delete it manually: {}",
                    e,
                    path.display()
                );
                Self::default()
            }
        }
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real values captured from a 2× built-in plus two 1× externals. If the pill
    // ever drifts under the Dock again, these pin down why.
    const BUILTIN: (i32, i32, i32, u32, u32, f64) = (0, 0, 66, 3456, 1982, 2.0);
    const DELL: (i32, i32, i32, u32, u32, f64) = (0, 1728, 30, 2560, 1410, 1.0);
    const HP: (i32, i32, i32, u32, u32, f64) = (0, 4288, 30, 1920, 1050, 1.0);

    fn area(m: (i32, i32, i32, u32, u32, f64)) -> (f64, f64, f64, f64) {
        work_area_points(m.0, m.1, m.2, m.3, m.4, m.5)
    }

    #[test]
    fn retina_work_area_is_converted_to_points() {
        // 3456 physical / 2 = 1728 points wide; the 66px menu bar is 33 points.
        assert_eq!(area(BUILTIN), (0.0, 33.0, 1728.0, 991.0));
    }

    #[test]
    fn non_retina_displays_keep_their_global_offset() {
        assert_eq!(area(DELL), (1728.0, 30.0, 2560.0, 1410.0));
        assert_eq!(area(HP), (4288.0, 30.0, 1920.0, 1050.0));
    }

    #[test]
    fn displays_do_not_overlap_in_point_space() {
        // Each display must start where the previous one ends, or the cursor
        // hit-test lands on the wrong screen — which is exactly what happened.
        let (bx, _, bw, _) = area(BUILTIN);
        let (dx, _, dw, _) = area(DELL);
        let (hx, ..) = area(HP);
        assert_eq!(bx + bw, dx);
        assert_eq!(dx + dw, hx);
    }

    #[test]
    fn pill_sits_above_the_dock_on_the_retina_screen() {
        let a = area(BUILTIN);
        let (x, y) = pill_placement(a, 320.0, 132.0, 12.0);
        assert_eq!(x, 704.0); // centred: (1728 - 320) / 2
        assert_eq!(y, 880.0); // 33 + 991 - 132 - 12
        // The Dock starts at 1024 points; the pill must end before it.
        assert!(y + 132.0 <= 1024.0);
    }

    /// The bug that survived several rounds: the window's size was derived from
    /// physical pixels on the display it was leaving, divided by the scale of the
    /// display it was arriving at. Across a 1× → 2× boundary that halved it, and
    /// the pill ended up below the work area — under the Dock.
    #[test]
    fn a_halved_window_size_would_put_the_pill_under_the_dock() {
        let a = area(BUILTIN); // work area ends at 33 + 991 = 1024
        let (_, correct) = pill_placement(a, 320.0, 132.0, 12.0);
        assert!(correct + 132.0 <= 1024.0);

        // Same call with the size halved, as the old code computed it.
        let (_, halved) = pill_placement(a, 160.0, 70.0, 12.0);
        assert_eq!(halved, 942.0, "reproduces the value seen in the logs");
        assert!(
            halved + 132.0 > 1024.0,
            "the real 132pt-tall pill overhangs the work area by 50pt"
        );
    }

    #[test]
    fn pill_lands_on_the_right_external_screen() {
        let (x, y) = pill_placement(area(HP), 320.0, 132.0, 12.0);
        assert_eq!(x, 5088.0); // 4288 + (1920 - 320) / 2
        assert_eq!(y, 936.0);
    }

    #[test]
    fn placement_is_clamped_inside_the_work_area() {
        // A window taller than the work area must pin to the top of it, not be
        // pushed off the top of the screen and under the menu bar.
        let a = area(HP);
        let (x, y) = pill_placement(a, 320.0, 5000.0, 12.0);
        assert_eq!(y, a.1);
        assert!(x >= a.0);
    }

    #[test]
    fn placement_survives_a_window_wider_than_the_screen() {
        let a = area(BUILTIN);
        let (x, y) = pill_placement(a, 9999.0, 132.0, 12.0);
        assert_eq!(x, a.0);
        assert!(y >= a.1);
    }

    #[test]
    fn a_dock_appearing_moves_the_pill_up() {
        let without = pill_placement(area(HP), 320.0, 132.0, 12.0);
        // Same display, work area shortened by a 70pt Dock.
        let with_dock =
            pill_placement(work_area_points(0, 4288, 30, 1920, 980, 1.0), 320.0, 132.0, 12.0);
        assert!(with_dock.1 < without.1);
    }

    #[test]
    fn defaults_are_sane() {
        let s = Settings::default();
        assert_eq!(s.cleanup_mode, CleanupMode::Local);
        assert_eq!(s.cleanup_level, CleanupLevel::Light);
    }

    #[test]
    fn round_trips_json() {
        let s = Settings {
            cleanup_mode: CleanupMode::Local,
            ..Default::default()
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.cleanup_mode, CleanupMode::Local);
    }

    #[test]
    fn hands_free_hotkey_defaults_and_survives_old_settings() {
        // A fresh install gets the Cmd+Shift+Space default.
        assert_eq!(Settings::default().hands_free_hotkey, "CmdOrCtrl+Shift+Space");

        // Settings written by a build BEFORE this field existed must still load —
        // the field is `#[serde(default)]`, so it fills in rather than failing.
        let old_json = r#"{
            "cleanup_mode": "local",
            "cleanup_level": "light",
            "openai_model": "gpt-4o-mini",
            "anthropic_model": "claude-haiku-4-5",
            "sound_on_start": true
        }"#;
        let loaded: Settings = serde_json::from_str(old_json).unwrap();
        assert_eq!(loaded.hands_free_hotkey, "CmdOrCtrl+Shift+Space");

        // A user who set their own combo keeps it.
        let mut custom = Settings::default();
        custom.hands_free_hotkey = "Alt+Space".to_string();
        let back: Settings = serde_json::from_str(&serde_json::to_string(&custom).unwrap()).unwrap();
        assert_eq!(back.hands_free_hotkey, "Alt+Space");
    }
}
