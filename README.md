```
 ██╗    ██╗██╗  ██╗██╗███╗   ███╗██████╗ ██████╗ ███████╗██╗      ██████╗ ██╗    ██╗
 ██║    ██║██║  ██║██║████╗ ████║██╔══██╗██╔══██╗██╔════╝██║     ██╔═══██╗██║    ██║
 ██║ █╗ ██║███████║██║██╔████╔██║██████╔╝██████╔╝█████╗  ██║     ██║   ██║██║ █╗ ██║
 ██║███╗██║██╔══██║██║██║╚██╔╝██║██╔═══╝ ██╔══██╗██╔══╝  ██║     ██║   ██║██║███╗██║
 ╚███╔███╔╝██║  ██║██║██║ ╚═╝ ██║██║     ██║  ██║██║     ███████╗╚██████╔╝╚███╔███╔╝
  ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝
```

<div align="center">

### `HOLD A KEY // SPEAK // TEXT LANDS`

*local-first voice dictation that actually works, built on whisper.cpp and stubbornness*

![build](https://img.shields.io/badge/build-passing-44cc11?style=flat-square&labelColor=111111) ![platform](https://img.shields.io/badge/platform-macOS_14+-0891b2?style=flat-square&labelColor=111111) ![stack](https://img.shields.io/badge/stack-tauri_v2_%2B_rust_%2B_react-e2725b?style=flat-square&labelColor=111111) ![telemetry](https://img.shields.io/badge/telemetry-0-44cc11?style=flat-square&labelColor=111111) ![cloud](https://img.shields.io/badge/cloud-opt_in_only-0891b2?style=flat-square&labelColor=111111)

</div>

---

## 🎙️ What is this

WhimprFlow is a voice dictation app that runs entirely on your Mac. Hold a key, speak, release. Clean text appears wherever your cursor was. No account, no subscription, no audio leaving your machine (unless you want it to).

Speech recognition runs on-device via Whisper (GPU-accelerated on Apple Silicon). A local Qwen model handles the cleanup pass: filler removal, spoken self-corrections, punctuation, paragraph formatting. Or skip the local model and point it at OpenAI, Anthropic, or any OpenAI-compatible API. Your call.

This is a polished fork of [Blueturboguy07's original](https://github.com/Blueturboguy07/WhimprFlow), merging the best community contributions into one build that works out of the box. The original was a proof of concept built for a short-form video. This fork is for people who actually want to use it every day.

```console
nick@whimprflow:~$ fn (hold) → "schedule the meeting for thursday at three"
[✓] Schedule the meeting for Thursday at 3.
[i] 8 words. 0.4s cleanup. your fingers did nothing.
```

## 🧩 The dictation pipeline

| | feature | what it actually does |
|---|---|---|
| 01 | **on-device ASR** | whisper.cpp on Metal, transcribes speech without a network connection |
| 02 | **local LLM cleanup** | qwen 4B removes fillers, fixes "no wait" self-corrections, adds punctuation |
| 03 | **cloud cleanup** | optional: openai, anthropic, or any compatible API for the cleanup pass |
| 04 | **multi-language** | speak greek, get english text (or any of whisper's 99 languages) |
| 05 | **floating pill** | always-on-top overlay, visible on all Spaces, hidden when idle |
| 06 | **push-to-talk** | configurable: fn, right cmd, right opt, right ctrl |
| 07 | **auto-learn dictionary** | watches for one-word corrections after paste, learns names and terms |
| 08 | **dark/light theming** | follows system or manual toggle, no flash on launch |
| 09 | **dock toggle** | menu-bar-only mode or full dock app, your preference |
| 10 | **shortcuts pane** | rebindable keyboard shortcuts with live conflict detection |

## 🚀 Run it

Grab the unsigned DMG from [GitHub Actions artifacts](https://github.com/nitrimandylis/WhimprFlow/actions) (latest passing build on `nick/polished`), or build from source:

```bash
# prerequisites: rust (stable), node, pnpm, cmake, xcode cli tools
git clone https://github.com/nitrimandylis/WhimprFlow.git
cd WhimprFlow && git checkout nick/polished
cd ui && pnpm install && cd ..
./dev.sh
```

Download a Whisper model into `~/Library/Application Support/WhimprFlow/models/`. The `ggml-large-v3-turbo.bin` (1.5 GB) is the sweet spot for Apple Silicon. See [docs/MODELS.md](docs/MODELS.md) for download links.

First launch will ask for Accessibility and Microphone permissions. Grant both, hold Fn, talk.

## 🔩 Under the hood

```mermaid
flowchart LR
    A[hold Fn] --> B[mic capture]
    B --> C[whisper.cpp ASR]
    C --> D{cleanup engine}
    D -->|local| E[qwen via llama.cpp]
    D -->|cloud| F[openai / anthropic]
    D -->|none| G[raw transcript]
    E --> H[paste at cursor]
    F --> H
    G --> H
```

| layer | path | job |
|---|---|---|
| whimpr-core | `crates/whimpr-core/` | state machine, cleanup prompts and gates, dictionary, stats |
| whimpr-asr | `crates/whimpr-asr/` | whisper.cpp bindings, model loading |
| whimpr-audio | `crates/whimpr-audio/` | mic capture, resampling to 16kHz mono |
| whimpr-cleanup | `crates/whimpr-cleanup/` | openai and anthropic cloud providers |
| whimpr-llm-worker | `crates/whimpr-llm-worker/` | sidecar process running llama.cpp |
| tauri shell | `src-tauri/` | hotkey hook, paste injection, tray, permissions |
| hub + pill | `ui/` | react settings hub and overlay pill (two separate webviews) |

**Stack:** Tauri v2 · Rust · React · TypeScript · whisper.cpp · llama.cpp · Metal

## 🙏 Credits

| who | what |
|---|---|
| [**Blueturboguy07**](https://github.com/Blueturboguy07) | original whimprflow, the whole idea |
| [**patelvraj810**](https://github.com/patelvraj810) | PR #4: dock toggle, pill fixes, multi-lang, push-to-talk, new panes |
| [**ch1kim0n1**](https://github.com/ch1kim0n1) | PR #2: dark/light theming, GSAP motion, app icon, shortcuts pane |
| PR #6 author | key saving fix, settings debounce, single-instance guard |
| PR #8 author | layout-cue word deletion fix |
| PR #9 author | accessibility self-heal, pill hiding, cleanup worker wiring |

---

<div align="center">

**[Nick Trimandylis](https://github.com/nitrimandylis)**

`HOLD THE KEY, SAY THE THING, LET GO`

MIT licensed. Fork of [Blueturboguy07/WhimprFlow](https://github.com/Blueturboguy07/WhimprFlow).

</div>
