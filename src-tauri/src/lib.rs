//! WhimprFlow Tauri shell.
//!
//! Runs as a macOS menu-bar app: a tray item, a transparent always-on-top
//! Flow Bar overlay, and a hidden Hub window for settings, dictionary,
//! insights, and history.

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

/// Stamp of the most recent bar state pushed through `emit_flowbar_state`.
/// Delayed "back to idle" timers (the 500ms done tick, the 4.5s error linger)
/// compare against it and stand down if anything newer has been shown since —
/// otherwise a dictation started inside that window had its pill hidden.
static BAR_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn bar_gen() -> u64 {
    BAR_GEN.load(std::sync::atomic::Ordering::SeqCst)
}

/// The overlay's size in LOGICAL points — the same values it is built with.
///
/// Deliberately constants rather than reading `outer_size()`: that returns
/// physical pixels for whichever display the window is on *right now*, so
/// dividing it by the scale of the display we are moving TO gave a size that was
/// wrong by the ratio between them. Moving from a 1× screen to the 2× laptop
/// computed the pill as 160×70 instead of 320×132 and parked it under the Dock.
/// The window is not resizable, so its logical size never changes.
const OVERLAY_W_PT: f64 = 360.0;
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

/// Input device names for the microphone picker.
#[tauri::command]
fn list_microphones() -> Vec<String> {
    whimpr_audio::input_device_names()
}

/// The `.app` bundle this process is running from, if it is one (the bundle
/// path is the ancestor of `Contents/MacOS/<exe>`). `None` under `tauri dev`.
#[cfg(target_os = "macos")]
fn app_bundle_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bundle = exe.parent()?.parent()?.parent()?;
    (bundle.extension()? == "app").then(|| bundle.to_path_buf())
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
    // Point at the bundle actually running, so an install outside /Applications
    // still launches; fall back to the conventional location under `tauri dev`.
    let app = app_bundle_path()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "/Applications/WhimprFlow.app".to_string());
    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.whimpr.whimprflow</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/open</string>
        <string>-a</string>
        <string>{app}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"#
    );
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
///
/// The thread only keeps time; every display and window query runs on the main
/// thread, where AppKit requires them (the same class of crash the earlier
/// "dispatch window operations to main thread" fix addressed).
fn spawn_display_watcher(app: tauri::AppHandle) {
    // Name + work area of the display the pill was last placed on.
    static LAST_TARGET: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
    std::thread::spawn(move || loop {
        // Short enough that moving to another screen feels like the pill came
        // with you, rather than catching up a beat later.
        std::thread::sleep(std::time::Duration::from_millis(220));

        let settings = hotkey::current_settings();
        if !settings.pill_follows_active_display {
            continue;
        }
        let app_mt = app.clone();
        let _ = app.run_on_main_thread(move || {
            let Some(w) = app_mt.get_webview_window(OVERLAY_LABEL) else { return };
            let Some(monitor) = pill_monitor(&w, true) else { return };

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
            let mut last = LAST_TARGET.lock().unwrap();
            if last.as_deref() == Some(key.as_str()) {
                return;
            }
            let Some(want) = desired_overlay_position(&w, &settings) else { return };
            *last = Some(key.clone());
            let _ = w.set_position(want);
            eprintln!(
                "[whimpr] MOVE want logical({:.0},{:.0}) target[{}]",
                want.x, want.y, key
            );
        });
    });
}

/// The pill cluster's bounding box in logical points relative to the overlay
/// window's top-left, reported by FlowBar after every layout change. This is
/// the only hover hit-test: the overlay window is much larger than the pill
/// so its transparent area must never count as "over".
static PILL_HIT_RECT: std::sync::Mutex<Option<(f64, f64, f64, f64)>> = std::sync::Mutex::new(None);
/// While true the hover watcher never reports "left". FlowBar sets it while a
/// native `<select>` popup is open, since the cursor is then off the pill.
static PILL_HOVER_LOCK: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Slack around the resting nub so a 16pt-tall target isn't fussy.
const PILL_HIT_SLACK_PT: f64 = 4.0;

#[tauri::command]
fn set_pill_hit_rect(x: f64, y: f64, w: f64, h: f64) {
    *PILL_HIT_RECT.lock().unwrap() = Some((x, y, w, h));
}

#[tauri::command]
fn set_pill_hover_lock(locked: bool) {
    PILL_HOVER_LOCK.store(locked, std::sync::atomic::Ordering::SeqCst);
}

/// Show the Hub on its Settings page (the pill's gear button).
#[tauri::command]
fn open_hub_settings(app: tauri::AppHandle) {
    show_hub(&app);
    let _ = app.emit_to(HUB_LABEL, "whimpr://navigate", "settings");
}

/// Is the cursor inside the pill cluster's reported rect (plus slack)?
fn cursor_over_pill_zone(w: &WebviewWindow, app: &tauri::AppHandle) -> bool {
    let Some((rx, ry, rw, rh)) = *PILL_HIT_RECT.lock().unwrap() else { return false };
    let Ok(cursor) = app.cursor_position() else { return false };
    let Ok(pos) = w.outer_position() else { return false };
    let scale = w.scale_factor().unwrap_or(1.0);
    // Cursor and window position are physical pixels; the rect is logical.
    let cx = cursor.x / scale;
    let cy = cursor.y / scale;
    let wx = pos.x as f64 / scale;
    let wy = pos.y as f64 / scale;
    point_in_rect(cx - wx, cy - wy, (rx, ry, rw, rh), PILL_HIT_SLACK_PT)
}

/// `(px, py)` is the cursor in window-local logical points.
fn point_in_rect(px: f64, py: f64, (rx, ry, rw, rh): (f64, f64, f64, f64), slack: f64) -> bool {
    px >= rx - slack && px <= rx + rw + slack && py >= ry - slack && py <= ry + rh + slack
}

#[cfg(test)]
mod pill_hit_tests {
    use super::point_in_rect;

    #[test]
    fn nub_rect_only() {
        // Resting nub: 76x16 at the bottom centre of a 360x132 window.
        let nub = (142.0, 112.0, 76.0, 16.0);
        assert!(point_in_rect(180.0, 120.0, nub, 4.0));
        assert!(point_in_rect(139.0, 109.0, nub, 4.0)); // inside slack
        assert!(!point_in_rect(180.0, 60.0, nub, 4.0)); // transparent area above
        assert!(!point_in_rect(20.0, 120.0, nub, 4.0)); // far left, old 60% zone would say yes
    }
}

/// Track cursor over the pill zone. On enter, emit `whimpr://hover` true and
/// temporarily accept mouse events so the action buttons are clickable.
/// On exit, emit false and go back to click-through.
///
/// Same shape as the display watcher: the thread ticks, the main thread asks.
fn spawn_hover_watcher(app: tauri::AppHandle) {
    static WAS_OVER: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    use std::sync::atomic::Ordering;
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(60));
        let app_mt = app.clone();
        let _ = app.run_on_main_thread(move || {
            let Some(w) = app_mt.get_webview_window(OVERLAY_LABEL) else { return };
            let visible = w.is_visible().unwrap_or(false);
            let mut over = visible && cursor_over_pill_zone(&w, &app_mt);
            if PILL_HOVER_LOCK.load(Ordering::SeqCst) && WAS_OVER.load(Ordering::SeqCst) {
                over = true;
            }
            if over == WAS_OVER.swap(over, Ordering::SeqCst) {
                return;
            }
            let _ = app_mt.emit_to(OVERLAY_LABEL, "whimpr://hover", over);
            // Toggle click-through: off while hovering so buttons work,
            // back on when leaving so the pill never steals focus.
            #[cfg(target_os = "macos")]
            set_ignores_mouse(&w, !over);
        });
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
pub fn emit_flowbar_state(app: &tauri::AppHandle, state: &'static str) -> u64 {
    let gen = BAR_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    let _ = app.emit_to(OVERLAY_LABEL, "whimpr://flowbar/state", BarStatePayload { state });
    // Window show/hide/position must happen on the main thread (macOS AppKit).
    let app_mt = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = app_mt.get_webview_window(OVERLAY_LABEL) {
            if bar_visible(state) {
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
    });
    gen
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

/// Aggregated dictation stats for the Hub dashboard. `tz_offset_minutes` is the
/// browser's `Date.getTimezoneOffset()` so "today"/streak match the user's clock.
#[tauri::command]
fn get_stats(tz_offset_minutes: i32) -> whimpr_core::StatsSummary {
    hotkey::stats_summary(tz_offset_minutes)
}

/// Recent dictations for the Hub Home history list (newest first).
#[tauri::command]
fn get_history(limit: Option<usize>) -> Vec<whimpr_core::HistoryItem> {
    hotkey::history(limit.unwrap_or(200))
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

// ── Model download ──────────────────────────────────────────────────────────
/// Whether the speech model exists on disk. The frontend shows a download
/// step in onboarding when this returns false.
#[tauri::command]
fn check_model_status() -> bool {
    hotkey::model_path().exists()
}

/// Whether a model download is already running, so a second click (or a
/// second window) cannot start another writer on the same partial file.
static DOWNLOADING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Download the starter Whisper model (~148 MB). Emits
/// `whimpr://model/progress` events with { percent: u8 } so the UI can
/// show a progress bar. Runs on a background thread; returns immediately.
///
/// English gets `ggml-base.en.bin`, which is the more accurate of the two for
/// English. Any other language setting gets the multilingual `ggml-base.bin`:
/// the `.en` model ignores the language setting entirely, which made the
/// pill's language switch a no-op after onboarding.
#[tauri::command]
fn download_model(app: tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    if DOWNLOADING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let result = download_model_blocking(&app);
        DOWNLOADING.store(false, Ordering::SeqCst);
        match result {
            Ok(()) => {
                let _ = app.emit("whimpr://model/done", serde_json::json!({ "ok": true }));
                // Reload ASR now that the model exists.
                hotkey::rebuild_asr(&hotkey::current_settings());
            }
            Err(e) => {
                eprintln!("[whimpr] model download failed: {e}");
                let _ = app.emit("whimpr://model/done", serde_json::json!({ "ok": false, "error": e.to_string() }));
            }
        }
    });
}

fn download_model_blocking(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let dir = hotkey::models_dir();
    std::fs::create_dir_all(&dir)?;
    let name = if hotkey::current_settings().language == "en" {
        "ggml-base.en.bin"
    } else {
        "ggml-base.bin"
    };
    let dest = dir.join(name);
    if dest.exists() {
        let _ = app.emit("whimpr://model/progress", serde_json::json!({ "percent": 100 }));
        return Ok(());
    }
    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{name}");
    let tmp = dest.with_extension("bin.partial");
    let result = download_with_progress(&url, &tmp, app);
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result?;
    std::fs::rename(&tmp, &dest)?;
    Ok(())
}


fn download_with_progress(
    url: &str,
    dest: &std::path::Path,
    app: &tauri::AppHandle,
) -> anyhow::Result<()> {
    use std::io::Write;
    let resp = reqwest::blocking::get(url)?;
    let total = resp.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(dest)?;
    let mut downloaded: u64 = 0;
    let mut last_pct: u8 = 0;
    let mut reader = resp;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = std::io::Read::read(&mut reader, &mut buf)?;
        if n == 0 { break; }
        file.write_all(&buf[..n])?;
        downloaded += n as u64;
        if total > 0 {
            let pct = ((downloaded * 100) / total).min(99) as u8;
            if pct != last_pct {
                last_pct = pct;
                let _ = app.emit("whimpr://model/progress", serde_json::json!({ "percent": pct }));
            }
        }
    }
    file.flush()?;
    if total > 0 && downloaded != total {
        anyhow::bail!("download ended early: {downloaded} of {total} bytes");
    }
    let _ = app.emit("whimpr://model/progress", serde_json::json!({ "percent": 100 }));
    Ok(())
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
    /// A key saved specifically for cloud ASR (a Groq key, say). When absent,
    /// cloud ASR falls back to the OpenAI key.
    has_asr_key: bool,
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
        // Same readers the providers use, so the Hub never says "no key" while
        // requests go out with one from the environment.
        has_openai_key: hotkey::read_openai_key().is_some(),
        has_anthropic_key: hotkey::read_anthropic_key().is_some(),
        has_asr_key: keyring::Entry::new("com.whimpr.whimprflow", "asr_api_key")
            .ok()
            .and_then(|e| e.get_password().ok())
            .is_some_and(|k| !k.trim().is_empty()),
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
        "asr" => "asr_api_key",
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
    // Cloud ASR uses the ASR key, or the OpenAI key as fallback.
    if account != "anthropic_api_key" {
        hotkey::rebuild_asr(&hotkey::current_settings());
    }
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
            get_stats,
            get_history,
            copy_to_clipboard,
            restart_app,
            list_microphones,
            pill_cancel,
            pill_stop,
            pill_start,
            set_pill_position,
            reset_pill_position,
            set_pill_hit_rect,
            set_pill_hover_lock,
            open_hub_settings,
            check_model_status,
            download_model,
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
                    "demo_rec" => {
                        emit_flowbar_state(app, "recording");
                    }
                    "demo_idle" => {
                        emit_flowbar_state(app, "idle");
                    }
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
