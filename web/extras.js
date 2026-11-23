'use strict';
// Settings & theme, session restore, file-change detection, command palette, startup.

// ================================================================ settings & theme
const settings = Object.assign({ theme: 'system', backups: true }, (() => { try { return JSON.parse(localStorage.getItem('dd.settings') || '{}'); } catch { return {}; } })());
const saveSettings = () => localStorage.setItem('dd.settings', JSON.stringify(settings));
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : settings.theme;
}
darkQuery.addEventListener?.('change', applyTheme);
function cycleTheme() {
  settings.theme = { system: 'light', light: 'dark', dark: 'system' }[settings.theme] || 'system';
  saveSettings(); applyTheme();
  toast(`Theme: ${{ system: 'match the system', light: 'light', dark: 'dark' }[settings.theme]}`);
}
function openSettings() {
  $('#setTheme').value = settings.theme;
  $('#setBackups').checked = settings.backups;
  $('#gClientId').value = gClientId();
  $('#settings').showModal();
}
$('#btnSettings').onclick = openSettings;
$('#setBackups').closest('label').classList.toggle('hide', !native);
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'save') return;
  settings.theme = $('#setTheme').value;
  settings.backups = $('#setBackups').checked;
  saveSettings(); applyTheme();
  const v = $('#gClientId').value.trim();
  const had = gClientId();
  v ? localStorage.setItem('dd.gClientId', v) : localStorage.removeItem('dd.gClientId');
  gToken = null;
  if (v !== had) toast(v ? (canUploadToGoogle() ? 'Google upload is on' : 'Saved. Direct upload needs the app served over http(s); copy & paste is used meanwhile.') : 'Google upload is off', 5000);
  else toast('Settings saved');
});

// ================================================================ session: reopen tabs, folders and unsaved work
let saveTimer = null, sessionReady = false, pendingSave = false;
function scheduleSave() {
  if (!sessionReady || VIEWER) return; // each extension tab is independent; only desktop/browser editors restore sessions
  pendingSave = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSession, 1200);
}
const storableRef = ref => ref && {
  name: ref.name, path: ref.path || null, url: ref.url || null, handle: ref.handle || null,
  // plain File objects (no path or handle) can be kept in IndexedDB if they're not huge
  file: !ref.path && !ref.handle && ref.file && ref.file.size < 25e6 && kindOf(ref.name) !== 'media' ? ref.file : null,
};
const reopenable = r => r && (r.path || r.url || r.handle || r.file);
async function saveSession() {
  clearTimeout(saveTimer);
  if (!sessionReady) return;
  const kept = [];
  for (const t of tabs) {
    if (t.kind === 'chart' || t.kind === 'diff') continue;
    const e = { kind: t.kind, name: t.name, dirty: t.dirty, ref: storableRef(t.ref) };
    if (t.kind !== 'home' && (t.dirty || !reopenable(e.ref)) && t.view?.draft) {
      try { e.draft = t.view.draft(); } catch { /* skip */ }
    }
    if (t.kind !== 'home' && !e.draft && !reopenable(e.ref)) continue;
    kept.push([t, e]);
  }
  const idx = t => kept.findIndex(([k]) => k === t);
  const out = {
    v: 1,
    tabs: kept.map(([, e]) => e),
    active: idx(active),
    split: split ? [idx(split.left), idx(split.right)] : null,
    sidebar: !$('#app').classList.contains('noside'),
    folders: folders.filter(f => (native && f.path) || f.handle).map(f => ({ name: f.name, path: f.path, handle: f.handle || null, open: [...f.open] })),
  };
  await Store.set('session', out);
  pendingSave = false;
}
function restoreDraft(tab, d) {
  if (d.type === 'csv') CsvView(tab, d);
  else if (d.type === 'doc') DocView(tab, d.html);
  else if (tab.kind === 'json') JsonView(tab, d.text);
  else TextView(tab, d.text);
}
function permissionPlaceholder(tab, ref) {
  tab.el.innerHTML = `<div class="err"><b>${esc(ref.name)}</b>The browser needs your OK to open this file again. <button class="primary">Reopen file</button></div>`;
  tab.el.querySelector('button').onclick = async () => {
    try {
      if ((await ref.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
      await loadInto(tab, ref);
      scheduleSave();
    } catch (e) { toast(`Couldn't reopen: ${e.message}`, 5000); }
  };
}
async function restoreSession() {
  const s = await Store.get('session');
  if (!s?.tabs?.length && !s?.folders?.length) return false;
  if (s.sidebar === false) $('#app').classList.add('noside');
  for (const f of s.folders || []) {
    try {
      if (f.path && native) {
        const res = await nativeCall('listFolder', { path: f.path });
        if (res) addFolder({ ...res, quiet: true, open: new Set(f.open) });
      } else if (f.handle) {
        const perm = await f.handle.queryPermission?.({ mode: 'readwrite' });
        if (perm === 'granted') addFolder({ name: f.name, handle: f.handle, files: await walkHandle(f.handle), quiet: true, open: new Set(f.open) });
        else { const folder = addFolder({ name: f.name, handle: f.handle, files: [], quiet: true, open: new Set(f.open) }); folder.needsPermission = true; renderTree(); }
      }
    } catch { /* folder gone */ }
  }
  const created = [];
  let drafts = 0;
  for (const e of s.tabs || []) {
    let tab = null;
    try {
      const ref = reopenable(e.ref) ? Object.fromEntries(Object.entries(e.ref).filter(([, v]) => v != null)) : null;
      if (e.kind === 'home') tab = newHomeTab();
      else if (e.draft) {
        tab = addTab(e.kind, e.name, { ref, key: ref && refKey(ref) });
        restoreDraft(tab, e.draft);
        if (e.dirty) { tab.dirty = true; drafts++; }
        if (ref) tab.mtime = await statRef(ref);
      } else if (ref?.url) { openVideoURL(ref.url); tab = active; }
      else if (ref?.path && native) tab = await openRef(ref);
      else if (ref?.file) tab = await openRef(ref);
      else if (ref?.handle) {
        const perm = await ref.handle.queryPermission?.({ mode: 'read' });
        if (perm === 'granted') tab = await openRef(ref);
        else { tab = addTab(e.kind, e.name, { ref, key: refKey(ref) }); permissionPlaceholder(tab, ref); }
      }
    } catch (err) { console.warn('restore failed', e.name, err); }
    created.push(tab);
  }
  if (!tabs.length) return false;
  const act = created[s.active] || tabs[0];
  activate(act);
  if (s.split && created[s.split[0]] && created[s.split[1]] && created[s.split[0]] !== created[s.split[1]]) {
    activate(created[s.split[0]]); startSplit(created[s.split[1]]); activate(act);
  }
  renderTabs();
  if (drafts) toast(`Restored ${drafts} tab${drafts === 1 ? '' : 's'} with unsaved changes`, 4000);
  return true;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && pendingSave) saveSession(); });
addEventListener('pagehide', () => { if (pendingSave) saveSession(); });
addEventListener('beforeunload', e => { if (!native && pendingSave && tabs.some(t => t.dirty)) { saveSession(); e.preventDefault(); } });

// ================================================================ notice files changed by other apps
async function checkExternal() {
  for (const t of tabs) {
    if (!t.ref || t.mtime == null || t.checking || t.kind === 'media') continue;
    if (!(t.ref.path && native) && !t.ref.handle) continue;
    t.checking = true;
    const m = await statRef(t.ref);
    t.checking = false;
    if (m == null || m === t.mtime) continue;
    t.mtime = m;
    if (!t.dirty) {
      try { await loadInto(t, t.ref); toast(`${t.name} was changed by another app and has been reloaded`, 3500); } catch { /* ignore */ }
    } else if (!t.el.querySelector('.banner')) {
      const b = document.createElement('div');
      b.className = 'banner';
      b.innerHTML = `<span>“${esc(t.name)}” was changed by another app.</span><button data-b="reload">Load their version</button><button data-b="keep">Keep mine</button>`;
      b.onclick = async e => {
        const a = e.target.closest('[data-b]')?.dataset.b;
        if (!a) return;
        b.remove();
        if (a === 'reload') { await loadInto(t, t.ref); setDirty(t, false); }
      };
      (t.el.querySelector('.toolbar') || t.el.firstElementChild)?.after(b);
    }
  }
}
setInterval(() => { if (document.visibilityState === 'visible') checkExternal(); }, 4000);
addEventListener('focus', () => checkExternal());

// ================================================================ command palette (⌘K / Ctrl+K)
function paletteCommands() {
  const cmds = [
    ['New tab', () => newHomeTab()],
    ['New spreadsheet (CSV)', () => newFile('csv')],
    ['New Excel workbook', () => newFile('xlsx')],
    ['New document', () => newFile('doc')],
    ['New JSON file', () => newFile('json')],
    ['New Markdown note', () => newFile('md')],
    ['New text file', () => newFile('text')],
    ['Open files…', () => pickFiles()],
    ['Open folder…', () => pickFolder()],
    ['Open video…', () => pickFiles('media')],
    ['Save', () => saveTab(active)],
    ['Save as…', () => saveTab(active, true)],
    ['Close tab', () => closeTab(active)],
    ['Find & replace', () => openFind(active)],
    ['Search inside folder files', () => { if (!searchMode) $('#treeMode').click(); $('#app').classList.remove('noside'); $('#treeFilter').focus(); }],
    ['Show or hide sidebar', toggleSide],
    [split ? 'Close side by side' : 'Show two tabs side by side…', () => split ? closeSplit() : $('#btnSplit').click()],
    ['Compare this tab with…', () => { const o = tabs.filter(t => t !== active && t.view?.text); if (!active?.view?.text || !o.length) return toast('Open two files (text, CSV, JSON or documents) to compare'); pickTab('Compare with', o, t => compareTabs(active, t)); }],
    ['Reload from disk', () => active && reloadTab(active)],
    ['Theme: light', () => { settings.theme = 'light'; saveSettings(); applyTheme(); }],
    ['Theme: dark', () => { settings.theme = 'dark'; saveSettings(); applyTheme(); }],
    ['Theme: match the system', () => { settings.theme = 'system'; saveSettings(); applyTheme(); }],
    ['Settings…', openSettings],
  ].map(([label, run]) => ({ label, run, hint: 'Command' }));
  if (VIEWER) {
    const editing = /^(New |Save|Reload from disk|Theme|Settings)/;
    cmds.splice(0, cmds.length, ...cmds.filter(c => !editing.test(c.label)),
      { label: 'Edit in the Docs & Data app', run: () => active && active.kind !== 'home' ? editInApp(active) : openAppHome(), hint: 'Command' },
      ...['Theme: light', 'Theme: dark', 'Theme: match the system'].map(l => cmds.find(c => c.label === l)).filter(Boolean));
  } else for (const it of active?.view?.exports?.() || []) if (it !== '-' && !it.disabled) cmds.push({ label: it.label, run: it.action, hint: active.name });
  for (const t of tabs) if (t !== active) cmds.push({ label: `Go to ${t.name}`, run: () => activate(t), hint: 'Tab' });
  for (const f of folders) for (const file of f.files.slice(0, 3000)) cmds.push({ label: file.rel, run: () => openRef(file.path ? { name: file.name, path: file.path } : file), hint: f.name });
  return cmds;
}
function fuzzy(label, q) {
  if (!q) return 1;
  const l = label.toLowerCase();
  const i = l.indexOf(q);
  if (i >= 0) return 1000 - i * 2 - l.length / 100 + (i === 0 || /[\s/\-_.(]/.test(l[i - 1]) ? 200 : 0);
  let j = 0, gaps = 0;
  for (let k = 0; k < l.length && j < q.length; k++) { if (l[k] === q[j]) j++; else if (j) gaps++; }
  return j === q.length ? 100 - gaps : null;
}
function openPalette() {
  const d = $('#palette'), input = $('#palInput'), list = $('#palList');
  const cmds = paletteCommands();
  let shownCmds = [], sel = 0;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    shownCmds = cmds.map(c => [c, fuzzy(c.label, q)]).filter(([, s]) => s != null).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([c]) => c);
    sel = Math.min(sel, Math.max(0, shownCmds.length - 1));
    list.innerHTML = shownCmds.map((c, i) => `<li role="option" data-i="${i}" aria-selected="${i === sel}" class="${i === sel ? 'on' : ''}"><span>${esc(c.label)}</span><span class="hint">${esc(c.hint)}</span></li>`).join('') || '<li class="none">Nothing found</li>';
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const run = i => { const c = shownCmds[i]; if (!c) return; d.close(); setTimeout(() => c.run(), 0); };
  input.value = '';
  input.oninput = () => { sel = 0; render(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shownCmds.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
  };
  list.onclick = e => { const li = e.target.closest('[data-i]'); if (li) run(+li.dataset.i); };
  d.onclick = e => { if (e.target === d) d.close(); };
  render();
  d.showModal();
  input.focus();
}
$('#btnPalette').onclick = openPalette;

// ================================================================ startup
applyTheme();
renderTree();
if (gClientId() && canUploadToGoogle()) loadGoogleScript().catch(() => {});
(async () => {
  if (VIEWER) {
    sessionReady = true;
    await extStartup(); // opens whatever the address asks for (?open=file://…, ?url=…), or the home page
    if (!tabs.length) newHomeTab();
    return;
  }
  restoring = true;
  try { await restoreSession(); } catch (e) { console.error('Could not restore the last session', e); }
  restoring = false;
  sessionReady = true;
  if (!tabs.length) newHomeTab();
  scheduleSave();
  if (native) nativeCall('ready').catch(() => {}); // desktop apps send files waiting to be opened
})();
