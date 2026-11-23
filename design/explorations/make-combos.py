# Samples that combine the four-tile logo with the cell ampersand.
#   python3 design/explorations/make-combos.py  → combos/*.svg + combos.html (in this folder)
import importlib.util, os
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('logos', os.path.join(here, '..', 'make-logos.py'))
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)
os.makedirs(os.path.join(here, 'combos'), exist_ok=True)
os.chdir(here)

def save(name, content):
    with open(os.path.join(here, name), 'w') as f: f.write(content)
L.save = save

CSV, DOC, JSON, MEDIA = '#0f7b5f', '#2b59c3', '#a96500', '#8a3fa0'
TILES = [CSV, DOC, JSON, MEDIA]  # top-left, top-right, bottom-left, bottom-right (same order as the old icon)
SLATE = ('#2C3A48', '#18212B')
L.AMP = ["..XX...", ".X..X..", ".X..X..", "..XX...", ".XX...X", "X..X.X.", "X...X..", "X..X.X.", ".XX...X"]  # the cell ampersand
AMP_ROWS, AMP_COLS = len(L.AMP), len(L.AMP[0])

def squircle(gid, top=SLATE[0], bottom=SLATE[1]):
    return (f'<defs><linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/>'
            f'<stop offset="1" stop-color="{bottom}"/></linearGradient></defs>'
            f'<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#{gid})"/>')

def amp_fit(box_x, box_y, box_w, box_h, gap_ratio=0.12):
    """cell size, gap and origin so the 7×9 ampersand fills the box."""
    cell = min(box_w / (AMP_COLS + (AMP_COLS - 1) * gap_ratio), box_h / (AMP_ROWS + (AMP_ROWS - 1) * gap_ratio))
    gap = cell * gap_ratio
    w, h = AMP_COLS * cell + (AMP_COLS - 1) * gap, AMP_ROWS * cell + (AMP_ROWS - 1) * gap
    return cell, gap, box_x + (box_w - w) / 2, box_y + (box_h - h) / 2

def cells(x0, y0, cell, gap, color_of, ghost=None, ghost_op=0.08):
    out = []
    for r, row in enumerate(L.AMP):
        for c, ch in enumerate(row):
            x, y = x0 + c * (cell + gap), y0 + r * (cell + gap)
            rx = cell * 0.2
            if ch == 'X':
                out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{cell:.1f}" height="{cell:.1f}" rx="{rx:.1f}" fill="{color_of(r, c)}"/>')
            elif ghost:
                g = ghost(r, c) if callable(ghost) else ghost
                if g: out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{cell:.1f}" height="{cell:.1f}" rx="{rx:.1f}" fill="{g}" opacity="{ghost_op}"/>')
    return ''.join(out)

BRIGHT = ['#3fb68e', '#7aa0f2', '#e0a443', '#c58ade']  # tile colours as used on dark backgrounds

def quadrant(r, c):
    """Which tile colour a cell of the ampersand falls in."""
    return BRIGHT[(0 if r < AMP_ROWS / 2 else 2) + (0 if c < AMP_COLS / 2 else 1)]

def tile_glyph(i, x, y, t):
    """White symbol inside a tile: grid, text lines, braces, play."""
    s = t / 300
    if i == 0:
        return ''.join(f'<rect x="{x + (52 + gx * 68) * s:.1f}" y="{y + (52 + gy * 68) * s:.1f}" width="{56 * s:.1f}" height="{56 * s:.1f}" rx="{10 * s:.1f}" fill="#fff" opacity=".9"/>'
                       for gx in range(3) for gy in range(3))
    if i == 1:
        return ''.join(f'<rect x="{x + 52 * s:.1f}" y="{y + (70 + n * 50) * s:.1f}" width="{w * s:.1f}" height="{24 * s:.1f}" rx="{12 * s:.1f}" fill="#fff" opacity=".9"/>'
                       for n, w in enumerate([196, 160, 196, 120]))
    if i == 2:
        paths = []
        for d in (-1, 1):
            cx = x + 150 * s + d * 62 * s
            pts = [(cx + d * 18 * s, y + 70 * s), (cx, y + 90 * s), (cx, y + 128 * s), (cx - d * 24 * s, y + 150 * s),
                   (cx, y + 172 * s), (cx, y + 210 * s), (cx + d * 18 * s, y + 230 * s)]
            paths.append('<polyline points="' + ' '.join(f'{px:.1f},{py:.1f}' for px, py in pts) + f'" fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="{26 * s:.1f}" stroke-linecap="round" stroke-linejoin="round"/>')
        return ''.join(paths)
    return f'<path d="M{x + 98 * s:.1f} {y + 74 * s:.1f} L{x + 228 * s:.1f} {y + 150 * s:.1f} L{x + 98 * s:.1f} {y + 226 * s:.1f} Z" fill="#fff" opacity=".92"/>'

def four_tiles(x0, y0, tile, gap, glyphs=True, colors=TILES, radius=None):
    out = []
    for i, color in enumerate(colors):
        x, y = x0 + (i % 2) * (tile + gap), y0 + (i // 2) * (tile + gap)
        out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{tile:.1f}" height="{tile:.1f}" rx="{radius or tile * 0.187:.1f}" fill="{color}"/>')
        if glyphs: out.append(tile_glyph(i, x, y, tile))
    return ''.join(out)

# ---------------------------------------------------------------- the samples (each draws a 1024×1024 icon)
def s1_original(g):
    """Today's icon, for comparison."""
    return squircle(g) + four_tiles(190, 190, 300, 44)

def s2_cutout(g):
    """Four plain tiles; the white cell ampersand runs across all of them."""
    cell, gap, x, y = amp_fit(222, 200, 580, 624)
    return squircle(g) + four_tiles(190, 190, 316, 12, glyphs=False, radius=48) + cells(x, y, cell, gap, lambda r, c: '#fff')

def s3_quadrants(g):
    """The ampersand on slate; each quarter of it takes one tile colour."""
    cell, gap, x, y = amp_fit(190, 170, 644, 684)
    return squircle(g) + cells(x, y, cell, gap, quadrant, ghost='#fff', ghost_op=0.06)

def s4_superscript(g):
    """White ampersand; its empty top-right corner holds a tiny four-tile mark."""
    cell, gap, x, y = amp_fit(190, 170, 644, 684)
    mini = ''.join(f'<rect x="{x + (5 + i % 2) * (cell + gap):.1f}" y="{y + (i // 2) * (cell + gap):.1f}" width="{cell:.1f}" height="{cell:.1f}" rx="{cell * .2:.1f}" fill="{TILES[i]}"/>'
                   for i in range(4))
    tiles_brighter = mini.replace(CSV, '#3fb68e').replace(DOC, '#7aa0f2').replace(JSON, '#e0a443').replace(MEDIA, '#c58ade')
    return squircle(g) + cells(x, y, cell, gap, lambda r, c: '#fff', ghost=lambda r, c: None if (r < 2 and c > 4) else '#fff', ghost_op=0.06) + tiles_brighter

def s5_badge(g):
    """The four tiles with their symbols, and a green ampersand tile set in the middle."""
    badge = 300
    bx = by = 512 - badge / 2
    cell, gap, x, y = amp_fit(bx + 52, by + 40, badge - 104, badge - 80)
    return (squircle(g) + four_tiles(190, 190, 300, 44)
            + f'<rect x="{bx - 22}" y="{by - 22}" width="{badge + 44}" height="{badge + 44}" rx="{(badge + 44) * .24:.1f}" fill="#1f2a35"/>'
            + f'<rect x="{bx}" y="{by}" width="{badge}" height="{badge}" rx="{badge * .22:.1f}" fill="#0f7b5f"/>'
            + cells(x, y, cell, gap, lambda r, c: '#fff', ghost='#fff', ghost_op=0.1))

def s6_tile_swap(g):
    """Four tiles, but the top-left one is the ampersand: three file kinds + the brand."""
    out = squircle(g)
    tile, gap = 300, 44
    for i, color in enumerate([L.GREEN, DOC, JSON, MEDIA]):
        x, y = 190 + (i % 2) * (tile + gap), 190 + (i // 2) * (tile + gap)
        out += f'<rect x="{x}" y="{y}" width="{tile}" height="{tile}" rx="56" fill="{color}"/>'
        if i == 0:
            cell, gap2, ax, ay = amp_fit(x + 50, y + 38, tile - 100, tile - 76)
            out += cells(ax, ay, cell, gap2, lambda r, c: '#fff', ghost='#fff', ghost_op=0.12)
        else:
            out += tile_glyph(i, x, y, tile)
    return out

SAMPLES = [
    ('1', 'Today: four tiles', s1_original, 'The current icon, for comparison.'),
    ('2', 'Ampersand cut across the tiles', s2_cutout, 'The tiles stay. One white “&” runs across all four, so every file kind is part of the name.'),
    ('3', 'Four-colour ampersand', s3_quadrants, 'Only the “&”. Each quarter takes one tile colour, so the four tiles are still there.'),
    ('4', 'Ampersand with a tile mark', s4_superscript, 'A white “&” with the four tiles tucked into its empty top-right corner.'),
    ('5', 'Tiles with an & badge', s5_badge, 'The current icon with its symbols, plus a green “&” tile set in the middle.'),
    ('6', 'The & becomes a tile', s6_tile_swap, 'Four tiles; the first one (sheets) is swapped for the “&”. The green stays the sheets colour.'),
]

def lockup(icon_body, gid_suffix, theme):
    """Icon at 160px + 'Data & Docs' beside it."""
    ink, amp = (L.INK, L.GREEN) if theme == 'light' else (L.PAPER, '#3fb68e')
    words, tw = L.text('Data & Docs', 212, 130, 84, ink, tracking=-1.5, colors={5: amp})
    scaled = f'<g transform="translate(20 20) scale({160 / 824}) translate(-100 -100)">{icon_body}</g>'
    return L.svg(round(212 + tw + 24), 200, scaled + words)

def main():
    cards = []
    for key, title, fn, note in SAMPLES:
        icon = fn(f'g{key}')
        L.save(f'combos/{key}-icon.svg', L.svg(1024, 1024, icon))
        L.save(f'combos/{key}-horizontal-light.svg', lockup(fn(f'gl{key}'), key, 'light'))
        L.save(f'combos/{key}-horizontal-dark.svg', lockup(fn(f'gd{key}'), key, 'dark'))
        cards.append(f'''<section><h2>{key} · {title}</h2><p>{note}</p>
          <div class="icons"><img src="combos/{key}-icon.svg" width="150">{''.join(f'<img src="combos/{key}-icon.svg" width="{s}">' for s in (64, 32, 16))}</div>
          <div class="lock light"><img src="combos/{key}-horizontal-light.svg" height="56"></div>
          <div class="lock dark"><img src="combos/{key}-horizontal-dark.svg" height="56"></div></section>''')
    L.save('combos.html', '<!doctype html><meta charset=utf-8><title>Data & Docs: tiles + ampersand</title><style>'
           'body{margin:0;padding:28px;background:#e9ecef;font:14px -apple-system,sans-serif;color:#1b2530;display:grid;grid-template-columns:repeat(3,1fr);gap:18px}'
           'section{background:#fff;border-radius:14px;padding:18px 20px}h2{font-size:15px;margin:0 0 4px}p{margin:0 0 12px;color:#56626e;font-size:12.5px;min-height:34px}'
           '.icons{display:flex;gap:14px;align-items:end;margin-bottom:12px}.lock{border-radius:10px;padding:14px;margin-top:8px}.light{background:#f3f4f6}.dark{background:#1b2530}</style>'
           + ''.join(cards))
    print('ok')

if __name__ == '__main__':
    main()
