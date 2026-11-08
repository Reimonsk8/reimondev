import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

/**
 * Contract tests for the generated Square of Shadows art.
 *
 * These exist because the generator and the renderer are two files in two
 * languages that agree only by convention: the sheet is a row of N frames in a
 * specific state order, and the CSS addresses frames by index. If the generator
 * reorders states or changes a frame count, the renderer silently animates the
 * wrong slice — no error, no blank sprite, just wrong art. The only thing that
 * catches it is asserting the agreement here.
 */

const ROOT = 'assets/sprites/generated';
const SPRITE_TOTAL = 27;

/**
 * Must match SPRITE_TOTAL / SPRITE_STATE_OFFSET in SquareOfShadows.tsx and
 * `STATES` in scripts/sprite-gen/sos-pixel-art.mjs.
 */
const STATE_OFFSET = {
  idle: { start: 0, frames: 4 },
  attack: { start: 4, frames: 6 },
  cast: { start: 10, frames: 6 },
  death: { start: 16, frames: 7 },
  walk: { start: 23, frames: 4 },
} as const;

const PALETTE = new Set([
  '#050308', '#0d0a14', '#1a1030', '#2e1f4a', '#3a3a4a', '#646476', '#9898ac', '#d8d0c0',
  '#1a2a1a', '#2a4a20', '#4a7a30', '#5a0a0a', '#8b1a1a', '#cc2222', '#4a1a6a', '#7a3ab0',
]);

const CLASSES = [
  'warrior', 'wizard', 'cleric', 'ranger',
  'templar', 'confessor', 'martyr', 'penitent',
] as const;

/** Minimal RGBA PNG decoder — enough to read back what the generator wrote. */
const decode = (buf: Buffer) => {
  let off = 8;
  let ihdr: { width: number; height: number; depth: number; colour: number } | null = null;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colour: data[9],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('no IHDR');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * 4;
  const out = Buffer.alloc(ihdr.height * stride);
  let pos = 0;
  for (let y = 0; y < ihdr.height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    for (let x = 0; x < stride; x += 1) {
      const b = raw[pos + x];
      const left = x >= 4 ? out[y * stride + x - 4] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const ul = y > 0 && x >= 4 ? out[(y - 1) * stride + x - 4] : 0;
      let v: number;
      switch (filter) {
        case 0: v = b; break;
        case 1: v = b + left; break;
        case 2: v = b + up; break;
        case 3: v = b + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - ul;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - ul);
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

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('generated Square of Shadows art', () => {
  describe.each(CLASSES)('sos-%s', (cls) => {
    const sheet = decode(readFileSync(`${ROOT}/sos-${cls}/sprite-sheet-alpha.png`));
    const manifest = JSON.parse(
      readFileSync(`${ROOT}/sos-${cls}/manifest.json`, 'utf8'),
    ) as {
      frame_layout: { cellWidth: number; rows: Record<string, unknown[]> };
      states: Record<string, { start: number; frames: number }>;
    };
    // Cell size is per-sheet now: procedural art is 32px, PixelLab sheets are
    // 272px (68px frames ×4 nearest-neighbour). The contract that must hold is
    // the frame *layout*, never the pixel size.
    const CELL = manifest.frame_layout.cellWidth;

    /** Digest of one state's frames, walked with the real row stride. */
    const stateHash = (state: keyof typeof STATE_OFFSET) => {
      const { start, frames } = manifest.states[state];
      const h = createHash('sha1');
      for (let f = 0; f < frames; f += 1) {
        const fx = (start + f) * CELL;
        for (let y = 0; y < CELL; y += 1) {
          const off = (y * sheet.width + fx) * 4;
          h.update(sheet.rgba.subarray(off, off + CELL * 4));
        }
      }
      return h.digest('hex');
    };

    it('is a valid RGBA PNG at the expected sheet size', () => {
      expect(sheet.depth).toBe(8);
      expect(sheet.colour).toBe(6);
      expect(sheet.height).toBe(CELL);
      expect(sheet.width).toBe(CELL * SPRITE_TOTAL);
    });

    it('publishes the state layout the renderer hard-codes', () => {
      // This is the drift guard. Generator and CSS/TS agree only by convention,
      // and a silent mismatch animates the wrong frames rather than erroring.
      expect(manifest.states).toEqual(STATE_OFFSET);
      expect(manifest.frame_layout.cellWidth).toBeGreaterThan(0);
      expect(manifest.frame_layout.rows.all).toHaveLength(SPRITE_TOTAL);
    });

    it('keeps the sheet exactly one row of square frames', () => {
      expect(sheet.width).toBe(manifest.frame_layout.cellWidth * SPRITE_TOTAL);
      expect(sheet.height).toBe(manifest.frame_layout.cellWidth);
    });

    // NOTE: the 16-colour palette lock applies only to the procedurally drawn
    // terrain (asserted in the sos-terrain block below). PixelLab sheets are
    // freely coloured by the model; what must hold for them is the *layout*
    // contract, not the palette.

    it('has content in every single frame', () => {
      // Guards against a state baking as blank and "animating" through nothing.
      for (const { start, frames } of Object.values(manifest.states)) {
        for (let f = 0; f < frames; f += 1) {
          const fx = (start + f) * CELL;
          let filled = 0;
          for (let y = 0; y < CELL; y += 1) {
            for (let x = 0; x < CELL; x += 1) {
              if (sheet.rgba[(y * sheet.width + fx + x) * 4 + 3] > 0) filled += 1;
            }
          }
          expect(filled).toBeGreaterThan(0);
        }
      }
    });

    it('actually animates: frames within a state are not all identical', () => {
      for (const state of ['attack', 'cast', 'death'] as const) {
        const { start, frames } = manifest.states[state];
        const digests = new Set<string>();
        for (let f = 0; f < frames; f += 1) {
          const h = createHash('sha1');
          const fx = (start + f) * CELL;
          for (let y = 0; y < CELL; y += 1) {
            const off = (y * sheet.width + fx) * 4;
            h.update(sheet.rgba.subarray(off, off + CELL * 4));
          }
          digests.add(h.digest('hex'));
        }
        expect(digests.size).toBeGreaterThan(1);
      }
    });

    // The old "fades across the death frames" test asserted a procedural-only
    // trick (alpha ramp). PixelLab's falling-back-death template instead ends
    // lying on the ground at full alpha; frame-differs-from-frame is already
    // covered by the 'actually animates' test for the death state.

    it('exposes a stable per-state digest for regression diffing', () => {
      for (const state of Object.keys(STATE_OFFSET)) {
        // Non-empty by construction; asserted rather than returned so a broken
        // digest (e.g. hashing zero bytes) fails the suite instead of passing.
        expect(stateHash(state as keyof typeof STATE_OFFSET)).toMatch(/^[0-9a-f]{40}$/);
      }
    });
  });

  describe('class differentiation', () => {
    it('gives every class a different silhouette in every state', () => {
      // Keep this in lockstep with the renderer's state contract. Adding a
      // state (such as walk) must extend the cross-class check automatically.
      const states = Object.keys(STATE_OFFSET) as Array<keyof typeof STATE_OFFSET>;
      const digests = Object.fromEntries(states.map((state) => [state, new Set<string>()])) as
        Record<keyof typeof STATE_OFFSET, Set<string>>;
      for (const cls of CLASSES) {
        const sheet = decode(readFileSync(`${ROOT}/sos-${cls}/sprite-sheet-alpha.png`));
        const manifest = JSON.parse(readFileSync(`${ROOT}/sos-${cls}/manifest.json`, 'utf8'));
        const cell = manifest.frame_layout.cellWidth;
        for (const state of states) {
          const { start, frames } = manifest.states[state];
          const h = createHash('sha1');
          for (let f = 0; f < frames; f += 1) {
            const fx = (start + f) * cell;
            for (let y = 0; y < cell; y += 1) {
              const off = (y * sheet.width + fx) * 4;
              h.update(sheet.rgba.subarray(off, off + cell * 4));
            }
          }
          digests[state].add(h.digest('hex'));
        }
      }
      for (const [state, set] of Object.entries(digests)) {
        expect(set.size, `${state} must differ across classes`).toBe(CLASSES.length);
      }
    });
  });

  describe('sos-terrain', () => {
    const sheet = decode(readFileSync(`${ROOT}/sos-terrain/sprite-sheet-alpha.png`));
    const manifest = JSON.parse(readFileSync(`${ROOT}/sos-terrain/manifest.json`, 'utf8'));

    // Walls are autotiled: one tile per 4-bit neighbour mask, named WALL_<mask>
    // with the same bit order as the generator and the renderer
    // (up 1, right 2, down 4, left 8). Tile WALL_15 has all four neighbours and
    // is therefore plain stone with no edges at all; WALL_0 is a lone block.
    const UP = 1, RIGHT = 2, DOWN = 4, LEFT = 8;
    const WALL = (mask: number) => `WALL_${mask}`;

    const tileLuma = (name: string, row?: number) => {
      const [rect] = manifest.frame_layout.rows[name];
      const y0 = row === undefined ? rect.y : rect.y + row;
      const y1 = row === undefined ? rect.y + rect.h : y0 + 1;
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = rect.x; x < rect.x + rect.w; x += 1) {
          const i = (y * sheet.width + x) * 4;
          if (sheet.rgba[i + 3] === 0) continue;
          sum += luma(sheet.rgba[i], sheet.rgba[i + 1], sheet.rgba[i + 2]);
          n += 1;
        }
      }
      return n ? sum / n : 0;
    };

    const worstWall = () =>
      Math.min(...Array.from({ length: 16 }, (_, mask) => tileLuma(WALL(mask))));

    it('reads walls clearly brighter than the floor', () => {
      // The original bug: indigo-on-indigo, so the board looked like an empty
      // grid. Asserted as a number so a future palette tweak cannot silently
      // collapse the contrast again. Checked against the *darkest* of the sixteen
      // wall tiles, so one dim variant cannot hide behind the rest.
      const brightestFloor = Math.max(tileLuma('FLOOR'), tileLuma('FLOOR_ALT'));
      expect(worstWall() - brightestFloor).toBeGreaterThan(25);
    });

    it('grounds each block with a dark base', () => {
      // The base shadow belongs on the tiles whose wall actually ends. Compare
      // the bottom row of a lone block against a block continuing downward: a
      // whole-tile mean would drown a one-row lip in the stone body.
      const baseEdge = tileLuma(WALL(0), 31);
      const continued = tileLuma(WALL(DOWN), 31);
      expect(baseEdge).toBeLessThan(continued);
      expect(baseEdge).toBeLessThan(tileLuma('FLOOR'));
    });

    it('lights the cap above the face so the silhouette reads', () => {
      expect(tileLuma(WALL(0))).toBeGreaterThan(tileLuma(WALL(UP)));
    });

    it('autotiles: a continued seam looks like the stone beside it', () => {
      // The bug this replaced: every cell carried its own cap and bevel, so a run
      // read as a row of separate stamps. Comparing a tile against the same tile
      // with one neighbour bit flipped isolates a single edge -- comparing against
      // an absolute luma cannot work here, because the masonry is laid with
      // staggered joints and carries deliberate speckle.
      const lumaOf = (mask: number, row?: number) => tileLuma(WALL(mask), row);
      // The base lip disappears when the wall continues below. The right-hand
      // shadow is a column, not a row, so it is asserted per-column below.
      expect(lumaOf(DOWN, 31)).toBeGreaterThan(lumaOf(0, 31));
      // The top lip and left bevel disappear when the wall continues above/left.
      expect(lumaOf(UP, 0)).toBeLessThan(lumaOf(0, 0));
      expect(lumaOf(LEFT)).toBeLessThan(lumaOf(0));
      // Right shadow: the rightmost column lightens where the wall continues.
      const rightCol = (mask: number) => {
        const [rect] = manifest.frame_layout.rows[WALL(mask)];
        let sum = 0;
        for (let y = rect.y + 1; y < rect.y + rect.h - 1; y += 1) {
          const i = (y * sheet.width + rect.x + rect.w - 1) * 4;
          sum += luma(sheet.rgba[i], sheet.rgba[i + 1], sheet.rgba[i + 2]);
        }
        return sum / (rect.h - 2);
      };
      expect(rightCol(RIGHT)).toBeGreaterThan(rightCol(0));
    });

    it('draws only from the dungeon palette', () => {
      const stray = new Set<string>();
      for (let i = 0; i < sheet.width * sheet.height; i += 1) {
        if (sheet.rgba[i * 4 + 3] === 0) continue;
        const hex = `#${[0, 1, 2]
          .map((k) => sheet.rgba[i * 4 + k].toString(16).padStart(2, '0'))
          .join('')}`;
        if (!PALETTE.has(hex)) stray.add(hex);
      }
      expect([...stray]).toEqual([]);
    });
  });

  describe.each(['grass', 'holy-temple', 'shadow-realm', 'inferno'])('sos-terrain-%s', (theme) => {
    const directory = `${ROOT}/sos-terrain-${theme}`;
    const sheet = decode(readFileSync(`${directory}/sprite-sheet-alpha.png`));
    const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'));
    const wang = JSON.parse(readFileSync(`${directory}/wang-tiles.json`, 'utf8'));

    it('contains all 16 corner patterns at the declared 32px atlas coordinates', () => {
      expect(sheet.width).toBe(128);
      expect(sheet.height).toBe(128);
      expect(wang.tiles).toHaveLength(16);
      const patterns = new Set<string>();
      for (const tile of wang.tiles) {
        const { row, col } = tile.atlas_position;
        const pattern = ['NW', 'NE', 'SE', 'SW']
          .reduce((bits: number, corner: string) => (bits << 1) | Number(tile.corners[corner] === 'upper'), 0);
        const name = `TILE_${row}_${col}`;
        patterns.add(String(pattern));
        expect(tile.atlas_index).toBe(pattern);
        expect(manifest.frame_layout.rows[name]).toEqual([{ x: col * 32, y: row * 32, w: 32, h: 32 }]);
      }
      expect(patterns.size).toBe(16);
    });
  });

  describe('sos-ground-decor', () => {
    const directory = `${ROOT}/sos-ground-decor`;
    const sheet = decode(readFileSync(`${directory}/sprite-sheet-alpha.png`));
    const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'));
    const names = [
      'BONE_RUBBLE', 'RELIQUARY', 'FALLEN_HELM', 'ROSE_GLASS', 'WAR_BANNER',
      'SWORD_ROSARY', 'WAR_PSALTER', 'CENSER', 'SAINT_HEAD', 'SUPPLY_CHEST',
    ];

    it('is a transparent ten-decal 32px atlas with matching manifest frames', () => {
      expect(sheet.width).toBe(320);
      expect(sheet.height).toBe(32);
      for (const [index, name] of names.entries()) {
        const [rect] = manifest.frame_layout.rows[name];
        expect(rect).toEqual({ x: index * 32, y: 0, w: 32, h: 32 });
        let opaque = 0;
        for (let y = 0; y < 32; y += 1) {
          for (let x = rect.x; x < rect.x + rect.w; x += 1) {
            if (sheet.rgba[(y * sheet.width + x) * 4 + 3] > 0) opaque += 1;
          }
        }
        expect(opaque).toBeGreaterThan(0);
        expect(opaque).toBeLessThan(32 * 32 * 0.9);
      }
    });
  });

  describe.each(['heal', 'guard'])('sos-pixellab/icon-%s', (icon) => {
    const source = `${ROOT}/sos-pixellab/icon-${icon}/sprite-sheet-alpha.png`;
    const sheet = decode(readFileSync(source));

    it('is a visible 32px transparent PixelLab action icon', () => {
      expect(sheet.width).toBe(32);
      expect(sheet.height).toBe(32);
      const alpha = Array.from({ length: sheet.width * sheet.height }, (_, i) => sheet.rgba[i * 4 + 3]);
      expect(alpha.some((value) => value > 0)).toBe(true);
      expect(alpha.some((value) => value === 0)).toBe(true);
      expect(readFileSync(source)).toEqual(
        readFileSync(`frontend/public/sprites/sos-pixellab/icon-${icon}/sprite-sheet-alpha.png`),
      );
    });
  });

  describe.each(['sanctified-ground', 'shield-slam'])('sos-pixellab/effects/%s', (effect) => {
    const source = `${ROOT}/sos-pixellab/effects/${effect}`;
    const gif = readFileSync(`${source}/animation.preview.gif`);

    it('keeps the animated PixelLab preview in sync with the runtime asset', () => {
      expect(gif.subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/);
      expect(gif.length).toBeGreaterThan(1000);
      expect(gif).toEqual(
        readFileSync(`frontend/public/sprites/sos-pixellab/effects/${effect}/animation.preview.gif`),
      );
    });
  });

  describe('Adventure concept art', () => {
    const directory = 'assets/sprites/concepts/sos-adventure';
    const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'));

    it('keeps future-mode concepts separate from runtime assets', () => {
      expect(manifest.status).toContain('not implemented');
      expect(manifest.enemies).toHaveLength(3);
      expect(manifest.items).toHaveLength(4);
      expect(manifest.props).toHaveLength(3);
      for (const { slug } of manifest.items) {
        const image = decode(readFileSync(`${directory}/items/${slug}.png`));
        expect([image.width, image.height]).toEqual([32, 32]);
      }
      for (const { slug } of manifest.props) {
        const image = decode(readFileSync(`${directory}/landmarks/${slug}.png`));
        expect([image.width, image.height]).toEqual([48, 48]);
      }
    });

    for (const { name } of manifest.enemies) {
      it(`has four static facings for ${name}`, () => {
        for (const direction of ['south', 'east', 'north', 'west']) {
          const sprite = decode(readFileSync(`${directory}/enemies/${name}/${direction}.png`));
          expect([sprite.width, sprite.height]).toEqual([92, 92]);
        }
      });
    }
  });
});
