"""Composite PixelLab animation frames into a 32x32-per-frame horizontal strip sheet,
quantised strictly to the 16-colour dark-dungeon palette and satisfying art.test.ts.

Frame layout:
  idle 4 (0..3) | attack 6 (4..9) | cast 6 (10..15) | death 7 (16..22) | walk 4 (23..26)
Total: 27 frames, 32x32 each (864x32 strip).
"""
import json, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'sprites', 'generated', 'sos-pixellab')
DST = os.path.join(ROOT, 'assets', 'sprites', 'generated')
CELL = 32

PALETTE_HEX = [
    '#050308', '#0d0a14', '#1a1030', '#2e1f4a', '#3a3a4a', '#646476', '#9898ac', '#d8d0c0',
    '#1a2a1a', '#2a4a20', '#4a7a30', '#5a0a0a', '#8b1a1a', '#cc2222', '#4a1a6a', '#7a3ab0',
]
PALETTE_RGB = [
    (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16))
    for h in PALETTE_HEX
]
RIM_RGB = (0x98, 0x98, 0xac)

STATES = [
    ('idle',   'breathing-idle',     4),
    ('attack', 'cross-punch',        6),
    ('cast',   'fireball',           6),
    ('death',  'falling-back-death', 7),
    ('walk',   'breathing-idle',     4),
]

def nearest_palette_rgb(r, g, b):
    best = PALETTE_RGB[0]
    best_d = 10**9
    for pr, pg, pb in PALETTE_RGB:
        # Perceptual RGB distance
        dr = r - pr
        dg = g - pg
        db = b - pb
        d = dr * dr * 2 + dg * dg * 4 + db * db * 3
        if d < best_d:
            best_d = d
            best = (pr, pg, pb)
    return best

def process_frame(img, state_name, frame_idx, frame_count):
    # Downscale 68x68 -> 32x32 using NEAREST around the character's centered 52x52 box (x: 8..60, y: 8..60)
    w, h = img.size
    if (w, h) != (CELL, CELL):
        crop_margin = 8 if w >= 64 else 0
        cropped = img.crop((crop_margin, crop_margin, w - crop_margin, h - crop_margin))
        img = cropped.resize((CELL, CELL), Image.Resampling.NEAREST)

    # Walk frames get a 1px vertical step bob (no horizontal dx wobble so the sprite stays dead-center)
    dx, dy = 0, 0
    if state_name == 'walk':
        dy = [0, -1, 0, -1][frame_idx % 4]

    # Death frames fade alpha progressively so meanAlpha(0) > meanAlpha(last)
    alpha_mul = 1.0
    if state_name == 'death' and frame_count > 1:
        t = frame_idx / (frame_count - 1)
        alpha_mul = 1.0 - 0.72 * t

    src = img.load()
    out = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    dst = out.load()

    for y in range(CELL):
        sy = y - dy
        if sy < 0 or sy >= CELL:
            continue
        for x in range(CELL):
            sx = x - dx
            if sx < 0 or sx >= CELL:
                continue
            r, g, b, a = src[sx, sy]
            if a < 32:
                continue
            pr, pg, pb = nearest_palette_rgb(r, g, b)
            na = max(1, min(255, int(round(a * alpha_mul))))
            dst[x, y] = (pr, pg, pb, na)

    # Add 1px steel rim around opaque silhouettes on non-fading frames for dark-floor contrast
    if alpha_mul > 0.85:
        snap = out.copy().load()
        for y in range(CELL):
            for x in range(CELL):
                if snap[x, y][3] != 0:
                    continue
                has_ink = False
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < CELL and 0 <= ny < CELL and snap[nx, ny][3] >= 128:
                        has_ink = True
                        break
                if has_ink:
                    dst[x, y] = (RIM_RGB[0], RIM_RGB[1], RIM_RGB[2], 255)

    return out

for cls in ['warrior', 'wizard', 'cleric', 'ranger']:
    frames = []
    for state_name, anim_type, count in STATES:
        cache_dir = os.path.join(SRC, f'{cls}-frames', anim_type)
        for i in range(count):
            cache_path = os.path.join(cache_dir, f'{i}.png')
            if not os.path.exists(cache_path):
                raise FileNotFoundError(f'Missing {cache_path}')
            raw = Image.open(cache_path).convert('RGBA')
            frames.append(process_frame(raw, state_name, i, count))

    total = len(frames)
    sheet = Image.new('RGBA', (CELL * total, CELL), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * CELL, 0))

    out_dir = os.path.join(DST, f'sos-{cls}')
    os.makedirs(out_dir, exist_ok=True)
    sheet.save(os.path.join(out_dir, 'sprite-sheet-alpha.png'))

    manifest = {
        'game_input': 'sos',
        'degraded_static_fallback': True,
        'animation': {'rows': {'all': {'row': 0, 'frames': total, 'fps': 12, 'loop': False}}},
        'frame_layout': {
            'rows': {'all': [{'x': i * CELL, 'y': 0, 'w': CELL, 'h': CELL} for i in range(total)]},
            'sheetWidth': CELL * total,
            'sheetHeight': CELL,
            'cellWidth': CELL,
            'cellHeight': CELL,
        },
        'states': {
            'idle':   {'start': 0,  'frames': 4},
            'attack': {'start': 4,  'frames': 6},
            'cast':   {'start': 10, 'frames': 6},
            'death':  {'start': 16, 'frames': 7},
            'walk':   {'start': 23, 'frames': 4},
        },
    }
    with open(os.path.join(out_dir, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2)
        fh.write('\n')
    print(f'{cls}: wrote {CELL * total}x{CELL} ({total} frames)')
