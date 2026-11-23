'use strict';
// Tab views: spreadsheet (CSV/TSV/XLSX/JSONL), JSON, text (Markdown/HTML/XML/YAML), documents, media, charts, compare.

// ================================================================ shared helpers
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function indicesOf(text, { q, caseSensitive }, limit = 5000) {
  const out = [];
  if (!q) return out;
  const hay = caseSensitive ? text : text.toLowerCase(), needle = caseSensitive ? q : q.toLowerCase();
  for (let i = hay.indexOf(needle); i >= 0 && out.length < limit; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}
const replaceIn = (s, { q, caseSensitive }, r) => s.replace(new RegExp(escapeRe(q), caseSensitive ? 'g' : 'gi'), () => r);
function htmlToText(html) {
  const d = document.createElement('div');
  d.innerHTML = html.replace(/<\/(p|h[1-6]|li|blockquote|tr|div|pre)>/gi, '$&\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/t[dh]>/gi, '\t$&');
  return d.textContent.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
const fmtNum = (n, compact) => new Intl.NumberFormat(undefined, compact ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: 2 }).format(n);
const toNum = v => { const s = String(v ?? '').replace(/[$€£₹,%\s]/g, ''); return s === '' ? NaN : Number(s); };

// ================================================================ find & replace bar (shared by every editor)
// adapter: { find(opts) → matches[], show(match), replace(match, text, opts), replaceAll(opts, text) → count }
function openFind(tab, query, line) {
  if (!tab?.findAdapter) return toast('Find isn’t available in this tab');
  tab.findBar ||= createFindBar(tab);
  tab.findBar.show(query, line);
}
function createFindBar(tab) {
  const A = tab.findAdapter;
  if (VIEWER) A.readOnly = true;
  const el = document.createElement('div');
  el.className = 'findbar hide';
  el.innerHTML = `
    <input type="search" data-f="q" placeholder="Find" aria-label="Find">
    <input type="text" data-f="r" placeholder="Replace with" aria-label="Replace with" ${A.readOnly ? 'hidden' : ''}>
    <label class="info"><input type="checkbox" data-f="case"> Match case</label>
    <span class="info" data-f="count"></span>
    <button data-f="prev" title="Previous (Shift+Enter)">↑</button>
    <button data-f="next" title="Next (Enter, ${MOD}G)">↓</button>
    ${A.readOnly ? '' : '<button data-f="one">Replace</button><button data-f="all">Replace all</button>'}
    <button class="icon" data-f="close" aria-label="Close find">✕</button>`;
  (tab.el.querySelector('.findbar-slot') || tab.el.querySelector('.toolbar')).after(el);
  const f = n => el.querySelector(`[data-f=${n}]`);
  let matches = [], idx = -1;
  const opts = () => ({ q: f('q').value, caseSensitive: f('case').checked });
  const count = () => { f('count').textContent = !f('q').value ? '' : matches.length ? `${idx >= 0 ? idx + 1 : 0} of ${matches.length}${matches.length >= 5000 ? '+' : ''}` : 'No matches'; };
  const refresh = () => { matches = f('q').value ? A.find(opts()) : []; idx = -1; count(); };
  function next(d = 1) {
    if (!matches.length) refresh();
    if (!matches.length) return;
    idx = (idx + d + matches.length) % matches.length;
    A.show(matches[idx]);
    tab.findArmed = true;
    count();
  }
  f('q').addEventListener('input', debounce(refresh, 150));
  f('case').onchange = refresh;
  f('q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); next(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') hide(); });
  f('r').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.querySelector('[data-f=one]')?.click(); } if (e.key === 'Escape') hide(); });
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-f]')?.dataset.f;
    if (a === 'prev') next(-1);
    else if (a === 'next') next(1);
    else if (a === 'close') hide();
    else if (a === 'one') {
      if (idx < 0) return next(1);
      A.replace(matches[idx], f('r').value, opts());
      const keep = idx;
      matches = A.find(opts());
      idx = Math.min(keep, matches.length) - 1;
      next(1);
      count();
    } else if (a === 'all') {
      if (!f('q').value) return;
      const n = A.replaceAll(opts(), f('r').value);
      toast(n ? `Replaced ${n} match${n === 1 ? '' : 'es'}` : 'No matches');
      refresh();
    }
  });
  // After jumping to a match, Enter keeps going to the next match instead of typing.
  tab.el.addEventListener('keydown', e => {
    if (!tab.findArmed || el.contains(e.target)) return;
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); next(e.shiftKey ? -1 : 1); }
    else if (!['Shift', 'Meta', 'Control', 'Alt'].includes(e.key)) tab.findArmed = false;
  }, true);
  tab.el.addEventListener('mousedown', e => { if (!el.contains(e.target)) tab.findArmed = false; }, true);
  function hide() { el.classList.add('hide'); tab.findArmed = false; }
  return {
    show(query, line) {
      el.classList.remove('hide');
      if (query != null) f('q').value = query;
      else { const s = String(getSelection() || '').trim(); if (s && !s.includes('\n') && s.length < 200) f('q').value = s; }
      f('q').focus(); f('q').select();
      refresh();
      if (query != null && matches.length) {
        if (line && A.lineOf) idx = Math.max(-1, matches.findIndex(m => A.lineOf(m) >= line) - 1);
        next(1);
      }
    },
    next, hide, refresh,
  };
}
function textareaAdapter(ta, onEdit) {
  const lineOf = m => ta.value.slice(0, m.i).split('\n').length;
  return {
    lineOf,
    find: o => indicesOf(ta.value, o).map(i => ({ i, len: o.q.length })),
    show(m) {
      ta.focus();
      ta.setSelectionRange(m.i, m.i + m.len);
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      ta.scrollTop = Math.max(0, (lineOf(m) - 6) * lh);
    },
    replace(m, r) {
      ta.focus();
      ta.setSelectionRange(m.i, m.i + m.len);
      if (!document.execCommand('insertText', false, r)) ta.setRangeText(r, m.i, m.i + m.len, 'end');
      onEdit();
    },
    replaceAll(o, r) {
      const n = indicesOf(ta.value, o, Infinity).length;
      if (!n) return 0;
      const v = replaceIn(ta.value, o, r);
      ta.focus(); ta.select();
      if (!document.execCommand('insertText', false, v)) ta.value = v;
      onEdit();
      return n;
    },
  };
}

// ================================================================ collapsible value tree (JSON, XML, YAML)
function ValueTree(container, value) {
  const node = (v, key) => {
    const k = key != null ? `<span class="k">${esc(key)}</span>: ` : '';
    if (v === null || typeof v !== 'object') {
      const cls = typeof v === 'string' ? 's' : typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : 'z';
      return `<div class="leaf">${k}<span class="${cls}">${esc(typeof v === 'string' ? JSON.stringify(v) : String(v))}</span></div>`;
    }
    const isArr = Array.isArray(v), n = isArr ? v.length : Object.keys(v).length;
    return `<details><summary>${k}<span class="meta">${isArr ? `[${n} items]` : `{${n} keys}`}</span></summary><div class="kids"></div></details>`;
  };
  // children are rendered only when a branch is opened, so huge files stay fast
  const fill = d => {
    if (d._filled) return;
    d._filled = true;
    const v = d._v, kids = d.querySelector('.kids');
    const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
    const shown = entries.slice(0, 1000);
    kids.innerHTML = shown.map(([k, x]) => node(x, k)).join('') + (entries.length > 1000 ? `<div class="leaf meta">…and ${entries.length - 1000} more</div>` : '');
    const ds = kids.querySelectorAll(':scope > details');
    let j = 0;
    shown.forEach(([, x]) => { if (x && typeof x === 'object') ds[j++]._v = x; });
  };
  container.innerHTML = node(value, null);
  const root = container.querySelector('details');
  if (root) { root._v = value; fill(root); root.open = true; }
  if (!container._wired) {
    container._wired = true;
    container.addEventListener('toggle', e => { if (e.target.open && e.target._v !== undefined) fill(e.target); }, true);
  }
}

// ================================================================ spreadsheets
function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 10);
  let best = ',', bestScore = 0;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map(l => l.split(d).length - 1);
    const min = Math.min(...counts);
    const score = min > 0 ? min * 10 + counts.filter(c => c === counts[0]).length : 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}
function parseCSV(text, delim) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}
function toCSV(headers, rows, delim = ',', eol = '\r\n', finalEol = true) {
  const cell = v => {
    v = v == null ? '' : String(v);
    return /["\r\n]/.test(v) || v.includes(delim) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return [headers, ...rows].map(r => r.map(cell).join(delim)).join(eol) + (finalEol ? eol : '');
}
function cellType(v) {
  v = (v ?? '').trim();
  if (!v) return 'empty';
  if (/^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?%?$/.test(v.replace(/^[$€£₹]/, '')) && /\d/.test(v)) return 'num';
  if (/^(true|false|yes|no)$/i.test(v)) return 'bool';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'email';
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?/.test(v) || /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(v) || /^(19|20)\d\d-(0[1-9]|1[0-2])$/.test(v)) return 'date';
  return 'text';
}
const TYPE_LABEL = { num: 'number', date: 'date', bool: 'yes/no', email: 'email', text: 'text', empty: '' };
const PALETTE = ['#2b59c3', '#0f7b5f', '#a96500', '#8a3fa0', '#c2410c', '#0e7490', '#4d7c0f', '#be185d', '#4338ca', '#57534e'];
const pad = (r, n) => { r = r.slice(0, n); while (r.length < n) r.push(''); return r; };
function typed(v) {
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/.test(v) && v.length < 16) return Number(v);
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  return v;
}
const rowsToObjects = (headers, rows) => rows.map(r => Object.fromEntries(headers.map((h, i) => [h, typed(r[i] ?? '')])));
function tableHTML(headers, rows) {
  return '<table>' + (headers ? '<thead><tr>' + headers.map(h => `<th>${esc(h)}</th>`).join('') + '</tr></thead>' : '') + '<tbody>' +
    rows.map(r => '<tr>' + r.map(v => `<td>${esc(v)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
}
function sheetFromRows(name, all) {
  if (!all.length) all = [['Column 1']];
  const width = Math.max(1, ...all.map(r => r.length));
  return { name, headers: pad(all[0].map(String), width).map((h, i) => h.trim() || `Column ${i + 1}`), rows: all.slice(1).map(r => pad(r.map(v => v == null ? '' : String(v)), width)) };
}
function tabular(value) {
  if (value && !Array.isArray(value) && typeof value === 'object') {
    const arr = Object.values(value).find(v => Array.isArray(v) && v.length && v.every(x => x && typeof x === 'object'));
    if (arr) value = arr;
  }
  if (!Array.isArray(value) || !value.length) return null;
  const cell = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (value.every(Array.isArray)) {
    const width = Math.max(...value.map(r => r.length));
    return { headers: pad(value[0].map(cell), width).map((h, i) => h || `Column ${i + 1}`), rows: value.slice(1).map(r => pad(r.map(cell), width)) };
  }
  if (value.every(x => x === null || typeof x !== 'object')) return { headers: ['value'], rows: value.map(v => [cell(v)]) };
  if (!value.every(x => x && typeof x === 'object' && !Array.isArray(x))) return null;
  const headers = [...new Set(value.flatMap(Object.keys))];
  return { headers, rows: value.map(o => headers.map(h => cell(o[h]))) };
}
function parseJSONL(text) {
  const items = [];
  text.split(/\r?\n/).forEach((l, i) => {
    if (!l.trim()) return;
    try { items.push(JSON.parse(l)); } catch (e) { throw new Error(`Line ${i + 1} is not valid JSON: ${e.message}`); }
  });
  return tabular(items.map(x => x && typeof x === 'object' && !Array.isArray(x) ? x : { value: x })) || { headers: ['value'], rows: [] };
}
// column filters: "text" (contains), "=x", "!=x", ">10", "<=5", "empty", "!empty"
function parseFilter(text) {
  text = text.trim();
  if (/^!?empty$/i.test(text)) return { op: text.startsWith('!') ? 'notempty' : 'empty', val: '', label: text.startsWith('!') ? 'not empty' : 'empty' };
  const m = /^(>=|<=|!=|=|>|<)\s*(.*)$/.exec(text);
  return m ? { op: m[1], val: m[2], label: `${m[1]} ${m[2]}` } : { op: 'contains', val: text, label: `contains “${text}”` };
}
function matchFilter(f, v) {
  v = String(v ?? '');
  const a = toNum(v), b = toNum(f.val), numeric = !isNaN(a) && !isNaN(b);
  const cmp = numeric ? a - b : v.localeCompare(f.val, undefined, { numeric: true, sensitivity: 'base' });
  switch (f.op) {
    case 'contains': return v.toLowerCase().includes(f.val.toLowerCase());
    case '=': return numeric ? a === b : v.toLowerCase() === f.val.toLowerCase();
    case '!=': return numeric ? a !== b : v.toLowerCase() !== f.val.toLowerCase();
    case '>': return cmp > 0; case '<': return cmp < 0; case '>=': return cmp >= 0; case '<=': return cmp <= 0;
    case 'empty': return !v.trim();
    case 'notempty': return !!v.trim();
  }
  return true;
}
function columnStats(values) {
  const nonEmpty = values.filter(v => String(v).trim() !== '');
  const nums = nonEmpty.map(toNum).filter(n => !isNaN(n));
  const counts = new Map();
  for (const v of nonEmpty) counts.set(v, (counts.get(v) || 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const s = { count: values.length, filled: nonEmpty.length, empty: values.length - nonEmpty.length, unique: counts.size, top };
  if (nums.length) {
    const sorted = [...nums].sort((a, b) => a - b);
    Object.assign(s, { numbers: nums.length, sum: nums.reduce((x, y) => x + y, 0), min: sorted[0], max: sorted.at(-1),
      median: sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 });
    s.avg = s.sum / nums.length;
  }
  return s;
}

function CsvView(tab, init) {
  // ---- state
  let format = init.format || 'csv', delim = ',', bom = false, eol = '\r\n', finalEol = true;
  let sheets;
  if (init.text != null) {
    const t = init.text;
    let data;
    if (format === 'jsonl') data = parseJSONL(t);
    else {
      bom = t.charCodeAt(0) === 0xFEFF;
      delim = format === 'tsv' ? '\t' : detectDelimiter(t);
      data = sheetFromRows('', parseCSV(t, delim));
      eol = t.includes('\r\n') ? '\r\n' : '\n';
      finalEol = /\r?\n$/.test(t);
    }
    sheets = [{ name: baseName(tab.name), headers: data.headers, rows: data.rows }];
  } else {
    sheets = init.sheets.map(s => ({ name: s.name, headers: s.headers.slice(), rows: s.rows.map(r => r.slice()) }));
    ({ delim = delim, bom = bom, eol = eol, finalEol = finalEol } = init);
  }
  for (const s of sheets) Object.assign(s, { undo: [], edited: new Set(), sort: { col: -1, dir: 1 }, filters: [], query: '', limit: 500, scroll: [0, 0] });
  let cur = Math.min(init.cur || 0, sheets.length - 1);
  let S = sheets[cur];
  let shown = []; // real row indices currently rendered, in display order
  let sel = null; // { a: [vi, c], b: [vi, c] } in visible positions

  tab.el.innerHTML = `
    <div class="toolbar">
      <button data-a="row" class="edit-only">＋ Row</button>
      <button data-a="col" class="edit-only">＋ Column</button>
      <button data-a="undo" class="edit-only" disabled title="Undo (${MOD}Z)">Undo</button>
      <span class="sep edit-only"></span>
      <input type="search" data-a="search" placeholder="Filter rows" aria-label="Filter rows">
      <button data-a="find" title="Find & replace (${MOD}F)">Find</button>
      <label class="info"><input type="checkbox" data-a="color" checked> Colour by type</label>
      <span class="sp"></span>
      <button data-a="chart">Chart</button>
      <button data-a="google">Google Sheets</button>
      <button data-a="more">Tools ▾</button>
      <button data-a="save" class="primary">Save</button>
    </div>
    <div class="chips hide findbar-slot"></div>
    <div class="body"><table class="grid color"><thead></thead><tbody></tbody></table><div class="more hide"></div></div>
    <div class="statusbar"><span data-a="stats"></span><span class="sp"></span><span data-a="selstats"></span></div>
    <div class="sheetbar hide"></div>`;
  const q = s => tab.el.querySelector(s);
  const grid = q('.grid'), body = q('.body');

  // ---- rendering
  const visible = () => {
    const needle = S.query.toLowerCase();
    const idx = [];
    for (let i = 0; i < S.rows.length; i++) {
      const r = S.rows[i];
      if (needle && !r.some(v => String(v).toLowerCase().includes(needle))) continue;
      if (S.filters.length && !S.filters.every(f => matchFilter(f, r[f.c]))) continue;
      idx.push(i);
    }
    return idx;
  };
  const columnType = c => {
    const counts = {};
    for (let i = 0; i < Math.min(S.rows.length, 2000); i++) { const t = cellType(S.rows[i][c]); if (t !== 'empty') counts[t] = (counts[t] || 0) + 1; }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'empty';
  };
  function render() {
    const filtered = new Set(S.filters.map(f => f.c));
    q('thead').innerHTML = '<tr><th class="rn">#</th>' + S.headers.map((h, i) => {
      const arrow = S.sort.col === i ? (S.sort.dir > 0 ? '▲' : '▼') : '⇅';
      return `<th style="--col:${PALETTE[i % PALETTE.length]}"${filtered.has(i) ? ' class="filtered"' : ''}><div class="hcell">
        <span class="hname"${VIEWER ? '' : ' contenteditable'} spellcheck="false" data-c="${i}">${esc(h)}</span>
        <span class="htype">${TYPE_LABEL[columnType(i)]}</span>
        <button class="hbtn" data-sort="${i}" title="Sort by ${esc(h)}">${arrow}</button>
        <button class="hbtn" data-colmenu="${i}" title="Column options: filter, stats, chart…" aria-label="Options for ${esc(h)}">▾</button></div></th>`;
    }).join('') + '</tr>';
    const idx = visible();
    shown = idx.slice(0, S.limit);
    q('tbody').innerHTML = shown.map((ri, vi) => `<tr><td class="rn">${ri + 1}<button data-delrow="${ri}" title="Delete row" tabindex="-1">✕</button></td>` +
      S.rows[ri].map((v, ci) => `<td class="cell t-${cellType(v)}${S.edited.has(ri + ':' + ci) ? ' edited' : ''}" ${VIEWER ? 'tabindex="-1"' : 'contenteditable'} spellcheck="false" data-r="${ri}" data-v="${vi}" data-c="${ci}">${esc(v)}</td>`).join('') + '</tr>').join('');
    const more = q('.more');
    more.classList.toggle('hide', idx.length <= S.limit);
    more.innerHTML = `Showing ${shown.length.toLocaleString()} of ${idx.length.toLocaleString()} rows. <button data-a="showmore">Show more</button> <button data-a="showall">Show all</button>`;
    q('[data-a=undo]').disabled = !S.undo.length;
    const chips = q('.chips');
    chips.classList.toggle('hide', !S.filters.length);
    chips.innerHTML = S.filters.length ? `<span class="info">Filters:</span>` + S.filters.map((f, i) => `<span class="chip">${esc(S.headers[f.c])} ${esc(f.label)}<button data-unfilter="${i}" aria-label="Remove filter">✕</button></span>`).join('') + `<button class="link" data-unfilter="all">Clear all</button>` : '';
    renderSheets();
    paintSel();
    stats(idx.length);
  }
  function stats(visibleCount = visible().length) {
    const filteredNote = visibleCount !== S.rows.length ? ` · ${visibleCount.toLocaleString()} shown` : '';
    q('[data-a=stats]').textContent = `${S.rows.length.toLocaleString()} rows × ${S.headers.length} columns${filteredNote}${S.edited.size ? ` · ${S.edited.size} edited` : ''}`;
  }
  function renderSheets() {
    const bar = q('.sheetbar');
    const showBar = format === 'xlsx' || sheets.length > 1;
    bar.classList.toggle('hide', !showBar);
    if (!showBar) return;
    bar.innerHTML = sheets.map((s, i) => `<button class="sheet${i === cur ? ' on' : ''}" data-sheet="${i}" title="Double-click to rename">${esc(s.name)}</button>`).join('') +
      (VIEWER ? '' : `<button class="icon" data-a="addsheet" title="Add sheet" aria-label="Add sheet">＋</button>`);
  }
  function switchSheet(i) {
    if (i === cur) return;
    commit();
    S.scroll = [body.scrollLeft, body.scrollTop];
    cur = i; S = sheets[i]; sel = null;
    q('[data-a=search]').value = S.query;
    render();
    [body.scrollLeft, body.scrollTop] = S.scroll;
  }

  // ---- undo
  function push(entry) {
    S.undo.push(entry);
    if (S.undo.length > 200) S.undo.shift();
    q('[data-a=undo]').disabled = false;
    setDirty(tab);
  }
  const full = () => ({ type: 'full', headers: S.headers.slice(), rows: S.rows.map(r => r.slice()), edited: new Set(S.edited) });
  function undo() {
    const u = S.undo.pop();
    if (!u) return;
    if (u.type === 'cell') { S.rows[u.r][u.c] = u.old; if (!u.wasEdited) S.edited.delete(u.r + ':' + u.c); }
    else if (u.type === 'head') S.headers[u.c] = u.old;
    else if (u.type === 'addrow') S.rows.pop();
    else if (u.type === 'delrow') { S.rows.splice(u.r, 0, u.row); S.edited = u.edited; }
    else { S.headers = u.headers; S.rows = u.rows; S.edited = u.edited; }
    render();
    toast('Undone', 1200);
  }

  // ---- editing
  let before = null;
  grid.addEventListener('focusin', e => { if (e.target.isContentEditable) before = e.target.innerText; });
  grid.addEventListener('focusout', e => {
    const el = e.target;
    if (!el.isContentEditable) return;
    const val = el.innerText.replace(/\n$/, '');
    if (val === before) return;
    const c = +el.dataset.c;
    if (el.classList.contains('hname')) {
      push({ type: 'head', c, old: S.headers[c] });
      S.headers[c] = val.trim() || `Column ${c + 1}`;
    } else setCell(+el.dataset.r, c, val, el);
    stats();
  });
  function setCell(r, c, val, el) {
    const k = r + ':' + c;
    push({ type: 'cell', r, c, old: S.rows[r][c], wasEdited: S.edited.has(k) });
    S.rows[r][c] = val;
    S.edited.add(k);
    el ||= grid.querySelector(`td.cell[data-r="${r}"][data-c="${c}"]`);
    if (el) { el.className = `cell t-${cellType(val)} edited`; if (el !== document.activeElement) el.textContent = val; }
    const lbl = grid.querySelectorAll('thead .htype')[c];
    if (lbl) lbl.textContent = TYPE_LABEL[columnType(c)];
  }
  grid.addEventListener('keydown', e => {
    const el = e.target;
    if (!el.isContentEditable) return;
    if (el.classList.contains('hname') && e.key === 'Enter') { e.preventDefault(); el.blur(); return; }
    if (!el.classList.contains('cell')) return;
    const v = +el.dataset.v, c = +el.dataset.c;
    let to = null;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); to = [v + 1, c]; }
    else if (e.key === 'Tab') { e.preventDefault(); to = e.shiftKey ? [v, c - 1] : [v, c + 1]; }
    else if (e.key === 'Escape') { el.innerText = before; el.blur(); }
    else if (e.altKey && e.key === 'ArrowDown') to = [v + 1, c];
    else if (e.altKey && e.key === 'ArrowUp') to = [v - 1, c];
    else if (e.shiftKey && e.key.startsWith('Arrow') && sel) { // extend selection with Shift+arrows
      const getSelText = getSelection();
      const atEdge = !getSelText.toString() || getSelText.toString() === el.innerText;
      if (atEdge) {
        e.preventDefault();
        const [bv, bc] = sel.b;
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
        sel.b = [Math.max(0, Math.min(shown.length - 1, bv + d[0])), Math.max(0, Math.min(S.headers.length - 1, bc + d[1]))];
        el.blur(); getSelection().removeAllRanges();
        paintSel();
      }
    }
    if (to) focusCell(...to);
  });
  function focusCell(v, c) {
    const el = grid.querySelector(`td.cell[data-v="${v}"][data-c="${c}"]`);
    if (!el) return;
    el.focus();
    const range = document.createRange(); range.selectNodeContents(el);
    const s = getSelection(); s.removeAllRanges(); s.addRange(range);
    sel = { a: [v, c], b: [v, c] };
    paintSel();
  }
  const shiftEdited = fn => {
    const s = new Set();
    S.edited.forEach(k => { const [r, c] = k.split(':').map(Number); const n = fn(r, c); if (n) s.add(n.join(':')); });
    return s;
  };

  // ---- cell range selection (drag, Shift+click, Shift+arrows) with copy / cut / paste / delete
  const selRect = () => sel && {
    v0: Math.min(sel.a[0], sel.b[0]), v1: Math.max(sel.a[0], sel.b[0]),
    c0: Math.min(sel.a[1], sel.b[1]), c1: Math.max(sel.a[1], sel.b[1]),
  };
  const multi = () => { const r = selRect(); return r && (r.v1 > r.v0 || r.c1 > r.c0); };
  function paintSel() {
    grid.querySelectorAll('td.sel').forEach(td => td.classList.remove('sel'));
    const r = selRect();
    const statEl = q('[data-a=selstats]');
    if (!r || !multi()) { statEl.textContent = ''; return; }
    const vals = [];
    for (let v = r.v0; v <= r.v1; v++) {
      const tr = q('tbody').rows[v];
      for (let c = r.c0; c <= r.c1; c++) {
        tr?.cells[c + 1]?.classList.add('sel');
        vals.push(S.rows[shown[v]]?.[c] ?? '');
      }
    }
    const nums = vals.map(toNum).filter(n => !isNaN(n));
    statEl.textContent = `${vals.length} cells` + (nums.length ? ` · Sum ${fmtNum(nums.reduce((a, b) => a + b, 0))} · Average ${fmtNum(nums.reduce((a, b) => a + b, 0) / nums.length)} · Count ${nums.length}` : '');
  }
  const cellAt = e => e.target.closest?.('td.cell');
  let dragging = false;
  grid.addEventListener('mousedown', e => {
    const td = cellAt(e);
    if (!td || e.button !== 0) return;
    const pos = [+td.dataset.v, +td.dataset.c];
    if (e.shiftKey && sel) {
      e.preventDefault();
      if (grid.contains(document.activeElement)) document.activeElement.blur();
      sel.b = pos;
      getSelection().removeAllRanges();
      paintSel();
      return;
    }
    sel = { a: pos, b: pos };
    dragging = true;
    paintSel();
  });
  grid.addEventListener('mouseover', e => {
    if (!dragging) return;
    const td = cellAt(e);
    if (!td) return;
    const pos = [+td.dataset.v, +td.dataset.c];
    if (pos[0] === sel.b[0] && pos[1] === sel.b[1]) return;
    sel.b = pos;
    if (multi()) {
      if (grid.contains(document.activeElement)) document.activeElement.blur();
      getSelection().removeAllRanges();
      grid.classList.add('selecting');
    }
    paintSel();
  });
  document.addEventListener('mouseup', () => { dragging = false; grid.classList.remove('selecting'); });
  function selectionValues() {
    const r = selRect();
    const out = [];
    for (let v = r.v0; v <= r.v1; v++) out.push(S.rows[shown[v]].slice(r.c0, r.c1 + 1));
    return out;
  }
  function clearSelection() {
    const r = selRect();
    push(full());
    for (let v = r.v0; v <= r.v1; v++) for (let c = r.c0; c <= r.c1; c++) { S.rows[shown[v]][c] = ''; S.edited.add(shown[v] + ':' + c); }
    render();
  }
  function pasteGrid(text, at) {
    let data = parseCSV(text.replace(/\r?\n$/, ''), '\t');
    if (!data.length) return;
    const r = selRect();
    const [v0, c0] = at || (r ? [r.v0, r.c0] : [0, 0]);
    push(full());
    // a single value pasted onto a selected range fills the whole range
    if (data.length === 1 && data[0].length === 1 && r && multi()) {
      for (let v = r.v0; v <= r.v1; v++) for (let c = r.c0; c <= r.c1; c++) { S.rows[shown[v]][c] = data[0][0]; S.edited.add(shown[v] + ':' + c); }
      return render();
    }
    const width = Math.max(...data.map(x => x.length));
    while (S.headers.length < c0 + width) { S.headers.push(`Column ${S.headers.length + 1}`); S.rows.forEach(row => row.push('')); }
    data.forEach((vals, k) => {
      let ri = shown[v0 + k];
      if (ri == null) { S.rows.push(S.headers.map(() => '')); ri = S.rows.length - 1; shown.push(ri); }
      vals.forEach((val, j) => { S.rows[ri][c0 + j] = val; S.edited.add(ri + ':' + (c0 + j)); });
    });
    S.limit = Math.max(S.limit, v0 + data.length);
    sel = { a: [v0, c0], b: [v0 + data.length - 1, c0 + width - 1] };
    render();
    toast(`Pasted ${data.length} × ${width} cells`, 1500);
  }
  const ownsEvent = e => active === tab && (grid.contains(e.target) || e.target === document.body || tab.el.contains(e.target)) && !q('.findbar')?.contains(e.target) && !q('.toolbar').contains(e.target);
  document.addEventListener('copy', e => {
    if (!ownsEvent(e) || !multi()) return;
    const vals = selectionValues();
    e.clipboardData.setData('text/plain', vals.map(r => r.map(v => /[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join('\t')).join('\n'));
    e.clipboardData.setData('text/html', tableHTML(null, vals));
    e.preventDefault();
    toast(`Copied ${vals.length * vals[0].length} cells`, 1200);
  });
  document.addEventListener('cut', e => {
    if (VIEWER || !ownsEvent(e) || !multi()) return;
    document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: e.clipboardData }));
    const vals = selectionValues();
    e.clipboardData.setData('text/plain', vals.map(r => r.join('\t')).join('\n'));
    e.preventDefault();
    clearSelection();
  });
  document.addEventListener('paste', e => {
    if (VIEWER || !ownsEvent(e)) return;
    const text = e.clipboardData.getData('text/plain');
    const td = e.target.closest?.('td.cell');
    const isGrid = /[\t\n]/.test(text.replace(/\r?\n$/, ''));
    if (td && !isGrid && !multi()) { e.preventDefault(); document.execCommand('insertText', false, text.replace(/\r?\n$/, '')); return; }
    if (!td && !sel) return;
    e.preventDefault();
    if (td) td.blur();
    pasteGrid(text, td && !multi() ? [+td.dataset.v, +td.dataset.c] : null);
  });
  document.addEventListener('keydown', e => {
    if (VIEWER || active !== tab || !multi() || isTyping(e.target)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSelection(); }
    else if (e.key === 'Escape') { sel = null; paintSel(); }
  });

  // ---- header & row buttons
  grid.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sort != null) sortBy(+b.dataset.sort);
    else if (b.dataset.colmenu != null) showMenu(b, columnMenu(+b.dataset.colmenu));
    else if (b.dataset.delrow != null) {
      const ri = +b.dataset.delrow;
      push({ type: 'delrow', r: ri, row: S.rows[ri], edited: new Set(S.edited) });
      S.rows.splice(ri, 1);
      S.edited = shiftEdited((r, c) => r === ri ? null : [r > ri ? r - 1 : r, c]);
      render();
    }
  });
  function sortBy(c, dir) {
    push(full());
    dir ??= S.sort.col === c ? -S.sort.dir : 1;
    S.sort = { col: c, dir };
    const idx = S.rows.map((_, i) => i).sort((a, b) => {
      const x = S.rows[a][c], y = S.rows[b][c];
      if (!x && y) return 1;
      if (x && !y) return -1;
      const nx = toNum(x), ny = toNum(y);
      const res = !isNaN(nx) && !isNaN(ny) && cellType(x) === 'num' && cellType(y) === 'num' ? nx - ny
        : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      return res * dir;
    });
    const pos = new Map(idx.map((old, nw) => [old, nw]));
    S.rows = idx.map(i => S.rows[i]);
    S.edited = shiftEdited((r, cc) => [pos.get(r), cc]);
    render();
  }
  function insertColumn(at) {
    const name = prompt('Column name:', `Column ${S.headers.length + 1}`);
    if (name == null) return;
    push(full());
    S.headers.splice(at, 0, name.trim() || `Column ${S.headers.length + 1}`);
    S.rows.forEach(r => r.splice(at, 0, ''));
    S.edited = shiftEdited((r, c) => [r, c >= at ? c + 1 : c]);
    S.filters.forEach(f => { if (f.c >= at) f.c++; });
    render();
  }
  function deleteColumn(c) {
    if (!confirm(`Delete column “${S.headers[c]}”?`)) return;
    push(full());
    S.headers.splice(c, 1);
    S.rows.forEach(r => r.splice(c, 1));
    S.edited = shiftEdited((r, cc) => cc === c ? null : [r, cc > c ? cc - 1 : cc]);
    S.filters = S.filters.filter(f => f.c !== c).map(f => ({ ...f, c: f.c > c ? f.c - 1 : f.c }));
    render();
  }
  function addFilter(c) {
    const text = prompt(`Show rows where “${S.headers[c]}”…\n\ncontains:  text\nequals:  =text\nnumbers:  >10   <=5   !=0\nblank cells:  empty  or  !empty`, '');
    if (!text?.trim()) return;
    S.filters.push({ c, ...parseFilter(text) });
    S.limit = 500;
    render();
  }
  function showStats(c) {
    const s = columnStats(visible().map(i => S.rows[i][c]));
    const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
    showInfo(`Column “${S.headers[c]}”`, `<table class="stats">
      ${row('Rows', s.count.toLocaleString())}${row('Filled', s.filled.toLocaleString())}${row('Empty', s.empty.toLocaleString())}${row('Unique values', s.unique.toLocaleString())}
      ${s.numbers ? row('Numbers', s.numbers.toLocaleString()) + row('Sum', fmtNum(s.sum)) + row('Average', fmtNum(s.avg)) + row('Median', fmtNum(s.median)) + row('Min', fmtNum(s.min)) + row('Max', fmtNum(s.max)) : ''}
      </table>${s.top.length ? `<h3>Most common</h3><table class="stats">${s.top.map(([v, n]) => row(esc(v), n.toLocaleString())).join('')}</table>` : ''}
      ${visible().length !== S.rows.length ? '<p>Only rows that match the current filters are counted.</p>' : ''}`);
  }
  function dedupe(c) {
    const seen = new Set(), keep = [];
    for (const r of S.rows) {
      const k = c == null ? JSON.stringify(r) : String(r[c]).trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); keep.push(r);
    }
    const removed = S.rows.length - keep.length;
    if (!removed) return toast('No duplicate rows found');
    push(full());
    S.rows = keep; S.edited = new Set();
    render();
    toast(`Removed ${removed} duplicate row${removed === 1 ? '' : 's'}`);
  }
  function splitBy(c) {
    const groups = new Map();
    for (const r of S.rows) { const k = String(r[c]).trim() || '(empty)'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r.slice()); }
    if (groups.size > 50 && !confirm(`This creates ${groups.size} tabs. Continue?`)) return;
    if (format === 'xlsx' && confirm(`Put the ${groups.size} groups into sheets of this workbook instead of new tabs?`)) {
      for (const [k, rows] of groups) sheets.push(Object.assign({ name: k.slice(0, 31), headers: S.headers.slice(), rows }, { undo: [], edited: new Set(), sort: { col: -1, dir: 1 }, filters: [], query: '', limit: 500, scroll: [0, 0] }));
      setDirty(tab); renderSheets(); return;
    }
    for (const [k, rows] of groups) {
      const t = addTab('csv', `${baseName(tab.name)} - ${k.replace(/[/\\:]/g, '-')}.csv`, { background: true });
      CsvView(t, { sheets: [{ name: k, headers: S.headers.slice(), rows }], format: 'csv' });
      setDirty(t);
    }
    toast(`Opened ${groups.size} new tabs`);
  }
  async function appendFrom() {
    const pickOne = () => new Promise(res => {
      if (native) return nativeCall('pickFiles', { kind: '' }).then(f => res(f?.[0] || null));
      const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.csv,.tsv,.xlsx,.jsonl,.json' });
      inp.onchange = () => res(inp.files[0] ? { name: inp.files[0].name, file: inp.files[0] } : null);
      inp.click();
    });
    const ref = await pickOne();
    if (!ref) return;
    try {
      const e = extOf(ref.name);
      let other;
      if (e === 'xlsx') other = sheetFromRows('', (await Xlsx.read(await readBytes(ref)))[0].rows);
      else if (e === 'jsonl' || e === 'ndjson') other = parseJSONL(await readText(ref));
      else if (e === 'json') other = tabular(JSON.parse(await readText(ref)));
      else { const t = await readText(ref); other = sheetFromRows('', parseCSV(t, e === 'tsv' ? '\t' : detectDelimiter(t))); }
      if (!other) throw new Error('No table found in that file');
      push(full());
      const map = other.headers.map(h => {
        let i = S.headers.findIndex(x => x.trim().toLowerCase() === h.trim().toLowerCase());
        if (i < 0) { S.headers.push(h); S.rows.forEach(r => r.push('')); i = S.headers.length - 1; }
        return i;
      });
      for (const r of other.rows) { const nr = S.headers.map(() => ''); map.forEach((i, j) => nr[i] = r[j] ?? ''); S.rows.push(nr); }
      render();
      toast(`Added ${other.rows.length} rows from ${ref.name}`);
    } catch (err) { toast(`Couldn't add rows: ${err.message}`, 5000); }
  }
  function columnMenu(c) {
    const hasFilter = S.filters.some(f => f.c === c);
    if (VIEWER) return [
      { label: 'Sort A → Z (smallest first)', action: () => sortBy(c, 1) },
      { label: 'Sort Z → A (largest first)', action: () => sortBy(c, -1) },
      { label: 'Filter…', action: () => addFilter(c) },
      { label: 'Clear filter', disabled: !hasFilter, action: () => { S.filters = S.filters.filter(f => f.c !== c); render(); } },
      '-',
      { label: 'Statistics', action: () => showStats(c) },
      { label: 'Chart this column', action: () => openChart(c) },
    ];
    return [
      { label: 'Sort A → Z (smallest first)', action: () => sortBy(c, 1) },
      { label: 'Sort Z → A (largest first)', action: () => sortBy(c, -1) },
      { label: 'Filter…', action: () => addFilter(c) },
      { label: 'Clear filter', disabled: !hasFilter, action: () => { S.filters = S.filters.filter(f => f.c !== c); render(); } },
      '-',
      { label: 'Statistics', action: () => showStats(c) },
      { label: 'Chart this column', action: () => openChart(c) },
      { label: 'Remove rows with a repeated value here', action: () => dedupe(c) },
      { label: 'Split into tabs by this column', action: () => splitBy(c) },
      '-',
      { label: 'Insert column left', action: () => insertColumn(c) },
      { label: 'Insert column right', action: () => insertColumn(c + 1) },
      { label: 'Delete column', action: () => deleteColumn(c) },
    ];
  }
  q('.chips').addEventListener('click', e => {
    const b = e.target.closest('[data-unfilter]');
    if (!b) return;
    if (b.dataset.unfilter === 'all') S.filters = []; else S.filters.splice(+b.dataset.unfilter, 1);
    render();
  });

  // ---- toolbar & bars
  q('.toolbar').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'row') {
      push({ type: 'addrow' });
      S.rows.push(S.headers.map(() => ''));
      S.query = ''; S.filters = []; q('[data-a=search]').value = '';
      S.limit = Math.max(S.limit, S.rows.length);
      render();
      focusCell(shown.length - 1, 0);
      body.scrollTop = body.scrollHeight;
    } else if (a === 'col') insertColumn(S.headers.length);
    else if (a === 'undo') undo();
    else if (a === 'find') openFind(tab);
    else if (a === 'chart') openChart();
  });
  q('.more').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'showmore') S.limit += 1000;
    else if (a === 'showall') S.limit = Infinity;
    else return;
    render();
  });
  q('.sheetbar').addEventListener('click', e => {
    const b = e.target.closest('[data-sheet]');
    if (b) return switchSheet(+b.dataset.sheet);
    if (e.target.closest('[data-a=addsheet]')) {
      commit();
      sheets.push({ name: `Sheet${sheets.length + 1}`, headers: ['Column 1', 'Column 2', 'Column 3'], rows: Array.from({ length: 5 }, () => ['', '', '']), undo: [], edited: new Set(), sort: { col: -1, dir: 1 }, filters: [], query: '', limit: 500, scroll: [0, 0] });
      setDirty(tab);
      switchSheet(sheets.length - 1);
    }
  });
  q('.sheetbar').addEventListener('dblclick', e => {
    const b = e.target.closest('[data-sheet]');
    if (!b || VIEWER) return;
    const s = sheets[+b.dataset.sheet];
    const name = prompt('Sheet name:', s.name);
    if (name?.trim()) { s.name = name.trim().slice(0, 31); setDirty(tab); renderSheets(); }
  });
  q('.sheetbar').addEventListener('contextmenu', e => {
    const b = e.target.closest('[data-sheet]');
    if (!b || VIEWER) return;
    e.preventDefault();
    const i = +b.dataset.sheet;
    showMenu(null, [
      { label: 'Rename…', action: () => b.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) },
      { label: 'Delete sheet', disabled: sheets.length < 2, action: () => {
        if (!confirm(`Delete sheet “${sheets[i].name}”?`)) return;
        sheets.splice(i, 1);
        cur = Math.min(cur, sheets.length - 1); S = sheets[cur];
        setDirty(tab); render();
      } },
    ], { x: e.clientX, y: e.clientY });
  });
  q('[data-a=search]').addEventListener('input', debounce(e => { S.query = e.target.value; S.limit = 500; sel = null; render(); }, 150));
  q('[data-a=color]').onchange = e => grid.classList.toggle('color', e.target.checked);

  // ---- find & replace adapter
  tab.findAdapter = {
    find(o) {
      const out = [];
      for (const ri of visible()) {
        S.rows[ri].forEach((v, c) => { if (indicesOf(String(v), o, 1).length) out.push({ r: ri, c }); });
        if (out.length >= 5000) break;
      }
      return out;
    },
    show(m) {
      let v = shown.indexOf(m.r);
      if (v < 0) { S.limit = Math.max(S.limit, visible().indexOf(m.r) + 50); render(); v = shown.indexOf(m.r); }
      focusCell(v, m.c);
      grid.querySelector(`td.cell[data-v="${v}"][data-c="${m.c}"]`)?.scrollIntoView({ block: 'center', inline: 'nearest' });
    },
    replace(m, r, o) { setCell(m.r, m.c, replaceIn(String(S.rows[m.r][m.c]), o, r)); },
    replaceAll(o, r) {
      let n = 0;
      push(full());
      for (const ri of visible()) S.rows[ri].forEach((v, c) => {
        const k = indicesOf(String(v), o, Infinity).length;
        if (k) { n += k; S.rows[ri][c] = replaceIn(String(v), o, r); S.edited.add(ri + ':' + c); }
      });
      if (!n) S.undo.pop();
      render();
      return n;
    },
  };

  // ---- charts
  function openChart(col) {
    commit();
    const types = S.headers.map((_, i) => columnType(i));
    const numCol = col != null && types[col] === 'num' ? col : types.findIndex(t => t === 'num');
    const labelCol = col != null && types[col] !== 'num' ? col : types.findIndex((t, i) => t !== 'num' && t !== 'empty' && i !== numCol);
    const t = addTab('chart', `Chart - ${baseName(tab.name)}`);
    ChartView(t, { headers: S.headers.slice(), rows: visible().map(i => S.rows[i].slice()), x: labelCol >= 0 ? labelCol : 0, y: numCol, source: tab.name });
  }

  // ---- outputs
  const commit = () => { if (grid.contains(document.activeElement)) document.activeElement.blur(); };
  const nameWith = ext => baseName(tab.name) + ext;
  const allSheets = () => sheets.map(s => ({ name: s.name, headers: s.headers, rows: s.rows }));
  // blank cells are left out so records keep only the fields they had
  const jsonl = () => rowsToObjects(S.headers, S.rows).map(o => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '')))).join('\n') + '\n';
  tab.view = {
    serialize() {
      commit();
      if (format === 'xlsx') return { data: Xlsx.write(allSheets()), name: nameWith('.xlsx') };
      if (format === 'jsonl') return { data: jsonl(), name: /\.(jsonl|ndjson)$/i.test(tab.name) ? tab.name : nameWith('.jsonl'), mime: 'application/jsonl' };
      if (sheets.length > 1 && !confirm('This file has several sheets. CSV can hold only the current one. Save only this sheet? (Use Tools → Save a copy as Excel to keep them all.)')) return Promise.reject(new Error('cancelled'));
      return { data: (bom ? '\uFEFF' : '') + toCSV(S.headers, S.rows, delim, eol, finalEol), name: nameWith(delim === '\t' ? '.tsv' : '.csv'), mime: 'text/csv' };
    },
    exports: () => [
      { label: 'Save a copy as Excel (.xlsx)…', action: () => { commit(); exportOut({ data: Xlsx.write(allSheets()), name: nameWith('.xlsx') }); } },
      { label: 'Save a copy as CSV…', action: () => { commit(); exportOut({ data: '\uFEFF' + toCSV(S.headers, S.rows, ','), name: nameWith('.csv'), mime: 'text/csv' }); } },
      { label: 'Save a copy as TSV…', action: () => { commit(); exportOut({ data: toCSV(S.headers, S.rows, '\t'), name: nameWith('.tsv'), mime: 'text/tab-separated-values' }); } },
      { label: 'Save a copy as JSON…', action: () => { commit(); exportOut({ data: JSON.stringify(rowsToObjects(S.headers, S.rows), null, 2), name: nameWith('.json'), mime: 'application/json' }); } },
      { label: 'Save a copy as JSON Lines…', action: () => { commit(); exportOut({ data: jsonl(), name: nameWith('.jsonl'), mime: 'application/jsonl' }); } },
      '-',
      { label: 'Remove duplicate rows', action: () => { commit(); dedupe(null); } },
      { label: 'Add rows from another file…', action: () => { commit(); appendFrom(); } },
      { label: 'Find & replace…', action: () => openFind(tab) },
      '-',
      { label: 'Open as JSON in a new tab', action: () => { commit(); const t = addTab('json', nameWith('.json')); JsonView(t, JSON.stringify(rowsToObjects(S.headers, S.rows), null, 2)); setDirty(t); } },
      { label: 'Open as a document table', action: () => { commit(); const t = addTab('doc', nameWith('.docx')); DocView(t, `<h1>${esc(baseName(tab.name))}</h1>` + tableHTML(S.headers, S.rows)); setDirty(t); } },
      { label: 'Open in Google Sheets', action: () => tab.view.google() },
      ...(format === 'csv' || format === 'tsv' ? [{ label: `Delimiter when saving: ${{ ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' }[delim]} (change…)`, action: () => {
        const map = { comma: ',', ',': ',', semicolon: ';', ';': ';', tab: '\t', pipe: '|', '|': '|' };
        const d = prompt('Delimiter used when saving (comma, semicolon, tab or pipe):', { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' }[delim]);
        if (d && map[d.trim().toLowerCase()]) { delim = map[d.trim().toLowerCase()]; setDirty(tab); toast('Delimiter changed'); }
      } }] : []),
    ],
    google: () => {
      commit();
      sendToGoogle('sheet', { name: baseName(tab.name), html: tableHTML(S.headers, S.rows), text: toCSV(S.headers, S.rows, '\t'),
        file: new Blob([toCSV(S.headers, S.rows, ',')], { type: 'text/csv' }) });
    },
    text: () => { commit(); return toCSV(S.headers, S.rows, ',', '\n', true); },
    draft: () => { commit(); return { type: 'csv', format, delim, bom, eol, finalEol, cur, sheets: allSheets() }; },
    findText: (query, line) => openFind(tab, query, line),
    undo,
    find: () => openFind(tab),
    onShow: () => {},
  };
  wireToolbar(tab);
  render();
}

// ================================================================ JSON
function JsonView(tab, text) {
  tab.el.innerHTML = `
    <div class="toolbar">
      <button data-a="code" class="on">Code</button>
      <button data-a="tree">Tree</button>
      <span class="sep"></span>
      <button data-a="format" class="edit-only">Format</button>
      <button data-a="minify" class="edit-only">Minify</button>
      <form data-a="qform" class="qform"><input type="search" data-a="query" placeholder="Query, e.g. users[*].email" aria-label="JSON query" spellcheck="false"></form>
      <span class="sp"></span>
      <button data-a="table">Open as table</button>
      <button data-a="google">Google Sheets</button>
      <button data-a="more">Convert ▾</button>
      <button data-a="save" class="primary">Save</button>
    </div>
    <div class="jerr hide findbar-slot"></div>
    <div class="qresult hide"></div>
    <div class="body"><textarea class="code" spellcheck="false" aria-label="JSON text"></textarea><div class="jtree hide"></div></div>`;
  const q = s => tab.el.querySelector(s);
  const ta = q('textarea'), tree = q('.jtree'), errBox = q('.jerr'), qres = q('.qresult');
  ta.value = text;
  ta.readOnly = VIEWER;
  let parsed, ok = false, queryResult;

  function validate() {
    try { parsed = JSON.parse(ta.value); ok = true; errBox.classList.add('hide'); }
    catch (e) {
      ok = false;
      const pos = +(/position (\d+)/.exec(e.message)?.[1] ?? NaN);
      let where = '';
      const lc = /line (\d+) column (\d+)/.exec(e.message);
      if (lc) where = ` (line ${lc[1]}, column ${lc[2]})`;
      else if (!isNaN(pos)) { const pre = ta.value.slice(0, pos).split('\n'); where = ` (line ${pre.length}, column ${pre.at(-1).length + 1})`; }
      errBox.textContent = ta.value.trim() ? `Invalid JSON${where}: ${e.message.replace(/^JSON\.parse: /, '')}` : 'Empty file';
      errBox.className = 'jerr findbar-slot';
    }
    const tbl = ok && tabular(parsed);
    q('[data-a=table]').disabled = !tbl;
    q('[data-a=google]').disabled = !tbl;
    return ok;
  }
  const onEdit = () => { setDirty(tab); debouncedValidate(); };
  ta.addEventListener('input', onEdit);
  const debouncedValidate = debounce(validate, 300);
  ta.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); } });

  function showTree(value = parsed) {
    ValueTree(tree, value);
    ta.classList.add('hide'); tree.classList.remove('hide');
    q('[data-a=tree]').classList.add('on'); q('[data-a=code]').classList.remove('on');
  }
  function showCode() {
    tree.classList.add('hide'); ta.classList.remove('hide'); qres.classList.add('hide');
    q('[data-a=code]').classList.add('on'); q('[data-a=tree]').classList.remove('on');
  }
  function replaceText(t) {
    ta.focus(); ta.select();
    if (!document.execCommand('insertText', false, t)) ta.value = t;
    setDirty(tab);
  }
  function openTable(value = parsed) {
    const tbl = tabular(value);
    if (!tbl) return toast('Only lists of objects, lists of rows or lists of values can become a table');
    const t = addTab('csv', baseName(tab.name) + '.csv');
    CsvView(t, { sheets: [{ name: 'Sheet1', ...tbl }], format: 'csv' });
    setDirty(t);
  }
  function runQuery(expr) {
    if (!expr.trim()) { qres.classList.add('hide'); queryResult = undefined; return showTree(); }
    if (!validate()) return toast('Fix the JSON error first');
    try { queryResult = Formats.query(parsed, expr); }
    catch (e) { qres.className = 'qresult jerr'; qres.textContent = e.message; return; }
    const n = Array.isArray(queryResult) ? `${queryResult.length} result${queryResult.length === 1 ? '' : 's'}` : queryResult === undefined ? 'No result' : '1 result';
    qres.className = 'qresult';
    qres.innerHTML = `<span>${esc(n)} for <code>${esc(expr)}</code></span><span class="sp"></span>
      <button data-q="table"${tabular(queryResult) ? '' : ' disabled'}>Open as table</button>
      <button data-q="tab">Open result in new tab</button><button class="icon" data-q="clear" aria-label="Clear query">✕</button>`;
    showTree(queryResult === undefined ? null : queryResult);
  }
  qres.addEventListener('click', e => {
    const a = e.target.closest('[data-q]')?.dataset.q;
    if (a === 'table') openTable(queryResult);
    else if (a === 'tab') { const t = addTab('json', baseName(tab.name) + '-query.json'); JsonView(t, JSON.stringify(queryResult ?? null, null, 2) + '\n'); setDirty(t); }
    else if (a === 'clear') { q('[data-a=query]').value = ''; runQuery(''); }
  });
  q('[data-a=qform]').addEventListener('submit', e => { e.preventDefault(); runQuery(q('[data-a=query]').value); });
  q('.toolbar').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'code') showCode();
    else if (a === 'tree') { if (validate()) showTree(); else toast('Fix the JSON error before switching to the tree view'); }
    else if (a === 'format' && validate()) { replaceText(JSON.stringify(parsed, null, 2)); showCode(); }
    else if (a === 'minify' && validate()) { replaceText(JSON.stringify(parsed)); showCode(); }
    else if (a === 'table' && validate()) openTable();
  });

  tab.findAdapter = textareaAdapter(ta, onEdit);
  const origShow = tab.findAdapter.show;
  tab.findAdapter.show = m => { showCode(); origShow(m); };
  tab.view = {
    serialize: () => ({ data: ta.value, name: /\.(json|geojson|webmanifest)$/i.test(tab.name) ? tab.name : baseName(tab.name) + '.json', mime: 'application/json' }),
    exports: () => {
      const tbl = validate() && tabular(parsed);
      return [
        { label: 'Save a copy as Excel (.xlsx)…', disabled: !tbl, action: () => exportOut({ data: Xlsx.write([{ name: 'Sheet1', ...tbl }]), name: baseName(tab.name) + '.xlsx' }) },
        { label: 'Save a copy as CSV…', disabled: !tbl, action: () => exportOut({ data: '\uFEFF' + toCSV(tbl.headers, tbl.rows), name: baseName(tab.name) + '.csv', mime: 'text/csv' }) },
        { label: 'Save a copy as YAML…', disabled: !ok, action: () => exportOut({ data: Formats.toYAML(parsed), name: baseName(tab.name) + '.yaml', mime: 'text/yaml' }) },
        { label: 'Save a copy as formatted JSON…', disabled: !ok, action: () => exportOut({ data: JSON.stringify(parsed, null, 2), name: baseName(tab.name) + '.json', mime: 'application/json' }) },
        '-',
        { label: 'Open as table in a new tab', disabled: !tbl, action: () => openTable() },
        { label: 'Open as YAML in a new tab', disabled: !ok, action: () => { const t = addTab('text', baseName(tab.name) + '.yaml'); TextView(t, Formats.toYAML(parsed)); setDirty(t); } },
        { label: 'Open in Google Sheets', disabled: !tbl, action: () => tab.view.google() },
        { label: 'Find & replace…', action: () => openFind(tab) },
      ];
    },
    google: () => {
      const tbl = validate() && tabular(parsed);
      if (!tbl) return toast('Only JSON lists of objects or rows can become a sheet');
      sendToGoogle('sheet', { name: baseName(tab.name), html: tableHTML(tbl.headers, tbl.rows), text: toCSV(tbl.headers, tbl.rows, '\t'),
        file: new Blob([toCSV(tbl.headers, tbl.rows)], { type: 'text/csv' }) });
    },
    text: () => validate() ? JSON.stringify(parsed, null, 2) + '\n' : ta.value,
    draft: () => ({ type: 'text', text: ta.value }),
    findText: (query, line) => { showCode(); openFind(tab, query, line); },
    find: () => openFind(tab),
  };
  wireToolbar(tab);
  validate();
}

// ================================================================ text: plain, Markdown (preview), HTML (preview), XML & YAML (tree)
function sanitizeHTML(html) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  d.querySelectorAll('script, style, iframe, object, embed, link, meta, form, input, button').forEach(n => n.remove());
  d.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => {
    if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
  }));
  return d.body.innerHTML;
}
function TextView(tab, text) {
  const e = extOf(tab.name);
  const mode = { md: 'md', markdown: 'md', html: 'html', htm: 'html', xml: 'xml', yaml: 'yaml', yml: 'yaml' }[e] || 'plain';
  const preview = mode === 'md' || mode === 'html', treeable = mode === 'xml' || mode === 'yaml';
  tab.el.innerHTML = `
    <div class="toolbar">
      ${preview ? '<button data-a="preview" class="on">Preview</button>' : ''}
      ${treeable ? '<button data-a="tree">Tree</button>' : ''}
      <label class="info"><input type="checkbox" data-a="wrap" checked> Wrap lines</label>
      <button data-a="find" title="Find & replace (${MOD}F)">Find</button>
      <span class="info" data-a="stats"></span>
      <span class="sp"></span>
      ${preview ? '<button data-a="asdoc" class="edit-only">Open as document</button>' : ''}
      ${treeable ? '<button data-a="tojson" class="edit-only">Convert to JSON</button>' : ''}
      <button data-a="google">Google Docs</button>
      ${preview ? '<button data-a="more">Export ▾</button>' : ''}
      <button data-a="save" class="primary">Save</button>
    </div>
    <div class="jerr hide findbar-slot"></div>
    <div class="body${preview ? ' splitpane' : ''}"><textarea class="code wrap" spellcheck="${mode === 'md' || mode === 'plain'}" aria-label="Text"></textarea>
      ${mode === 'md' ? '<div class="preview page-lite"></div>' : ''}
      ${mode === 'html' ? '<iframe class="preview" sandbox title="HTML preview"></iframe>' : ''}
      ${treeable ? '<div class="jtree hide"></div>' : ''}</div>`;
  const q = s => tab.el.querySelector(s);
  const ta = q('textarea'), pv = q('.preview'), tree = q('.jtree'), errBox = q('.jerr');
  ta.value = text;
  ta.readOnly = VIEWER;
  const asHTML = () => mode === 'md' ? Formats.mdToHtml(ta.value) : sanitizeHTML(ta.value);
  const renderPreview = () => {
    if (!pv || pv.classList.contains('hide')) return;
    if (mode === 'md') pv.innerHTML = asHTML();
    else pv.srcdoc = ta.value;
  };
  const renderLater = debounce(renderPreview, 250);
  const stats = () => q('[data-a=stats]').textContent = `${ta.value.split('\n').length.toLocaleString()} lines · ${ta.value.length.toLocaleString()} characters`;
  const onEdit = () => { setDirty(tab); stats(); renderLater(); };
  ta.addEventListener('input', onEdit);
  const parseValue = () => mode === 'xml' ? Formats.xmlToJSON(ta.value) : Formats.parseYAML(ta.value);
  function toggleTree(on) {
    if (on) {
      let v;
      try { v = parseValue(); } catch (err) { errBox.textContent = `Can't read this ${mode.toUpperCase()}: ${err.message}`; errBox.className = 'jerr findbar-slot'; return; }
      errBox.classList.add('hide');
      ValueTree(tree, v);
    }
    tree.classList.toggle('hide', !on); ta.classList.toggle('hide', on);
    q('[data-a=tree]').classList.toggle('on', on);
  }
  q('.toolbar').addEventListener('click', ev => {
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (a === 'preview') { const on = pv.classList.toggle('hide'); ev.target.classList.toggle('on', !on); renderPreview(); }
    else if (a === 'tree') toggleTree(tree.classList.contains('hide'));
    else if (a === 'find') openFind(tab);
    else if (a === 'asdoc') { const t = addTab('doc', baseName(tab.name) + '.docx'); DocView(t, asHTML()); setDirty(t); }
    else if (a === 'tojson') {
      try { const t = addTab('json', baseName(tab.name) + '.json'); JsonView(t, JSON.stringify(parseValue(), null, 2) + '\n'); setDirty(t); }
      catch (err) { toast(`Can't convert: ${err.message}`, 5000); }
    }
  });
  q('[data-a=wrap]').onchange = ev => ta.classList.toggle('wrap', ev.target.checked);
  tab.findAdapter = textareaAdapter(ta, onEdit);
  const fullHTML = () => `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${esc(baseName(tab.name))}</title></head><body>\n${asHTML()}\n</body></html>\n`;
  tab.view = {
    serialize: () => ({ data: ta.value, name: extOf(tab.name) ? tab.name : tab.name + '.txt', mime: 'text/plain' }),
    exports: () => [
      { label: 'Save a copy as Word (.docx)…', action: async () => { const d = document.createElement('div'); d.innerHTML = asHTML(); exportOut({ data: await Docx.fromHTML(d), name: baseName(tab.name) + '.docx' }); } },
      { label: 'Save a copy as web page (.html)…', disabled: mode !== 'md', action: () => exportOut({ data: fullHTML(), name: baseName(tab.name) + '.html', mime: 'text/html' }) },
      { label: 'Open as document', action: () => q('[data-a=asdoc]').click() },
    ],
    google: () => sendToGoogle('doc', { name: baseName(tab.name), html: preview ? asHTML() : `<pre>${esc(ta.value)}</pre>`, text: ta.value,
      file: preview ? new Blob([fullHTML()], { type: 'text/html' }) : new Blob([ta.value], { type: 'text/plain' }) }),
    text: () => ta.value,
    draft: () => ({ type: 'text', text: ta.value }),
    findText: (query, line) => { if (tree && !tree.classList.contains('hide')) toggleTree(false); openFind(tab, query, line); },
    find: () => openFind(tab),
  };
  wireToolbar(tab);
  stats();
  renderPreview();
}

// ================================================================ documents
function DocView(tab, html) {
  tab.el.innerHTML = `
    <div class="toolbar">
      <select data-a="block" class="edit-only" aria-label="Paragraph style">
        <option value="p">Normal text</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option><option value="blockquote">Quote</option><option value="pre">Code</option>
      </select>
      <button class="edit-only" data-cmd="bold" title="Bold (${MOD}B)"><b>B</b></button>
      <button class="edit-only" data-cmd="italic" title="Italic (${MOD}I)"><i>I</i></button>
      <button class="edit-only" data-cmd="underline" title="Underline (${MOD}U)"><u>U</u></button>
      <button class="edit-only" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
      <span class="sep edit-only"></span>
      <button class="edit-only" data-cmd="insertUnorderedList" title="Bulleted list">• List</button>
      <button class="edit-only" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
      <button class="edit-only" data-a="link" title="Add link">Link</button>
      <button class="edit-only" data-a="image" title="Insert image">Image</button>
      <button class="edit-only" data-a="table" title="Insert table">Table</button>
      <span class="sep edit-only"></span>
      <button class="edit-only" data-cmd="justifyLeft" title="Align left">⇤</button>
      <button class="edit-only" data-cmd="justifyCenter" title="Centre">↔</button>
      <button class="edit-only" data-cmd="justifyRight" title="Align right">⇥</button>
      <button class="edit-only" data-cmd="removeFormat" title="Clear formatting">Clear</button>
      <button data-a="find" title="Find & replace (${MOD}F)">Find</button>
      <span class="info wordcount" data-a="wc"></span>
      <span class="sp"></span>
      <button data-a="google">Google Docs</button>
      <button data-a="more">Export ▾</button>
      <button data-a="save" class="primary">Save</button>
    </div>
    <div class="body doc-body"><article class="page" ${VIEWER ? '' : 'contenteditable="true" spellcheck="true"'} aria-label="Document"></article></div>
    <input type="file" accept="image/*" hidden data-a="imgfile">`;
  const q = s => tab.el.querySelector(s);
  const page = q('.page');
  page.innerHTML = html || '<p><br></p>';
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* old browsers */ }

  const exec = (cmd, val) => { page.focus(); document.execCommand(cmd, false, val); };
  const wc = () => {
    const words = (page.innerText.match(/\S+/g) || []).length;
    q('[data-a=wc]').textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'}`;
  };
  const wcLater = debounce(wc, 400);
  const onEdit = () => { setDirty(tab); wcLater(); };
  page.addEventListener('input', onEdit);

  q('.toolbar').addEventListener('mousedown', e => { if (e.target.closest('button[data-cmd], button[data-a=link], button[data-a=table]')) e.preventDefault(); });
  q('.toolbar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cmd) exec(b.dataset.cmd);
    const a = b.dataset.a;
    if (a === 'link') {
      const url = prompt('Link address:', 'https://');
      if (url && url !== 'https://') exec('createLink', url);
    } else if (a === 'image') q('[data-a=imgfile]').click();
    else if (a === 'find') openFind(tab);
    else if (a === 'table') {
      const size = prompt('Table size (columns × rows):', '3 x 3');
      const m = /(\d+)\D+(\d+)/.exec(size || '');
      if (!m) return;
      const cols = Math.min(+m[1], 20), rws = Math.min(+m[2], 200);
      exec('insertHTML', '<table>' + Array.from({ length: rws }, () => '<tr>' + '<td><br></td>'.repeat(cols) + '</tr>').join('') + '</table><p><br></p>');
    }
    syncState();
  });
  q('[data-a=imgfile]').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    blobToDataURL(f).then(url => exec('insertImage', url));
    e.target.value = '';
  };
  q('[data-a=block]').onchange = e => exec('formatBlock', `<${e.target.value}>`);
  page.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (a && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openExternal(a.href); }
  });
  page.addEventListener('keydown', e => {
    const fmt = (isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && { b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()];
    if (fmt) { e.preventDefault(); exec(fmt); syncState(); return; }
    if (e.key === 'Tab' && !e.target.closest('li')) { e.preventDefault(); exec('insertText', '\u2003'); }
  });
  function syncState() {
    const sel = getSelection();
    if (!sel.rangeCount || !page.contains(sel.anchorNode)) return;
    for (const b of tab.el.querySelectorAll('[data-cmd]')) {
      if (/^(bold|italic|underline|strikeThrough|insert\w+List)$/.test(b.dataset.cmd)) {
        let on = false;
        try { on = document.queryCommandState(b.dataset.cmd); } catch { /* ignore */ }
        b.classList.toggle('on', on);
      }
    }
    const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    const block = el.closest('h1,h2,h3,h4,h5,h6,blockquote,pre,p,li,td');
    const tag = block && page.contains(block) ? block.localName : 'p';
    q('[data-a=block]').value = ['h1', 'h2', 'h3', 'blockquote', 'pre'].includes(tag) ? tag : /^h[4-6]$/.test(tag) ? 'h3' : 'p';
  }
  const onSel = () => { if (active === tab) syncState(); };
  document.addEventListener('selectionchange', onSel);

  // find & replace inside the page (matches within a run of text)
  const textNodes = () => { const w = document.createTreeWalker(page, NodeFilter.SHOW_TEXT); const a = []; while (w.nextNode()) a.push(w.currentNode); return a; };
  const select = m => {
    const r = document.createRange();
    r.setStart(m.n, m.i); r.setEnd(m.n, m.i + m.len);
    page.focus({ preventScroll: true });
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  };
  tab.findAdapter = {
    find(o) {
      const out = [];
      for (const n of textNodes()) { for (const i of indicesOf(n.data, o)) out.push({ n, i, len: o.q.length }); if (out.length >= 5000) break; }
      return out;
    },
    show(m) { if (!m.n.isConnected) return; select(m); m.n.parentElement.scrollIntoView({ block: 'center' }); },
    replace(m, r) { if (!m.n.isConnected) return; select(m); document.execCommand('insertText', false, r); onEdit(); },
    replaceAll(o, r) {
      const ms = this.find(o).reverse();
      for (const m of ms) {
        if (ms.length <= 1000) { select(m); document.execCommand('insertText', false, r); }
        else m.n.data = m.n.data.slice(0, m.i) + r + m.n.data.slice(m.i + m.len);
      }
      if (ms.length) onEdit();
      return ms.length;
    },
  };

  const fullHTML = () => `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(baseName(tab.name))}</title>
<style>body{font-family:Georgia,serif;max-width:46em;margin:3em auto;padding:0 1em;line-height:1.6;color:#1b2530}table{border-collapse:collapse}td,th{border:1px solid #a6aeb8;padding:4px 8px}img{max-width:100%}blockquote{border-left:3px solid #a6aeb8;margin-left:0;padding-left:1em;color:#4a5562}</style>
</head><body>\n${page.innerHTML}\n</body></html>\n`;
  tab.view = {
    serialize: async () => ({ data: await Docx.fromHTML(page), name: baseName(tab.name) + '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    exports: () => [
      { label: 'Save a copy as Word (.docx)…', action: async () => exportOut({ data: await Docx.fromHTML(page), name: baseName(tab.name) + '.docx' }) },
      { label: 'Save a copy as Markdown (.md)…', action: () => exportOut({ data: Formats.htmlToMd(page), name: baseName(tab.name) + '.md', mime: 'text/markdown' }) },
      { label: 'Save a copy as web page (.html)…', action: () => exportOut({ data: fullHTML(), name: baseName(tab.name) + '.html', mime: 'text/html' }) },
      { label: 'Save a copy as plain text (.txt)…', action: () => exportOut({ data: htmlToText(page.innerHTML), name: baseName(tab.name) + '.txt', mime: 'text/plain' }) },
      { label: 'Print or save as PDF…', action: () => native ? native.post({ cmd: 'print' }) : window.print() },
      '-',
      { label: 'Open in Google Docs', action: () => tab.view.google() },
      { label: 'Open as Markdown in a new tab', action: () => { const t = addTab('text', baseName(tab.name) + '.md'); TextView(t, Formats.htmlToMd(page)); setDirty(t); } },
      { label: 'Find & replace…', action: () => openFind(tab) },
    ],
    google: () => sendToGoogle('doc', { name: baseName(tab.name), html: page.innerHTML, text: page.innerText, file: new Blob([fullHTML()], { type: 'text/html' }) }),
    text: () => htmlToText(page.innerHTML),
    draft: () => ({ type: 'doc', html: page.innerHTML }),
    findText: (query) => openFind(tab, query),
    find: () => openFind(tab),
    dispose: () => document.removeEventListener('selectionchange', onSel),
  };
  wireToolbar(tab);
  wc();
}

// ================================================================ video / audio / images / PDF
function embedURL(url) {
  const yt = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1`;
  const vm = /vimeo\.com\/(?:video\/)?(\d+)/.exec(url);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}?autoplay=1`;
  return null;
}
const fmtTime = s => {
  if (!isFinite(s)) return '';
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = Math.floor(s % 60);
  return `${h ? h + ':' : ''}${h ? String(m).padStart(2, '0') : m}:${String(sec).padStart(2, '0')}`;
};
function getPositions() { try { return JSON.parse(localStorage.getItem('dd.pos') || '{}'); } catch { return {}; } }
function MediaView(tab, { src, type, revoke = false, embed = null, pageURL = null, subs = null, posKey = null }) {
  const isAV = !embed && (type === 'video' || type === 'audio');
  const isVideo = !embed && type === 'video';
  tab.el.innerHTML = `
    <div class="toolbar">
      <span class="info" data-a="meta"></span>
      <span class="sp"></span>
      ${isAV ? `<label class="info">Speed <select data-a="speed">${[0.5, 0.75, 1, 1.25, 1.5, 2].map(s => `<option${s === 1 ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="info"><input type="checkbox" data-a="loop"> Loop</label>
      <span class="sep"></span>
      <button data-a="setA" title="Start of a repeating section">A</button><button data-a="setB" title="End of a repeating section">B</button>
      <button data-a="clearAB" class="hide">Clear A–B</button>` : ''}
      ${isVideo ? `<span class="sep"></span><button data-a="subs">Subtitles…</button><button data-a="shot" title="Save the current frame as a picture">Save frame</button>` : ''}
      ${isVideo && document.pictureInPictureEnabled ? '<button data-a="pip">Picture in picture</button>' : ''}
      ${pageURL ? '<button data-a="ext">Open in browser</button>' : ''}
    </div>
    <div class="body media-body${type === 'pdf' ? ' pdf' : ''}">${
      embed ? `<iframe src="${esc(embed)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen title="${esc(tab.name)}"></iframe>`
      : type === 'video' ? `<video src="${esc(src)}" controls autoplay playsinline></video>`
      : type === 'audio' ? `<audio src="${esc(src)}" controls autoplay></audio>`
      : type === 'pdf' ? `<iframe src="${esc(src)}" title="${esc(tab.name)}"></iframe>`
      : `<img src="${esc(src)}" alt="${esc(tab.name)}">`}</div>
    <input type="file" accept=".vtt,.srt" hidden data-a="subsfile">`;
  const q = s => tab.el.querySelector(s);
  const media = q('video, audio'), meta = q('[data-a=meta]');
  let a = null, b = null, resumed = '';
  const trackURLs = [];
  const setMeta = () => {
    if (!media) return;
    meta.textContent = [media.videoWidth ? `${media.videoWidth} × ${media.videoHeight}` : '', fmtTime(media.duration),
      a != null ? `repeating ${fmtTime(a)}–${b != null ? fmtTime(b) : '…'}` : '', resumed].filter(Boolean).join(' · ');
  };
  async function addSubtitles(ref) {
    try {
      let text = await readText(ref);
      if (extOf(ref.name) === 'srt') text = Formats.srtToVtt(text);
      const url = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
      trackURLs.push(url);
      media.querySelectorAll('track').forEach(t => t.remove());
      media.append(Object.assign(document.createElement('track'), { kind: 'subtitles', label: baseName(ref.name), srclang: 'en', src: url, default: true }));
      setTimeout(() => { if (media.textTracks[0]) media.textTracks[0].mode = 'showing'; }, 50);
      toast(`Subtitles: ${ref.name}`, 1800);
    } catch (e) { toast(`Couldn't load subtitles: ${e.message}`, 4000); }
  }
  if (media) {
    const positions = getPositions();
    media.addEventListener('loadedmetadata', () => {
      const at = posKey && positions[posKey];
      if (at > 5 && at < media.duration - 5) { media.currentTime = at; resumed = `resumed at ${fmtTime(at)}`; }
      setMeta();
    });
    media.addEventListener('error', () => { meta.textContent = `This ${type} can't be played here. MP4 (H.264), WebM and MOV usually work; MKV and AVI often don't.`; });
    let lastSave = 0;
    const savePos = () => {
      if (!posKey || !isFinite(media.duration)) return;
      const p = getPositions();
      if (media.currentTime > 5 && media.currentTime < media.duration - 5) p[posKey] = Math.round(media.currentTime); else delete p[posKey];
      const keys = Object.keys(p);
      if (keys.length > 200) delete p[keys[0]];
      localStorage.setItem('dd.pos', JSON.stringify(p));
    };
    media.addEventListener('timeupdate', () => {
      if (a != null && b != null && media.currentTime >= b) media.currentTime = a;
      if (Date.now() - lastSave > 3000) { lastSave = Date.now(); savePos(); }
    });
    media.addEventListener('pause', savePos);
    q('[data-a=speed]').onchange = e => media.playbackRate = +e.target.value;
    q('[data-a=loop]').onchange = e => media.loop = e.target.checked;
    q('[data-a=pip]')?.addEventListener('click', () => media.requestPictureInPicture().catch(err => toast(err.message)));
    q('[data-a=setA]').onclick = () => { a = media.currentTime; if (b != null && b <= a) b = null; q('[data-a=clearAB]').classList.remove('hide'); setMeta(); };
    q('[data-a=setB]').onclick = () => {
      if (a == null) return toast('Set the start (A) first');
      if (media.currentTime <= a) return toast('B must be after A');
      b = media.currentTime; media.currentTime = a; media.play(); setMeta();
    };
    q('[data-a=clearAB]').onclick = e => { a = b = null; e.target.classList.add('hide'); setMeta(); };
    q('[data-a=subs]')?.addEventListener('click', () => {
      if (native) nativeCall('pickFiles', { kind: '' }).then(f => f?.[0] && addSubtitles(f[0]));
      else q('[data-a=subsfile]').click();
    });
    q('[data-a=subsfile]').onchange = e => { const f = e.target.files[0]; if (f) addSubtitles({ name: f.name, file: f }); e.target.value = ''; };
    q('[data-a=shot]')?.addEventListener('click', () => {
      try {
        const c = document.createElement('canvas');
        c.width = media.videoWidth; c.height = media.videoHeight;
        c.getContext('2d').drawImage(media, 0, 0);
        c.toBlob(blob => blob ? exportOut({ data: blob, name: `${baseName(tab.name)} ${fmtTime(media.currentTime).replace(/:/g, '-')}.png` }) : toast("Couldn't capture this frame"), 'image/png');
      } catch { toast('This video doesn’t allow saving frames (it comes from another website).', 4000); }
    });
    if (subs) addSubtitles(subs);
    tab.dispose_ = savePos;
  }
  const img = q('.media-body img');
  img?.addEventListener('load', () => meta.textContent = `${img.naturalWidth} × ${img.naturalHeight}`);
  if (type === 'pdf') meta.textContent = 'PDF (view only)';
  q('[data-a=ext]')?.addEventListener('click', () => openExternal(pageURL));
  tab.view = {
    onShow: () => {},
    dispose: () => { tab.dispose_?.(); media?.pause(); if (revoke) URL.revokeObjectURL(src); trackURLs.forEach(u => URL.revokeObjectURL(u)); },
  };
  tab.pauseOnHide = () => media?.pause(); // background tabs don't keep playing
}
function openVideoURL(url) {
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) return toast('Enter a full link starting with https://');
  const embed = embedURL(url);
  let name = 'Video';
  try { name = embed ? new URL(url).hostname.replace(/^www\./, '') + ' video' : decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'Video'; } catch { /* keep default */ }
  const type = embed ? 'video' : AUDIO.has(extOf(url.split('?')[0])) ? 'audio' : 'video';
  const tab = addTab('media', name, { key: url, ref: { name, url } });
  MediaView(tab, { src: url, type, embed, pageURL: url, posKey: url });
  scheduleSave();
}

// ================================================================ charts (single series: bar = categories, line = over time/order)
function niceTicks(min, max, count = 5) {
  if (min === max) { max = min + 1; }
  const span = max - min, step0 = span / count, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count) || mag * 10;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toPrecision(12));
  return ticks;
}
function ChartView(tab, { headers, rows, x = 0, y = -1, type = null, agg = null, source = '' }) {
  const isNumCol = c => c >= 0 && rows.slice(0, 500).filter(r => String(r[c]).trim()).every(r => !isNaN(toNum(r[c])));
  const isDateCol = c => c >= 0 && rows.slice(0, 200).filter(r => String(r[c]).trim()).every(r => cellType(r[c]) === 'date');
  type ||= isDateCol(x) || isNumCol(x) ? 'line' : 'bar';
  agg ||= y < 0 ? 'count' : 'sum';
  tab.el.innerHTML = `
    <div class="toolbar">
      <label class="info">Chart <select data-c="type"><option value="bar">Bar</option><option value="line">Line</option></select></label>
      <label class="info">Group by <select data-c="x">${headers.map((h, i) => `<option value="${i}">${esc(h)}</option>`).join('')}</select></label>
      <label class="info">Show <select data-c="agg"><option value="count">Number of rows</option><option value="sum">Sum of</option><option value="avg">Average of</option><option value="max">Largest</option><option value="min">Smallest</option></select></label>
      <select data-c="y" aria-label="Value column">${headers.map((h, i) => `<option value="${i}">${esc(h)}</option>`).join('')}</select>
      <span class="sp"></span>
      <button data-c="table">Table</button>
      <button data-a="more">Export ▾</button>
    </div>
    <div class="body chart-body"><div class="chart-wrap"><h2 class="chart-title"></h2><p class="chart-sub info"></p><div class="chart-svg"></div><div class="chart-table hide"></div></div><div class="tooltip hide" role="tooltip"></div></div>`;
  const q = s => tab.el.querySelector(s);
  const st = { type, x, y: y < 0 ? (headers.findIndex((_, i) => isNumCol(i)) ?? 0) : y, agg };
  q('[data-c=type]').value = st.type; q('[data-c=x]').value = st.x; q('[data-c=agg]').value = st.agg; q('[data-c=y]').value = Math.max(0, st.y);
  let data = [];

  function compute() {
    const groups = new Map();
    for (const r of rows) {
      const k = String(r[st.x] ?? '').trim() || '(empty)';
      const v = toNum(r[st.y]);
      const g = groups.get(k) || { n: 0, sum: 0, cnt: 0, min: Infinity, max: -Infinity };
      g.n++;
      if (!isNaN(v)) { g.sum += v; g.cnt++; g.min = Math.min(g.min, v); g.max = Math.max(g.max, v); }
      groups.set(k, g);
    }
    const val = g => ({ count: g.n, sum: g.sum, avg: g.cnt ? g.sum / g.cnt : 0, max: g.cnt ? g.max : 0, min: g.cnt ? g.min : 0 })[st.agg];
    data = [...groups].map(([label, g]) => ({ label, value: val(g) }));
    if (st.type === 'bar') data.sort((a, b) => b.value - a.value);
    else {
      const asDate = isDateCol(st.x), asNum = !asDate && isNumCol(st.x);
      if (asDate) data.sort((a, b) => new Date(a.label) - new Date(b.label));
      else if (asNum) data.sort((a, b) => toNum(a.label) - toNum(b.label));
    }
  }
  const aggLabel = () => st.agg === 'count' ? 'Number of rows' : `${{ sum: 'Sum', avg: 'Average', max: 'Largest', min: 'Smallest' }[st.agg]} of ${headers[st.y]}`;
  const tip = q('.tooltip');
  const showTip = (e, html) => {
    tip.innerHTML = html; tip.classList.remove('hide');
    const r = q('.chart-body').getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 8) + 'px';
    tip.style.top = (e.clientY - r.top + q('.chart-body').scrollTop + 14) + 'px';
  };
  const hideTip = () => tip.classList.add('hide');

  function render() {
    compute();
    q('[data-c=y]').disabled = st.agg === 'count';
    q('.chart-title').textContent = `${aggLabel()} by ${headers[st.x]}`;
    const W = Math.max(480, Math.min(q('.chart-body').clientWidth - 64, 1100));
    let svg = '';
    let note = `${rows.length.toLocaleString()} rows from ${source}`;
    if (st.type === 'bar') {
      const MAX = 30;
      let bars = data;
      if (data.length > MAX) { note += ` · showing the top ${MAX} of ${data.length} groups`; bars = data.slice(0, MAX); }
      const labelW = Math.min(220, Math.max(60, ...bars.map(d => d.label.length * 7 + 12)));
      const rowH = 28, barH = 18, top = 28, plotW = W - labelW - 70;
      const lo = Math.min(0, ...bars.map(d => d.value)), hi = Math.max(0, ...bars.map(d => d.value));
      const ticks = niceTicks(lo, hi);
      const t0 = ticks[0], t1 = ticks.at(-1);
      const X = v => labelW + (v - t0) / (t1 - t0 || 1) * plotW;
      const H = top + bars.length * rowH + 8;
      svg += ticks.map(t => `<line x1="${X(t)}" x2="${X(t)}" y1="${top - 6}" y2="${H - 8}" class="grid-line"/><text x="${X(t)}" y="${top - 12}" class="axis-label" text-anchor="middle">${esc(fmtNum(t, true))}</text>`).join('');
      bars.forEach((d, i) => {
        const yy = top + i * rowH + (rowH - barH) / 2, x0 = X(0), x1 = X(d.value);
        const w = Math.abs(x1 - x0), left = Math.min(x0, x1), rr = Math.min(4, w / 2);
        const path = d.value >= 0
          ? `M${left},${yy} h${w - rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${barH - 2 * rr} a${rr},${rr} 0 0 1 -${rr},${rr} h-${w - rr} z`
          : `M${left + w},${yy} h-${w - rr} a${rr},${rr} 0 0 0 -${rr},${rr} v${barH - 2 * rr} a${rr},${rr} 0 0 0 ${rr},${rr} h${w - rr} z`;
        svg += `<text x="${labelW - 10}" y="${yy + barH / 2 + 4}" class="cat-label" text-anchor="end">${esc(d.label.length > 30 ? d.label.slice(0, 29) + '…' : d.label)}</text>`;
        svg += `<path d="${w ? path : ''}" class="mark"/>`;
        svg += `<rect x="0" y="${top + i * rowH}" width="${W}" height="${rowH}" class="hit" data-i="${i}"/>`;
      });
      svg += `<line x1="${X(0)}" x2="${X(0)}" y1="${top - 6}" y2="${H - 8}" class="base-line"/>`;
      svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(q('.chart-title').textContent)}">${svg}</svg>`;
    } else {
      const H = 360, padL = 64, padR = 20, padT = 16, padB = 44, plotW = W - padL - padR, plotH = H - padT - padB;
      const vals = data.map(d => d.value);
      const ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals, 0));
      const t0 = ticks[0], t1 = ticks.at(-1);
      const X = i => padL + (data.length < 2 ? plotW / 2 : i / (data.length - 1) * plotW);
      const Y = v => padT + plotH - (v - t0) / (t1 - t0 || 1) * plotH;
      svg += ticks.map(t => `<line x1="${padL}" x2="${W - padR}" y1="${Y(t)}" y2="${Y(t)}" class="grid-line"/><text x="${padL - 8}" y="${Y(t) + 4}" class="axis-label" text-anchor="end">${esc(fmtNum(t, true))}</text>`).join('');
      const every = Math.max(1, Math.ceil(data.length / Math.floor(plotW / 90)));
      data.forEach((d, i) => { if (i % every === 0 || i === data.length - 1) svg += `<text x="${X(i)}" y="${H - padB + 18}" class="axis-label" text-anchor="middle">${esc(d.label.length > 14 ? d.label.slice(0, 13) + '…' : d.label)}</text>`; });
      svg += `<line x1="${padL}" x2="${W - padR}" y1="${Y(Math.max(0, t0))}" y2="${Y(Math.max(0, t0))}" class="base-line"/>`;
      svg += `<path d="${data.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(d.value).toFixed(1)}`).join('')}" class="line"/>`;
      if (data.length === 1) svg += `<circle cx="${X(0)}" cy="${Y(data[0].value)}" r="4" class="dot"/>`;
      svg += `<line class="crosshair hide" y1="${padT}" y2="${padT + plotH}"/><circle class="dot hover hide" r="4"/>`;
      svg += `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" class="hit" data-line="1"/>`;
      svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(q('.chart-title').textContent)}">${svg}</svg>`;
      q('.chart-svg').dataset.geo = JSON.stringify({ padL, plotW, n: data.length, H, padT, plotH, t0, t1 });
    }
    q('.chart-sub').textContent = note;
    q('.chart-svg').innerHTML = data.length ? svg : '<p class="info">No data to chart.</p>';
    q('.chart-table').innerHTML = `<table class="stats"><thead><tr><th>${esc(headers[st.x])}</th><th>${esc(aggLabel())}</th></tr></thead><tbody>${data.map(d => `<tr><td>${esc(d.label)}</td><td>${fmtNum(d.value)}</td></tr>`).join('')}</tbody></table>`;
  }
  q('.chart-svg').addEventListener('mousemove', e => {
    const hit = e.target.closest('.hit');
    if (!hit) return hideTip();
    if (hit.dataset.i != null) {
      const d = data[+hit.dataset.i];
      q('.chart-svg').querySelectorAll('.mark').forEach((m, i) => m.classList.toggle('dim', i !== +hit.dataset.i));
      return showTip(e, `<b>${esc(d.label)}</b><br>${esc(aggLabel())}: ${fmtNum(d.value)}`);
    }
    const g = JSON.parse(q('.chart-svg').dataset.geo);
    const svgR = hit.ownerSVGElement.getBoundingClientRect();
    const px = e.clientX - svgR.left;
    const i = Math.max(0, Math.min(g.n - 1, Math.round((px - g.padL) / (g.plotW / Math.max(1, g.n - 1)))));
    const d = data[i];
    const cx = g.padL + (g.n < 2 ? g.plotW / 2 : i / (g.n - 1) * g.plotW), cy = g.padT + g.plotH - (d.value - g.t0) / (g.t1 - g.t0 || 1) * g.plotH;
    const ch = q('.crosshair'), dot = q('.dot.hover');
    ch.setAttribute('x1', cx); ch.setAttribute('x2', cx); ch.classList.remove('hide');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.classList.remove('hide');
    showTip(e, `<b>${esc(d.label)}</b><br>${esc(aggLabel())}: ${fmtNum(d.value)}`);
  });
  q('.chart-svg').addEventListener('mouseleave', () => {
    hideTip();
    q('.chart-svg').querySelectorAll('.mark.dim').forEach(m => m.classList.remove('dim'));
    q('.crosshair')?.classList.add('hide'); q('.dot.hover')?.classList.add('hide');
  });
  q('.toolbar').addEventListener('change', e => {
    const c = e.target.dataset.c;
    if (!c) return;
    st[c] = c === 'type' || c === 'agg' ? e.target.value : +e.target.value;
    if (c === 'agg' && st.agg !== 'count' && !isNumCol(st.y)) { const n = headers.findIndex((_, i) => isNumCol(i)); if (n >= 0) { st.y = n; q('[data-c=y]').value = n; } }
    render();
  });
  q('[data-c=table]').onclick = e => { const on = q('.chart-table').classList.toggle('hide'); e.target.classList.toggle('on', !on); };
  // export: inline the computed colours so the file looks the same outside the app
  function svgMarkup() {
    const svgEl = q('.chart-svg svg');
    if (!svgEl) return null;
    const clone = svgEl.cloneNode(true);
    const cs = getComputedStyle(q('.chart-wrap'));
    const v = n => cs.getPropertyValue(n).trim();
    clone.querySelectorAll('.hit, .crosshair, .hover').forEach(n => n.remove());
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const title = q('.chart-title').textContent;
    clone.insertAdjacentHTML('afterbegin', `<style>text{font:12px system-ui,-apple-system,sans-serif;fill:${v('--chart-text2')}}.cat-label{fill:${v('--chart-text')}}.grid-line{stroke:${v('--chart-grid')};stroke-width:1}.base-line{stroke:${v('--chart-axis')};stroke-width:1}.mark{fill:${v('--series-1')}}.line{fill:none;stroke:${v('--series-1')};stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.dot{fill:${v('--series-1')};stroke:${v('--chart-surface')};stroke-width:2}</style><rect width="100%" height="100%" fill="${v('--chart-surface')}"/><title>${esc(title)}</title>`);
    return new XMLSerializer().serializeToString(clone);
  }
  async function pngBlob() {
    const markup = svgMarkup();
    if (!markup) return null;
    const svgEl = q('.chart-svg svg');
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = svgEl.width.baseVal.value * 2; c.height = svgEl.height.baseVal.value * 2;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(r, 'image/png'));
  }
  const fileBase = () => `${aggLabel()} by ${headers[st.x]}`.replace(/[/\\:]/g, '-');
  tab.view = {
    exports: () => [
      { label: 'Save as picture (.png)…', action: async () => { const b = await pngBlob(); if (b) exportOut({ data: b, name: fileBase() + '.png' }); } },
      { label: 'Save as vector (.svg)…', action: () => { const m = svgMarkup(); if (m) exportOut({ data: m, name: fileBase() + '.svg', mime: 'image/svg+xml' }); } },
      { label: 'Save chart data as CSV…', action: () => exportOut({ data: toCSV([headers[st.x], aggLabel()], data.map(d => [d.label, String(+d.value.toPrecision(12))])), name: fileBase() + '.csv', mime: 'text/csv' }) },
      '-',
      { label: 'Put in a new document', action: async () => {
        const b = await pngBlob();
        if (!b) return;
        const t = addTab('doc', fileBase() + '.docx');
        DocView(t, `<h1>${esc(q('.chart-title').textContent)}</h1><p><img src="${await blobToDataURL(b)}" width="${q('.chart-svg svg').width.baseVal.value}" alt=""></p>` + tableHTML([headers[st.x], aggLabel()], data.map(d => [d.label, fmtNum(d.value)])));
        setDirty(t);
      } },
    ],
    onShow: () => render(),
  };
  q('[data-a=more]').addEventListener('click', e => showMenu(e.currentTarget, tab.view.exports()));
  const ro = new ResizeObserver(debounce(() => { if (!tab.el.classList.contains('hide')) render(); }, 150));
  ro.observe(q('.chart-body'));
  tab.view.dispose = () => ro.disconnect();
  render();
}

// ================================================================ compare two tabs
function compareTabs(a, b) {
  const A = a.view.text(), B = b.view.text();
  const t = addTab('diff', `${a.name} ↔ ${b.name}`);
  DiffView(t, { a: { name: a.name, text: A }, b: { name: b.name, text: B } });
}
function DiffView(tab, { a, b }) {
  let left = a, right = b, showAll = false;
  tab.el.innerHTML = `
    <div class="toolbar">
      <span class="info" data-a="sum"></span>
      <span class="sp"></span>
      <button data-a="prev" title="Previous change">↑ Change</button>
      <button data-a="next" title="Next change">↓ Change</button>
      <label class="info"><input type="checkbox" data-a="all"> Show unchanged lines</label>
      <button data-a="swap">Swap sides</button>
    </div>
    <div class="body"><table class="diff"><colgroup><col class="ln"><col><col class="ln"><col></colgroup><thead></thead><tbody></tbody></table></div>`;
  const q = s => tab.el.querySelector(s);
  let changes = [], at = -1;
  function render() {
    const ops = Formats.diff(left.text.split('\n'), right.text.split('\n'));
    // pair removed + added lines into "changed" rows
    const rows = [];
    let la = 0, lb = 0;
    for (let i = 0; i < ops.length;) {
      if (ops[i][0] === '=') { rows.push({ t: '=', a: ops[i][1], b: ops[i][2], la: ++la, lb: ++lb }); i++; continue; }
      const dels = [], adds = [];
      while (i < ops.length && ops[i][0] !== '=') { (ops[i][0] === '-' ? dels : adds).push(ops[i][0] === '-' ? ops[i][1] : ops[i][2]); i++; }
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        const d = dels[k], ad = adds[k];
        rows.push({ t: d != null && ad != null ? '~' : d != null ? '-' : '+', a: d, b: ad, la: d != null ? ++la : '', lb: ad != null ? ++lb : '' });
      }
    }
    const added = rows.filter(r => r.t === '+').length, removed = rows.filter(r => r.t === '-').length, changed = rows.filter(r => r.t === '~').length;
    q('[data-a=sum]').textContent = added + removed + changed ? `${changed} changed · ${added} added · ${removed} removed lines` : 'The two are identical';
    q('thead').innerHTML = `<tr><th></th><th>${esc(left.name)}</th><th></th><th>${esc(right.name)}</th></tr>`;
    const keep = new Set();
    rows.forEach((r, i) => { if (r.t !== '=') for (let k = i - 3; k <= i + 3; k++) keep.add(k); });
    let html = '', skipped = 0;
    const flushSkip = () => { if (skipped) html += `<tr class="skip"><td colspan="4">⋯ ${skipped} unchanged line${skipped === 1 ? '' : 's'}</td></tr>`; skipped = 0; };
    rows.forEach((r, i) => {
      if (!showAll && r.t === '=' && !keep.has(i)) { skipped++; return; }
      flushSkip();
      const cls = { '=': '', '-': 'del', '+': 'add', '~': 'chg' }[r.t];
      html += `<tr class="${cls}"${r.t !== '=' ? ' data-change' : ''}><td class="ln">${r.la}</td><td class="a">${r.a != null ? esc(r.a) || ' ' : ''}</td><td class="ln">${r.lb}</td><td class="b">${r.b != null ? esc(r.b) || ' ' : ''}</td></tr>`;
    });
    flushSkip();
    q('tbody').innerHTML = html;
    changes = [...q('tbody').querySelectorAll('[data-change]')].filter((r, i, all) => !all[i - 1] || r.previousElementSibling !== all[i - 1]);
    at = -1;
  }
  function go(d) {
    if (!changes.length) return;
    changes[at]?.classList.remove('focus');
    at = (at + d + changes.length) % changes.length;
    changes[at].classList.add('focus');
    changes[at].scrollIntoView({ block: 'center' });
  }
  q('.toolbar').addEventListener('click', e => {
    const a2 = e.target.closest('[data-a]')?.dataset.a;
    if (a2 === 'prev') go(-1);
    else if (a2 === 'next') go(1);
    else if (a2 === 'swap') { [left, right] = [right, left]; render(); }
  });
  q('[data-a=all]').onchange = e => { showAll = e.target.checked; render(); };
  tab.view = { onShow: () => {} };
  render();
}
