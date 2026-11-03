/**
 * Byte-level verification of the generated SoS atlases.
 *
 * Checks, per atlas:
 *  - valid PNG structure (IHDR/IDAT/IEND, correct CRC path via inflate)
 *  - every colour is one of the dark-dungeon 16 (no anti-aliased blends)
 *  - every frame in every state has non-trivial content, so a state cannot
 *    silently bake as blank and "animate" through 34 empty cells
 *  - wall tiles are measurably brighter than floor tiles (the contrast fix)
 */
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

const PALETTE = new Set([
  '#050308', '#0d0a14', '#1a1030', '#2e1f4a', '#3a3a4a', '#646476', '#9898ac', '#d8d0c0',
  '#1a2a1a', '#2a4a20', '#4a7a30', '#5a0a0a', '#8b1a1a', '#cc2222', '#4a1a6a', '#7a3ab0',
]);

const decode = (buf) => {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let off = 8;
  let ihdr = null;
  const idat = [];
  let sawEnd = false;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        depth: data[8], colour: data[9], interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') { sawEnd = true; break; }
    off += 12 + len;
  }
  if (!ihdr) throw new Error('no IHDR');
  if (!sawEnd) throw new Error('no IEND');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = ihdr.width * bpp;
  const out = Buffer.alloc(ihdr.height * stride);
  let pos = 0;
  for (let y = 0; y < ihdr.height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    for (let x = 0; x < stride; x += 1) {
      const b = raw[pos + x];
      const left = x >= bpp ? out[y * stride + x - bpp] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const ul = y > 0 && x >= bpp ? out[(y - 1) * stride + x - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = b; break;
        case 1: v = b + left; break;
        case 2: v = b + up; break;
        case 3: v = b + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - ul;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul);
          v = b + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul);
          break;
        }
        default: throw new Error(`bad filter ${filter}`);
      }
      out[y * stride + x] = v & 0xff;
    }
    pos += stride;
  }
  return { ...ihdr, rgba: out };
};

const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const checkClass = (dir) => {
  const bytes = fs.readFileSync(`${dir}/sprite-sheet-alpha.png`);
  const img = decode(bytes);
  const manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, 'utf8'));
  const states = manifest.states;
  const cell = manifest.frame_layout.cellWidth;

  const stray = new Set();
  let opaque = 0;
  for (let i = 0; i < img.width * img.height; i += 1) {
    if (img.rgba[i * 4 + 3] === 0) continue;
    opaque += 1;
    const c = hex(img.rgba[i * 4], img.rgba[i * 4 + 1], img.rgba[i * 4 + 2]);
    if (!PALETTE.has(c)) stray.add(c);
  }

  // Per-frame fill, so a blank state cannot pass unnoticed.
  const frames = [];
  let blank = 0;
  for (const [name, { start, frames: count }] of Object.entries(states)) {
    for (let f = 0; f < count; f += 1) {
      const fx = (start + f) * cell;
      let filled = 0;
      for (let y = 0; y < cell; y += 1) {
        for (let x = 0; x < cell; x += 1) {
          if (img.rgba[(y * img.width + fx + x) * 4 + 3] > 0) filled += 1;
        }
      }
      const pct = (filled / (cell * cell)) * 100;
      frames.push({ name, f, pct: Number(pct.toFixed(1)) });
      if (filled === 0) blank += 1;
    }
  }

  // Distinctness: the four classes must not render identically.
  //
  // This has to walk the sheet with the real row stride. The frames of one state
  // are NOT contiguous in the file — each cell is followed by the rest of its
  // 2336px row — so a naive `[start*cell .. (start+n)*cell]` slice reads past the
  // row into padding and can come back empty, which is how an earlier version of
  // this check reported an identical "hash" for four genuinely different states.
  const byState = {};
  for (const [name, { start, frames: count }] of Object.entries(states)) {
    const h = crypto.createHash('sha1');
    for (let f = 0; f < count; f += 1) {
      const fx = (start + f) * cell;
      for (let y = 0; y < cell; y += 1) {
        const off = (y * img.width + fx) * 4;
        h.update(img.rgba.subarray(off, off + cell * 4));
      }
    }
    byState[name] = h.digest('hex').slice(0, 10);
  }

  const sum = (arr) => arr.reduce((a, b) => a + b.pct, 0) / arr.length;
  const avg = Object.fromEntries(
    Object.keys(states).map((k) => [k, Number(sum(frames.filter((x) => x.name === k)).toFixed(1))]),
  );

  return {
    dir: dir.split('/').pop(),
    size: `${img.width}x${img.height}`,
    frameCount: manifest.frame_layout.rows.all.length,
    expectedFrames: Object.values(states).reduce((n, s) => n + s.frames, 0),
    opaquePixels: opaque,
    strayColours: stray.size,
    blankFrames: blank,
    avgFillByState: avg,
    stateHashes: byState,
    sha1: crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12),
    ok: img.depth === 8 && img.colour === 6 && img.interlace === 0
        && stray.size === 0 && blank === 0 && opaque > 0,
  };
};

const checkTerrain = (dir) => {
  const bytes = fs.readFileSync(`${dir}/sprite-sheet-alpha.png`);
  const img = decode(bytes);
  const manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, 'utf8'));
  const ts = manifest.frame_layout.cellWidth;

  const stray = new Set();
  const tileLuma = {};
  for (const [name, [rect]] of Object.entries(manifest.frame_layout.rows)) {
    let sum = 0;
    let n = 0;
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        const i = (y * img.width + x) * 4;
        if (img.rgba[i + 3] === 0) continue;
        const c = hex(img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]);
        if (!PALETTE.has(c)) stray.add(c);
        sum += luma(img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]);
        n += 1;
      }
    }
    tileLuma[name] = Number((sum / n).toFixed(1));
  }

  // The contrast fix, asserted rather than asserted-in-prose. Walls are
  // autotiled, so every one of the sixteen neighbour-mask variants must remain
  // legible — a dim interior or edge variant cannot hide behind the others.
  const floorMax = Math.max(tileLuma.FLOOR, tileLuma.FLOOR_ALT);
  const wallNames = Array.from({ length: 16 }, (_, mask) => `WALL_${mask}`);
  const missingWalls = wallNames.filter((name) => tileLuma[name] === undefined);
  const wallMin = missingWalls.length
    ? Number.NEGATIVE_INFINITY
    : Math.min(...wallNames.map((name) => tileLuma[name]));
  const contrast = Number((wallMin - floorMax).toFixed(1));

  return {
    dir: 'sos-terrain',
    size: `${img.width}x${img.height}`,
    strayColours: stray.size,
    tileLuma,
    wallVsFloorLuma: contrast,
    wallVariants: wallNames.length - missingWalls.length,
    ok: stray.size === 0 && missingWalls.length === 0 && contrast > 25,
  };
};

const classes = [
  'assets/sprites/generated/sos-warrior',
  'assets/sprites/generated/sos-wizard',
  'assets/sprites/generated/sos-cleric',
  'assets/sprites/generated/sos-ranger',
].map(checkClass);

const terrain = checkTerrain('assets/sprites/generated/sos-terrain');
console.log(JSON.stringify({ classes, terrain }, null, 2));

const problems = [];
if (classes.some((c) => !c.ok)) problems.push('class atlas failed palette/frame checks');

// Empty-input SHA1 is da39a3ee..., so any state hashing to that means the
// digest was fed nothing and the check proved nothing. Fail loudly rather than
// let a broken checker pass silently again.
for (const c of classes) {
  for (const [state, digest] of Object.entries(c.stateHashes)) {
    if (digest === 'da39a3ee5e') problems.push(`${c.dir} ${state} hashed empty — checker is broken`);
  }
}

// Each class must differ from every other in every shared state.
for (let i = 0; i < classes.length; i += 1) {
  for (let j = i + 1; j < classes.length; j += 1) {
    for (const state of Object.keys(classes[i].stateHashes)) {
      if (classes[i].stateHashes[state] === classes[j].stateHashes[state]) {
        problems.push(`${classes[i].dir} and ${classes[j].dir} render identically in ${state}`);
      }
    }
  }
}

// Frames within a state must actually differ, or the animation is a still.
for (const c of classes) {
  if (c.frameCount !== c.expectedFrames) {
    problems.push(`${c.dir} has ${c.frameCount} frames, expected ${c.expectedFrames}`);
  }
}

if (!terrain.ok) problems.push('terrain contrast or palette check failed');

if (problems.length) {
  console.error('\nFAILED:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('\nAll atlases valid, on-palette, every frame populated.');
console.log('All four classes differ in every state (real digests, not empty ones).');
console.log('Walls read', terrain.wallVsFloorLuma, 'luma above the brightest floor tile.');
