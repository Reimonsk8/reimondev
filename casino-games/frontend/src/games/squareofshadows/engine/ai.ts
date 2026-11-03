import { chebyshev, computeReachable, hasLineOfSight, manhattan, positionKey } from './board';
import { computeAttackEffects, livingUnits, rangerAccuracyPercent } from './combat';
import { abilityAffectedTiles, canReachTile, isFrozen } from './abilities';
import { ABILITIES, RANGER_ATTACK } from './constants';
import {
  legalAbilityTargetsFor,
  legalAttackTargetsFor,
  legalHealTargetsFor,
  legalMovesFor,
} from './reducer';
import type { AbilityId, GameCommand } from './protocol';
import type { GameState, Position, Rng, Unit } from './types';

/**
 * Opponent policy.
 *
 * Weighted, not deterministic. Every command is still legal and every rule is
 * still the engine's, but which of several valid targets an enemy picks is a
 * weighted roll (rng injected, `Math.random` by default) rather than a fixed
 * sort. Fully deterministic targeting meant whichever squad stepped forward
 * first drew every attack for the rest of the run, which read as cheating
 * rather than as a monster choosing a victim.
 *
 * ## Why the abilities matter
 *
 * This used to return only ATTACK / MOVE / END_TURN, so the AI never healed, never
 * fired a spell and never guarded. Against a player using four classes that is a
 * large handicap, and it made the opponent the weakest part of the game. The
 * policy below still ends its turn when there is nothing worth doing — it just
 * stops *ignoring* its own toolbox.
 *
 * ## Ordering is the policy
 *
 * First match wins, so the order below is the whole design:
 *   1. Save a life that is actually at risk.
 *   2. Take a kill if one is on offer.
 *   3. Spend an ability where it does real work: the best spell, a hook that
 *      feeds a ready ally, a trap only when there is no shot to take.
 *   4. Otherwise attack, weighting wounded, valuable and finishable targets.
 *   5. Pull wounded units out of reach before they feed a kill.
 *   6. Otherwise close the distance toward the most valuable victim.
 *   7. Otherwise end the turn.
 *
 * Everything is expressed as "count the targets this would hit" rather than
 * "if the player is bad, do X", which is what keeps it from reading as a
 * script and keeps it deterministic.
 */

/** An ally at or below this fraction of max HP is worth healing. */
const HEAL_URGENT = 0.55;

/** A unit this hurt stops trading blows and looks for a tile nobody can hit. */
const RETREAT_HP = 0.35;

/**
 * What a body is worth killing, beyond its raw damage.
 *
 * The old weight only counted `attackDamage`, which made the squad's support and
 * its ranged damage the *least* attractive targets on the board: the AI spent
 * every turn on the 30 HP Warrior while the Cleric healed it back up.
 */
const ROLE_VALUE: Record<string, number> = {
  CLERIC: 1.9,
  BARD: 1.7,
  RANGER: 1.55,
  WARLOCK: 1.5,
  WIZARD: 1.45,
  ROGUE: 1.4,
  DRUID: 1.35,
  PALADIN: 1.3,
  SPITTER: 1.15,
};

const roleValue = (unit: Unit): number => ROLE_VALUE[unit.type] ?? 1;

/** Damage a hit is certain to land — the Ranger's floor, not its average. */
const certainDamage = (unit: Unit): number =>
  unit.type === 'RANGER' ? RANGER_ATTACK.minDamage : unit.stats.attackDamage;

/**
 * How much of a hit is actually worth planning on.
 *
 * A Ranger at six tiles lands half its arrows, so a long shot must not outbid a
 * close one just because the target looks juicy. Melee always lands.
 */
const shotCertainty = (attacker: Unit, target: Unit): number =>
  attacker.type === 'RANGER'
    ? rangerAccuracyPercent(chebyshev(attacker.position, target.position)) / 100
    : 1;

/** Stable id used for the local/Phase-1 AI opponent. */
export const AI_PLAYER_ID = 'AI';

const posOf = (unit: Unit): Position => unit.position;

const hpFraction = (unit: Unit): number => unit.stats.currentHp / unit.stats.maxHp;

/**
 * How tempting a target is right now.
 *
 * Wounded, close, valuable and finishable units draw fire; full-health units at
 * the back of the room do not. The result is only ever a weight, never a winner,
 * so this decides the odds rather than the outcome. Never zero, so every legal
 * target stays reachable.
 *
 * The square on the missing-health term is what makes the squad *focus*: a body
 * at a third of its bar outweighs two fresh ones, so four attackers converge on
 * one kill instead of chipping four different units. The finisher factor does
 * the same for anything that dies to this swing.
 */
const targetWeight = (attacker: Unit, target: Unit): number => {
  const missing = 1 - hpFraction(target);
  const vulnerability = 0.5 + missing * missing * 3;
  const proximity = 1 + 0.6 / (1 + chebyshev(attacker.position, target.position));
  const finisher = target.stats.currentHp <= certainDamage(attacker) ? 2.5 : 1;
  return vulnerability * proximity * roleValue(target) * finisher;
};

/**
 * One item at random, weighted.
 *
 * The policy used to always take the lowest-HP target in range, which made the
 * monsters' aggro completely deterministic: whichever squad happened to step
 * forward first ate every attack for the rest of the run. Weighting keeps the
 * choice sensible without ever fixing it, so both players share the pressure.
 */
const pickWeighted = <T,>(items: T[], weightOf: (item: T) => number, rng: Rng): T => {
  const weights = items.map((item) => Math.max(0, weightOf(item)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
  let roll = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
};

const canAttackFrom = (state: GameState, unit: Unit, from: Position, target: Position): boolean =>
  canReachTile(unit, from, target) &&
  (unit.type !== 'RANGER' || hasLineOfSight(state, from, target));

/** Legal targets that do not splash the AI's own squad. */
const safeAttackTargets = (state: GameState, attacker: Unit): Unit[] =>
  legalAttackTargetsFor(state, attacker.id).filter((target) =>
    !computeAttackEffects(state, attacker, target).some(
      (effect) => state.units.get(effect.unitId)?.ownerId === attacker.ownerId,
    ),
  );

/** Enemies a cast centred on `target` would catch, per the engine's own blast. */
const enemiesCaughtBy = (
  state: GameState,
  ability: AbilityId,
  caster: Unit,
  target: Position,
  enemies: Unit[],
): Unit[] => {
  const tiles = abilityAffectedTiles(state, ability, caster, target);
  return enemies.filter((e) => tiles.some((t) => t.x === e.position.x && t.y === e.position.y));
};

/** Best Fireball / Thunder target: the one catching the most enemies. */
const bestAreaTarget = (
  state: GameState,
  caster: Unit,
  ability: AbilityId,
  enemies: Unit[],
  allies: Unit[],
  minCaught: number,
): { target: Position; caught: number } | null => {
  const options = legalAbilityTargetsFor(state, caster.id, ability);
  let best: { target: Position; caught: number } | null = null;
  for (const target of options) {
    const caught = enemiesCaughtBy(state, ability, caster, target, enemies).length;
    // Friendly fire is on. A cast that scorches the AI's own team is not a good
    // trade simply because it also catches two enemies.
    const alliedHits = enemiesCaughtBy(state, ability, caster, target, allies).length;
    if (caught < minCaught) continue;
    if (alliedHits > 0) continue;
    // Ties break on tile order, which is deterministic.
    if (!best || caught > best.caught) best = { target, caught };
  }
  return best;
};

/** The Wizard's best action: whichever spell damages the most bodies. */
const bestSpell = (
  state: GameState,
  wizard: Unit,
  enemies: Unit[],
  allies: Unit[],
): GameCommand | null => {
  const fire = bestAreaTarget(state, wizard, 'FIREBALL', enemies, allies, 1);
  const thunder = bestAreaTarget(state, wizard, 'THUNDER_STRIKE', enemies, allies, 1);
  // A single caught target is still worth it: Fireball's aimed tile is 8 to the
  // staff's 4, at a tile more reach. The old two-target rule was why the enemy
  // Wizard hit for half its damage all game.
  const fireScore = fire ? fire.caught * ABILITIES.FIREBALL.damage : 0;
  const thunderScore = thunder ? thunder.caught * ABILITIES.THUNDER_STRIKE.damage : 0;
  if (fire && fireScore >= thunderScore) {
    return { type: 'CAST_FIREBALL', unitId: wizard.id, x: fire.target.x, y: fire.target.y };
  }
  if (thunder) {
    return {
      type: 'CAST_THUNDER_STRIKE',
      unitId: wizard.id,
      x: thunder.target.x,
      y: thunder.target.y,
    };
  }
  return null;
};

/** Trap an empty tile an enemy can step onto next turn. */
const bestTrapTarget = (
  state: GameState,
  ranger: Unit,
  enemies: Unit[],
): Position | null => {
  const options = legalAbilityTargetsFor(state, ranger.id, 'TRAP');
  const enemyReach = new Set(
    enemies.flatMap((enemy) => computeReachable(state, enemy).map(positionKey)),
  );
  return options.find((target) => enemyReach.has(positionKey(target))) ?? null;
};

/** Bless ground: only under the Cleric, to cover the squad. */
const bestZoneTarget = (state: GameState, cleric: Unit, allies: Unit[]): Position | null => {
  const options = legalAbilityTargetsFor(state, cleric.id, 'BLESS_GROUND');
  let best: { target: Position; covered: number } | null = null;
  for (const target of options) {
    const covered = abilityAffectedTiles(state, 'BLESS_GROUND', cleric, target).filter((tile) =>
      allies.some((a) => a.position.x === tile.x && a.position.y === tile.y),
    ).length;
    if (covered < 2) continue;
    if (!best || covered > best.covered) best = { target, covered };
  }
  return best ? best.target : null;
};

/** Guard: shield the most wounded ally standing next to the Warrior. */
const bestGuardTarget = (state: GameState, warrior: Unit, allies: Unit[]): Unit | null => {
  const options = legalAbilityTargetsFor(state, warrior.id, 'SHIELD_SLAM');
  if (options.length === 0) return null;
  const adjacent = allies.filter(
    (a) =>
      a.id !== warrior.id &&
      a.stats.currentHp > 0 &&
      !a.guardingUnitId &&
      chebyshev(posOf(warrior), posOf(a)) <= 1 &&
      hpFraction(a) <= HEAL_URGENT,
  );
  if (adjacent.length === 0) return null;
  return adjacent.sort((a, b) => hpFraction(a) - hpFraction(b))[0];
};

/** Slam an adjacent enemy, which also knocks it back a tile. */
const bestSlamTarget = (
  state: GameState,
  warrior: Unit,
  enemies: Unit[],
  rng: Rng,
): Position | null => {
  const options = legalAbilityTargetsFor(state, warrior.id, 'SHIELD_SLAM');
  const adjacent = enemies.filter((e) => options.some((t) => t.x === e.position.x && t.y === e.position.y));
  if (adjacent.length === 0) return null;
  return posOf(pickWeighted(adjacent, (e) => targetWeight(warrior, e), rng));
};

/** An attack that would finish the target outright, cheapest attacker first. */
const bestKill = (
  state: GameState,
  own: Unit[],
): { attackerId: string; targetId: string } | null => {
  for (const unit of own) {
    if (unit.hasAttacked) continue;
    const targets = safeAttackTargets(state, unit);
    for (const target of targets) {
      const certainHit = unit.type !== 'RANGER' ||
        rangerAccuracyPercent(chebyshev(unit.position, target.position)) === 100;
      if (certainHit && target.stats.currentHp <= certainDamage(unit)) {
        return { attackerId: unit.id, targetId: target.id };
      }
    }
  }
  return null;
};

/**
 * Where a unit should walk.
 *
 * Scores tiles by "can I hit something from here" and *how valuable* that
 * something is, then by how close the tile gets to the enemy, minus how many
 * enemies could hit the unit on arrival. Lower is better. The old version only
 * counted the nearest enemy, so melee walked into the tank while the Cleric and
 * the Ranger walked away; this walks toward whatever is worth killing.
 */
const bestApproach = (
  state: GameState,
  unit: Unit,
  enemies: Unit[],
): Position | null => {
  const moves = legalMovesFor(state, unit.id);
  if (moves.length === 0) return null;

  // Fragile classes care twice as much about standing in a threat ring.
  const caution =
    (unit.type === 'CLERIC' || unit.type === 'WIZARD' ? 1.6 : 1) *
    (hpFraction(unit) < 0.5 ? 2 : 1);

  const score = (tile: Position): number => {
    const reachable = enemies.filter((e) => canAttackFrom(state, unit, tile, posOf(e)));
    const value = reachable.length
      ? Math.max(...reachable.map((e) => targetWeight(unit, e)))
      : 0;
    const closest = Math.min(...enemies.map((e) => manhattan(tile, posOf(e))));
    const exposed = enemies.filter((e) => canAttackFrom(state, e, posOf(e), tile)).length;
    // Attack positions dominate; among them, approach the most valuable victim
    // without volunteering a fragile unit into several threat ranges.
    return (reachable.length ? 0 : 1000) - value * 10 + closest + exposed * 3 * caution;
  };

  const from = score(posOf(unit));
  let best: Position | null = null;
  let bestScore = from;
  for (const move of moves) {
    const candidate = score(move);
    if (candidate >= from || candidate >= bestScore) continue;
    best = move;
    bestScore = candidate;
  }
  return best;
};

/**
 * A tile no enemy can hit, for a unit that is about to die where it stands.
 *
 * Returns null unless the move genuinely leaves fewer threat ranges than the
 * current tile, so a cornered unit still fights instead of shuffling.
 */
const bestRetreat = (
  state: GameState,
  unit: Unit,
  enemies: Unit[],
): Position | null => {
  const moves = legalMovesFor(state, unit.id);
  if (moves.length === 0) return null;
  const threatsAt = (tile: Position) =>
    enemies.filter((e) => canAttackFrom(state, e, posOf(e), tile)).length;
  let best: Position | null = null;
  let bestThreats = threatsAt(posOf(unit));
  for (const move of moves) {
    const threats = threatsAt(move);
    if (threats < bestThreats) {
      best = move;
      bestThreats = threats;
    }
  }
  return best;
};

/**
 * Ranger hook, worth the action only when it turns into a kill.
 *
 * The victim is dragged to a tile beside the Ranger, so the pull is only good if
 * a melee ally with its action still unused is already standing there. Without
 * that, grappling just hands the enemy a free turn next to a 16 HP body.
 */
const grappleVictim = (
  state: GameState,
  ranger: Unit,
  enemies: Unit[],
  allies: Unit[],
  rng: Rng,
): Position | null => {
  const options = legalAbilityTargetsFor(state, ranger.id, 'GRAPPLE');
  const reachable = enemies.filter((e) =>
    options.some((t) => t.x === e.position.x && t.y === e.position.y),
  );
  if (reachable.length === 0) return null;
  const ready = allies.some(
    (a) =>
      a.id !== ranger.id &&
      a.stats.currentHp > 0 &&
      !a.hasAttacked &&
      canReachTile(a, posOf(a), posOf(ranger)),
  );
  if (!ready) return null;
  return posOf(pickWeighted(reachable, (e) => targetWeight(ranger, e), rng));
};

export const chooseAiCommand = (
  state: GameState,
  aiPlayerId: string,
  rng: Rng = Math.random,
): GameCommand => {
  if (state.phase !== 'playing' || state.activePlayerId !== aiPlayerId) {
    return { type: 'END_TURN' };
  }

  const allies = livingUnits(state, aiPlayerId);
  // A stun costs the unit its ACTION, not its turn; ice holds it in place and
  // costs the action too. `own` is therefore "can act": every step that spends
  // the action only ever considers these, so the reducer cannot reject the AI's
  // whole turn. Movement has its own list below, because a stunned unit may
  // still take its step.
  const own = allies.filter(
    (u) => (u.stunnedTurns ?? 0) <= 0 && !isFrozen(state, u),
  );
  const mobile = allies.filter((u) => !isFrozen(state, u));
  const enemies = livingUnits(state).filter((u) => u.ownerId !== aiPlayerId);
  if (enemies.length === 0) return { type: 'END_TURN' };

  // 1. A life worth saving. Checked before attacking so a squad that is being
  //    ground down heals instead of trading hits it cannot win.
  for (const unit of own) {
    const healable = legalHealTargetsFor(state, unit.id);
    if (healable.length === 0) continue;
    const worst = healable.sort((a, b) => hpFraction(a) - hpFraction(b))[0];
    if (hpFraction(worst) <= HEAL_URGENT) {
      return { type: 'HEAL_UNIT', healerId: unit.id, targetId: worst.id };
    }
  }

  // 2. A kill is always worth taking.
  const kill = bestKill(state, own);
  if (kill) return { type: 'ATTACK_UNIT', ...kill };

  // 3. Abilities, best first.
  for (const unit of own) {
    if (unit.hasAttacked) continue;

    if (unit.type === 'WIZARD') {
      const spell = bestSpell(state, unit, enemies, allies);
      if (spell) return spell;
    }

    if (unit.type === 'RANGER') {
      // Shoot first. The ranger's 4-6 damage at range 6 is the squad's best
      // action, and the old ordering spent its turn on a trap or a hook almost
      // every round because those targets are legal nearly always.
      if (safeAttackTargets(state, unit).length === 0) {
        const hook = grappleVictim(state, unit, enemies, allies, rng);
        if (hook) return { type: 'GRAPPLE', unitId: unit.id, x: hook.x, y: hook.y };

        const trap = bestTrapTarget(state, unit, enemies);
        if (trap) return { type: 'PLACE_TRAP', unitId: unit.id, x: trap.x, y: trap.y };
      }
    }

    if (unit.type === 'CLERIC') {
      const zone = bestZoneTarget(state, unit, allies);
      if (zone) return { type: 'BLESS_GROUND', unitId: unit.id, x: zone.x, y: zone.y };
    }

    if (unit.type === 'WARRIOR') {
      const guard = bestGuardTarget(state, unit, allies);
      if (guard) return { type: 'GUARD_UNIT', unitId: unit.id, targetId: guard.id };

      const slam = bestSlamTarget(state, unit, enemies, rng);
      if (slam) return { type: 'SHIELD_SLAM', unitId: unit.id, x: slam.x, y: slam.y };
    }

    if (unit.type === 'PALADIN') {
      // Heal only when it matters — the old check healed a single missing HP
      // instead of smiting.
      const lightTargets = legalAbilityTargetsFor(state, unit.id, 'HOLY_LIGHT');
      const woundedAlly = allies
        .filter((a) => a.id !== unit.id && hpFraction(a) <= HEAL_URGENT)
        .sort((a, b) => hpFraction(a) - hpFraction(b))[0];
      if (woundedAlly && lightTargets.some((t) => t.x === woundedAlly.position.x && t.y === woundedAlly.position.y)) {
        return { type: 'HOLY_LIGHT', unitId: unit.id, x: woundedAlly.position.x, y: woundedAlly.position.y };
      }

      // Damage before control: a smite that kills is worth more than a blind.
      const smiteTargets = legalAbilityTargetsFor(state, unit.id, 'HOLY_SMITE');
      const smiteable = enemies.filter((e) => smiteTargets.some((t) => t.x === e.position.x && t.y === e.position.y));
      if (smiteable.length > 0) {
        const target = posOf(pickWeighted(smiteable, (e) => targetWeight(unit, e), rng));
        return { type: 'HOLY_SMITE', unitId: unit.id, x: target.x, y: target.y };
      }

      // Nothing to hit: blind the most dangerous enemy instead.
      const blindTarget = enemies
        .filter((e) => lightTargets.some((t) => t.x === e.position.x && t.y === e.position.y))
        .sort((a, b) => targetWeight(unit, b) - targetWeight(unit, a))[0];
      if (blindTarget) {
        return { type: 'HOLY_LIGHT', unitId: unit.id, x: blindTarget.position.x, y: blindTarget.position.y };
      }

      // Divine Shield: only when two or more of the cross are actually hurt.
      const shieldTargets = legalAbilityTargetsFor(state, unit.id, 'DIVINE_SHIELD');
      const covered = allies.filter(
        (a) =>
          hpFraction(a) <= 0.7 &&
          (a.shieldHp ?? 0) <= 0 &&
          (a.id === unit.id || chebyshev(posOf(a), posOf(unit)) <= 1),
      );
      if (shieldTargets.length > 0 && covered.length >= 2) {
        return { type: 'DIVINE_SHIELD', unitId: unit.id, x: unit.position.x, y: unit.position.y };
      }
    }

    if (unit.type === 'BARD') {
      // Song of Rest first: it is the Bard's real value.
      const restOpts = legalAbilityTargetsFor(state, unit.id, 'SONG_OF_REST');
      if (restOpts.length > 0) {
        const bestRest = restOpts
          .map((tile) => ({
            tile,
            healed: allies.filter(
              (a) => hpFraction(a) < 1 && chebyshev(tile, posOf(a)) <= 1,
            ).length,
          }))
          .sort((a, b) => b.healed - a.healed)[0];
        if (bestRest && bestRest.healed >= 2) {
          return { type: 'SONG_OF_REST', unitId: unit.id, x: bestRest.tile.x, y: bestRest.tile.y };
        }
      }

      // Anthem: only when it actually buffs two allies that are not already
      // inspired — otherwise it burned the Bard's action every single turn.
      const anthemOpts = legalAbilityTargetsFor(state, unit.id, 'INSPIRING_ANTHEM');
      if (anthemOpts.length > 0) {
        const bestAnthem = anthemOpts
          .map((tile) => ({
            tile,
            buffed: allies.filter(
              (a) => (a.inspiredTurns ?? 0) <= 0 && chebyshev(tile, posOf(a)) <= 1,
            ).length,
          }))
          .sort((a, b) => b.buffed - a.buffed)[0];
        if (bestAnthem && bestAnthem.buffed >= 2) {
          return { type: 'INSPIRING_ANTHEM', unitId: unit.id, x: bestAnthem.tile.x, y: bestAnthem.tile.y };
        }
      }

      // Melody only as a finisher: it hits softer than the Bard's basic attack,
      // so spending the action on it otherwise is a downgrade.
      const melodyOpts = legalAbilityTargetsFor(state, unit.id, 'DISSONANT_MELODY');
      const melodyTarget = enemies
        .filter((e) => e.stats.currentHp <= ABILITIES.DISSONANT_MELODY.damage)
        .find((e) => melodyOpts.some((o) => o.x === e.position.x && o.y === e.position.y));
      if (melodyTarget) {
        return { type: 'DISSONANT_MELODY', unitId: unit.id, x: melodyTarget.position.x, y: melodyTarget.position.y };
      }
    }

    if (unit.type === 'WARLOCK') {
      // Bolt out-damages the staff at the same reach, so it is the default.
      const boltOpts = legalAbilityTargetsFor(state, unit.id, 'ELDRITCH_BOLT');
      const boltable = enemies.filter((e) => boltOpts.some((o) => o.x === e.position.x && o.y === e.position.y));
      const drainOpts = legalAbilityTargetsFor(state, unit.id, 'SOUL_DRAIN');
      const drainTarget = enemies.find((e) => drainOpts.some((o) => o.x === e.position.x && o.y === e.position.y));
      if (drainTarget && hpFraction(unit) <= 0.6) {
        return { type: 'SOUL_DRAIN', unitId: unit.id, x: drainTarget.position.x, y: drainTarget.position.y };
      }
      if (boltable.length > 0) {
        const target = posOf(pickWeighted(boltable, (e) => targetWeight(unit, e), rng));
        return { type: 'ELDRITCH_BOLT', unitId: unit.id, x: target.x, y: target.y };
      }
      const curseOpts = legalAbilityTargetsFor(state, unit.id, 'CURSE_OF_AGONY');
      const curseTarget = enemies.find((e) => curseOpts.some((o) => o.x === e.position.x && o.y === e.position.y));
      if (curseTarget) {
        return { type: 'CURSE_OF_AGONY', unitId: unit.id, x: curseTarget.position.x, y: curseTarget.position.y };
      }
    }

    if (unit.type === 'DRUID') {
      const regrowthOpts = legalAbilityTargetsFor(state, unit.id, 'REGROWTH');
      const woundedAlly = allies
        .filter((a) => hpFraction(a) <= HEAL_URGENT)
        .sort((a, b) => hpFraction(a) - hpFraction(b))[0];
      if (woundedAlly && regrowthOpts.some((o) => o.x === woundedAlly.position.x && o.y === woundedAlly.position.y)) {
        return { type: 'REGROWTH', unitId: unit.id, x: woundedAlly.position.x, y: woundedAlly.position.y };
      }
      // Whip only reaches further than the staff; in melee the staff hits harder.
      const whipOpts = legalAbilityTargetsFor(state, unit.id, 'THORN_WHIP');
      const whipable = enemies.filter(
        (e) =>
          !canAttackFrom(state, unit, posOf(unit), posOf(e)) &&
          whipOpts.some((o) => o.x === e.position.x && o.y === e.position.y),
      );
      if (whipable.length > 0) {
        const target = posOf(pickWeighted(whipable, (e) => targetWeight(unit, e), rng));
        return { type: 'THORN_WHIP', unitId: unit.id, x: target.x, y: target.y };
      }
      // Roots: lock down the juiciest enemy that is out of the staff's reach.
      const rootOpts = legalAbilityTargetsFor(state, unit.id, 'ROOTS_OF_ENTANGLEMENT');
      const rootTarget = enemies
        .filter((e) => (e.rootedTurns ?? 0) <= 0)
        .sort((a, b) => targetWeight(unit, b) - targetWeight(unit, a))
        .find((e) => rootOpts.some((o) => o.x === e.position.x && o.y === e.position.y));
      if (rootTarget) {
        return { type: 'ROOTS_OF_ENTANGLEMENT', unitId: unit.id, x: rootTarget.position.x, y: rootTarget.position.y };
      }
    }

    if (unit.type === 'ROGUE') {
      // Backstab in melee (6, or 12 from behind) — never worse than the knife.
      const bsOpts = legalAbilityTargetsFor(state, unit.id, 'BACKSTAB');
      const bsTargets = enemies.filter((e) => bsOpts.some((o) => o.x === e.position.x && o.y === e.position.y));
      if (bsTargets.length > 0) {
        const target = posOf(pickWeighted(bsTargets, (e) => targetWeight(unit, e), rng));
        return { type: 'BACKSTAB', unitId: unit.id, x: target.x, y: target.y };
      }
      // Dagger: 4 + 4 poison beats the knife at range 2.
      const daggerOpts = legalAbilityTargetsFor(state, unit.id, 'POISONED_DAGGER');
      const daggerTargets = enemies.filter(
        (e) => (e.poisonedTurns ?? 0) <= 0 && daggerOpts.some((o) => o.x === e.position.x && o.y === e.position.y),
      );
      if (daggerTargets.length > 0) {
        const target = posOf(pickWeighted(daggerTargets, (e) => targetWeight(unit, e), rng));
        return { type: 'POISONED_DAGGER', unitId: unit.id, x: target.x, y: target.y };
      }
      // Shadow Step is an escape, not an attack: only a wounded Rogue that can
      // reach nothing uses it, and it picks the safest legal tile.
      if (hpFraction(unit) <= RETREAT_HP && safeAttackTargets(state, unit).length === 0) {
        const steps = legalAbilityTargetsFor(state, unit.id, 'SHADOW_STEP');
        const safest = steps
          .map((tile) => ({
            tile,
            threats: enemies.filter((e) => canAttackFrom(state, e, posOf(e), tile)).length,
          }))
          .sort((a, b) => a.threats - b.threats)[0];
        if (safest) {
          return { type: 'SHADOW_STEP', unitId: unit.id, x: safest.tile.x, y: safest.tile.y };
        }
      }
    }
  }

  // 4. Attack whatever is most worth hitting, not always the same piece.
  for (const unit of own) {
    if (unit.hasAttacked) continue;
    const targets = safeAttackTargets(state, unit);
    if (targets.length === 0) continue;
    const chosen = pickWeighted(
      targets,
      (target) => targetWeight(unit, target) * shotCertainty(unit, target),
      rng,
    );
    return { type: 'ATTACK_UNIT', attackerId: unit.id, targetId: chosen.id };
  }

  // 5. A unit that is about to die stops trading and steps out of reach. Runs
  //    after the attacks so a wounded unit still takes its swing first.
  for (const unit of mobile) {
    if (unit.hasMoved || (unit.rootedTurns ?? 0) > 0) continue;
    if (hpFraction(unit) > RETREAT_HP) continue;
    const step = bestRetreat(state, unit, enemies);
    if (step) return { type: 'MOVE_UNIT', unitId: unit.id, to: step };
  }

  // 6. Close the distance.
  for (const unit of mobile) {
    if (unit.hasMoved || (unit.rootedTurns ?? 0) > 0) continue;
    const step = bestApproach(state, unit, enemies);
    if (step) return { type: 'MOVE_UNIT', unitId: unit.id, to: step };
  }

  // 7. Nothing left to do.
  return { type: 'END_TURN' };
};
