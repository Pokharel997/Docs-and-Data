'use strict';
// Docs & Data core: helpers, tabs, reading/saving files, Google, folders and the sidebar, commands.
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

// ---------------------------------------------------------------- desktop bridge (see host.js)
// `native` is set inside the Mac and Linux apps, which read and write files on disk by path.
const native = Host.desktop ? { post: Host.post } : null;
const nativeCall = (cmd, args = {}) => Host.call(cmd, args);

// ---------------------------------------------------------------- file kinds
const EXT = {};
const addExt = (kind, list) => list.split(' ').forEach(e => EXT[e] = kind);
addExt('csv', 'csv tsv tab xlsx jsonl ndjson');
addExt('doc', 'docx doc rtf odt');
addExt('json', 'json geojson webmanifest');
addExt('media', 'mp4 m4v webm mov ogv mkv mp3 wav m4a aac oga ogg flac opus png jpg jpeg gif webp svg bmp avif pdf');
addExt('text', 'txt md markdown log xml yaml yml ini toml cfg conf html htm css js mjs ts py sh sql rst tex srt vtt');
const VIDEO = new Set('mp4 m4v webm mov ogv mkv'.split(' ')), AUDIO = new Set('mp3 wav m4a aac oga ogg flac opus'.split(' '));
const extOf = name => (/\.([^./]+)$/.exec(name || '')?.[1] || '').toLowerCase();
const kindOf = name => EXT[extOf(name)] || null;
const baseName = name => (name || 'untitled').replace(/\.[^./]+$/, '') || 'untitled';
const mediaType = name => { const e = extOf(name); return VIDEO.has(e) ? 'video' : AUDIO.has(e) ? 'audio' : e === 'pdf' ? 'pdf' : 'image'; };
function labelOf(tab) {
  const e = extOf(tab.name);
  switch (tab.kind) {
    case 'csv': return { xlsx: 'XLSX', tsv: 'TSV', jsonl: 'JSONL', ndjson: 'JSONL' }[e] || 'CSV';
    case 'media': return { video: 'VIDEO', audio: 'AUDIO', pdf: 'PDF', image: 'IMAGE' }[mediaType(tab.name)];
    case 'text': return { md: 'MD', markdown: 'MD', html: 'HTML', htm: 'HTML', xml: 'XML', yaml: 'YAML', yml: 'YAML', srt: 'SUBS', vtt: 'SUBS' }[e] || 'TXT';
    case 'home': return '';
    default: return tab.kind.toUpperCase();
  }
}

// ---------------------------------------------------------------- small helpers
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const blobToBase64 = blob => new Promise(res => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result.slice(fr.result.indexOf(',') + 1));
  fr.readAsDataURL(blob);
});
const blobToDataURL = blob => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
const base64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const isTyping = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function openExternal(url) {
  if (native) native.post({ cmd: 'openURL', url });
  else window.open(url, '_blank', 'noopener');
}
// Info dialog with HTML body
function showInfo(title, html) {
  const d = $('#info');
  $('#infoTitle').textContent = title;
  $('#infoBody').innerHTML = html;
  d.showModal();
}

// popup menu; items: { label, action, disabled } | '-'
function showMenu(anchor, items, at = null) {
  const m = $('#menu');
  m.innerHTML = '';
  for (const it of items) {
    if (it === '-') { m.append(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.textContent = it.label;
    b.disabled = !!it.disabled;
    b.onclick = () => { hideMenu(); it.action(); };
    m.append(b);
  }
  m.classList.remove('hide');
  let x, y;
  if (at) { x = at.x; y = at.y; }
  else { const r = anchor.getBoundingClientRect(); x = r.right - m.offsetWidth; y = r.bottom + 4; }
  m.style.left = Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8)) + 'px';
  m.querySelector('button:not(:disabled)')?.focus();
}
function hideMenu() { $('#menu').classList.add('hide'); }
document.addEventListener('mousedown', e => { if (!e.target.closest('#menu')) hideMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideMenu(); });
$('#menu').addEventListener('keydown', e => {
  const items = [...$('#menu').querySelectorAll('button:not(:disabled)')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
});

// ---------------------------------------------------------------- tabs (with optional split view)
const tabs = [];
let active = null, tabSeq = 0, split = null; // split = { left, right }
let restoring = false; // true while the last session is being reopened

function addTab(kind, name, { ref = null, key = null, background = false } = {}) {
  const home = active?.kind === 'home' && !background && !restoring ? active : null;
  const tab = { id: ++tabSeq, kind, name, ref, key, dirty: false, view: null };
  tab.el = document.createElement('div');
  tab.el.className = `view k-${kind} hide`;
  tab.el.addEventListener('mousedown', () => { if (split && active !== tab) setActive(tab); }, true);
  tab.el.addEventListener('focusin', () => { if (split && active !== tab) setActive(tab); });
  $('#views').append(tab.el);
  tabs.splice(active ? tabs.indexOf(active) + 1 : tabs.length, 0, tab);
  if (home && kind !== 'home' && !(split && (split.left === home || split.right === home))) removeTab(home);
  if (!background) activate(tab); else renderTabs();
  return tab;
}
function setActive(tab) {
  active = tab;
  document.body.dataset.kind = tab.kind;
  for (const t of tabs) t.el.classList.toggle('active', t === tab);
  renderTabs();
  renderTree();
}
function layout() {
  const shown = split ? [split.left, split.right] : [active];
  for (const t of tabs) {
    const vis = shown.includes(t);
    if (!vis && !t.el.classList.contains('hide')) t.pauseOnHide?.();
    t.el.classList.toggle('hide', !vis);
    t.el.classList.toggle('active', t === active);
    t.el.classList.toggle('pane-left', !!split && t === split.left);
    t.el.classList.toggle('pane-right', !!split && t === split.right);
  }
  $('#views').classList.toggle('split', !!split);
}
function activate(tab) {
  if (!tab) return;
  if (split && tab !== split.left && tab !== split.right) {
    if (active === split.right) split.right = tab; else split.left = tab;
  }
  active = tab;
  document.body.dataset.kind = tab.kind;
  layout();
  renderTabs();
  renderTree();
  tab.view?.onShow?.();
  scheduleSave();
}
function startSplit(right) {
  if (!right || right === active) return;
  split = { left: active, right };
  layout(); renderTabs(); scheduleSave();
}
function closeSplit() {
  if (!split) return;
  split = null;
  layout(); renderTabs(); scheduleSave();
}
function removeTab(tab) {
  const i = tabs.indexOf(tab);
  if (i < 0) return;
  if (split && (split.left === tab || split.right === tab)) {
    const other = split.left === tab ? split.right : split.left;
    split = null;
    if (active === tab) active = other;
  }
  tab.view?.dispose?.();
  tab.el.remove();
  tabs.splice(i, 1);
  if (active === tab) active = null;
  return i;
}
function closeTab(tab = active) {
  if (!tab) return;
  if (tab.dirty && !confirm(`“${tab.name}” has unsaved changes. Close it anyway?`)) return;
  const i = removeTab(tab);
  if (!tabs.length) newHomeTab();
  else if (!active) activate(tabs[Math.min(i, tabs.length - 1)]);
  else { layout(); renderTabs(); scheduleSave(); }
}
function closeOtherTabs(keep) {
  for (const t of [...tabs]) if (t !== keep && (!t.dirty || confirm(`“${t.name}” has unsaved changes. Close it anyway?`))) removeTab(t);
  activate(keep);
}
function renderTabs() {
  $('#tabs').innerHTML = tabs.map(t => `
    <div class="tab k-${t.kind}${t === active ? ' active' : ''}${split && (t === split.left || t === split.right) ? ' in-split' : ''}" role="tab" draggable="true"
         aria-selected="${t === active}" data-id="${t.id}" title="${esc(t.ref?.path || t.ref?.rel || t.name)}">
      ${t.kind !== 'home' ? `<span class="kind">${labelOf(t)}</span>` : ''}
      <span class="tn">${esc(t.name)}</span>
      ${t.dirty ? '<span class="dirty" title="Unsaved changes"></span>' : ''}
      <button class="tclose" data-close="${t.id}" aria-label="Close ${esc(t.name)}">✕</button>
    </div>`).join('');
  $('#tabs .tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('#btnSplit').classList.toggle('on', !!split);
  document.title = active && active.kind !== 'home' ? `${active.name}${active.dirty ? ' (edited)' : ''} – Docs & Data` : 'Docs & Data';
}
function setDirty(tab, dirty = true) {
  if (VIEWER) return; // the extension never changes files
  if (dirty) scheduleSave();
  if (tab.dirty === dirty) return;
  tab.dirty = dirty;
  renderTabs();
}
const tabById = id => tabs.find(t => t.id === +id);
function renameTab(tab) {
  const name = prompt('Name:', tab.name);
  if (name?.trim()) { tab.name = name.trim(); renderTabs(); scheduleSave(); }
}
function tabMenuItems(tab) {
  const others = tabs.filter(t => t !== tab && t.kind !== 'home');
  return [
    { label: 'Rename…', disabled: tab.kind === 'home', action: () => renameTab(tab) },
    { label: 'Show side by side with…', disabled: !others.length, action: () => pickTab('Show side by side with', others, t => { activate(tab); startSplit(t); }) },
    { label: 'Compare with…', disabled: !tab.view?.text || !others.some(t => t.view?.text), action: () => pickTab('Compare with', others.filter(t => t.view?.text), t => compareTabs(tab, t)) },
    { label: 'Reload from disk', disabled: !(tab.ref?.path || tab.ref?.handle), action: () => reloadTab(tab) },
    { label: `Show in ${Host.fileManager}`, disabled: !(native && tab.ref?.path), action: () => native.post({ cmd: 'reveal', path: tab.ref.path }) },
    '-',
    { label: 'Close other tabs', disabled: tabs.length < 2, action: () => closeOtherTabs(tab) },
    { label: 'Close tab', action: () => closeTab(tab) },
  ];
}
function pickTab(title, list, fn) {
  if (!list.length) return toast('No other tabs to choose from');
  if (list.length === 1) return fn(list[0]);
  showMenu(null, list.map(t => ({ label: `${labelOf(t)}  ${t.name}`, action: () => fn(t) })), { x: innerWidth / 2 - 120, y: 90 });
  toast(title + '…', 1500);
}
$('#tabs').addEventListener('click', e => {
  const c = e.target.closest('[data-close]');
  if (c) return closeTab(tabById(c.dataset.close));
  const t = e.target.closest('[data-id]');
  if (t) activate(tabById(t.dataset.id));
});
$('#tabs').addEventListener('auxclick', e => { const t = e.target.closest('[data-id]'); if (t && e.button === 1) closeTab(tabById(t.dataset.id)); });
$('#tabs').addEventListener('dblclick', e => {
  const el = e.target.closest('[data-id]');
  const tab = el && tabById(el.dataset.id);
  if (tab && tab.kind !== 'home' && !e.target.closest('button')) renameTab(tab);
});
$('#tabs').addEventListener('contextmenu', e => {
  const el = e.target.closest('[data-id]');
  if (!el) return;
  e.preventDefault();
  showMenu(null, tabMenuItems(tabById(el.dataset.id)), { x: e.clientX, y: e.clientY });
});
// drag to reorder
let dragTab = null;
$('#tabs').addEventListener('dragstart', e => {
  const el = e.target.closest('[data-id]');
  if (!el) return;
  dragTab = tabById(el.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/x-dd-tab', String(dragTab.id));
});
$('#tabs').addEventListener('dragover', e => {
  if (!dragTab) return;
  e.preventDefault();
  const el = e.target.closest('[data-id]');
  document.querySelectorAll('.tab.drop-before, .tab.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  if (el && +el.dataset.id !== dragTab.id) {
    const r = el.getBoundingClientRect();
    el.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
  }
});
$('#tabs').addEventListener('drop', e => {
  if (!dragTab) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.target.closest('[data-id]');
  if (el && +el.dataset.id !== dragTab.id) {
    const target = tabById(el.dataset.id);
    const r = el.getBoundingClientRect();
    tabs.splice(tabs.indexOf(dragTab), 1);
    tabs.splice(tabs.indexOf(target) + (e.clientX < r.left + r.width / 2 ? 0 : 1), 0, dragTab);
  }
  dragTab = null;
  renderTabs(); scheduleSave();
});
$('#tabs').addEventListener('dragend', () => { dragTab = null; renderTabs(); });
$('#tabAdd').onclick = () => newHomeTab();
$('#btnSplit').onclick = e => {
  if (split) return closeSplit();
  const others = tabs.filter(t => t !== active);
  if (!others.length) return toast('Open another tab first, then show the two side by side');
  showMenu(e.currentTarget, [{ label: 'Show side by side with:', disabled: true, action() {} }, ...others.map(t => ({ label: `${labelOf(t) || 'New'}  ${t.name}`, action: () => startSplit(t) }))]);
};

// common toolbar buttons: Save, Convert/Export menu, Google
function wireToolbar(tab) {
  if (VIEWER) {
    // Viewer: editing happens in the desktop app, which saves the file on disk.
    const save = tab.el.querySelector('[data-a=save]');
    if (save) { save.textContent = 'Edit in app'; save.title = 'Open this file in the Docs & Data desktop app to change it'; save.addEventListener('click', () => editInApp(tab)); }
    tab.el.querySelector('[data-a=more]')?.remove();
    tab.el.querySelector('[data-a=google]')?.addEventListener('click', () => tab.view.google());
    return;
  }
  tab.el.querySelector('[data-a=save]')?.addEventListener('click', () => saveTab(tab));
  const more = tab.el.querySelector('[data-a=more]');
  more?.addEventListener('click', () => showMenu(more, tab.view.exports()));
  tab.el.querySelector('[data-a=google]')?.addEventListener('click', () => tab.view.google());
}

// ---------------------------------------------------------------- reading files
// A "ref" points at a file: { name, path } (macOS app), { name, handle } (Chrome/Edge), { name, file } (any browser),
// optionally with { folderId, rel } when it came from an opened folder, or { url } for web videos.
const refKey = ref => ref.path || ref.url || (ref.folderId ? `${ref.folderId}:${ref.rel}` : null);
async function getFile(ref) {
  if (ref.file) return ref.file;
  if (ref.handle) return ref.handle.getFile();
  if (ref.url) return readURL(ref.url);
  throw new Error('This file is no longer available. Open it again.');
}
// Reads a file:// or web address into a Blob. file:// needs XMLHttpRequest (fetch refuses it).
function readURL(url) {
  if (!url.startsWith('file:')) {
    return fetch(url).then(r => { if (!r.ok) throw new Error(`The server answered ${r.status} ${r.statusText}`); return r.blob(); })
      .catch(e => { throw Object.assign(new Error(`Couldn't download the file: ${e.message}`), { url }); });
  }
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('GET', url);
    x.responseType = 'blob';
    x.onload = () => (x.status === 0 || x.status === 200) && x.response ? resolve(x.response) : reject(new Error('Could not read the file'));
    x.onerror = () => reject(new Error(VIEWER ? 'Could not read the file. Turn on “Allow access to file URLs” for the extension (Extensions → Docs & Data → Details).' : 'Could not read the file'));
    x.send();
  });
}
async function readText(ref) {
  if (ref.path && native) return nativeCall('read', { path: ref.path, as: 'text' });
  return (await getFile(ref)).text();
}
async function readBytes(ref, as = 'bytes') {
  if (ref.path && native) return base64ToBytes(await nativeCall('read', { path: ref.path, as }));
  return new Uint8Array(await (await getFile(ref)).arrayBuffer());
}
async function mediaSrc(ref) {
  if (ref.url && !ref.url.startsWith('file:')) return ref.url;
  if (ref.path && native) return Host.mediaURL(ref.path);
  let file = await getFile(ref);
  // without a type the browser can't tell a PDF or video from plain text
  const type = MEDIA_MIME[extOf(ref.name)];
  if (type && file.type !== type) file = new Blob([file], { type });
  return URL.createObjectURL(file);
}
const MEDIA_MIME = { pdf: 'application/pdf', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', oga: 'audio/ogg', ogg: 'audio/ogg', flac: 'audio/flac', opus: 'audio/opus',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' };
// Last-modified time in ms, or null when unknown
async function statRef(ref) {
  try {
    if (ref.path && native) return (await nativeCall('stat', { path: ref.path }))?.mtime ?? null;
    if (ref.handle) return (await ref.handle.getFile()).lastModified;
  } catch { /* gone */ }
  return null;
}
// Subtitle file next to a video (same name, .vtt or .srt)
async function findSubtitles(ref) {
  const base = baseName(ref.name);
  if (ref.folderId) {
    const folder = folders.find(f => f.id === ref.folderId);
    const dir = ref.rel.includes('/') ? ref.rel.slice(0, ref.rel.lastIndexOf('/') + 1) : '';
    const hit = folder?.files.find(f => f.rel === dir + base + '.vtt') || folder?.files.find(f => f.rel === dir + base + '.srt');
    if (hit) return hit.path ? { name: hit.name, path: hit.path } : hit;
  }
  if (ref.path && native) {
    for (const e of ['vtt', 'srt']) {
      const path = ref.path.replace(/\.[^./]+$/, '.' + e);
      if (await nativeCall('stat', { path }).catch(() => null)) return { name: path.split('/').pop(), path };
    }
  }
  return null;
}

async function loadInto(tab, ref) {
  const kind = kindOf(ref.name), e = extOf(ref.name);
  tab.el.innerHTML = '<div class="loading">Opening…</div>';
  tab.view?.dispose?.();
  tab.view = null;
  tab.findBar = null;
  tab.findAdapter = null;
  if (kind === 'csv') {
    if (e === 'xlsx') CsvView(tab, { sheets: (await Xlsx.read(await readBytes(ref))).map(s => sheetFromRows(s.name, s.rows)), format: 'xlsx' });
    else CsvView(tab, { text: await readText(ref), format: e === 'jsonl' || e === 'ndjson' ? 'jsonl' : e === 'tsv' ? 'tsv' : 'csv' });
  } else if (kind === 'json') JsonView(tab, await readText(ref));
  else if (kind === 'text') TextView(tab, await readText(ref));
  else if (kind === 'media') {
    const type = mediaType(ref.name);
    const subs = type === 'video' ? await findSubtitles(ref) : null;
    MediaView(tab, { src: await mediaSrc(ref), type, revoke: !native && !ref.url, subs, posKey: refKey(ref) || `${ref.name}` });
  } else if (kind === 'doc') {
    let bytes;
    if (e === 'docx') bytes = await readBytes(ref);
    else if (native) { bytes = await readBytes(ref, 'docx'); tab.converted = true; }
    else throw new Error(`.${e} files open in the desktop app. In a browser, save the file as .docx first.`);
    DocView(tab, await Docx.toHTML(bytes));
    if (tab.converted) toast(`Converted ${ref.name} for editing. Saving will create a .docx copy.`, 4000);
  }
  tab.mtime = await statRef(ref);
}
async function openRef(ref, { background = false } = {}) {
  const key = refKey(ref);
  const existing = key && tabs.find(t => t.key === key);
  if (existing) { if (!background) activate(existing); return existing; }
  if (!kindOf(ref.name)) { toast(`Can't open ${ref.name}: this file type isn't supported.`); return null; }
  const tab = addTab(kindOf(ref.name), ref.name, { ref, key, background });
  try {
    await loadInto(tab, ref);
    addRecent(ref);
  } catch (err) {
    console.error(err);
    tab.view = null;
    tab.el.innerHTML = `<div class="err"><b>Couldn't open ${esc(ref.name)}</b>${esc(err.message || err)}</div>`;
  }
  scheduleSave();
  return tab;
}
const openRefs = async refs => { for (const r of refs) await openRef(r); };
async function reloadTab(tab) {
  if (!tab.ref) return;
  if (tab.dirty && !confirm(`Reload “${tab.name}” from disk? Your unsaved changes will be lost.`)) return;
  try { await loadInto(tab, tab.ref); setDirty(tab, false); toast(`Reloaded ${tab.name}`); }
  catch (e) { toast(`Couldn't reload: ${e.message}`, 5000); }
}

// ---------------------------------------------------------------- saving
async function writeHandle(h, blob) {
  if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted'
      && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') {
    throw Object.assign(new Error('Permission to save was denied'), { name: 'NotAllowedError' });
  }
  const w = await h.createWritable();
  await w.write(blob);
  await w.close();
}
// Returns { name, path?, handle?, downloaded? } or null when cancelled.
async function writeOut(out, { tab = null, saveAs = true } = {}) {
  const blob = out.data instanceof Blob ? out.data : new Blob([out.data], { type: out.mime });
  if (native) {
    const isText = typeof out.data === 'string';
    return nativeCall('save', {
      path: !saveAs && tab?.ref?.path ? tab.ref.path : null, name: out.name,
      content: isText ? out.data : await blobToBase64(blob), encoding: isText ? 'text' : 'base64',
      backup: settings.backups,
    });
  }
  const handle = !saveAs && tab?.ref?.handle;
  if (handle?.createWritable) {
    try { await writeHandle(handle, blob); return { name: handle.name, handle }; }
    catch (e) { if (e.name === 'AbortError') return null; }
  }
  if (window.showSaveFilePicker) {
    try {
      const h = await showSaveFilePicker({ suggestedName: out.name });
      await writeHandle(h, blob);
      return { name: h.name, handle: h };
    } catch (e) { if (e.name === 'AbortError') return null; }
  }
  download(blob, out.name);
  return { name: out.name, downloaded: true };
}
async function saveTab(tab = active, saveAs = false) {
  if (VIEWER) return tab && tab.kind !== 'home' && editInApp(tab);
  if (!tab?.view?.serialize) return;
  if (tab.el.contains(document.activeElement)) document.activeElement.blur?.();
  try {
    const out = await tab.view.serialize();
    // a converted file (.doc → .docx, .csv → .xlsx…) can't overwrite the original
    const sameType = !tab.ref || extOf(tab.ref.name) === extOf(out.name);
    const res = await writeOut(out, { tab, saveAs: saveAs || tab.converted || !tab.ref || !sameType });
    if (!res) return;
    tab.converted = false;
    tab.name = res.name;
    if (res.path) { tab.ref = { name: res.name, path: res.path }; tab.key = res.path; addRecent(tab.ref); }
    else if (res.handle) tab.ref = { ...(tab.ref || {}), name: res.name, handle: res.handle, file: null };
    tab.mtime = tab.ref ? await statRef(tab.ref) : null;
    setDirty(tab, false);
    renderTabs();
    toast(res.downloaded ? `Downloaded ${res.name}` : `Saved ${res.name}`);
    if (res.path || res.handle) refreshFoldersContaining(res.path);
  } catch (e) { toast(`Couldn't save: ${e.message}`, 5000); }
}
async function exportOut(out) {
  try {
    const res = await writeOut(out);
    if (res) toast(res.downloaded ? `Downloaded ${res.name}` : `Exported ${res.name}`);
  } catch (e) { toast(`Couldn't export: ${e.message}`, 5000); }
}

// ---------------------------------------------------------------- Google Docs & Sheets
const gClientId = () => localStorage.getItem('dd.gClientId') || '';
const canUploadToGoogle = () => !!gClientId() && /^https?:$/.test(location.protocol);
let gToken = null, gTokenExpiry = 0, gScript = null;
function loadGoogleScript() {
  gScript ||= new Promise((res, rej) => {
    const s = Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', onload: res, onerror: () => rej(new Error('Could not load Google sign-in')) });
    document.head.append(s);
  });
  return gScript;
}
async function googleToken() {
  if (gToken && Date.now() < gTokenExpiry) return gToken;
  await loadGoogleScript();
  return new Promise((resolve, reject) => {
    google.accounts.oauth2.initTokenClient({
      client_id: gClientId(), scope: 'https://www.googleapis.com/auth/drive.file',
      callback: r => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        gToken = r.access_token; gTokenExpiry = Date.now() + (r.expires_in - 60) * 1000;
        resolve(gToken);
      },
      error_callback: e => reject(new Error(e.message || e.type || 'Sign-in cancelled')),
    }).requestAccessToken();
  });
}
function copyRich(html, text) {
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.innerHTML = html;
  Object.assign(holder.style, { position: 'fixed', left: '-10000px', top: '0', opacity: '0' });
  document.body.append(holder);
  const sel = getSelection(), saved = sel.rangeCount ? sel.getRangeAt(0) : null;
  const range = document.createRange();
  range.selectNodeContents(holder);
  sel.removeAllRanges(); sel.addRange(range);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* fall through */ }
  holder.remove();
  sel.removeAllRanges();
  if (saved) sel.addRange(saved);
  if (!ok && navigator.clipboard?.write && window.ClipboardItem) {
    navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }),
    })]).catch(() => {});
    ok = true;
  }
  return ok;
}
// kind: 'sheet' | 'doc'. Must be called directly from a click so the copy and the new window are allowed.
function sendToGoogle(kind, { name, html, text, file }) {
  const what = kind === 'sheet' ? 'Google Sheet' : 'Google Doc';
  if (canUploadToGoogle()) {
    (async () => {
      try {
        toast('Uploading to Google Drive…', 10000);
        const token = await googleToken();
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify({
          name, mimeType: kind === 'sheet' ? 'application/vnd.google-apps.spreadsheet' : 'application/vnd.google-apps.document',
        })], { type: 'application/json' }));
        form.append('file', file);
        const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form,
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error?.message || `HTTP ${r.status}`);
        openExternal((await r.json()).webViewLink);
        toast(`Created ${what} “${name}”`, 4000);
      } catch (e) { toast(`Google upload failed: ${e.message}`, 6000); }
    })();
    return;
  }
  if (!copyRich(html, text)) return toast(`Couldn't copy to the clipboard. Export the file and upload it to Google Drive instead.`, 6000);
  openExternal(kind === 'sheet' ? 'https://docs.google.com/spreadsheets/create' : 'https://docs.google.com/document/create');
  toast(`Copied. Press ${MOD}V in the new ${what} to paste it in.`, 7000);
}

// ---------------------------------------------------------------- new blank files
function newFile(kind) {
  if (VIEWER) return openAppHome();
  const n = tabs.filter(t => t.kind === kind).length + 1;
  if (kind === 'csv') { const t = addTab('csv', `Untitled ${n}.csv`); CsvView(t, { sheets: [sheetFromRows('Sheet1', [['Column 1', 'Column 2', 'Column 3'], ...Array.from({ length: 5 }, () => ['', '', ''])])], format: 'csv' }); }
  else if (kind === 'xlsx') { const t = addTab('csv', `Untitled ${n}.xlsx`); CsvView(t, { sheets: [sheetFromRows('Sheet1', [['Column 1', 'Column 2', 'Column 3'], ...Array.from({ length: 5 }, () => ['', '', ''])])], format: 'xlsx' }); }
  else if (kind === 'doc') { const t = addTab('doc', `Untitled ${n}.docx`); DocView(t, '<h1>Untitled document</h1><p><br></p>'); setTimeout(() => { const p = t.el.querySelector('.page'); p.focus(); const r = document.createRange(); r.selectNodeContents(p.firstChild); getSelection().removeAllRanges(); getSelection().addRange(r); }); }
  else if (kind === 'json') { const t = addTab('json', `Untitled ${n}.json`); JsonView(t, '[\n  { "name": "", "value": 0 }\n]\n'); }
  else if (kind === 'md') { const t = addTab('text', `Untitled ${n}.md`); TextView(t, '# Title\n\nWrite here.\n'); }
  else if (kind === 'text') { const t = addTab('text', `Untitled ${n}.txt`); TextView(t, ''); t.el.querySelector('textarea').focus(); }
}
// starter content for "New file" in a folder
async function templateFor(name) {
  switch (extOf(name)) {
    case 'csv': return 'Column 1,Column 2,Column 3\n';
    case 'tsv': return 'Column 1\tColumn 2\tColumn 3\n';
    case 'json': return '{}\n';
    case 'md': return `# ${baseName(name)}\n`;
    case 'docx': { const d = document.createElement('div'); d.innerHTML = `<h1>${esc(baseName(name))}</h1>`; return Docx.fromHTML(d); }
    case 'xlsx': return Xlsx.write([{ name: 'Sheet1', headers: ['Column 1', 'Column 2', 'Column 3'], rows: [] }]);
    default: return '';
  }
}

// ---------------------------------------------------------------- home / new tab page
function getRecent() { try { return JSON.parse(localStorage.getItem('dd.recent') || '[]'); } catch { return []; } }
function addRecent(ref) {
  if (!ref.path) return; // only the desktop apps can reopen files by path
  const list = getRecent().filter(r => r.path !== ref.path);
  list.unshift({ name: ref.name, path: ref.path });
  localStorage.setItem('dd.recent', JSON.stringify(list.slice(0, 12)));
}
function newHomeTab() {
  const existing = tabs.find(t => t.kind === 'home');
  if (existing) { activate(existing); return existing; }
  const tab = addTab('home', 'New tab');
  if (VIEWER) { viewerHome(tab); return tab; }
  const recent = getRecent();
  tab.el.innerHTML = `<div class="body"><div class="home">
    <h1>New tab</h1>
    <p>Create a file, or open files and whole folders. You can also drop them anywhere in this window. Press ${MOD}K to find any command.</p>
    <h2>Create</h2>
    <div class="create">
      <button class="k-csv" data-new="csv"><b>Spreadsheet</b><span>CSV table</span></button>
      <button class="k-csv" data-new="xlsx"><b>Excel workbook</b><span>.xlsx with sheets</span></button>
      <button class="k-doc" data-new="doc"><b>Document</b><span>Formatted text, saves as Word</span></button>
      <button class="k-json" data-new="json"><b>JSON</b><span>Edit, check and query data</span></button>
      <button class="k-text" data-new="md"><b>Markdown</b><span>Notes with live preview</span></button>
      <button class="k-text" data-new="text"><b>Plain text</b><span>Notes, logs, anything</span></button>
    </div>
    <h2>Open</h2>
    <div class="open-row">
      <button data-a="files">Open files…</button>
      <button data-a="folder">Open folder…</button>
      <button data-a="video">Open video…</button>
    </div>
    <form class="url-row" data-a="url">
      <input type="url" placeholder="Paste a video link: YouTube, Vimeo, or a direct .mp4 / .webm address" aria-label="Video link" required>
      <button class="primary k-media">Play video</button>
    </form>
    ${recent.length ? `<h2>Recent</h2><ul class="recent">${recent.map((r, i) => `<li><button data-recent="${i}" class="k-${kindOf(r.name) || 'text'}"><span class="dot"></span><span>${esc(r.name)}</span><span class="pth">${esc(r.path)}</span></button></li>`).join('')}</ul>` : ''}
    <div class="drop-note">Opens spreadsheets (.csv .tsv .xlsx .jsonl), documents (.docx${native ? ' .doc .rtf .odt' : ''}), .json, Markdown, HTML, XML, YAML, text, PDF, video, audio and images</div>
  </div></div>`;
  tab.el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.new) newFile(b.dataset.new);
    else if (b.dataset.a === 'files') pickFiles();
    else if (b.dataset.a === 'folder') pickFolder();
    else if (b.dataset.a === 'video') pickFiles('media');
    else if (b.dataset.recent != null) openRef(recent[+b.dataset.recent]);
  });
  tab.el.querySelector('[data-a=url]').addEventListener('submit', e => { e.preventDefault(); openVideoURL(e.target.querySelector('input').value); });
  tab.view = { onShow: () => {} };
  return tab;
}

// ---------------------------------------------------------------- opening files & folders
async function pickFiles(kind) {
  if (native) return openRefs(await nativeCall('pickFiles', { kind: kind || '' }) || []);
  if (window.showOpenFilePicker && kind !== 'media') {
    try { return openRefs((await showOpenFilePicker({ multiple: true })).map(h => ({ name: h.name, handle: h }))); }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  (kind === 'media' ? $('#videoInput') : $('#fileInput')).click();
}
for (const id of ['#fileInput', '#videoInput']) {
  $(id).onchange = e => { openRefs([...e.target.files].map(f => ({ name: f.name, file: f }))); e.target.value = ''; };
}

const folders = [];
let folderSeq = 0;
const SKIP_DIR = /^(\.|node_modules$|__pycache__$|\.git$)/;
function addFolder({ name, path = null, handle = null, files, quiet = false, open = null }) {
  const same = folders.findIndex(f => (path && f.path === path) || (handle && f.handle === handle));
  const id = same >= 0 ? folders[same].id : 'f' + (++folderSeq); // keep the id so open tabs stay linked
  const supported = files.filter(f => kindOf(f.rel));
  const folder = {
    id, name, path, handle,
    files: supported.map(f => ({ ...f, name: f.rel.split('/').pop(), folderId: id })),
    hidden: files.length - supported.length, open: open || new Set(['']),
  };
  if (same >= 0) folders.splice(same, 1, folder); else folders.push(folder);
  if (!quiet) {
    $('#app').classList.remove('noside');
    toast(`${name}: ${folder.files.length} file${folder.files.length === 1 ? '' : 's'} you can open${folder.hidden ? `, ${folder.hidden} other${folder.hidden === 1 ? '' : 's'} hidden` : ''}`);
  }
  renderTree();
  scheduleSave();
  return folder;
}
async function walkHandle(dir, prefix = '', out = []) {
  for await (const [name, h] of dir.entries()) {
    if (out.length > 20000) break;
    if (h.kind === 'directory') { if (!SKIP_DIR.test(name)) await walkHandle(h, prefix + name + '/', out); }
    else if (!name.startsWith('.')) out.push({ rel: prefix + name, handle: h });
  }
  return out;
}
async function pickFolder() {
  if (native) { const f = await nativeCall('pickFolder'); if (f) addFolder(f); return; }
  if (window.showDirectoryPicker) {
    try {
      const dir = await showDirectoryPicker({ mode: 'readwrite' });
      toast(`Reading ${dir.name}…`);
      addFolder({ name: dir.name, handle: dir, files: await walkHandle(dir) });
      return;
    } catch (e) { if (e.name === 'AbortError') return; }
  }
  $('#folderInput').click();
}
$('#folderInput').onchange = e => {
  const byRoot = new Map();
  for (const f of e.target.files) {
    const [root, ...rest] = f.webkitRelativePath.split('/');
    if (rest.some(p => SKIP_DIR.test(p))) continue;
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push({ rel: rest.join('/'), file: f });
  }
  byRoot.forEach((files, name) => addFolder({ name, files }));
  e.target.value = '';
};
async function refreshFolder(folder, quiet = true) {
  let files;
  if (folder.needsPermission) return reconnectFolder(folder);
  if (native && folder.path) files = (await nativeCall('listFolder', { path: folder.path }))?.files;
  else if (folder.handle) files = await walkHandle(folder.handle);
  else return toast('Open the folder again to see new files');
  if (files) addFolder({ name: folder.name, path: folder.path, handle: folder.handle, files, quiet, open: folder.open });
}
function refreshFoldersContaining(path) {
  for (const f of folders) if ((path && f.path && path.startsWith(f.path + '/')) || (!path && f.handle)) refreshFolder(f);
}
async function reconnectFolder(folder) {
  try {
    if ((await folder.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
    folder.needsPermission = false;
    addFolder({ name: folder.name, handle: folder.handle, files: await walkHandle(folder.handle), quiet: true, open: folder.open });
  } catch (e) { toast(`Couldn't reconnect: ${e.message}`); }
}

// ---------------------------------------------------------------- folder actions (new / rename / delete)
async function dirHandleFor(folder, dirRel) {
  let d = folder.handle;
  for (const part of dirRel.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part);
  return d;
}
const parentRel = rel => rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
const canEditFolder = folder => !VIEWER && ((native && folder.path) || (folder.handle && !folder.needsPermission));
async function fsNewFile(folder, dirRel) {
  if (!canEditFolder(folder)) return toast('This folder is read-only here. Open it with “Open folder” in Chrome or Edge, or in the desktop app.', 5000);
  const name = prompt('New file name (for example notes.md, data.csv, report.docx, budget.xlsx):', 'untitled.csv')?.trim();
  if (!name) return;
  if (/[/\\:]/.test(name)) return toast('File names can’t contain / \\ or :');
  const content = await templateFor(name);
  const blob = content instanceof Blob ? content : new Blob([content]);
  try {
    let ref;
    if (native && folder.path) {
      const path = [folder.path, dirRel, name].filter(Boolean).join('/');
      await nativeCall('create', { path, content: await blobToBase64(blob) });
      ref = { name, path };
    } else {
      const dir = await dirHandleFor(folder, dirRel);
      if (await dir.getFileHandle(name).then(() => true, () => false)) throw new Error(`${name} already exists`);
      const h = await dir.getFileHandle(name, { create: true });
      await writeHandle(h, blob);
      ref = { name, handle: h };
    }
    if (dirRel) folder.open.add(dirRel);
    await refreshFolder(folder);
    const f = folders.find(x => x.id === folder.id)?.files.find(x => x.rel === (dirRel ? dirRel + '/' : '') + name);
    openRef(f ? (f.path ? { name: f.name, path: f.path } : f) : ref);
  } catch (e) { toast(`Couldn't create the file: ${e.message}`, 5000); }
}
async function fsRename(folder, file) {
  if (!canEditFolder(folder)) return toast('This folder is read-only here.', 4000);
  const name = prompt('Rename to:', file.name)?.trim();
  if (!name || name === file.name) return;
  if (/[/\\:]/.test(name)) return toast('File names can’t contain / \\ or :');
  const open = tabs.find(t => t.key === (file.path || `${folder.id}:${file.rel}`));
  try {
    if (native && file.path) {
      const res = await nativeCall('rename', { path: file.path, name });
      if (open) { open.ref = { name, path: res.path }; open.key = res.path; open.name = name; }
    } else {
      if (file.handle.move) await file.handle.move(name);
      else {
        const dir = await dirHandleFor(folder, parentRel(file.rel));
        const h = await dir.getFileHandle(name, { create: true });
        await writeHandle(h, await file.handle.getFile());
        await dir.removeEntry(file.name);
        file.handle = h;
      }
      if (open) { open.name = name; open.ref = { ...open.ref, name }; }
    }
    await refreshFolder(folder);
    if (open) { open.key = open.ref.path || `${folder.id}:${parentRel(file.rel) ? parentRel(file.rel) + '/' : ''}${name}`; renderTabs(); }
    toast(`Renamed to ${name}`);
  } catch (e) { toast(`Couldn't rename: ${e.message}`, 5000); }
}
async function fsDelete(folder, file) {
  if (!canEditFolder(folder)) return toast('This folder is read-only here.', 4000);
  const where = native ? 'It will be moved to the Trash.' : 'This can’t be undone.';
  if (!confirm(`Delete “${file.rel}”? ${where}`)) return;
  try {
    if (native && file.path) await nativeCall('trash', { path: file.path });
    else await (await dirHandleFor(folder, parentRel(file.rel))).removeEntry(file.name);
    const open = tabs.find(t => t.key === (file.path || `${folder.id}:${file.rel}`));
    if (open) { open.ref = null; open.key = null; setDirty(open, true); toast(`Deleted. “${open.name}” is still open; save it to keep a copy.`, 5000); }
    else toast(`Deleted ${file.name}`);
    await refreshFolder(folder);
  } catch (e) { toast(`Couldn't delete: ${e.message}`, 5000); }
}

// ---------------------------------------------------------------- sidebar tree & folder search
let treeQuery = '', searchMode = false, search = null; // search = { query, results: [{ file, hits }], running, done }
function buildTree(files) {
  const root = { dirs: new Map(), files: [] };
  files.forEach((f, i) => {
    const parts = f.rel.split('/');
    let n = root, path = '';
    for (const p of parts.slice(0, -1)) {
      path += (path ? '/' : '') + p;
      if (!n.dirs.has(p)) n.dirs.set(p, { path, dirs: new Map(), files: [] });
      n = n.dirs.get(p);
    }
    n.files.push(i);
  });
  return root;
}
function renderTree() {
  const el = $('#tree');
  $('.filter-row').classList.toggle('hide', !folders.length);
  if (!folders.length) {
    el.innerHTML = `<div class="tree-empty">Open a folder to browse its spreadsheets, documents, JSON and videos here.</div>`;
    return;
  }
  if (searchMode && search) return renderSearch();
  const cur = active?.key;
  const fileRow = (folder, i, label) => {
    const f = folder.files[i];
    const isCur = cur && (cur === `${folder.id}:${f.rel}` || (f.path && cur === f.path));
    return `<button class="rowline k-${kindOf(f.name)}${isCur ? ' current' : ''}" data-file="${folder.id}|${i}" title="${esc(f.rel)}"><span class="caret"></span><span class="dot"></span><span class="nm">${esc(label)}</span></button>`;
  };
  const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const dirHTML = (folder, node) => {
    let h = '';
    for (const [dname, d] of [...node.dirs].sort((a, b) => byName(a[0], b[0]))) {
      const open = folder.open.has(d.path);
      h += `<button class="rowline${open ? ' open' : ''}" data-dir="${folder.id}|${esc(d.path)}"><span class="caret">▶</span><span class="nm">${esc(dname)}</span></button>`;
      if (open) h += `<div class="children">${dirHTML(folder, d)}</div>`;
    }
    for (const i of node.files.sort((a, b) => byName(folder.files[a].name, folder.files[b].name))) h += fileRow(folder, i, folder.files[i].name);
    return h;
  };
  const ql = searchMode ? '' : treeQuery.toLowerCase();
  el.innerHTML = folders.map(folder => {
    const open = folder.open.has('');
    let inner = '';
    if (folder.needsPermission) inner = `<div class="tree-empty">Access to this folder needs to be granted again. <button data-reconnect="${folder.id}">Reconnect</button></div>`;
    else if (ql) {
      const hits = folder.files.map((f, i) => [f, i]).filter(([f]) => f.rel.toLowerCase().includes(ql)).slice(0, 300);
      inner = hits.map(([f, i]) => fileRow(folder, i, f.rel)).join('') || '<div class="tree-empty">No matching files</div>';
    } else if (open) {
      folder.tree ||= buildTree(folder.files);
      inner = dirHTML(folder, folder.tree) || '<div class="tree-empty">No supported files in this folder</div>';
    }
    return `<div class="root">
      <div class="rowline${open || ql ? ' open' : ''}" data-dir="${folder.id}|" title="${esc(folder.path || folder.name)}" role="button" tabindex="0">
        <span class="caret">▶</span><span class="nm">${esc(folder.name)}</span>
        ${canEditFolder(folder) ? `<span class="x" data-newin="${folder.id}|" title="New file" role="button">＋</span>` : ''}
        ${folder.path || folder.handle ? `<span class="x" data-refresh="${folder.id}" title="Reload folder" role="button">↻</span>` : ''}
        <span class="x" data-rm="${folder.id}" title="Remove from sidebar" role="button">✕</span>
      </div>
      ${open || ql ? `<div class="children">${inner}</div>` : ''}</div>`;
  }).join('');
}
function renderSearch() {
  const { query, results, running } = search;
  const q = query.toLowerCase();
  const mark = s => { const i = s.toLowerCase().indexOf(q); return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + query.length)) + '</mark>' + esc(s.slice(i + query.length)); };
  const total = results.reduce((n, r) => n + r.count, 0);
  $('#tree').innerHTML = `<div class="search-head">${running ? `Searching… ${search.scanned} files` : `${total} match${total === 1 ? '' : 'es'} in ${results.length} file${results.length === 1 ? '' : 's'}`}</div>` +
    results.map((r, ri) => `<div class="hitfile">
      <button class="rowline k-${kindOf(r.file.name)}" data-hit="${ri}|-1" title="${esc(r.file.rel)}"><span class="dot"></span><span class="nm">${esc(r.file.rel)}</span><span class="cnt">${r.count}</span></button>
      ${r.hits.map((h, hi) => `<button class="hit" data-hit="${ri}|${hi}">${h.line ? `<span class="ln">${h.line}</span>` : ''}${mark(h.text)}</button>`).join('')}
    </div>`).join('');
}
async function textOfRef(ref) {
  const k = kindOf(ref.name), e = extOf(ref.name);
  if (k === 'csv' && e === 'xlsx') return (await Xlsx.read(await readBytes(ref))).map(s => s.rows.map(r => r.join('\t')).join('\n')).join('\n');
  if (k === 'csv' || k === 'json' || k === 'text') return readText(ref);
  if (k === 'doc' && e === 'docx') return htmlToText(await Docx.toHTML(await readBytes(ref)));
  return null;
}
async function runSearch(query) {
  query = query.trim();
  if (!query) { search = null; renderTree(); return; }
  const token = {};
  search = { query, results: [], running: true, scanned: 0, token };
  renderTree();
  const q = query.toLowerCase();
  for (const folder of folders) {
    for (const f of folder.files) {
      if (search?.token !== token) return;
      if ((f.size || f.file?.size || 0) > 20e6) continue;
      const ref = f.path ? { name: f.name, path: f.path } : f;
      let text = null;
      try { text = await textOfRef(ref); } catch { /* unreadable */ }
      search.scanned++;
      if (text) {
        const hits = [];
        let count = 0;
        text.split('\n').forEach((line, i) => {
          if (!line.toLowerCase().includes(q)) return;
          count++;
          if (hits.length < 5) {
            const at = line.toLowerCase().indexOf(q);
            const start = Math.max(0, at - 30);
            hits.push({ line: i + 1, text: (start ? '…' : '') + line.slice(start, at + q.length + 60).trim() });
          }
        });
        if (count) search.results.push({ file: f, ref, hits, count });
      }
      if (search.scanned % 10 === 0) renderTree();
    }
  }
  if (search?.token === token) { search.running = false; renderTree(); }
}
$('#tree').addEventListener('click', async e => {
  const rc = e.target.closest('[data-reconnect]');
  if (rc) return reconnectFolder(folders.find(f => f.id === rc.dataset.reconnect));
  const rm = e.target.closest('[data-rm]');
  if (rm) { folders.splice(folders.findIndex(f => f.id === rm.dataset.rm), 1); renderTree(); scheduleSave(); return; }
  const rf = e.target.closest('[data-refresh]');
  if (rf) return refreshFolder(folders.find(f => f.id === rf.dataset.refresh), false);
  const nw = e.target.closest('[data-newin]');
  if (nw) { const [fid, rel] = nw.dataset.newin.split(/\|(.*)/s); return fsNewFile(folders.find(f => f.id === fid), rel); }
  const hit = e.target.closest('[data-hit]');
  if (hit) {
    const [ri, hi] = hit.dataset.hit.split('|').map(Number);
    const r = search.results[ri];
    const tab = await openRef(r.ref);
    if (tab?.view?.findText) tab.view.findText(search.query, hi >= 0 ? r.hits[hi].line : null);
    return;
  }
  const fileEl = e.target.closest('[data-file]');
  if (fileEl) {
    const [fid, i] = fileEl.dataset.file.split('|');
    const f = folders.find(x => x.id === fid)?.files[+i];
    if (f) openRef(f.path ? { name: f.name, path: f.path } : f);
    return;
  }
  const dirEl = e.target.closest('[data-dir]');
  if (dirEl) {
    const [fid, path] = dirEl.dataset.dir.split(/\|(.*)/s);
    const folder = folders.find(x => x.id === fid);
    folder.open.has(path) ? folder.open.delete(path) : folder.open.add(path);
    renderTree(); scheduleSave();
  }
});
$('#tree').addEventListener('contextmenu', e => {
  const fileEl = e.target.closest('[data-file]'), dirEl = e.target.closest('[data-dir]');
  if (!fileEl && !dirEl) return;
  e.preventDefault();
  const at = { x: e.clientX, y: e.clientY };
  if (fileEl) {
    const [fid, i] = fileEl.dataset.file.split('|');
    const folder = folders.find(x => x.id === fid), f = folder.files[+i];
    const ref = f.path ? { name: f.name, path: f.path } : f;
    showMenu(null, [
      { label: 'Open', action: () => openRef(ref) },
      { label: 'Open side by side', action: async () => { const prev = active; const t = await openRef(ref, { background: true }); if (t) { activate(prev); startSplit(t); } } },
      '-',
      { label: 'New file here…', disabled: !canEditFolder(folder), action: () => fsNewFile(folder, parentRel(f.rel)) },
      { label: 'Rename…', disabled: !canEditFolder(folder), action: () => fsRename(folder, f) },
      { label: native ? 'Move to Trash' : 'Delete…', disabled: !canEditFolder(folder), action: () => fsDelete(folder, f) },
      '-',
      { label: `Show in ${Host.fileManager}`, disabled: !(native && f.path), action: () => native.post({ cmd: 'reveal', path: f.path }) },
      { label: 'Copy path', disabled: !f.path, action: () => { copyRich(esc(f.path), f.path); toast('Path copied'); } },
    ], at);
  } else {
    const [fid, rel] = dirEl.dataset.dir.split(/\|(.*)/s);
    const folder = folders.find(x => x.id === fid);
    const path = folder.path && [folder.path, rel].filter(Boolean).join('/');
    showMenu(null, [
      { label: 'New file here…', disabled: !canEditFolder(folder), action: () => fsNewFile(folder, rel) },
      { label: 'Reload folder', action: () => refreshFolder(folder, false) },
      { label: `Show in ${Host.fileManager}`, disabled: !(native && path), action: () => native.post({ cmd: 'reveal', path }) },
      ...(rel ? [] : ['-', { label: 'Remove from sidebar', action: () => { folders.splice(folders.indexOf(folder), 1); renderTree(); scheduleSave(); } }]),
    ], at);
  }
});
$('#tree').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[role=button]')) e.target.click(); });
$('#treeFilter').addEventListener('input', debounce(e => {
  treeQuery = e.target.value.trim();
  if (!searchMode) renderTree();
  else if (!treeQuery) { search = null; renderTree(); }
}, 120));
$('#treeFilter').addEventListener('keydown', e => { if (e.key === 'Enter' && searchMode) runSearch(e.target.value); });
$('#treeMode').onclick = () => {
  searchMode = !searchMode;
  $('#treeMode').classList.toggle('on', searchMode);
  $('#treeFilter').placeholder = searchMode ? 'Search inside files, press Enter' : 'Filter file names';
  search = null;
  if (searchMode && treeQuery) runSearch(treeQuery); else renderTree();
  $('#treeFilter').focus();
};

// sidebar
const toggleSide = () => { $('#app').classList.toggle('noside'); scheduleSave(); };
$('#btnHideSide').onclick = toggleSide;
$('#btnShowSide').onclick = toggleSide;
$('#sideOpen').onclick = () => pickFiles();
$('#sideFolder').onclick = () => pickFolder();
if (innerWidth < 720) $('#app').classList.add('noside');

// ---------------------------------------------------------------- drag & drop (browser; the Mac app handles drops natively)
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; $('#dropHint').classList.remove('hide'); } });
addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('#dropHint').classList.add('hide'); } });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', async e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropHint').classList.add('hide');
  const entries = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  const looseFiles = [];
  if (!entries.length) return openRefs([...e.dataTransfer.files].map(f => ({ name: f.name, file: f })));
  const fileOf = entry => new Promise((res, rej) => entry.file(res, rej));
  const readAll = reader => new Promise((res, rej) => {
    const all = [];
    const next = () => reader.readEntries(batch => batch.length ? (all.push(...batch), next()) : res(all), rej);
    next();
  });
  async function walk(dir, prefix, out) {
    for (const en of await readAll(dir.createReader())) {
      if (out.length > 20000) break;
      if (en.isDirectory) { if (!SKIP_DIR.test(en.name)) await walk(en, prefix + en.name + '/', out); }
      else if (!en.name.startsWith('.')) out.push({ rel: prefix + en.name, file: await fileOf(en) });
    }
    return out;
  }
  for (const en of entries) {
    if (en.isDirectory) addFolder({ name: en.name, files: await walk(en, '', []) });
    else looseFiles.push({ name: en.name, file: await fileOf(en) });
  }
  openRefs(looseFiles);
});

// ---------------------------------------------------------------- commands & shortcuts
function undoCmd() {
  if (active?.view?.undo && !isTyping(document.activeElement)) active.view.undo();
  else document.execCommand('undo');
}
function cycleTab(d) {
  if (!tabs.length) return;
  activate(tabs[(tabs.indexOf(active) + d + tabs.length) % tabs.length]);
}
// Called from the macOS menu bar
window.appCmd = {
  newTab: () => newHomeTab(),
  newFile,
  open: () => pickFiles(),
  openFolder: () => pickFolder(),
  openVideo: () => pickFiles('media'),
  save: () => saveTab(active),
  saveAs: () => saveTab(active, true),
  exportMenu: () => active?.el.querySelector('[data-a=more]')?.click(),
  google: () => active?.view?.google?.(),
  closeTab: () => {
    if (tabs.length === 1 && active?.kind === 'home') return -1;
    closeTab(active);
    return 0;
  },
  nextTab: d => cycleTab(d),
  undo: undoCmd,
  redo: () => document.execCommand('redo'),
  find: () => openFind(active),
  findNext: () => active?.findBar?.next(1),
  toggleSidebar: toggleSide,
  palette: () => openPalette(),
  split: () => $('#btnSplit').click(),
  theme: () => cycleTheme(),
  settings: () => openSettings(),
  dirtyCount: () => tabs.filter(t => t.dirty).length,
  flushSession: () => saveSession(),
};
window.openFromNative = files => openRefs(files);
window.openFolderFromNative = folder => addFolder(folder);

document.addEventListener('keydown', e => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === '\\') { e.preventDefault(); toggleSide(); return; }
  if (mod && k === 'k') { e.preventDefault(); openPalette(); return; }
  if ((mod && k === 'g') || e.key === 'F3') { if (active?.findBar) { e.preventDefault(); active.findBar.next(e.shiftKey ? -1 : 1); } return; }
  if (Host.kind === 'mac') return; // the Mac app's menu bar provides the rest
  if (mod && k === 's') { e.preventDefault(); saveTab(active, e.shiftKey); }
  else if (native && mod && !e.shiftKey && k === 't') { e.preventDefault(); newHomeTab(); }
  else if (native && mod && k === 'w') { e.preventDefault(); closeTab(active); }
  else if (native && mod && k === 'n') { e.preventDefault(); newFile(e.shiftKey ? 'doc' : 'csv'); }
  else if (native && mod && k === 'p') { e.preventDefault(); native.post({ cmd: 'print' }); }
  else if (native && e.ctrlKey && e.key === 'Tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); }
  else if (mod && k === 'o') { e.preventDefault(); e.shiftKey ? pickFolder() : pickFiles(); }
  else if (e.altKey && e.code === 'KeyT') { e.preventDefault(); newHomeTab(); }
  else if (e.altKey && e.code === 'KeyW') { e.preventDefault(); closeTab(active); }
  else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !isTyping(e.target)) { e.preventDefault(); cycleTab(e.key === 'ArrowRight' ? 1 : -1); }
  else if (mod && k === 'f') { e.preventDefault(); openFind(active); }
  else if (mod && k === 'z' && !e.shiftKey && active?.view?.undo && !isTyping(e.target)) { e.preventDefault(); active.view.undo(); }
});
