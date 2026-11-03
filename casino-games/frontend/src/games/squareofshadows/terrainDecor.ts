import type { TerrainTheme } from './terrainTheme';
import type { MapMode } from './engine';

export const GROUND_DECORATION_COUNT = 10;

/**
 * The PixelLab altar set, 16 frames.
 *
 * Built by `scripts/build-altar-decor.py` into a 16-frame, 32px-per-frame sheet
 * — the same frame size as the decal sheet above, so the two are
 * interchangeable on screen and the renderer's `i / (count - 1)` offset needs no
 * second formula.
 */
export const ALTAR_DECORATION_COUNT = 16;

/**
 * The hand-drawn monuments an altar can be.
 *
 * Sixteen 64x64 sprites, each drawn across the altar's 2x2 tiles. Picked from
 * the match seed so both clients of an online run raise the same monument — the
 * same reason the floor is seeded instead of rolled at render time.
 *
 * The `siteIndex` walks the pool from the first pick, which is what keeps an
 * Adventure floor's two altars from being the same statue twice.
 */
export const ALTAR_MONUMENT_COUNT = 16;

const monumentSprite = (index: number): string =>
  publicAsset(`/sprites/sos-altar-monuments/altar-${String((index % ALTAR_MONUMENT_COUNT) + 1).padStart(2, '0')}.png`);

export const altarSpriteFor = (gameId: string, mapSeed: number, siteIndex = 0): string => {
  let hash = 0x2545f491;
  for (let i = 0; i < gameId.length; i += 1) {
    hash = Math.imul(hash ^ gameId.charCodeAt(i), 0x01000193) >>> 0;
  }
  hash = Math.imul(hash ^ mapSeed, 0x01000193) >>> 0;
  const first = hash % ALTAR_MONUMENT_COUNT;
  if (siteIndex === 0) return monumentSprite(first);
  // 1..15, so the next site can never land back on the first one.
  const step = 1 + ((hash >>> 8) % (ALTAR_MONUMENT_COUNT - 1));
  return monumentSprite(first + siteIndex * step);
};

/**
 * Altars dress the adventure floor's walls, sparser than decals, and as a
 * SEPARATE layer rather than a replacement.
 *
 * Replacing was the obvious move and the wrong one: `RANDOM` is the only mode
 * that decorates at all (`isAdventureState` is literally `mapMode === 'RANDOM'`,
 * and `CLASSIC` returns null above), so swapping the pool for altars would have
 * deleted the entire decal sheet from the game. These stand alongside the
 * rubble instead.
 *
 * A decal is a smear of stone and a dozen of them read as texture. An altar is a
 * monument, and a dozen of them reads as a room full of furniture with no room
 * to fight in — hence half the rate.
 */
const ALTAR_RATE = 6;

/**
 * A sparse, deterministic altar index for a wall cell on the adventure floor.
 *
 * Returns `null` on the classic arena, exactly like `wallDecorationForCell` does,
 * and draws from a SEPARATE hash accumulator so that adding altars does not
 * renumber the existing decals. Hashing the same inputs again into a different
 * accumulator is what keeps the two layers uncorrelated: a wall carrying an
 * altar is not thereby more likely to carry rubble, and neither layer can drift
 * when the other is retuned.
 */
export const altarDecorationForCell = (
  gameId: string,
  mapSeed: number,
  x: number,
  y: number,
  mapMode: MapMode = 'RANDOM',
): number | null => {
  if (mapMode === 'CLASSIC') return null;
  // A different FNV offset from the one below, so the two streams diverge from
  // the very first character instead of only at the end.
  let hash = 0x1b873593;
  for (let i = 0; i < gameId.length; i += 1) {
    hash = Math.imul(hash ^ gameId.charCodeAt(i), 0x01000193) >>> 0;
  }
  for (const value of [mapSeed, x, y]) hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  if (hash % 100 >= ALTAR_RATE) return null;
  return (hash >>> 8) % ALTAR_DECORATION_COUNT;
};

const THEME_POOLS: Record<TerrainTheme, number[]> = {
  dungeon: [0, 1, 2, 3, 5, 6, 7, 8],
  grass: [0, 2, 4, 5, 6, 9],
  'holy-temple': [1, 3, 4, 6, 7, 8, 9],
  'shadow-realm': [0, 1, 3, 5, 7, 8],
  inferno: [0, 2, 4, 5, 7, 9],
};

/**
 * Sparse per-cell dressing on WALLS, reproducible on both clients from shared
 * match data.
 *
 * Decoration used to scatter across the open floor. It now dresses stone only:
 * clutter on walkable ground read as an obstacle that was not there and made the
 * legal-tile overlays harder to read, while on a wall it reads as growth,
 * staining or masonry detail — something the tile was already opaque enough to
 * carry.
 */
export const wallDecorationForCell = (
  gameId: string,
  mapSeed: number,
  x: number,
  y: number,
  theme: TerrainTheme,
  mapMode: MapMode = 'RANDOM',
): number | null => {
  // The classic arena is the untouched original: its walls, its purple art, and
  // bare stone. Decoration came with the procedural biomes, so scattering decals
  // across the arena players already know would change the map they learned.
  if (mapMode === 'CLASSIC') return null;
  let hash = 0x811c9dc5;
  for (let i = 0; i < gameId.length; i += 1) {
    hash = Math.imul(hash ^ gameId.charCodeAt(i), 0x01000193) >>> 0;
  }
  for (const value of [mapSeed, x, y]) hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  if (hash % 100 >= 12) return null;
  const pool = THEME_POOLS[theme];
  return pool[(hash >>> 8) % pool.length];
};
import { publicAsset } from '../../utils/publicAsset';
