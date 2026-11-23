//! Disk helpers shared by the app and the browser-extension helper.
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const SKIP_DIRS: [&str; 3] = ["node_modules", "__pycache__", ".git"];
const MAX_FILES: usize = 20000;

fn name_of(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.to_string_lossy().into_owned())
}

/// Every regular file below `root` (hidden files and bulky tool folders skipped).
pub fn list(root: &Path) -> Value {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut files = Vec::new();
    let mut stack = vec![root.clone()];
    'walk: while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries.into_iter().rev() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') { continue; }
            let Ok(ft) = e.file_type() else { continue };
            let path = e.path();
            if ft.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) { stack.push(path); }
            } else if ft.is_file() {
                let rel = path.strip_prefix(&root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or(name);
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                files.push(json!({ "rel": rel, "path": path.to_string_lossy(), "size": size }));
                if files.len() >= MAX_FILES { break 'walk; }
            }
        }
    }
    json!({ "name": name_of(&root), "path": root.to_string_lossy(), "files": files })
}

pub fn read_text(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(err)?;
    Ok(match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => encoding_rs::WINDOWS_1252.decode(e.as_bytes()).0.into_owned(),
    })
}

/// .doc / .rtf / .odt → .docx through LibreOffice, when it is installed.
pub fn convert_to_docx(path: &Path) -> Result<Vec<u8>, String> {
    let out = std::env::temp_dir().join(format!("datadocs-convert-{}", std::process::id()));
    let _ = fs::create_dir_all(&out);
    let mut last = String::from("Install LibreOffice to open this kind of document");
    for exe in ["soffice", "libreoffice"] {
        match std::process::Command::new(exe)
            .args(["--headless", "--convert-to", "docx", "--outdir"])
            .arg(&out).arg(path)
            .output()
        {
            Ok(o) if o.status.success() => {
                let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                let file = out.join(format!("{stem}.docx"));
                let data = fs::read(&file).map_err(err);
                let _ = fs::remove_file(&file);
                return data;
            }
            Ok(o) => last = String::from_utf8_lossy(&o.stderr).trim().to_string(),
            Err(_) => {}
        }
    }
    Err(last)
}

pub fn stat(path: &Path) -> Option<Value> {
    let m = fs::metadata(path).ok()?;
    let mtime = m.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64;
    Some(json!({ "mtime": mtime, "size": m.len() }))
}

/// Writes through a temporary file in the same folder, so a crash never leaves half a file.
pub fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let dir = path.parent().unwrap_or(Path::new("."));
    let tmp = dir.join(format!(".{}.datadocs-tmp", name_of(path)));
    fs::write(&tmp, data).map_err(err)?;
    if let Ok(meta) = fs::metadata(path) { let _ = fs::set_permissions(&tmp, meta.permissions()); }
    fs::rename(&tmp, path).map_err(|e| { let _ = fs::remove_file(&tmp); err(e) })
}

/// Copies the current version into <backups>/<date>/<name HHMMSS.ext> before it is overwritten.
pub fn backup(path: &Path, backups: &Path) {
    if !path.is_file() { return; }
    let now = chrono::Local::now();
    let dir = backups.join(now.format("%Y-%m-%d").to_string());
    if fs::create_dir_all(&dir).is_err() { return; }
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let _ = fs::copy(path, dir.join(format!("{stem} {}{ext}", now.format("%H%M%S"))));
}

/// `name`, or `name (2).ext`, `name (3).ext`… — the first that doesn't exist in `dir`.
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let clean: String = name.chars().map(|c| if matches!(c, '/' | '\\' | '\0') { '_' } else { c }).collect();
    let clean = if clean.trim().is_empty() || clean == "." || clean == ".." { "Untitled".into() } else { clean };
    let first = dir.join(&clean);
    if !first.exists() { return first; }
    let p = Path::new(&clean);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap()
}

/// Where files handed over from the browser are kept: ~/Documents/Docs & Data
pub fn inbox_dir() -> PathBuf {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let docs = home.join("Documents");
    (if docs.is_dir() { docs } else { home }).join("Docs & Data")
}

/// Paths from command-line style arguments: plain paths, file:// URLs and datadocs://open?path=… links.
pub fn paths_from_args<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for a in args {
        if a.starts_with('-') || a.starts_with("chrome-extension://") { continue; }
        if let Some(rest) = a.strip_prefix("datadocs://") {
            let query = rest.split_once('?').map(|(_, q)| q).unwrap_or("");
            for pair in query.split('&') {
                if let Some(v) = pair.strip_prefix("path=") {
                    let v = v.replace('+', " ");
                    out.push(PathBuf::from(percent_encoding::percent_decode_str(&v).decode_utf8_lossy().into_owned()));
                }
            }
            continue;
        }
        if let Some(rest) = a.strip_prefix("file://") {
            let rest = rest.strip_prefix("localhost").unwrap_or(rest);
            out.push(PathBuf::from(percent_encoding::percent_decode_str(rest).decode_utf8_lossy().into_owned()));
            continue;
        }
        let p = PathBuf::from(&a);
        out.push(if p.is_absolute() { p } else { cwd.join(p) });
    }
    out.into_iter().filter(|p| p.exists()).collect()
}

pub fn err<E: std::fmt::Display>(e: E) -> String { e.to_string() }
