//! The dictation state machine.
//!
//! A pure `step(input) -> Vec<Action>` reducer: no clock, no mic, no hook. Time
//! arrives as [`Input::Tick`] and hotkey transitions as [`TriggerToken`]s, so the
//! whole hold / double-tap-lock / cancel / cooldown / session-cap behavior is
//! deterministic and unit-testable.

use crate::types::BindingId;

use super::actions::{Action, BarState};
use super::events::{Input, PipelineEvent, TriggerToken};
use super::timing::{COOLDOWN_MS, DOUBLE_TAP_MS, HOLD_MIN_MS, SESSION_CAP_MS, WARN_AT_MS};
use crate::types::{RecordMode, SessionId};

/// The machine's current phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DictationState {
    /// Nothing happening.
    Idle,
    /// Actively recording.
    Recording {
        mode: RecordMode,
        session: SessionId,
        started_ms: u64,
        /// Set once we've emitted the approaching-cap warning for this session.
        warned: bool,
    },
    /// A push-to-talk key was tapped (too short to be a hold). We discarded that
    /// capture and are waiting to see if a second press arrives to lock hands-free.
    AwaitingLock { tap_up_ms: u64 },
    /// Capture stopped; the async pipeline is transcribing/cleaning/pasting.
    Finalizing { session: SessionId },
}

/// Owns the current [`DictationState`] plus the bookkeeping the reducer needs.
#[derive(Debug)]
pub struct StateMachine {
    state: DictationState,
    next_session: u64,
    /// Timestamp the last session ended, for cooldown debouncing.
    last_end_ms: Option<u64>,
}

impl Default for StateMachine {
    fn default() -> Self {
        Self {
            state: DictationState::Idle,
            next_session: 1,
            last_end_ms: None,
        }
    }
}

impl StateMachine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn state(&self) -> DictationState {
        self.state
    }

    fn alloc_session(&mut self) -> SessionId {
        let id = SessionId(self.next_session);
        self.next_session += 1;
        id
    }

    fn in_cooldown(&self, now_ms: u64) -> bool {
        matches!(self.last_end_ms, Some(end) if now_ms.saturating_sub(end) < COOLDOWN_MS)
    }

    /// Advance the machine by one input, returning the side-effects to perform.
    pub fn step(&mut self, input: Input) -> Vec<Action> {
        match input {
            Input::Trigger(t) => self.on_trigger(t),
            Input::Pipeline(p) => self.on_pipeline(p),
            Input::Tick { now_ms } => self.on_tick(now_ms),
        }
    }

    fn on_trigger(&mut self, t: TriggerToken) -> Vec<Action> {
        match (self.state, t) {
            // --- Start hold-to-talk from Idle -------------------------------
            (DictationState::Idle, TriggerToken::Down { binding, at_ms }) => {
                if self.in_cooldown(at_ms) {
                    return vec![];
                }
                match binding {
                    BindingId::PushToTalk => self.begin(RecordMode::PushToTalk, at_ms),
                    // A dedicated hands-free chord locks immediately.
                    BindingId::HandsFree => self.begin(RecordMode::Locked, at_ms),
                    BindingId::CommandMode => vec![], // handled elsewhere (rewrite path)
                }
            }

            // --- Release of a push-to-talk hold -----------------------------
            (
                DictationState::Recording {
                    mode: RecordMode::PushToTalk,
                    session,
                    started_ms,
                    ..
                },
                TriggerToken::Up { binding: BindingId::PushToTalk, at_ms },
            ) => {
                let held = at_ms.saturating_sub(started_ms);
                if held >= HOLD_MIN_MS {
                    // Genuine hold: finalize and paste.
                    self.finalize(session)
                } else {
                    // Quick tap: discard, then watch for a second press to lock.
                    self.state = DictationState::AwaitingLock { tap_up_ms: at_ms };
                    vec![
                        Action::DiscardCapture { session },
                        Action::ShowBar(BarState::Idle),
                    ]
                }
            }

            // --- Second tap within the window flips into hands-free ---------
            (
                DictationState::AwaitingLock { tap_up_ms },
                TriggerToken::Down { binding: BindingId::PushToTalk, at_ms },
            ) if at_ms.saturating_sub(tap_up_ms) <= DOUBLE_TAP_MS => {
                self.begin(RecordMode::Locked, at_ms)
            }

            // --- Re-press ends a locked (hands-free) session ----------------
            (
                DictationState::Recording { mode: RecordMode::Locked, session, .. },
                TriggerToken::Down { binding: BindingId::PushToTalk, .. },
            )
            | (
                DictationState::Recording { mode: RecordMode::Locked, session, .. },
                TriggerToken::Down { binding: BindingId::HandsFree, .. },
            ) => self.finalize(session),

            // --- Esc cancels from any active state --------------------------
            (state, TriggerToken::Cancel { at_ms }) => match state {
                DictationState::Recording { session, .. } => self.cancel(Some(session), at_ms),
                DictationState::Finalizing { session } => self.cancel(Some(session), at_ms),
                DictationState::AwaitingLock { .. } => self.cancel(None, at_ms),
                DictationState::Idle => vec![],
            },

            // --- Stop button finalizes any active recording -----------------
            // The pill's red square: stop and transcribe what was said, in EITHER
            // mode, so the on-screen control works the same whether the session
            // is push-to-talk or hands-free. Only a live recording can be
            // finalized; a quick tap awaiting a lock, an in-flight finalize, and
            // idle have nothing to stop.
            (DictationState::Recording { session, .. }, TriggerToken::Stop { .. }) => {
                self.finalize(session)
            }
            (_, TriggerToken::Stop { .. }) => vec![],

            // A partial-chord abort while nothing is recording is a no-op.
            (_, TriggerToken::NormalKeyDuringArm) => vec![],

            // Everything else (stray ups, mismatched bindings) is ignored.
            _ => vec![],
        }
    }

    fn on_pipeline(&mut self, p: PipelineEvent) -> Vec<Action> {
        match (self.state, p) {
            (DictationState::Finalizing { session }, PipelineEvent::Committed { session: s, at_ms })
                if s == session =>
            {
                // Session is over internally; the shell decides how long "done" lingers
                // before the pill returns to idle. Ending a session starts the cooldown,
                // same as cancel, so key bounce right after a paste can't retrigger.
                self.state = DictationState::Idle;
                self.last_end_ms = Some(at_ms);
                vec![Action::ShowBar(BarState::Done)]
            }
            (DictationState::Finalizing { session }, PipelineEvent::Failed { session: s, at_ms })
                if s == session =>
            {
                // The shell already pushed an error state to the pill; going to Idle
                // here (not Done) is what keeps that error visible.
                self.state = DictationState::Idle;
                self.last_end_ms = Some(at_ms);
                vec![Action::ShowBar(BarState::Idle)]
            }
            _ => vec![],
        }
    }

    fn on_tick(&mut self, now_ms: u64) -> Vec<Action> {
        match self.state {
            // Single tap that never became a double-tap: return to idle.
            DictationState::AwaitingLock { tap_up_ms }
                if now_ms.saturating_sub(tap_up_ms) > DOUBLE_TAP_MS =>
            {
                self.state = DictationState::Idle;
                self.last_end_ms = Some(now_ms);
                vec![Action::ShowBar(BarState::Idle)]
            }
            // Session cap: warn near the limit, auto-stop at it.
            DictationState::Recording { session, started_ms, warned, mode } => {
                let elapsed = now_ms.saturating_sub(started_ms);
                if elapsed >= SESSION_CAP_MS {
                    self.finalize(session)
                } else if elapsed >= WARN_AT_MS && !warned {
                    self.state = DictationState::Recording {
                        session,
                        started_ms,
                        warned: true,
                        mode,
                    };
                    vec![Action::WarnSessionCap]
                } else {
                    vec![]
                }
            }
            _ => vec![],
        }
    }

    // --- transition helpers -------------------------------------------------

    fn begin(&mut self, mode: RecordMode, at_ms: u64) -> Vec<Action> {
        let session = self.alloc_session();
        self.state = DictationState::Recording {
            mode,
            session,
            started_ms: at_ms,
            warned: false,
        };
        let bar = match mode {
            RecordMode::PushToTalk => BarState::Recording,
            RecordMode::Locked => BarState::Locked,
        };
        vec![
            Action::StartCapture { session, mode },
            Action::PlayPing,
            Action::ShowBar(bar),
        ]
    }

    fn finalize(&mut self, session: SessionId) -> Vec<Action> {
        self.state = DictationState::Finalizing { session };
        vec![
            Action::StopCaptureAndFinalize { session },
            Action::ShowBar(BarState::Transcribing),
            Action::RunPipeline { session },
        ]
    }

    fn cancel(&mut self, session: Option<SessionId>, at_ms: u64) -> Vec<Action> {
        self.state = DictationState::Idle;
        self.last_end_ms = Some(at_ms);
        let mut actions = vec![];
        if let Some(session) = session {
            actions.push(Action::DiscardCapture { session });
        }
        actions.push(Action::ShowBar(BarState::Cancelled));
        actions.push(Action::ShowBar(BarState::Idle));
        actions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn down(binding: BindingId, at_ms: u64) -> Input {
        Input::Trigger(TriggerToken::Down { binding, at_ms })
    }
    fn up(binding: BindingId, at_ms: u64) -> Input {
        Input::Trigger(TriggerToken::Up { binding, at_ms })
    }

    #[test]
    fn hold_to_talk_records_then_finalizes_on_release() {
        let mut m = StateMachine::new();
        let a = m.step(down(BindingId::PushToTalk, 0));
        assert!(matches!(a[0], Action::StartCapture { .. }));
        assert!(matches!(m.state(), DictationState::Recording { mode: RecordMode::PushToTalk, .. }));

        // Held well past HOLD_MIN_MS → finalize.
        let a = m.step(up(BindingId::PushToTalk, 1_000));
        assert!(a.iter().any(|x| matches!(x, Action::StopCaptureAndFinalize { .. })));
        assert!(a.iter().any(|x| matches!(x, Action::RunPipeline { .. })));
        assert!(matches!(m.state(), DictationState::Finalizing { .. }));
    }

    #[test]
    fn double_tap_enters_hands_free_lock() {
        let mut m = StateMachine::new();
        m.step(down(BindingId::PushToTalk, 0));
        // Quick tap (below HOLD_MIN_MS): discards, awaits a lock.
        let a = m.step(up(BindingId::PushToTalk, 50));
        assert!(a.iter().any(|x| matches!(x, Action::DiscardCapture { .. })));
        assert!(matches!(m.state(), DictationState::AwaitingLock { .. }));

        // Second press within DOUBLE_TAP_MS → locked recording.
        let a = m.step(down(BindingId::PushToTalk, 200));
        assert!(a.iter().any(|x| matches!(x, Action::ShowBar(BarState::Locked))));
        assert!(matches!(m.state(), DictationState::Recording { mode: RecordMode::Locked, .. }));

        // Re-press ends the locked session.
        let a = m.step(down(BindingId::PushToTalk, 5_000));
        assert!(a.iter().any(|x| matches!(x, Action::StopCaptureAndFinalize { .. })));
    }

    #[test]
    fn lone_tap_times_out_to_idle_and_pastes_nothing() {
        let mut m = StateMachine::new();
        m.step(down(BindingId::PushToTalk, 0));
        m.step(up(BindingId::PushToTalk, 50));
        // No second press; tick past the window.
        let a = m.step(Input::Tick { now_ms: 50 + DOUBLE_TAP_MS + 1 });
        assert!(a.iter().any(|x| matches!(x, Action::ShowBar(BarState::Idle))));
        assert!(matches!(m.state(), DictationState::Idle));
        // Crucially, no pipeline ever ran.
        assert!(!a.iter().any(|x| matches!(x, Action::RunPipeline { .. })));
    }

    #[test]
    fn esc_cancels_and_discards() {
        let mut m = StateMachine::new();
        m.step(down(BindingId::PushToTalk, 0));
        let a = m.step(Input::Trigger(TriggerToken::Cancel { at_ms: 300 }));
        assert!(a.iter().any(|x| matches!(x, Action::DiscardCapture { .. })));
        assert!(a.iter().any(|x| matches!(x, Action::ShowBar(BarState::Cancelled))));
        assert!(matches!(m.state(), DictationState::Idle));
    }

    // The pill's Stop button (the red square). Reported dead in Publik Test 2:
    // "the X button doesn't work and neither does the red with the square in it."
    // The button now emits `TriggerToken::Stop`, which must finalize a live
    // recording in EITHER mode.
    #[test]
    fn stop_button_finalizes_a_push_to_talk_recording() {
        let mut m = StateMachine::new();
        m.step(down(BindingId::PushToTalk, 0));
        let a = m.step(Input::Trigger(TriggerToken::Stop { at_ms: 1_000 }));
        assert!(a.iter().any(|x| matches!(x, Action::StopCaptureAndFinalize { .. })));
        assert!(a.iter().any(|x| matches!(x, Action::RunPipeline { .. })));
        assert!(matches!(m.state(), DictationState::Finalizing { .. }));
    }

    #[test]
    fn stop_button_finalizes_a_hands_free_recording() {
        let mut m = StateMachine::new();
        // Double-tap into a hands-free (Locked) session.
        m.step(down(BindingId::PushToTalk, 0));
        m.step(up(BindingId::PushToTalk, 50));
        m.step(down(BindingId::PushToTalk, 200));
        assert!(matches!(m.state(), DictationState::Recording { mode: RecordMode::Locked, .. }));

        let a = m.step(Input::Trigger(TriggerToken::Stop { at_ms: 5_000 }));
        assert!(a.iter().any(|x| matches!(x, Action::StopCaptureAndFinalize { .. })));
        assert!(matches!(m.state(), DictationState::Finalizing { .. }));
    }

    #[test]
    fn stop_when_idle_does_nothing() {
        let mut m = StateMachine::new();
        let a = m.step(Input::Trigger(TriggerToken::Stop { at_ms: 10 }));
        assert!(a.is_empty());
        assert!(matches!(m.state(), DictationState::Idle));
    }

    #[test]
    fn cooldown_suppresses_immediate_retrigger() {
        let mut m = StateMachine::new();
        m.step(down(BindingId::PushToTalk, 0));
        m.step(up(BindingId::PushToTalk, 1_000)); // finalize
        m.step(Input::Pipeline(PipelineEvent::Committed { session: SessionId(1), at_ms: 2_000 }));
        // A paste ending a session starts the cooldown too.
        let a = m.step(down(BindingId::PushToTalk, 2_000 + COOLDOWN_MS - 1));
        assert!(a.is_empty(), "a press right after a paste is ignored");
        let a = m.step(down(BindingId::PushToTalk, 2_000 + COOLDOWN_MS + 1));
        assert!(!a.is_empty());

        let mut m2 = StateMachine::new();
        m2.step(down(BindingId::PushToTalk, 0));
        m2.step(Input::Trigger(TriggerToken::Cancel { at_ms: 100 })); // sets last_end=100
        let a = m2.step(down(BindingId::PushToTalk, 100 + COOLDOWN_MS - 1));
        assert!(a.is_empty(), "a press within the cooldown window is ignored");
        let a = m2.step(down(BindingId::PushToTalk, 100 + COOLDOWN_MS + 1));
        assert!(!a.is_empty(), "a press after cooldown starts a new session");
    }

    #[test]
    fn a_failed_pipeline_returns_to_idle_without_the_done_tick() {
        let mut m = StateMachine::new();
        m.step(down(BindingId::PushToTalk, 0));
        m.step(up(BindingId::PushToTalk, 1_000));
        let a = m.step(Input::Pipeline(PipelineEvent::Failed { session: SessionId(1), at_ms: 1_500 }));
        assert_eq!(a, vec![Action::ShowBar(BarState::Idle)]);
        assert!(matches!(m.state(), DictationState::Idle));
    }

    #[test]
    fn session_cap_warns_then_auto_stops() {
        let mut m = StateMachine::new();
        m.step(down(BindingId::HandsFree, 0)); // locked, no auto-release
        let a = m.step(Input::Tick { now_ms: WARN_AT_MS });
        assert!(a.iter().any(|x| matches!(x, Action::WarnSessionCap)));
        // Warning fires once.
        let a = m.step(Input::Tick { now_ms: WARN_AT_MS + 1 });
        assert!(!a.iter().any(|x| matches!(x, Action::WarnSessionCap)));
        // At the cap, auto-finalize.
        let a = m.step(Input::Tick { now_ms: SESSION_CAP_MS });
        assert!(a.iter().any(|x| matches!(x, Action::StopCaptureAndFinalize { .. })));
    }
}
