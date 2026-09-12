# Run WhimprFlow in development on Windows. Mirrors dev.sh:
# builds the local-LLM worker (tauri dev only builds the app crate), then starts
# the Vite UI server + the app with hot reload.
#
# Portable: locates the MSVC build environment via vswhere (no hardcoded VS
# paths), runs the LLVM/clang preflight check, and auto-discovers the documented
# libclang side-load if LIBCLANG_PATH isn't already set.
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

# 0. Preflight: LLVM/clang version guard (see docs/BUILD-PREREQUISITES.md).
#    bindgen 0.69 (pinned by whisper-rs-sys) breaks on clang/LLVM newer than 18.
Write-Host "[dev] preflight: LLVM/clang check..."
node scripts/check-build-prereqs.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 1. Import the MSVC build environment so cargo can link with cl/link.exe.
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (!(Test-Path $vswhere)) {
    Write-Error "vswhere not found. Install Visual Studio Build Tools (Desktop development with C++)."
    exit 1
}
$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vsPath) {
    Write-Error "No Visual Studio installation with C++ build tools found."
    exit 1
}
$vcvars = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"
if (!(Test-Path $vcvars)) {
    Write-Error "vcvars64.bat not found under $vsPath"
    exit 1
}
$envSnap = & "$env:ComSpec" /c "`"$vcvars`" >nul 2>&1 && set"
foreach ($line in $envSnap) {
    if ($line -match '^([^=]+)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}
# VS ships its own CMake/Ninja; make them available for llama-cpp-2's build.
$cmakeRoot = Join-Path $vsPath "Common7\IDE\CommonExtensions\Microsoft\CMake"
foreach ($extra in @("CMake\bin", "Ninja")) {
    $p = Join-Path $cmakeRoot $extra
    if (Test-Path $p) { $env:PATH = "$p;$env:PATH" }
}
Write-Host "[dev] MSVC env imported from $vsPath"

# 2. libclang for bindgen. LIBCLANG_PATH set by the user wins; otherwise fall
#    back to the documented side-load from `pip install libclang==18.1.1`
#    (docs/BUILD-PREREQUISITES.md). The package can import as `clang` or
#    `libclang` depending on the pip version; probe both.
if ([string]::IsNullOrEmpty($env:LIBCLANG_PATH) -and (Get-Command python -ErrorAction SilentlyContinue)) {
    foreach ($mod in @("clang", "libclang")) {
        $native = (& python -c "import $mod, os; print(os.path.dirname($mod.__file__) + r'\native')" 2>$null | Select-Object -First 1)
        if ($native -and (Test-Path (Join-Path $native "libclang.dll"))) {
            $env:LIBCLANG_PATH = $native
            Write-Host "[dev] LIBCLANG_PATH -> $native"
            break
        }
    }
}

# 3. Build the worker, then stage it so tauri-build's externalBin check passes.
#    At runtime the dev app finds the copy next to it in target/debug
#    (see local_llm::worker_bin_path).
Write-Host "[dev] building the local-LLM worker..."
cargo build -p whimpr-llm-worker
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$triple = (rustc -vV | Select-String "host: ").ToString().Split(" ", 2)[1]
New-Item -ItemType Directory -Force -Path src-tauri\binaries | Out-Null
Copy-Item "target\debug\whimpr-llm-worker.exe" "src-tauri\binaries\whimpr-llm-worker-$triple.exe" -Force
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 4. Start Vite + the app with hot reload.
Write-Host "[dev] starting tauri dev..."
& .\ui\node_modules\.bin\tauri.cmd dev $args
exit $LASTEXITCODE