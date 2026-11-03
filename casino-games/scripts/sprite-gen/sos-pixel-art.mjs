#!/usr/bin/env node
/**
 * Procedural pixel-art generator for Square of Shadows.
 *
 * Why this exists instead of a recolour: the only animated atlas in the repo
 * (`player`) came back from the image provider as an AI-painted frame with 53k+
 * distinct RGB values. `sprite-gen recolor` tops out near 50% substituted at any
 * tolerance, so half the pixels stay casino blue-grey and the "medieval class"
 * read never appears. This generator authors the pixels directly from the
 * dark-dungeon palette, so every pixel is on-palette by construction and the
 * result is deterministic (same input -> same bytes).
 *
 * It writes real PNGs (zlib, filter 0, no dependencies) plus a manifest in the
 * sprite-gen atlas contract, so `scripts/validate-sprites.mjs` and
 * `AtlasLoader.ts` accept them unchanged.
 *
 * ── Frame layout ────────────────────────────────────────────────────────────
 * Each class sheet is ONE horizontal row of all states back to back:
 *
 *   [ idle x2 | attack x34 | cast x34 | death x3 | walk x4 ]
 *    0..1     2..35       36..69     70..72     73..76
 *
 * The renderer addresses frames by index, so `background-size` is the frame count
 * times 100% wide and a given frame is a percentage offset. One sheet per class
 * keeps it to a single HTTP request and one decode.
 *
 * Frame counts are deliberately not all small: 34 frames of arc sweep across a
 * ~700ms swing is what makes the weapon motion read as a swing rather than three
 * poses snapping between each other.
 *
 * Usage:
 *   node scripts/sprite-gen/sos-pixel-art.mjs --out-dir assets/sprites/generated
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ── config ───────────────────────────────────────────────────────────────────

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}
const outRoot = args.get('out-dir') ?? 'assets/sprites/generated';

/** Cell size in px. 32 gives room for the exaggerated silhouettes below. */
const CELL = 32;

/** Frames per state. Order here defines the row layout and the renderer indices. */
// Walk is appended rather than inserted after idle on purpose: the renderer and
// the tests address every state by a hardcoded frame index, so putting a new
// state anywhere but the end would renumber attack/cast/death and silently
// animate the wrong slice. Appending costs one new index range.
const STATES = [
  { name: 'idle', frames: 2 },
  { name: 'attack', frames: 34 },
  { name: 'cast', frames: 34 },
  { name: 'death', frames: 3 },
  { name: 'walk', frames: 4 },
];
const TOTAL_FRAMES = STATES.reduce((n, s) => n + s.frames, 0);

/** Where each state starts in the row. The renderer mirrors these numbers. */
const STATE_OFFSET = (() => {
  const out = {};
  let n = 0;
  for (const s of STATES) {
    out[s.name] = { start: n, frames: s.frames };
    n += s.frames;
  }
  return out;
})();

/**
 * Palette, straight from the skill's dark-dungeon 16. Every authored pixel is
 * one of these, which is what keeps the output on-palette by construction.
 */
// Darker, more demonic palette. Diablo/Castlevania/vampire horror: deeper blacks,
// blood reds instead of warm oranges, sickly greens, bone whites, dark iron.
const P = {
  void: '#050308',
  obsidian: '#0d0a14',
  indigo: '#1a1030',
  indigoHi: '#2e1f4a',
  steelDark: '#3a3a4a',
  steelMid: '#646476',
  steelHi: '#9898ac',
  bone: '#d8d0c0',
  mossDark: '#1a2a1a',
  moss: '#2a4a20',
  mossHi: '#4a7a30',
  emberDark: '#5a0a0a',
  ember: '#8b1a1a',
  emberHi: '#cc2222',
  arcane: '#4a1a6a',
  arcaneHi: '#7a3ab0',
};

// ── PNG encoder (no dependencies) ────────────────────────────────────────────

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};

/** Encode RGBA pixels as a PNG. */
const encodePng = (width, height, rgba) => {
  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, rowStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// ── drawing surface ──────────────────────────────────────────────────────────

const canvas = (w, h) => new Uint8Array(w * h * 4);

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const put = (buf, w, h, x, y, hex, alpha = 1) => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= w || yi >= h) return;
  const [r, g, b] = hexToRgb(hex);
  const i = (yi * w + xi) * 4;
  // Death frames fade by reducing alpha rather than blending toward the
  // background, so a corpse still darkens correctly over any floor tile.
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = Math.round(255 * Math.max(0, Math.min(1, alpha)));
};

const rect = (buf, w, h, x0, y0, rw, rh, hex, alpha = 1) => {
  for (let y = y0; y < y0 + rh; y += 1) {
    for (let x = x0; x < x0 + rw; x += 1) put(buf, w, h, x, y, hex, alpha);
  }
};

const outline = (buf, w, h, x0, y0, rw, rh, hex, alpha = 1) => {
  for (let x = x0; x < x0 + rw; x += 1) {
    put(buf, w, h, x, y0, hex, alpha);
    put(buf, w, h, x, y0 + rh - 1, hex, alpha);
  }
  for (let y = y0; y < y0 + rh; y += 1) {
    put(buf, w, h, x0, y, hex, alpha);
    put(buf, w, h, x0 + rw - 1, y, hex, alpha);
  }
};

/**
 * Draw a line of a given thickness, centred on the path.
 *
 * This is what makes the weapon arcs possible: a sword sweeping through 34
 * frames is one call per frame at a different angle, rather than 34 hand-placed
 * sprites. Bresenham plus a perpendicular offset gives clean pixel steps with no
 * gaps at shallow angles.
 */
const thickLine = (buf, w, h, x0, y0, x1, y1, hex, thickness = 1, alpha = 1) => {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const dx = Math.abs(ex - x);
  const dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx + dy;
  const half = Math.floor(thickness / 2);
  for (;;) {
    for (let oy = -half; oy <= half; oy += 1) {
      for (let ox = -half; ox <= half; ox += 1) put(buf, w, h, x + ox, y + oy, hex, alpha);
    }
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
};

/**
 * A drawing context bound to one cell.
 *
 * `buf`/`w`/`h` are exposed because a cast frame has to draw a glow that is not
 * a rectangle — that needs raw pixel access with alpha, not the rect helper.
 */
const brush = (buf, w, h) => ({
  buf,
  w,
  h,
  r: (x0, y0, rw, rh, hex, a) => rect(buf, w, h, x0, y0, rw, rh, hex, a),
  p: (x, y, hex, a) => put(buf, w, h, x, y, hex, a),
  o: (x0, y0, rw, rh, hex, a) => outline(buf, w, h, x0, y0, rw, rh, hex, a),
  line: (x0, y0, x1, y1, hex, t, a) => thickLine(buf, w, h, x0, y0, x1, y1, hex, t, a),
});

// ── deterministic noise (no Math.random, so runs are reproducible) ───────────

const hash = (x, y, salt = 0) => {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ── terrain ──────────────────────────────────────────────────────────────────

/**
 * Terrain tiles: two floor variants, then one wall tile per neighbour mask.
 *
 * The wall set is autotiled — see `drawWallTile`. `WALL_M` is the tile for a wall
 * with neighbour mask M, so a 2x2 block asks for four different tiles that each
 * know which of their own edges are exposed.
 */
const TILE = (() => {
  const tiles = { FLOOR: 0, FLOOR_ALT: 1 };
  let next = 2;
  for (let mask = 0; mask < 16; mask += 1) {
    tiles[`WALL_${mask}`] = next;
    next += 1;
  }
  return tiles;
})();
const TILE_SIZE = 32;
const TILE_NAMES = Object.keys(TILE);
/**
 * Terrain tiles.
 *
 * Wall visibility was the problem: the walls were indigo-on-indigo against an
 * indigo floor, so the board read as an empty grid with a few darker smudges.
 * The fix is a deliberate value jump, not a small lighten:
 *
 *   floor   obsidian / indigo         (very dark, recedes)
 *   wall    steelDark  -> steelMid    (mid value, clearly forward)
 *   cap     steelHi    + torch amber  (brightest, draws the eye)
 *   base    void                      (darkest, grounds the block)
 *
 * The amber torch pools on the cap are the second half of the fix. Warm light on
 * a cold stone edge is what separates "wall" from "floor" at a glance, and it
 * costs nothing since it is painted, not lit.
 */
const buildTerrainSheet = () => {
  const w = TILE_SIZE * TILE_NAMES.length;
  const h = TILE_SIZE;
  const sheet = canvas(w, h);
  const at = (name) => TILE[name] * TILE_SIZE;

  // ── floors: dark, low contrast, so units stay the focus ──
  for (const [name, base, speckle, salt] of [
    ['FLOOR', P.obsidian, P.indigo, 1],
    ['FLOOR_ALT', P.indigo, P.indigoHi, 2],
  ]) {
    const ox = at(name);
    for (let y = 0; y < TILE_SIZE; y += 1) {
      for (let x = 0; x < TILE_SIZE; x += 1) {
        const n = hash(x, y, salt);
        put(sheet, w, h, ox + x, y, n > 0.88 ? speckle : base);
      }
    }
    // Flagstone grout. Kept faint — a bright grid would fight the tile art.
    for (let i = 0; i <= TILE_SIZE; i += 16) {
      for (let k = 0; k < TILE_SIZE; k += 1) {
        put(sheet, w, h, ox + i, k, P.void);
        put(sheet, w, h, ox + k, i, P.void);
      }
    }
  }

  // ── walls: one tile per neighbour mask, so runs merge instead of stamping ──
  for (let mask = 0; mask < 16; mask += 1) {
    drawWallTile(sheet, w, h, at(wallTileName(mask)), mask);
  }

  return { sheet, w, h };
};

/**
 * Wall tiles are autotiled from a 4-bit neighbour mask.
 *
 * The previous set was three fixed tiles (WALL / WALL_TOP / WALL_BASE) picked by
 * only "is there stone above / below". Every cell in the top row of a block
 * therefore got the full lit cap, and every interior cell carried its own left
 * bevel — so a 2x2 or a horizontal run read as a row of separate stamped tiles
 * rather than one structure.
 *
 * With a mask the edges can be *suppressed* where a neighbour continues the wall,
 * which is what merges a run into a single block. Bits are neighbours, not
 * directions-to-draw, so `mask & N` is a question about the world rather than
 * about the art.
 */
const N_UP = 1, N_RIGHT = 2, N_DOWN = 4, N_LEFT = 8;

/**
 * Warm an opaque pixel by swapping it for a palette colour, dithered.
 *
 * `put` *replaces* alpha rather than blending, which is what the death fade needs
 * but is the wrong tool for light: a low alpha does not tint a pixel, it makes the
 * pixel see-through, so a subtle highlight punches a hole straight through the
 * stone and the floor shows via the gap.
 *
 * The terrain sheet is also palette-locked (a test asserts no colour outside the
 * dungeon palette), so light cannot arrive by mixing a new RGB either. It arrives
 * by *choosing* the neighbouring palette colour on a fraction of the pixels, and
 * the gradient is carried by how many get swapped — a dithered falloff, which is
 * also how this would be done by hand.
 */
const wash = (buf, w, h, x, y, hex, amount, salt) => {
  if (amount <= 0) return;
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (hash(xi, yi, salt) < amount) put(buf, w, h, xi, yi, hex, 1);
};

const wallTileName = (mask) => `WALL_${mask}`;

/** How far down the lit top course reaches before the wall is plain stone. */
const CAP_DEPTH = 9;

/** Draw one wall tile: shared stone body, then only the edges that are exposed. */
const drawWallTile = (sheet, w, h, ox, mask) => {
  const up = mask & N_UP, right = mask & N_RIGHT, down = mask & N_DOWN, left = mask & N_LEFT;

  rect(sheet, w, h, ox, 0, TILE_SIZE, TILE_SIZE, P.steelDark);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const n = hash(x, y, 3);
      // Bright chips on the upper courses read as light catching the stone.
      if (y < TILE_SIZE * 0.5 && n > 0.86) put(sheet, w, h, ox + x, y, P.steelMid);
      else if (n > 0.94) put(sheet, w, h, ox + x, y, P.obsidian);
      const course = Math.floor(y / 8);
      if (y % 8 === 0) put(sheet, w, h, ox + x, y, P.void);
      if ((x + course * 4) % 16 === 0) put(sheet, w, h, ox + x, y, P.void);
    }
  }

  // ── exposed edges only ──
  if (!up) {
    // Top of the wall. Confined to the upper courses on purpose: the earlier cap
    // repainted the whole 32px face as bright speckle, so the top row of any wall
    // read as a pale band sitting on brick rather than as stone with a lit edge.
    for (let y = 0; y < CAP_DEPTH; y += 1) {
      for (let x = 0; x < TILE_SIZE; x += 1) {
        // Light catches the top course; the courses below stay plain stone.
        if (hash(x, y, 4) > 0.74) put(sheet, w, h, ox + x, y, P.steelHi);
      }
    }
    // Torchlight washing down from the lip. Varies with y only, never with x:
    // every wall tile is shared by every wall on the board, so anything with a
    // recognisable shape repeats down the whole run and the tiling becomes
    // obvious again. A pure vertical gradient repeats invisibly.
    for (let y = 1; y < CAP_DEPTH; y += 1) {
      const fall = 1 - y / CAP_DEPTH;
      for (let x = 0; x < TILE_SIZE; x += 1) {
        // Kept faint on purpose: at full strength the band stops reading as lit
        // stone and starts reading as a wooden beam bolted onto the wall.
        wash(sheet, w, h, ox + x, y, fall > 0.45 ? P.emberHi : P.ember, 0.5 * fall * fall, 7);
      }
    }
    // Joints last, so they stay dark through the warm band. Without this the lit
    // course reads as a separate material pasted onto the wall.
    for (let y = 0; y < CAP_DEPTH; y += 1) {
      for (let x = 0; x < TILE_SIZE; x += 1) {
        if ((x + Math.floor(y / 8) * 4) % 16 === 0) put(sheet, w, h, ox + x, y, P.void);
      }
    }
    // The lip itself: the brightest line on the tile.
    for (let x = 0; x < TILE_SIZE; x += 1) put(sheet, w, h, ox + x, 0, P.bone);
  }

  if (!left) {
    // Bevel only where nothing continues to the left; this is the edge that used
    // to repeat on every cell and break a horizontal run into stamps.
    for (let y = 0; y < TILE_SIZE; y += 1) put(sheet, w, h, ox, y, P.steelMid);
  }

  if (!right) {
    for (let y = 0; y < TILE_SIZE; y += 1) put(sheet, w, h, ox + TILE_SIZE - 1, y, P.obsidian);
  }

  if (!down) {
    // Sits on the floor: darken the lower band and lay a shadow lip beneath.
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < TILE_SIZE; x += 1) {
        if (hash(x, y, 5) > 0.72) put(sheet, w, h, ox + x, TILE_SIZE - y, P.obsidian);
        else if (hash(x, y, 6) > 0.93) put(sheet, w, h, ox + x, TILE_SIZE - y, P.steelDark);
      }
    }
    for (let x = 0; x < TILE_SIZE; x += 1) put(sheet, w, h, ox + x, TILE_SIZE - 1, P.void);
  }
};

// ── class sprites ────────────────────────────────────────────────────────────

/**
 * Shared body rig.
 *
 * Every class draws from the same skeleton so a squad reads as one roster, then
 * exaggerates a different axis per class so they read apart at tile size. The
 * silhouette is doing the identifying work — a player must name the class from
 * the shape alone, before reading the colour.
 *
 *   centre  — x the body is built around (CELL/2)
 *   bob     — vertical breathing offset, 0 or 1
 *   crouch  — how far the legs compress (death)
 *   armAngle— weapon swing angle in radians
 *   alpha   — global fade, used by the death frames
 */
const rig = (b, { accent, accentHi, bob = 0, crouch = 0, alpha = 1, stride = 0 }) => {
  const cx = 16;
  const legTop = 25 - crouch;
  const bodyTop = 12 + bob - crouch;
  const bodyH = legTop - bodyTop;

  // Legs. `stride` is which leg is forward, not how far: 1 = left forward,
  // -1 = right forward, 0 = passing.
  //
  // Sliding the legs fore/aft was the first attempt and it does not work on a
  // front-facing figure at 3px leg width — moving one leg 2px right slides it
  // *into* its neighbour, so a step read as the legs closing together. A forward
  // leg is drawn short and lifted instead: foreshortening is the only depth cue
  // available when both knees point at the camera.
  const legH = 7 - crouch;
  const leftH = legH - (stride === 1 ? 2 : 0);
  const rightH = legH - (stride === -1 ? 2 : 0);
  b.r(cx - 4, legTop, 3, leftH, P.obsidian, alpha);
  b.r(cx + 1, legTop, 3, rightH, P.obsidian, alpha);
  b.r(cx - 4, legTop + leftH, 3, 1, P.void, alpha);
  b.r(cx + 1, legTop + rightH, 3, 1, P.void, alpha);
  // A one-pixel gap opens between the legs on a step, which is what stops the
  // stride reading as a flicker in a single blob.
  if (stride !== 0) b.r(cx - 1, legTop + legH - 3, 2, 1, P.void, alpha);

  // torso
  b.r(cx - 4, bodyTop, 8, bodyH, accent, alpha);
  b.r(cx - 1, bodyTop + 1, 2, bodyH - 1, accentHi, alpha);

  return { cx, bodyTop, legTop, bodyH };
};

/** Idle: a 1px breath. Two frames only — more would be wasted at this size. */
const IDLE = (b, pal, f = 0, count = 2) => {
  // A one-pixel breathing bob. Without it the two idle frames were byte-identical
  // and the idle animation ran without ever changing anything.
  const bob = count > 1 ? (f % 2) : 0;
  const g = rig(b, { ...pal, bob });
  b.r(g.cx - 3, g.bodyTop - 7, 6, 7, pal.hood, 1);
  b.r(g.cx - 1, g.bodyTop - 4, 2, 2, P.void, 1);
  b.o(g.cx - 3, g.bodyTop - 7, 6, 7, P.void, 1);
  b.o(g.cx - 4, g.bodyTop, 8, g.bodyH, P.void, 1);
  return g;
};

/**
 * Walk: 4 frames, a two-step cycle.
 *
 * Frames alternate lead/trail leg and bob the body on the passing frames. Four
 * frames is deliberate: at 32px a walk cycle reads entirely from which foot is
 * forward, and anything longer is frames nobody can tell apart, spent on atlas
 * width that costs a percentage point of precision on every other state.
 */
const WALK = (b, pal, f = 0, count = 4) => {
  // 0: left forward, 1: passing (body lifts), 2: right forward, 3: passing.
  const stride = [1, 0, -1, 0][f % 4];
  const bob = f % 2 === 1 ? -1 : 0;
  return rig(b, { ...pal, bob, stride });
};

/**
 * Attack: a real arc, 34 frames.
 *
 * The angle sweeps a full windup-and-through rather than posing three times.
 * Frames 0-13 wind up behind the shoulder, 14-23 cut through fast, 24-33 recover
 * — that asymmetry is what makes a swing feel like it has weight, and it is why
 * 34 frames earns its place over 3.
 */
const ATTACK = (b, pal, f, count) => {
  const t = f / (count - 1);
  // Ease: slow windup, fast cut, slower recovery.
  let angle;
  if (t < 0.4) angle = lerp(-2.5, -1.15, t / 0.4);
  else if (t < 0.68) angle = lerp(-1.15, 0.85, (t - 0.4) / 0.28);
  else angle = lerp(0.85, -2.5, (t - 0.68) / 0.32);

  // Small forward lean through the cut.
  const lean = t > 0.4 && t < 0.68 ? Math.round(2 * Math.sin(((t - 0.4) / 0.28) * Math.PI)) : 0;
  const g = rig(b, { ...pal, bob: 0 });
  const pivotX = g.cx + 3;
  const pivotY = g.bodyTop + 3;

  if (pal.weapon === 'sword') {
    // Big, obvious blade held at the pivot.
    const len = 13;
    const bx = pivotX + Math.cos(angle) * len;
    const by = pivotY + Math.sin(angle) * len;
    b.line(pivotX, pivotY, bx, by, pal.metalHi, 3, 1);
    b.p(bx, by, P.bone, 1);
    // crossguard
    b.line(pivotX - 3, pivotY + 3, pivotX + 3, pivotY - 3, pal.accentHi, 2, 1);
  } else if (pal.weapon === 'staff') {
    const len = 11;
    const bx = pivotX + Math.cos(angle) * len;
    const by = pivotY + Math.sin(angle) * len;
    b.line(pivotX, pivotY, bx, by, P.mossDark, 2, 1);
    // lit head on the tip
    b.p(bx, by, P.arcaneHi, 1);
    b.p(bx + 1, by, P.arcane, 1);
    b.p(bx, by + 1, P.arcane, 1);
  } else if (pal.weapon === 'censer') {
    const len = 10;
    const bx = pivotX + Math.cos(angle) * len;
    const by = pivotY + Math.sin(angle) * len;
    b.line(pivotX, pivotY, bx, by, P.mossDark, 2, 1);
    b.p(bx, by, P.bone, 1);
    b.p(bx + 1, by, P.mossHi, 1);
  } else {
    // Ranger: a drawn bow, the string hand pulling back.
    const len = 11;
    const bx = pivotX + Math.cos(angle) * len;
    const by = pivotY + Math.sin(angle) * len;
    b.line(pivotX, pivotY, bx, by, P.mossDark, 2, 1);
    b.line(bx, by, g.cx - 2, pivotY, P.bone, 1, 1);
  }

  b.o(g.cx - 4, g.bodyTop, 8, g.bodyH, P.void, 1);
  return g;
};

/**
 * Cast: glow build then release.
 *
 * 34 frames split into charge (orb grows and brightens at the caster) and
 * release (the orb streaks out along the aim line). Without the charge the cast
 * reads as a projectile appearing, which is not what casting looks like.
 */
const CAST = (b, pal, f, count) => {
  const t = f / (count - 1);
  const charging = t < 0.45;
  const g = rig(b, { ...pal, bob: charging ? -1 : 0 });
  const ox = g.cx + 6;
  const oy = g.bodyTop + 1;

  // Staff / censer arm held up while charging.
  b.line(g.cx + 3, g.bodyTop + 3, ox, oy, P.mossDark, 2, 1);

  if (charging) {
    const grow = clamp01(t / 0.45);
    const r = 1 + Math.round(grow * 4);
    for (let y = -r; y <= r; y += 1) {
      for (let x = -r; x <= r; x += 1) {
        const d = Math.hypot(x, y);
        if (d > r) continue;
        put(b.buf, b.w, b.h, ox + x, oy + y, d > r - 1 ? pal.accent : pal.accentHi, 1);
      }
    }
  } else {
    // Released: streak along the aim line, fading out.
    const travel = (t - 0.45) / 0.55;
    const px = ox + Math.round(travel * 14);
    const tail = 5;
    for (let i = 0; i <= tail; i += 1) {
      put(b.buf, b.w, b.h, px - i, oy, pal.accent, 1 - (i / tail) * 0.8);
    }
    put(b.buf, b.w, b.h, px, oy, pal.accentHi, 1);
    put(b.buf, b.w, b.h, px + 1, oy, pal.accentHi, 0.8);
  }

  b.o(g.cx - 4, g.bodyTop, 8, g.bodyH, P.void, 1);
  return g;
};

/**
 * Death: 3 frames of collapse.
 *
 * Crouch then fade. Fading alpha rather than blending to the background colour
 * is deliberate — a blended corpse would pick up whatever floor tile it died on.
 */
const DEATH = (b, pal, f) => {
  const crouch = [0, 3, 6][f];
  const alpha = [1, 0.6, 0.25][f];
  const g = rig(b, { ...pal, crouch, alpha });
  if (f === 0) {
    // Still standing: eyes go out, arms drop.
    b.r(g.cx - 3, g.bodyTop - 7, 6, 7, pal.hood, alpha);
    b.r(g.cx - 1, g.bodyTop - 4, 2, 2, P.void, alpha);
    b.o(g.cx - 3, g.bodyTop - 7, 6, 7, P.void, alpha);
  }
  if (f === 2) {
    // Last frame: a scattered smear on the floor.
    for (let i = 0; i < 8; i += 1) {
      put(b.buf, b.w, b.h, g.cx - 4 + i, 31, P.void, 0.5);
    }
  }
  b.o(g.cx - 4, g.bodyTop, 8, g.bodyH, P.void, alpha);
  return g;
};

// Each class differs by headgear, weapon, and a deliberate proportion change.
const CLASSES = {
  WARRIOR: {
    accent: P.emberDark,
    accentHi: P.ember,
    hood: P.steelMid,
    metal: P.steelMid,
    metalHi: P.steelHi,
    weapon: 'sword',
    /** Bulky: widest shoulders, thickest body, biggest blade. */
    draw(b, state, f, count) {
      const cx = 16;
      const wide = 6;
      if (state === 'idle') {
        const g = IDLE(b, this, f, count);
        // Heavy pauldrons.
        b.r(cx - wide - 1, g.bodyTop - 1, 4, 4, P.steelMid, 1);
        b.r(cx + wide - 3, g.bodyTop - 1, 4, 4, P.steelHi, 1);
        b.o(cx - wide - 1, g.bodyTop - 1, 4, 4, P.void, 1);
        b.o(cx + wide - 3, g.bodyTop - 1, 4, 4, P.void, 1);
        return;
      }
      if (state === 'walk') {
        const g = WALK(b, this, f, count);
        b.r(cx - wide - 1, g.bodyTop - 1, 4, 4, P.steelMid, 1);
        b.r(cx + wide - 3, g.bodyTop - 1, 4, 4, P.steelHi, 1);
        b.o(cx - wide - 1, g.bodyTop - 1, 4, 4, P.void, 1);
        b.o(cx + wide - 3, g.bodyTop - 1, 4, 4, P.void, 1);
        b.r(g.cx - 3, g.bodyTop - 7, 6, 7, P.steelMid, 1);
        b.r(g.cx - 1, g.bodyTop - 5, 2, 2, P.void, 1);
        b.p(g.cx - 4, g.bodyTop - 8, P.bone, 1);
        b.p(g.cx - 5, g.bodyTop - 6, P.bone, 1);
        b.p(g.cx + 4, g.bodyTop - 8, P.bone, 1);
        b.p(g.cx + 5, g.bodyTop - 6, P.bone, 1);
        return;
      }
      if (state === 'attack') {
        // Recompute the rig so the pauldrons follow the swing.
        const g = ATTACK(b, this, f, count);
        b.r(cx - wide - 1, g.bodyTop - 1, 4, 4, P.steelMid, 1);
        b.r(cx + wide - 3, g.bodyTop - 1, 4, 4, P.steelHi, 1);
        b.o(cx - wide - 1, g.bodyTop - 1, 4, 4, P.void, 1);
        b.o(cx + wide - 3, g.bodyTop - 1, 4, 4, P.void, 1);
        // Horned helm, always visible.
        b.r(g.cx - 3, g.bodyTop - 7, 6, 7, P.steelMid, 1);
        b.r(g.cx - 1, g.bodyTop - 5, 2, 2, P.void, 1);
        b.p(g.cx - 4, g.bodyTop - 8, P.bone, 1);
        b.p(g.cx - 5, g.bodyTop - 6, P.bone, 1);
        b.p(g.cx + 4, g.bodyTop - 8, P.bone, 1);
        b.p(g.cx + 5, g.bodyTop - 6, P.bone, 1);
        return;
      }
      if (state === 'cast') {
        const g = CAST(b, this, f, count);
        b.r(cx - wide - 1, g.bodyTop - 1, 4, 4, P.steelMid, 1);
        b.r(cx + wide - 3, g.bodyTop - 1, 4, 4, P.steelHi, 1);
        b.r(g.cx - 3, g.bodyTop - 7, 6, 7, P.steelMid, 1);
        return;
      }
      DEATH(b, this, f);
    },
  },

  WIZARD: {
    accent: P.indigo,
    accentHi: P.arcane,
    hood: P.void,
    metal: P.indigoHi,
    metalHi: P.steelDark,
    weapon: 'staff',
    /** Tallest silhouette: the hat is the identity, so it is drawn big. */
    draw(b, state, f, count) {
      const hat = (g, alpha) => {
        for (let i = 0; i < 8; i += 1) {
          const wt = 3 + i * 2;
          b.r(16 - wt / 2, g.bodyTop - 16 + i, wt, 1, i > 5 ? P.arcane : this.accent, alpha);
        }
        b.p(16, g.bodyTop - 17, P.arcaneHi, alpha);
        b.r(9, g.bodyTop - 9, 14, 1, P.arcane, alpha);
        b.r(g.cx - 2, g.bodyTop - 6, 4, 3, P.void, alpha);
      };
      if (state === 'idle') {
        const g = IDLE(b, this, f, count);
        hat(g, 1);
        return;
      }
      if (state === 'walk') {
        hat(WALK(b, this, f, count), 1);
        return;
      }
      if (state === 'attack') {
        const g = ATTACK(b, this, f, count);
        hat(g, 1);
        return;
      }
      if (state === 'cast') {
        const g = CAST(b, this, f, count);
        hat(g, 1);
        return;
      }
      const g = DEATH(b, this, f);
      hat(g, [1, 0.6, 0.25][f]);
    },
  },

  CLERIC: {
    accent: P.mossDark,
    accentHi: P.moss,
    hood: P.void,
    metal: P.mossDark,
    metalHi: P.moss,
    weapon: 'censer',
    /** Widest, lowest silhouette: a wide robe flaring to the floor. */
    draw(b, state, f, count) {
      const robe = (g, alpha) => {
        for (let i = 0; i < 9; i += 1) {
          const wt = 8 + i;
          b.r(16 - wt / 2, g.bodyTop + i, wt, 1, this.accent, alpha);
        }
        // Central cross: the class read at a glance.
        b.r(15, g.bodyTop + 1, 2, 8, this.hood, alpha);
        b.r(13, g.bodyTop + 3, 6, 2, this.hood, alpha);
        b.p(15, g.bodyTop + 2, P.mossHi, alpha);
      };
      if (state === 'idle') {
        const g = IDLE(b, this, f, count);
        robe(g, 1);
        return;
      }
      if (state === 'walk') {
        robe(WALK(b, this, f, count), 1);
        return;
      }
      if (state === 'attack') {
        const g = ATTACK(b, this, f, count);
        robe(g, 1);
        return;
      }
      if (state === 'cast') {
        const g = CAST(b, this, f, count);
        robe(g, 1);
        return;
      }
      const g = DEATH(b, this, f);
      robe(g, [1, 0.6, 0.25][f]);
    },
  },

  RANGER: {
    accent: P.mossDark,
    accentHi: P.moss,
    hood: P.void,
    metal: P.steelDark,
    metalHi: P.steelMid,
    weapon: 'bow',
    /** Narrowest and hunched, with the bow breaking the outline. */
    draw(b, state, f, count) {
      const bow = (g, alpha, pull = 0) => {
        // Arc, drawn out to the right so the silhouette is not a blob.
        for (let i = 0; i < 14; i += 1) {
          const tt = i / 13;
          const y = g.bodyTop + 2 + i;
          const x = Math.round(22 - Math.sin(tt * Math.PI) * 4);
          b.p(x, y, P.mossDark, alpha);
        }
        // String: straight when idle, drawn back during the shot.
        b.line(22, g.bodyTop + 2, 22 - pull, g.bodyTop + 9, P.bone, 1, alpha);
      };
      const hood = (g, alpha) => {
        b.r(g.cx - 3, g.bodyTop - 7, 6, 7, this.hood, alpha);
        b.r(g.cx - 2, g.bodyTop - 5, 4, 3, P.void, alpha);
        b.p(g.cx, g.bodyTop - 4, P.mossHi, alpha);
        // Cowl points trailing back: a small tell that says "hood".
        b.p(g.cx - 4, g.bodyTop - 5, this.hood, alpha);
        b.p(g.cx - 5, g.bodyTop - 4, this.hood, alpha);
      };
      if (state === 'idle') {
        const g = IDLE(b, this, f, count);
        hood(g, 1);
        bow(g, 1);
        return;
      }
      if (state === 'walk') {
        const g = WALK(b, this, f, count);
        hood(g, 1);
        bow(g, 1);
        return;
      }
      if (state === 'attack') {
        // The "attack" for a Ranger is the shot: string pulls then releases.
        const pull = f < 20 ? Math.round((f / 20) * 5) : Math.max(0, 5 - Math.round(((f - 20) / (count - 21)) * 5));
        const g = ATTACK(b, this, f, count);
        hood(g, 1);
        bow(g, 1, pull);
        if (f >= 20) {
          const travel = (f - 20) / (count - 21);
          const ax = Math.round(23 + travel * 10);
          b.line(ax - 3, g.bodyTop + 9, ax, g.bodyTop + 9, P.bone, 1, 1);
        }
        return;
      }
      if (state === 'cast') {
        const g = CAST(b, this, f, count);
        hood(g, 1);
        bow(g, 1);
        return;
      }
      const g = DEATH(b, this, f);
      hood(g, [1, 0.6, 0.25][f]);
    },
  },
};

/** Build one class's sheet: one row, all states concatenated. */
/**
 * Stamp a 1px outline around whatever ink is already in a frame.
 *
 * Measured on the generated sheets, the characters sat *darker* than the floor
 * they stand on — a Wizard's ink averaged luma 37 against a floor of ~74 — so
 * they read as holes rather than figures. A bright rim is what separates a
 * sprite from a busy tile at 32px, and doing it here means one pass over the
 * finished frame instead of editing every draw call.
 *
 * Only fills transparent pixels, and only next to ink, so it cannot fatten the
 * silhouette or touch the existing shading. Partial alpha (the death fade) is
 * left alone; outlining those pixels would thicken the corpse as it fades.
 *
 * The rim is *bright*, not a dark drop shadow. The characters are darker than the
 * floor already, so a dark edge would simply merge them into the tile — which is
 * the thing being fixed. A light rim reads at 32px and is what a pixel artist
 * would reach for anyway.
 */
const OUTLINE = P.steelHi;

const outlineFrame = (cell, size) => {
  // Snapshot the alpha BEFORE writing anything. Reading the live buffer here
  // makes the rim feed itself: each pixel it fills becomes "ink" for its
  // neighbour, and the outline creeps outward until it floods the tile.
  const snapshot = Uint8Array.from(cell);
  const alphaAt = (x, y) =>
    x < 0 || y < 0 || x >= size || y >= size ? 0 : snapshot[(y * size + x) * 4 + 3];
  const isInk = (x, y) => alphaAt(x, y) >= 128;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      if (cell[i + 3] !== 0) continue;
      if (!isInk(x - 1, y) && !isInk(x + 1, y) && !isInk(x, y - 1) && !isInk(x, y + 1)) continue;
      // Skip if the neighbouring ink is itself a fading frame, so the rim does
      // not thicken as the sprite dies.
      let softNeighbour = false;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        const a = alphaAt(nx, ny);
        if (a > 0 && a < 128) softNeighbour = true;
      }
      if (softNeighbour) continue;
      cell[i] = parseInt(OUTLINE.slice(1, 3), 16);
      cell[i + 1] = parseInt(OUTLINE.slice(3, 5), 16);
      cell[i + 2] = parseInt(OUTLINE.slice(5, 7), 16);
      cell[i + 3] = 255;
    }
  }
};

const buildClassSheet = (def) => {
  const w = CELL * TOTAL_FRAMES;
  const h = CELL;
  const sheet = canvas(w, h);

  let frame = 0;
  for (const { name, frames } of STATES) {
    for (let f = 0; f < frames; f += 1) {
      const cell = canvas(CELL, CELL);
      def.draw(brush(cell, CELL, CELL), name, f, frames);
      // Rim the silhouette so the character separates from the floor tile.
      outlineFrame(cell, CELL);

      for (let y = 0; y < CELL; y += 1) {
        for (let x = 0; x < CELL; x += 1) {
          const si = (y * CELL + x) * 4;
          if (cell[si + 3] === 0) continue;
          const di = (y * w + frame * CELL + x) * 4;
          sheet[di] = cell[si];
          sheet[di + 1] = cell[si + 1];
          sheet[di + 2] = cell[si + 2];
          // Partial alpha (death fade) is preserved, not forced opaque.
          sheet[di + 3] = cell[si + 3];
        }
      }
      frame += 1;
    }
  }
  return { sheet, w, h };
};

// ── manifest ─────────────────────────────────────────────────────────────────

const classManifest = (w, h) => {
  const frames = [];
  for (let i = 0; i < TOTAL_FRAMES; i += 1) {
    frames.push({ x: i * CELL, y: 0, w: CELL, h: CELL });
  }
  const rows = { all: frames };
  const animation = {
    rows: {
      all: { row: 0, frames: TOTAL_FRAMES, fps: 12, loop: false },
    },
  };
  return {
    game_input: 'sos',
    degraded_static_fallback: true,
    animation,
    frame_layout: { rows, sheetWidth: w, sheetHeight: h, cellWidth: CELL, cellHeight: CELL },
    // Non-standard, but the renderer needs the layout and this keeps it in one
    // file rather than duplicated across CSS and TS.
    states: STATE_OFFSET,
  };
};

const terrainManifest = (w, h) => {
  const frame_layout = { rows: {}, sheetWidth: w, sheetHeight: h, cellWidth: TILE_SIZE, cellHeight: TILE_SIZE };
  const animation = { rows: {} };
  for (const name of TILE_NAMES) {
    frame_layout.rows[name] = [{ x: TILE[name] * TILE_SIZE, y: 0, w: TILE_SIZE, h: TILE_SIZE }];
    animation.rows[name] = { row: 0, frames: 1, fps: 1, loop: false };
  }
  return { game_input: 'sos', degraded_static_fallback: false, animation, frame_layout };
};

// ── emit ─────────────────────────────────────────────────────────────────────

const write = (path, buf) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
};

const report = [];

for (const [name, def] of Object.entries(CLASSES)) {
  const key = name.toLowerCase();
  const { sheet, w, h } = buildClassSheet(def);
  const dir = join(outRoot, `sos-${key}`);
  write(join(dir, 'sprite-sheet-alpha.png'), encodePng(w, h, sheet));
  write(join(dir, 'manifest.json'), `${JSON.stringify(classManifest(w, h), null, 2)}\n`);
  report.push({ atlas: `sos-${key}`, size: `${w}x${h}`, frames: TOTAL_FRAMES });
}

const terrain = buildTerrainSheet();
write(join(outRoot, 'sos-terrain', 'sprite-sheet-alpha.png'), encodePng(terrain.w, terrain.h, terrain.sheet));
write(join(outRoot, 'sos-terrain', 'manifest.json'), `${JSON.stringify(terrainManifest(terrain.w, terrain.h), null, 2)}\n`);
report.push({ atlas: 'sos-terrain', size: `${terrain.w}x${terrain.h}`, tiles: TILE_NAMES.join(',') });

console.log(
  JSON.stringify(
    { ok: true, outRoot, palette: 16, cell: CELL, states: STATE_OFFSET, report },
    null,
    2,
  ),
);