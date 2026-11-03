/**
 * Square of Shadows — Adventure mode.
 *
 * A co-op exploration run: two player squads share one huge floor, and a third
 * "team" of monsters walks the same tiles and shoots at both of them.
 *
 * ## Why there is no `GameState.adventure` flag
 *
 * Adventure is identified purely by the monster team sitting in `turnOrder`.
 * That is deliberate:
 *
 *  - `GameState` round-trips through DynamoDB for online rooms, so a new field
 *    is a wire change on a path the Lambda also owns.
 *  - Adventure is client-only (see `startGame` in the hook), so nothing online
 *    ever has to answer "is this an adventure?" — if `MONSTERS` is in the turn
 *    order it is one, and otherwise it is a duel.
 *  - The monster team gets its own slot in the normal turn loop, so the whole
 *    existing turn machinery (turn hand-over, ice melting, zone ticks, the
 *    auto-end countdown) works on it with no special cases.
 *
 * ## Why the monsters need no new AI
 *
 * `chooseAiCommand` treats "enemy" as *any* living unit it does not own. Pointed
 * at `MONSTER_TEAM_ID` that is exactly the required behaviour — hunt both squads,
 * heal the monster that is closest to dying, close on the nearest of either
 * player — with no second policy to write, tune or test.
 */

import { manhattan, positionKey } from './board';
import { rngFromSeed } from './maps';
import { cloneState, createUnit } from './state';
import type { BoardSize, GameState, Position, Unit, UnitType } from './types';

/**
 * Owner id of the monster team.
 *
 * The monsters are NOT a seat in the turn order. They have no turn of their own:
 * they move and strike automatically at the end of every player's turn, so they
 * never occupy the board's turn rotation or hand the match to each other. See
 * `runMonsterStep` in the reducer.
 */
export const MONSTER_TEAM_ID = 'MONSTERS';

/**
 * Sentinel `winnerId` for a cleared run.
 *
 * Adventure is co-op, so there is no single player to name: the party wins
 * together and the recap banner reads "Your party wins!". A sentinel beats
 * picking an arbitrary player, which would tell one of the two players they lost
 * a run they won.
 */
export const ADVENTURE_CLEARED = 'ADVENTURE_CLEARED';

/** The exploration floor. Four times the duel's area. */
export const ADVENTURE_BOARD_SIZE: BoardSize = { width: 20, height: 20 };

/**
 * The default amount of the floor drawn at once.
 *
 * The board is 20x20 but only a 9x9 window is rendered, centred on the focused
 * unit — the same trick a JRPG camera plays. The tile size is unchanged, so
 * nothing on the board shrinks; you simply see less of it and the view follows
 * whoever you have selected. The player can choose 3x3, 5x5, 7x7, 9x9, 10x10
 * or 11x11 from the in-game map-size control; this constant is the default the
 * engine uses when it needs a deterministic opening window (monster placement).
 *
 * Odd on purpose for the DEFAULT: the camera centres with
 * `focus - floor(cols / 2)`, so an even window puts the focus half a cell off.
 * At 10 wide the hero lands on index 5 of 0-9, one cell right of the middle.
 * At 9 wide `floor(9 / 2)` is 4 and the focus lands on index 4 of 0-8. Near a
 * border the window is clamped onto the floor rather than showing void.
 */
export const ADVENTURE_VIEW: BoardSize = { width: 9, height: 9 };

/**
 * Wall density for the exploration floor, as a fraction of each mirrored half.
 *
 * A quarter of the duel arena's density, and the quarter is not cosmetic: the
 * floor is mirrored sideways AND top-to-bottom, so this number is multiplied by
 * four before anything is placed. 0.2 would put a fifth of a 400-tile map in
 * stone. 0.05 lands the total around 8% — a landmark or two per screen, enough
 * to route around, never enough to slow you down.
 *
 * Kept above the generator's 6% minimum floor deliberately: below that,
 * `validateWalls` starts rejecting maps and falls back to the hand-authored
 * 12-wall arena, which on a 20x20 board is twelve lonely tiles in one corner.
 */
export const ADVENTURE_WALL_DENSITY = 0.05;

/**
 * Whether this is an adventure run.
 *
 * Keyed off the chosen `mapMode`, NOT off the monsters. Two reasons:
 *
 *  - The monsters are seeded DURING the draft, from this very flag. A check for
 *    "are there monsters yet" would be false at exactly the moment the answer is
 *    needed, and the floor would deploy as a bare arena.
 *  - The monsters no longer hold a turn-order slot, so the order cannot answer
 *    it either.
 *
 * `mapMode` is set by `SET_MAP_MODE` before anything is deployed and survives
 * the whole run, so it is the one value that is true from the draft onwards.
 */
export const isAdventureState = (state: GameState | null | undefined): boolean =>
  !!state && state.mapMode === 'RANDOM';

/**
 * Deployment tiles for an adventure squad.
 *
 * Unlike a duel, both squads start together in the south-west of the map — they
 * are a party exploring the same ground, so splitting them to opposite edges
 * would send each half walking a different half of the floor.
 *
 * Row `height - 2` is safe by construction: `drawHalf` in `maps.ts` never draws
 * on the two outermost rows at either edge, so no generated wall can land on a
 * starting tile.
 */
export const adventureDeploymentTiles = (
  playerIndex: number,
  size: BoardSize = ADVENTURE_BOARD_SIZE,
): Position[] => {
  /*
   * Diagonally opposite corners: player 1 south-west, player 2 north-east.
   *
   * Both squads used to deploy side by side in the south-west, which made the
   * opening of an adventure a scrum in one corner with the whole map ahead of
   * them. Opposite corners means the two lanes between the players are the two
   * ways to meet, and the monsters seed into the OTHER two edges and the middle,
   * so the first fight happens between them rather than under their feet.
   */
  const inset = 1;
  return playerIndex === 0
    ? [0, 1, 2, 3].map((i) => ({ x: inset + i, y: size.height - 2 }))
    : [0, 1, 2, 3].map((i) => ({ x: size.width - inset - 4 + i, y: inset }));
};

/**
 * Monster id. Indexed rather than `unitId(owner, type)` because two monsters of
 * the same class would collide and overwrite each other in the unit map.
 */
export const monsterUnitId = (index: number, type: UnitType): string =>
  `${MONSTER_TEAM_ID}:${index}:${type}`;

/**
 * The garrison, and where each one seeds.
 *
 * `zone` is why this is not simply an even stride across the floor. The players
 * take the south-west and north-east corners, so the monsters own the other two
 * edges plus the middle — the lanes between the squads are where the fighting
 * happens, not the spawn points.
 *
 * Three Beasts and a Spitter, not four of one thing: the Spitter sits in the
 * centre band so the crossing is watched by something that hits at range 2,
 * which is the one tile of pressure you cannot simply walk through. The Beasts
 * hold the edges, and a Beast that reaches you has already closed to melee —
 * where its orthogonal-only claw means you can stand beside it and be safe, or
 * step around it, but never both at once.
 */
type MonsterZone = 'north-west' | 'south-east' | 'centre';

const MONSTER_ROSTER: ReadonlyArray<{
  type: UnitType;
  hp: number;
  damage: number;
  zone: MonsterZone;
}> = [
  { type: 'BEAST', hp: 26, damage: 7, zone: 'north-west' },
  { type: 'BEAST', hp: 22, damage: 6, zone: 'north-west' },
  { type: 'SPITTER', hp: 16, damage: 5, zone: 'centre' },
  { type: 'BEAST', hp: 20, damage: 6, zone: 'south-east' },
];

/**
 * The three spawn regions, as rectangles.
 *
 * The edge bands start three tiles in, so nothing can land within two tiles of a
 * spawn corner — that margin is what makes the opening a choice rather than an
 * ambush. `centre` is deliberately a tight box, so the middle monster guards the
 * crossing rather than sitting in the middle of a lane.
 */
const zoneBand = (zone: MonsterZone, size: BoardSize) => {
  if (zone === 'north-west') {
    return { x0: 3, y0: 3, x1: Math.floor(size.width / 3), y1: 6 };
  }
  if (zone === 'south-east') {
    return {
      x0: Math.floor((size.width * 2) / 3),
      y0: size.height - 7,
      x1: size.width - 4,
      y1: size.height - 4,
    };
  }
  return {
    x0: Math.floor(size.width / 2) - 3,
    y0: Math.floor(size.height / 2) - 3,
    x1: Math.floor(size.width / 2) + 3,
    y1: Math.floor(size.height / 2) + 3,
  };
};

/**
 * Populate the floor with the monster team.
 *
 * Placement is deterministic in `mapSeed` (same seed, same map, same garrison)
 * and spread across the whole board rather than clustered: shuffling the free
 * tiles and then taking every Nth one guarantees a monster in the far corner as
 * well as one near the party's start, with no two on top of each other.
 *
 * Called after both squads deploy and before the match starts, so nothing is
 * standing where a monster lands.
 */
export const spawnAdventureMonsters = (state: GameState): GameState => {
  const next = cloneState(state);
  const rng = rngFromSeed((state.mapSeed ^ 0x9e3779b9) >>> 0);

  const occupied = new Set(
    Array.from(next.units.values()).map((unit) => positionKey(unit.position)),
  );
  const free: Position[] = [];
  for (let y = 2; y < next.boardSize.height - 2; y += 1) {
    for (let x = 0; x < next.boardSize.width; x += 1) {
      const key = positionKey({ x, y });
      if (next.terrain.get(key) === 'WALL' || occupied.has(key)) continue;
      free.push({ x, y });
    }
  }
  for (let i = free.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }

  const stride = Math.max(1, Math.floor(free.length / MONSTER_ROSTER.length));
  const zoneTaken: Record<MonsterZone, number> = { 'north-west': 0, 'south-east': 0, centre: 0 };
  MONSTER_ROSTER.forEach((entry, index) => {
    // ZONED, not strided. An even stride guarantees a monster in the far corner
    // but scatters them evenly, which put one or two tiles from a spawn and made
    // the first encounter whichever monster you happened to be standing beside.
    // The stride survives only as a fallback for a zone that is entirely walled
    // in — dropping the monster instead would let the run be decided by
    // arithmetic rather than by fighting.
    const band = zoneBand(entry.zone, next.boardSize);
    const inZone = free.filter(
      (tile) => tile.x >= band.x0 && tile.x <= band.x1 && tile.y >= band.y0 && tile.y <= band.y1,
    );
    const spot = inZone[zoneTaken[entry.zone]++] ?? free[index * stride];
    if (!spot) return;
    occupied.add(positionKey(spot));
    const unit: Unit = createUnit(monsterUnitId(index, entry.type), MONSTER_TEAM_ID, entry.type, spot);
    unit.stats.maxHp = entry.hp;
    unit.stats.currentHp = entry.hp;
    unit.stats.attackDamage = entry.damage;
    next.units.set(unit.id, unit);
  });

  /*
   * Guarantee the run OPENS on something.
   *
   * The zones deliberately keep the monsters off the two spawn corners, so the
   * first fight is between the parties rather than an ambush on deployment. But
   * the camera opens on the active player's squad, and that squad stands in a
   * corner — the one part of the floor the zones avoid. So a garrison that
   * happened to seed entirely into the other three regions opened on an empty
   * board, with nothing on screen to say the floor is dangerous.
   *
   * Rather than widen a zone (which puts the "no ambush" margin back at risk),
   * the closest monster is relocated into the opening window, onto the free tile
   * FURTHEST from the party: visible from the first frame, still not an ambush.
   *
   * Deterministic — pure geometry over the seeded state — so the client and the
   * server put it on the same tile.
   */
  const view = openingCameraWindow(next);
  const garrison = Array.from(next.units.values()).filter((u) => u.ownerId === MONSTER_TEAM_ID);
  if (garrison.length > 0 && !garrison.some((u) => tileVisibleInView(u.position, view))) {
    const mid = { x: view.originX + view.cols / 2, y: view.originY + view.rows / 2 };
    const nearest = garrison.reduce((best, unit) =>
      manhattan(unit.position, mid) < manhattan(best.position, mid) ? unit : best);

    const party = Array.from(next.units.values())
      .filter((u) => u.ownerId !== MONSTER_TEAM_ID)
      .map((u) => u.position);
    const inside: Position[] = [];
    // Intersect the window with the floor even though `cameraWindowFor` already
    // clamps it. The origin used to be allowed negative, and trusting it put a
    // monster on x=-4 — a coordinate that is not a tile at all. Keeping the
    // intersection makes this independent of how the camera is framed.
    for (
      let y = Math.max(0, view.originY);
      y < Math.min(next.boardSize.height, view.originY + view.rows);
      y += 1
    ) {
      for (
        let x = Math.max(0, view.originX);
        x < Math.min(next.boardSize.width, view.originX + view.cols);
        x += 1
      ) {
        const key = positionKey({ x, y });
        if (occupied.has(key) || next.terrain.get(key) === 'WALL') continue;
        inside.push({ x, y });
      }
    }
    if (inside.length > 0) {
      const clearance = (p: Position) =>
        party.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...party.map((q) => manhattan(q, p)));
      const spot = inside.reduce((best, p) => (clearance(p) > clearance(best) ? p : best));
      occupied.delete(positionKey(nearest.position));
      occupied.add(positionKey(spot));
      next.units.set(nearest.id, { ...nearest, position: spot });
    }
  }

  return next;
};

/**
 * The rectangle the camera draws at the start of an adventure run.
 *
 * Mirrors the component's `cameraFocus` at match start: the opening seat's first
 * living unit, falling back to anyone of theirs.
 *
 * The opening seat is `turnOrder[0]` and NOT `activePlayerId`. This runs inside
 * `CHOOSE_FACTION`, which spawns the garrison BEFORE `startMatch` — and
 * `startMatch` is what sets `activePlayerId` to the first seat. So reading
 * `activePlayerId` here points at whoever picked a faction LAST, which is the
 * opposite corner from the one the match opens on: the guarantee got satisfied
 * for a player who was not looking at the board, while the player who WAS
 * looking at it saw an empty floor. Nothing errors, which is exactly what let it
 * survive being right about everything else.
 */
export const openingCameraWindow = (state: GameState): CameraWindow => {
  const openingSeat = state.turnOrder[0] ?? state.activePlayerId;
  const party = Array.from(state.units.values()).filter(
    (unit) => unit.ownerId !== MONSTER_TEAM_ID && unit.stats.currentHp > 0,
  );
  const focus =
    party.find((unit) => unit.ownerId === openingSeat)?.position ??
    party[0]?.position ??
    null;
  return cameraWindowFor(focus, state.boardSize, ADVENTURE_VIEW);
};

/** The rectangle of tiles the board actually draws. */
export interface CameraWindow {
  /** Left-most column drawn. */
  originX: number;
  /** Top-most row drawn. */
  originY: number;
  cols: number;
  rows: number;
}

/**
 * Clamp a requested camera origin onto the floor.
 *
 * The camera window is a rectangle laid over the map, so its left/top corner
 * can never be negative and can never leave a gap past the right/bottom edge.
 * That means a hero near a border is off-centre instead of the board showing
 * void/black tiles — the old renderer had a `is-void` branch precisely because
 * this used to be allowed.
 *
 * The window itself is capped at the map size. A 10x10 request against the
 * 12x10 Arena therefore draws 10 columns and all 10 rows.
 */
export const cameraWindowFromOrigin = (
  origin: Position,
  size: BoardSize,
  view: BoardSize,
): CameraWindow => {
  const cols = Math.max(1, Math.min(view.width, size.width));
  const rows = Math.max(1, Math.min(view.height, size.height));
  const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));
  return {
    originX: clamp(origin.x, size.width - cols),
    originY: clamp(origin.y, size.height - rows),
    cols,
    rows,
  };
};

/**
 * Centre a `view`-sized window on `focus`, clamped to the floor.
 *
 * The window is centred on the hero wherever the floor allows it. Near an
 * edge it is clamped back onto the floor so it never hangs past the map and
 * the renderer never paints void/black tiles off the board.
 *
 * With no focus the window centres on the floor.
 */
export const cameraWindowFor = (
  focus: Position | null,
  size: BoardSize,
  view: BoardSize,
): CameraWindow => {
  const cols = Math.max(1, Math.min(view.width, size.width));
  const rows = Math.max(1, Math.min(view.height, size.height));
  // No focus (a menu, or a squad wiped out) centres on the floor rather than
  // parking on the origin corner.
  const centre = focus ?? {
    x: Math.floor((size.width - 1) / 2),
    y: Math.floor((size.height - 1) / 2),
  };
  return cameraWindowFromOrigin(
    {
      x: centre.x - Math.floor(cols / 2),
      y: centre.y - Math.floor(rows / 2),
    },
    size,
    { width: cols, height: rows },
  );
};

/** One tile's size, as a percentage of the drawn window. */
export const tileSizeInViewPct = (view: CameraWindow) => ({
  widthPct: (1 / view.cols) * 100,
  heightPct: (1 / view.rows) * 100,
});

/**
 * A board tile's centre as a percentage of the DRAWN window.
 *
 * Every overlay above the grid — zones, ice, traps, projectiles, damage numbers
 * — is positioned as a percentage of whatever box it is stretched over. That box
 * is the camera window, NOT the board. Dividing by `boardSize` was correct only
 * while the two were the same size; in Adventure the grid draws a 9x9 window
 * of a 20x20 floor, so every overlay was displaced by the window's origin and
 * drifted further off the further you walked from home.
 */
export const tileCentreInViewPct = (
  tile: Position,
  view: CameraWindow,
): { leftPct: number; topPct: number } => ({
  leftPct: ((tile.x - view.originX + 0.5) / view.cols) * 100,
  topPct: ((tile.y - view.originY + 0.5) / view.rows) * 100,
});

/** Whether a tile falls inside the drawn window; overlays outside it are skipped. */
export const tileVisibleInView = (tile: Position, view: CameraWindow): boolean =>
  tile.x >= view.originX && tile.x < view.originX + view.cols &&
  tile.y >= view.originY && tile.y < view.originY + view.rows;
