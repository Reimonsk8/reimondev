/**
 * Square of Shadows — the Altar of Shadows.
 *
 * A 2x2 monument. On the Arena it is the hand-authored central ruin block; in
 * Adventure the floor's generator writes two of them into the terrain at seeded
 * positions (`adventureAltarOrigins`). Either way the tiles ARE stone, so
 * "impassable" and "blocks line of sight" come from the map rather than from a
 * second rule that could drift — this module only has to recognise the blocks
 * back, and only reports one where all four tiles really are walls.
 *
 * Souls harvested from any death feed the altar, and a unit standing beside one
 * can spend one. Every altar on a floor shares that single soul count: they are
 * the same monument, in two places.
 */

import { ALTAR_SIZE, NEIGHBOUR_OFFSETS, SQUAD_ROSTER } from './constants';
import { chebyshev, isPassable, isWall, positionKey } from './board';
import { adventureAltarOrigins } from './maps';
import { deploymentTiles } from './state';
import type { GameState, PlayerClass, Position, Unit } from './types';

export { ALTAR_SIZE };

/** The four tiles of a 2x2 block at `origin`, row-major. */
const blockAt = (origin: Position): Position[] => {
  const tiles: Position[] = [];
  for (let dy = 0; dy < ALTAR_SIZE; dy += 1) {
    for (let dx = 0; dx < ALTAR_SIZE; dx += 1) {
      tiles.push({ x: origin.x + dx, y: origin.y + dy });
    }
  }
  return tiles;
};

/**
 * Every altar on the floor, as one tile list per monument, or null if there is
 * none. The Arena has one (its centre); Adventure has two, wherever the seed put
 * them.
 *
 * A site is only reported where all four of its tiles are stone. That is what
 * keeps this honest on boards that never got a monument — a test that passes an
 * explicit wall layout is not silently given altars — and it costs nothing in
 * play, because the generator put them in the terrain before the match started.
 */
export const altarSitesFor = (state: GameState): Position[][] | null => {
  const { width, height } = state.boardSize;
  if (width < ALTAR_SIZE * 2 || height < ALTAR_SIZE * 2) return null;

  const sites =
    (state.mapMode ?? 'CLASSIC') === 'CLASSIC'
      ? // Centred by `floor(size / 2) - 1`: on the 12x10 arena that is the ruin
        // block the map shipped with.
        [blockAt({ x: Math.floor(width / 2) - 1, y: Math.floor(height / 2) - 1 })]
      : adventureAltarOrigins(state.mapSeed ?? 0, state.boardSize).map(blockAt);

  const solid = sites.filter((tiles) =>
    tiles.every((tile) => state.terrain.get(positionKey(tile)) === 'WALL'),
  );
  return solid.length > 0 ? solid : null;
};

/** Every altar tile on the floor, flattened. */
export const altarTilesFor = (state: GameState): Position[] | null => {
  const sites = altarSitesFor(state);
  return sites ? sites.flat() : null;
};

/**
 * The altar tile a soul flies to: the nearest one, ties broken toward the top
 * left so both clients animate the same journey.
 */
export const soulTargetFor = (state: GameState, from: Position): Position | null => {
  const tiles = altarTilesFor(state);
  if (!tiles) return null;
  return tiles.reduce((best, tile) => {
    const here = chebyshev(from, tile);
    const there = chebyshev(from, best);
    if (here !== there) return here < there ? tile : best;
    if (tile.y !== best.y) return tile.y < best.y ? tile : best;
    return tile.x < best.x ? tile : best;
  });
};

/** True when a tile touches the altar — orthogonally or diagonally. */
export const besideAltar = (state: GameState, from: Position): boolean => {
  const tiles = altarTilesFor(state);
  return !!tiles && tiles.some((tile) => chebyshev(from, tile) === 1);
};

/**
 * The tile a unit was deployed on at the start of the round.
 *
 * Derived rather than stored: a unit id is `${owner}:${TYPE}`, the deployment
 * row follows from the owner's seat, and the class picks the slot — so the spawn
 * is reproducible from the state without a new field riding the wire on every
 * unit of every match.
 */
export const originalSpawnFor = (state: GameState, unit: Unit): Position | null => {
  const seat = state.turnOrder.indexOf(unit.ownerId);
  const slot = SQUAD_ROSTER.indexOf(unit.type as PlayerClass);
  if (seat < 0 || slot < 0) return null;
  return deploymentTiles(seat, state.boardSize)[slot] ?? null;
};

/**
 * Where to raise a unit: its own spawn if nobody stands there, otherwise the
 * closest free tile — flooded outwards so the dead come back beside their old
 * post rather than across the board.
 */
export const resurrectionSpotFor = (state: GameState, unit: Unit): Position => {
  const spawn = originalSpawnFor(state, unit) ?? { ...unit.position };
  if (isPassable(state, spawn, unit.id)) return spawn;

  const seen = new Set<string>([positionKey(spawn)]);
  const queue: Position[] = [spawn];
  while (queue.length > 0) {
    const current = queue.shift() as Position;
    for (const { dx, dy } of NEIGHBOUR_OFFSETS) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = positionKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      if (isPassable(state, next, unit.id)) return next;
      // Stone is a wall of the flood, not a corridor through it.
      if (isWall(state, next)) continue;
      queue.push(next);
    }
  }
  return spawn;
};
