'use strict';
// Excel .xlsx ⇄ sheets of text cells ({ name, rows: string[][] }). Values only: formulas keep their last computed result.
const Xlsx = (() => {
  const xesc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const tags = (el, name) => el ? [...el.getElementsByTagNameNS('*', name)] : [];
  const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

  function serialToISO(serial, date1904) {
    const ms = Math.round((serial + (date1904 ? 1462 : 0) - 25569) * 86400000);
    const d = new Date(ms);
    if (isNaN(d)) return String(serial);
    const iso = d.toISOString();
    if (Number.isInteger(serial)) return iso.slice(0, 10);
    if (serial < 1) return iso.slice(11, 19);
    return iso.slice(0, 19).replace('T', ' ');
  }
  const cleanNumber = v => { const n = Number(v); return isNaN(n) ? v : String(Number.isInteger(n) ? n : +n.toPrecision(15)); };

  async function read(buffer) {
    const zip = await Zip.read(buffer);
    const xml = async p => { const t = await zip.text(p); return t ? new DOMParser().parseFromString(t, 'application/xml') : null; };
    const wb = await xml('xl/workbook.xml');
    if (!wb) throw new Error('This file is not an Excel workbook (xl/workbook.xml is missing).');
    const date1904 = ['1', 'true'].includes(tags(wb, 'workbookPr')[0]?.getAttribute('date1904'));
    const rels = {};
    for (const r of tags(await xml('xl/_rels/workbook.xml.rels'), 'Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');

    const shared = tags(await xml('xl/sharedStrings.xml'), 'si').map(si =>
      tags(si, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join(''));

    const styles = await xml('xl/styles.xml');
    const customFmt = {};
    for (const f of tags(styles, 'numFmt')) customFmt[+f.getAttribute('numFmtId')] = f.getAttribute('formatCode') || '';
    const isDateFmt = id => BUILTIN_DATES.has(id) || (customFmt[id] != null && /[dmyhs]/i.test(customFmt[id].replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/^general$/i.test(customFmt[id]));
    const cellXfs = tags(styles, 'cellXfs')[0];
    const dateStyle = cellXfs ? tags(cellXfs, 'xf').map(xf => isDateFmt(+xf.getAttribute('numFmtId'))) : [];

    const sheets = [];
    for (const s of tags(wb, 'sheet')) {
      const rid = s.getAttribute('r:id') || [...s.attributes].find(a => a.localName === 'id')?.value;
      let target = rels[rid] || '';
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const doc = await xml(target);
      const rows = [];
      for (const row of tags(doc, 'row')) {
        const ri = (+row.getAttribute('r') || rows.length + 1) - 1;
        const out = rows[ri] = rows[ri] || [];
        let ci = 0;
        for (const c of tags(row, 'c')) {
          const ref = c.getAttribute('r');
          if (ref) ci = colIndex(ref);
          const t = c.getAttribute('t'), v = tags(c, 'v')[0]?.textContent ?? '';
          let val;
          if (t === 's') val = shared[+v] ?? '';
          else if (t === 'inlineStr') val = tags(c, 't').map(x => x.textContent).join('');
          else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
          else if (t === 'str' || t === 'e' || t === 'd') val = v;
          else if (v === '') { const f = tags(c, 'f')[0]?.textContent; val = f ? '=' + f : ''; } // formula never calculated: show it
          else val = dateStyle[+(c.getAttribute('s') || 0)] ? serialToISO(+v, date1904) : cleanNumber(v);
          out[ci++] = val;
        }
      }
      const width = Math.max(0, ...rows.map(r => r ? r.length : 0));
      const grid = Array.from({ length: rows.length }, (_, i) => Array.from({ length: width }, (_, j) => rows[i]?.[j] ?? ''));
      while (grid.length && grid.at(-1).every(v => v === '')) grid.pop();
      sheets.push({ name: s.getAttribute('name') || `Sheet${sheets.length + 1}`, rows: grid });
    }
    return sheets;
  }

  // sheets: [{ name, headers, rows }] → Blob
  function write(sheets) {
    const used = new Set();
    const safeName = (n, i) => {
      let s = String(n || `Sheet${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || `Sheet${i + 1}`;
      let k = 2, base = s;
      while (used.has(s.toLowerCase())) s = `${base.slice(0, 28)} ${k++}`;
      used.add(s.toLowerCase());
      return s;
    };
    const isNum = v => /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(v);
    const cell = (v, r, c, bold) => {
      v = v == null ? '' : String(v);
      if (v === '') return '';
      const ref = colName(c) + (r + 1);
      if (!bold && isNum(v)) return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
    };
    const files = [];
    const names = sheets.map((s, i) => safeName(s.name, i));
    sheets.forEach((s, i) => {
      const all = [s.headers, ...s.rows];
      const width = Math.max(1, ...all.map(r => r.length));
      const cols = Array.from({ length: width }, (_, c) => {
        const w = Math.min(60, Math.max(8, ...all.slice(0, 500).map(r => String(r[c] ?? '').length + 2)));
        return `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`;
      }).join('');
      const data = all.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ri, ci, ri === 0)).join('')}</row>`).join('');
      files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"${i === 0 ? ' tabSelected="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${data}</sheetData></worksheet>` });
    });
    files.unshift(
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${xesc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    );
    return Zip.write(files).slice(0, undefined, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  return { read, write };
})();
