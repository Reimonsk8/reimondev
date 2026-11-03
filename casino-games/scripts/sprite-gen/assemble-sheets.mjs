/**
 * Assemble contract sprite sheets from PixelLab character spritesheets.
 *
 * For each class: downloads the character's spritesheet ZIP (free — status
 * export, not a generation), picks the five state rows (idle/attack/cast/
 * death/walk) by animation name, nearest-neighbour upscales every 68px frame
 * ×4 to 272px (the largest LOSSLESS integer scale; 256 exactly would need a
 * non-integer resize that breaks the pixel grid), lays them out as one
 * 27-frame row, and writes assets/sprites/generated/sos-<id>/ in the same
 * contract shape the procedural generator produced:
 *
 *   sprite-sheet-alpha.png  (27 × 272 wide, real alpha)
 *   manifest.json           states {start,frames} + frame_layout rects
 *
 * Frame order and counts are fixed by engine/art.test.ts STATE_OFFSET:
 *   idle 0-3, attack 4-9, cast 10-15, death 16-22, walk 23-26  (= SPRITE_TOTAL 27)
 *
 * Usage:
 *   node scripts/sprite-gen/assemble-sheets.mjs            # all classes
 *   node scripts/sprite-gen/assemble-sheets.mjs warrior    # one class
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, deflateSync } from 'node:zlib';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE_FILE = join(ROOT, 'assets', 'sprites', 'generated', 'sos-pixellab', 'state.json');
const API = 'https://api.pixellab.ai/v2';
const SCALE = 4; // 68px cell → 272px. Largest integer upscale; keep pixel grid intact.

/** State contract — keep in step with STATE_OFFSET in engine/art.test.ts. */
const STATES = [
  { id: 'idle', frames: 4, match: /^breathing idle$/ },
  { id: 'attack', frames: 6, match: /cross.?punch/i },
  { id: 'cast', frames: 6, match: /fire.?ball/i },
  { id: 'death', frames: 7, match: /falling.?backward|death/i },
  { id: 'walk', frames: 4, match: /^walk|^walking/i },
];

function apiKey() {
  if (process.env.PIXELLAB_API_KEY) return process.env.PIXELLAB_API_KEY;
  const env = join(ROOT, '.env');
  if (existsSync(env)) {
    for (const line of readFileSync(env, 'utf8').split('\n')) {
      const m = line.match(/^\s*PIXELLAB_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  }
  throw new Error('PIXELLAB_API_KEY not set');
}

async function get(path) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${apiKey()}` } });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── minimal ZIP reader (stored + deflate) ────────────────────────────────────
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no EOCD in zip');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out[name] = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ── minimal PNG decode (RGBA8 only) / encode (filter 0) ──────────────────────
function decodePng(buf) {
  let off = 8, ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], colour: data[9] };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr || ihdr.depth !== 8 || ihdr.colour !== 6) throw new Error('expected RGBA8 png');
  const raw = inflateSyncCat(idat);
  const stride = ihdr.w * 4;
  const out = Buffer.alloc(ihdr.h * stride);
  let pos = 0;
  for (let y = 0; y < ihdr.h; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const b = raw[pos + x];
      const left = x >= 4 ? out[y * stride + x - 4] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const ul = y > 0 && x >= 4 ? out[(y - 1) * stride + x - 4] : 0;
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
        default: throw new Error(`bad png filter ${filter}`);
      }
      out[y * stride + x] = v & 0xff;
    }
    pos += stride;
  }
  return { ...ihdr, rgba: out };
}

// zlib inflate for concatenated IDAT chunks (sync, from raw deflate stream)
import { inflateSync } from 'node:zlib';
const inflateSyncCat = (chunks) => inflateSync(Buffer.concat(chunks));

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA8
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Nearest-neighbour upscale of one cell. */
function upscale(src, sw, cell, scale) {
  const out = Buffer.alloc(cell * scale * cell * scale * 4);
  const dw = cell * scale;
  for (let y = 0; y < dw; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < dw; x++) {
      const sx = Math.floor(x / scale);
      const si = (sy * sw + sx) * 4;
      const di = (y * dw + x) * 4;
      src.copy(out, di, si, si + 4);
    }
  }
  return out;
}

// ── assembly ─────────────────────────────────────────────────────────────────
const CLASSES = ['warrior', 'wizard', 'cleric', 'ranger', 'templar', 'confessor', 'martyr', 'penitent'];

function selfCheck() {
  const source = Buffer.from([
    1, 2, 3, 255, 4, 5, 6, 255,
    7, 8, 9, 255, 10, 11, 12, 255,
  ]);
  const scaled = upscale(source, 2, 2, 2);
  assert.equal(scaled.length, 4 * 4 * 4);
  const pixelAt = (x, y) => [...scaled.subarray((y * 4 + x) * 4, (y * 4 + x + 1) * 4)];
  assert.deepEqual(pixelAt(0, 0), [1, 2, 3, 255]);
  assert.deepEqual(pixelAt(1, 1), [1, 2, 3, 255]);
  assert.deepEqual(pixelAt(2, 2), [10, 11, 12, 255]);
  const png = encodePng(4, 4, scaled);
  const decoded = decodePng(png);
  assert.equal(decoded.w, 4);
  assert.equal(decoded.h, 4);
  assert.deepEqual(decoded.rgba, scaled);
  const fallback = selectAnimationRows([
    { type: 'animation', animation: 'breathing idle', frame_count: 4, row: 0 },
  ]);
  assert.deepEqual(fallback.fallbackStates, ['attack', 'cast', 'death', 'walk']);
  assert.deepEqual(STATES.map((st) => fallback.chosen[st.id].frame_count), [4, 6, 6, 7, 4]);
  console.log('assembler self-check passed (nearest-neighbour + RGBA PNG round-trip)');
}

function selectAnimationRows(rows) {
  const chosen = {};
  for (const st of STATES) {
    const exact = rows.find((r) => st.match.source.startsWith('^') && st.match.test(r.animation));
    chosen[st.id] = exact ?? rows.find((r) => st.match.test(r.animation));
  }
  const fallbackStates = [];
  // Keep a character sheet usable if quota ends mid-animation set: repeat that
  // character's own idle frames rather than ship a short strip or borrow another
  // faction's art. State ranges still match the 27-frame engine contract.
  for (const st of STATES) {
    if (chosen[st.id]) {
      if (chosen[st.id].frame_count !== st.frames) {
        throw new Error(`${st.id}: expected ${st.frames} frames, got ${chosen[st.id].frame_count}`);
      }
    } else if (st.id !== 'idle' && chosen.idle?.frame_count === 4) {
      chosen[st.id] = {
        ...chosen.idle,
        frame_count: st.frames,
        source_frame_count: chosen.idle.frame_count,
        animation: `idle fallback for ${st.id}`,
      };
      fallbackStates.push(st.id);
    }
  }
  return {
    chosen,
    fallbackStates,
    missing: STATES.filter((st) => !chosen[st.id]).map((st) => st.id),
  };
}

async function assemble(cls) {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  const charId = state.characters[cls]?.character_id;
  if (!charId) {
    console.log(`${cls}: no character_id yet — run \`run classes\` first`);
    return false;
  }

  const zip = readZip(await get(`/characters/${charId}/spritesheet`));
  const jsonName = Object.keys(zip).find((n) => n.endsWith('.json'));
  const pngName = Object.keys(zip).find((n) => n.endsWith('.png'));
  const meta = JSON.parse(zip[jsonName].toString('utf8'));
  const sheet = decodePng(zip[pngName]);
  const { cell_size: cellSize, columns } = meta.spritesheet;

  // Pick one row per state. Exact-name matches win over prefix matches so the
  // three duplicate "breathing idle_N" rows don't fight over the idle slot.
  const { chosen, fallbackStates, missing } = selectAnimationRows(
    meta.spritesheet.rows.filter((r) => r.type === 'animation'),
  );
  if (missing.length) {
    console.log(`${cls}: MISSING states [${missing.join(', ')}] — their animations are still generating. Assembling the rest is pointless (contract needs all 27).`);
    return false;
  }

  const outCell = cellSize.width * SCALE; // 272
  const total = STATES.reduce((n, s) => n + s.frames, 0); // 27
  const rgba = Buffer.alloc(total * outCell * outCell * 4);
  const states = {};
  const rects = [];
  let cursor = 0;

  for (const st of STATES) {
    const row = chosen[st.id];
    states[st.id] = { start: cursor, frames: st.frames };
    for (let f = 0; f < st.frames; f++) {
      const sourceFrame = f % (row.source_frame_count ?? row.frame_count);
      const sx = sourceFrame * cellSize.width;
      const sy = row.row * cellSize.height;
      const cellRgba = Buffer.alloc(cellSize.width * cellSize.height * 4);
      for (let y = 0; y < cellSize.height; y++) {
        const srcOff = ((sy + y) * sheet.w + sx) * 4;
        sheet.rgba.copy(cellRgba, y * cellSize.width * 4, srcOff, srcOff + cellSize.width * 4);
      }
      const big = upscale(cellRgba, cellSize.width, cellSize.width, SCALE);
      const dx = cursor * outCell;
      for (let y = 0; y < outCell; y++) {
        big.copy(rgba, (y * total * outCell + dx) * 4, y * outCell * 4, (y + 1) * outCell * 4);
      }
      rects.push({ x: cursor * outCell, y: 0, w: outCell, h: outCell });
      cursor += 1;
    }
  }

  if (total !== 27) throw new Error(`${cls}: expected 27 frames, got ${total} — state rows drifted`);

  const dir = join(ROOT, 'assets', 'sprites', 'generated', `sos-${cls}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sprite-sheet-alpha.png'), encodePng(total * outCell, outCell, rgba));
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify(
      {
        game_input: 'sos',
        generator: 'pixellab spritesheet + local ×4 nearest-neighbour upscale',
        source_character_id: charId,
        ...(fallbackStates.length ? { fallback_states: fallbackStates } : {}),
        degraded_static_fallback: true,
        animation: { rows: { all: { row: 0, frames: total, fps: 12, loop: false } } },
        frame_layout: {
          rows: { all: rects },
          sheetWidth: total * outCell,
          sheetHeight: outCell,
          cellWidth: outCell,
          cellHeight: outCell,
        },
        states,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`${cls}: OK — ${total} frames @ ${outCell}px (${total * outCell}x${outCell}), states ${JSON.stringify(states)}`);
  return true;
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const classes = only.length ? only : CLASSES;
let ok = 0;
if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  for (const cls of classes) {
    try {
      if (await assemble(cls)) ok += 1;
    } catch (e) {
      console.log(`${cls}: FAILED — ${e.message}`);
    }
  }
  console.log(`\nassembled ${ok}/${classes.length}. Next: node scripts/copy-sprites.mjs && npm run test`);
}
