# Logo samples for the new name "Docs & Data": D & D monograms and a few other ideas.
#   python3 design/explorations/make-dnd.py  → dnd/*.svg + dnd.html (in this folder)
import importlib.util, os
from fontTools.ttLib import TTCollection
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('logos', os.path.join(here, '..', 'make-logos.py'))
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)
os.makedirs(os.path.join(here, 'dnd'), exist_ok=True)

DOC, DATA, JSON, MEDIA = '#2b59c3', '#0f7b5f', '#a96500', '#8a3fa0'
DOC_L, DATA_L, AMBER_L = '#7aa0f2', '#3fb68e', '#e0a443'
SLATE = ('#2C3A48', '#18212B')
FACES = {f['name'].getDebugName(4): f for f in TTCollection('/System/Library/Fonts/Avenir Next.ttc').fonts}

def glyph(ch, x, baseline, size, face='Avenir Next Heavy'):
    """Path data of one character placed at x/baseline, plus its advance and ink bounds."""
    font = FACES[face]
    gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font['head'].unitsPerEm
    k = size / upm
    g = gs[cmap[ord(ch)]]
    pen = SVGPathPen(gs); g.draw(TransformPen(pen, (k, 0, 0, -k, x, baseline)))
    bp = BoundsPen(gs); g.draw(bp)
    xmin, ymin, xmax, ymax = bp.bounds
    return pen.getCommands(), g.width * k, (x + xmin * k, baseline - ymax * k, x + xmax * k, baseline - ymin * k)

def ink_width(ch, size, face='Avenir Next Heavy'):
    _, _, (x0, _, x1, _) = glyph(ch, 0, 0, size, face)
    return x1 - x0, x0

def row(chars, cx, cy, size, gap, face='Avenir Next Heavy'):
    """Places characters by their ink (not advance) so the group is optically centred. Returns [(d, bounds)]."""
    widths = [ink_width(c, size, face) for c in chars]
    total = sum(w for w, _ in widths) + gap * (len(chars) - 1)
    cap = size * 0.708
    x = cx - total / 2
    out = []
    for c, (w, lsb) in zip(chars, widths):
        d, _, b = glyph(c, x - lsb, cy + cap / 2, size, face)
        out.append((d, b))
        x += w + gap
    return out

def squircle(gid, top=SLATE[0], bottom=SLATE[1]):
    return (f'<defs><linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/>'
            f'<stop offset="1" stop-color="{bottom}"/></linearGradient></defs>'
            f'<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#{gid})"/>')

# ---------------------------------------------------------------- samples (1024×1024 art, squircle 100…924)
def s_filled(g):
    """D & D: the first D is filled with text lines (docs), the second with a grid (data)."""
    (d1, b1), (amp, _), (d2, b2) = row('D&D', 512, 512, 300, 22)
    lines = ''.join(f'<rect x="{b1[0] - 10:.0f}" y="{y:.0f}" width="{b1[2] - b1[0] + 20:.0f}" height="20" fill="#fff" opacity=".85"/>'
                    for y in range(int(b1[1]) + 58, int(b1[3]) - 40, 50))
    grid = ''.join(f'<rect x="{x:.0f}" y="{b2[1] - 10:.0f}" width="14" height="{b2[3] - b2[1] + 20:.0f}" fill="#fff" opacity=".85"/>'
                   for x in range(int(b2[0]) + 52, int(b2[2]) - 20, 58)) + \
           ''.join(f'<rect x="{b2[0] - 10:.0f}" y="{y:.0f}" width="{b2[2] - b2[0] + 20:.0f}" height="14" fill="#fff" opacity=".85"/>'
                   for y in range(int(b2[1]) + 52, int(b2[3]) - 20, 58))
    return (squircle(g) + f'<defs><clipPath id="{g}c1"><path d="{d1}"/></clipPath><clipPath id="{g}c2"><path d="{d2}"/></clipPath></defs>'
            + f'<path d="{d1}" fill="{DOC}"/><g clip-path="url(#{g}c1)">{lines}</g>'
            + f'<path d="{amp}" fill="{AMBER_L}"/>'
            + f'<path d="{d2}" fill="{DATA}"/><g clip-path="url(#{g}c2)">{grid}</g>')

def s_mirror(g):
    """ᗡ & D: the Ds face away from each other like brackets holding the &."""
    (d1, b1), (amp, _), (d2, _) = row('D&D', 512, 512, 290, 30)
    cx = (b1[0] + b1[2]) / 2
    return (squircle(g) + f'<path d="{d1}" fill="{DOC_L}" transform="translate({2 * cx:.1f} 0) scale(-1 1)"/>'
            + f'<path d="{amp}" fill="#fff"/><path d="{d2}" fill="{DATA_L}"/>')

def s_pixel(g):
    """D & D drawn with spreadsheet cells."""
    D = ["XXXX.", "X...X", "X...X", "X...X", "X...X", "X...X", "X...X", "X...X", "XXXX."]
    AMP = ["..XX...", ".X..X..", ".X..X..", "..XX...", ".XX...X", "X..X.X.", "X...X..", "X..X.X.", ".XX...X"]
    cell, gap, between = 34, 5, 30
    cols = 5 + 7 + 5
    w = cols * cell + (cols - 3) * gap + 2 * between
    h = 9 * cell + 8 * gap
    x, y0 = 512 - w / 2, 512 - h / 2
    out = [squircle(g)]
    for shape, color in ((D, DOC_L), (AMP, '#fff'), (D, DATA_L)):
        for r, line in enumerate(shape):
            for c, ch in enumerate(line):
                cx, cy = x + c * (cell + gap), y0 + r * (cell + gap)
                fill, op = (color, 1) if ch == 'X' else ('#fff', .06)
                out.append(f'<rect x="{cx:.1f}" y="{cy:.1f}" width="{cell}" height="{cell}" rx="7" fill="{fill}" opacity="{op}"/>')
        x += len(shape[0]) * (cell + gap) - gap + between
    return ''.join(out)

def s_split(g):
    """Split corner to corner: Docs blue on top, Data green below, one D in each, the & on the seam."""
    (d1, _), = row('D', 360, 375, 300, 0)
    (d2, _), = row('D', 664, 650, 300, 0)
    (amp, _), = row('&', 512, 512, 150, 0, face='Avenir Next Bold')
    return (f'<defs><clipPath id="{g}sq"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath></defs>'
            f'<g clip-path="url(#{g}sq)"><rect x="100" y="100" width="824" height="824" fill="{DATA}"/>'
            f'<path d="M100 100 H924 L100 924 Z" fill="{DOC}"/></g>'
            f'<path d="{d1}" fill="#fff"/><path d="{d2}" fill="#fff"/>'
            f'<circle cx="512" cy="512" r="92" fill="#1b2530"/><path d="{amp}" fill="{AMBER_L}"/>')

def s_overlap(g):
    """Two Ds overlap (docs and data working together); the & sits in the second D's opening."""
    w, _ = ink_width('D', 430)
    shift = w * 0.6
    left = 512 - (shift + w) / 2
    (d1, b1), = row('D', left + w / 2, 512, 430, 0)
    d2 = d1
    (amp, _), = row('&', left + shift + w * 0.43, 512, 150, 0, face='Avenir Next Bold')
    return (squircle(g) + f'<defs><clipPath id="{g}o"><path d="{d1}"/></clipPath></defs>'
            + f'<path d="{d1}" fill="{DOC}"/>'
            + f'<path d="{d2}" fill="{DATA}" transform="translate({shift:.1f} 0)"/>'
            + f'<g clip-path="url(#{g}o)"><path d="{d2}" fill="#14897f" transform="translate({shift:.1f} 0)"/></g>'
            + f'<path d="{amp}" fill="#fff"/>')

def s_tiles(g):
    """Three tiles, like the four-tile icon: D (docs) · & · D (data)."""
    t, gap = 228, 22
    x0 = 512 - (3 * t + 2 * gap) / 2
    out = [squircle(g)]
    for i, (ch, color, face) in enumerate([('D', DOC, 'Avenir Next Heavy'), ('&', JSON, 'Avenir Next Bold'), ('D', DATA, 'Avenir Next Heavy')]):
        x = x0 + i * (t + gap)
        out.append(f'<rect x="{x:.1f}" y="{512 - t / 2:.1f}" width="{t}" height="{t}" rx="44" fill="{color}"/>')
        (d, _), = row(ch, x + t / 2, 512, 170, 0, face)
        out.append(f'<path d="{d}" fill="#fff"/>')
    return ''.join(out)

def s_tiles4(g):
    """The four-tile icon, renamed: Docs tile and Data tile carry the Ds, the & tile joins them."""
    t, gap = 300, 44
    x0 = y0 = 190
    out = [squircle(g)]
    spec = [('D', DOC), ('&', JSON), (None, MEDIA), ('D', DATA)]
    for i, (ch, color) in enumerate(spec):
        x, y = x0 + (i % 2) * (t + gap), y0 + (i // 2) * (t + gap)
        out.append(f'<rect x="{x}" y="{y}" width="{t}" height="{t}" rx="56" fill="{color}"/>')
        if ch:
            (d, _), = row(ch, x + t / 2, y + t / 2, 210, 0, 'Avenir Next Heavy' if ch == 'D' else 'Avenir Next Bold')
            out.append(f'<path d="{d}" fill="#fff"/>')
        else:
            out.append(L.tile_glyph(2, x, y, t))  # JSON braces: the other kind of data
    return ''.join(out)

def s_classic(g):
    """Plain monogram: white D&D on green, amber &."""
    (d1, _), (amp, _), (d2, _) = row('D&D', 512, 512, 280, 12)
    return squircle(g, '#12896a', '#0a5844') + f'<path d="{d1}" fill="#fff"/><path d="{amp}" fill="#ffd58a"/><path d="{d2}" fill="#fff"/>'

def s_page(g):
    """Other idea: a document page whose folded corner reveals a table."""
    return (squircle(g)
            + f'<path d="M250 210 H640 L774 344 V780 a34 34 0 0 1 -34 34 H284 a34 34 0 0 1 -34 -34 Z" fill="#f7f6f2"/>'
            + f'<path d="M640 210 V310 a34 34 0 0 0 34 34 H774 Z" fill="{DATA}"/>'
            + ''.join(f'<rect x="300" y="{y}" width="{w}" height="26" rx="13" fill="{DOC}" opacity="{o}"/>' for y, w, o in [(300, 250, 1), (360, 300, .35), (410, 270, .35)])
            + ''.join(f'<rect x="{300 + c * 118}" y="{486 + r * 76}" width="108" height="66" rx="10" fill="{DATA if r == 0 else "#dfe7e3"}"/>' for r in range(4) for c in range(4)))

SAMPLES = [
    ('1', 'Filled Ds', s_filled, 'D & D, where the Docs D is filled with text lines and the Data D with a table grid. Says what the app does at a glance.', DOC),
    ('2', 'Bracket Ds', s_mirror, 'The Ds face away from each other like brackets around the &. Symmetric, calm, easy to remember.', DOC),
    ('3', 'Pixel D&D', s_pixel, 'D & D built from spreadsheet cells. Playful and “data” in feel.', DATA),
    ('4', 'Split corner', s_split, 'Docs blue meets Data green on the diagonal; the & sits on the seam.', DOC),
    ('5', 'Overlapping Ds', s_overlap, 'Two Ds overlap, docs and data in one place; the & sits in the opening of the second D.', DATA),
    ('6', 'Three tiles', s_tiles, 'Keeps the tile style you liked: D · & · D tiles in the file-kind colours.', DOC),
    ('7', 'Four tiles, renamed', s_tiles4, 'The four-tile icon with D, &, { } and D. Closest to today’s logo.', DOC),
    ('8', 'Classic monogram', s_classic, 'White D&D on green. The simplest option.', DATA),
    ('9', 'Other idea: page + table', s_page, 'No letters: a document whose folded corner is a table.', DATA),
]

def lockup(body, theme, accent):
    ink = L.INK if theme == 'light' else L.PAPER
    amp = accent if theme == 'light' else {DOC: DOC_L, DATA: DATA_L}.get(accent, accent)
    words, tw = L.text('Docs & Data', 212, 130, 84, ink, tracking=-1.5, colors={5: amp})
    scaled = f'<g transform="translate(20 20) scale({160 / 824}) translate(-100 -100)">{body}</g>'
    return L.svg(round(212 + tw + 24), 200, scaled + words)

def save(name, content):
    with open(os.path.join(here, name), 'w') as f: f.write(content)

def main():
    cards = []
    for key, title, fn, note, accent in SAMPLES:
        save(f'dnd/{key}-icon.svg', L.svg(1024, 1024, fn(f'i{key}')))
        save(f'dnd/{key}-horizontal-light.svg', lockup(fn(f'l{key}'), 'light', accent))
        save(f'dnd/{key}-horizontal-dark.svg', lockup(fn(f'd{key}'), 'dark', accent))
        cards.append(f'''<section><h2>{key} · {title}</h2><p>{note}</p>
          <div class="icons"><img src="dnd/{key}-icon.svg" width="150">{''.join(f'<img src="dnd/{key}-icon.svg" width="{s}">' for s in (64, 32, 16))}</div>
          <div class="lock light"><img src="dnd/{key}-horizontal-light.svg" height="52"></div>
          <div class="lock dark"><img src="dnd/{key}-horizontal-dark.svg" height="52"></div></section>''')
    save('dnd.html', '<!doctype html><meta charset=utf-8><title>Docs & Data: logo samples</title><style>'
         'body{margin:0;padding:28px;background:#e9ecef;font:14px -apple-system,sans-serif;color:#1b2530;display:grid;grid-template-columns:repeat(3,1fr);gap:18px}'
         'section{background:#fff;border-radius:14px;padding:18px 20px}h2{font-size:15px;margin:0 0 4px}p{margin:0 0 12px;color:#56626e;font-size:12.5px;min-height:34px}'
         '.icons{display:flex;gap:14px;align-items:end;margin-bottom:12px}.lock{border-radius:10px;padding:14px;margin-top:8px}.light{background:#f3f4f6}.dark{background:#1b2530}</style>'
         + ''.join(cards))
    print('ok')

if __name__ == '__main__':
    main()
