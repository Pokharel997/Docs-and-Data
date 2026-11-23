// Data & Docs for Linux (and Windows). Hosts ../web in a window and answers the page's
// `native` messages — the same protocol the macOS app (app/main.swift) speaks.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod files;
mod host;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, DragDropEvent, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct State {
    ready: bool,           // page loaded and asked for waiting files
    pending: Vec<PathBuf>, // files to open once it is
    quitting: bool,
}
type AppState = Mutex<State>;

fn window(app: &AppHandle) -> Option<WebviewWindow> { app.get_webview_window("main") }

/// Opens files as tabs and folders in the sidebar (queued until the page is ready).
fn open_paths(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() { return; }
    {
        let state = app.state::<AppState>();
        let mut s = state.lock().unwrap();
        if !s.ready { s.pending.extend(paths); return; }
    }
    let Some(win) = window(app) else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        let mut list = Vec::new();
        for p in paths {
            if p.is_dir() {
                let folder = files::list(&p);
                let _ = win.eval(&format!("openFolderFromNative({folder})"));
            } else {
                let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                list.push(json!({ "name": name, "path": p.to_string_lossy() }));
            }
        }
        if !list.is_empty() { let _ = win.eval(&format!("openFromNative({})", Value::from(list))); }
        let _ = win.unminimize();
        let _ = win.set_focus();
        drop(app);
    });
}

fn path_of(fp: tauri_plugin_dialog::FilePath) -> Option<PathBuf> { fp.into_path().ok() }

fn file_ref(p: &Path) -> Value {
    json!({ "name": p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), "path": p.to_string_lossy() })
}

fn backups_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("Data & Docs")).join("Backups")
}

/// Every request from the page: `{cmd, ...args}` → result or error message.
#[tauri::command]
async fn native(app: AppHandle, msg: Value) -> Result<Value, String> {
    let s = |k: &str| msg[k].as_str().unwrap_or("").to_string();
    let path = PathBuf::from(s("path"));
    let win = window(&app).ok_or("No window")?;
    match s("cmd").as_str() {
        "ready" => {
            let pending = {
                let state = app.state::<AppState>();
                let mut st = state.lock().unwrap();
                st.ready = true;
                std::mem::take(&mut st.pending)
            };
            open_paths(&app, pending);
            Ok(Value::Null)
        }
        "pickFiles" => {
            let mut dlg = app.dialog().file().set_parent(&win).set_title("Open files");
            if s("kind") == "media" {
                dlg = dlg.set_title("Choose videos or audio to play").add_filter("Video and audio",
                    &["mp4", "m4v", "webm", "mkv", "mov", "ogv", "avi", "mp3", "m4a", "wav", "ogg", "oga", "flac", "aac", "opus"]);
            }
            let picked = tauri::async_runtime::spawn_blocking(move || dlg.blocking_pick_files()).await.map_err(files::err)?;
            Ok(Value::from(picked.unwrap_or_default().into_iter().filter_map(path_of).map(|p| file_ref(&p)).collect::<Vec<_>>()))
        }
        "pickFolder" => {
            let dlg = app.dialog().file().set_parent(&win).set_title("Choose a folder to browse in the sidebar");
            let picked = tauri::async_runtime::spawn_blocking(move || dlg.blocking_pick_folder()).await.map_err(files::err)?;
            match picked.and_then(path_of) {
                Some(p) => Ok(tauri::async_runtime::spawn_blocking(move || files::list(&p)).await.map_err(files::err)?),
                None => Ok(Value::Null),
            }
        }
        "listFolder" => Ok(tauri::async_runtime::spawn_blocking(move || files::list(&path)).await.map_err(files::err)?),
        "read" => {
            let mode = s("as");
            tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
                Ok(Value::from(match mode.as_str() {
                    "text" => files::read_text(&path)?,
                    "docx" => B64.encode(files::convert_to_docx(&path)?),
                    _ => B64.encode(std::fs::read(&path).map_err(files::err)?),
                }))
            }).await.map_err(files::err)?
        }
        "save" => {
            let content = s("content");
            let data = if s("encoding") == "base64" { B64.decode(content).map_err(files::err)? } else { content.into_bytes() };
            let backup = msg["backup"].as_bool() == Some(true);
            let target = if path.as_os_str().is_empty() {
                let name = if s("name").is_empty() { "Untitled".to_string() } else { s("name") };
                let dlg = app.dialog().file().set_parent(&win).set_file_name(name);
                match tauri::async_runtime::spawn_blocking(move || dlg.blocking_save_file()).await.map_err(files::err)?.and_then(path_of) {
                    Some(p) => p,
                    None => return Ok(Value::Null), // cancelled
                }
            } else { path };
            if backup { files::backup(&target, &backups_dir(&app)); }
            files::write_atomic(&target, &data)?;
            Ok(file_ref(&target))
        }
        "stat" => files::stat(&path).ok_or_else(|| "File not found".to_string()),
        "create" => {
            if path.exists() { return Err(format!("{} already exists", path.display())); }
            std::fs::write(&path, B64.decode(s("content")).unwrap_or_default()).map_err(files::err)?;
            Ok(json!({ "path": path.to_string_lossy() }))
        }
        "rename" => {
            let dest = path.with_file_name(s("name"));
            if dest.exists() { return Err(format!("{} already exists", s("name"))); }
            std::fs::rename(&path, &dest).map_err(files::err)?;
            Ok(json!({ "path": dest.to_string_lossy() }))
        }
        "trash" => trash::delete(&path).map(|_| Value::Bool(true)).map_err(files::err),
        "reveal" => app.opener().reveal_item_in_dir(&path).map(|_| Value::Null).map_err(files::err),
        "openURL" => app.opener().open_url(s("url"), None::<&str>).map(|_| Value::Null).map_err(files::err),
        "print" => win.print().map(|_| Value::Null).map_err(files::err),
        "quit" => {
            app.state::<AppState>().lock().unwrap().quitting = true;
            app.exit(0);
            Ok(Value::Null)
        }
        other => Err(format!("Unknown command {other}")),
    }
}

/// Links inside documents open in the default browser instead of replacing the app.
fn allow_navigation(app: &AppHandle, url: &tauri::Url) -> bool {
    let local = matches!(url.scheme(), "tauri" | "asset" | "about" | "blob" | "data")
        || url.host_str().is_some_and(|h| h == "localhost" || h.ends_with(".localhost"));
    if !local { let _ = app.opener().open_url(url.as_str(), None::<&str>); }
    local
}

fn main() {
    if host::is_host_launch() { host::run(); return; }

    let cwd = std::env::current_dir().unwrap_or_default();
    let initial = files::paths_from_args(std::env::args().skip(1), &cwd);

    let app = tauri::Builder::default()
        // a second launch (file manager, extension, datadocs:// link) hands its files to this window
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = files::paths_from_args(argv.into_iter().skip(1), Path::new(&cwd));
            if paths.is_empty() {
                if let Some(w) = window(app) { let _ = w.unminimize(); let _ = w.set_focus(); }
            }
            open_paths(app, paths);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new(State { pending: initial, ..Default::default() }))
        .invoke_handler(tauri::generate_handler![native])
        .setup(|app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Data & Docs")
                .inner_size(1320.0, 860.0)
                .min_inner_size(720.0, 420.0)
                .on_navigation(move |url| allow_navigation(&handle, url))
                .build()?;

            // let the browser extension reach this app, and datadocs:// links open it
            std::thread::spawn(host::install_manifests);
            #[cfg(target_os = "linux")]
            if std::env::var_os("APPIMAGE").is_some() {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            Ok(())
        })
        .on_window_event(|win, event| match event {
            WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => open_paths(win.app_handle(), paths.clone()),
            // Unsaved work isn't lost: the page stores open tabs and drafts first, then asks to quit.
            WindowEvent::CloseRequested { api, .. } => {
                let app = win.app_handle().clone();
                if app.state::<AppState>().lock().unwrap().quitting { return; }
                api.prevent_close();
                let ok = window(&app).map(|w| w.eval(
                    "Promise.resolve(window.appCmd?.flushSession?.()).catch(() => {})\
                     .finally(() => window.__TAURI__.core.invoke('native', { msg: { cmd: 'quit' } }))",
                ).is_ok()).unwrap_or(false);
                if !ok { app.exit(0); return; }
                std::thread::spawn(move || { // the page didn't answer: quit anyway
                    std::thread::sleep(std::time::Duration::from_secs(4));
                    app.exit(0);
                });
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("failed to start Data & Docs");

    app.run(|_app, _event: RunEvent| {});
}
