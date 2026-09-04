fn main() {
    // Embed the short git hash for get_build_info.
    let hash = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_else(|| "dev".to_string());
    println!("cargo:rustc-env=GIT_HASH={}", hash.trim());
    tauri_build::build();
}
