import {
  BASE_UNIT_STATS,
  CLERIC_HEAL_POWER,
  DEFAULT_BOARD_SIZE,
  DRAFTABLE_CLASSES,
  SQUAD_ROSTER,
} from './constants';
import { parseKey, positionKey } from './board';
import { generateWalls, altarSiteTilesFor } from './maps';
import type {
  BoardSize,
  Faction,
  GameState,
  MapMode,
  PlayerClass,
  Position,
  Tile,
  TileKind,
  Unit,
  UnitType,
  Zone,
  IceWall,
  Trap,
} from './types';

/** Wire/JSON shape of a GameState. `Map`s do not survive JSON, so we use arrays. */
export interface SerializedGameState {
  gameId: string;
  /** Optional: rooms persisted before floors were seeded read back as 0. */
  mapSeed?: number;
  /** Optional: rooms persisted before the choice existed default to CLASSIC. */
  mapMode?: MapMode;
  activePlayerId: string;
  turnNumber: number;
  boardSize: BoardSize;
  units: Unit[];
  terrain: Tile[];
  zones: Zone[];
  iceWalls: IceWall[];
  /** Only ever populated for the trap's owner; the server redacts the rest. */
  traps: Trap[];
  /** Souls harvested by the arena altar; absent on rooms persisted before it. */
  altarSouls?: number;
  /** Round each player last wished, keyed by player id. */
  altarWishTurns?: Record<string, number>;
  turnOrder: string[];
  /** Optional for backwards compatibility with rooms persisted before faction selection. */
  pickOrder?: string[];
  factions?: Record<string, Faction>;
  /**
   * Drafted squads, keyed by player id.
   *
   * Optional because rooms persisted before the draft existed have none. It MUST
   * round-trip: the first player's pick is serialized before the second player's
   * pick triggers deployment, so without it online play silently redeployed the
   * default Warrior/Wizard/Cleric/Ranger roster for whoever picked first.
   */
  squads?: Record<string, PlayerClass[]>;
  phase: GameState['phase'];
  winnerId: string | null;
  revision: number;
}

export const createUnit = (
  id: string,
  ownerId: string,
  type: UnitType,
  position: Position,
): Unit => {
  const base = BASE_UNIT_STATS[type];
  return {
    id,
    ownerId,
    type,
    position: { ...position },
    stats: { ...base },
    ...(type === 'CLERIC' ? { healPower: CLERIC_HEAL_POWER } : {}),
  };
};

/** Deterministic unit id — stable across client and server for ID-based commands. */
export const unitId = (ownerId: string, type: UnitType): string =>
  `${ownerId}:${type}`;

export const buildTerrain = (
  walls: Position[],
  kind: TileKind = 'WALL',
): Map<string, TileKind> => {
  const terrain = new Map<string, TileKind>();
  for (const wall of walls) terrain.set(positionKey(wall), kind);
  return terrain;
};

/**
 * Rebuild terrain from serialized tiles, honouring each tile's OWN kind.
 *
 * This exists because the obvious one-liner is wrong. It used to read:
 *
 *     buildTerrain(data.terrain.map((t) => t.position), data.terrain[0]?.kind)
 *
 * — one kind, taken from the first tile and applied to every position. That is
 * invisible today only because terrain is sparse and holds nothing but walls,
 * so all the kinds happened to be identical. It breaks the moment a third
 * `TileKind` exists: every tile in the rehydrated room silently becomes the first
 * tile's kind. Online matches are serialized server-side and rehydrated on every
 * single command, so that would corrupt live matches while local tests stayed
 * green.
 */
const buildTerrainEntries = (tiles: Tile[]): Map<string, TileKind> => {
  const terrain = new Map<string, TileKind>();
  for (const tile of tiles) terrain.set(positionKey(tile.position), tile.kind);
  return terrain;
};

/**
 * The classic arena: the hand-authored floor the game shipped with, restored
 * verbatim as the `CLASSIC` map mode.
 *
 * These are the original twelve walls — central 2x2 ruin, four corner pillars,
 * four mid-edge breaks. An earlier version of this file replaced them with a
 * generated-looking top-half-plus-rotation layout; that was a mistake, because
 * this map is the one players learned the game on and it is now a selectable
 * option rather than a fallback. Its shape is the point.
 *
 * Point-symmetric under a 180-degree rotation about the board centre, which is
 * what keeps the two spawn zones mechanically identical. The board is 12x10 and
 * the layout below is authored against that size directly, so the symmetry is
 * checked by `validateWalls` rather than assumed — a hand-authored map drifting
 * off the standard size is exactly how walls end up on a deployment row.
 */
export const defaultWallPositions = (): Position[] => [
  // Central ruin block — this block IS the Altar of Shadows (see `altar.ts`),
  // which is why the monument needs no terrain of its own.
  { x: 5, y: 4 },
  { x: 6, y: 4 },
  { x: 5, y: 5 },
  { x: 6, y: 5 },
  // Corner pillars (point symmetry)
  { x: 2, y: 2 },
  { x: 9, y: 7 },
  { x: 9, y: 2 },
  { x: 2, y: 7 },
  // Mid-edge breaks
  { x: 5, y: 2 },
  { x: 6, y: 7 },
  { x: 6, y: 2 },
  { x: 5, y: 7 },
];

/**
 * Walls for a match, honouring the chosen map mode.
 *
 * `CLASSIC` returns the hand-authored arena unchanged — the map that shipped
 * before procedural floors existed, so anyone who learned the game on it can
 * come back to it. `RANDOM` generates from the seed.
 *
 * Lives here rather than in `maps.ts` because the classic layout is authored in
 * this module, and `state.ts` already imports `maps.ts` — putting it the other
 * way round would be an import cycle.
 *
 * The seed is deliberately NOT rerolled when the mode changes: a match keeps the
 * seed it was dealt, so toggling back and forth is stable rather than producing a
 * new floor on every click.
 */
export const wallsForMode = (
  mode: MapMode,
  seed: number,
  size: BoardSize = DEFAULT_BOARD_SIZE,
): Position[] =>
  mode === 'CLASSIC'
    ? defaultWallPositions()
    : [
        ...generateWalls({ seed, size, fallback: defaultWallPositions() }),
        // The floor's monuments are terrain from the first frame, not something
        // a renderer adds later: an altar tile has to be stone for pathing.
        ...altarSiteTilesFor(seed, size),
      ];

export interface CreateGameConfig {
  gameId: string;
  /**
   * Turn priority. Index 0 moves first. Must contain at least two ids.
   */
  playerIds: string[];
  /** Defaults to playerIds; online rooms provide an independently randomized order. */
  pickOrder?: string[];
  boardSize?: BoardSize;
  /**
   * Explicit wall layout. Skips generation entirely — used by tests that need a
   * specific floor, and by the generator's own fallback path.
   */
  walls?: Position[];
  /**
   * Floor seed. Only consulted when `walls` is omitted; the same seed always
   * yields the same floor.
   *
   * WARNING: this defaults to 0, so a caller that omits it gets the SAME floor
   * every time, silently. That is what `startGame` in `useSquareOfShadows` did
   * when procedural floors first landed — online duels varied (the server seeds
   * those) while AI and hotseat play never did, which reads exactly like
   * generation working. Every caller building a real match must pass a seed;
   * only tests and the generator's own fallback may rely on the default.
   */
  mapSeed?: number;
  /**
   * Which floor to build. Defaults to `CLASSIC` — the original
   * hand-authored arena. A new match should look like the game always looked;
   * procedural biomes are the opt-in variation, not the baseline.
   *
   * Ignored when `walls` is supplied — an explicit layout wins, so tests and the
   * generator's fallback can pin a board without caring which mode claims it.
   */
  mapMode?: MapMode;
}

/**
 * Create an empty match in the `deployment` phase. Squads are added separately
 * via {@link deploySquad}, then {@link startMatch} flips it to `playing`.
 */
export const createInitialState = ({
  gameId,
  playerIds,
  pickOrder = playerIds,
  boardSize = DEFAULT_BOARD_SIZE,
  walls,
  mapSeed = 0,
  mapMode = 'CLASSIC',
}: CreateGameConfig): GameState => ({
  gameId,
  mapSeed,
  mapMode,
  activePlayerId: pickOrder[0] ?? playerIds[0] ?? '',
  turnNumber: 1,
  boardSize,
  units: new Map(),
  terrain: buildTerrain(
    walls ?? wallsForMode(mapMode, mapSeed, boardSize),
  ),
  zones: [],
  iceWalls: [],
  traps: [],
  altarSouls: 0,
  altarWishTurns: {},
  turnOrder: [...playerIds],
  pickOrder: [...pickOrder],
  factions: {},
  phase: 'deployment',
  winnerId: null,
  revision: 0,
});

/**
 * Deployment rows per player index: player 0 defends the bottom, player 1 the
 * top. Returns the four tiles a squad should occupy for the given player.
 */
export const deploymentTiles = (
  playerIndex: number,
  boardSize: BoardSize = DEFAULT_BOARD_SIZE,
): Position[] => {
  const row = playerIndex === 0 ? boardSize.height - 1 : 0;
  const middle = Math.floor(boardSize.width / 2);
  // Two columns either side of centre → four spread-out tiles.
  return [middle - 2, middle - 1, middle, middle + 1].map((x) => ({ x, y: row }));
};

/**
 * Place a full 4-class squad for a player onto their deployment row.
 *
 * `tiles` overrides the row rule. Adventure needs it because its two squads
 * deploy side by side in one corner instead of on opposite edges; duels never
 * pass it and keep the shared `deploymentTiles` rule.
 */
export const deploySquad = (
  state: GameState,
  playerId: string,
  playerIndex: number,
  tiles?: Position[],
  squad?: PlayerClass[],
): GameState => {
  const next = cloneState(state);
  const spots = tiles ?? deploymentTiles(playerIndex, next.boardSize);
  const roster = squad ?? SQUAD_ROSTER.slice(0, 4);
  roster.forEach((type, i) => {
    // A drafted squad may hold the same class twice, and the id used to be
    // `${player}:${type}` — so the second copy overwrote the first and the squad
    // deployed three units. Suffix only the collision, so single copies keep the
    // stable id the rest of the app (and the tests) expect.
    const base = unitId(playerId, type);
    const id = next.units.has(base) ? `${base}#${i}` : base;
    const unit = createUnit(id, playerId, type, spots[i]);
    next.units.set(unit.id, unit);
  });
  return next;
};

/**
 * The squad the solo AI drafts.
 *
 * Two classic classes and two of the newer ones, picked from the match seed so
 * the same duel always fields the same opponent. Without this the AI drafted no
 * squad at all and fell back to `SQUAD_ROSTER`, which meant its Paladin/Bard/
 * Warlock/Druid/Rogue code paths were unreachable in the only mode the AI is
 * played in.
 */
export const aiSquadFor = (seed: number): PlayerClass[] => {
  const s = Math.abs(Math.trunc(seed)) || 0;
  const newcomers = DRAFTABLE_CLASSES.filter((type) => !SQUAD_ROSTER.includes(type));
  return [
    SQUAD_ROSTER[s % SQUAD_ROSTER.length],
    SQUAD_ROSTER[(s + 2) % SQUAD_ROSTER.length],
    newcomers[s % newcomers.length],
    newcomers[(s + 2) % newcomers.length],
  ];
};

/** Flip a fully-deployed match into the active turn loop. */export const startMatch = (state: GameState): GameState => {
  const next = cloneState(state);
  next.phase = 'playing';
  next.activePlayerId = next.turnOrder[0] ?? next.activePlayerId;
  next.revision += 1;
  return next;
};

/**
 * True when the active player has nothing left to do this turn.
 *
 * Lives here rather than in the component because it is a rule, not a view: the
 * client uses it to arm the auto-end countdown.
 *
 * A turn is eight points, not four: every unit has TWO of them, one for movement
 * and one for its action, and the countdown must not start while any one of the
 * eight is unspent. The previous rule watched `hasMoved` alone, which read four
 * units that had each walked but not yet swung as a finished turn — the
 * countdown armed with one action still unspent and skipped it. Since the point
 * of the countdown is "you are done", it has to mean done.
 *
 * The two flags are genuinely independent: `applyMove` sets `hasMoved`, attacks
 * and casts set `hasAttacked`, and neither implies the other. A caster that has
 * never stepped still has movement left, so the countdown correctly waits.
 *
 * Two units cannot use a point they still nominally hold, and are treated as
 * having spent it:
 *
 *  - A ROOTED unit. `applyMove` rejects the move outright, so leaving
 *    `hasMoved` false would strand the countdown forever behind a trap.
 *  - A FROZEN unit is deliberately NOT excused. The freeze only bars re-entering
 *    the ice; the reachability flood seeds from the unit's own tile, so it can
 *    still walk out. Excusing it here would start the countdown on a unit that
 *    really can still move — the premature skip this rule exists to prevent.
 *
 * `false` when the player has no living units at all. That is a state worth
 * looking at rather than one to resolve automatically.
 */
export const allActiveUnitsSpent = (state: GameState): boolean => {
  const units = Array.from(state.units.values()).filter(
    (u) => u.ownerId === state.activePlayerId && u.stats.currentHp > 0,
  );
  return (
    units.length > 0 &&
    units.every((u) => {
      const canStillMove = !u.hasMoved && (u.rootedTurns ?? 0) <= 0;
      const canStillAct = !u.hasAttacked;
      return !canStillMove && !canStillAct;
    })
  );
};

/** Deep-enough clone: Maps and the mutable unit objects are copied. */
export const cloneState = (state: GameState): GameState => ({
  ...state,
  units: new Map(
    Array.from(state.units.entries()).map(([id, unit]) => [
      id,
      { ...unit, position: { ...unit.position }, stats: { ...unit.stats } },
    ]),
  ),
  terrain: new Map(state.terrain),
  zones: state.zones.map((zone) => ({ ...zone })),
  iceWalls: state.iceWalls.map((wall) => ({ ...wall })),
  traps: state.traps.map((trap) => ({ ...trap })),
  altarSouls: state.altarSouls ?? 0,
  altarWishTurns: { ...(state.altarWishTurns ?? {}) },
  turnOrder: [...state.turnOrder],
  pickOrder: [...state.pickOrder],
  factions: { ...state.factions },
});

export const serializeGameState = (state: GameState): SerializedGameState => ({
  gameId: state.gameId,
  mapSeed: state.mapSeed,
  mapMode: state.mapMode ?? 'RANDOM',
  activePlayerId: state.activePlayerId,
  turnNumber: state.turnNumber,
  boardSize: { ...state.boardSize },
  units: Array.from(state.units.values()).map((unit) => ({
    ...unit,
    position: { ...unit.position },
    stats: { ...unit.stats },
  })),
  terrain: Array.from(state.terrain.entries()).map(([key, kind]) => ({
    position: parseKey(key),
    kind,
  })),
  zones: state.zones.map((zone) => ({ ...zone })),
  iceWalls: state.iceWalls.map((wall) => ({ ...wall })),
  traps: state.traps.map((trap) => ({ ...trap })),
  altarSouls: state.altarSouls ?? 0,
  altarWishTurns: { ...(state.altarWishTurns ?? {}) },
  turnOrder: [...state.turnOrder],
  pickOrder: [...state.pickOrder],
  factions: { ...state.factions },
  squads: { ...(state.squads ?? {}) },
  phase: state.phase,
  winnerId: state.winnerId,
  revision: state.revision,
});

export const deserializeGameState = (
  data: SerializedGameState,
): GameState => ({
  gameId: data.gameId,
  mapSeed: data.mapSeed ?? 0,
  mapMode: data.mapMode ?? 'CLASSIC',
  activePlayerId: data.activePlayerId,
  turnNumber: data.turnNumber,
  boardSize: { ...data.boardSize },
  units: new Map(
    data.units.map((unit) => [
      unit.id,
      { ...unit, position: { ...unit.position }, stats: { ...unit.stats } },
    ]),
  ),
  terrain: buildTerrainEntries(data.terrain),
  // Tolerate older payloads (rooms persisted before these fields existed).
  zones: (data.zones ?? []).map((zone) => ({ ...zone })),
  // `ownerId` post-dates this field, so a room persisted by an older build has
  // walls with none. They become unowned (''), which the one-wall-per-caster
  // rule then leaves untouched rather than melting ice it cannot attribute.
  iceWalls: (data.iceWalls ?? []).map((wall) => ({ ...wall, ownerId: wall.ownerId ?? '' })),
  traps: (data.traps ?? []).map((trap) => ({ ...trap })),
  altarSouls: data.altarSouls ?? 0,
  altarWishTurns: { ...(data.altarWishTurns ?? {}) },
  turnOrder: [...data.turnOrder],
  pickOrder: [...(data.pickOrder ?? data.turnOrder)],
  factions: { ...(data.factions ?? {}) },
  squads: data.squads ? { ...data.squads } : undefined,
  phase: data.phase,
  winnerId: data.winnerId,
  revision: data.revision,
});
