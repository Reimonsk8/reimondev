import { describe, expect, it } from 'vitest';
import {
  FLOOR_TONES,
  FLOOR_WEARS,
  RANDOM_THEMES,
  floorToneFor,
  floorToneIndexFor,
  floorWearFor,
  floorWearIndexFor,
  terrainAtlasName,
  terrainThemeForGame,
  wangTileIndexFor,
} from './terrainTheme';

describe('SoS terrain themes', () => {
  it('keeps a match theme stable for the same shared game id', () => {
    expect(terrainThemeForGame('room-123')).toBe(terrainThemeForGame('room-123'));
  });

  it('always uses the original art for the classic arena', () => {
    // Classic has to mean the whole original look, not just its wall layout.
    for (let id = 0; id < 50; id += 1) {
      expect(terrainThemeForGame(`match-${id}`, 'CLASSIC')).toBe('dungeon');
    }
  });

  it('selects only known themes and makes every biome reachable in random mode', () => {
    const selected = new Set(
      Array.from({ length: 1000 }, (_, id) => terrainThemeForGame(`match-${id}`, 'RANDOM')),
    );
    expect([...selected].sort()).toEqual([...RANDOM_THEMES].sort());
  });

  it('never picks the classic art for a random match', () => {
    // Otherwise "Random" would sometimes be indistinguishable from "Classic".
    const selected = new Set(
      Array.from({ length: 1000 }, (_, id) => terrainThemeForGame(`match-${id}`, 'RANDOM')),
    );
    expect(selected.has('dungeon')).toBe(false);
  });

  it('keeps the current dungeon atlas as the existing default asset', () => {
    expect(terrainAtlasName('dungeon')).toBe('sos-terrain');
  });

  it('draws a wall as solid stone and never as raised ground', () => {
    // The bug this pins: biome atlases are corner-elevation (Wang) sets, so the
    // old renderer handed a wall a partial-elevation tile whose flat corners
    // read as a step you could climb. There is no jump mechanic, so a raised
    // corner on a tile the engine blocks is the art lying about the rules.
    const lone = new Map([['0,0', 'WALL']]);
    expect(wangTileIndexFor(lone, 0, 0)).toBe(15);

    // Any wall is fully raised, whatever its neighbours — no partial silhouette.
    for (let x = 0; x < 4; x += 1) {
      for (let y = 0; y < 4; y += 1) {
        expect(wangTileIndexFor(lone, x, y)).toBe(x === 0 && y === 0 ? 15 : 0);
      }
    }
  });

  it('draws every non-wall tile flat, so floor is never mistaken for a ledge', () => {
    const terrain = new Map([
      ['0,0', 'WALL'], ['1,0', 'WALL'], ['0,1', 'WALL'],
    ]);
    // Diagonal neighbour of a wall cluster: the old corner scheme raised a
    // vertex here and painted a ledge on walkable ground.
    expect(wangTileIndexFor(terrain, 1, 1)).toBe(0);
    expect(wangTileIndexFor(terrain, 2, 2)).toBe(0);
  });

  it('uses only the two honest tiles, never a partial-elevation one', () => {
    // 1..14 all describe partial elevation, i.e. "you may step up here". If this
    // ever fails, something started drawing terraces again.
    const terrain = new Map([
      ['1,1', 'WALL'], ['2,1', 'WALL'], ['1,2', 'WALL'],
      ['3,2', 'WALL'], ['2,3', 'WALL'],
    ]);
    const used = new Set<number>();
    for (let x = 0; x < 6; x += 1) {
      for (let y = 0; y < 6; y += 1) used.add(wangTileIndexFor(terrain, x, y));
    }
    expect([...used].sort()).toEqual([0, 15]);
  });

  it('varies the floor deterministically from tile coordinates and the map seed', () => {
    // The floor used to repeat one frame everywhere. Both clients have the same
    // map seed, so the same tile must always resolve to the same variation.
    for (let x = 0; x < 20; x += 1) {
      for (let y = 0; y < 20; y += 1) {
        expect(floorToneIndexFor(x, y, 7)).toBe(floorToneIndexFor(x, y, 7));
        expect(floorWearIndexFor(x, y, 7)).toBe(floorWearIndexFor(x, y, 7));
      }
    }

    const tones = new Set(Array.from({ length: 120 }, (_, i) =>
      floorToneIndexFor(i % 12, Math.floor(i / 12), 7),
    ));
    const wears = new Set(Array.from({ length: 120 }, (_, i) =>
      floorWearIndexFor(i % 12, Math.floor(i / 12), 7),
    ));
    // A constant (or a one-value hash) would still be deterministic; require
    // real variety in both streams.
    expect(tones.size).toBeGreaterThan(1);
    expect(wears.size).toBeGreaterThan(1);

    for (const value of tones) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(FLOOR_TONES.length);
    }
    for (const value of wears) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(FLOOR_WEARS.length);
    }
    expect(floorToneFor(3, 4, 7)).toBe(FLOOR_TONES[floorToneIndexFor(3, 4, 7)]);
    expect(floorWearFor(3, 4, 7)).toBe(FLOOR_WEARS[floorWearIndexFor(3, 4, 7)]);
  });

  it('keeps floor variation local to a map seed', () => {
    // The tone hash includes the seed, so two matches do not start with the
    // identical slab pattern. Wear follows the same rule.
    const signature = (seed: number) =>
      Array.from({ length: 30 }, (_, i) =>
        `${floorToneIndexFor(i % 6, Math.floor(i / 6), seed)}:${floorWearIndexFor(i % 6, Math.floor(i / 6), seed)}`,
      ).join('|');
    expect(signature(1)).not.toBe(signature(2));
  });
});
