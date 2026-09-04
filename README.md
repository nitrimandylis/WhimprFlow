# WhimprFlow

A **local-first, cross-platform voice dictation app** — hold a key, speak, and clean text lands wherever your cursor is. Speech is transcribed on-device with Whisper and cleaned up (filler removal, self-corrections, punctuation, lists/newlines) by a local LLM, with an optional cloud path. It re-creates the workflow of a Wispr-Flow-style dictation tool from scratch, with its own name, palette, and code.

> ⚠️ **This is a proof of concept, vibe-coded in a few hours.** It works and the core loop is real, but it is rough and needs a lot of polish, testing, and hardening before it's anything like production quality. Treat it as a starting point, not a finished product.

---

## About this fork

A polished fork of [`Blueturboguy07/WhimprFlow`](https://github.com/Blueturboguy07/WhimprFlow),
merging the best community PRs into a single working build for daily use on macOS.

**What's new over upstream:**
- Multi-language dictation (Greek, Spanish, etc. transcribed to English or native)
- Configurable push-to-talk key (Fn/Globe, right Cmd/Opt/Ctrl)
- Dock visibility toggle (menu-bar-only or Dock app)
- Overlay pill visible on all Spaces and full-screen apps
- Pill hidden at idle, correct placement on multi-monitor/mixed-DPI setups
- Working Flow Bar buttons (Cancel/Stop were dead in upstream)
- Accessibility self-heal after rebuilds (no more stale TCC grants)
- API key saving fix, settings debounce, single-instance guard
- "Next line" no longer eats words from ordinary speech
- Local LLM cleanup worker properly bundled
- Dark/light theming, GSAP motion, new app icon
- Shortcuts pane with conflict detection
- Snippets, Transforms, Style, Scratchpad panes
- Launch at login, audio cues, copy-from-history

**Scope:** macOS on Apple Silicon. Windows will not build without further work.

### Credits

Built on the work of the original creator and the open-source community:

- [**Blueturboguy07**](https://github.com/Blueturboguy07) — original WhimprFlow
- [**patelvraj810**](https://github.com/patelvraj810) (PR #4) — dock toggle, pill fixes, multi-lang ASR, push-to-talk config, Snippets/Transforms/Style/Scratchpad
- [**ch1kim0n1**](https://github.com/ch1kim0n1) (PR #2) — dark/light theming, GSAP motion, app icon, shortcuts pane
- PR #6 author — key saving fix, settings debounce, single-instance guard, cloud STT
- PR #8 author — layout-cue word deletion fix
- PR #9 author — accessibility self-heal, pill hiding, cleanup worker wiring

---

## Platform status

| Platform | Status |
|----------|--------|
| **macOS 14+** | **Built and working** — developed and tested locally (Apple Silicon). |
| **Windows 10/11** | **Built and working** — compiles and runs on real Windows 11 (MSVC), including a packaged NSIS installer (`tauri build`). Push-to-talk (hold **Right Ctrl**), Whisper ASR, clipboard+`SendInput` paste, and cloud cleanup (OpenAI or any OpenAI-compatible API, e.g. OpenRouter) are verified end-to-end. Auto-learn dictionary capture is still macOS-only; the local (on-device) LLM cleanup worker builds but is CPU-only for now (no CUDA/Vulkan yet), and only runs at all when Cleanup Engine is set to **Local** — cloud modes never load it. |

Both platforms build from source — there's no signed/notarized release pipeline yet (the Windows installer and macOS `.app` are unsigned), so `git clone` + the steps below is the way to run it on either OS.

---

## What's in it

- **On-device ASR** — Whisper (via `whisper.cpp`), running on the GPU. Ships a small English model by default; larger models are auto-preferred if present.
- **Local LLM cleanup** — Qwen3-4B-Instruct (via `llama.cpp`) runs as a separate worker process and cleans the transcript: removes fillers, resolves spoken self-corrections ("meet at 2… no wait, 3" → "3"), applies spoken punctuation, and formats lists/paragraphs. Deterministic gates guard against over-editing, with a raw-transcript fallback.
- **Floating pill UI** — an always-on-top bar that appears only while WhimprFlow is working (recording, cleaning up, the done flash, or an error) and disappears the moment it's idle, so it never sits on your screen at rest.
- **Personal dictionary + auto-learn** — teach it names and terms; on macOS a post-paste Accessibility observer watches for a one-word correction and learns it automatically (conservative filters to avoid junk). *Auto-learn capture is macOS-only so far.*
- **Usage stats** — words dictated, words-per-minute, day streak, time saved, 7-day activity, all stored locally.

## Architecture

Tauri v2 (Rust core + React/TypeScript webviews). Platform-agnostic logic lives in `crates/whimpr-core` (state machine, cleanup prompts/gates, dictionary, stats). ASR, audio, and the LLM worker are separate crates. The Tauri app in `src-tauri/` hosts the UI and wires the native hotkey/injection per platform (`hotkey.rs` on macOS, `win.rs` on Windows).

```
crates/
  whimpr-core/       state machine, cleanup (prompts/gates/levels), dictionary, stats
  whimpr-asr/        Whisper ASR
  whimpr-audio/      mic capture + resampling
  whimpr-cleanup/    OpenAI / Anthropic cloud providers
  whimpr-llm-worker/ local llama.cpp cleanup worker (separate process)
src-tauri/           Tauri shell: hotkey/paste/autolearn (macOS), win.rs (Windows)
ui/                  React Hub + overlay pill
docs/                spec, architecture notes, research
```

## Build (macOS)

Requires Rust (stable), Node + pnpm, and the Xcode command-line tools.

```bash
cd ui && pnpm install && cd ..
# If pnpm reports [ERR_PNPM_IGNORED_BUILDS] (esbuild's postinstall was
# skipped), this is a one-time, harmless-if-not-needed insurance step:
pnpm --dir ui approve-builds --all
# Dev:
./dev.sh
# Or a signed .app bundle — build ONLY via `tauri build`; a bare `cargo
# build` + manual codesign will NOT bundle the UI and can drop TCC grants:
ui/node_modules/.bin/tauri build --bundles app
```

Models are **not** committed (they're multi-GB) — see **[docs/MODELS.md](docs/MODELS.md)**
for the exact file + download link (short version: `ggml-base.en.bin` is
required, a Qwen GGUF for local/offline cleanup is optional).

## Build (Windows)

Requires Rust (stable, MSVC toolchain), [CMake](https://cmake.org/download/), the
**Visual Studio Build Tools** (Desktop development with C++ workload), Node + pnpm,
and **LLVM 18.1.x specifically** (not "latest" — see
**[docs/BUILD-PREREQUISITES.md](docs/BUILD-PREREQUISITES.md)**, this is the #1
first-build failure on Windows). Verify your toolchain before building:

```powershell
node scripts/check-build-prereqs.mjs
```

> ⚠️ **Pin LLVM to the 17.x–18.x range.** `whisper-rs-sys`'s pinned `bindgen` (0.69)
> doesn't handle the struct layout `libclang` emits on LLVM 19+ — it silently generates
> opaque zero-field structs instead of erroring, so the build fails deep inside
> `whisper-rs` with `no field ... on type whisper_full_params` (`available field: _address`).
> If you hit that, uninstall LLVM and reinstall a 17.x/18.x release
> (`winget install --id LLVM.LLVM --version 17.0.6`), then `cargo clean -p whisper-rs-sys`
> to drop the stale bindings before rebuilding.

```powershell
cd ui; pnpm install; cd ..
# If pnpm reports [ERR_PNPM_IGNORED_BUILDS] (esbuild's postinstall was
# skipped), this is a one-time, harmless-if-not-needed insurance step:
pnpm --dir ui approve-builds --all
# Dev (starts the Vite UI server + the app with hot reload):
ui\node_modules\.bin\tauri.CMD dev
# Or a release build — this produces an NSIS installer (.exe) on Windows:
ui\node_modules\.bin\tauri.CMD build
```

Place models under `%APPDATA%\WhimprFlow\models\` — see
**[docs/MODELS.md](docs/MODELS.md)** for the exact file + download link
(short version: `ggml-base.en.bin` is required, a Qwen GGUF for local/offline
cleanup is optional). No local LLM model?
Set Cleanup Engine to **OpenAI** in the Hub's Settings pane and point the base URL at
any OpenAI-compatible API — for example `https://openrouter.ai/api/v1` for
[OpenRouter](https://openrouter.ai), with your OpenRouter key pasted into the
"OpenAI API key" field.

Push-to-talk defaults to **Right Ctrl** (hold to record, release to paste) — the
Windows analogue of Wispr Flow's own `Ctrl+Win` default; a configurable hotkey is
planned but not wired up yet.

The Windows GPU backend for Whisper/llama.cpp is CPU-only for now (the macOS build
uses Metal); CUDA/Vulkan feature flags can be added in `crates/whimpr-asr/Cargo.toml`
and `crates/whimpr-llm-worker/Cargo.toml` for anyone wanting to pick that up.

## Troubleshooting: "I hold the key, speak, and nothing gets typed"

WhimprFlow now surfaces the exact reason on the pill and in the Hub instead of
failing silently (previously this only ever logged to a terminal, which is
why it looked like nothing was happening at all). If you still hit this:

- **macOS — Accessibility.** This is the #1 cause. Open **System Settings →
  Privacy & Security → Accessibility** and confirm WhimprFlow is toggled ON.
  The Hub's onboarding screen blocks you here on first launch; if you granted
  it once and it still doesn't work, especially after **rebuilding** the app,
  see the next point.
- **macOS — "granted but still nothing" after a rebuild.** Every local
  `tauri build` produces a differently-signed binary, and macOS can leave a
  stale Accessibility entry for the old signature that *looks* granted but
  isn't. WhimprFlow now heals this itself: on launch it clears any stale TCC
  entry for its bundle id, re-prompts, and opens **System Settings → Privacy &
  Security → Accessibility** — just enable WhimprFlow there (and if the Hub
  ever shows "Fn key isn't wired up" while the pane says it's on, click its
  **Fix Accessibility** button). No relaunch needed either way.
- **Windows — Right Ctrl does nothing.** Another app may be holding a
  conflicting global keyboard hook (some anti-cheat/security tools do this);
  close it and relaunch WhimprFlow.
- **No speech model.** See [docs/MODELS.md](docs/MODELS.md) — dictation needs
  a Whisper `ggml-*.bin` file placed by hand; the app doesn't download one for
  you.
- Still stuck? Run the app from a terminal (`./dev.sh` on macOS, or the built
  `.exe` from PowerShell on Windows) and hold the key once — every failure
  path also logs a `[whimpr]`-prefixed line explaining what happened.

## Notes & disclaimers

- **Not affiliated with, endorsed by, or connected to Wispr Flow or any other product.** WhimprFlow is an independent, from-scratch reimplementation of the dictation workflow, with its own name, branding, colors, strings, and code. No third-party code or assets are included.
- **Proof of concept.** Rushed, under-tested, and missing plenty (auto-learn is macOS-only and conservative, no installer/notarization/signing pipeline on either OS, error handling is thin). Contributions and fixes welcome.
- **Privacy.** ASR and default cleanup run on-device. Cloud cleanup is opt-in and only sends the transcript (not audio) to the provider you choose. API keys never touch disk in plaintext.

## License

MIT — see [LICENSE](LICENSE).
