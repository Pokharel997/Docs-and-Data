# Generates the Data & Docs logo set: the four-tile icon (sheets, documents, JSON, media) and "Data & Docs" beside it.
# Text is converted to outlines, so no font is needed to view the files.
#   pip install fonttools && python3 design/make-logos.py        (macOS: uses Avenir Next from the system)
# The app icons themselves are drawn by app/make-icon.swift with the same geometry.
import os
from fontTools.ttLib import TTCollection
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
here = os.path.dirname(os.path.abspath(__file__))

CSV, DOC, JSON, MEDIA = '#0f7b5f', '#2b59c3', '#a96500', '#8a3fa0'
TILES = [CSV, DOC, JSON, MEDIA]  # top-left, top-right, bottom-left, bottom-right
GREEN, INK, PAPER = CSV, '#1b2530', '#f7f6f2'

_faces = None

def text(s, x, y, size, fill, face='Avenir Next Bold', tracking=0.0, colors=None, anchor='start'):
    """Text as SVG paths. Returns (svg, width). colors: {index: color} to recolour single characters."""
    global _faces
    if _faces is None:
        _faces = {f['name'].getDebugName(4): f for f in TTCollection('/System/Library/Fonts/Avenir Next.ttc').fonts}
    font = _faces[face]
    gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font['head'].unitsPerEm
    k = size / upm
    width = sum(gs[cmap[ord(ch)]].width * k + tracking for ch in s) - tracking
    cx = x - (width / 2 if anchor == 'middle' else 0)
    out = []
    for i, ch in enumerate(s):
        g = gs[cmap[ord(ch)]]
        pen = SVGPathPen(gs)
        g.draw(TransformPen(pen, (k, 0, 0, -k, cx, y)))
        d = pen.getCommands()
        if d: out.append(f'<path d="{d}" fill="{(colors or {}).get(i, fill)}"/>')
        cx += g.width * k + tracking
    return ''.join(out), width

def tile_glyph(i, x, y, t):
    """White symbol inside a tile: grid (sheets), text lines (documents), braces (JSON), play (media)."""
    s = t / 300
    if i == 0:
        return ''.join(f'<rect x="{x + (52 + gx * 68) * s:.1f}" y="{y + (52 + gy * 68) * s:.1f}" width="{56 * s:.1f}" height="{56 * s:.1f}" rx="{10 * s:.1f}" fill="#fff" opacity=".9"/>'
                       for gx in range(3) for gy in range(3))
    if i == 1:
        return ''.join(f'<rect x="{x + 52 * s:.1f}" y="{y + (70 + n * 50) * s:.1f}" width="{w * s:.1f}" height="{24 * s:.1f}" rx="{12 * s:.1f}" fill="#fff" opacity=".9"/>'
                       for n, w in enumerate([196, 160, 196, 120]))
    if i == 2:
        out = []
        for d in (-1, 1):
            cx = x + 150 * s + d * 62 * s
            pts = [(cx + d * 18 * s, y + 70 * s), (cx, y + 90 * s), (cx, y + 128 * s), (cx - d * 24 * s, y + 150 * s),
                   (cx, y + 172 * s), (cx, y + 210 * s), (cx + d * 18 * s, y + 230 * s)]
            out.append('<polyline points="' + ' '.join(f'{px:.1f},{py:.1f}' for px, py in pts)
                       + f'" fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="{26 * s:.1f}" stroke-linecap="round" stroke-linejoin="round"/>')
        return ''.join(out)
    return f'<path d="M{x + 98 * s:.1f} {y + 74 * s:.1f} L{x + 228 * s:.1f} {y + 150 * s:.1f} L{x + 98 * s:.1f} {y + 226 * s:.1f} Z" fill="#fff" opacity=".92"/>'

def four_tiles(x0, y0, tile, gap, glyphs=True, colors=TILES, radius=None):
    out = []
    for i, color in enumerate(colors):
        x, y = x0 + (i % 2) * (tile + gap), y0 + (i // 2) * (tile + gap)
        out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{tile:.1f}" height="{tile:.1f}" rx="{radius or tile * 0.187:.1f}" fill="{color}"/>')
        if glyphs: out.append(tile_glyph(i, x, y, tile))
    return ''.join(out)

def icon(x, y, size, gid):
    """The app icon (slate squircle + four tiles) at x,y with the given size; art is 824 units wide."""
    body = (f'<defs><linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2C3A48"/>'
            f'<stop offset="1" stop-color="#18212B"/></linearGradient></defs>'
            f'<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#{gid})"/>'
            + four_tiles(190, 190, 300, 44))
    return f'<g transform="translate({x} {y}) scale({size / 824}) translate(-100 -100)">{body}</g>'

def svg(w, h, body, bg=None):
    rect = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{rect}{body}</svg>\n'

def save(name, content):
    with open(os.path.join(here, name), 'w') as f: f.write(content)

def main():
    for theme, ink, amp in [('light', INK, GREEN), ('dark', PAPER, '#3fb68e')]:
        # horizontal: icon + name
        words, tw = text('Data & Docs', 212, 130, 84, ink, tracking=-1.5, colors={5: amp})
        save(f'logo-horizontal-{theme}.svg', svg(round(212 + tw + 24), 200, icon(20, 20, 160, f'h{theme}') + words))
        # stacked: icon above name and what it opens
        words, _ = text('Data & Docs', 260, 290, 64, ink, tracking=-1, colors={5: amp}, anchor='middle')
        tag, _ = text('SHEETS · DOCS · JSON · MEDIA', 260, 340, 21, ink, face='Avenir Next Demi Bold', tracking=4, anchor='middle')
        save(f'logo-stacked-{theme}.svg', svg(520, 380, icon(180, 20, 160, f's{theme}') + words + f'<g opacity=".6">{tag}</g>'))

    save('app-icon.svg', svg(1024, 1024, icon(100, 100, 824, 'app')))
    # browser-tab icon: just the four tiles (the symbols disappear at 16 px)
    save('../web/favicon.svg', svg(64, 64, four_tiles(4, 4, 27, 2, glyphs=False, radius=6)))

    rows = [('Horizontal: header, website, README', 'logo-horizontal', 100), ('Stacked: splash, About, store page', 'logo-stacked', 170)]
    html = ['<!doctype html><meta charset=utf-8><title>Data & Docs logos</title><style>'
            'body{margin:0;font:600 13px -apple-system,sans-serif;color:#56626e;background:#e9ecef;padding:28px}'
            '.row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}.card{border-radius:14px;padding:26px;display:flex;align-items:center;justify-content:center;min-height:150px}'
            '.light{background:#fff}.dark{background:#1b2530}h3{margin:0 0 8px;font-size:13px}.sizes{display:flex;gap:18px;align-items:end;background:#fff;border-radius:14px;padding:22px}</style>']
    for label, base, h in rows:
        html.append(f'<h3>{label}</h3><div class="row"><div class="card light"><img src="{base}-light.svg" style="max-width:100%;height:{h}px"></div>'
                    f'<div class="card dark"><img src="{base}-dark.svg" style="max-width:100%;height:{h}px"></div></div>')
    html.append('<h3>App icon and browser tab icon</h3><div class="sizes">' + ''.join(f'<img src="app-icon.svg" width="{s}">' for s in (128, 64, 32))
                + '<img src="../web/favicon.svg" width="32"><img src="../web/favicon.svg" width="16"><img src="logo-horizontal-light.svg" height="32"></div>')
    save('logo-sheet.html', ''.join(html))
    print('ok')

if __name__ == '__main__':
    main()
