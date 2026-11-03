import { chebyshev, positionKey } from './board';
import { RANGER_ATTACK } from './constants';
import type { GameState, Unit } from './types';

/** Chance a Ranger lands a basic shot at the given Chebyshev distance. */
export const rangerAccuracyPercent = (distance: number): number =>
  Math.max(
    RANGER_ATTACK.minimumAccuracyPercent,
    RANGER_ATTACK.perfectAccuracyPercent - Math.max(0, distance - 1) * RANGER_ATTACK.accuracyLossPerTilePercent,
  );

/** A single instance of damage to be applied to one unit. */
export interface DamageEffect {
  unitId: string;
  amount: number;
  hpBefore: number;
  hpAfter: number;
  defeated: boolean;
}

/**
 * The living warrior currently shielding `unitId`, if any.
 *
 * Scans all units rather than keeping a back-reference on the guarded unit:
 * a squad is at most eight units, and one-directional state cannot drift out
 * of sync with its pair. Returns undefined when nobody is guarding.
 */
export const guardOf = (state: GameState, unitId: string): Unit | undefined => {
  for (const unit of state.units.values()) {
    if (unit.guardingUnitId !== unitId) continue;
    if (unit.stats.currentHp <= 0) continue;
    // A warrior that stepped away (or was teleported by a future effect) is no
    // longer covering anyone.
    const guarded = state.units.get(unitId);
    if (!guarded || chebyshev(unit.position, guarded.position) > 1) continue;
    return unit;
  }
  return undefined;
};

/**
 * Compute the full set of damage effects for `attacker` hitting `target`.
 *
 * - Non-AoE classes deal `attackDamage` to the target only.
 * - The Wizard (`areaOfEffect`) also splashes onto every tile within Chebyshev
 *   distance 1 of the target. Friendly fire is always on: the splash can hit
 *   allies and the caster, so the player has to aim around their own squad.
 * - Afterwards, any guarded unit's damage is redirected to its living,
 *   still-adjacent guardian (the Warrior's shield), which takes it instead.
 *
 * Pure: never mutates `state`.
 */
export const computeAttackEffects = (
  state: GameState,
  attacker: Unit,
  target: Unit,
): DamageEffect[] => {
  const primary = attacker.stats.attackDamage;
  const affected = new Map<string, number>();

  const add = (unit: Unit, amount: number) => {
    const existing = affected.get(unit.id);
    // If a unit is both the primary target and inside the splash, keep the
    // larger single hit rather than stacking (prevents double-dipping).
    affected.set(unit.id, Math.max(existing ?? 0, amount));
  };

  add(target, primary);

  if (attacker.stats.areaOfEffect) {
    for (const unit of state.units.values()) {
      if (unit.stats.currentHp <= 0) continue;
      if (chebyshev(unit.position, target.position) <= 1) {
        add(unit, primary);
      }
    }
  }

  // Warrior shield: a guarded ally's damage is soaked by its living guardian.
  // Runs after the AoE splash so the splash is what gets redirected, not a
  // partial amount. `guardOf` walks the roster because the guard is stored on
  // the warrior (`guardingUnitId`), not on the unit being covered.
  // `add` de-duplicates, so a guardian already caught in the blast takes the
  // larger of the two hits rather than both.
  for (const [id, amount] of Array.from(affected)) {
    const guardian = guardOf(state, id);
    if (!guardian) continue;
    affected.delete(id);
    add(guardian, amount);
  }

  const effects: DamageEffect[] = [];
  for (const [id, amount] of affected) {
    const unit = state.units.get(id);
    if (!unit || unit.stats.currentHp <= 0) continue;
    const hpAfter = Math.max(0, unit.stats.currentHp - amount);
    effects.push({
      unitId: id,
      amount,
      hpBefore: unit.stats.currentHp,
      hpAfter,
      defeated: hpAfter === 0,
    });
  }
  return effects;
};

/**
 * Apply pre-computed damage to a (already cloned) state, in place. Returns the
 * ids of units that were defeated by these effects.
 */
export const applyDamageEffects = (
  state: GameState,
  effects: DamageEffect[],
): string[] => {
  const defeated: string[] = [];
  for (const effect of effects) {
    const unit = state.units.get(effect.unitId);
    if (!unit) continue;
    unit.stats.currentHp = effect.hpAfter;
    if (effect.defeated) defeated.push(effect.unitId);
  }
  return defeated;
};

/** Clamp a heal so HP never exceeds maxHp. Returns the amount actually restored. */
export const restoreUnitHp = (unit: Unit, amount: number): number => {
  const before = unit.stats.currentHp;
  unit.stats.currentHp = Math.min(unit.stats.maxHp, before + amount);
  return unit.stats.currentHp - before;
};

/** Units that are still alive (HP > 0). */
export const livingUnits = (state: GameState, ownerId?: string): Unit[] =>
  Array.from(state.units.values()).filter(
    (unit) =>
      unit.stats.currentHp > 0 &&
      (ownerId === undefined || unit.ownerId === ownerId),
  );

/** Set of living unit ids, for O(1) occupancy checks in callers that need it. */
export const livingUnitIds = (state: GameState): Set<string> =>
  new Set(livingUnits(state).map((unit) => unit.id));

/** Human-readable key for a unit's tile (debug/log aids). */
export const unitTileKey = (unit: Unit): string => positionKey(unit.position);
