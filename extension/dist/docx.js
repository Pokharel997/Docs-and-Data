// .docx ⇄ HTML. Covers what a simple editor needs: headings, paragraphs, bold/italic/underline/strike,
// sub/superscript, colours, links, bullet & numbered lists, tables, images, alignment.
const Docx = (() => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------------------------------------------------------- read
  const kids = (el, name) => el ? [...el.children].filter(c => !name || c.localName === name) : [];
  const kid = (el, name) => el ? [...el.children].find(c => c.localName === name) : undefined;
  const attr = (el, name) => el ? el.getAttributeNS(W, name) ?? el.getAttribute('w:' + name) : null;
  const flag = el => !!el && !['0', 'false', 'none', 'off'].includes(attr(el, 'val') ?? '');
  const bytesToDataURL = (bytes, mime) => new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(new Blob([bytes], { type: mime }));
  });
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff' };

  function blockForStyle(name) {
    const h = /^heading\s*(\d)/i.exec(name || '');
    if (h) return 'h' + Math.min(+h[1], 6);
    if (/^title$/i.test(name)) return 'h1';
    if (/^subtitle$/i.test(name)) return 'h3';
    if (/quote/i.test(name)) return 'blockquote';
    return null;
  }

  async function toHTML(buffer) {
    const zip = await Zip.read(buffer);
    const xml = async p => {
      const t = await zip.text(p);
      return t ? new DOMParser().parseFromString(t, 'application/xml') : null;
    };
    const doc = await xml('word/document.xml');
    if (!doc) throw new Error('This file is not a Word document (word/document.xml is missing).');

    const rels = {};
    const relDoc = await xml('word/_rels/document.xml.rels');
    for (const r of relDoc?.querySelectorAll('Relationship') || []) {
      rels[r.getAttribute('Id')] = { target: r.getAttribute('Target'), type: r.getAttribute('Type') || '' };
    }
    for (const rel of Object.values(rels)) {
      if (!/\/image$/.test(rel.type)) continue;
      const path = rel.target.startsWith('/') ? rel.target.slice(1) : 'word/' + rel.target;
      const bytes = await zip.bytes(path);
      if (bytes) rel.data = await bytesToDataURL(bytes, MIME[path.split('.').pop().toLowerCase()] || 'image/png');
    }

    const styles = {}, styleNum = {};
    for (const s of (await xml('word/styles.xml'))?.getElementsByTagNameNS(W, 'style') || []) {
      const id = attr(s, 'styleId'), name = attr(kid(s, 'name'), 'val') || '';
      styles[id] = blockForStyle(name) || blockForStyle(id);
      // list styles ("List Bullet", "List Number 2"…) carry their numbering on the style
      const np = kid(kid(s, 'pPr'), 'numPr');
      const lvl = +(/(\d)$/.exec(name)?.[1] || 1) - 1;
      if (np) styleNum[id] = { numId: attr(kid(np, 'numId'), 'val'), ilvl: attr(kid(np, 'ilvl'), 'val') ?? String(lvl) };
      else if (/^list (bullet|number)/i.test(name)) styleNum[id] = { fmt: /bullet/i.test(name) ? 'ul' : 'ol', ilvl: String(lvl) };
    }

    const numbering = {};
    const nd = await xml('word/numbering.xml');
    if (nd) {
      const abs = {};
      for (const a of nd.getElementsByTagNameNS(W, 'abstractNum')) {
        abs[attr(a, 'abstractNumId')] = Object.fromEntries(kids(a, 'lvl').map(l => [attr(l, 'ilvl'), attr(kid(l, 'numFmt'), 'val')]));
      }
      for (const n of nd.getElementsByTagNameNS(W, 'num')) numbering[attr(n, 'numId')] = abs[attr(kid(n, 'abstractNumId'), 'val')] || {};
    }
    const listTag = (numId, lvl) => {
      const fmt = numbering[numId]?.[lvl] ?? 'bullet';
      return fmt === 'bullet' || fmt === 'none' ? 'ul' : 'ol';
    };

    function image(rid, extentEl) {
      const src = rels[rid]?.data;
      if (!src) return '';
      const w = extentEl ? Math.round(+extentEl.getAttribute('cx') / 9525) : 0;
      return `<img src="${src}"${w ? ` width="${w}"` : ''} alt="">`;
    }

    function run(r) {
      const pr = kid(r, 'rPr');
      let html = '';
      for (const c of r.children) {
        switch (c.localName) {
          case 't': html += esc(c.textContent); break;
          case 'tab': html += '&emsp;'; break;
          case 'br': case 'cr': html += attr(c, 'type') === 'page' ? '' : '<br>'; break;
          case 'noBreakHyphen': html += '-'; break;
          case 'drawing': {
            const blip = c.getElementsByTagNameNS(A, 'blip')[0];
            if (blip) html += image(blip.getAttributeNS(R, 'embed') || blip.getAttribute('r:embed'), c.getElementsByTagNameNS(WP, 'extent')[0]);
            break;
          }
          case 'pict': {
            const im = [...c.getElementsByTagName('*')].find(e => e.localName === 'imagedata');
            if (im) html += image(im.getAttributeNS(R, 'id') || im.getAttribute('r:id'));
            break;
          }
        }
      }
      if (!html || !pr) return html;
      if (flag(kid(pr, 'b'))) html = `<strong>${html}</strong>`;
      if (flag(kid(pr, 'i'))) html = `<em>${html}</em>`;
      if (flag(kid(pr, 'u'))) html = `<u>${html}</u>`;
      if (flag(kid(pr, 'strike')) || flag(kid(pr, 'dstrike'))) html = `<s>${html}</s>`;
      const va = attr(kid(pr, 'vertAlign'), 'val');
      if (va === 'superscript') html = `<sup>${html}</sup>`;
      if (va === 'subscript') html = `<sub>${html}</sub>`;
      const color = attr(kid(pr, 'color'), 'val');
      if (color && /^[0-9a-f]{6}$/i.test(color) && !/^000000$/.test(color)) html = `<span style="color:#${color}">${html}</span>`;
      return html;
    }

    function inline(el) {
      let html = '';
      for (const c of el.children) {
        switch (c.localName) {
          case 'r': html += run(c); break;
          case 'hyperlink': {
            const id = c.getAttributeNS(R, 'id') || c.getAttribute('r:id');
            const href = id ? rels[id]?.target : (attr(c, 'anchor') ? '#' + attr(c, 'anchor') : '');
            const inner = inline(c);
            html += href ? `<a href="${esc(href)}">${inner}</a>` : inner;
            break;
          }
          case 'ins': case 'smartTag': case 'fldSimple': case 'customXml': html += inline(c); break;
          case 'sdt': html += inline(kid(c, 'sdtContent')); break;
        }
      }
      return html;
    }

    function cell(tc) {
      const pr = kid(tc, 'tcPr');
      const span = +attr(kid(pr, 'gridSpan'), 'val') || 1;
      return `<td${span > 1 ? ` colspan="${span}"` : ''}>${blocks(tc)}</td>`;
    }

    function blocks(container) {
      const out = [], stack = [];
      const closeTo = level => { while (stack.length && stack.at(-1).level > level) out.push(`</li></${stack.pop().tag}>`); };
      for (const el of kids(container)) {
        if (el.localName === 'p') {
          const pPr = kid(el, 'pPr');
          const styleId = attr(kid(pPr, 'pStyle'), 'val');
          let tag = styles[styleId] || blockForStyle(styleId) || 'p';
          const align = { center: 'center', right: 'right', end: 'right', both: 'justify' }[attr(kid(pPr, 'jc'), 'val')];
          let inner = inline(el);
          const numPr = kid(pPr, 'numPr'), sn = styleNum[styleId];
          const numId = numPr ? attr(kid(numPr, 'numId'), 'val') : sn?.numId;
          if ((numId && numId !== '0') || (!numPr && sn?.fmt)) {
            const level = +(numPr ? attr(kid(numPr, 'ilvl'), 'val') : null) || +(sn?.ilvl ?? 0) || 0;
            const lt = sn?.fmt && !numId ? sn.fmt : listTag(numId, String(level));
            if (!styles[styleId]) tag = 'p';
            closeTo(level);
            if (stack.at(-1)?.level === level && stack.at(-1).tag !== lt) out.push(`</li></${stack.pop().tag}>`);
            if (stack.at(-1)?.level === level) out.push('</li><li>');
            else { out.push(`<${lt}><li>`); stack.push({ tag: lt, level }); }
            out.push(tag === 'p' ? inner : `<${tag}>${inner}</${tag}>`);
            continue;
          }
          closeTo(-1);
          out.push(`<${tag}${align ? ` style="text-align:${align}"` : ''}>${inner || '<br>'}</${tag}>`);
        } else if (el.localName === 'tbl') {
          closeTo(-1);
          out.push('<table>' + kids(el, 'tr').map(tr => '<tr>' + kids(tr, 'tc').map(cell).join('') + '</tr>').join('') + '</table>');
        } else if (el.localName === 'sdt') {
          closeTo(-1);
          out.push(blocks(kid(el, 'sdtContent')));
        }
      }
      closeTo(-1);
      return out.join('');
    }

    return blocks(kid(doc.documentElement, 'body'));
  }

  // ---------------------------------------------------------------- write
  const xesc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'table', 'hr', 'pre',
    'section', 'article', 'header', 'footer', 'figure', 'main', 'aside', 'nav', 'dl', 'dt', 'dd', 'figcaption', 'address']);

  async function imageInfo(img) {
    let blob;
    try { blob = await (await fetch(img.src)).blob(); } catch { return null; }
    let ext = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif' }[blob.type];
    if (!ext) {
      // Word can't show webp/svg/etc. reliably: re-encode as PNG.
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || 300; c.height = img.naturalHeight || 150;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      blob = await new Promise(r => c.toBlob(r, 'image/png'));
      if (!blob) return null;
      ext = 'png';
    }
    let w = img.width || img.naturalWidth || 300, h = img.height || img.naturalHeight || 150;
    if (img.naturalWidth && !img.width) h = img.naturalHeight;
    if (w > 620) { h = Math.round(h * 620 / w); w = 620; }
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext, cx: w * 9525, cy: h * 9525 };
  }

  const colorHex = v => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v || '');
    if (m) return m.slice(1, 4).map(n => (+n).toString(16).padStart(2, '0')).join('');
    const h = /^#([0-9a-f]{6})$/i.exec(v || '');
    return h ? h[1] : null;
  };

  async function fromHTML(root) {
    const rels = [], media = [], numInstances = [];
    let relSeq = 2, picSeq = 0;
    const addRel = (type, target, external) => {
      const id = 'rId' + (++relSeq);
      rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${xesc(target)}"${external ? ' TargetMode="External"' : ''}/>`);
      return id;
    };
    const images = new Map();
    for (const img of root.querySelectorAll('img')) {
      const info = await imageInfo(img);
      if (!info) continue;
      const file = `image${media.length + 1}.${info.ext}`;
      media.push({ name: 'word/media/' + file, data: info.bytes });
      images.set(img, { ...info, rid: addRel('image', 'media/' + file) });
    }

    function rPr(f) {
      return '<w:rPr>' + (f.link ? '<w:rStyle w:val="Hyperlink"/>' : '') +
        (f.mono ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>' : '') +
        (f.b ? '<w:b/>' : '') + (f.i ? '<w:i/>' : '') + (f.s ? '<w:strike/>' : '') +
        (f.color ? `<w:color w:val="${f.color}"/>` : '') + (f.u ? '<w:u w:val="single"/>' : '') +
        (f.sup ? '<w:vertAlign w:val="superscript"/>' : f.sub ? '<w:vertAlign w:val="subscript"/>' : '') + '</w:rPr>';
    }

    function runs(node, f, pre) {
      if (node.nodeType === 3) {
        let t = node.textContent;
        if (!pre) t = t.replace(/[\s\u00a0]+/g, m => m.includes('\u00a0') ? '\u00a0'.repeat(m.length) : ' ');
        if (!t) return '';
        return t.split('\n').map(line => `<w:r>${rPr(f)}<w:t xml:space="preserve">${xesc(line)}</w:t></w:r>`).join('<w:r><w:br/></w:r>');
      }
      if (node.nodeType !== 1) return '';
      const tag = node.localName;
      if (tag === 'br') return '<w:r><w:br/></w:r>';
      if (tag === 'img') {
        const im = images.get(node); if (!im) return '';
        const id = ++picSeq;
        return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${im.cx}" cy="${im.cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><a:graphic xmlns:a="${A}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${im.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${im.cx}" cy="${im.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
      }
      if (tag === 'script' || tag === 'style') return '';
      const g = { ...f }, st = node.style;
      if (tag === 'b' || tag === 'strong' || /^(bold|[6-9]00)$/.test(st?.fontWeight)) g.b = true;
      if (tag === 'i' || tag === 'em' || st?.fontStyle === 'italic') g.i = true;
      if (tag === 'u' || st?.textDecoration?.includes('underline')) g.u = true;
      if (tag === 's' || tag === 'strike' || tag === 'del' || st?.textDecoration?.includes('line-through')) g.s = true;
      if (tag === 'sup') g.sup = true;
      if (tag === 'sub') g.sub = true;
      if (tag === 'code' || tag === 'kbd' || tag === 'tt') g.mono = true;
      const col = colorHex(st?.color || node.getAttribute?.('color'));
      if (col) g.color = col;
      const inner = [...node.childNodes].map(c => runs(c, g, pre || tag === 'pre')).join('');
      const href = tag === 'a' && node.getAttribute('href');
      if (href && /^(https?:|mailto:)/i.test(href) && !f.link) {
        return `<w:hyperlink r:id="${addRel('hyperlink', href, true)}">${[...node.childNodes].map(c => runs(c, { ...g, link: true }, pre)).join('')}</w:hyperlink>`;
      }
      return inner;
    }

    function para(nodes, ctx) {
      const content = nodes.map(n => runs(n, ctx.fmt || {}, ctx.pre)).join('');
      if (!content && ctx.skipEmpty) return '';
      const align = { center: 'center', right: 'right', justify: 'both' }[ctx.align];
      const pPr = (ctx.style ? `<w:pStyle w:val="${ctx.style}"/>` : '') +
        (ctx.list ? `<w:numPr><w:ilvl w:val="${ctx.list.ilvl}"/><w:numId w:val="${ctx.list.numId}"/></w:numPr>` : '') +
        (align ? `<w:jc w:val="${align}"/>` : '');
      return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;
    }

    function table(tbl, ctx) {
      const rows = [...tbl.rows];
      const cols = Math.max(1, ...rows.map(r => [...r.cells].reduce((n, c) => n + (c.colSpan || 1), 0)));
      const cw = Math.floor(9360 / cols);
      const border = s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="A6AEB8"/>`;
      let x = `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${cw}"/>`.repeat(cols)}</w:tblGrid>`;
      for (const tr of rows) {
        x += '<w:tr>';
        for (const td of tr.cells) {
          const span = td.colSpan || 1;
          const out = [];
          walk(td, { fmt: td.localName === 'th' ? { b: true } : {}, align: td.style.textAlign }, out);
          x += `<w:tc><w:tcPr><w:tcW w:w="${cw * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr>${out.join('') || '<w:p/>'}</w:tc>`;
        }
        x += '</w:tr>';
      }
      return x + '</w:tbl>';
    }

    function walk(parent, ctx, out) {
      let pending = [];
      // Only the first paragraph of a list item carries the bullet; later ones are indented continuations.
      const emit = xml => {
        out.push(xml);
        if (ctx.list) ctx = { ...ctx, list: undefined, style: 'ListParagraph' };
      };
      const flush = () => {
        if (pending.some(n => n.nodeType === 1 || n.textContent.trim())) emit(para(pending, ctx));
        pending = [];
      };
      for (const n of parent.childNodes) {
        const tag = n.nodeType === 1 ? n.localName : null;
        if (!tag || !BLOCK.has(tag)) { pending.push(n); continue; }
        flush();
        const align = n.style?.textAlign || ctx.align;
        if (/^h[1-6]$/.test(tag)) emit(para([...n.childNodes], { ...ctx, style: 'Heading' + tag[1], align }));
        else if (tag === 'ul' || tag === 'ol') {
          let numId = 1;
          if (tag === 'ol') { numInstances.push(+(n.getAttribute('start') || 1)); numId = numInstances.length + 1; }
          const ilvl = ctx.list ? Math.min(ctx.list.ilvl + 1, 8) : ctx.style === 'ListParagraph' && ctx.level != null ? Math.min(ctx.level + 1, 8) : 0;
          for (const li of n.children) {
            const before = out.length;
            const lctx = { ...ctx, list: { numId, ilvl }, level: ilvl, style: undefined };
            if (li.localName === 'li') {
              walk(li, lctx, out);
              if (out.length === before) out.push(para([], lctx));
            } else walk(li, ctx, out);
          }
        } else if (tag === 'table') emit(table(n, ctx));
        else if (tag === 'hr') emit('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="A6AEB8"/></w:pBdr></w:pPr></w:p>');
        else if (tag === 'blockquote') walk(n, { ...ctx, style: 'Quote', align }, out);
        else if (tag === 'pre') emit(para([...n.childNodes], { ...ctx, pre: true, fmt: { ...ctx.fmt, mono: true }, align }));
        else if ([...n.children].some(c => BLOCK.has(c.localName))) {
          const before = out.length;
          walk(n, { ...ctx, align }, out);
          if (ctx.list && out.length > before) ctx = { ...ctx, list: undefined, style: 'ListParagraph' };
        } else emit(para([...n.childNodes], { ...ctx, align }));
      }
      flush();
    }

    const out = [];
    walk(root, {}, out);
    if (!out.length || out.at(-1).startsWith('<w:tbl>')) out.push('<w:p/>');

    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${out.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;

    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
      { name: 'word/document.xml', data: document },
      { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${rels.join('')}</Relationships>` },
      { name: 'word/styles.xml', data: STYLES },
      { name: 'word/numbering.xml', data: numberingXML(numInstances) },
      ...media,
    ];
    return Zip.write(files).slice(0, undefined, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }

  const heading = (n, size, color) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(1, 36, '1F3A5F')}${heading(2, 30, '1F3A5F')}${heading(3, 26, '2E4A6B')}${heading(4, 24, '2E4A6B')}${heading(5, 22, '2E4A6B')}${heading(6, 22, '5A6B7D')}<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="A6AEB8"/></w:pBdr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/><w:color w:val="4A5562"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1F5FBF"/><w:u w:val="single"/></w:rPr></w:style></w:styles>`;

  function numberingXML(olStarts) {
    const bullets = ['•', '◦', '▪'], fmts = ['decimal', 'lowerLetter', 'lowerRoman'];
    const lvl = (i, fmt, text) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
    const levels = fn => Array.from({ length: 9 }, (_, i) => fn(i)).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(i => lvl(i, 'bullet', bullets[i % 3]))}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(i => lvl(i, fmts[i % 3], `%${i + 1}.`))}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${olStarts.map((start, k) => `<w:num w:numId="${k + 2}"><w:abstractNumId w:val="1"/>${levels(i => `<w:lvlOverride w:ilvl="${i}"><w:startOverride w:val="${i ? 1 : start}"/></w:lvlOverride>`)}</w:num>`).join('')}</w:numbering>`;
  }

  return { toHTML, fromHTML };
})();
