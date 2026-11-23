# Data & Docs

Tabbed app for spreadsheets, Word documents, JSON, Markdown and other text files, PDFs and videos, with whole-folder browsing. Successor to CSV Editor.

## Desktop app vs. browser extension

| | Desktop app (macOS, Linux, Windows) | Browser extension (Chrome, Edge, Brave, Vivaldi, Arc) |
|---|---|---|
| Role | Editor: changes and saves files on disk | Viewer: opens files and folders in browser tabs |
| Opens | Files, folders, drag & drop, “Open with”, `datadocs://` links | `file://` links and folders, link right-click menu, finished downloads, its New tab page |
| Editing | Yes, saves into the original file (with backups) | **Edit in app** hands the file to the desktop app |

**Edit in app**:
- A local file (`file://…`) opens in the app as-is, so saving there changes the original.
- Anything else (web files, files picked in the extension) is first saved to `~/Documents/Data & Docs/`, then opened in the app.
- The extension reaches the app through a native messaging helper, which is the app binary itself (`com.datadocs.host`). The app registers the helper with every installed Chromium-based browser each time it starts, so open the desktop app once after installing it.
- Without the helper, the extension falls back to a `datadocs://open?path=…` link. Files that aren't on disk are then saved to `Downloads/Data & Docs/` first.

## File types

| Kind | Extensions | What you can do |
|---|---|---|
| Spreadsheets | `.csv` `.tsv` `.xlsx` `.jsonl` `.ndjson` | Edit cells, sort, filter, find & replace, sheets (Excel), charts, statistics |
| Documents | `.docx` (+ `.doc` `.rtf` `.odt` in the Mac app) | Formatted editing, saves real `.docx`; export Markdown, HTML, text, PDF |
| JSON | `.json` `.geojson` | Validate, format, tree view, queries like `users[?age>30].email` |
| Text | `.md` (live preview), `.html` (preview), `.xml` `.yaml` (tree view, convert to JSON), `.txt` `.log` `.srt` `.vtt`… | Find & replace, convert |
| Media | video, audio, images, `.pdf` | Subtitles (`.srt`/`.vtt` next to the video load automatically), A–B repeat, save frame, resume where you stopped |

Not supported: Parquet, SQLite, PowerPoint, EPUB, old `.xls`.

## Features

- **Tabs**: drag to reorder, right-click for rename / compare / side by side / close others. `＋` opens the New tab page.
- **Side by side** (◫ in the tab bar): two tabs at once; click a pane to work in it.
- **Folders**: sidebar tree with a name filter, **In files** search across file contents, and right-click actions: new file, rename, delete (Mac: to Trash), Show in Finder.
- **Spreadsheet tools**:
  - Column ▾ menu: sort, filter (`text`, `=x`, `>10`, `empty`), statistics, chart, remove duplicates, split into tabs or sheets, insert/delete columns.
  - Range selection: drag or Shift+click. Copy/paste blocks to and from Excel or Google Sheets. Delete clears the selection, and the status bar shows sum and average.
  - Tools menu: append rows from another file, save as Excel/CSV/TSV/JSON/JSONL.
- **Find & replace** (⌘F / Ctrl+F) in every editor. Enter or ⌘G jumps to the next match.
- **Compare** two open tabs line by line (right-click a tab → Compare with…).
- **Charts**: bar or line, grouped by any column (count / sum / average / largest / smallest). Hover for values. Save as PNG/SVG or put into a document.
- **Session restore**: open tabs, folders, the side-by-side layout and unsaved edits come back on the next launch.
- **Changed on disk**: files edited by another app reload automatically, or ask first if you have unsaved changes.
- **Command palette** (⌘K / Ctrl+K): every command, export, open tab and folder file.
- **Dark mode**: Settings → Theme (system / light / dark).
- **Backups** (desktop apps): the previous version is copied to `Backups/<date>/` in the app data folder on every save (Mac: `~/Library/Application Support/Data & Docs/`, Linux: `~/.local/share/com.pokharel.datadocs/`). Turn it off in Settings.
- **Google Docs / Sheets**: copies the content and opens a new Google file; paste with ⌘V. Optional one-click Drive upload with your own OAuth client ID (Settings), when served over http(s).

## Run

- **Browser**: open `web/index.html`, or serve it with `cd web && python3 -m http.server 8000`. Chrome and Edge can save back into the original files and folders. Other browsers download a copy.
- **macOS app**: `bash app/build.sh --install` → `/Applications/Data & Docs.app`.
- **Linux / Windows app** (Tauri):
  - On Linux, install the build libraries first: `libwebkit2gtk-4.1-dev librsvg2-dev patchelf`.
  - Then `cd linux && npm install && npm run build` → `.deb`, `.rpm` and `.AppImage` (Linux) or `.msi` and `.exe` (Windows) in `linux/src-tauri/target/release/bundle/`.
  - `.github/workflows/desktop.yml` builds all of these on GitHub: push a `v*` tag or run it by hand.
  - `.doc`, `.rtf` and `.odt` need LibreOffice on Linux.
- **Extension**:
  - Build it with `bash extension/build.sh`.
  - Go to `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose `extension/dist`.
  - In the extension's **Details**, turn on **Allow access to file URLs**. Local files and folders need it.
  - `--zip` also makes `extension/data-docs-extension.zip`.

The web code has no dependencies. The `.docx`, `.xlsx`, zip, Markdown and YAML code is built in (`web/*.js`).

Extension notes:
- Its ID is fixed by the `key` in `extension/manifest.json` (`cigokpbknkfmhhhinjnejdabdfefbgeb`), and the helper only answers that ID. A Chrome Web Store upload gets a different ID: add it to `allowed_origins` in `NativeHost`/`host.rs`.
- It replaces the browser's New tab page.
- It asks for access to a website only the first time you open a file from that site.
- Browsers installed as Flatpak or Snap can't start native helpers. With those, the `datadocs://` fallback is used.
- Firefox isn't supported.

## Shortcuts

| | Mac app | Browser |
|---|---|---|
| Command palette | ⌘K | Ctrl/⌘+K |
| New tab / close tab | ⌘T / ⌘W | Alt+T / Alt+W |
| Open / open folder | ⌘O / ⇧⌘O | Ctrl/⌘+O / +Shift |
| Save / save as | ⌘S / ⇧⌘S | Ctrl/⌘+S / +Shift |
| Find & replace / next match | ⌘F / ⌘G | Ctrl/⌘+F / Ctrl/⌘+G |
| Next / previous tab | ⇧⌘] / ⇧⌘[ | Alt+→ / Alt+← |
| Sidebar / side by side | ⌘\ / ⌥⌘\ | Ctrl/⌘+\ |
| Theme | ⇧⌘D | palette → Theme |

## Code layout

- `web/host.js`: platform layer (mac / linux / browser / extension).
- `web/core.js`: tabs, files, saving, folders, commands.
- `web/views.js`: editors, charts, compare.
- `web/extras.js`: session, palette, settings.
- `web/ext.js`: extension viewer ↔ desktop app.
- `web/docx.js`, `web/xlsx.js`, `web/zip.js`, `web/formats.js`: file formats.
- `app/main.swift`: macOS app and its extension helper.
- `linux/src-tauri/src/`: Linux/Windows app (`main.rs`), disk helpers (`files.rs`), extension helper (`host.rs`).
- `extension/`: manifest, background worker (file:// links, context menu, downloads), build script.
