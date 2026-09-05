//! Spawns and talks to the local-LLM cleanup worker (a separate process, so
//! llama.cpp and whisper.cpp never link into the same binary). One JSON request
//! per line over stdio: `{system,user}` -> `{text}`.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::time::Duration;

/// Longest a single cleanup may take before the worker is declared hung and
/// killed. A 4B model on Metal handles a 20-minute dictation well inside this;
/// without a bound a stuck worker left the finalize thread (and the Fn key)
/// waiting forever.
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(60);

pub struct LocalWorker {
    child: Child,
    stdin: ChildStdin,
    /// Response lines, delivered by a reader thread so a wait can time out.
    lines: Receiver<String>,
}

impl LocalWorker {
    pub fn spawn(worker_bin: &Path, model: &Path) -> anyhow::Result<Self> {
        let mut child = Command::new(worker_bin)
            .arg(model)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow::anyhow!("no stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow::anyhow!("no stdout"))?;
        let (tx, lines) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if tx.send(line).is_err() {
                    break;
                }
            }
            // stdout closed: the worker exited. Dropping `tx` makes the next
            // `recv_timeout` return Disconnected, which reads as "worker closed".
        });
        Ok(Self { child, stdin, lines })
    }

    /// Whether the worker process has exited (crashed, or was killed after a
    /// timeout). A dead worker is dropped by the caller and respawned.
    pub fn is_dead(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(Some(_)) | Err(_))
    }

    /// Send one cleanup request (system prompt + few-shot turns + transcript) and
    /// read the response (blocks until the line comes).
    pub fn cleanup(
        &mut self,
        messages: &[whimpr_core::cleanup::CleanupMsg],
    ) -> anyhow::Result<String> {
        // Size the output budget to the transcript, so a long dictation is not
        // truncated mid-sentence with its last words dropped (Publik Test 2:
        // "sometimes the last few words I say are cut off … because of the
        // cleanup"). The cleaned text is about as long as what was said, and the
        // real transcript is the LAST message (the few-shot turns come before
        // it); ~4 chars/token, doubled for reformatting headroom, floored at 400
        // so a short dictation is unchanged and fast.
        let transcript_chars = messages.last().map(|m| m.content.chars().count()).unwrap_or(0);
        let max_tokens = (transcript_chars / 2).max(400);
        let req = serde_json::json!({ "messages": messages, "max_tokens": max_tokens });
        let mut line = serde_json::to_string(&req)?;
        line.push('\n');
        self.stdin.write_all(line.as_bytes())?;
        self.stdin.flush()?;

        let resp = match self.lines.recv_timeout(CLEANUP_TIMEOUT) {
            Ok(line) => line,
            Err(RecvTimeoutError::Disconnected) => anyhow::bail!("local worker closed"),
            Err(RecvTimeoutError::Timeout) => {
                // Kill it rather than leave a wedged process holding the GPU; the
                // caller sees it as dead and spawns a fresh one.
                let _ = self.child.kill();
                anyhow::bail!("local worker timed out after {}s", CLEANUP_TIMEOUT.as_secs());
            }
        };
        let v: serde_json::Value = serde_json::from_str(&resp)?;
        if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
            anyhow::bail!("local llm: {err}");
        }
        Ok(v.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string())
    }
}

impl Drop for LocalWorker {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

/// Platform application-support dir: `~/Library/Application Support/WhimprFlow`
/// on macOS, `%APPDATA%\WhimprFlow` on Windows.
fn app_support_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var("APPDATA").unwrap_or_default();
        PathBuf::from(base).join("WhimprFlow")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join("Library/Application Support/WhimprFlow")
    }
}

/// Find the worker binary next to the app executable. That is where Tauri puts
/// an `externalBin` inside the bundle (`Contents/MacOS/`), and where `dev.sh`
/// builds it for `tauri dev` (`target/debug/`, the same dir as the dev binary).
pub fn worker_bin_path() -> Option<PathBuf> {
    let exe_name = if cfg!(target_os = "windows") {
        "whimpr-llm-worker.exe"
    } else {
        "whimpr-llm-worker"
    };
    let exe = std::env::current_exe().ok()?;
    let cand = exe.parent()?.join(exe_name);
    cand.exists().then_some(cand)
}

/// The local cleanup model path (same models dir as whisper/ASR). Prefer the
/// larger, much more capable Qwen3-4B if present (far better at
/// self-corrections and structure than the 1.5B); fall back to the 1.5B otherwise.
pub fn model_path() -> PathBuf {
    let dir = app_support_dir().join("models");
    for name in [
        "qwen3-4b-instruct-2507-q4_k_m.gguf",
        "qwen2.5-1.5b-instruct-q4_k_m.gguf",
    ] {
        let p = dir.join(name);
        if p.exists() {
            return p;
        }
    }
    dir.join("qwen2.5-1.5b-instruct-q4_k_m.gguf")
}

/// Spawn the worker if both the binary and the model are present.
pub fn spawn_default() -> Option<LocalWorker> {
    let bin = worker_bin_path()?;
    let model = model_path();
    if !model.exists() {
        eprintln!("[whimpr] local model not found at {}", model.display());
        return None;
    }
    match LocalWorker::spawn(&bin, &model) {
        Ok(w) => {
            eprintln!("[whimpr] local LLM worker started ({})", bin.display());
            Some(w)
        }
        Err(e) => {
            eprintln!("[whimpr] local LLM worker failed to start: {e}");
            None
        }
    }
}
