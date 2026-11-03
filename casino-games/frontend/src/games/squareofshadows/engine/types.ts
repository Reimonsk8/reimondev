/**
 * Square of Shadows — Phase 1 core domain types.
 *
 * These are the shared contracts for the turn-based tactical grid engine. They
 * are deliberately pure (no React, no AWS, no DOM) so the exact same module can
 * later run inside a Lambda for server-authoritative validation — the client
 * and the server must agree on every rule, so the rules live here once.
 *
 * Convention: coordinates are integer tile indices. `x` is the column
 * (0..width-1, left→right) and `y` is the row (0..height-1, top→bottom).
 * All grid distances (move reach + attack range) are **Chebyshev** distance —
 * the tactical standard, where a diagonal step costs 1 and a range-1 melee
 * reaches all 8 neighbouring tiles.
 */

/** A single tile coordinate on the grid. */
export interface Position {
  x: number;
  y: number;
}

/** Board dimensions in tiles. */
export interface BoardSize {
  width: number;
  height: number;
}

/** Per-unit combat/movement numbers. Mutable during a match. */
export interface UnitStats {
  maxHp: number;
  currentHp: number;
  /** How many tiles the unit may travel in one move action (Chebyshev steps). */
  moveReach: number;
  /** Maximum Chebyshev distance at which the unit may attack. */
  attackRange: number;
  /** Basic attack damage; Ranger stores its 6-damage ceiling (see RANGER_ATTACK). */
  attackDamage: number;
  /** `true` for the Wizard's area-of-effect attack (hits target + neighbours). */
  areaOfEffect?: boolean;
  /**
   * `true` to restrict the basic attack to the four ORTHOGONAL neighbours.
   *
   * A claw reaches the tiles directly north, south, east and west and no further
   * — a diagonal target is out of reach even though it is only one tile away.
   * That is what makes a monster readable: it threatens a plus shape and never
   * the corners of it, so standing diagonally beside one is genuinely safe and
   * the tiles it can reach are always the four you can see.
   *
   * Lives on the stats rather than being derived from `type` so the reach rule
   * travels with the unit and the four places that have to agree (reducer
   * validation, `attackRangeTiles`, the AI's `canAttackFrom`, the tooltip) all
   * read one source. See `canReachTile`.
   */
  orthogonalAttackOnly?: boolean;
}

/** The four playable archetypes. */
export type PlayerClass = 'WARRIOR' | 'WIZARD' | 'CLERIC' | 'RANGER' | 'PALADIN' | 'BARD' | 'WARLOCK' | 'DRUID' | 'ROGUE';

/**
 * The two monster archetypes. Never draftable, never given abilities.
 *
 * Its own alias so the places that only ever deal with monsters (the skin table,
 * the garrison roster) cannot accidentally accept a player class.
 */
export type MonsterType = 'BEAST' | 'SPITTER';

/**
 * Every unit archetype, playable or not.
 *
 * The monsters used to borrow player classes outright — a "monster Cleric" that
 * healed and blessed the ground, a "monster Wizard" that threw Fireball — which
 * meant an adventure's garrison fought with the full class kit and read as a
 * squad rather than as a bestiary. Splitting the union lets a monster be a
 * monster: its own stats, one attack, no abilities.
 */
export type UnitType = PlayerClass | MonsterType;

/** Cosmetic squad skin; both factions use identical rules and stats. */
export type Faction = 'INQUISITORS' | 'PENITENT_COURT';

/** An owned, living unit on the board. */
export interface Unit {
  id: string;
  ownerId: string;
  type: UnitType;
  position: Position;
  stats: UnitStats;
  /** Cleric only: amount restored by a HEAL action. */
  healPower?: number;
  /**
   * Warrior only: id of the adjacent ally this unit is currently shielding.
   * Damage aimed at that ally is redirected here while the two stay adjacent.
   * One-directional on purpose — a back-reference would need two-way syncing,
   * and with at most eight units `guardOf` is cheaper than keeping it correct.
   */
  guardingUnitId?: string | null;
  /** Ranger trap: turns the unit cannot move, remaining. */
  rootedTurns?: number;
  /** Shield Slam wall impact: the unit forfeits its next action. */
  stunnedTurns?: number;
  /** Paladin Divine Shield: temporary shield HP. */
  shieldHp?: number;
  /** Paladin Holy Light: enemy's next attack misses. */
  blindedTurns?: number;
  /** Warlock/Rogue: poison DoT turns remaining. */
  poisonedTurns?: number;
  /** Warlock Curse of Agony: turns remaining. */
  cursedTurns?: number;
  /** Warlock Curse of Agony: damage per turn. */
  curseDamage?: number;
  /** Bard Inspiring Anthem: turns remaining. */
  inspiredTurns?: number;
  /** Bard/Druid: regen turns remaining. */
  regenTurns?: number;
  /** Bard/Druid: regen amount per turn. */
  regenAmount?: number;
  /** Last movement direction (dx, dy) for facing-based crits. */
  facing?: { x: number; y: number };
  /** True once the unit has spent its action (move or attack) this turn. */
  hasActed?: boolean;
  /** True once the unit has moved this turn, so it cannot move again. */
  hasMoved?: boolean;
  /** True once the unit has attacked this turn, so it cannot attack again. */
  hasAttacked?: boolean;
}

/** Static terrain classification for a tile. */
export type TileKind = 'FLOOR' | 'WALL';

/**
 * Which floor a match plays on.
 *
 * - `RANDOM` — a fresh mirrored procedural floor, seeded per match.
 * - `CLASSIC` — the hand-authored arena, byte-for-byte the map the game shipped
 *   with before generation existed. Point-symmetric, so the two spawn zones stay
 *   identical for both sides.
 *
 * Purely a choice of terrain: it changes no unit, no rule, and no stat, so it
 * can be flipped freely during the faction draft by either player without
 * affecting fairness. Once the match is running it is locked, because walls are
 * baked into the board and swapping them mid-duel would move units.
 */
export type MapMode = 'CLASSIC' | 'RANDOM';

/** A board-wide effect owned by a player. */
export type ZoneKind = 'SANCTIFIED_GROUND';

/**
 * A persistent area effect (Cleric: Sanctified Ground).
 *
 * Anchored at its top-left tile and covering `size` x `size` tiles. Lives on
 * the board rather than on a unit because it outlives the caster and keeps
 * ticking between turns.
 */
export interface Zone {
  id: string;
  kind: ZoneKind;
  ownerId: string;
  /** Centre tile of the area. */
  x: number;
  y: number;
  /** Legacy field from the old square shape. Coverage uses the fixed plus in
   * `zoneTiles`; kept only so rooms serialized before the change still parse. */
  size: number;
  /** Remaining turns before it fades. Ticks down when the board resolves. */
  durationTurns: number;
}

/**
 * A temporary ice tile raised by the Wizard.
 *
 * Tracked separately from `terrain` precisely because it must be removable:
 * static walls are permanent, ice melts. Both block movement and line of
 * sight, so `isWall` consults both.
 */
export interface IceWall {
  x: number;
  y: number;
  /** Turn hand-overs remaining before it melts. */
  expiresInTurns: number;
  /**
   * Who raised it.
   *
   * Needed for the one-wall-per-caster rule: casting again melts your previous
   * wall and raises a new one, the same bargain Sanctified Ground makes. Without
   * an owner there is nothing to attribute a wall to, so re-casting simply
   * stacked a second wall next to the first.
   *
   * `''` means a wall from before this field existed — a room persisted by an
   * older build. Those are never removed by the replacement rule, because we
   * cannot know whose they were and melting another player's ice would be worse
   * than leaving it.
   */
  ownerId: string;
}

/**
 * A hidden tile trap (Ranger: Trap Placement).
 *
 * `armed` traps are invisible to the opponent — see `redactStateForPlayer`,
 * which the server uses so a trap never leaks through the wire.
 */
export interface Trap {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  /** False once it has triggered, so it cannot chain-trigger. */
  armed: boolean;
}

/** A serialisable terrain cell (network + persistence friendly). */
export interface Tile {
  position: Position;
  kind: TileKind;
}

/** High-level match lifecycle. */
export type GamePhase = 'lobby' | 'deployment' | 'playing' | 'ended';

/** Server-authoritative match state. Mirrors the client's optimistic state. */
export interface GameState {
  gameId: string;
  /**
   * Seed the floor was generated from.
   *
   * Stored so a match is reproducible and so cosmetic tile decor can be derived
   * from the seed on both clients instead of being stored per tile. Rooms
   * serialized before this existed read back as 0.
   */
  mapSeed: number;
  /**
   * Which floor this match plays on. `RANDOM` unless a player picks `CLASSIC`
   * during the faction draft. Optional on the wire so rooms persisted before the
   * choice existed still load.
   */
  mapMode?: MapMode;
  /** Player whose turn it currently is. */
  activePlayerId: string;
  /** 1-based turn counter (increments each time initiative passes to player 1). */
  turnNumber: number;
  boardSize: BoardSize;
  /** Living (and dead-but-present) units keyed by unit id. */
  units: Map<string, Unit>;
  /** Static walls, keyed by "x,y". */
  terrain: Map<string, TileKind>;
  /** Board-wide area effects (Sanctified Ground). */
  zones: Zone[];
  /** Temporary Wizard ice. Melts away as turns pass. */
  iceWalls: IceWall[];
  /** Hidden tile traps. Redacted per player by the server. */
  traps: Trap[];
  /**
   * Souls the arena altar has harvested.
   *
   * Every unit that falls anywhere on the board feeds it; a wish spends one.
   * Always 0 on a floor with no altar (Adventure).
   */
  altarSouls: number;
  /**
   * Per player, the round in which they last took a wish.
   *
   * `turnNumber` counts rounds, so one entry per player is exactly "one wish per
   * turn cycle": a second wish in the same round is refused.
   */
  altarWishTurns: Record<string, number>;
  /** Ordered list of player ids = turn priority. */
  turnOrder: string[];
  /** Randomized faction draft order; during deployment activePlayerId is the picker. */
  pickOrder: string[];
  /** Cosmetic faction selection, keyed by player id. */
  factions: Record<string, Faction>;
  /** Drafted squad (4 classes) per player, keyed by player id. Falls back to SQUAD_ROSTER. */
  squads?: Record<string, PlayerClass[]>;
  phase: GamePhase;
  /** Set when the match is decided. */
  winnerId: string | null;
  /** Monotonic revision, bumped on every accepted mutation (client reconciliation). */
  revision: number;
}

/** Random source seam; multiplayer injects server crypto, tests inject fixed rolls. */
export type Rng = () => number;
