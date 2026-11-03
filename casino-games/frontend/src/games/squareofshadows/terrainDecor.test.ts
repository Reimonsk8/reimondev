import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TERRAIN_THEMES } from './terrainTheme';
import {
  ALTAR_DECORATION_COUNT,
  ALTAR_MONUMENT_COUNT,
  GROUND_DECORATION_COUNT,
  altarDecorationForCell,
  altarSpriteFor,
  wallDecorationForCell,
} from './terrainDecor';

describe('cosmetic ground decoration', () => {
  it('is sparse and deterministic for the same shared match and tile', () => {
    const picked: (number | null)[] = [];
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < 20; x += 1) {
        const decor = wallDecorationForCell('room-123', 987, x, y, 'dungeon');
        expect(decor).toBe(wallDecorationForCell('room-123', 987, x, y, 'dungeon'));
        picked.push(decor);
      }
    }
    const decorated = picked.filter((item) => item !== null);
    expect(decorated.length).toBeGreaterThan(0);
    expect(decorated.length).toBeLessThan(picked.length / 4);
    expect(decorated.every((item) => item! >= 0 && item! < GROUND_DECORATION_COUNT)).toBe(true);
  });

  it('leaves the classic arena completely bare', () => {
    // Decoration arrived with the procedural biomes. The classic arena is the
    // map players already know, so it stays bare — and this is the only place
    // that can be asserted directly, because the browser smoke can never play a
    // classic match: the board only renders once the map mode has locked, and
    // locking means the mode is already chosen.
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        for (const theme of TERRAIN_THEMES) {
          expect(wallDecorationForCell('room-1', 99, x, y, theme, 'CLASSIC')).toBeNull();
        }
      }
    }
  });

  it('still decorates a random arena', () => {
    const found = Array.from({ length: 400 }, (_, i) =>
      wallDecorationForCell('room-1', 99, i % 12, Math.floor(i / 12) % 10, 'dungeon', 'RANDOM'),
    ).filter((value): value is number => value !== null);
    expect(found.length).toBeGreaterThan(0);
  });

  it('selects assets only from the defined decal set in every biome', () => {
    for (const theme of TERRAIN_THEMES) {
      const found = Array.from({ length: 200 }, (_, i) =>
        wallDecorationForCell('shared-match', 31, i % 20, Math.floor(i / 20), theme),
      ).filter((index): index is number => index !== null);
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((index) => index >= 0 && index < GROUND_DECORATION_COUNT)).toBe(true);
    }
  });

  it('actually differs from map to map, and is not a fixed dressing', () => {
    // The tests above only prove determinism and validity — both of which a
    // CONSTANT layout satisfies. If the hash collapsed to one value, decoration
    // would be identical on every map and every test would still be green.
    // This is the test that proves the feature does anything at all.
    const layout = (gameId: string, seed: number) =>
      Array.from({ length: 120 }, (_, i) => {
        const decor = wallDecorationForCell(gameId, seed, i % 12, Math.floor(i / 12), 'dungeon');
        return decor === null ? '.' : String(decor);
      }).join('');

    const seen = new Set<string>();
    for (let seed = 1; seed <= 25; seed += 1) seen.add(layout(`local-${seed}`, seed * 7919));
    // Every map should be its own dressing, not a handful of repeats.
    expect(seen.size).toBe(25);

    // The seed alone must change the board: a new floor is a new dressing.
    expect(layout('room-1', 1)).not.toBe(layout('room-1', 2));
    // And the shared game id must change it, so two players on one online match
    // still agree while different matches do not collide.
    expect(layout('room-1', 5)).not.toBe(layout('room-2', 5));
  });
});

describe('altar decoration', () => {
  it('is sparse, deterministic, and always in altar range', () => {
    const picked: (number | null)[] = [];
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < 20; x += 1) {
        const altar = altarDecorationForCell('room-123', 987, x, y, 'RANDOM');
        expect(altar).toBe(altarDecorationForCell('room-123', 987, x, y, 'RANDOM'));
        picked.push(altar);
      }
    }
    const present = picked.filter((a): a is number => a !== null);
    expect(present.length).toBeGreaterThan(0);
    // Sparser than the decals' 12%: an altar is a monument, not a smear.
    expect(present.length).toBeLessThan(picked.length / 8);
    expect(present.every((a) => a >= 0 && a < ALTAR_DECORATION_COUNT)).toBe(true);
  });

  it('never touches the classic arena, exactly like the decal layer', () => {
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        expect(altarDecorationForCell('room-1', 99, x, y, 'CLASSIC')).toBeNull();
      }
    }
  });

  it('does not disturb the decal layer', () => {
    /*
     * The regression this guards is quiet and total: if the altar stream reused
     * the decal hash accumulator, every wall's rubble would move when the altar
     * set changed, and no test comparing one map to another would notice — the
     * decals would still be "valid", just the wrong ones.
     */
    expect(ALTAR_DECORATION_COUNT).not.toBe(GROUND_DECORATION_COUNT);
    const altarAt = (x: number, y: number) =>
      altarDecorationForCell('shared-match', 31, x, y, 'RANDOM');
    const decorAt = (x: number, y: number) =>
      wallDecorationForCell('shared-match', 31, x, y, 'dungeon', 'RANDOM');
    // An altar on a wall must not imply rubble on it, or vice versa.
    const both = Array.from({ length: 400 }, (_, i) => i).filter(
      (i) => altarAt(i % 20, Math.floor(i / 20)) !== null && decorAt(i % 20, Math.floor(i / 20)) !== null,
    );
    expect(both.length).toBeLessThan(60);
  });
});

describe('altar monuments', () => {
  const spriteDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../public/sprites/sos-altar-monuments',
  );

  it('ships every sprite the pool promises', () => {
    // The pool is a count and a URL pattern, so a missing file renders as an
    // empty tile with no error anywhere. Count the folder instead.
    const files = readdirSync(spriteDir).filter((name) => name.endsWith('.png'));
    expect(files).toHaveLength(ALTAR_MONUMENT_COUNT);
  });

  it('randomises across the whole pool, not just the first few', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i += 1) seen.add(altarSpriteFor(`game-${i}`, i));
    expect(seen.size).toBe(ALTAR_MONUMENT_COUNT);
  });

  it('gives a floor two altars two different monuments, every time', () => {
    for (let i = 0; i < 200; i += 1) {
      const first = altarSpriteFor(`game-${i}`, i, 0);
      const second = altarSpriteFor(`game-${i}`, i, 1);
      expect(second).not.toBe(first);
    }
  });

  it('is a pure function of the match, so both clients raise the same statue', () => {
    expect(altarSpriteFor('room-1', 77, 0)).toBe(altarSpriteFor('room-1', 77, 0));
    expect(altarSpriteFor('room-1', 77, 1)).toBe(altarSpriteFor('room-1', 77, 1));
  });
});
