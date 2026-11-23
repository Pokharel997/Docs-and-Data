'use strict';
// Browser-extension side of the viewer (only loaded in the extension build, see extension/build.sh).
// The extension opens and shows files; changing them is the desktop app's job:
//   • a local file (file://…)       → the app opens that same file and saves into it
//   • anything else (web, picked)   → a copy is saved to ~/Documents/Docs & Data/ and opened in the app
// It talks to the app through the native messaging helper (com.datadocs.host), and falls back to a
// datadocs:// link when the helper isn't installed.

const HOST_NAME = 'com.datadocs.host';
let appLink = null; // null = unknown, true = desktop app reachable, false = not installed

function hostSend(msg) {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime.sendNativeMessage) return reject(new Error('Native messaging is unavailable'));
    chrome.runtime.sendNativeMessage(HOST_NAME, msg, reply => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!reply?.ok) return reject(new Error(reply?.error || 'The app did not answer'));
      resolve(reply);
    });
  });
}
async function checkApp() {
  try { await hostSend({ cmd: 'ping' }); appLink = true; } catch { appLink = false; }
  document.querySelectorAll('.app-status').forEach(renderAppStatus);
  return appLink;
}

const pathOfURL = url => url?.startsWith('file://') ? decodeURIComponent(new URL(url).pathname) : null;
const fileURLOf = path => 'file://' + path.split('/').map(encodeURIComponent).join('/');
const datadocsLink = paths => 'datadocs://open' + (paths.length ? '?' + paths.map(p => 'path=' + encodeURIComponent(p)).join('&') : '');
// a datadocs:// link starts the app through the operating system (the browser asks once)
function openLink(url) {
  const a = document.createElement('a');
  a.href = url;
  a.click();
}

function openAppHome() {
  if (appLink === false) { openLink(datadocsLink([])); return; }
  hostSend({ cmd: 'open', paths: [] })
    .then(() => toast('Opening Docs & Data…'))
    .catch(() => { appLink = false; openLink(datadocsLink([])); });
}

async function editInApp(tab) {
  const ref = tab?.ref;
  if (!ref) return toast('Open a file first');
  const path = pathOfURL(ref.url);
  try {
    if (path) {
      // the app edits the file itself
      if (appLink !== false) {
        try { await hostSend({ cmd: 'open', paths: [path] }); return toast(`Opening ${ref.name} in Docs & Data…`); }
        catch { appLink = false; }
      }
      openLink(datadocsLink([path]));
      return toast(`Opening ${ref.name} in Docs & Data… If nothing happens, install the desktop app.`, 6000);
    }
    // no local file to edit: keep a copy on disk first
    const blob = await getFile(ref);
    if (appLink !== false) {
      try {
        const res = await hostSend({ cmd: 'save', name: ref.name, data: await blobToBase64(blob) });
        return toast(`Saved a copy to ${res.path} and opened it in Docs & Data`, 6000);
      } catch (e) {
        if (/too large|exceeds/i.test(e.message)) throw e;
        appLink = false;
      }
    }
    // without the helper: download into Downloads/Docs & Data, then hand the file to the app
    const saved = await downloadCopy(blob, ref.name);
    openLink(datadocsLink([saved]));
    toast(`Saved a copy to ${saved}. Opening it in Docs & Data…`, 6000);
  } catch (e) {
    toast(`Couldn't hand the file to the app: ${e.message}`, 6000);
  }
}

function downloadCopy(blob, name) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: 'Docs & Data/' + name.replace(/[\\/:*?"<>|]/g, '_'), conflictAction: 'uniquify', saveAs: false }, id => {
      if (chrome.runtime.lastError) { URL.revokeObjectURL(url); return reject(new Error(chrome.runtime.lastError.message)); }
      const done = delta => {
        if (delta.id !== id || !delta.state) return;
        if (delta.state.current === 'interrupted') { finish(); reject(new Error('The download was interrupted')); }
        if (delta.state.current === 'complete') chrome.downloads.search({ id }, ([item]) => { finish(); resolve(item.filename); });
      };
      const finish = () => { chrome.downloads.onChanged.removeListener(done); URL.revokeObjectURL(url); };
      chrome.downloads.onChanged.addListener(done);
    });
  });
}

// ---------------------------------------------------------------- recent files (extension only)
function getExtRecent() { try { return JSON.parse(localStorage.getItem('dd.extRecent') || '[]'); } catch { return []; } }
function addExtRecent(item) {
  const list = getExtRecent().filter(r => r.url !== item.url);
  list.unshift(item);
  localStorage.setItem('dd.extRecent', JSON.stringify(list.slice(0, 12)));
}

function fileAccessAllowed() {
  return new Promise(res => chrome.extension?.isAllowedFileSchemeAccess ? chrome.extension.isAllowedFileSchemeAccess(res) : res(true));
}

function renderAppStatus(el) {
  el.classList.toggle('ok', appLink === true);
  el.innerHTML = appLink === true
    ? '<i class="led"></i><span><b>Desktop app connected.</b> “Edit in app” opens files there for changes and saving.</span><button data-a="app">Open app</button>'
    : appLink === false
      ? '<i class="led"></i><span><b>Desktop app not found.</b> Viewing works. To edit, install Docs & Data and open it once.</span><button data-a="app">Try to open</button>'
      : '<i class="led"></i><span>Looking for the desktop app…</span>';
}

// ---------------------------------------------------------------- the New tab page of the extension
function viewerHome(tab) {
  const recent = getExtRecent();
  tab.el.innerHTML = `<div class="body"><div class="home">
    <h1>Docs &amp; Data</h1>
    <p>View spreadsheets, documents, JSON, text, PDFs and videos in tabs. Click a local file or folder link (file://…), drop files here, or open them below. Press ${MOD}K for every command.</p>
    <div class="app-status"></div>
    <div class="file-access hide app-status"><i class="led"></i><span><b>Local files and folders are blocked.</b> Turn on “Allow access to file URLs” for this extension.</span><button data-a="perm">Show setting</button></div>
    <h2>Open</h2>
    <div class="open-row">
      <button data-a="files">Open files…</button>
      <button data-a="folder">Open folder…</button>
      <button data-a="video">Open video…</button>
    </div>
    <form class="url-row" data-a="url">
      <input type="url" placeholder="Paste a link to a file (.csv .xlsx .docx .json…) or a video (YouTube, Vimeo, .mp4)" aria-label="File or video link" required>
      <button class="primary">Open</button>
    </form>
    ${recent.length ? `<h2>Recent</h2><ul class="recent">${recent.map((r, i) => `<li><button data-recent="${i}" class="k-${kindOf(r.name) || 'text'}"><span class="dot"></span><span>${esc(r.name)}</span><span class="pth">${esc(pathOfURL(r.url) || r.url)}</span></button></li>`).join('')}</ul>` : ''}
    <div class="drop-note">Viewing only. Editing and saving happen in the Docs &amp; Data desktop app (macOS, Linux, Windows).</div>
  </div></div>`;
  renderAppStatus(tab.el.querySelector('.app-status'));
  fileAccessAllowed().then(ok => tab.el.querySelector('.file-access').classList.toggle('hide', ok));
  tab.el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.a === 'files') pickFiles();
    else if (b.dataset.a === 'folder') pickFolder();
    else if (b.dataset.a === 'video') pickFiles('media');
    else if (b.dataset.a === 'app') openAppHome();
    else if (b.dataset.a === 'perm') chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    else if (b.dataset.recent != null) openAddress(recent[+b.dataset.recent].url);
  });
  tab.el.querySelector('[data-a=url]').addEventListener('submit', e => { e.preventDefault(); openAddress(e.target.querySelector('input').value.trim()); });
  tab.view = { onShow: () => {} };
}

// ---------------------------------------------------------------- opening addresses
const nameOfURL = url => { try { return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '') || 'file'; } catch { return 'file'; } };

async function openAddress(url) {
  if (!url) return;
  if (url.startsWith('file://')) return url.endsWith('/') ? openFileFolder(url) : openFileURL(url);
  if (!/^https?:\/\//i.test(url)) return toast('Enter a full link starting with https:// or file://');
  const name = nameOfURL(url.split(/[?#]/)[0]);
  const kind = kindOf(name);
  if (embedURL(url)) return openVideoURL(url);
  if (!kind) return toast(`Can't open ${name}: this file type isn't supported.`);
  if (kind === 'media') return openRef({ name, url }); // played straight from the web
  // reading a web file needs permission for its site (asked once per site)
  const origin = new URL(url).origin + '/*';
  if (!await chrome.permissions.contains({ origins: [origin] })) return askSitePermission(url, name, origin);
  const tab = await openRef({ name, url });
  if (tab) addExtRecent({ name, url });
}

function askSitePermission(url, name, origin) {
  const tab = addTab(kindOf(name), name, { key: 'perm:' + url });
  const host = new URL(url).host;
  tab.el.innerHTML = `<div class="body"><div class="home">
    <h1>${esc(name)}</h1>
    <p>To show this file, Docs &amp; Data needs to read it from <b>${esc(host)}</b>.</p>
    <div class="open-row"><button class="primary" data-a="allow">Allow reading from ${esc(host)}</button></div>
  </div></div>`;
  tab.view = { onShow: () => {} };
  tab.el.querySelector('[data-a=allow]').onclick = async () => {
    if (!await chrome.permissions.request({ origins: [origin] })) return toast('Permission was not given');
    closeTab(tab);
    openAddress(url);
  };
}

async function openFileURL(url) {
  const name = nameOfURL(url);
  if (!kindOf(name)) return toast(`Can't open ${name}: this file type isn't supported.`);
  const tab = await openRef({ name, url });
  if (tab) addExtRecent({ name, url });
  return tab;
}

// Chrome's own listing of a file:// folder: addRow("name", "url", isDir, size, …)
async function listFileFolder(url, prefix = '', out = [], depth = 0) {
  if (depth > 8 || out.length >= 5000) return out;
  const html = await (await readURL(url)).text();
  for (const m of html.matchAll(/addRow\(("(?:[^"\\]|\\.)*"),\s*("(?:[^"\\]|\\.)*"),\s*(\d)\s*,\s*(-?\d+)/g)) {
    const name = JSON.parse(m[1]), isDir = m[3] === '1';
    if (name === '..' || name.startsWith('.') || SKIP_DIR.test(name)) continue;
    const child = new URL(JSON.parse(m[2]), url).href;
    if (isDir) await listFileFolder(child.endsWith('/') ? child : child + '/', prefix + name + '/', out, depth + 1);
    else out.push({ rel: prefix + name, url: child, size: +m[4] });
    if (out.length >= 5000) break;
  }
  return out;
}
async function openFileFolder(url) {
  const name = nameOfURL(url) || '/';
  toast(`Reading ${name}…`);
  try {
    const files = await listFileFolder(url);
    addFolder({ name, files });
    addExtRecent({ name: name + '/', url });
  } catch (e) {
    toast(e.message, 7000);
  }
}

// Runs once when the page opens: index.html?open=file:///…  (folder if it ends with /), ?url=https://…
async function extStartup() {
  checkApp();
  const q = new URLSearchParams(location.search);
  for (const url of q.getAll('open')) await openAddress(url);
  for (const url of q.getAll('url')) await openAddress(url);
}
