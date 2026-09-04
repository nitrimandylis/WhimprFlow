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
}

/// The out-of-the-box hands-free hotkey. Chosen to match what the cofounder
/// already expected to work ("command-shift space for the hands-off
/// transcribing") and to stay clear of the common macOS system shortcuts
/// (Cmd+Space is Spotlight, Ctrl+Cmd+Space is the emoji picker).
pub fn default_hands_free_hotkey() -> String {
    "CmdOrCtrl+Shift+Space".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            cleanup_mode: CleanupMode::default(),
            cleanup_level: CleanupLevel::Light,
            openai_model: "gpt-4o-mini".to_string(),
            openai_base_url: String::new(),
            anthropic_model: "claude-haiku-4-5".to_string(),
            sound_on_start: true,
            hands_free_hotkey: default_hands_free_hotkey(),
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
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
