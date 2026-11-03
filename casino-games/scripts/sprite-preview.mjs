/**
 * Decode a PNG (what this repo's generator emits: 8-bit RGBA, filter 0) and print
 * a frame as ASCII. Used to eyeball sprite changes without a browser.
 *
 * Usage: node sprite-preview.mjs <png> <frameIndex> [cell]
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const decodePng = (buf) => {
  let pos = 8; // skip signature
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
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`unsupported png: depth ${bitDepth} type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * bpp);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    for (let x = 0; x < stride; x++) {
      const cur = line[x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v;
      if (filter === 0) v = cur;
      else if (filter === 1) v = cur + a;
      else if (filter === 2) v = cur + b;
      else if (filter === 3) v = cur + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error('bad filter ' + filter);
      out[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, data: out };
};

const [file, frameArg, cellArg] = process.argv.slice(2);
const frame = Number(frameArg ?? 0);
const cell = Number(cellArg ?? 32);
const { width, height, data } = decodePng(readFileSync(file));
const ramp = ' .:-=+*#%@';

const stat = (f) => {
  let ink = 0, lumaSum = 0;
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const i = ((y) * width + (f * cell + x)) * 4;
      const a = data[i + 3];
      if (a <= 24) continue;
      ink++;
      lumaSum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
  }
  return { inkPct: +((ink / (cell * cell)) * 100).toFixed(1), meanLuma: ink ? +(lumaSum / ink).toFixed(1) : 0 };
};

let art = '';
for (let y = 0; y < cell; y++) {
  let row = '';
  for (let x = 0; x < cell; x++) {
    const i = (y * width + (frame * cell + x)) * 4;
    if (data[i + 3] <= 24) { row += ' '; continue; }
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    row += ramp[Math.min(9, Math.floor((l / 255) * 10))];
  }
  art += row + '\n';
}

console.log(`${file} ${width}x${height} frame ${frame} ${JSON.stringify(stat(frame))}`);
console.log(art);
