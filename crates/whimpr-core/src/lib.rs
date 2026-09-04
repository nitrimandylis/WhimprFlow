//! `whimpr-core` — the platform-agnostic brain of WhimprFlow.
//!
//! Shared between macOS and Windows. Native concerns (hotkey hook, text injection,
//! accessibility reads) live in `src-tauri`; the ASR and cleanup-LLM implementations
//! live in their own crates and plug in behind the [`asr`] and [`cleanup`] trait
//! seams defined here.

pub mod asr;
pub mod cleanup;
pub mod diagnostics;
pub mod dictionary;
pub mod settings;
pub mod state;
pub mod stats;
pub mod types;

pub use asr::{AsrEngine, AsrEngineId, Transcript};
pub use cleanup::{CleanupContext, CleanupLevel, CleanupProvider, ProviderId, VocabEntry};
pub use diagnostics::{Diagnostic, InjectionFailure, Platform};
pub use dictionary::{DictSource, DictionaryEntry, DictionaryStore};
pub use settings::{AsrMode, CleanupMode, PushToTalkKey, Settings};
pub use stats::{HistoryItem, SessionRecord, StatsStore, StatsSummary};
pub use state::{Action, BarState, DictationState, Input, PipelineEvent, StateMachine, TriggerToken};
pub use types::{BindingId, RecordMode, SessionId};
