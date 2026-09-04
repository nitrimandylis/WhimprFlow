//! WhimprFlow Tauri shell.
//!
//! Runs as a macOS accessory (menu-bar) app: a tray item, a transparent
//! always-on-top Flow Bar overlay, and a hidden Hub window. This is the M0
//! skeleton — the sidecar supervisor, real state-machine bridge, and native
//! panel promotion arrive in later milestones.

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

/// The overlay's size in LOGICAL points — the same values it is built with.
///
/// Deliberately constants rather than reading `outer_size()`: that returns
/// physical pixels for whichever display the window is on *right now*, so
/// dividing it by the scale of the display we are moving TO gave a size that was
/// wrong by the ratio between them. Moving from a 1× screen to the 2× laptop
/// computed the pill as 160×70 instead of 320×132 and parked it under the Dock.
/// The window is not resizable, so its logical size never changes.
const OVERLAY_W_PT: f64 = 320.0;
const OVERLAY_H_PT: f64 = 132.0;
const HUB_LABEL: &str = "main";

#[derive(Clone, Serialize)]
struct BarStatePayload {
    state: &'static str,
}

/// Pick the display the pill should sit on.
///
/// "Active display" is approximated by the one under the mouse pointer, which is
/// where the user is working and, on a hold-to-talk app, where they just pressed
/// the key. Falls back to the primary display, which is what this used to always
/// do — and why the pill only ever appeared on the laptop screen.
/// Scale factor of the primary display, which is the unit `cursor_position` is
/// reported in on macOS (global points multiplied by the primary's scale).
fn primary_scale(w: &WebviewWindow) -> f64 {
    w.primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0)
}

/// A monitor's work area in LOGICAL points.
///
/// Measured from real values on a mixed-DPI setup: `position` comes back in
/// logical points while `size` comes back in physical pixels, so the size has to
/// be divided by that monitor's own scale to get a coherent rectangle.
fn work_area_logical(m: &tauri::Monitor) -> (f64, f64, f64, f64) {
    let a = m.work_area();
    whimpr_core::settings::work_area_points(
        m.position().y,
        a.position.x,
        a.position.y,
        a.size.width,
        a.size.height,
        m.scale_factor(),
    )
}

/// A monitor's FULL bounds in logical points, for the cursor hit-test.
fn monitor_logical_rect(m: &tauri::Monitor) -> (f64, f64, f64, f64) {
    let s = if m.scale_factor() > 0.0 { m.scale_factor() } else { 1.0 };
    let p = m.position();
    let sz = m.size();
    (
        p.x as f64,
        p.y as f64,
        sz.width as f64 / s,
        sz.height as f64 / s,
    )
}

/// One-shot dump of every display, so the geometry can be checked rather than
/// inferred from where the pill ended up.
fn log_monitor_table(w: &WebviewWindow) {
    let Ok(monitors) = w.available_monitors() else { return };
    eprintln!("[whimpr] --- displays (primary scale {:.1}) ---", primary_scale(w));
    for m in monitors {
        let p = m.position();
        let s = m.size();
        let a = m.work_area();
        eprintln!(
            "[whimpr]   \"{}\" scale {:.1} pos({},{}) size({}x{}) work(pos {},{} size {}x{})",
            m.name().cloned().unwrap_or_else(|| "?".into()),
            m.scale_factor(),
            p.x, p.y, s.width, s.height,
            a.position.x, a.position.y, a.size.width, a.size.height
        );
    }
}

fn pill_monitor(w: &WebviewWindow, follow_active: bool) -> Option<tauri::Monitor> {
    if follow_active {
        if let Ok(cursor) = w.app_handle().cursor_position() {
            // Everything is compared in LOGICAL points. `cursor_position` arrives
            // as logical × the primary's scale, so divide that out first;
            // `monitor_from_point` was tried and returned a different display on
            // alternating ticks, which is what made the pill flap.
            let ps = primary_scale(w);
            let (lx, ly) = (cursor.x / ps, cursor.y / ps);

            if let Ok(monitors) = w.available_monitors() {
                let hit = monitors.into_iter().find(|m| {
                    let (x0, y0, wl, hl) = monitor_logical_rect(m);
                    lx >= x0 && lx < x0 + wl && ly >= y0 && ly < y0 + hl
                });
                if hit.is_some() {
                    return hit;
                }
            }
            eprintln!(
                "[whimpr] cursor ({:.0},{:.0}) -> logical ({:.0},{:.0}) matched no monitor",
                cursor.x, cursor.y, lx, ly
            );
        } else {
            eprintln!("[whimpr] cursor position unavailable — staying on the primary");
        }
    }
    // current_monitor() can be None before the window maps; fall back sensibly.
    w.primary_monitor()
        .ok()
        .flatten()
        .or_else(|| w.current_monitor().ok().flatten())
        .or_else(|| w.available_monitors().ok().and_then(|m| m.into_iter().next()))
}

/// Anchor the overlay bottom-center of the target display's **work area**.
///
/// The work area excludes the Dock and the menu bar. The previous version used
/// the full monitor rect minus a fixed 40pt inset, which put the pill squarely
/// underneath the Dock on any Mac with the Dock on the bottom.
/// Where the pill *should* be right now, in physical pixels.
///
/// Split out from `position_overlay` so the watcher can compare it against the
/// window's actual position every tick. Change-detection on "which monitor" or
/// "what work area" turned out to be too clever: any state it failed to predict
/// left the pill stranded until the next dictation. Comparing against the real
/// position instead means it corrects itself no matter how it got out of place.
fn desired_overlay_position(
    w: &WebviewWindow,
    settings: &whimpr_core::Settings,
) -> Option<tauri::LogicalPosition<f64>> {
    let following = settings.pill_follows_active_display;
    let monitor = pill_monitor(w, following)?;
    let (ax, ay, aw, ah) = work_area_logical(&monitor);
    let (ww, wh) = (OVERLAY_W_PT, OVERLAY_H_PT);

    let scale = monitor.scale_factor();
    let (x, y) = match settings.pill_pos {
        // pill_pos is stored in physical pixels (from outerPosition), but
        // work_area_logical and LogicalPosition are in points. Divide by
        // scale factor to convert, or the pill jumps on HiDPI displays.
        Some((px, py)) if !following => (
            (px as f64 / scale).clamp(ax, (ax + aw - ww).max(ax)),
            (py as f64 / scale).clamp(ay, (ay + ah - wh).max(ay)),
        ),
        _ => whimpr_core::settings::pill_placement(
            (ax, ay, aw, ah),
            ww,
            wh,
            settings.pill_bottom_inset,
        ),
    };

    Some(tauri::LogicalPosition::new(x, y))
}

fn position_overlay(w: &WebviewWindow) {
    let settings = hotkey::current_settings();

    let Some(pos) = desired_overlay_position(w, &settings) else {
        eprintln!("[whimpr] no monitor found — overlay stays at default position");
        return;
    };
    let _ = w.set_position(pos);
    eprintln!("[whimpr] overlay placed at logical ({:.0},{:.0})", pos.x, pos.y);
}

/// Show or hide the pill for the current dictation state — a thin wrapper kept
/// for call sites outside the state machine (settings changes, startup), so
/// they still go through the same shared emitter as every dictation-state
/// transition. See `emit_flowbar_state`.
pub(crate) fn sync_pill_visibility(app: &tauri::AppHandle, state: &'static str) {
    emit_flowbar_state(app, state);
}

// ── Pill controls ────────────────────────────────────────────────────────────
/// Discard the in-flight dictation (the pill's ✕).
#[tauri::command]
fn pill_cancel() {
    hotkey::ui_cancel();
}

/// Finish now and insert what has been said (the pill's ■).
#[tauri::command]
fn pill_stop() {
    hotkey::ui_stop();
}

/// Begin a hands-free dictation (clicking the idle pill).
#[tauri::command]
fn pill_start() {
    hotkey::ui_start();
}

// ── Transforms ───────────────────────────────────────────────────────────────
#[tauri::command]
fn get_transforms() -> Vec<whimpr_core::Transform> {
    hotkey::transforms()
}

#[tauri::command]
fn set_transform_enabled(id: String, enabled: bool) {
    hotkey::transform_set_enabled(&id, enabled);
}

// ── Snippets ─────────────────────────────────────────────────────────────────
#[tauri::command]
fn get_snippets() -> Vec<whimpr_core::Snippet> {
    hotkey::snippets()
}

#[tauri::command]
fn add_snippet(trigger: String, expansion: String) {
    hotkey::snippet_add(trigger, expansion);
}

#[tauri::command]
fn remove_snippet(trigger: String) {
    hotkey::snippet_remove(&trigger);
}

// ── Scratchpad ───────────────────────────────────────────────────────────────
/// While capture is on, finished dictations are appended to the Scratchpad
/// instead of being pasted into whatever app happens to be frontmost.
#[tauri::command]
fn set_scratchpad_capture(on: bool) {
    hotkey::set_scratchpad_capture(on);
}

#[tauri::command]
fn get_scratchpad_capture() -> bool {
    hotkey::scratchpad_capture()
}

#[tauri::command]
fn get_scratchpad() -> String {
    std::fs::read_to_string(hotkey::scratchpad_path()).unwrap_or_default()
}

#[tauri::command]
fn set_scratchpad(text: String) -> Result<(), String> {
    let path = hotkey::scratchpad_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, text).map_err(|e| e.to_string())
}

/// Input device names for the microphone picker.
#[tauri::command]
fn list_microphones() -> Vec<String> {
    whimpr_audio::input_device_names()
}

/// Install or remove the login item.
///
/// Deliberately a LaunchAgent that shells out to `open -a` rather than launching
/// the executable directly: LaunchServices must be the one starting the app, or
/// macOS attributes Accessibility and Microphone to launchd instead of to
/// WhimprFlow and every permission silently reads as denied.
#[cfg(target_os = "macos")]
fn apply_launch_at_login(enabled: bool) {
    let home = std::env::var("HOME").unwrap_or_default();
    let dir = std::path::PathBuf::from(&home).join("Library/LaunchAgents");
    let plist = dir.join("com.whimpr.whimprflow.plist");

    if !enabled {
        let _ = std::fs::remove_file(&plist);
        return;
    }
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let body = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.whimpr.whimprflow</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/open</string>
        <string>-a</string>
        <string>/Applications/WhimprFlow.app</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"#;
    if let Err(e) = std::fs::write(&plist, body) {
        eprintln!("[whimpr] could not write the login item: {e}");
    }
}

/// Show or hide the Dock icon. Accessory = menu-bar-only.
#[cfg(target_os = "macos")]
fn apply_dock_visibility(app: &tauri::AppHandle, show: bool) {
    let policy = if show {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };
    if let Err(e) = app.set_activation_policy(policy) {
        eprintln!("[whimpr] could not change the activation policy: {e}");
    }
}

/// Quit and relaunch. Needed because macOS resolves microphone authorisation
/// once at process start, so a grant made while running is invisible until then.
#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

/// Persist a pill position the user dragged to (physical pixels, window top-left).
#[tauri::command]
fn set_pill_position(x: i32, y: i32) {
    let mut settings = hotkey::current_settings();
    settings.pill_pos = Some((x, y));
    // Deliberately dragging the pill somewhere means you want it to stay there,
    // so stop following the cursor between displays — otherwise the drag would
    // appear to do nothing the next time you moved screens.
    settings.pill_follows_active_display = false;
    hotkey::update_settings(settings);
}

/// Keep the pill on whichever display the pointer is on.
///
/// `position_overlay` previously ran only at startup, on a settings change and at
/// the start of a dictation — so moving to another screen left the pill behind
/// until you next spoke, which read as "follow active display doesn't work".
fn spawn_display_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        // Name of the display the pill was last placed on.
        let mut last_target: Option<String> = None;
        loop {
            // Short enough that moving to another screen feels like the pill came
            // with you, rather than catching up a beat later.
            std::thread::sleep(std::time::Duration::from_millis(220));

            let settings = hotkey::current_settings();
            if !settings.pill_follows_active_display {
                continue;
            }
            let Some(w) = app.get_webview_window(OVERLAY_LABEL) else {
                continue;
            };
            let Some(monitor) = pill_monitor(&w, true) else { continue };

            // Move when the target display changes OR when that display's work
            // area does. Both matter and each was fixed at the cost of the other
            // in earlier attempts: the display covers "I moved screens", the work
            // area covers "the Dock just arrived here". Neither changes as the
            // cursor wanders within one screen, so the pill stays put.
            let a = monitor.work_area();
            let key = format!(
                "{}|{},{},{},{}",
                monitor.name().cloned().unwrap_or_default(),
                a.position.x,
                a.position.y,
                a.size.width,
                a.size.height
            );
            if last_target.as_deref() == Some(key.as_str()) {
                continue;
            }
            let Some(want) = desired_overlay_position(&w, &settings) else {
                continue;
            };
            last_target = Some(key.clone());
            let _ = w.set_position(want);

            // Verify rather than assume. `set_position` takes a LogicalPosition,
            // but which space tao maps that into on a mixed-DPI setup is exactly
            // what has been guessed wrong before — so read back where the window
            // actually landed, and on which display.
            std::thread::sleep(std::time::Duration::from_millis(60));
            let landed = w
                .current_monitor()
                .ok()
                .flatten()
                .and_then(|m| m.name().cloned())
                .unwrap_or_else(|| "?".into());
            let at = w
                .outer_position()
                .map(|p| format!("{},{}", p.x, p.y))
                .unwrap_or_else(|_| "?".into());
            eprintln!(
                "[whimpr] MOVE want logical({:.0},{:.0}) target[{}] -> landed on \"{}\" at physical({})",
                want.x, want.y, key, landed, at
            );
        }
    });
}

/// Is the cursor inside the pill zone (bottom-center of the overlay)?
///
/// Uses a proportional slice of the window, not the full bounds, so the
/// transparent area above the pill doesn't trigger hover. The zone covers
/// the expanded pill + action buttons (~100 logical points from the bottom,
/// ~192 wide centered).
fn cursor_over_pill_zone(w: &WebviewWindow, app: &tauri::AppHandle) -> bool {
    let Ok(cursor) = app.cursor_position() else { return false };
    let Ok(pos) = w.outer_position() else { return false };
    let Ok(size) = w.outer_size() else { return false };

    let ww = size.width as f64;
    let wh = size.height as f64;
    let cx = pos.x as f64 + ww / 2.0;
    let bottom = pos.y as f64 + wh;
    // Bottom 75% covers pill + action buttons; middle 60% covers their width.
    let zone_w = ww * 0.6;
    let zone_h = wh * 0.75;

    cursor.x >= cx - zone_w / 2.0
        && cursor.x <= cx + zone_w / 2.0
        && cursor.y >= bottom - zone_h
        && cursor.y <= bottom
}

/// Track cursor over the pill zone. On enter, emit `whimpr://hover` true and
/// temporarily accept mouse events so the action buttons are clickable.
/// On exit, emit false and go back to click-through.
fn spawn_hover_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut was_over = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(60));

            let Some(w) = app.get_webview_window(OVERLAY_LABEL) else { continue };
            if !w.is_visible().unwrap_or(false) {
                if was_over {
                    was_over = false;
                    let _ = app.emit_to(OVERLAY_LABEL, "whimpr://hover", false);
                    #[cfg(target_os = "macos")]
                    set_ignores_mouse(&w, true);
                }
                continue;
            }

            let over = cursor_over_pill_zone(&w, &app);
            if over != was_over {
                was_over = over;
                let _ = app.emit_to(OVERLAY_LABEL, "whimpr://hover", over);
                // Toggle click-through: off while hovering so buttons work,
                // back on when leaving so the pill never steals focus.
                #[cfg(target_os = "macos")]
                set_ignores_mouse(&w, !over);
            }
        }
    });
}

/// Set or clear ignoresMouseEvents on the overlay's NSWindow.
#[cfg(target_os = "macos")]
fn set_ignores_mouse(w: &WebviewWindow, ignore: bool) {
    use objc2_app_kit::NSWindow;
    if let Ok(ns_ptr) = w.ns_window() {
        let ns_window: &NSWindow = unsafe { &*(ns_ptr as *const NSWindow) };
        ns_window.setIgnoresMouseEvents(ignore);
    }
}

/// Forget the dragged position and go back to the computed anchor.
#[tauri::command]
fn reset_pill_position(app: tauri::AppHandle) {
    let mut settings = hotkey::current_settings();
    settings.pill_pos = None;
    // Dragging turns following off, so resetting has to turn it back on —
    // otherwise the pill goes back to bottom-centre once and then stops
    // following you between displays, which looks like the reset half-worked.
    settings.pill_follows_active_display = true;
    hotkey::update_settings(settings);
    if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
        position_overlay(&w);
    }
}

fn build_overlay(app: &tauri::App) -> tauri::Result<WebviewWindow> {
    let overlay = WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        WebviewUrl::App("overlay.html".into()),
    )
    .title("WhimprBar")
    // Sized for the hover cluster: a "Dictate fn" tooltip stacked above a row of
    // action buttons. The content is bottom-aligned, so the resting nub still sits
    // at the bottom edge and everything above it is transparent until you hover.
    .inner_size(OVERLAY_W_PT, OVERLAY_H_PT)
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

    // Show the overlay on every macOS Space and over full-screen apps.
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSWindow;
        match overlay.ns_window() {
            Ok(ns_ptr) => {
                eprintln!("[whimpr] build_overlay: ns_window() succeeded, configuring NSWindow");
                // Safety: ns_window() returns a valid NSWindow pointer on macOS.
                let ns_window: &NSWindow = unsafe { &*(ns_ptr as *const NSWindow) };
                // CanJoinAllSpaces (1 << 0) | FullScreenAuxiliary (1 << 8)
                ns_window.setCollectionBehavior(
                    objc2_app_kit::NSWindowCollectionBehavior(1 | (1 << 8)),
                );
                // NSStatusWindowLevel (25) floats above full-screen apps.
                ns_window.setLevel(25);
                // Let clicks pass through to the app underneath. The pill is
                // a visual indicator only: dictation is driven by the Fn key,
                // not by clicking the overlay. Without this, clicking the pill
                // activates WhimprFlow and steals focus from the user's app.
                ns_window.setIgnoresMouseEvents(true);
                eprintln!("[whimpr] build_overlay: setIgnoresMouseEvents(true) applied");
            }
            Err(e) => {
                eprintln!("[whimpr] build_overlay: ns_window() FAILED: {e} — overlay will steal focus!");
            }
        }
    }

    // Deliberately NOT positioned here: settings (including any dragged position)
    // are only loaded once hotkey::install runs, so setup() places it afterwards.
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
/// the overlay is invisible until a dictation actually starts — unless the user
/// has turned on "show pill at all times".
fn bar_visible(state: &str) -> bool {
    state != "idle" || hotkey::current_settings().show_pill_always
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
fn set_settings(app: tauri::AppHandle, settings: whimpr_core::Settings) {
    #[cfg(target_os = "macos")]
    {
        apply_launch_at_login(settings.launch_at_login);
        apply_dock_visibility(&app, settings.show_in_dock);
    }
    hotkey::update_settings(settings);
    // The hands-free hotkey may have changed — re-register it from the new
    // settings so a customized combo takes effect without a relaunch.
    apply_hands_free_shortcut(&app);
    // Pill geometry/visibility live in the same settings blob, so re-apply both
    // immediately rather than waiting for the next dictation.
    if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
        position_overlay(&w);
    }
    sync_pill_visibility(&app, hotkey::last_bar());
}

/// Stop and finalize the current recording — the overlay pill's red Stop button.
#[tauri::command]
fn stop_dictation() {
    hotkey::stop_dictation();
}

/// Discard the current recording — the overlay pill's ✕ button.
#[tauri::command]
fn cancel_dictation() {
    hotkey::cancel_dictation();
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

/// Export dictation history as JSON or plain text.
#[tauri::command]
fn export_history(format: String) -> Result<String, String> {
    let items = hotkey::history(100_000);
    match format.as_str() {
        "json" => serde_json::to_string_pretty(&items).map_err(|e| e.to_string()),
        "txt" => {
            let lines: Vec<String> = items
                .iter()
                .map(|it| {
                    let secs = it.ts_unix;
                    let app = it.app.as_deref().unwrap_or("unknown");
                    format!("[{secs}] ({app}) {}", it.text)
                })
                .collect();
            Ok(lines.join("\n"))
        }
        _ => Err(format!("unknown format: {format}")),
    }
}

/// Version and git hash for the Help pane.
#[derive(Clone, Serialize)]
struct BuildInfoDto {
    version: String,
    git_hash: String,
}

#[tauri::command]
fn get_build_info() -> BuildInfoDto {
    BuildInfoDto {
        version: env!("CARGO_PKG_VERSION").to_string(),
        git_hash: env!("GIT_HASH").to_string(),
    }
}

/// Copy arbitrary text to the system clipboard, for the Hub's history "Copy"
/// button. Note this is a plain set — unlike `paste::paste_text`, which restores
/// the previous clipboard afterwards, here the user explicitly asked for the
/// text to stay on the clipboard.
#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    use arboard::Clipboard;
    let mut cb = Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(text).map_err(|e| e.to_string())
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

/// Request microphone access with AVFoundation so macOS registers this bundle in
/// Privacy & Security, then open the Microphone settings pane.
#[tauri::command]
fn request_microphone() {
    #[cfg(target_os = "macos")]
    {
        paste::request_microphone_access();
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

/// (Re)register the customizable hands-free global hotkey from the current
/// settings — press once to start hands-free dictation, again to stop. Called at
/// startup and whenever settings change. Best-effort: an unregisterable or empty
/// accelerator just leaves the hotkey off (Fn push-to-talk and double-tap-Fn
/// hands-free still work), never a crash.
fn apply_hands_free_shortcut(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let global_shortcut = app.global_shortcut();
    let _ = global_shortcut.unregister_all();
    let accelerator = hotkey::current_settings().hands_free_hotkey;
    if accelerator.trim().is_empty() {
        return;
    }
    if let Err(e) = global_shortcut.register(accelerator.as_str()) {
        eprintln!("[whimpr] hands-free hotkey '{accelerator}' could not be registered: {e}");
    }
}

/// Show and focus the Hub window, whether it's hidden (closed via the X button,
/// which we intercept below) or just needs to come to the front.
fn show_hub(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(HUB_LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default().plugin(
        // The customizable hands-free hotkey lives here — the OS registers the
        // chord, so pressing it fires our handler AND is suppressed from the
        // focused app (a listen-only CGEvent tap could not consume a printable
        // key like Space). Only the hands-free shortcut is ever registered, so
        // any Pressed event is a hands-free toggle.
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|_app, _shortcut, event| {
                if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    hotkey::trigger_hands_free();
                }
            })
            .build(),
    );
    // Relaunching the app (double-clicking the exe/installer shortcut again) must
    // not spawn a second process — it should just surface the running one. Without
    // this, every relaunch left a new instance in the taskbar. macOS's Dock already
    // re-activates the existing instance, so this is Windows/Linux-only.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_hub(app);
        }));
    }
    builder
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_settings,
            stop_dictation,
            cancel_dictation,
            get_stats,
            get_history,
            copy_to_clipboard,
            restart_app,
            list_microphones,
            pill_cancel,
            pill_stop,
            pill_start,
            get_transforms,
            set_transform_enabled,
            get_snippets,
            add_snippet,
            remove_snippet,
            set_scratchpad_capture,
            get_scratchpad_capture,
            get_scratchpad,
            set_scratchpad,
            set_pill_position,
            reset_pill_position,
            get_dictionary,
            add_dictionary_entry,
            remove_dictionary_entry,
            get_status,
            get_last_error,
            request_microphone,
            request_accessibility,
            fix_accessibility,
            request_input_monitoring,
            set_api_key,
            export_history,
            get_build_info
        ])
        .setup(|app| {
            // Regular app: shows in the Dock with a normal, focusable main window.
            // (Can switch to a menu-bar-only accessory app later for the Wispr look.)
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            let overlay = build_overlay(app)?;
            let hub = build_hub(app)?;
            let _ = hub.show();
            let _ = hub.set_focus();
            // Closing the Hub via the X button should hide it (dictation keeps
            // running from the tray), not destroy the window — otherwise "Open
            // WhimprFlow" in the tray has nothing left to show.
            hub.on_window_event({
                let app = app.handle().clone();
                move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(w) = app.get_webview_window(HUB_LABEL) {
                            let _ = w.hide();
                        }
                    }
                }
            });

            // Wire the Fn key to the pill via the real state machine. This also
            // loads settings.json, so the pill can be placed from here on.
            hotkey::install(app.handle().clone());

            // Register the customizable hands-free hotkey (default Cmd+Shift+Space).
            apply_hands_free_shortcut(app.handle());

            // Keep the permission rows honest without the Hub having to be awake
            // to ask. This is what makes the setup screen's promise ("turns green
            // the moment macOS applies it — no relaunch needed") actually true:
            // the Hub's own timer stops within seconds of its window going away,
            // and the reader is granting from System Settings precisely then.
            permissions::watch(app.handle().clone());

            log_monitor_table(&overlay);
            position_overlay(&overlay);
            sync_pill_visibility(app.handle(), "idle");
            spawn_display_watcher(app.handle().clone());
            spawn_hover_watcher(app.handle().clone());

            // Settings exist by now, so honour the saved Dock preference and keep
            // the login item in sync with it.
            #[cfg(target_os = "macos")]
            {
                let mut s = hotkey::current_settings();
                apply_dock_visibility(app.handle(), s.show_in_dock);
                apply_launch_at_login(s.launch_at_login);

                // A saved pixel position only means anything on the display it was
                // set on, and it is ignored while following is enabled — so having
                // both set is a contradiction that leaves the pill looking stuck.
                // Drop the stale one on launch.
                if s.pill_follows_active_display && s.pill_pos.is_some() {
                    eprintln!("[whimpr] clearing a stale pinned pill position");
                    s.pill_pos = None;
                    hotkey::update_settings(s);
                }
            }

            let open = MenuItem::with_id(app, "open", "Open WhimprFlow", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit WhimprFlow", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &sep, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_hub(app),
                    "demo_rec" => emit_flowbar_state(app, "recording"),
                    "demo_idle" => emit_flowbar_state(app, "idle"),
                    "quit" => app.exit(0),
                    _ => {}
                });
            // Monochrome tray.png as a macOS template image (adapts to
            // light/dark menu bar). Bundled via tauri.conf.json resources.
            // Falls back to the full-color app icon if tray.png is missing.
            let tray_icon = app
                .path()
                .resource_dir()
                .ok()
                .map(|d| d.join("icons/tray.png"))
                .and_then(|p| tauri::image::Image::from_path(p).ok())
                .or_else(|| app.default_window_icon().cloned());
            if let Some(icon) = tray_icon {
                tray = tray.icon(icon).icon_as_template(true);
            }
            tray.build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running WhimprFlow");
}
