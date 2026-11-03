/**
 * Wall autotiling checks, run against the generated terrain sheet.
 *
 * Two things have to be true and neither is visible in a screenshot diff:
 *   1. A tile whose neighbour continues the wall must NOT carry that edge.
 *   2. The set of tiles covers all 16 masks, and each asks for its own slot.
 *
 * Usage: node scripts/verify-wall-autotile.mjs
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const decodePng = (buf) => {
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error('unsupported png');
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * bpp);
  let rp = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    for (let x = 0; x < stride; x += 1) {
      const cur = line[x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v;
      if (filter === 0) v = cur;
      else if (filter === 1) v = cur + a;
      else if (filter === 2) v = cur + b;
      else if (filter === 3) v = cur + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, data: out };
};

const SHEET = process.argv[2] ?? 'assets/sprites/generated/sos-terrain/sprite-sheet-alpha.png';
const CELL = 32;
const N_UP = 1, N_RIGHT = 2, N_DOWN = 4, N_LEFT = 8;

const { width, height, data } = decodePng(readFileSync(SHEET));
const tileIndex = (mask) => 2 + mask;
const px = (index, x, y) => {
  const i = (y * width + index * CELL + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const solid = (p) => p[3] >= 200;

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
};

check(
  'sheet holds 18 tiles (2 floor + 16 wall masks)',
  width === CELL * 18 && height === CELL,
  `${width}x${height}`,
);

// Edges are checked differentially: compare a tile against the same tile with
// one neighbour bit flipped. If an edge is drawn only where the wall stops, then
// setting the bit must remove it, every time, for every other combination.
//
// Comparing against a fixed luma or against the neighbouring column does not
// work on this art. The stone carries deliberate speckle, and the masonry is
// laid with staggered vertical joints -- x=0 is a joint in every even course --
// so an interior column is *not* the reference. Flipping one bit isolates
// exactly the edge being tested and nothing else.
const meanLine = (mask, axis, i) => {
  let sum = 0;
  for (let k = 0; k < CELL; k += 1) {
    sum += luma(px(tileIndex(mask), axis === 'row' ? k : i, axis === 'row' ? i : k));
  }
  return sum / CELL;
};
const rowMean = (mask, y) => meanLine(mask, 'row', y);
const colMean = (mask, x) => meanLine(mask, 'col', x);

// Each entry: [bit, edge reader, expected sign of the change when the bit is set]
const EDGES = [
  ['UP', N_UP, (m) => rowMean(m, 0), -1, 'removes the top lip'],
  ['LEFT', N_LEFT, (m) => colMean(m, 0), -1, 'removes the left bevel'],
  ['RIGHT', N_RIGHT, (m) => colMean(m, CELL - 1), +1, 'removes the right shadow'],
  ['DOWN', N_DOWN, (m) => rowMean(m, CELL - 1), +1, 'removes the base shadow'],
];

const edgeFaults = [];
let weakest = { delta: Infinity, label: '' };
for (let mask = 0; mask < 16; mask += 1) {
  for (const [name, bit, read, sign, what] of EDGES) {
    if (mask & bit) continue; // only compare unset -> set
    const delta = read(mask | bit) - read(mask);
    const margin = sign * delta;
    if (margin < 8) {
      edgeFaults.push(`m${mask} ${name}: ${what} changed luma by ${delta.toFixed(1)}`);
    } else if (margin < weakest.delta) {
      weakest = { delta: margin, label: `m${mask} ${name}` };
    }
  }
}
check(
  'every edge is drawn only where the wall stops',
  edgeFaults.length === 0,
  edgeFaults.length ? edgeFaults.slice(0, 6).join(' | ') : `64 flips; weakest margin ${weakest.delta.toFixed(0)} at ${weakest.label}`,
);

// Every mask must be a distinct tile. Quantised coarsely, masks collide because
// steelDark (74) and void (10) land in the same bucket — 16 buckets keeps them
// apart, which is the whole point of the assertion.
const sigs = new Map();
for (let mask = 0; mask < 16; mask += 1) {
  let s = '';
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const p = px(tileIndex(mask), x, y);
      s += p[3] === 0 ? '.' : Math.min(15, Math.floor(luma(p) / 17)).toString(16);
    }
  }
  sigs.set(mask, s);
}
let dupes = 0;
for (const [a, sa] of sigs) {
  for (const [b, sb] of sigs) {
    if (a < b && sa === sb) { dupes += 1; console.log(`  mask ${a} and ${b} are identical`); }
  }
}
check('all 16 masks render distinctly', dupes === 0, `${dupes} duplicate pair(s)`);

// A 2x2 block. Its top-left tile has walls to the right and below, so it keeps
// the outer top lip and left bevel while suppressing the two inner seams -- and
// those inner seams are exactly what used to make a block read as four tiles.
const TOP_LEFT = N_RIGHT | N_DOWN;
const lipHere = rowMean(TOP_LEFT, 0) - rowMean(TOP_LEFT, 1);
const bevelHere = colMean(TOP_LEFT, 0) - colMean(TOP_LEFT, 1);
check('2x2 top-left keeps its outer lip', lipHere >= 40, lipHere.toFixed(0));
check('2x2 top-left keeps its outer bevel', bevelHere >= 0, bevelHere.toFixed(0));

console.log(failures.length === 0 ? '\nALL PASS' : `\n${failures.length} FAILURE(S)`);
process.exit(failures.length === 0 ? 0 : 1);
