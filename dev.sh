#!/bin/bash
# Run WhimprFlow in development: builds the local-LLM worker (tauri dev only
# builds the app crate), then starts the Vite UI server + the app with hot reload.
# The app loads its UI from the dev server, so the pill actually renders.
set -e
cd "$(dirname "$0")"
echo "[dev] building the local-LLM worker…"
cargo build -p whimpr-llm-worker
# tauri-build refuses to compile unless every externalBin exists for the host
# triple, so stage the worker there too. At runtime the dev app finds the copy
# sitting next to it in target/debug (see local_llm::worker_bin_path).
triple="$(rustc -vV | sed -n 's/^host: //p')"
mkdir -p src-tauri/binaries
cp "target/debug/whimpr-llm-worker" "src-tauri/binaries/whimpr-llm-worker-$triple"
exec ui/node_modules/.bin/tauri dev "$@"
