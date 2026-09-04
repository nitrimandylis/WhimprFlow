//! Small shared value types used across the core.

use serde::{Deserialize, Serialize};

/// Monotonic identifier for one dictation session (a recording + its finalize/paste).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SessionId(pub u64);

/// Stable identifier for one bound action (push-to-talk, hands-free, command mode).
/// The shell assigns these; the hook echoes them back on triggers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BindingId {
    PushToTalk,
    HandsFree,
    CommandMode,
}

/// How a session records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RecordMode {
    /// Hold-to-talk: release ends and pastes.
    PushToTalk,
    /// Hands-free: recording persists after key release; ended by re-press / ✓ / Esc.
    Locked,
}
