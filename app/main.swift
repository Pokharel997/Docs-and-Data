import Cocoa
import UniformTypeIdentifiers
import WebKit

/// Web view that hands dropped files/folders to the app (so they keep their path and can be saved in place).
final class DropWebView: WKWebView {
    var onFileDrop: (([URL]) -> Void)?

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self],
                                                         options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
        if !urls.isEmpty { onFileDrop?(urls); return true }
        return super.performDragOperation(sender)
    }
}

enum Files {
    static let skipDirs: Set<String> = ["node_modules", "__pycache__", ".git"]
    static let maxFiles = 20000

    static func isDirectory(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true
    }

    /// Lists every regular file below `root` (hidden files and bulky tool folders skipped).
    static func list(_ root: URL) -> [String: Any] {
        var files: [[String: Any]] = []
        let rootPath = root.standardizedFileURL.path
        let keys: [URLResourceKey] = [.isDirectoryKey, .isRegularFileKey, .fileSizeKey]
        if let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys,
                                                       options: [.skipsHiddenFiles, .skipsPackageDescendants]) {
            for case let url as URL in walker {
                let values = try? url.resourceValues(forKeys: Set(keys))
                if values?.isDirectory == true {
                    if skipDirs.contains(url.lastPathComponent) { walker.skipDescendants() }
                    continue
                }
                guard values?.isRegularFile == true else { continue }
                let path = url.standardizedFileURL.path
                let rel = path.hasPrefix(rootPath + "/") ? String(path.dropFirst(rootPath.count + 1)) : url.lastPathComponent
                files.append(["rel": rel, "path": path, "size": values?.fileSize ?? 0])
                if files.count >= maxFiles { break }
            }
        }
        return ["name": root.lastPathComponent, "path": rootPath, "files": files]
    }

    static func readText(_ url: URL) throws -> String {
        let data = try Data(contentsOf: url)
        return String(data: data, encoding: .utf8)
            ?? String(data: data, encoding: .windowsCP1252)
            ?? String(decoding: data, as: UTF8.self)
    }

    /// Copies the current version of a file to ~/Library/Application Support/Data & Docs/Backups/<date>/ before it is overwritten.
    static func backup(_ url: URL) {
        guard FileManager.default.fileExists(atPath: url.path),
              let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return }
        let day = DateFormatter(), time = DateFormatter()
        day.dateFormat = "yyyy-MM-dd"; time.dateFormat = "HHmmss"
        let now = Date()
        let dir = support.appendingPathComponent("Data & Docs/Backups/\(day.string(from: now))", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let base = url.deletingPathExtension().lastPathComponent, ext = url.pathExtension
        let dest = dir.appendingPathComponent("\(base) \(time.string(from: now))" + (ext.isEmpty ? "" : ".\(ext)"))
        try? FileManager.default.copyItem(at: url, to: dest)
    }

    static func stat(_ path: String) -> [String: Any]? {
        guard let a = try? FileManager.default.attributesOfItem(atPath: path) else { return nil }
        let mtime = (a[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
        return ["mtime": Int(mtime * 1000), "size": (a[.size] as? NSNumber)?.intValue ?? 0]
    }

    /// Converts .doc / .rtf / .odt (anything Cocoa's text system reads) into .docx bytes.
    static func convertToDocx(_ url: URL) throws -> Data {
        let text = try NSAttributedString(url: url, options: [:], documentAttributes: nil)
        return try text.data(from: NSRange(location: 0, length: text.length),
                             documentAttributes: [.documentType: NSAttributedString.DocumentType.officeOpenXML])
    }
}

/// Native messaging helper for the browser extension. Chrome/Edge/Brave start this same executable with the
/// extension's origin as an argument and exchange 4-byte-length-prefixed JSON over stdin/stdout:
///   {"cmd":"ping"} · {"cmd":"open","paths":[…]} (no paths: just start the app)
///   {"cmd":"save","name":"x.csv","data":<base64>} → ~/Documents/Data & Docs/x.csv, opened in the app
enum NativeHost {
    static let name = "com.datadocs.host"
    static let origin = "chrome-extension://cigokpbknkfmhhhinjnejdabdfefbgeb/"

    static var isHostLaunch: Bool { CommandLine.arguments.dropFirst().contains { $0.hasPrefix("chrome-extension://") } }

    static func run() -> Never {
        let input = FileHandle.standardInput
        while true {
            let header = input.readData(ofLength: 4)
            guard header.count == 4 else { exit(0) }
            let length = header.withUnsafeBytes { Int(UInt32(littleEndian: $0.loadUnaligned(as: UInt32.self))) }
            var body = Data()
            while body.count < length {
                let chunk = input.readData(ofLength: length - body.count)
                if chunk.isEmpty { exit(0) }
                body.append(chunk)
            }
            let reply: [String: Any]
            do {
                guard let msg = try JSONSerialization.jsonObject(with: body) as? [String: Any] else { throw HostError("Bad message") }
                reply = try handle(msg)
            } catch {
                reply = ["ok": false, "error": (error as? HostError)?.message ?? error.localizedDescription]
            }
            let out = (try? JSONSerialization.data(withJSONObject: reply)) ?? Data("{}".utf8)
            var len = UInt32(out.count).littleEndian
            FileHandle.standardOutput.write(Data(bytes: &len, count: 4) + out)
        }
    }

    struct HostError: Error { let message: String; init(_ m: String) { message = m } }

    static func handle(_ msg: [String: Any]) throws -> [String: Any] {
        switch msg["cmd"] as? String ?? "" {
        case "ping":
            return ["ok": true, "app": "Data & Docs",
                    "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1"]
        case "open":
            let asked = msg["paths"] as? [String] ?? []
            let paths = asked.filter { FileManager.default.fileExists(atPath: $0) }
            if !asked.isEmpty && paths.isEmpty { throw HostError("File not found") }
            try launch(paths)
            return ["ok": true]
        case "save":
            guard let data = Data(base64Encoded: msg["data"] as? String ?? "") else { throw HostError("Nothing to save") }
            let dir = inboxDir()
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = uniqueURL(in: dir, name: msg["name"] as? String ?? "Untitled")
            try data.write(to: url)
            try launch([url.path])
            return ["ok": true, "path": url.path]
        case let other:
            throw HostError("Unknown command \(other)")
        }
    }

    /// ~/Documents/Data & Docs — where files handed over from the browser are kept.
    static func inboxDir() -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser
        return docs.appendingPathComponent("Data & Docs", isDirectory: true)
    }

    static func uniqueURL(in dir: URL, name: String) -> URL {
        var clean = name.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
        if clean.trimmingCharacters(in: .whitespaces).isEmpty || clean == "." || clean == ".." { clean = "Untitled" }
        let first = dir.appendingPathComponent(clean)
        if !FileManager.default.fileExists(atPath: first.path) { return first }
        let base = (clean as NSString).deletingPathExtension, ext = (clean as NSString).pathExtension
        for n in 2... {
            let url = dir.appendingPathComponent("\(base) (\(n))" + (ext.isEmpty ? "" : ".\(ext)"))
            if !FileManager.default.fileExists(atPath: url.path) { return url }
        }
        return first
    }

    /// Starts the app (or hands the files to the running one) through Launch Services.
    static func launch(_ paths: [String]) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        p.arguments = ["-a", Bundle.main.bundleURL.path] + paths
        p.standardInput = FileHandle.nullDevice
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try p.run()
        p.waitUntilExit()
        if p.terminationStatus != 0 { throw HostError("Could not start Data & Docs") }
    }

    /// Registers the helper with every Chromium-based browser that is installed.
    static func installManifests() {
        guard let exe = Bundle.main.executablePath,
              let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return }
        let manifest: [String: Any] = ["name": name, "description": "Data & Docs — opens files from the browser extension",
                                       "path": exe, "type": "stdio", "allowed_origins": [origin]]
        guard let data = try? JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]) else { return }
        for browser in ["Google/Chrome", "Google/Chrome Beta", "Google/Chrome Canary", "Chromium",
                        "BraveSoftware/Brave-Browser", "Microsoft Edge", "Vivaldi", "Arc/User Data"] {
            let base = support.appendingPathComponent(browser, isDirectory: true)
            guard FileManager.default.fileExists(atPath: base.path) else { continue }
            let dir = base.appendingPathComponent("NativeMessagingHosts", isDirectory: true)
            let file = dir.appendingPathComponent("\(name).json")
            if (try? Data(contentsOf: file)) == data { continue }
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try? data.write(to: file)
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate,
                         WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: DropWebView!
    private var titleObserver: NSKeyValueObservation?
    private var pageLoaded = false
    private var pendingURLs: [URL] = []
    private var discardConfirmed = false
    private let appName = "Data & Docs"

    // MARK: - App lifecycle

    func applicationWillFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.global(qos: .utility).async { NativeHost.installManifests() } // lets the browser extension reach this app
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        // datadocs://open?path=/a.csv&path=/b.docx — links from the browser extension when its helper isn't set up
        let files = urls.flatMap { url -> [URL] in
            guard url.scheme == "datadocs" else { return [url] }
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            return items.filter { $0.name == "path" }.compactMap { $0.value }
                .filter { FileManager.default.fileExists(atPath: $0) }.map { URL(fileURLWithPath: $0) }
        }
        open(files)
        if files.isEmpty { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if discardConfirmed { return .terminateNow }
        confirmDiscard { ok in
            self.discardConfirmed = ok
            NSApp.reply(toApplicationShouldTerminate: ok)
        }
        return .terminateLater
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if discardConfirmed { return true }
        confirmDiscard { ok in
            if ok { self.discardConfirmed = true; self.window.close() }
        }
        return false
    }

    // MARK: - Window

    private func buildWindow() {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "native")
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.isElementFullscreenEnabled = true

        webView = DropWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.isInspectable = true
        webView.allowsMagnification = true
        webView.onFileDrop = { [weak self] urls in self?.open(urls) }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = appName
        window.minSize = NSSize(width: 720, height: 420)
        window.contentView = webView
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()
        window.setFrameAutosaveName("MainWindow")

        titleObserver = webView.observe(\.title) { [weak self] webView, _ in
            let title = webView.title ?? ""
            Task { @MainActor in self?.window.title = title.isEmpty ? "Data & Docs" : title }
        }

        let page = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web")!
        // Read access to the whole disk so <video src="file://…"> works for videos anywhere.
        webView.loadFileURL(page, allowingReadAccessTo: URL(fileURLWithPath: "/"))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !pageLoaded else { return }
        pageLoaded = true
        let urls = pendingURLs
        pendingURLs = []
        open(urls)
    }

    // Links clicked in documents open in the default browser, never inside the app window.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        if action.targetFrame?.isMainFrame != false, let url = action.request.url, !url.isFileURL,
           url.scheme != "about", url.scheme != "blob", url.scheme != "data" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    // MARK: - Opening files

    private func open(_ urls: [URL]) {
        guard pageLoaded else { pendingURLs += urls; return }
        var files: [[String: String]] = []
        for url in urls {
            if Files.isDirectory(url) {
                let folder = Files.list(url)
                webView.callAsyncJavaScript("openFolderFromNative(folder)", arguments: ["folder": folder],
                                            in: nil, in: .page, completionHandler: nil)
            } else {
                files.append(["name": url.lastPathComponent, "path": url.standardizedFileURL.path])
            }
            NSDocumentController.shared.noteNewRecentDocumentURL(url)
        }
        if !files.isEmpty {
            webView.callAsyncJavaScript("openFromNative(files)", arguments: ["files": files],
                                        in: nil, in: .page, completionHandler: nil)
        }
        if !urls.isEmpty { window.makeKeyAndOrderFront(nil) }
    }

    // MARK: - JS bridge

    private func reply(_ req: Int, _ result: Any?, _ error: String? = nil) {
        webView.callAsyncJavaScript("nativeReply(req, result, error)",
                                    arguments: ["req": req, "result": result ?? NSNull(), "error": error ?? NSNull()],
                                    in: nil, in: .page, completionHandler: nil)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let msg = message.body as? [String: Any], let cmd = msg["cmd"] as? String else { return }
        let req = msg["req"] as? Int ?? 0
        switch cmd {
        case "pickFiles": pickFiles(req, mediaOnly: (msg["kind"] as? String) == "media")
        case "pickFolder": pickFolder(req)
        case "listFolder":
            let path = msg["path"] as? String ?? ""
            DispatchQueue.global(qos: .userInitiated).async {
                let result = Files.list(URL(fileURLWithPath: path))
                DispatchQueue.main.async { self.reply(req, result) }
            }
        case "read": read(req, path: msg["path"] as? String ?? "", as: msg["as"] as? String ?? "text")
        case "save": save(req, msg)
        case "openURL":
            if let s = msg["url"] as? String, let url = URL(string: s) { NSWorkspace.shared.open(url) }
        case "print": printPage(nil)
        case "ready": reply(req, nil)  // files waiting for the page are opened when it finishes loading
        case "stat":
            let path = msg["path"] as? String ?? ""
            if let info = Files.stat(path) { reply(req, info) } else { reply(req, nil, "File not found") }
        case "create":
            let url = URL(fileURLWithPath: msg["path"] as? String ?? "")
            if FileManager.default.fileExists(atPath: url.path) { reply(req, nil, "\(url.lastPathComponent) already exists"); break }
            let data = Data(base64Encoded: msg["content"] as? String ?? "") ?? Data()
            do { try data.write(to: url, options: .withoutOverwriting); reply(req, ["path": url.path]) }
            catch { reply(req, nil, error.localizedDescription) }
        case "rename":
            let src = URL(fileURLWithPath: msg["path"] as? String ?? "")
            let dest = src.deletingLastPathComponent().appendingPathComponent(msg["name"] as? String ?? "")
            if FileManager.default.fileExists(atPath: dest.path) { reply(req, nil, "\(dest.lastPathComponent) already exists"); break }
            do { try FileManager.default.moveItem(at: src, to: dest); reply(req, ["path": dest.path]) }
            catch { reply(req, nil, error.localizedDescription) }
        case "trash":
            do { try FileManager.default.trashItem(at: URL(fileURLWithPath: msg["path"] as? String ?? ""), resultingItemURL: nil); reply(req, true) }
            catch { reply(req, nil, error.localizedDescription) }
        case "reveal":
            if let p = msg["path"] as? String { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p)]) }
        default: reply(req, nil, "Unknown command \(cmd)")
        }
    }

    private func pickFiles(_ req: Int, mediaOnly: Bool) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = !mediaOnly
        if mediaOnly { panel.allowedContentTypes = [.movie, .video, .audio] }
        panel.message = mediaOnly ? "Choose videos or audio to play" : "Choose files (or a folder) to open"
        panel.beginSheetModal(for: window) { response in
            guard response == .OK else { self.reply(req, []); return }
            let dirs = panel.urls.filter(Files.isDirectory)
            if !dirs.isEmpty { self.open(dirs) }
            let files = panel.urls.filter { !Files.isDirectory($0) }
            files.forEach { NSDocumentController.shared.noteNewRecentDocumentURL($0) }
            self.reply(req, files.map { ["name": $0.lastPathComponent, "path": $0.standardizedFileURL.path] })
        }
    }

    private func pickFolder(_ req: Int) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.message = "Choose a folder to browse in the sidebar"
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else { self.reply(req, nil); return }
            NSDocumentController.shared.noteNewRecentDocumentURL(url)
            DispatchQueue.global(qos: .userInitiated).async {
                let result = Files.list(url)
                DispatchQueue.main.async { self.reply(req, result) }
            }
        }
    }

    private func read(_ req: Int, path: String, as mode: String) {
        let url = URL(fileURLWithPath: path)
        DispatchQueue.global(qos: .userInitiated).async {
            let result: Result<String, Error> = Result {
                switch mode {
                case "text": return try Files.readText(url)
                case "docx": return try Files.convertToDocx(url).base64EncodedString()
                default: return try Data(contentsOf: url).base64EncodedString()
                }
            }
            DispatchQueue.main.async {
                switch result {
                case .success(let value): self.reply(req, value)
                case .failure(let error): self.reply(req, nil, error.localizedDescription)
                }
            }
        }
    }

    private func save(_ req: Int, _ msg: [String: Any]) {
        let content = msg["content"] as? String ?? ""
        let data: Data? = (msg["encoding"] as? String) == "base64"
            ? Data(base64Encoded: content) : content.data(using: .utf8)
        guard let data else { reply(req, nil, "Nothing to save"); return }
        if let path = msg["path"] as? String, !path.isEmpty {
            if msg["backup"] as? Bool == true { Files.backup(URL(fileURLWithPath: path)) }
            write(data, to: URL(fileURLWithPath: path), req: req)
            return
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = msg["name"] as? String ?? "Untitled"
        panel.canCreateDirectories = true
        let backup = msg["backup"] as? Bool == true
        panel.beginSheetModal(for: window) { response in
            if response == .OK, let url = panel.url {
                if backup { Files.backup(url) }
                self.write(data, to: url, req: req)
            } else { self.reply(req, nil) }
        }
    }

    private func write(_ data: Data, to url: URL, req: Int) {
        do {
            try data.write(to: url, options: .atomic)
            NSDocumentController.shared.noteNewRecentDocumentURL(url)
            reply(req, ["path": url.path, "name": url.lastPathComponent])
        } catch {
            reply(req, nil, error.localizedDescription)
        }
    }

    // MARK: - Menu actions

    @objc func openDocument(_ sender: Any?) { js("appCmd.open()") }
    @objc func openFolder(_ sender: Any?) { js("appCmd.openFolder()") }
    @objc func openVideo(_ sender: Any?) { js("appCmd.openVideo()") }
    @objc func newTab(_ sender: Any?) { js("appCmd.newTab()") }
    @objc func newSheet(_ sender: Any?) { js("appCmd.newFile('csv')") }
    @objc func newDoc(_ sender: Any?) { js("appCmd.newFile('doc')") }
    @objc func newJSON(_ sender: Any?) { js("appCmd.newFile('json')") }
    @objc func saveDocument(_ sender: Any?) { js("appCmd.save()") }
    @objc func saveDocumentAs(_ sender: Any?) { js("appCmd.saveAs()") }
    @objc func exportMenu(_ sender: Any?) { js("appCmd.exportMenu()") }
    @objc func sendToGoogle(_ sender: Any?) { js("appCmd.google()") }
    @objc func findInTab(_ sender: Any?) { js("appCmd.find()") }
    @objc func nextTab(_ sender: Any?) { js("appCmd.nextTab(1)") }
    @objc func previousTab(_ sender: Any?) { js("appCmd.nextTab(-1)") }
    @objc func toggleSidebar(_ sender: Any?) { js("appCmd.toggleSidebar()") }
    @objc func undoEdit(_ sender: Any?) { js("appCmd.undo()") }
    @objc func redoEdit(_ sender: Any?) { js("appCmd.redo()") }
    @objc func findNext(_ sender: Any?) { js("appCmd.findNext()") }
    @objc func showPalette(_ sender: Any?) { js("appCmd.palette()") }
    @objc func sideBySide(_ sender: Any?) { js("appCmd.split()") }
    @objc func cycleTheme(_ sender: Any?) { js("appCmd.theme()") }
    @objc func showSettings(_ sender: Any?) { js("appCmd.settings()") }
    @objc func newWorkbook(_ sender: Any?) { js("appCmd.newFile('xlsx')") }
    @objc func newMarkdown(_ sender: Any?) { js("appCmd.newFile('md')") }

    @objc func printPage(_ sender: Any?) {
        let info = NSPrintInfo.shared
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.topMargin = 36; info.bottomMargin = 36; info.leftMargin = 36; info.rightMargin = 36
        let op = webView.printOperation(with: info)
        op.view?.frame = webView.bounds
        op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }

    @objc func closeTab(_ sender: Any?) {
        webView.evaluateJavaScript("appCmd.closeTab()") { result, _ in
            if (result as? Int) == -1 { self.window.performClose(nil) }  // only an empty new tab was left
        }
    }

    @objc func makeDefault(_ sender: Any?) {
        let types: [UTType] = [.commaSeparatedText, .tabSeparatedText, .json] +
            ["org.openxmlformats.wordprocessingml.document"].compactMap { UTType($0) }
        let app = Bundle.main.bundleURL
        let group = DispatchGroup()
        var failure: Error?
        for type in types {
            group.enter()
            NSWorkspace.shared.setDefaultApplication(at: app, toOpen: type) { error in
                if let error { failure = error }
                group.leave()
            }
        }
        group.notify(queue: .main) {
            if let failure { self.showError(failure); return }
            self.js("toast('Data & Docs now opens .csv, .tsv, .json and .docx files')")
        }
    }

    // MARK: - JS dialogs (alert / confirm / prompt) and helpers

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        alert.beginSheetModal(for: window) {
            completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil)
        }
    }

    /// Unsaved work isn't lost on quit: the page stores open tabs and drafts, and reopens them on the next launch.
    private func confirmDiscard(_ done: @escaping (Bool) -> Void) {
        webView.callAsyncJavaScript("await appCmd.flushSession(); return appCmd.dirtyCount();", arguments: [:],
                                    in: nil, in: .page) { _ in done(true) }
    }

    private func js(_ source: String) { webView.evaluateJavaScript(source, completionHandler: nil) }

    private func showError(_ error: Error) {
        NSAlert(error: error).beginSheetModal(for: window, completionHandler: nil)
    }

    // MARK: - Menu bar

    private func buildMenu() {
        let main = NSMenu()
        func submenu(_ title: String) -> NSMenu {
            let menu = NSMenu(title: title)
            main.addItem(withTitle: title, action: nil, keyEquivalent: "").submenu = menu
            return menu
        }
        @discardableResult
        func add(_ menu: NSMenu, _ title: String, _ action: Selector?, _ key: String = "",
                 _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = mods
            return item
        }

        let app = submenu(appName)
        add(app, "About \(appName)", #selector(NSApplication.orderFrontStandardAboutPanel(_:)))
        app.addItem(.separator())
        add(app, "Settings…", #selector(showSettings(_:)), ",")
        add(app, "Make Default for CSV, JSON & Word Files", #selector(makeDefault(_:)))
        app.addItem(.separator())
        add(app, "Hide \(appName)", #selector(NSApplication.hide(_:)), "h")
        add(app, "Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option])
        add(app, "Show All", #selector(NSApplication.unhideAllApplications(_:)))
        app.addItem(.separator())
        add(app, "Quit \(appName)", #selector(NSApplication.terminate(_:)), "q")

        let file = submenu("File")
        add(file, "New Tab", #selector(newTab(_:)), "t")
        add(file, "New Spreadsheet", #selector(newSheet(_:)), "n")
        add(file, "New Document", #selector(newDoc(_:)), "n", [.command, .option])
        add(file, "New Excel Workbook", #selector(newWorkbook(_:)))
        add(file, "New JSON", #selector(newJSON(_:)))
        add(file, "New Markdown Note", #selector(newMarkdown(_:)))
        file.addItem(.separator())
        add(file, "Open…", #selector(openDocument(_:)), "o")
        add(file, "Open Folder…", #selector(openFolder(_:)), "O")
        add(file, "Open Video…", #selector(openVideo(_:)))
        file.addItem(.separator())
        add(file, "Save", #selector(saveDocument(_:)), "s")
        add(file, "Save As…", #selector(saveDocumentAs(_:)), "S")
        add(file, "Convert / Export…", #selector(exportMenu(_:)), "e")
        add(file, "Open in Google Docs / Sheets", #selector(sendToGoogle(_:)), "G")
        add(file, "Print…", #selector(printPage(_:)), "p")
        file.addItem(.separator())
        add(file, "Close Tab", #selector(closeTab(_:)), "w")

        let edit = submenu("Edit")
        add(edit, "Undo", #selector(undoEdit(_:)), "z")
        add(edit, "Redo", #selector(redoEdit(_:)), "Z")
        edit.addItem(.separator())
        add(edit, "Cut", #selector(NSText.cut(_:)), "x")
        add(edit, "Copy", #selector(NSText.copy(_:)), "c")
        add(edit, "Paste", #selector(NSText.paste(_:)), "v")
        add(edit, "Select All", #selector(NSText.selectAll(_:)), "a")
        edit.addItem(.separator())
        add(edit, "Find & Replace…", #selector(findInTab(_:)), "f")
        add(edit, "Find Next", #selector(findNext(_:)), "g")

        let view = submenu("View")
        add(view, "Command Palette…", #selector(showPalette(_:)), "k")
        add(view, "Toggle Sidebar", #selector(toggleSidebar(_:)), "\\")
        add(view, "Side by Side…", #selector(sideBySide(_:)), "\\", [.command, .option])
        add(view, "Switch Theme (System / Light / Dark)", #selector(cycleTheme(_:)), "d", [.command, .shift])
        add(view, "Next Tab", #selector(nextTab(_:)), "]", [.command, .shift])
        add(view, "Previous Tab", #selector(previousTab(_:)), "[", [.command, .shift])
        view.addItem(.separator())
        add(view, "Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])

        let windowMenu = submenu("Window")
        add(windowMenu, "Minimize", #selector(NSWindow.performMiniaturize(_:)), "m")
        add(windowMenu, "Zoom", #selector(NSWindow.performZoom(_:)))
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = main
    }
}

if NativeHost.isHostLaunch { NativeHost.run() }

let app = NSApplication.shared
let delegate = MainActor.assumeIsolated { AppDelegate() }
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
