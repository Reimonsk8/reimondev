/**
 * Combat animation timing.
 *
 * Everything here is pure and derived from the *geometry* of the attack, so the
 * renderer can delay an impact to the exact moment a projectile lands instead of
 * firing every effect on the same frame the command resolved.
 *
 * The bug this exists to fix: blood, hit flash, damage number, board shake and
 * the hit sound all used to fire at t=0 while the arrow was still in mid-air, so
 * the impact read as happening before the attack did.
 */

/** A board position. Kept structural so the engine's `Position` fits directly. */
export interface TilePosition {
  x: number;
  y: number;
}

/** Tiles between two squares, counting diagonals as one step (Chebyshev). */
export const chebyshevSteps = (from: TilePosition, to: TilePosition): number =>
  Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));

/** Fastest a projectile may cross: a flick, not a teleport. */
export const TRAVEL_MIN_MS = 130;
/** Slowest: a long shot should still feel like it is going somewhere. */
export const TRAVEL_MAX_MS = 520;
/** Milliseconds of flight per tile crossed. */
export const TRAVEL_PER_TILE_MS = 95;

/**
 * How long a travelling sprite takes to reach its target. Scales with distance so
 * a one-tile Wizard bolt does not crawl for as long as a six-tile arrow.
 */
export const travelMsFor = (from: TilePosition, to: TilePosition): number => {
  const raw = TRAVEL_PER_TILE_MS * Math.max(1, chebyshevSteps(from, to));
  return Math.min(TRAVEL_MAX_MS, Math.max(TRAVEL_MIN_MS, Math.round(raw)));
};

/**
 * Adjacent melee classes. The Warrior, the Cleric and the Beast all have a
 * basic attack range of exactly 1 tile, so every basic attack they make is a
 * melee strike — there is never a gap for a projectile to cross, and the
 * impact lands on the sprite's own strike frame instead of after a travel
 * delay. The Spitter is deliberately absent: its reach is 2, so its spit flies.
 */
export const isMeleeClass = (unitType: string | undefined): boolean =>
  unitType === 'WARRIOR' || unitType === 'CLERIC' || unitType === 'BEAST';

/**
 * Windup before a melee blow lands. This is the strike frame of the sprite's
 * own attack row, so the impact syncs with the swing rather than leading it.
 */
export const MELEE_IMPACT_MS = 110;

/**
 * Delay from the start of an attack to the moment it lands.
 *
 * Melee resolves at the strike frame; ranged waits for the projectile.
 */
export const impactDelayFor = (
  attackerPos: TilePosition,
  targetPos: TilePosition,
  unitType: string | undefined,
): number => (isMeleeClass(unitType) ? MELEE_IMPACT_MS : travelMsFor(attackerPos, targetPos));

/**
 * How far the attacker steps toward its target, as a fraction of one tile.
 *
 * Melee commits — it nearly reaches the target, which is what sells the
 * connection. Ranged barely shifts, so a Wizard does not appear to lurch at
 * somebody six squares away.
 */
export const lungeDistanceFor = (unitType: string | undefined): number =>
  isMeleeClass(unitType) ? 0.26 : 0.08;

/**
 * Hit-stop: the brief freeze that gives a blow its weight. Zero when the player
 * has asked for reduced motion, because freezing everything reads as a glitch.
 */
export const hitStopMsFor = (damage: number, reducedMotion = false): number => {
  if (reducedMotion || damage <= 0) return 0;
  return Math.min(110, Math.round(45 + damage * 7));
};

/** Damage below this does not move the board at all. */
export const SHAKE_MIN_DAMAGE = 3;

export interface ShakeSpec {
  /** Peak translation in pixels. */
  amp: number;
  /** How long the shake lasts. */
  durMs: number;
}

/**
 * Board shake scaled to how hard the hit landed. Chip damage deliberately does
 * not shake at all — a board that rattles on every 1-damage tick reads as broken
 * and drowns out the hits that actually matter.
 */
export const shakeFor = (damage: number, reducedMotion = false): ShakeSpec | null => {
  if (reducedMotion || damage < SHAKE_MIN_DAMAGE) return null;
  return {
    amp: Math.min(7, Math.max(2, Math.round(damage * 0.55))),
    durMs: Math.min(320, 150 + Math.round(damage * 14)),
  };
};

/** Extra shake a killing blow adds on top of the damage-scaled shake. */
export const KILL_SHAKE_BONUS = { amp: 3, durMs: 120 };

/** Read the player's motion preference once per call site; cheap and always current. */
export const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};