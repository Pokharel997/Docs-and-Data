'use strict';
// Format helpers: Markdown ⇄ HTML, YAML (common subset), XML → JSON, SRT → VTT, JSON queries, line diff.
const Formats = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------ Markdown → HTML
  function mdInline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = esc(s)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, a, u) => `<img src="${u}" alt="${a}">`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, t, u) => `<a href="${u}">${t}</a>`)
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>')
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
      .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  }
  const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const splitRow = l => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));

  function mdToHtml(src) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    const flush = () => {
      if (para.length) out.push('<p>' + para.map(mdInline).join('\n').replace(/ {2,}\n/g, '<br>') + '</p>');
      para = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if ((m = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line))) {
        flush();
        const fence = m[1], code = [];
        while (++i < lines.length && !lines[i].trim().startsWith(fence)) code.push(lines[i]);
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      } else if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
        flush(); out.push(`<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`);
      } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flush(); out.push('<hr>');
      } else if (/^\s*>/.test(line)) {
        flush();
        const q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
        i--;
        out.push(`<blockquote>${mdToHtml(q.join('\n'))}</blockquote>`);
      } else if (line.includes('|') && TABLE_SEP.test(lines[i + 1] || '')) {
        flush();
        const head = splitRow(line);
        i += 2;
        const body = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) body.push(splitRow(lines[i++]));
        i--;
        out.push('<table><thead><tr>' + head.map(h => `<th>${mdInline(h)}</th>`).join('') + '</tr></thead><tbody>' +
          body.map(r => '<tr>' + head.map((_, k) => `<td>${mdInline(r[k] || '')}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      } else if (LIST_RE.test(line)) {
        flush();
        const stack = [];
        let html = '';
        while (i < lines.length) {
          const l = lines[i];
          const lm = LIST_RE.exec(l);
          if (lm) {
            const indent = lm[1].replace(/\t/g, '    ').length, tag = /\d/.test(lm[2]) ? 'ol' : 'ul';
            let text = lm[3].replace(/^\[ \]\s+/, '☐ ').replace(/^\[[xX]\]\s+/, '☑ ');
            while (stack.length && stack.at(-1).indent > indent) html += `</li></${stack.pop().tag}>`;
            if (stack.length && stack.at(-1).indent === indent && stack.at(-1).tag !== tag) html += `</li></${stack.pop().tag}>`;
            if (stack.length && stack.at(-1).indent === indent) html += '</li><li>';
            else { html += `<${tag}><li>`; stack.push({ indent, tag }); }
            html += mdInline(text);
          } else if (l.trim() && /^\s+/.test(l)) html += ' ' + mdInline(l.trim());
          else break;
          i++;
        }
        i--;
        while (stack.length) html += `</li></${stack.pop().tag}>`;
        out.push(html);
      } else if (!line.trim()) flush();
      else para.push(line);
    }
    flush();
    return out.join('\n');
  }

  // ------------------------------------------------------------ HTML → Markdown
  function htmlToMd(root) {
    const inline = n => {
      if (n.nodeType === 3) return n.textContent.replace(/\s+/g, ' ');
      if (n.nodeType !== 1) return '';
      const t = n.localName, inner = [...n.childNodes].map(inline).join('');
      switch (t) {
        case 'strong': case 'b': return inner.trim() ? `**${inner}**` : inner;
        case 'em': case 'i': return inner.trim() ? `*${inner}*` : inner;
        case 's': case 'strike': case 'del': return `~~${inner}~~`;
        case 'code': return '`' + n.textContent + '`';
        case 'a': return `[${inner}](${n.getAttribute('href') || ''})`;
        case 'img': return `![${n.alt || ''}](${n.getAttribute('src') || ''})`;
        case 'br': return '  \n';
        default: return inner;
      }
    };
    const block = (el, depth = 0) => {
      const out = [];
      let buf = '';
      const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ''; };
      for (const n of el.childNodes) {
        const t = n.nodeType === 1 ? n.localName : null;
        if (/^h[1-6]$/.test(t)) { flush(); out.push('#'.repeat(+t[1]) + ' ' + inline(n).trim()); }
        else if (t === 'p' || t === 'div') { flush(); out.push(...block(n, depth)); }
        else if (t === 'pre') { flush(); out.push('```\n' + n.textContent.replace(/\n$/, '') + '\n```'); }
        else if (t === 'blockquote') { flush(); out.push(block(n, depth).join('\n\n').split('\n').map(l => '> ' + l).join('\n')); }
        else if (t === 'hr') { flush(); out.push('---'); }
        else if (t === 'ul' || t === 'ol') {
          flush();
          let k = +(n.getAttribute('start') || 1);
          const items = [...n.children].filter(c => c.localName === 'li').map(li => {
            const bullet = t === 'ol' ? `${k++}. ` : '- ';
            const parts = block(li, depth + 1);
            return bullet + (parts.join('\n').split('\n').map((l, j) => j ? '   ' + l : l).join('\n'));
          });
          out.push(items.join('\n'));
        } else if (t === 'table') {
          flush();
          const rows = [...n.rows].map(r => [...r.cells].map(c => inline(c).trim().replace(/\|/g, '\\|')));
          if (rows.length) {
            const w = Math.max(...rows.map(r => r.length));
            const pad = r => { while (r.length < w) r.push(''); return r; };
            out.push(['| ' + pad(rows[0]).join(' | ') + ' |', '|' + ' --- |'.repeat(w), ...rows.slice(1).map(r => '| ' + pad(r).join(' | ') + ' |')].join('\n'));
          }
        } else buf += inline(n);
      }
      flush();
      return out;
    };
    return block(root).join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
  }

  // ------------------------------------------------------------ YAML (block maps/lists, scalars, block scalars, flow collections)
  function yamlError(msg, line) { return new Error(`${msg} (line ${line})`); }
  function stripComment(s) {
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === q && s[i - 1] !== '\\') q = null; }
      else if (c === '"' || c === "'") q = c;
      else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
    }
    return s;
  }
  function yamlScalar(s, line) {
    s = s.trim();
    if (/^![\w!]*\s+/.test(s)) s = s.replace(/^![\w!]*\s+/, '');
    if (/^[&*]/.test(s)) throw yamlError('Anchors and aliases (& and *) are not supported', line);
    if (s.startsWith('"')) { try { return JSON.parse(s); } catch { throw yamlError('Bad double-quoted string', line); } }
    if (s.startsWith("'")) { if (!s.endsWith("'") || s.length < 2) throw yamlError('Bad single-quoted string', line); return s.slice(1, -1).replace(/''/g, "'"); }
    if (s.startsWith('[') || s.startsWith('{')) return flow(s, line);
    if (/^(null|Null|NULL|~|)$/.test(s)) return null;
    if (/^(true|True|TRUE)$/.test(s)) return true;
    if (/^(false|False|FALSE)$/.test(s)) return false;
    if (/^[-+]?(\d[\d_]*)?(\.\d+)?([eE][-+]?\d+)?$/.test(s) && /\d/.test(s)) return Number(s.replace(/_/g, ''));
    if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
    if (/^[-+]?\.inf$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
    if (/^\.nan$/i.test(s)) return NaN;
    return s;
  }
  function flow(s, line) {
    let i = 0;
    const ws = () => { while (/\s/.test(s[i])) i++; };
    const value = () => {
      ws();
      if (s[i] === '[') {
        i++; const arr = [];
        for (;;) { ws(); if (s[i] === ']') { i++; return arr; } arr.push(value()); ws(); if (s[i] === ',') i++; else if (s[i] !== ']') throw yamlError('Bad [ ] list', line); }
      }
      if (s[i] === '{') {
        i++; const obj = {};
        for (;;) {
          ws(); if (s[i] === '}') { i++; return obj; }
          const k = token(':'); if (s[i] !== ':') throw yamlError('Bad { } map', line); i++;
          obj[k] = value(); ws(); if (s[i] === ',') i++; else if (s[i] !== '}') throw yamlError('Bad { } map', line);
        }
      }
      return token(',]}');
    };
    const token = stops => {
      ws();
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i]; let j = i + 1;
        while (j < s.length && !(s[j] === q && (q === "'" ? s[j + 1] !== "'" : s[j - 1] !== '\\'))) j += q === "'" && s[j] === "'" ? 2 : 1;
        const raw = s.slice(i, j + 1); i = j + 1; return yamlScalar(raw, line);
      }
      let j = i;
      while (j < s.length && !stops.includes(s[j]) && !(stops.includes(':') && s[j] === ':' && /\s/.test(s[j + 1] || ' '))) j++;
      const raw = s.slice(i, j); i = j; return yamlScalar(raw, line);
    };
    const v = value(); ws();
    if (i < s.length) throw yamlError('Unexpected text after a [ ] or { } value', line);
    return v;
  }
  const KEY_RE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"{[\-?][^#]*?|-[^\s][^#]*?)\s*:(?=\s|$)/;
  function parseYAML(src) {
    const L = src.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');
    let i = 0;
    const indentOf = l => l.match(/^ */)[0].length;
    const skip = l => /^\s*(#.*)?$/.test(l) || /^(---|\.\.\.)(\s.*)?$/.test(l);
    const peek = () => {
      while (i < L.length && skip(L[i])) {
        if (/^---/.test(L[i]) && L.slice(0, i).some(l => !skip(l))) throw yamlError('Files with several YAML documents (---) are not supported', i + 1);
        i++;
      }
      return i < L.length ? { indent: indentOf(L[i]), text: stripComment(L[i].trim()) } : null;
    };
    const isDash = t => t.text === '-' || t.text.startsWith('- ');
    const unquote = k => k.startsWith('"') ? JSON.parse(k) : k.startsWith("'") ? k.slice(1, -1).replace(/''/g, "'") : k.trim();
    function block(indent) {
      const t = peek();
      if (!t || t.indent < indent) return null;
      return isDash(t) ? seq(t.indent) : map(t.indent);
    }
    function scalarOrBlock(rest, indent) {
      const bm = /^([|>])([-+]?)\d*$/.exec(rest);
      if (!bm) return yamlScalar(rest, i);
      const lines = [];
      let bi = null;
      while (i < L.length && (!L[i].trim() || indentOf(L[i]) > indent)) {
        if (L[i].trim() && bi == null) bi = indentOf(L[i]);
        lines.push(L[i].trim() ? L[i].slice(bi) : '');
        i++;
      }
      let end = lines.length;
      while (end && !lines[end - 1]) end--;
      const body = lines.slice(0, end);
      let text = bm[1] === '|' ? body.join('\n') : body.reduce((acc, l, k) => !k ? l : (l === '' ? acc + '\n' : acc + (acc.endsWith('\n') ? '' : ' ') + l), '');
      if (bm[2] === '+') text += '\n'.repeat(lines.length - end + 1);
      else if (bm[2] !== '-') text += '\n';
      return text;
    }
    function seq(indent) {
      const arr = [];
      for (;;) {
        const t = peek();
        if (!t || t.indent !== indent || !isDash(t)) break;
        const rest = t.text.slice(1).trim();
        if (!rest) { i++; arr.push(block(indent + 1)); continue; }
        if (KEY_RE.test(rest)) {
          const m = /^(\s*-\s+)/.exec(L[i]);
          L[i] = ' '.repeat(m[1].length) + L[i].slice(m[1].length);
          arr.push(map(m[1].length));
          continue;
        }
        if (rest.startsWith('- ')) {
          const m = /^(\s*-\s+)/.exec(L[i]);
          L[i] = ' '.repeat(m[1].length) + L[i].slice(m[1].length);
          arr.push(seq(m[1].length));
          continue;
        }
        i++;
        arr.push(scalarOrBlock(rest, indent));
      }
      return arr;
    }
    function map(indent) {
      const obj = {};
      for (;;) {
        const t = peek();
        if (!t || t.indent !== indent || isDash(t)) break;
        const m = KEY_RE.exec(t.text);
        if (!m) throw yamlError('Expected “key: value”', i + 1);
        const key = unquote(m[1]), rest = t.text.slice(m[0].length).trim();
        i++;
        if (!rest) {
          const nt = peek();
          obj[key] = nt && (nt.indent > indent || (nt.indent === indent && isDash(nt))) ? block(nt.indent) : null;
        } else obj[key] = scalarOrBlock(rest, indent);
      }
      const t = peek();
      if (t && t.indent > indent) throw yamlError('Unexpected indentation', i + 1);
      return obj;
    }
    const first = peek();
    if (!first) return null;
    if (!isDash(first) && !KEY_RE.test(first.text)) { const v = yamlScalar(first.text, i + 1); i++; if (peek()) throw yamlError('Unexpected text', i + 1); return v; }
    const v = block(first.indent);
    if (peek()) throw yamlError('Unexpected indentation or text', i + 1);
    return v;
  }
  function yamlStr(s) {
    if (s === '' || /^[\s]|[\s]$|^[-?:,[\]{}#&*!|>'"%@`]|: |\s#|[\n\t]/.test(s) || /^(true|false|null|~|yes|no|on|off)$/i.test(s) ||
        /^[-+]?(\d[\d_]*)?(\.\d+)?([eE][-+]?\d+)?$/.test(s) && /\d/.test(s)) return JSON.stringify(s);
    return s;
  }
  function toYAML(v, ind = '') {
    const scalar = x => x === null || x === undefined ? 'null' : typeof x === 'string' ? yamlStr(x) : typeof x === 'number' && !isFinite(x) ? (isNaN(x) ? '.nan' : x > 0 ? '.inf' : '-.inf') : String(x);
    const isObj = x => x && typeof x === 'object';
    if (!isObj(v)) return scalar(v) + '\n';
    if (Array.isArray(v)) {
      if (!v.length) return '[]\n';
      return v.map(x => {
        if (!isObj(x) || (Array.isArray(x) ? !x.length : !Object.keys(x).length)) return `${ind}- ${isObj(x) ? (Array.isArray(x) ? '[]' : '{}') : scalar(x)}\n`;
        const inner = toYAML(x, ind + '  ');
        return `${ind}- ` + inner.slice(ind.length + 2);
      }).join('');
    }
    const keys = Object.keys(v);
    if (!keys.length) return '{}\n';
    return keys.map(k => {
      const x = v[k], key = yamlStr(k);
      if (isObj(x) && (Array.isArray(x) ? x.length : Object.keys(x).length)) return `${ind}${key}:\n` + toYAML(x, ind + '  ');
      return `${ind}${key}: ${isObj(x) ? (Array.isArray(x) ? '[]' : '{}') : scalar(x)}\n`;
    }).join('');
  }

  // ------------------------------------------------------------ XML → JSON
  function xmlToJSON(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error(err.textContent.split('\n').filter(Boolean).slice(0, 2).join(' '));
    const conv = el => {
      const o = {};
      for (const a of el.attributes) o['@' + a.name] = a.value;
      const kids = [...el.children];
      const text = [...el.childNodes].filter(n => n.nodeType === 3 || n.nodeType === 4).map(n => n.textContent).join('').trim();
      if (!kids.length && !el.attributes.length) return text;
      if (text) o['#text'] = text;
      for (const k of kids) {
        const v = conv(k);
        if (k.nodeName in o) { if (!Array.isArray(o[k.nodeName]) || !o['\u0000' + k.nodeName]) { o[k.nodeName] = [o[k.nodeName]]; o['\u0000' + k.nodeName] = true; } o[k.nodeName].push(v); }
        else o[k.nodeName] = v;
      }
      for (const k of Object.keys(o)) if (k.startsWith('\u0000')) delete o[k];
      return o;
    };
    return { [doc.documentElement.nodeName]: conv(doc.documentElement) };
  }

  // ------------------------------------------------------------ subtitles
  const srtToVtt = t => 'WEBVTT\n\n' + t.replace(/\r/g, '').replace(/^\uFEFF/, '').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2');

  // ------------------------------------------------------------ JSON query: users[*].email, $.a.b[0], items[?price>10].name, ..id
  function query(data, path) {
    path = path.trim().replace(/^\$/, '');
    let nodes = [data], multi = false, m;
    const getPath = (o, p) => p.split('.').reduce((x, k) => x == null ? undefined : x[k], o);
    const children = x => x && typeof x === 'object' ? (Array.isArray(x) ? x : Object.values(x)) : [];
    const deep = (x, key, out) => { if (x && typeof x === 'object') { if (!Array.isArray(x) && key in x) out.push(x[key]); children(x).forEach(c => deep(c, key, out)); } return out; };
    while (path) {
      if ((m = /^\.\.([\w$-]+)/.exec(path))) { multi = true; nodes = nodes.flatMap(n => deep(n, m[1], [])); }
      else if ((m = /^\.?([A-Za-z_$][\w$-]*)/.exec(path))) nodes = nodes.map(n => n?.[m[1]]).filter(v => v !== undefined);
      else if ((m = /^(?:\.\*|\[\*\])/.exec(path))) { multi = true; nodes = nodes.flatMap(children); }
      else if ((m = /^\[(-?\d+)\]/.exec(path))) nodes = nodes.map(n => Array.isArray(n) ? n.at(+m[1]) : undefined).filter(v => v !== undefined);
      else if ((m = /^\[(\d*):(\d*)\]/.exec(path))) { multi = true; nodes = nodes.flatMap(n => Array.isArray(n) ? n.slice(m[1] ? +m[1] : 0, m[2] ? +m[2] : undefined) : []); }
      else if ((m = /^\[(['"])(.*?)\1\]/.exec(path))) nodes = nodes.map(n => n?.[m[2]]).filter(v => v !== undefined);
      else if ((m = /^\[\?\(?\s*(.+?)\s*\)?\]/.exec(path))) {
        multi = true;
        const f = /^@?\.?([\w$.-]+)\s*(==|=|!=|>=|<=|>|<|~)\s*(.+)$/.exec(m[1]);
        const field = f ? f[1] : m[1].replace(/^@?\.?/, '');
        let val = f?.[3];
        if (val != null) { try { val = JSON.parse(val.replace(/^'(.*)'$/, '"$1"')); } catch { /* bare word */ } }
        const test = x => {
          const v = getPath(x, field);
          if (!f) return !!v;
          switch (f[2]) {
            case '=': case '==': return v == val; // eslint-disable-line eqeqeq
            case '!=': return v != val; // eslint-disable-line eqeqeq
            case '>': return v > val; case '<': return v < val; case '>=': return v >= val; case '<=': return v <= val;
            case '~': return String(v ?? '').toLowerCase().includes(String(val).toLowerCase());
          }
        };
        nodes = nodes.flatMap(n => children(n).filter(test));
      } else throw new Error(`Can't read the query near “${path.slice(0, 20)}”`);
      path = path.slice(m[0].length);
    }
    return multi ? nodes : nodes[0];
  }

  // ------------------------------------------------------------ line diff (Myers). Returns [['=',a,b] | ['-',a,null] | ['+',null,b]]
  function diff(a, b) {
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
    const N = A.length, M = B.length, max = N + M, off = max + 1;
    const V = new Int32Array(2 * max + 3), trace = [];
    let ops = null;
    outer: for (let d = 0; d <= max; d++) {
      if (d > 4000) break;
      trace.push(V.slice(off - d - 1, off + d + 2));
      for (let k = -d; k <= d; k += 2) {
        let x = (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && A[x] === B[y]) { x++; y++; }
        V[off + k] = x;
        if (x >= N && y >= M) { ops = []; break outer; }
      }
    }
    if (!ops) { // too different: fall back to removing all and adding all
      ops = [...A.map(l => ['-', l, null]), ...B.map(l => ['+', null, l])];
    } else {
      let x = N, y = M;
      for (let d = trace.length - 1; d >= 0; d--) {
        const Vd = trace[d], get = k => Vd[k + d + 1];
        const k = x - y;
        const prevK = (k === -d || (k !== d && get(k - 1) < get(k + 1))) ? k + 1 : k - 1;
        const prevX = get(prevK), prevY = prevX - prevK;
        while (x > prevX && y > prevY) { ops.push(['=', A[x - 1], B[y - 1]]); x--; y--; }
        if (d > 0) { if (x === prevX) ops.push(['+', null, B[y - 1]]); else ops.push(['-', A[x - 1], null]); }
        x = prevX; y = prevY;
      }
      ops.reverse();
    }
    return [...a.slice(0, pre).map(l => ['=', l, l]), ...ops, ...a.slice(a.length - suf).map(l => ['=', l, l])];
  }

  return { mdToHtml, htmlToMd, parseYAML, toYAML, xmlToJSON, srtToVtt, query, diff };
})();
