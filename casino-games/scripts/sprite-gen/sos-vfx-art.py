"""Generate dark-fantasy pixel-art VFX & projectile sprite strips for Square of Shadows.

Outputs under assets/sprites/generated/:
  - sos-vfx-slash    (4 frames, 32x32 each -> 128x32): blood-crimson & steel sword cleave arc
  - sos-vfx-fireball (4 frames, 32x32 each -> 128x32): demonic hellfire blast wave
  - sos-vfx-thunder  (4 frames, 32x32 each -> 128x32): necromantic violet/bone lightning bolt
  - sos-vfx-ice      (4 frames, 32x32 each -> 128x32): dark frost / jagged ice crystal burst
  - sos-vfx-heal     (4 frames, 32x32 each -> 128x32): emerald & pale-gold rising holy runes
  - sos-vfx-trap     (4 frames, 32x32 each -> 128x32): spiked iron jaws snapping shut with blood
  - sos-vfx-arrow    (4 frames, 32x32 each -> 128x32): barbed bone/steel arrow in flight (pointing right, 0 deg)
  - sos-vfx-firebolt (4 frames, 32x32 each -> 128x32): streaking hellfire comet projectile (pointing right, 0 deg)
  - sos-vfx-acidbolt  (4 frames, 32x32 each -> 128x32): Spitter's corrosive glob in flight
  - sos-vfx-holy-ground (4 frames, 32x32): the rune circle a Cleric burns into the anchor tile
  - sos-vfx-holy-sigil (4 frames, 32x32): the small stamped rune that pops into each covered tile
"""
import json, math, os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_ROOT = os.path.join(ROOT, 'assets', 'sprites', 'generated')
CELL = 32
FRAMES = 4

VOID = (5, 3, 8, 255)
CRIMSON_DARK = (90, 10, 10, 255)
CRIMSON = (185, 28, 28, 255)
CRIMSON_HI = (248, 113, 113, 255)
EMBER_GOLD = (251, 191, 36, 255)
BONE = (232, 224, 208, 255)
STEEL_DARK = (58, 58, 74, 255)
STEEL = (152, 152, 172, 255)
ARCANE_DARK = (74, 26, 106, 255)
ARCANE = (147, 51, 234, 255)
ARCANE_HI = (216, 180, 254, 255)
ICE_DARK = (15, 23, 42, 255)
ICE_MID = (56, 189, 248, 255)
ICE_HI = (224, 242, 254, 255)
HEAL_DARK = (6, 78, 59, 255)
HEAL_MID = (16, 185, 129, 255)
HEAL_HI = (167, 243, 208, 255)
ACID_DARK = (22, 61, 15, 255)
ACID_MID = (101, 163, 13, 255)
ACID_HI = (190, 242, 100, 255)
GOLD = (250, 204, 21, 255)
GOLD_HI = (254, 240, 138, 255)
HOLY_HI = (255, 255, 255, 255)


def outline_frame(img):
    snap = img.copy().load()
    dst = img.load()
    for y in range(CELL):
        for x in range(CELL):
            if snap[x, y][3] != 0:
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < CELL and 0 <= ny < CELL and snap[nx, ny][3] >= 160:
                    dst[x, y] = VOID
                    break


def draw_slash(f):
    img = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    px = img.load()
    # Diagonal crescent cleave from top-right (26,5) to bottom-left (5,26)
    progress = [(0.0, 0.45), (0.15, 0.85), (0.35, 1.0), (0.65, 1.0)][f]
    steps = 40
    for i in range(steps + 1):
        t = i / steps
        if t < progress[0] or t > progress[1]:
            continue
        # Curved slash path
        arc = math.sin(t * math.pi) * (5.5 if f in (1, 2) else 3.5)
        cx = 26 - t * 21 - arc * 0.45
        cy = 5 + t * 21 - arc * 0.45
        thick = 3 if (0.25 < t < 0.75 and f in (1, 2)) else 2
        for dy in range(-thick, thick + 1):
            for dx in range(-thick, thick + 1):
                if abs(dx) + abs(dy) > thick:
                    continue
                x, y = int(round(cx + dx)), int(round(cy + dy))
                if 0 <= x < CELL and 0 <= y < CELL:
                    if dx == 0 and dy == 0:
                        px[x, y] = BONE if f in (1, 2) else CRIMSON_HI
                    elif abs(dx) + abs(dy) == 1:
                        px[x, y] = CRIMSON_HI if f < 3 else CRIMSON
                    else:
                        px[x, y] = CRIMSON if f < 3 else CRIMSON_DARK
    # Blood droplets flying off on frames 2 & 3
    if f >= 1:
        drops = [(9, 12), (19, 21), (13, 24), (22, 11), (7, 19)]
        for idx, (bx, by) in enumerate(drops):
            ox = bx + (f - 1) * (1 if idx % 2 == 0 else -1)
            oy = by + (f - 1)
            if 0 <= ox < CELL and 0 <= oy < CELL:
                px[ox, oy] = CRIMSON_HI if idx % 2 == 0 else CRIMSON
    outline_frame(img)
    return img


def draw_fireball(f):
    img = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    px = img.load()
    radii = [6, 10, 13, 11][f]
    inner_r = [3, 6, 7, 4][f]
    for y in range(CELL):
        for x in range(CELL):
            dx, dy = x - 16, y - 16
            dist = math.hypot(dx, dy)
            # Jagged flame tongues
            angle = math.atan2(dy, dx)
            jag = math.sin(angle * 6 + f * 1.4) * 2.2
            if dist <= radii + jag:
                if f == 3 and dist < 5:
                    # Hollowing smoke ring on frame 3
                    px[x, y] = CRIMSON_DARK
                elif dist <= inner_r * 0.55:
                    px[x, y] = BONE if f < 3 else EMBER_GOLD
                elif dist <= inner_r:
                    px[x, y] = EMBER_GOLD
                elif dist <= radii - 2:
                    px[x, y] = CRIMSON_HI if f < 3 else CRIMSON
                else:
                    px[x, y] = CRIMSON if f < 2 else CRIMSON_DARK
    outline_frame(img)
    return img


def draw_thunder(f):
    img = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    jags = [
        [(17, 1), (13, 10), (19, 15), (12, 24), (16, 30)],
        [(15, 0), (20, 9), (12, 16), (18, 23), (15, 31)],
        [(16, 2), (11, 11), (18, 17), (14, 25), (16, 31)],
        [(16, 4), (14, 13), (17, 19), (15, 28)],
    ][f]
    # Outer violet glow
    d.line(jags, fill=ARCANE, width=5 if f in (1, 2) else 3)
    # Core bone-white arc
    d.line(jags, fill=BONE if f < 3 else ARCANE_HI, width=2 if f in (1, 2) else 1)
    # Ground impact sparks at bottom
    if f in (1, 2):
        for sx, sy in ((9, 28), (22, 27), (7, 25), (24, 25), (16, 29)):
            img.putpixel((sx, sy), ARCANE_HI)
    outline_frame(img)
    return img


def draw_ice(f):
    img = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    h_scale = [0.55, 0.9, 1.0, 0.85][f]
    shards = [
        (16, int(28 - 22 * h_scale), 11, 28, 21, 28),
        (9, int(28 - 15 * h_scale), 5, 28, 13, 28),
        (23, int(28 - 16 * h_scale), 19, 28, 27, 28),
    ]
    for tx, ty, lx, ly, rx, ry in shards:
        d.polygon([(tx, ty), (lx, ly), (rx, ry)], fill=ICE_MID)
        d.polygon([(tx, ty), (tx, ly), (rx, ry)], fill=ICE_DARK)
        d.line([(tx, ty), (lx + 1, ly)], fill=ICE_HI, width=1)
    outline_frame(img)
    return img


def draw_heal(f):
    img = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    y_off = [4, 2, 0, -2][f]
    cy = 16 + y_off
    # Radiant cross in centre
    d.rectangle([14, cy - 7, 17, cy + 7], fill=HEAL_MID)
    d.rectangle([9, cy - 2, 22, cy + 1], fill=HEAL_MID)
    d.rectangle([15, cy - 5, 16, cy + 5], fill=HEAL_HI)
    d.rectangle([11, cy - 1, 20, cy], fill=BONE if f in (1, 2) else HEAL_HI)
    # Rising motes
    motes = [(7, 22 - f * 3), (24, 20 - f * 3), (10, 10 - f * 2), (22, 11 - f * 2)]
    for mx, my in motes:
        if 2 <= my < CELL - 2:
            img.putpixel((mx, my), HEAL_HI)
            img.putpixel((mx, my + 1), HEAL_MID)
    outline_frame(img)
    return img


def draw_trap(f):
    img = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Bear trap jaws closing upwards
    spread = [10, 6, 2, 1][f]
    d.arc([16 - spread, 10, 16 + spread, 28], 0, 360, fill=STEEL, width=2)
    # Spikes
    for sy in range(12, 26, 4):
        d.line([(16 - spread, sy), (16, sy - 2)], fill=BONE, width=1)
        d.line([(16 + spread, sy), (16, sy - 2)], fill=BONE, width=1)
    if f >= 1:
        for bx, by in ((15, 16), (17, 18), (13, 13), (19, 14)):
            img.putpixel((bx, by), CRIMSON_HI if f == 1 else CRIMSON)
    outline_frame(img)
    return img


def draw_arrow(f):
    img = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Horizontal arrow pointing right (0 deg), centered at y=16
    x_shift = (f % 2) * 2
    # Shaft
    d.rectangle([5 + x_shift, 15, 24 + x_shift, 16], fill=BONE)
    # Barbed steel arrowhead
    head_x = 26 + x_shift
    d.polygon([(head_x, 15), (head_x - 5, 11), (head_x - 3, 15), (head_x - 5, 20)], fill=STEEL)
    img.putpixel((head_x, 15), CRIMSON_HI)
    # Poison/blood fletching
    d.line([(5 + x_shift, 15), (2 + x_shift, 12)], fill=CRIMSON_HI, width=2)
    d.line([(5 + x_shift, 16), (2 + x_shift, 19)], fill=CRIMSON, width=2)
    outline_frame(img)
    return img


def draw_firebolt(f):
    img = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    px = img.load()
    # Comet streaking right: head at x=22, tail trailing left to x=4
    for y in range(8, 24):
        for x in range(4, 28):
            dx = x - 21
            dy = y - 16
            if dx >= 0:
                dist = math.hypot(dx * 1.1, dy)
            else:
                # Tapered tail with wave
                wave = math.sin((x + f * 3) * 0.6) * 1.5
                dist = math.hypot(dx * 0.42, dy + wave)
            if dist <= 3.0:
                px[x, y] = BONE
            elif dist <= 4.8:
                px[x, y] = EMBER_GOLD
            elif dist <= 6.8:
                px[x, y] = CRIMSON_HI if (x + f) % 2 == 0 else CRIMSON
            elif dist <= 8.0 and x < 20:
                px[x, y] = CRIMSON_DARK
    outline_frame(img)
    return img


def draw_acidbolt(f):
    """Spitter's spit in flight: a sputtering corrosive glob, not a comet.

    Deliberately NOT the firebolt recoloured. A firebolt is a pointed comet with
    a long tapering tail; a glob of spit is round, lumpy, and sheds droplets
    behind it, so the two read as different things thrown at you even at 32px.
    The violet core is what ties it to the monster palette — the green alone
    could be any venom.
    """
    img = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    px = img.load()
    head_x = 21
    # The glob breathes along its flight, so the four frames are not a sliding
    # copy of one another.
    squash = [1.0, 0.86, 1.1, 0.94][f]
    for y in range(4, 28):
        for x in range(4, 30):
            dx = (x - head_x) / (7.0 * squash)
            dy = (y - 16) / (7.0 / squash)
            dist = math.hypot(dx, dy)
            # Chew a bite out of the back edge as it travels, so the tail thins.
            if dx < -0.35 and ((x + f) % 3 == 0):
                dist += 0.55
            if dist <= 0.55:
                px[x, y] = ARCANE_HI
            elif dist <= 0.95:
                px[x, y] = ARCANE
            elif dist <= 1.25:
                px[x, y] = ACID_HI
            elif dist <= 1.5:
                px[x, y] = ACID_MID
            elif dist <= 1.75:
                px[x, y] = ACID_DARK
    # Droplets shed behind the glob. Positions are keyed off the frame so they
    # scatter rather than sitting in a neat row.
    for (dx, dy, r) in ((-9 - f, -3 + f, 2.0), (-6 - f * 2, 5 - f, 1.5), (-12 + f, 4, 1.1)):
        for y in range(4, 28):
            for x in range(2, 30):
                if math.hypot(x - (head_x + dx), y - (16 + dy)) <= r:
                    px[x, y] = ACID_MID if r > 1.2 else ACID_HI
    outline_frame(img)
    return img


def draw_holy_ground(f):
    """The rune circle a Cleric burns into the anchor tile.

    Draw as a RING that grows and sharpens, not a filled disc: the zone is holy
    ground being marked, and a filled disc would look like a shield bubble. The
    ring reaches full brightness on the last frame so the sprite can hold for a
    beat before the sigils pop.
    """
    img = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    px = img.load()
    cx = cy = (CELL - 1) / 2
    # The circle is struck over the four frames: it widens, tightens onto the
    # final radius, then flares.
    radius = [6.0, 10.0, 13.0, 12.0][f]
    thickness = [2.2, 1.8, 1.4, 2.6][f]
    spin = f * 0.5
    for y in range(CELL):
        for x in range(CELL):
            dx = x - cx
            dy = y - cy
            dist = math.hypot(dx, dy)
            if abs(dist - radius) <= thickness:
                px[x, y] = GOLD_HI if (x + y + f) % 7 == 0 else GOLD
            # Four tick marks at the diagonals, rotating as it forms.
            ang = math.atan2(dy, dx) + spin
            if abs(dist - radius) <= thickness + 2.0 and abs(math.sin(2 * ang)) < 0.30:
                px[x, y] = HOLY_HI
            # A small filled core only on the final flare.
            if f == 3 and dist <= 2.4:
                px[x, y] = HOLY_HI if dist <= 1.2 else GOLD_HI
    outline_frame(img)
    return img


def draw_holy_sigil(f):
    """The small rune that pops into each of the five covered tiles.

    Pop scale, so it reads as being stamped down rather than drifting in: the
    first frames are oversized and the last is the resting mark.
    """
    img = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    px = img.load()
    cx = cy = (CELL - 1) / 2
    scale = [1.9, 1.45, 1.05, 0.85][f]
    fade = [0.55, 0.8, 1.0, 0.9][f]
    arm = 7.0 * scale
    for y in range(CELL):
        for x in range(CELL):
            dx = abs(x - cx)
            dy = abs(y - cy)
            # A cross pattee: two bars, the horizontal one shorter, plus a dot.
            if (dx <= 1.4 and dy <= arm) or (dy <= 1.4 and dx <= arm * 0.8):
                px[x, y] = HOLY_HI if dy <= 0.9 else GOLD
            elif math.hypot(x - cx, y - cy) <= 1.8:
                px[x, y] = GOLD_HI
    if fade < 1.0:
        for y in range(CELL):
            for x in range(CELL):
                p = px[x, y]
                if p[3]:
                    px[x, y] = (p[0], p[1], p[2], int(p[3] * fade))
    outline_frame(img)
    return img


GENERATORS = {
    'sos-vfx-slash': draw_slash,
    'sos-vfx-fireball': draw_fireball,
    'sos-vfx-thunder': draw_thunder,
    'sos-vfx-ice': draw_ice,
    'sos-vfx-heal': draw_heal,
    'sos-vfx-trap': draw_trap,
    'sos-vfx-arrow': draw_arrow,
    'sos-vfx-firebolt': draw_firebolt,
    'sos-vfx-acidbolt': draw_acidbolt,
    'sos-vfx-holy-ground': draw_holy_ground,
    'sos-vfx-holy-sigil': draw_holy_sigil,
}

for name, fn in GENERATORS.items():
    strip = Image.new('RGBA', (CELL * FRAMES, CELL), (0, 0, 0, 0))
    for f in range(FRAMES):
        strip.paste(fn(f), (f * CELL, 0))
    out_dir = os.path.join(OUT_ROOT, name)
    os.makedirs(out_dir, exist_ok=True)
    strip.save(os.path.join(out_dir, 'sprite-sheet-alpha.png'))
    manifest = {
        'game_input': 'sos',
        'degraded_static_fallback': False,
        'animation': {'rows': {'idle': {'row': 0, 'frames': FRAMES, 'fps': 12, 'loop': False}}},
        'frame_layout': {
            'rows': {'idle': [{'x': i * CELL, 'y': 0, 'w': CELL, 'h': CELL} for i in range(FRAMES)]},
            'sheetWidth': CELL * FRAMES,
            'sheetHeight': CELL,
            'cellWidth': CELL,
            'cellHeight': CELL,
        },
    }
    with open(os.path.join(out_dir, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2)
        fh.write('\n')
    print(f'{name}: wrote {CELL * FRAMES}x{CELL}')
