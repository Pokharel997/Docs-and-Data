//! Native messaging helper for the browser extension.
//!
//! Chrome/Edge/Brave start this same binary with the extension's origin as an argument
//! (`chrome-extension://<id>/`) and talk to it over stdin/stdout: every message is a
//! 4-byte little-endian length followed by that many bytes of JSON.
//!
//!   {"cmd":"ping"}                         → {"ok":true,"version":"…"}
//!   {"cmd":"open","paths":["/a.csv"]}      → opens the files in the app (no paths: just starts it)
//!   {"cmd":"save","name":"x.csv","data":b64} → writes ~/Documents/Data & Docs/x.csv, opens it in the app
use crate::files;
use base64::Engine;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::PathBuf;

#[allow(dead_code)]
pub const NAME: &str = "com.datadocs.host";
#[allow(dead_code)]
pub const EXTENSION_ORIGIN: &str = "chrome-extension://cigokpbknkfmhhhinjnejdabdfefbgeb/";

pub fn is_host_launch() -> bool {
    std::env::args().skip(1).any(|a| a.starts_with("chrome-extension://"))
}

/// The program to launch for the GUI (inside an AppImage the binary path is temporary, $APPIMAGE is not).
pub fn app_exe() -> PathBuf {
    std::env::var_os("APPIMAGE").map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
        .unwrap_or_else(|| PathBuf::from("data-docs"))
}

pub fn run() {
    let mut stdin = std::io::stdin().lock();
    loop {
        let mut len = [0u8; 4];
        if stdin.read_exact(&mut len).is_err() { return; }
        let len = u32::from_le_bytes(len) as usize;
        let mut buf = vec![0u8; len];
        if stdin.read_exact(&mut buf).is_err() { return; }
        let reply = match serde_json::from_slice::<Value>(&buf) {
            Ok(msg) => handle(&msg).unwrap_or_else(|e| json!({ "ok": false, "error": e })),
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        };
        if send(&reply).is_err() { return; }
    }
}

fn send(v: &Value) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(v)?;
    let mut out = std::io::stdout().lock();
    out.write_all(&(bytes.len() as u32).to_le_bytes())?;
    out.write_all(&bytes)?;
    out.flush()
}

fn handle(msg: &Value) -> Result<Value, String> {
    match msg["cmd"].as_str().unwrap_or("") {
        "ping" => Ok(json!({ "ok": true, "app": "Data & Docs", "version": env!("CARGO_PKG_VERSION") })),
        "open" => {
            let paths: Vec<PathBuf> = msg["paths"].as_array().into_iter().flatten()
                .filter_map(|p| p.as_str()).map(PathBuf::from).filter(|p| p.exists()).collect();
            let asked = msg["paths"].as_array().map_or(0, |a| a.len());
            if asked > 0 && paths.is_empty() { return Err("File not found".into()); }
            launch(&paths)?;
            Ok(json!({ "ok": true }))
        }
        "save" => {
            let data = base64::engine::general_purpose::STANDARD
                .decode(msg["data"].as_str().unwrap_or("")).map_err(files::err)?;
            let dir = files::inbox_dir();
            std::fs::create_dir_all(&dir).map_err(files::err)?;
            let path = files::unique_path(&dir, msg["name"].as_str().unwrap_or("Untitled"));
            std::fs::write(&path, data).map_err(files::err)?;
            launch(&[path.clone()])?;
            Ok(json!({ "ok": true, "path": path.to_string_lossy() }))
        }
        other => Err(format!("Unknown command {other}")),
    }
}

/// Starts the app (or hands the files to the running one), detached from the browser.
fn launch(paths: &[PathBuf]) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let mut cmd = Command::new(app_exe());
    cmd.args(paths).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0); // keep running when the browser closes the helper
    }
    cmd.spawn().map(|_| ()).map_err(files::err)
}

/// Registers the helper with every Chromium-based browser that is installed (Linux).
#[cfg(target_os = "linux")]
pub fn install_manifests() {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else { return };
    let config = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".config"));
    let manifest = json!({
        "name": NAME,
        "description": "Data & Docs — opens files from the browser extension",
        "path": app_exe().to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [EXTENSION_ORIGIN],
    });
    let text = serde_json::to_string_pretty(&manifest).unwrap_or_default();
    for browser in ["google-chrome", "google-chrome-beta", "google-chrome-unstable", "chromium",
                    "BraveSoftware/Brave-Browser", "microsoft-edge", "microsoft-edge-beta", "vivaldi", "opera"] {
        let base = config.join(browser);
        if !base.is_dir() { continue; }
        let dir = base.join("NativeMessagingHosts");
        let file = dir.join(format!("{NAME}.json"));
        if std::fs::read_to_string(&file).ok().as_deref() == Some(text.as_str()) { continue; }
        if std::fs::create_dir_all(&dir).is_ok() { let _ = std::fs::write(&file, &text); }
    }
}

#[cfg(not(target_os = "linux"))]
pub fn install_manifests() {}
