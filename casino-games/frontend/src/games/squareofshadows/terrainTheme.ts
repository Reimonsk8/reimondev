import type { MapMode } from './engine';

export const TERRAIN_THEMES = ['dungeon', 'grass', 'holy-temple', 'shadow-realm', 'inferno'] as const;
export type TerrainTheme = (typeof TERRAIN_THEMES)[number];

/**
 * The generated biomes — everything except the original `dungeon` art.
 *
 * `dungeon` is the classic arena's look, so it is deliberately absent here: the
 * Random option should offer the *new* biomes, and offering dungeon too would
 * make "Random" sometimes indistinguishable from "Classic".
 */
export const RANDOM_THEMES = TERRAIN_THEMES.filter((theme) => theme !== 'dungeon');

/**
 * Which atlas a match draws from.
 *
 * `CLASSIC` always resolves to `dungeon` — the original purple arena art. That
 * pairing is the point of the mode: choosing "classic" has to mean the whole
 * original look, not just its wall layout. Tying the biome to a per-match hash
 * here would silently repaint the classic arena in inferno while leaving the
 * classic geometry, which is neither option.
 *
 * `RANDOM` picks from the generated biomes by hashing the shared game id, so
 * both online players draw the same one. `dungeon` is excluded there: it is the
 * classic look, and "random" should mean one of the *new* biomes.
 */
export const terrainThemeForGame = (
  gameId: string,
  mapMode: MapMode = 'CLASSIC',
): TerrainTheme => {
  if (mapMode === 'CLASSIC') return 'dungeon';
  let hash = 0x811c9dc5;
  for (let i = 0; i < gameId.length; i += 1) {
    hash = Math.imul(hash ^ gameId.charCodeAt(i), 0x01000193) >>> 0;
  }
  return RANDOM_THEMES[hash % RANDOM_THEMES.length];
};

export const terrainAtlasName = (theme: TerrainTheme): string =>
  theme === 'dungeon' ? 'sos-terrain' : `sos-terrain-${theme}`;

/**
 * Tile index for a cell in a biome atlas.
 *
 * ## Why biome terrain draws only two tiles, not sixteen
 *
 * The biome sheets are *Wang* (corner-elevation) tilesets: every one of the 16
 * tiles says whether each of its four corners is raised or flat. Drawn as
 * authored they read as terraces — a wall became a raised block with a
 * walkable-looking top, so the board told the player "you can stand up here" on
 * a tile the engine refuses to enter. There is no jump mechanic, so that is a
 * lie the art tells, and it is worse than having no art: a player who believes
 * the terrace is standable will plan a route through it and lose the round to a
 * rule the board never meant to express.
 *
 * Only two of the sixteen are honest here:
 *
 *  - `0` — every corner flat. Open ground. Unambiguous.
 *  - `15` — every corner raised. A solid mass of stone.
 *
 * The fourteen in between all describe *partial* elevation, which is precisely
 * the "step up onto this" reading we are removing. So the renderer deliberately
 * uses only these two, and floor never borrows a raised corner and a wall never
 * shows a flat one.
 *
 * The trade-off is honest: an isolated wall no longer gets its own silhouette,
 * it draws the same solid stone as the interior of a wall cluster. That costs a
 * little visual variety and buys a board that cannot lie about what is passable.
 * Restoring per-wall shaping needs a *new* tileset authored as an edge-mask set
 * (the shape the `dungeon` atlas already uses, `WALL_<mask>`), not a Wang set.
 */
export const wangTileIndexFor = (terrain: ReadonlyMap<string, string>, x: number, y: number): number => {
  // A wall is solid stone; everything else is flat ground. `terrain` holds wall
  // tiles only, so a single membership test decides it.
  return terrain.has(`${x},${y}`) ? 15 : 0;
};

/**
 * Floor variation.
 *
 * The authored biome atlases contain exactly one honest open-ground frame (see
 * above), and the classic strip has two. Repeating those across twenty rows is
 * what made the floor read as a flat stamped grid. Rather than re-introducing
 * the dishonest terrace frames just to get more pixels, the renderer keeps the
 * honest tile and layers two cheap, deterministic variations over it:
 *
 *  - a tonal wash (`--tint`) so neighbouring slabs are not the same value, and
 *  - a transparent wear decal (`--floor-wear`) with a crack or a stain.
 *
 * Both are pure CSS layers above the terrain sheet and below the interaction
 * highlights, so a moved unit or an action range still reads over them. The
 * coordinates are hashed exactly as the board art expects: the caller only
 * needs `(x, y)` and the shared map seed, which both online clients already
 * have, so the two screens show the same floor.
 */
export const FLOOR_TONES = [
  'transparent',
  'rgba(3, 2, 8, 0.055)',
  'rgba(18, 13, 32, 0.07)',
  'rgba(54, 23, 18, 0.05)',
  'rgba(0, 0, 0, 0.09)',
] as const;

export const FLOOR_WEARS = [
  'none',
  'none',
  'none',
  'none',
  'linear-gradient(113deg, transparent 46.5%, rgba(0, 0, 0, 0.52) 47.4%, rgba(0, 0, 0, 0.52) 48.2%, transparent 49.2%)',
  'linear-gradient(64deg, transparent 57%, rgba(0, 0, 0, 0.42) 58%, transparent 60%)',
  'radial-gradient(ellipse 38% 24% at 34% 67%, rgba(84, 10, 14, 0.42), transparent 72%)',
  'linear-gradient(154deg, transparent 64%, rgba(255, 255, 255, 0.07) 65%, transparent 67%)',
] as const;

export const floorToneIndexFor = (x: number, y: number, seed = 0): number =>
  Math.abs(x * 31 + y * 17 + seed) % FLOOR_TONES.length;

export const floorWearIndexFor = (x: number, y: number, seed = 0): number =>
  // A different hash stream from the tone so a stained slab is not also
  // guaranteed to be the darkest one. `seed * 5` keeps the same map stable
  // while giving neighbouring matches visibly different wear.
  Math.abs(x * 13 + y * 29 + seed * 5) % FLOOR_WEARS.length;

export const floorToneFor = (x: number, y: number, seed = 0): string =>
  FLOOR_TONES[floorToneIndexFor(x, y, seed)];

export const floorWearFor = (x: number, y: number, seed = 0): string =>
  FLOOR_WEARS[floorWearIndexFor(x, y, seed)];
