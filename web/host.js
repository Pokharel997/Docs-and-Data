'use strict';
// Platform layer. The same page runs in four places:
//   mac       – the macOS app (WKWebView, messages via webkit.messageHandlers)       → full editor, saves to disk
//   linux     – the Linux/Windows app (Tauri, messages via invoke('native'))         → full editor, saves to disk
//   browser   – a normal web page (File System Access API / downloads)               → full editor
//   extension – the browser extension (new tab page, file:// links)                  → viewer; editing hands off to the desktop app
const Host = (() => {
  const mac = window.webkit?.messageHandlers?.native;
  const tauri = window.__TAURI__?.core;
  const isExt = location.protocol === 'chrome-extension:' && !!window.chrome?.runtime?.id;
  const kind = mac ? 'mac' : tauri ? 'linux' : isExt ? 'extension' : 'browser';
  const desktop = kind === 'mac' || kind === 'linux';

  let seq = 0;
  const pending = new Map();
  // the Mac app answers asynchronously through window.nativeReply(req, result, error)
  window.nativeReply = (req, result, error) => {
    const p = pending.get(req);
    if (!p) return;
    pending.delete(req);
    error ? p.reject(new Error(error)) : p.resolve(result);
  };
  function call(cmd, args = {}) {
    if (tauri) return tauri.invoke('native', { msg: { ...args, cmd } }).catch(e => { throw new Error(String(e?.message || e)); });
    if (mac) {
      return new Promise((resolve, reject) => {
        const req = ++seq;
        pending.set(req, { resolve, reject });
        mac.postMessage({ ...args, cmd, req });
      });
    }
    return Promise.reject(new Error('This needs the Data & Docs desktop app'));
  }
  // fire-and-forget
  const post = msg => { call(msg.cmd, msg).catch(() => {}); };

  return {
    kind, desktop,
    viewer: kind === 'extension',
    call, post,
    // URL the web view can play/show for a file on disk
    mediaURL: path => tauri ? tauri.convertFileSrc(path) : 'file://' + path.split('/').map(encodeURIComponent).join('/'),
    fileManager: kind === 'mac' ? 'Finder' : 'file manager',
  };
})();
const VIEWER = Host.viewer;
document.documentElement.classList.toggle('viewer', VIEWER);
document.documentElement.dataset.host = Host.kind;
