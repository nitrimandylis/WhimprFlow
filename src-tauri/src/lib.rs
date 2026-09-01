//! WhimprFlow Tauri shell.
//!
//! Runs as a macOS accessory (menu-bar) app: a tray item, a transparent
//! always-on-top Flow Bar overlay, and a hidden Hub window. This is the M0
//! skeleton — the sidecar supervisor, real state-machine bridge, and native
//! panel promotion arrive in later milestones. The overlay already listens for
//! `whimpr://flowbar/state`, so the tray demo items prove the event pipeline.

mod appctx;
mod autolearn;
mod diag;
mod hotkey;
mod local_llm;
mod paste;
mod permissions;
#[cfg(target_os = "windows")]
mod win;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

const OVERLAY_LABEL: &str = "whimpr_bar";
const HUB_LABEL: &str = "main";

#[derive(Clone, Serialize)]
struct BarStatePayload {
    state: &'static str,
}

/// Anchor the overlay window bottom-center of its monitor.
fn position_overlay(w: &WebviewWindow) {
    // current_monitor() can be None before the window maps; fall back sensibly.
    let monitor = w
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| w.current_monitor().ok().flatten())
        .or_else(|| w.available_monitors().ok().and_then(|m| m.into_iter().next()));
    let Some(monitor) = monitor else {
        eprintln!("[whimpr] no monitor found — overlay stays at default position");
        return;
    };
    let scale = monitor.scale_factor();
    let msize = monitor.size();
    let mpos = monitor.position();
    // A window that has never been shown reports outer_size 0 — fall back to the
    // configured inner size so the first placement isn't offset by half a pill.
    let wsize = w
        .outer_size()
        .ok()
        .filter(|s| s.width > 0 && s.height > 0)
        .or_else(|| w.inner_size().ok());
    let Some(wsize) = wsize else { return };
    let inset = (40.0 * scale) as i32;
    let x = mpos.x + (msize.width as i32 - wsize.width as i32) / 2;
    let y = mpos.y + msize.height as i32 - wsize.height as i32 - inset;
    let _ = w.set_position(tauri::PhysicalPosition { x, y });
}

fn build_overlay(app: &tauri::App) -> tauri::Result<WebviewWindow> {
    let overlay = WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        WebviewUrl::App("overlay.html".into()),
    )
    .title("WhimprBar")
    // Tight window so it only catches clicks right around the pill, not a big
    // invisible box over the app behind it.
    .inner_size(300.0, 72.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .resizable(false)
    // Hidden at rest: the pill only exists while WhimprFlow is actually doing
    // something (recording, cleaning up, flashing done, showing an error). The
    // tray icon is the idle presence. See `emit_flowbar_state`.
    .visible(false)
    .build()?;
    Ok(overlay)
}

fn build_hub(app: &tauri::App) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, HUB_LABEL, WebviewUrl::App("index.html".into()))
        .title("WhimprFlow")
        .inner_size(920.0, 640.0)
        .min_inner_size(720.0, 480.0)
        .visible(true)
        .build()
}

/// Bar states where the pill window must exist. Idle (the rest state) hides it —
/// the overlay is invisible until a dictation actually starts.
fn bar_visible(state: &str) -> bool {
    state != "idle"
}

/// Emit a flow-bar state to the overlay AND toggle its window visibility.
///
/// The single choke point every bar-state producer goes through (the macOS
/// state machine in `hotkey.rs`, the Windows pipeline in `win.rs`, the
/// diagnostics path in `diag.rs`, and the tray demo below), so the pill's
/// on-screen existence can never drift out of sync with the state it shows.
pub fn emit_flowbar_state(app: &tauri::AppHandle, state: &'static str) {
    let _ = app.emit_to(OVERLAY_LABEL, "whimpr://flowbar/state", BarStatePayload { state });
    if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
        if bar_visible(state) {
            // Re-anchor right before showing: the window may have never been
            // mapped, or the screen layout may have changed while hidden.
            position_overlay(&w);
            let _ = w.show();
            eprintln!("[whimpr] pill -> {state} (overlay shown)");
        } else {
            let _ = w.hide();
            eprintln!("[whimpr] pill -> {state} (overlay hidden)");
        }
    } else {
        eprintln!("[whimpr] pill -> {state} (no overlay window)");
    }
}


#[tauri::command]
fn get_settings() -> whimpr_core::Settings {
    hotkey::current_settings()
}

#[tauri::command]
fn set_settings(settings: whimpr_core::Settings) {
    hotkey::update_settings(settings);
}

/// Aggregated dictation stats for the Hub dashboard. `tz_offset_minutes` is the
/// browser's `Date.getTimezoneOffset()` so "today"/streak match the user's clock.
#[tauri::command]
fn get_stats(tz_offset_minutes: i32) -> whimpr_core::StatsSummary {
    hotkey::stats_summary(tz_offset_minutes)
}

/// Recent dictations for the Hub Home history list (newest first).
#[tauri::command]
fn get_history() -> Vec<whimpr_core::HistoryItem> {
    hotkey::history(200)
}

/// Dictionary entries for the Hub Dictionary screen.
#[tauri::command]
fn get_dictionary() -> Vec<hotkey::DictEntryDto> {
    hotkey::dictionary_entries()
}

/// Add a manual dictionary entry (word + optional known mishears).
#[tauri::command]
fn add_dictionary_entry(correct: String, mishears: Vec<String>) {
    hotkey::dictionary_add(correct, mishears);
}

/// Remove a dictionary entry by its spelling.
#[tauri::command]
fn remove_dictionary_entry(correct: String) {
    hotkey::dictionary_remove(&correct);
}

/// Permission + capability status shown in the Hub.
///
/// The permission half is a live read every time (see `permissions::snapshot`);
/// nothing here is remembered between calls. The Hub no longer has to ask for it
/// on a timer either — `permissions::watch` pushes the same shape at it on
/// `whimpr://permissions` the moment macOS changes its mind.
#[derive(Clone, Serialize)]
struct StatusReport {
    accessibility: bool,
    microphone: bool,
    input_monitoring: bool,
    microphone_grant: permissions::Grant,
    charged_to: Option<String>,
    microphone_hint: Option<String>,
    /// Whether the global hotkey is actually live. On macOS this is false for
    /// the stale-TCC-entry case: System Settings shows WhimprFlow as enabled,
    /// but the keyboard tap can't be created for this build's signature.
    hotkey_wired: bool,
    has_openai_key: bool,
    has_anthropic_key: bool,
}

#[tauri::command]
fn get_status() -> StatusReport {
    let p = permissions::snapshot();
    StatusReport {
        accessibility: p.accessibility,
        microphone: p.microphone,
        input_monitoring: p.input_monitoring,
        microphone_grant: p.microphone_grant,
        charged_to: p.charged_to,
        microphone_hint: p.microphone_hint,
        hotkey_wired: hotkey::tap_live(),
        has_openai_key: has_key("openai_api_key"),
        has_anthropic_key: has_key("anthropic_api_key"),
    }
}

/// The most recent loud diagnostic (permission/injection failure), if any —
/// lets the Hub show what went wrong even if it was opened after the fact.
/// See `diag::report`, called from the dictation pipeline whenever text
/// fails to reach the cursor.
#[tauri::command]
fn get_last_error() -> Option<diag::ErrorDto> {
    diag::last_error()
}

fn has_key(account: &str) -> bool {
    keyring::Entry::new("com.whimpr.whimprflow", account)
        .ok()
        .and_then(|e| e.get_password().ok())
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) {
    let _ = std::process::Command::new("open").arg(url).spawn();
}

/// Request microphone access: trigger the native prompt (bundle has a usage string)
/// by briefly opening the input device, and open the Microphone settings pane.
#[tauri::command]
fn request_microphone() {
    #[cfg(target_os = "macos")]
    {
        std::thread::spawn(|| {
            if let Ok(h) = whimpr_audio::start(|_: &[f32]| {}) {
                std::thread::sleep(std::time::Duration::from_millis(400));
                let _ = h.stop();
            }
        });
        open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
    }
}
/// The one self-heal for every "Accessibility is wrong" case: clear any TCC
/// entry for our bundle id with `tccutil` (removes the stale entry a previous
/// build's code signature left behind — the case where System Settings shows
/// WhimprFlow as enabled but the running build is refused), re-fire the native
/// prompt (which re-registers us in the list), and open the Accessibility pane
/// so the user can enable WhimprFlow fresh. The tap thread in `hotkey.rs`
/// picks the new grant up the moment it lands — no relaunch needed.
#[cfg(target_os = "macos")]
pub(crate) fn reset_and_prompt_accessibility() -> Result<(), String> {
    hotkey::mark_tap_stale();
    let out = std::process::Command::new("/usr/bin/tccutil")
        .args(["reset", "Accessibility", "com.whimpr.whimprflow"])
        .output()
        .map_err(|e| format!("failed to run tccutil: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "tccutil failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    eprintln!(
        "[whimpr] tccutil reset done: {}",
        String::from_utf8_lossy(&out.stdout).trim()
    );
    let _ = paste::prompt_accessibility();
    open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
    Ok(())
}

/// Request Accessibility — the permission that makes the Fn key work in every
/// app and lets us type into other apps. Resets any stale entry first (a no-op
/// when the grant was never made), then prompts and opens the pane.
#[tauri::command]
fn request_accessibility() {
    #[cfg(target_os = "macos")]
    {
        if let Err(e) = reset_and_prompt_accessibility() {
            eprintln!("[whimpr] accessibility reset/prompt failed: {e}");
        }
    }
}

/// Fix the stale-Accessibility case: System Settings shows WhimprFlow as
/// enabled, but macOS is still enforcing the code signature of an earlier
/// build, so the Fn tap can't be created even though `AXIsProcessTrusted`
/// says yes (or, conversely, the app reads "not granted" while the pane shows
/// it on). Same self-heal as `request_accessibility`; kept as its own command
/// because the Hub presents it as a distinct "Fix" action.
#[tauri::command]
fn fix_accessibility() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        reset_and_prompt_accessibility()?;
        Ok("reset".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("unsupported".to_string())
    }
}

/// Request Input Monitoring (needed for the Fn key to be seen in every app, not
/// just while WhimprFlow is frontmost): register + prompt, then open the pane.
#[tauri::command]
fn request_input_monitoring() {
    #[cfg(target_os = "macos")]
    {
        let _ = paste::request_input_monitoring();
        open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent");
    }
}

/// Save (or clear, when empty) an API key in the OS keychain, then rebuild providers
/// so it takes effect immediately.
#[tauri::command]
fn set_api_key(provider: String, key: String) -> Result<(), String> {
    let account = match provider.as_str() {
        "openai" => "openai_api_key",
        "anthropic" => "anthropic_api_key",
        _ => return Err(format!("unknown provider {provider}")),
    };
    let entry =
        keyring::Entry::new("com.whimpr.whimprflow", account).map_err(|e| e.to_string())?;
    let key = key.trim();
    // Delete any existing item first so the new one is created by (and readable to)
    // this app — a key added via the `security` CLI isn't readable by the app.
    let _ = entry.delete_credential();
    if !key.is_empty() {
        entry.set_password(key).map_err(|e| e.to_string())?;
    }
    hotkey::rebuild_providers();
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_settings,
            get_stats,
            get_history,
            get_dictionary,
            add_dictionary_entry,
            remove_dictionary_entry,
            get_status,
            get_last_error,
            request_microphone,
            request_accessibility,
            fix_accessibility,
            request_input_monitoring,
            set_api_key
        ])
        .setup(|app| {
            // Regular app: shows in the Dock with a normal, focusable main window.
            // (Can switch to a menu-bar-only accessory app later for the Wispr look.)
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            build_overlay(app)?;
            let hub = build_hub(app)?;
            let _ = hub.show();
            let _ = hub.set_focus();

            // Wire the Fn key to the pill via the real state machine.
            hotkey::install(app.handle().clone());

            // Keep the permission rows honest without the Hub having to be awake
            // to ask. This is what makes the setup screen's promise ("turns green
            // the moment macOS applies it — no relaunch needed") actually true:
            // the Hub's own timer stops within seconds of its window going away,
            // and the reader is granting from System Settings precisely then.
            permissions::watch(app.handle().clone());

            let open = MenuItem::with_id(app, "open", "Open WhimprFlow", true, None::<&str>)?;
            let demo_rec =
                MenuItem::with_id(app, "demo_rec", "Demo: recording", true, None::<&str>)?;
            let demo_idle = MenuItem::with_id(app, "demo_idle", "Demo: idle", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit WhimprFlow", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &demo_rec, &demo_idle, &sep, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window(HUB_LABEL) {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "demo_rec" => emit_flowbar_state(app, "recording"),
                    "demo_idle" => emit_flowbar_state(app, "idle"),
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running WhimprFlow");
}
