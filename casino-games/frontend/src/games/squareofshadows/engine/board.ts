import { NEIGHBOUR_OFFSETS } from './constants';
import type { BoardSize, GameState, Position, Unit } from './types';

/** Canonical string key for a tile: "x,y". Used by Map-backed lookups. */
export const positionKey = (p: Position): string => `${p.x},${p.y}`;

/** Inverse of {@link positionKey}. */
export const parseKey = (key: string): Position => {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
};

export const positionsEqual = (a: Position, b: Position): boolean =>
  a.x === b.x && a.y === b.y;

/**
 * Chebyshev distance: max(|dx|, |dy|).
 *
 * This is RANGE, not movement cost — it is what attack range, spell range and
 * blast shape are measured in, and a 3x3 Fireball stays a 3x3 Fireball. Moving
 * a tile costs {@link stepCost}, which is deliberately stricter than this.
 */
export const chebyshev = (a: Position, b: Position): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * Movement cost of one step from `a` to `b`: 2 for a diagonal, 1 for a straight
 * line.
 *
 * Diagonals being free made them strictly better than walking two orthogonal
 * tiles — same reach, no obstacle between the two intermediate tiles to squeeze
 * past — so every unit effectively moved as a king while the rules implied a
 * grid. Charging 2 puts the diagonal back in line with the Manhattan distance it
 * actually covers.
 */
export const stepCost = (a: Position, b: Position): number =>
  a.x !== b.x && a.y !== b.y ? 2 : 1;

/** Manhattan distance: |dx| + |dy| (orthogonal steps only). */
export const manhattan = (a: Position, b: Position): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export const inBounds = (p: Position, size: BoardSize): boolean =>
  p.x >= 0 && p.y >= 0 && p.x < size.width && p.y < size.height;

export const isWall = (state: GameState, p: Position): boolean => {
  if (state.terrain.get(positionKey(p)) === 'WALL') return true;
  // Wizard ice blocks just like stone, but it melts, so it is not in `terrain`.
  return state.iceWalls.some((wall) => wall.x === p.x && wall.y === p.y);
};

/**
 * Find the living unit occupying a tile. `ignoreUnitId` lets a unit treat its
 * own starting tile as free when computing reachability. Defeated units
 * (HP <= 0) remain in the state for animation but never block a tile.
 */
export const unitAt = (
  state: GameState,
  p: Position,
  ignoreUnitId?: string,
): Unit | null => {
  for (const unit of state.units.values()) {
    if (unit.stats.currentHp <= 0) continue;
    if (ignoreUnitId && unit.id === ignoreUnitId) continue;
    if (positionsEqual(unit.position, p)) return unit;
  }
  return null;
};

/** A tile a unit may stand on or pass through: in bounds, not a wall, unoccupied. */
export const isPassable = (
  state: GameState,
  p: Position,
  ignoreUnitId?: string,
): boolean =>
  inBounds(p, state.boardSize) &&
  !isWall(state, p) &&
  unitAt(state, p, ignoreUnitId) === null;

/** All in-bounds neighbours of a tile (8-directional). */
export const neighbours = (p: Position): Position[] =>
  NEIGHBOUR_OFFSETS.map(({ dx, dy }) => ({ x: p.x + dx, y: p.y + dy }));

/**
 * Weighted flood fill from a unit's tile: cheapest cost to every reachable tile,
 * plus the predecessor that got there.
 *
 * Rules enforced:
 *  - 8-directional steps, each costing {@link stepCost} (1 straight, 2 diagonal).
 *  - Cannot enter a wall or a tile occupied by any other unit (no phasing).
 *  - Total path cost must not exceed `unit.stats.moveReach`.
 *
 * Dijkstra by linear scan of the frontier, not BFS. BFS only gives shortest paths
 * when every edge costs the same, which stopped being true the moment diagonals
 * cost 2 — first-visit-wins would lock in whatever order it happened to reach a
 * tile and report a longer route as the best one. Costs are 1 and 2 and
 * `moveReach` is a handful of tiles, so the frontier can never grow large enough
 * for a heap to be worth its complexity.
 *
 * Also has to RELAX rather than skip seen tiles: a tile first reached diagonally
 * (2) can be reached straight afterwards for 1 from a different neighbour.
 */
const floodFrom = (
  state: GameState,
  unit: Unit,
): { dist: Map<string, number>; prev: Map<string, Position> } => {
  const start = unit.position;
  const dist = new Map<string, number>([[positionKey(start), 0]]);
  const prev = new Map<string, Position>();
  const frontier: Position[] = [start];

  while (frontier.length > 0) {
    let bestIndex = 0;
    let bestDist = dist.get(positionKey(frontier[0])) as number;
    for (let i = 1; i < frontier.length; i += 1) {
      const d = dist.get(positionKey(frontier[i])) as number;
      if (d < bestDist) {
        bestIndex = i;
        bestDist = d;
      }
    }
    const current = frontier.splice(bestIndex, 1)[0];
    // Costs are positive, so nothing popped from here can improve.
    if (bestDist >= unit.stats.moveReach) continue;

    for (const next of neighbours(current)) {
      if (!isPassable(state, next, unit.id)) continue;
      const key = positionKey(next);
      const cost = bestDist + stepCost(current, next);
      // Prune on PUSH, not only on pop. Recording an over-budget tile put it in
      // `dist`, and `computeReachable` returns `dist` — so a reach-2 warrior
      // reported 20 destinations instead of 12, tiles it had no path to within
      // its movement. Costs are positive, so nothing reachable is ever cut here.
      if (cost > unit.stats.moveReach) continue;
      const seen = dist.get(key);
      if (seen !== undefined && seen <= cost) continue;
      dist.set(key, cost);
      prev.set(key, current);
      frontier.push(next);
    }
  }

  return { dist, prev };
};

/**
 * Every tile `unit` can legally finish a move on.
 *
 * Returns destinations only (not the full path); the UI can reconstruct a path
 * with {@link findPath} if it wants an animated walk. The unit's own tile is
 * excluded.
 */
export const computeReachable = (state: GameState, unit: Unit): Position[] => {
  if (unit.stats.currentHp <= 0) return [];
  const { dist } = floodFrom(state, unit);
  const results: Position[] = [];
  for (const [key, cost] of dist) {
    if (cost > 0) results.push(parseKey(key));
  }
  return results;
};

/**
 * Shortest legal path from `unit` to `target`, inclusive of both endpoints, or
 * `null` if unreachable within `moveReach`. Useful for client-side walk
 * animation; the authority only needs {@link computeReachable}.
 */
export const findPath = (
  state: GameState,
  unit: Unit,
  target: Position,
): Position[] | null => {
  const start = unit.position;
  if (positionsEqual(start, target)) return [start];
  if (!isPassable(state, target, unit.id)) return null;

  const { dist, prev } = floodFrom(state, unit);
  if (!dist.has(positionKey(target))) return null;

  const path: Position[] = [target];
  let cursor = target;
  while (!positionsEqual(cursor, start)) {
    const step = prev.get(positionKey(cursor));
    if (!step) return null;
    path.unshift(step);
    cursor = step;
  }
  return path;
};

/**
 * Integer Bresenham line between two tiles, endpoints included. Wall tiles
 * strictly between `from` and `to` block line of sight (used by the Ranger).
 */
export const lineCells = (from: Position, to: Position): Position[] => {
  const cells: Position[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx - dy;
  // Safety bound: the line can never visit more tiles than bounding box + 2.
  const maxSteps = Math.max(dx, dy) + 2;

  for (let step = 0; step <= maxSteps; step++) {
    cells.push({ x, y });
    if (x === to.x && y === to.y) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return cells;
};

/** True when no wall sits strictly between the two tiles. */
export const hasLineOfSight = (
  state: GameState,
  from: Position,
  to: Position,
): boolean => {
  const cells = lineCells(from, to);
  // Skip both endpoints; any interior wall blocks the shot.
  for (let i = 1; i < cells.length - 1; i++) {
    if (isWall(state, cells[i])) return false;
  }
  return true;
};
