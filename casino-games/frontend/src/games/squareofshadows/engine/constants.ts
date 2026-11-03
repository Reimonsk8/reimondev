import type { BoardSize, PlayerClass, UnitStats, UnitType } from './types';

/**
 * The board standard for every map: 12 wide, 10 tall.
 *
 * Wider than tall on purpose. Squads deploy on four tiles across (see
 * `deploymentTiles`), so a narrow board would squeeze two squads onto the same
 * columns, and 12x10 keeps both spawn rows clear with room between them.
 *
 * This is the single source of truth — the generator, validation, deployment
 * rows and serialization all read it, so changing it here moves every map.
 * The renderer sizes itself from the same value, so the board frame and the
 * grid cannot disagree about how many tiles there are.
 */
export const DEFAULT_BOARD_SIZE: BoardSize = { width: 12, height: 10 };

/** Squad size per player. */
export const UNITS_PER_SQUAD = 4;

/**
 * The Altar of Shadows is a 2x2 monument, on the arena and in Adventure alike.
 * Shared here because the map generator places the Adventure ones and the
 * renderer splits the sprite by it — one number, or the quads drift.
 */
export const ALTAR_SIZE = 2;

/**
 * Base stat table for each class. Values are Phase 1 balance numbers — tweak
 * here only, never inline in the UI or the handlers, so client/server stay in
 * lockstep.
 */
export const BASE_UNIT_STATS: Record<UnitType, UnitStats> = {
  WARRIOR: {
    maxHp: 30,
    currentHp: 30,
    moveReach: 2,
    attackRange: 1,
    attackDamage: 8,
  },
  WIZARD: {
    maxHp: 14,
    currentHp: 14,
    moveReach: 3,
    // Manhattan, and diagonals cost 2 — so this is one tile straight OR one
    // diagonal from the caster. It was 4, which let a Wizard hit across half the
    // board with a 14 HP body; at 2 the class trades its reach for staying out
    // of contact, and its spells (Fireball 3, Thunder 4) remain the real reach.
    attackRange: 2,
    attackDamage: 4,
    areaOfEffect: true,
  },
  CLERIC: {
    maxHp: 20,
    currentHp: 20,
    moveReach: 2,
    attackRange: 1,
    attackDamage: 5,
  },
  RANGER: {
    maxHp: 16,
    currentHp: 16,
    moveReach: 4,
    attackRange: 6,
    attackDamage: 6,
  },
  PALADIN: {
    maxHp: 28,
    currentHp: 28,
    moveReach: 2,
    attackRange: 2,
    attackDamage: 6,
  },
  BARD: {
    maxHp: 16,
    currentHp: 16,
    moveReach: 4,
    attackRange: 3,
    attackDamage: 4,
  },
  WARLOCK: {
    maxHp: 12,
    currentHp: 12,
    moveReach: 2,
    attackRange: 4,
    attackDamage: 5,
  },
  DRUID: {
    maxHp: 20,
    currentHp: 20,
    moveReach: 3,
    attackRange: 2,
    attackDamage: 5,
  },
  ROGUE: {
    maxHp: 14,
    currentHp: 14,
    moveReach: 3,
    attackRange: 2,
    attackDamage: 6,
  },
  /*
   * ── monsters ──
   *
   * Not playable and not draftable — these exist so the adventure garrison can
   * be a bestiary instead of four player classes in monster paint. Both have
   * exactly one attack and no abilities at all, which is the whole point: the
   * "monster Cleric" used to heal and bless the ground and the "monster Wizard"
   * threw Fireball across the board.
   *
   * Numbers are deliberately below the player classes. Four monsters that only
   * bite and spit, with nothing else, would be trivial to walk past if they hit
   * as hard as a Warrior — and a monster that closes to reach you has already
   * given up the distance advantage, so it pays for that in damage.
   */
  BEAST: {
    maxHp: 22,
    currentHp: 22,
    moveReach: 2,
    attackRange: 1,
    attackDamage: 6,
    // Claw: the four orthogonal neighbours only. A diagonal target is out of
    // reach however close it looks, so a beast threatens a plus and never its
    // corners — standing beside one diagonally is genuinely safe.
    orthogonalAttackOnly: true,
  },
  SPITTER: {
    maxHp: 14,
    currentHp: 14,
    moveReach: 2,
    // Manhattan like the Wizard, so reach 2 means "one tile straight, or one
    // diagonal" — the same bargain, with a far worse payoff for it.
    attackRange: 2,
    attackDamage: 4,
  },
};

/** Ranger basic-attack rules: close shots are certain; each extra tile costs 10%. */
export const RANGER_ATTACK = {
  minDamage: 4,
  maxDamage: 6,
  perfectAccuracyPercent: 100,
  minimumAccuracyPercent: 50,
  accuracyLossPerTilePercent: 10,
} as const;

/** Cleric heal amount (kept out of UnitStats so it is class, not per-instance). */
export const CLERIC_HEAL_POWER = 10;
export const CLERIC_HEAL_RANGE = { straight: 2, diagonal: 1 } as const;

/**
 * Ability balance. Kept beside BASE_UNIT_STATS for the same reason: the client
 * tooltip and the authoritative server must quote the same numbers.
 */
export const ABILITIES = {
  /**
   * Wizard: heavy area damage over a `size`x`size` block centred on the target,
   * shorter reach than the basic attack.
   *
   * Two tiers: the aimed tile takes `damage`, the ring takes `splash`. It used to
   * be a flat 12 across the whole block, which made it strictly the best thing
   * the Wizard owned — more than Thunder Strike's line, on every target in
   * reach. Now it is the strongest *single* hit, and the ring rewards lining
   * enemies up rather than being the main event.
   */
  FIREBALL: { damage: 8, splash: 4, range: 3, size: 3 },
  /**
   * Wizard: a line of tiles centred on the target, damaging everything caught
   * in it. Rewards lining up several enemies on one row or column.
   */
  THUNDER_STRIKE: { damage: 7, range: 4, tiles: 3 },
  /** Cleric: 2x2 zone that regens allies, blunts their damage and burns foes. */
  // `size` is kept for wire compatibility with rooms serialized before the
  // shape changed from a 2x2 square to a plus; the coverage maths ignores it
  // and uses the fixed cross in `zoneTiles`.
  SANCTIFIED_GROUND: { size: 1, range: 3, durationTurns: 2, regen: 4, radiantDamage: 3, damageReduction: 0.25 },
  /** Wizard: impassable ice tile that melts after a few turn hand-overs. */
  ICE_WALL: { range: 3, durationTurns: 3 },
  /**
   * Ranger: a hidden trap that roots whoever steps on it. Placed on the 3x3 block
   * around the ranger, so `range: 1` is Chebyshev 1 in every direction — a trap
   * is something you set at your feet, never something you lob across the map.
   */
  TRAP: { range: 1 },
  /** Ranger: how long a triggered root lasts. */
  TRAP_ROOT_TURNS: 1,
  /**
   * Ranger: grapple to a wall. `range` measures to the hooked wall, and the hook
   * only reaches straight up, down, left or right — no diagonals, so the rope
   * always reads as one clean line and the landing spot stays predictable.
   *
   * The same hook also takes a *unit* within range, dragging them to a free tile
   * beside the Ranger. That is an offensive play, so it spends the action rather
   * than the move; the wall swing spends the move. Without that split the Ranger
   * could pull a victim next to an ally and have that ally attack for free.
   */
  GRAPPLE: { range: 4 },
  /** Warrior: slam an adjacent tile. Friendly fire is always on. */
  SHIELD_SLAM: { range: 1 },
  /** Paladin: melee smite (10 total at range 1: 6 base + 4 magic) or ranged (4 magic at range 2). */
  HOLY_SMITE: { meleeDamage: 10, rangedDamage: 4, meleeRange: 1, rangedRange: 2, healAdjacent: 2, range: 2 },
  /** Paladin: defensive shield on self + adjacent allies in a 5-tile cross (center + N/S/E/W). */
  DIVINE_SHIELD: { range: 1, shieldHp: 8, durationTurns: 2 },
  /** Paladin: heal ally 5 HP, or blind enemy (next attack misses) at range 3. */
  HOLY_LIGHT: { range: 3, heal: 5 },
  /** Rogue: Backstab (6 dmg, 12 from behind/flank), Shadow Step (teleport 3), Poisoned Dagger (4 dmg + poison DoT). */
  BACKSTAB: { damage: 6, critDamage: 12, range: 1 },
  SHADOW_STEP: { range: 3 },
  POISONED_DAGGER: { damage: 4, range: 2, poisonDamage: 2, poisonTurns: 2 },
  /** Bard: Dissonant Melody (ranged sonic push), Inspiring Anthem (buff), Song of Rest (HoT 3x3). */
  DISSONANT_MELODY: { damage: 3, range: 3, push: 1 },
  INSPIRING_ANTHEM: { range: 2 },
  SONG_OF_REST: { size: 3, regen: 3, range: 2 },
  /** Warlock: Eldritch Bolt, Curse of Agony (DoT), Soul Drain. */
  ELDRITCH_BOLT: { damage: 7, range: 4 },
  CURSE_OF_AGONY: { dot: 3, turns: 2, range: 3 },
  SOUL_DRAIN: { damage: 5, heal: 5, range: 3 },
  /** Druid: Thorn Whip, Regrowth, Roots of Entanglement. */
  THORN_WHIP: { damage: 4, range: 3, pull: 1 },
  REGROWTH: { heal: 6, range: 2 },
  ROOTS_OF_ENTANGLEMENT: { range: 3 },
} as const;

/** The canonical roster order used when deploying a fresh squad. */
/**
 * The four archetypes a squad is drafted from.
 *
 * `PlayerClass`, not `UnitType`: the monsters are unit types too, and letting
 * them into the draft roster would put a Beast in a player's squad.
 */
export const SQUAD_ROSTER: PlayerClass[] = ['WARRIOR', 'WIZARD', 'CLERIC', 'RANGER'];
export const DRAFTABLE_CLASSES: PlayerClass[] = ['WARRIOR', 'WIZARD', 'CLERIC', 'RANGER', 'PALADIN', 'BARD', 'WARLOCK', 'DRUID', 'ROGUE'];

/** 8-directional neighbour offsets (Chebyshev movement). */
export const NEIGHBOUR_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
];
