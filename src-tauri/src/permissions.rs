//! Where the three permission rows get their truth — and their heartbeat.
//!
//! The setup screen makes the reader a promise in its own words: "Each turns
//! green here the moment macOS applies it — no relaunch needed." Nothing in the
//! app used to keep that promise, and a tester wrote down the consequence:
//!
//! > "it didn't recognize that I had given it microphone permissions, however
//! > after taking them away and restarting the app it worked."
//!
//! Restarting is the one thing the screen swears you will never have to do. Two
//! separate faults were measured behind that one sentence.
//!
//! **The answer was frozen.** `AVCaptureDevice::authorizationStatusForMediaType`
//! caches per process: two copies of the same signed binary, running in the same
//! second against the same TCC database, disagreed — the one started before the
//! permission changed kept reporting the old value for as long as it lived, the
//! one started after reported the truth. Neither elapsed time nor app activation
//! cleared it. See [`crate::paste::microphone_authorization`], which now asks
//! TCC directly, the way the two rows that were never wrong always did.
//!
//! **Nobody was asking.** The only thing that ever re-read a permission was a
//! `setInterval` living inside the Hub's webview, and a webview that isn't
//! rendering runs no timers. Measured: hide the Hub window and the status calls
//! stop 4.4 seconds later and never come back, while a plain Rust thread keeps
//! ticking every half second. The reader grants the microphone in *System
//! Settings* — window behind, or closed to the tray — which is precisely when
//! the webview is asleep. So the heartbeat lives here now, in the process that
//! owns the truth: a thread samples macOS and pushes [`EVENT`] at the Hub the
//! moment anything changes. The webview keeps its own poll as a backstop, but it
//! is no longer the only thing standing between a granted permission and a green
//! row.

use serde::Serialize;
use std::time::Duration;

/// The event the Hub listens on. Payload is a [`Permissions`] snapshot.
pub const EVENT: &str = "whimpr://permissions";

/// How often we re-read macOS while the reader still owes us a permission —
/// this is the number behind "turns green the moment macOS applies it".
const POLL_WAITING: Duration = Duration::from_millis(500);
/// …and once everything is granted. Nothing is waiting on a green row any more,
/// so we drop to a slow beat that exists only to notice a permission being taken
/// away mid-session (a rebuild invalidating a grant, someone flipping a switch).
const POLL_SETTLED: Duration = Duration::from_secs(3);

/// What macOS says about the microphone right now. A bare bool couldn't tell
/// "nobody has asked yet" from "asked and turned down", which are the two states
/// with completely different instructions for the reader.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Grant {
    /// macOS says yes.
    Granted,
    /// Never asked — the next capture pops the system prompt.
    NotAsked,
    /// Asked and refused, or restricted by policy. The prompt will not come
    /// back; only the Microphone list in System Settings can undo it.
    Refused,
}

impl Grant {
    /// Map a raw `AVAuthorizationStatus`. Restricted (1) is grouped with denied
    /// because it lands the reader in the same place: no prompt is coming.
    pub fn from_authorization(raw: i64) -> Grant {
        match raw {
            3 => Grant::Granted,
            1 | 2 => Grant::Refused,
            _ => Grant::NotAsked,
        }
    }
}

/// Everything the Hub's permission rows render from.
#[derive(Clone, PartialEq, Debug, Serialize)]
pub struct Permissions {
    pub accessibility: bool,
    pub microphone: bool,
    pub input_monitoring: bool,
    pub microphone_grant: Grant,
    /// The app macOS will judge our microphone request as, when that is not us.
    /// `None` is the normal, launched-like-an-app case.
    pub charged_to: Option<String>,
    /// One sentence saying why the microphone row is not green, when there is
    /// something the reader could not otherwise have known. `None` when it is
    /// granted, or when the plain "grant it" copy is the whole story.
    pub microphone_hint: Option<String>,
}

/// Which answer the microphone row reports, given AVFoundation's per-process
/// cached `AVAuthorizationStatus` and TCC's live preflight (`None` when the
/// preflight symbol could not be found).
///
/// This is the seam the whole defect turns on, so it is a plain function with no
/// macOS in it. TCC wins, because TCC is the one that can change while we are
/// running — that is the entire fix. The two exceptions:
///
/// * a cached **Authorized** is honoured even against a negative preflight. It
///   was true at some point in this process's life, so trusting it can only
///   leave a row greener than it was before this change, never greyer.
/// * no preflight at all (symbol gone) falls straight back to today's answer,
///   so the worst case is the behaviour we already shipped.
pub fn resolve_microphone(cached_avf: i64, live_preflight: Option<i32>) -> i64 {
    const AUTHORIZED: i64 = 3;
    const DENIED: i64 = 2;
    const NOT_DETERMINED: i64 = 0;
    if cached_avf == AUTHORIZED {
        return AUTHORIZED;
    }
    match live_preflight {
        Some(0) => AUTHORIZED,
        Some(1) => DENIED,
        Some(2) => NOT_DETERMINED,
        _ => cached_avf,
    }
}

/// The sentence under the microphone row, or `None` to keep the default copy.
///
/// The only reason this exists is that "not granted" was, for one real reader, a
/// lie of omission: macOS had already made up its mind about a *different* app,
/// and no amount of granting WhimprFlow was going to change the answer.
pub fn microphone_hint(grant: Grant, charged_to: Option<&str>) -> Option<String> {
    if grant == Grant::Granted {
        return None;
    }
    if let Some(other) = charged_to {
        return Some(format!(
            "macOS is judging this as {other}, not WhimprFlow — switch {other} on in the \
             Microphone list, or quit WhimprFlow and reopen it from Applications so it \
             answers for itself."
        ));
    }
    match grant {
        Grant::Refused => Some(
            "turned down earlier, so macOS won't ask again — switch WhimprFlow on in the \
             Microphone list."
                .to_string(),
        ),
        _ => None,
    }
}

/// Read macOS right now. Every field is a live question to the OS; nothing here
/// is remembered between calls, which is the whole point.
pub fn snapshot() -> Permissions {
    let charged_to = crate::paste::charged_to();
    let grant = Grant::from_authorization(crate::paste::microphone_authorization());
    Permissions {
        accessibility: crate::paste::is_trusted(),
        microphone: grant == Grant::Granted,
        input_monitoring: crate::paste::input_monitoring_granted(),
        microphone_grant: grant,
        microphone_hint: microphone_hint(grant, charged_to.as_deref()),
        charged_to,
    }
}

/// How long to wait before reading macOS again. Fast while the reader is still
/// owed a green row; slow once there is nothing left to wait for.
pub fn poll_interval(p: &Permissions) -> Duration {
    if p.accessibility && p.microphone && p.input_monitoring {
        POLL_SETTLED
    } else {
        POLL_WAITING
    }
}

/// Turns a stream of snapshots into a stream of *changes*, so the Hub is woken
/// only when something actually moved and a quiet app stays quiet.
#[derive(Default)]
pub struct Changes {
    last: Option<Permissions>,
}

impl Changes {
    /// `Some(snapshot)` the first time and on every change after that; `None`
    /// while macOS keeps giving the same answer.
    pub fn observe(&mut self, next: Permissions) -> Option<Permissions> {
        if self.last.as_ref() == Some(&next) {
            return None;
        }
        self.last = Some(next.clone());
        Some(next)
    }
}

/// Start the heartbeat. Runs for the life of the app on its own thread: the
/// permission rows must stay live even when the Hub's webview is closed,
/// covered, or asleep, because that is precisely when the reader is off in
/// System Settings granting the thing.
pub fn watch(app: tauri::AppHandle) {
    use tauri::Emitter;
    std::thread::spawn(move || {
        let mut changes = Changes::default();
        loop {
            let now = snapshot();
            let wait = poll_interval(&now);
            if let Some(changed) = changes.observe(now) {
                let _ = app.emit(EVENT, changed);
            }
            std::thread::sleep(wait);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perms(acc: bool, grant: Grant, charged_to: Option<&str>) -> Permissions {
        Permissions {
            accessibility: acc,
            microphone: grant == Grant::Granted,
            input_monitoring: false,
            microphone_grant: grant,
            charged_to: charged_to.map(str::to_string),
            microphone_hint: microphone_hint(grant, charged_to),
        }
    }

    /// **The tester's machine, as a test.**
    ///
    /// > "it didn't recognize that I had given it microphone permissions,
    /// > however after taking them away and restarting the app it worked."
    ///
    /// Measured on this repo: `tccutil reset Microphone com.whimpr.whimprflow`
    /// at t=0, then two copies of the same signed WhimprFlow binary sampled in
    /// the same second — the one launched before the change kept answering with
    /// the pre-change value for as long as it lived, the one launched after
    /// answered correctly. That is `cached_avf`: whatever AVFoundation was told
    /// at launch, forever. The reader's grant only exists in the live preflight.
    ///
    /// Point `resolve_microphone` back at `cached_avf` alone — which is what the
    /// app shipped — and every case below goes red, which is the whole bug.
    #[test]
    fn a_permission_that_changed_after_launch_is_reported_not_the_one_from_launch() {
        // Granted in System Settings while the app was already running. This is
        // the tester's row: it must be green now, not after a relaunch.
        assert_eq!(
            resolve_microphone(0, Some(0)),
            3,
            "a grant that lands after launch must turn the row green"
        );
        // Same story from a "denied" start: he turned it off, then on again.
        assert_eq!(resolve_microphone(2, Some(0)), 3);
        // And revoked after launch, which the old code could never see either.
        assert_eq!(resolve_microphone(0, Some(1)), 2);
        assert_eq!(resolve_microphone(0, Some(2)), 0);
    }

    #[test]
    fn a_microphone_row_can_only_get_greener_than_it_was_before_this_change() {
        // A cached yes is never overruled: it was true once in this process, and
        // this change must not be able to grey out a row that used to work.
        assert_eq!(resolve_microphone(3, Some(1)), 3);
        assert_eq!(resolve_microphone(3, Some(2)), 3);
        assert_eq!(resolve_microphone(3, None), 3);
        // No preflight to ask (symbol gone) degrades to exactly what shipped.
        for cached in [-1, 0, 1, 2, 3] {
            assert_eq!(resolve_microphone(cached, None), cached);
        }
    }

    #[test]
    fn authorization_status_maps_to_the_three_states_the_reader_cares_about() {
        assert_eq!(Grant::from_authorization(3), Grant::Granted);
        assert_eq!(Grant::from_authorization(0), Grant::NotAsked);
        assert_eq!(Grant::from_authorization(2), Grant::Refused);
        // Restricted by policy: no prompt is coming, same as denied.
        assert_eq!(Grant::from_authorization(1), Grant::Refused);
    }

    /// The tester's sentence, as a test: macOS said yes, the row said no. Its
    /// first cause was a status the process read once and then never re-read —
    /// so the thing that notices a change has to be the thing that pushes, and
    /// it has to push the *change*, not the reading.
    ///
    /// Revert `Changes::observe` to "always report" or "never report" and this
    /// goes red: the first is a wake-up every half second forever, the second is
    /// the tester's frozen row.
    #[test]
    fn the_watcher_pushes_every_change_once_and_stays_quiet_otherwise() {
        let mut changes = Changes::default();
        let waiting = perms(false, Grant::NotAsked, None);
        let granted = perms(false, Grant::Granted, None);

        assert!(
            changes.observe(waiting.clone()).is_some(),
            "first read always reports"
        );
        assert!(
            changes.observe(waiting.clone()).is_none(),
            "unchanged must stay quiet"
        );
        assert!(changes.observe(waiting.clone()).is_none());

        // The moment macOS applies the grant, exactly one push — no relaunch,
        // and no webview timer involved.
        let pushed = changes
            .observe(granted.clone())
            .expect("a grant must wake the Hub");
        assert!(pushed.microphone);
        assert!(changes.observe(granted).is_none());

        // And a permission taken away mid-session is a change too.
        assert!(
            changes.observe(waiting).is_some(),
            "a revoke must wake the Hub"
        );
    }

    #[test]
    fn the_heartbeat_is_fast_while_a_row_is_still_grey_and_slow_once_it_is_not() {
        let mut waiting = perms(true, Grant::NotAsked, None);
        waiting.input_monitoring = true;
        assert!(
            poll_interval(&waiting) <= Duration::from_secs(1),
            "the screen promises 'the moment macOS applies it'"
        );

        let mut settled = perms(true, Grant::Granted, None);
        settled.input_monitoring = true;
        assert!(poll_interval(&settled) > Duration::from_secs(1));
    }

    /// A row macOS will never turn green must say whose switch actually counts.
    /// Measured: the same binary launched from a shell reads the *terminal's*
    /// microphone answer, so "grant WhimprFlow" is advice that cannot work.
    #[test]
    fn a_row_that_cannot_go_green_names_the_app_macos_is_actually_judging() {
        let hint = microphone_hint(Grant::NotAsked, Some("Terminal"))
            .expect("a row macOS will never turn green must explain itself");
        assert!(
            hint.contains("Terminal"),
            "must name the app that counts: {hint}"
        );
        assert!(
            hint.contains("reopen it from Applications"),
            "must give the way out: {hint}"
        );
    }

    #[test]
    fn a_refused_microphone_says_the_prompt_is_not_coming_back() {
        let hint = microphone_hint(Grant::Refused, None).expect("refused needs its own sentence");
        assert!(hint.contains("won't ask again"), "{hint}");
    }

    #[test]
    fn a_granted_microphone_says_nothing_extra() {
        assert_eq!(microphone_hint(Grant::Granted, None), None);
        // Even when something else is responsible: it is granted, so it is
        // green, and there is nothing for the reader to do.
        assert_eq!(microphone_hint(Grant::Granted, Some("Terminal")), None);
    }
}
