# Changes in this fork

Everything below is additive to upstream [`Blueturboguy07/WhimprFlow`](https://github.com/Blueturboguy07/WhimprFlow).
macOS (Apple Silicon) only — the Windows layer in `src-tauri/src/win.rs` has **not**
been updated and will need the same functions added before it compiles again.

---

## The Flow Bar (overlay pill)

**Placed against the screen's work area, not its full bounds.**
`position_overlay` used `monitor.size()` minus a fixed 40pt inset, which put the
pill underneath the Dock on any Mac with a bottom Dock. It now uses
`Monitor::work_area()`, which already excludes the Dock and menu bar.

**Correct geometry on mixed-DPI setups.** Tauri reports macOS displays in mixed
units — positions in logical points, sizes in physical pixels — and
`cursor_position()` arrives as logical × the *primary* display's scale. All of
that is now normalised to logical points in
`whimpr_core::settings::work_area_points`, with unit tests built from a real
three-display arrangement (2× built-in, plus 1× displays at x=1728 and x=4288).

**The overlay's size is a constant, not a measurement.** `outer_size()` returns
physical pixels for the display the window currently occupies. Dividing it by the
scale of the display being moved *to* halved it across a 1× → 2× boundary, and
parked the pill ~50pt under the Dock. Regression-tested.

**Follows the active display.** The pill moves to the bottom-centre of whichever
screen the pointer is on, and re-places itself when that screen's work area
changes — which is what happens when macOS moves the Dock to the display you're
using. It does not move while the pointer wanders within one screen.

**The buttons work.** `CancelButton` and `StopButton` were `<div>`s with no click
handlers. ✕ cancels, ■ stops and inserts, and both drive the same state machine
the hotkey does — Stop distinguishes a held dictation (needs a key release) from
a hands-free one (needs a tap).

**Hover reveals the controls.** The resting nub expands to show `Dictate fn` and
adds three buttons: language (cycles EN → हिं → ગુ → Auto), microphone (starts a
hands-free dictation), and scratchpad capture. The key hint reflects your actual
configured key. Click-versus-drag is resolved by hold duration, since a native
window drag seizes the mouse the moment it starts.

**Show/hide, offset, and manual placement** are exposed in Settings → Flow Bar.

## Dictation

**Multi-language.** `whimpr-asr` hardcoded `set_language(Some("en"))`. The
language is now a setting — 14 languages plus auto-detect — passed through to
whisper.cpp. Requires a multilingual model; `ggml-large-v3-turbo` is one.

**Configurable push-to-talk key.** Was hardcoded to keycode 63 (Fn). Now Fn/Globe,
Right ⌘, Right ⌥ or Right ⌃. Restricted to modifiers because the event tap only
subscribes to `flagsChanged`; binding a normal key would mean intercepting
typing. The binding lives in atomics so the tap never takes a lock.

**Microphone selection**, falling back to the system default if the chosen device
disappears.

**Audio cues.** `Action::PlayPing` was matched into a `_ => {}` catch-all, so the
"play a sound when recording starts" setting did nothing. There are now three
cues — start, inserted, cancelled.

## Cleanup

**Snippets.** Spoken triggers expand to stored text. Matching is
case-insensitive and whole-phrase, longest trigger first. Expansion runs *after*
the deterministic gates, because an expansion multiplies the text and the
over-deletion gate would otherwise reject the cleanup that produced it.

**Transforms.** Saying "make this an email", "summarise this", "make this a to-do
list", "make this bullet points" or "make this professional" at the *start* of a
dictation reshapes the whole utterance. Leading-position matching only, with a
word-boundary check. Transforms deliberately bypass the gates — those exist to
stop a cleanup model rewriting when it shouldn't, and a transform is asked to
rewrite.

**Style.** Free-text preferences appended to the cleanup and transform prompts.
This is *not* an automatically learned voice profile; it asks rather than infers.
Note that Light cleanup tells the model to leave text as spoken when unsure,
which overrides most style requests — Medium is where it takes effect.

**Scratchpad.** A capture toggle routes finished dictations into a Hub text area
instead of pasting them into the frontmost app. Persisted to disk; resets to off
on restart so dictations can't silently vanish.

## Hub

- **Copy button** on history rows, and the transcript text is selectable.
  Insertion restores the previous clipboard afterwards, so a dictation was
  otherwise unrecoverable if it landed nowhere.
- **The permission gate is no longer a hard block.** Settings, Dictionary and
  history need no permissions, but the "Enter" button was disabled until they
  were granted, making the whole app unreachable. There is now a Skip.
- **Accurate microphone guidance** plus a Quit & Reopen button: macOS resolves an
  app's microphone authorisation once at launch, so a grant made while running
  never turns the indicator green. The old copy claimed no relaunch was needed.
- Fixed a status poller that tore down and rebuilt its interval on every update.

## System

- **Launch at login**, via a LaunchAgent that runs `open -a`. Launching the
  executable directly makes macOS attribute permissions to the launching process
  rather than to WhimprFlow, and every grant then reads as denied.
- **Show/hide in the Dock** (accessory vs regular activation policy).

## Packaging

- **The LLM worker ships inside the bundle** as a Tauri sidecar. The installed app
  previously fell back to a hardcoded `~/WhimprFlow/target/release/...` path, so
  deleting the build folder silently disabled local cleanup with no error.
- `pnpm-workspace.yaml` gained `allowBuilds`, since pnpm v11 removed
  `onlyBuiltDependencies` and the install fails outright without it.
- Build scripts produce a `.dmg`, and a separate script builds a distributable
  package including the models.

## Tests

`cargo test -p whimpr-core` covers snippet matching, transform detection, and the
display geometry — 50+ tests. The build script runs them and refuses to package
if any fail.
