# WhimprFlow

Local-first voice dictation for macOS. Hold a key, speak, release. Clean text lands at the cursor. Whisper runs on-device, a local Qwen model or a cloud API does the cleanup pass. No account, no telemetry.

Fork of Blueturboguy07/WhimprFlow, branch `nick/polished`, aimed at daily use rather than a demo.

## What it is

- Tauri v2 shell, Rust pipeline (audio, whisper.cpp, cleanup worker, paste), React UI.
- Two windows. The Hub is a native-looking utility: translucent sidebar, system font and accent, native controls. The pill is a dark always-on-top overlay that shows idle, recording, cleaning up, done.
- Hub pages: History, Insights, Dictionary, Style, Settings, Help. Onboarding gate for permissions and the speech model.
- Pill hover shows quick controls: microphone, language, cleanup engine, and a gear that opens Settings. Clicking the idle pill starts hands-free dictation.

## Decisions

- Native macOS conventions over a custom brand. Appearance follows the system by default, with a light or dark override applied at the window level so vibrancy and CSS agree.
- Plain CSS with classes, one stylesheet per window. No Tailwind, no CSS-in-JS.
- Native `<select>`, switch, slider, and text fields. No custom pickers.
- Motion is one short enter stagger per pane with GSAP, plus the pill's morph. Nothing ambient.
- The pill hover zone is the pill's own measured rect, reported from JS to Rust, never a slice of the overlay window.

## Where it is headed

- Pill hover restyle to match the Hub.
- Verify native switch and vibrancy rendering in the real Tauri window on macOS 14 and 15.
- Windows build is unverified and second priority.
