/**
 * Square of Shadows — procedural map generation.
 *
 * `defaultWallPositions()` in `state.ts` is a single hand-authored floor. This
 * module produces a different-but-always-playable floor per seed, so consecutive
 * matches do not all happen on the same geometry.
 *
 * ## Why the map is mirrored, not freely random
 *
 * The hand-authored map is point-symmetric, and its comment gives the reason:
 * symmetry keeps the two spawn zones mechanically fair. Purely random walls
 * throw that away — over enough matches you get a board with a wall cluster
 * parked next to one player's deployment row, and in a two-player game that is
 * a balance problem, not variety.
 *
 * So only the TOP half is generated at random and mirrored left-right. That
 * keeps point symmetry *structurally* rather than hoping randomness lands fairly,
 * while still leaving half the board free: 50 independent tiles on the default
 * 10x10, which is plenty of distinct maps.
 *
 * ## Why generation is seeded rather than rolled at render time
 *
 * Online matches are built once by `buildMatch` and then serialized, so the walls
 * travel to both clients inside the state. But AI and local matches are created
 * client-side, and `GameState` round-trips through DynamoDB for online rooms. The
 * seed is stored in the state anyway, so keeping generation a pure function of it
 * means any match can be reproduced exactly — which is what you want the first
 * time someone reports "this board was unplayable".
 *
 * The `rng` seam matches the one already used for combat rolls in `reducer.ts`.
 */

import { DEFAULT_BOARD_SIZE, ALTAR_SIZE } from './constants';
import { chebyshev, positionKey } from './board';
import type { BoardSize, Position, Rng } from './types';

/**
 * Wall density as a fraction of each mirrored half's generative area.
 *
 * 0.2 on the default board is 6 walls per half, 12 total — the same count as the
 * hand-authored map. Deliberately kept low: past roughly a fifth the board
 * becomes a maze, and once movement is this constrained the Cleric's five-tile
 * cross and the Wizard's 3x3 stop mattering, which is most of what makes the
 * classes distinct.
 */
const DENSITY_PER_HALF = 0.2;

/** Accepted band for total wall count, as a fraction of the whole board. */
const MIN_DENSITY = 0.06;
const MAX_DENSITY = 0.2;

/**
 * How many times to redraw before falling back to the hand-authored map.
 *
 * A generator must be *total*: it has to return a playable board for every
 * possible seed, including adversarial ones. The fallback is what makes that
 * true, so the cap exists only so a pathological seed cannot spin.
 */
const MAX_ATTEMPTS = 24;

/**
 * Rows generation is allowed to draw walls on.
 *
 * Skips the two deployment rows at each edge. `deploymentTiles` puts player 1 on
 * row 0 and player 0 on row `height - 1`, and squads are four units wide.
 * Blocking those rows could spawn a unit inside stone, which is unrecoverable —
 * there is no un-deploy command.
 *
 * Validation does not use this helper; it checks the actual deployment tiles via
 * `deploymentTilesFor`, so the two cannot drift. This exists purely to keep the
 * draw loop honest about which rows are fair game.
 */
const isGeneratableRow = (y: number, size: BoardSize): boolean =>
  y > 1 && y < size.height - 2;

/** Deterministic 32-bit PRNG (mulberry32). Seeded so a seed reproduces a map. */
export const rngFromSeed = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Fisher-Yates against an injected rng, so tests can drive it deterministically. */
const shuffled = <T,>(items: T[], rng: Rng): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** Orthogonal step offsets. Connectivity is checked orthogonally on purpose. */
const ORTHOGONAL: ReadonlyArray<Position> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/**
 * Every deployment tile, for both players.
 *
 * Derived from the same rule as `deploymentTiles` so the two cannot drift: if
 * deployment ever moves, the connectivity check follows it automatically.
 */
export const deploymentTilesFor = (size: BoardSize = DEFAULT_BOARD_SIZE): Position[] => {
  const middle = Math.floor(size.width / 2);
  const xs = [middle - 2, middle - 1, middle, middle + 1];
  return [size.height - 1, 0].flatMap((row) => xs.map((x) => ({ x, y: row })));
};

/**
 * Why a candidate floor is rejected, or null when it is playable.
 *
 * Each reason is a way a match can be broken or decided before it starts.
 */
export type MapFault =
  | 'BLOCKED_DEPLOYMENT'
  | 'DISCONNECTED'
  | 'SEALED_ROW'
  | 'DENSITY';

export const validateWalls = (
  walls: Position[],
  size: BoardSize = DEFAULT_BOARD_SIZE,
): MapFault | null => {
  const wallSet = new Set(walls.map((w) => positionKey(w)));

  // 1. No wall may sit on a deployment tile. A unit spawned inside stone is stuck
  //    for the whole match and there is no way to undo it.
  for (const tile of deploymentTilesFor(size)) {
    if (wallSet.has(positionKey(tile))) return 'BLOCKED_DEPLOYMENT';
  }

  // 2. No wall line may span the board. A full row or column of stone cuts the
  //    two deployment areas apart and the match is decided before anyone moves.
  for (let y = 0; y < size.height; y += 1) {
    let run = 0;
    for (let x = 0; x < size.width; x += 1) {
      run = wallSet.has(positionKey({ x, y })) ? run + 1 : 0;
      if (run === size.width) return 'SEALED_ROW';
    }
  }
  for (let x = 0; x < size.width; x += 1) {
    let run = 0;
    for (let y = 0; y < size.height; y += 1) {
      run = wallSet.has(positionKey({ x, y })) ? run + 1 : 0;
      if (run === size.height) return 'SEALED_ROW';
    }
  }

  // 3. Density band. Too few walls is a bare board; too many is a maze that
  //    flattens the class identities.
  const density = walls.length / (size.width * size.height);
  if (density < MIN_DENSITY || density > MAX_DENSITY) return 'DENSITY';

  // 4. Connectivity. Every deployment tile must be reachable from every other,
  //    or a squad can spawn sealed into a pocket.
  //
  //    Checked orthogonally even though diagonal steps are legal, because they
  //    cost 2 — a map connected only through diagonals is connected on paper and
  //    miserable to cross.
  const targets = deploymentTilesFor(size);
  if (targets.length === 0) return null;

  const start = targets[0];
  const seen = new Set<string>([positionKey(start)]);
  const queue: Position[] = [start];
  while (queue.length > 0) {
    const current = queue.shift() as Position;
    for (const step of ORTHOGONAL) {
      const next = { x: current.x + step.x, y: current.y + step.y };
      const key = positionKey(next);
      if (next.x < 0 || next.y < 0 || next.x >= size.width || next.y >= size.height) continue;
      if (wallSet.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  for (const tile of targets) {
    if (!seen.has(positionKey(tile))) return 'DISCONNECTED';
  }

  return null;
};

/** One mirrored half's worth of walls, before mirroring. */
const drawHalf = (size: BoardSize, rng: Rng, densityPerHalf: number): Position[] => {
  const mid = Math.floor(size.height / 2);
  const candidates: Position[] = [];
  for (let y = 0; y < size.height; y += 1) {
    if (!isGeneratableRow(y, size)) continue;
    if (y >= mid) continue; // only the top half is drawn; the rest is mirrored
    for (let x = 0; x < size.width; x += 1) candidates.push({ x, y });
  }

  const target = Math.max(2, Math.round(candidates.length * densityPerHalf));
  return shuffled(candidates, rng).slice(0, target);
};

/** Mirror a wall left-right across the board's vertical axis. */
const mirror = (p: Position, size: BoardSize): Position => ({ x: size.width - 1 - p.x, y: p.y });

export interface GenerateWallsOptions {
  /** Any integer. The same seed always produces the same floor. */
  seed: number;
  size?: BoardSize;
  /** Defaults to a PRNG derived from `seed`; inject to drive it in tests. */
  rng?: Rng;
  /**
   * Walls as a fraction of each mirrored half's generative area.
   *
   * Defaults to `DENSITY_PER_HALF`. Adventure overrides it downward: the same
   * density on a 20x20 floor turns a hall you cross into a maze you pick your
   * way through, and the point of the bigger map is travelling across it.
   */
  densityPerHalf?: number;
  /**
   * Mirror the drawn half top-to-bottom as well as left-to-right.
   *
   * Off by default: the duel arena's generator draws only rows above the middle
   * and reflects them sideways, which keeps its two spawn zones identical. On a
   * 20x20 exploration floor that leaves the entire southern half bare, because
   * the walls were only ever going to land in rows 2-9. Adventure turns it on so
   * the ruin band sits across the middle of the map instead of in one half.
   */
  mirrorVertically?: boolean;
  /** Used when no candidate passes validation. Kept out of the import cycle. */
  fallback?: Position[];
}

/**
 * A playable floor for `seed`.
 *
 * Draws the top half, mirrors it, validates, and redraws on failure. Returns the
 * `fallback` (the hand-authored map by default) if every attempt fails, so this
 * function cannot return an unplayable board for any seed — including the ones
 * that would otherwise hang a generator in a retry loop.
 */
export const generateWalls = ({
  seed,
  size = DEFAULT_BOARD_SIZE,
  rng = rngFromSeed(seed),
  densityPerHalf = DENSITY_PER_HALF,
  mirrorVertically = false,
  fallback = [],
}: GenerateWallsOptions): Position[] => {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const drawn = drawHalf(size, rng, densityPerHalf);
    const walls = new Map<string, Position>();
    for (const wall of drawn) {
      walls.set(positionKey(wall), wall);
      const flipped = mirror(wall, size);
      walls.set(positionKey(flipped), flipped);
      if (mirrorVertically) {
        const low = { x: wall.x, y: size.height - 1 - wall.y };
        walls.set(positionKey(low), low);
        const lowFlipped = { x: size.width - 1 - wall.x, y: size.height - 1 - wall.y };
        walls.set(positionKey(lowFlipped), lowFlipped);
      }
    }
    const candidate = Array.from(walls.values());
    if (validateWalls(candidate, size) === null) return candidate;
  }
  return fallback;
};

/**
 * Phase of the floor checkerboard for a given seed.
 *
 * The board draws bare floor as a two-tone checkerboard, and that pattern earns
 * its place: it is what makes a large empty area read as laid stone rather than
 * as missing tiles. Hashing each tile independently would throw that away and
 * leave the floor looking like noise.
 *
 * So the *pattern* is kept and only its phase is seeded — every map still gets a
 * checkerboard, but which tile begins it differs between maps. Derived from
 * the seed rather than stored per tile, so it costs nothing on the wire and both
 * clients agree.
 */
export const floorParityFor = (seed: number): 0 | 1 => {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return (h & 1) as 0 | 1;
};
/**
 * The Altars of Shadows on an Adventure floor.
 *
 * Two per floor, at seeded positions, and placed here rather than rolled by the
 * renderer for the same reason the walls are: an online run is replayed from
 * `mapSeed` on the server, so a monument the client drew from a different roll
 * would be a wall on one screen and walkable floor on the other.
 *
 * They are put INTO the terrain (see `adventureWallsFor`), which is the whole
 * trick: an altar tile is then stone for pathing, for line of sight and for
 * serialization without a second rule anywhere, exactly like the arena's ruined
 * centre. `altarSitesFor` only has to recognise the blocks back.
 *
 * Constraints, all of them load-bearing:
 *  - fully inside a one-tile margin, so a monument never touches the board edge;
 *  - two rows clear of both deployment rows, so nobody deploys inside one;
 *  - spaced apart, so the two blocks cannot read as one long wall.
 */
export const ADVENTURE_ALTAR_COUNT = 2;

/** Minimum 2x2-origin distance between two altars: three free tiles between. */
const ALTAR_SPACING = 5;

/** One entry per (seed, board size); a session only ever has a handful. */
const altarOriginCache = new Map<string, Position[]>();

export const adventureAltarOrigins = (
  seed: number,
  size: BoardSize = DEFAULT_BOARD_SIZE,
): Position[] => {
  // This is read per unit per render (the "beside an altar" check), and the
  // search shuffles ~300 candidates — so keep the answer. Pure in (seed, size).
  const key = `${seed}:${size.width}x${size.height}`;
  const cached = altarOriginCache.get(key);
  if (cached) return cached;

  const candidates: Position[] = [];
  for (let y = 2; y <= size.height - ALTAR_SIZE - 2; y += 1) {
    for (let x = 1; x <= size.width - ALTAR_SIZE - 1; x += 1) {
      candidates.push({ x, y });
    }
  }

  const picked: Position[] = [];
  if (candidates.length >= ADVENTURE_ALTAR_COUNT) {
    // A stream of its own: adding monuments must not reroll the floor, and a
    // retuned wall generator must not move a monument that already fit.
    const ordered = shuffled(candidates, rngFromSeed((seed ^ 0x5a17a17a) >>> 0));
    for (const origin of ordered) {
      if (picked.every((other) => chebyshev(other, origin) >= ALTAR_SPACING)) {
        picked.push(origin);
        if (picked.length === ADVENTURE_ALTAR_COUNT) break;
      }
    }
    // The spacing pass can come up short on a small board. Both monuments matter
    // more than the gap between them, so take the next best origins.
    for (const origin of ordered) {
      if (picked.length === ADVENTURE_ALTAR_COUNT) break;
      if (picked.some((other) => other.x === origin.x && other.y === origin.y)) continue;
      picked.push(origin);
    }
  }

  if (altarOriginCache.size > 64) altarOriginCache.clear();
  altarOriginCache.set(key, picked);
  return picked;
};

/** The tile list of every Adventure altar, row-major inside each 2x2 block. */
export const altarSiteTilesFor = (
  seed: number,
  size: BoardSize = DEFAULT_BOARD_SIZE,
): Position[] =>
  adventureAltarOrigins(seed, size).flatMap((origin) => {
    const tiles: Position[] = [];
    for (let dy = 0; dy < ALTAR_SIZE; dy += 1) {
      for (let dx = 0; dx < ALTAR_SIZE; dx += 1) {
        tiles.push({ x: origin.x + dx, y: origin.y + dy });
      }
    }
    return tiles;
  });

/**
 * The Adventure floor: generated walls plus its monuments, in one list because
 * a caller that forgot the second half would build a board with altars the
 * engine cannot see.
 */
export const adventureWallsFor = (
  seed: number,
  size: BoardSize = DEFAULT_BOARD_SIZE,
  densityPerHalf?: number,
): Position[] => [
  ...generateWalls({ seed, size, densityPerHalf, mirrorVertically: true }),
  ...altarSiteTilesFor(seed, size),
];
