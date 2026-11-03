import {
  chebyshev,
  computeReachable,
  hasLineOfSight,
  inBounds,
  manhattan,
  positionKey,
  unitAt,
} from './board';
import {
  applyDamageEffects,
  computeAttackEffects,
  guardOf,
  rangerAccuracyPercent,
  restoreUnitHp,
} from './combat';
import {
  grappleAnchor,
  grappleDestination,
  grapplePullDestination,
  isFrozen,
  isTileFree,
  pushUnit,
  damageReductionFor,
  fireballTiles,
  resolveZones,
  thunderTiles,
  trapAt,
  triggerTrap,
  zoneCovers,
  canReachTile,
} from './abilities';
import { ABILITIES, CLERIC_HEAL_RANGE, DEFAULT_BOARD_SIZE, RANGER_ATTACK } from './constants';
import { chooseAiCommand } from './ai';
import {
  ADVENTURE_BOARD_SIZE,
  ADVENTURE_WALL_DENSITY,
  MONSTER_TEAM_ID,
  adventureDeploymentTiles,
  isAdventureState,
  spawnAdventureMonsters,
} from './adventure';
import { adventureWallsFor } from './maps';
import {
  altarTilesFor,
  besideAltar,
  resurrectionSpotFor,
  soulTargetFor,
} from './altar';
import { buildTerrain, cloneState, deploySquad, startMatch, wallsForMode } from './state';
import type {
  AbilityId,
  AltarWish,
  CommandResult,
  GameCommand,
  GameEvent,
} from './protocol';
import type { DamageEffect } from './combat';
import type { Faction, GameState, MapMode, PlayerClass, Position, Rng, Unit, UnitType, Zone } from './types';

/** Extra damage when a slam drives the target into stone. */
const IMPACT_BONUS_DAMAGE = 4;

/** A slam's own damage. A shove, not a sword swing, so it is fixed rather than
 * the Warrior's 8 — the wall impact above is what makes it hurt. */
const SHIELD_SLAM_DAMAGE = 3;

/** Turns the slammed unit loses its next action. */
const SHIELD_SLAM_STUN_TURNS = 1;

// ─────────────────────────── Lookups ───────────────────────────

export const getUnit = (state: GameState, id: string): Unit | undefined =>
  state.units.get(id);

export const isActivePlayer = (state: GameState, playerId: string): boolean =>
  state.activePlayerId === playerId;

// ─────────────────────────── Legal-action queries (for UI) ───────────────────────────

/**
 * Tiles `unitId` may legally move to right now, or [] when the move is not
 * available (wrong turn, already moved, dead, or match not playing).
 */
export const legalMovesFor = (
  state: GameState,
  unitId: string,
): Position[] => {
  if (state.phase !== 'playing') return [];
  const unit = state.units.get(unitId);
  if (!unit || unit.stats.currentHp <= 0) return [];
  if (unit.hasMoved) return [];
  // Frozen in ice: nothing to offer. `validateActor` refuses the move anyway,
  // but showing reach for it would be a dead end in the UI.
  if (isFrozen(state, unit)) return [];
  return computeReachable(state, unit);
};

/** Enemy units `unitId` may legally attack right now. */
export const legalAttackTargetsFor = (
  state: GameState,
  unitId: string,
): Unit[] => {
  if (state.phase !== 'playing') return [];
  const attacker = state.units.get(unitId);
  if (!attacker || attacker.stats.currentHp <= 0 || attacker.hasAttacked) {
    return [];
  }
  if ((attacker.stunnedTurns ?? 0) > 0 || isFrozen(state, attacker)) return [];
  return Array.from(state.units.values()).filter((target) => {
    if (target.ownerId === attacker.ownerId) return false;
    if (target.stats.currentHp <= 0) return false;
    return hasValidAttackGeometry(state, attacker, target);
  });
};

/** Units may attack any in-range non-stone tile, including allies, empty ground, traps and ice. */
export const legalRangerShotTargetsFor = (state: GameState, unitId: string): Position[] => {
  if (state.phase !== 'playing') return [];
  const attacker = state.units.get(unitId);
  if (
    !attacker || attacker.stats.currentHp <= 0 ||
    attacker.hasAttacked || (attacker.stunnedTurns ?? 0) > 0 || isFrozen(state, attacker)
  ) return [];

  const targets: Position[] = [];
  for (let y = 0; y < state.boardSize.height; y += 1) {
    for (let x = 0; x < state.boardSize.width; x += 1) {
      const target = { x, y };
      if (x === attacker.position.x && y === attacker.position.y) continue;
      const distance = attacker.type === 'WIZARD'
        ? manhattan(attacker.position, target)
        : chebyshev(attacker.position, target);
      if (distance > attacker.stats.attackRange) continue;
      // Static stone cannot be destroyed. Ice is separate state and is a valid target.
      if (state.terrain.get(positionKey(target)) === 'WALL') continue;
      if (attacker.type === 'RANGER' && !hasLineOfSight(state, attacker.position, target)) continue;
      targets.push(target);
    }
  }
  return targets;
};

/** Friendly units (including self) a Cleric `unitId` may heal right now. */
export const legalHealTargetsFor = (
  state: GameState,
  unitId: string,
): Unit[] => {
  if (state.phase !== 'playing') return [];
  const healer = state.units.get(unitId);
  if (!healer || healer.type !== 'CLERIC') return [];
  if (healer.stats.currentHp <= 0 || healer.hasAttacked) return [];
  if ((healer.stunnedTurns ?? 0) > 0 || isFrozen(state, healer)) return [];
  return Array.from(state.units.values()).filter((target) => {
    if (target.ownerId !== healer.ownerId) return false;
    if (target.stats.currentHp <= 0) return false;
    if (target.stats.currentHp >= target.stats.maxHp) return false;
    return inClericHealRange(healer.position, target.position);
  });
};

/**
 * Which class is allowed to cast each ability.
 *
 * The UI keeps its own list for rendering buttons; this is the rules copy the
 * server and the AI both go through, so a class/ability mismatch cannot be
 * introduced by editing a component.
 */
const ABILITY_CLASS: Record<AbilityId, UnitType> = {
  FIREBALL: 'WIZARD',
  THUNDER_STRIKE: 'WIZARD',
  ICE_WALL: 'WIZARD',
  BLESS_GROUND: 'CLERIC',
  TRAP: 'RANGER',
  GRAPPLE: 'RANGER',
  SHIELD_SLAM: 'WARRIOR',
  HOLY_SMITE: 'PALADIN',
  DIVINE_SHIELD: 'PALADIN',
  HOLY_LIGHT: 'PALADIN',
  DISSONANT_MELODY: 'BARD',
  INSPIRING_ANTHEM: 'BARD',
  SONG_OF_REST: 'BARD',
  ELDRITCH_BOLT: 'WARLOCK',
  CURSE_OF_AGONY: 'WARLOCK',
  SOUL_DRAIN: 'WARLOCK',
  THORN_WHIP: 'DRUID',
  REGROWTH: 'DRUID',
  ROOTS_OF_ENTANGLEMENT: 'DRUID',
  BACKSTAB: 'ROGUE',
  SHADOW_STEP: 'ROGUE',
  POISONED_DAGGER: 'ROGUE',
};

/**
 * Where each ability's numbers live in `ABILITIES`.
 *
 * Needed because the Cleric zone is `SANCTIFIED_GROUND` as a rule but
 * `BLESS_GROUND` as the id the UI and the wire use. Aliasing it here keeps that
 * quirk in one place instead of at every call site.
 */
const ABILITY_CONFIG: Record<AbilityId, keyof typeof ABILITIES> = {
  FIREBALL: 'FIREBALL',
  THUNDER_STRIKE: 'THUNDER_STRIKE',
  ICE_WALL: 'ICE_WALL',
  BLESS_GROUND: 'SANCTIFIED_GROUND',
  TRAP: 'TRAP',
  GRAPPLE: 'GRAPPLE',
  SHIELD_SLAM: 'SHIELD_SLAM',
  HOLY_SMITE: 'HOLY_SMITE',
  DIVINE_SHIELD: 'DIVINE_SHIELD',
  HOLY_LIGHT: 'HOLY_LIGHT',
  DISSONANT_MELODY: 'DISSONANT_MELODY',
  INSPIRING_ANTHEM: 'INSPIRING_ANTHEM',
  SONG_OF_REST: 'SONG_OF_REST',
  ELDRITCH_BOLT: 'ELDRITCH_BOLT',
  CURSE_OF_AGONY: 'CURSE_OF_AGONY',
  SOUL_DRAIN: 'SOUL_DRAIN',
  THORN_WHIP: 'THORN_WHIP',
  REGROWTH: 'REGROWTH',
  ROOTS_OF_ENTANGLEMENT: 'ROOTS_OF_ENTANGLEMENT',
  BACKSTAB: 'BACKSTAB',
  SHADOW_STEP: 'SHADOW_STEP',
  POISONED_DAGGER: 'POISONED_DAGGER',
};

/**
 * The command the engine dispatches for each ability id.
 *
 * Lives beside the legality helper so the two cannot drift: anything
 * `legalAbilityTargetsFor` reports as legal was checked with this exact command.
 */
const abilityCommandFor = (
  unitId: string,
  ability: AbilityId,
  x: number,
  y: number,
): GameCommand => {
  switch (ability) {
    case 'FIREBALL':
      return { type: 'CAST_FIREBALL', unitId, x, y };
    case 'THUNDER_STRIKE':
      return { type: 'CAST_THUNDER_STRIKE', unitId, x, y };
    case 'ICE_WALL':
      return { type: 'SUMMON_ICE_WALL', unitId, x, y };
    case 'BLESS_GROUND':
      return { type: 'BLESS_GROUND', unitId, x, y };
    case 'TRAP':
      return { type: 'PLACE_TRAP', unitId, x, y };
    case 'GRAPPLE':
      return { type: 'GRAPPLE', unitId, x, y };
    case 'SHIELD_SLAM':
      return { type: 'SHIELD_SLAM', unitId, x, y };
    case 'HOLY_SMITE':
      return { type: 'HOLY_SMITE', unitId, x, y };
    case 'DIVINE_SHIELD':
      return { type: 'DIVINE_SHIELD', unitId, x, y };
    case 'HOLY_LIGHT':
      return { type: 'HOLY_LIGHT', unitId, x, y };
    case 'DISSONANT_MELODY':
      return { type: 'DISSONANT_MELODY', unitId, x, y };
    case 'INSPIRING_ANTHEM':
      return { type: 'INSPIRING_ANTHEM', unitId, x, y };
    case 'SONG_OF_REST':
      return { type: 'SONG_OF_REST', unitId, x, y };
    case 'ELDRITCH_BOLT':
      return { type: 'ELDRITCH_BOLT', unitId, x, y };
    case 'CURSE_OF_AGONY':
      return { type: 'CURSE_OF_AGONY', unitId, x, y };
    case 'SOUL_DRAIN':
      return { type: 'SOUL_DRAIN', unitId, x, y };
    case 'THORN_WHIP':
      return { type: 'THORN_WHIP', unitId, x, y };
    case 'REGROWTH':
      return { type: 'REGROWTH', unitId, x, y };
    case 'ROOTS_OF_ENTANGLEMENT':
      return { type: 'ROOTS_OF_ENTANGLEMENT', unitId, x, y };
    case 'BACKSTAB':
      return { type: 'BACKSTAB', unitId, x, y };
    case 'SHADOW_STEP':
      return { type: 'SHADOW_STEP', unitId, x, y };
    case 'POISONED_DAGGER':
      return { type: 'POISONED_DAGGER', unitId, x, y };
    default:
      throw new Error(`No command for ability ${ability}`);
  }
};

/**
 * Tiles `unitId` may legally aim `ability` at right now.
 *
 * Rather than restating the rules, each candidate tile is dry-run through the
 * real `applyCommand` and kept only if the engine accepts it. That matters
 * because the ability handlers carry extra conditions `validateAbility` knows
 * nothing about — a trap needs clear ground with no trap already on it, blessed
 * ground needs a full 2x2 that is not on stone, grapple needs something to hook.
 * A cheaper check built from `validateAbility` alone reported traps on stone and
 * the AI wasted its action on them.
 *
 * Safe because the handlers reassign `zones` / `traps` / `iceWalls` instead of
 * mutating them in place, so the throwaway clone cannot corrupt the real state.
 *
 * Only used by the AI, but "is this legal" belongs to the rules, not the caller.
 */
export const legalAbilityTargetsFor = (
  state: GameState,
  unitId: string,
  ability: AbilityId,
): Position[] => {
  if (state.phase !== 'playing') return [];
  const unit = state.units.get(unitId);
  if (!unit || unit.stats.currentHp <= 0 || unit.hasAttacked) return [];

  const cfg = ABILITIES[ABILITY_CONFIG[ability]] as { range?: number } | undefined;
  if (!cfg || typeof cfg.range !== 'number') return [];

  const out: Position[] = [];
  for (let y = 0; y < state.boardSize.height; y += 1) {
    for (let x = 0; x < state.boardSize.width; x += 1) {
      const target = { x, y };
      if (chebyshev(unit.position, target) > cfg.range) continue;

      const className = ABILITY_CLASS[ability];
      if ('error' in validateAbility(state, unit.ownerId, unitId, className, cfg.range, target)) {
        continue;
      }

      const dryRun = applyCommand(
        cloneState(state),
        unit.ownerId,
        abilityCommandFor(unitId, ability, x, y),
      );
      if (dryRun.ok) out.push(target);
    }
  }
  return out;
};


// ─────────────────────────── Geometry ───────────────────────────

/**
 * Range + line-of-sight check shared by the query layer and the validator.
 * Ranger shots additionally require an unobstructed line.
 */
const hasValidAttackGeometry = (
  state: GameState,
  attacker: Unit,
  target: Unit,
): boolean => {
  if (!canReachTile(attacker, attacker.position, target.position)) {
    return false;
  }
  if (attacker.type === 'RANGER') {
    return hasLineOfSight(state, attacker.position, target.position);
  }
  return true;
};

// ─────────────────────────── Victory ───────────────────────────

/**
 * Evaluate the win condition: a player loses when none of their units are
 * alive. Returns the surviving player id, or null while two or more remain
 * (also null for a mutual wipe — a draw, treated as no winner).
 *
 * Adventure is the one exception: the monsters are not a seat, they are a
 * hazard that hunts both squads. The run therefore ends only when a whole
 * PLAYER squad is gone — the surviving squad wins, monsters wipe out both
 * squads take it, and monsters dying alone never ends the run. See
 * `adventure.ts` for why the monster team doubles as the adventure marker.
 */
export const checkVictory = (state: GameState): string | null => {
  const aliveByPlayer = new Map<string, number>();
  for (const id of state.turnOrder) aliveByPlayer.set(id, 0);
  // The monsters are not in the turn order any more, so they have to be counted
  // explicitly or an adventure run would score them as already dead.
  for (const unit of state.units.values()) {
    if (unit.ownerId === MONSTER_TEAM_ID && !aliveByPlayer.has(unit.ownerId)) {
      aliveByPlayer.set(unit.ownerId, 0);
    }
  }
  for (const unit of state.units.values()) {
    if (unit.stats.currentHp > 0 && aliveByPlayer.has(unit.ownerId)) {
      aliveByPlayer.set(unit.ownerId, (aliveByPlayer.get(unit.ownerId) ?? 0) + 1);
    }
  }
  const survivors = Array.from(aliveByPlayer.entries())
    .filter(([, count]) => count > 0)
    .map(([playerId]) => playerId);

  if (isAdventureState(state)) {
    const playerSurvivors = survivors.filter((id) => id !== MONSTER_TEAM_ID);
    // The run ends only when a whole player squad is gone — a single unit
    // falling never ends it, and the monsters dying on their own does not
    // either. The surviving player takes the run; monsters win only if both
    // squads are wiped.
    if (playerSurvivors.length === 0) return MONSTER_TEAM_ID;
    if (playerSurvivors.length === 1) return playerSurvivors[0];
    return null;
  }

  if (survivors.length === 1) return survivors[0];
  return null;
};

/**
 * Mark the fallen, and feed the arena altar with what falls.
 *
 * Every damage path ends here, and that is the point: a soul is harvested for
 * ANY death — a player's unit, a monster, anything summoned — so the rule lives
 * in one function instead of four copies that could disagree. The orb's journey
 * is published as an event so both clients animate the same flight to the altar.
 */
const registerDeaths = (state: GameState, defeated: string[], events: GameEvent[]): void => {
  for (const id of defeated) {
    events.push({ type: 'UNIT_DEFEATED', unitId: id });
    const fallen = state.units.get(id);
    if (!fallen) continue;
    const to = soulTargetFor(state, fallen.position);
    if (!to) continue;
    state.altarSouls = (state.altarSouls ?? 0) + 1;
    events.push({
      type: 'SOUL_HARVESTED',
      unitId: id,
      from: { ...fallen.position },
      to,
      souls: state.altarSouls,
    });
  }
};

/** Apply victory result (if any) to an already-cloned state, pushing events. */
const settleVictory = (state: GameState, events: GameEvent[]): void => {
  const winnerId = checkVictory(state);
  if (winnerId) {
    state.phase = 'ended';
    state.winnerId = winnerId;
    events.push({ type: 'VICTORY', winnerId });
  }
};

// ─────────────────────────── Validation helper ───────────────────────────

const reject = (error: string): CommandResult => ({ ok: false, error });

/** Cleric healing reaches two orthogonal tiles or one diagonal tile. */
const inClericHealRange = (from: Position, to: Position): boolean => {
  const dx = Math.abs(from.x - to.x);
  const dy = Math.abs(from.y - to.y);
  return (
    (dx === 0 && dy <= CLERIC_HEAL_RANGE.straight) ||
    (dy === 0 && dx <= CLERIC_HEAL_RANGE.straight) ||
    (dx > 0 && dy > 0 && dx <= CLERIC_HEAL_RANGE.diagonal && dy <= CLERIC_HEAL_RANGE.diagonal)
  );
};

/** Shared guard: match live, caller's turn, unit exists, owned, alive. */
const validateActor = (
  state: GameState,
  playerId: string,
  unitId: string,
  moving = false,
): { error: string } | { unit: Unit; state: GameState } => {
  if (state.phase !== 'playing') return { error: 'The match is not in progress.' };
  if (!isActivePlayer(state, playerId)) return { error: 'It is not your turn.' };
  const unit = state.units.get(unitId);
  if (!unit) return { error: 'That unit does not exist.' };
  if (unit.ownerId !== playerId) return { error: 'You do not control that unit.' };
  if (unit.stats.currentHp <= 0) return { error: 'That unit has fallen.' };
  // A stun costs the unit its ACTION, not its turn: it can still reposition,
  // it just cannot strike, cast, heal or slam until the counter clears. `moving`
  // is the one caller allowed through.
  if (!moving && (unit.stunnedTurns ?? 0) > 0) return { error: 'That unit is stunned.' };
  // Ice holds a unit in place and costs it the action too. Checked here because
  // every move and every ability goes through this one function, so there is no
  // second path that could let a frozen unit act.
  if (isFrozen(state, unit)) return { error: 'That unit is frozen in ice.' };
  return { unit, state };
};

// ─────────────────────────── Command handlers ───────────────────────────

export const applyMove = (
  state: GameState,
  playerId: string,
  unitId: string,
  to: Position,
): CommandResult => {
  // The one command a stunned unit may still issue.
  const guard = validateActor(state, playerId, unitId, true);
  if ('error' in guard) return reject(guard.error);
  const { unit } = guard;

  if (unit.hasMoved) return reject('That unit has already moved this turn.');
  if ((unit.rootedTurns ?? 0) > 0) return reject('That unit is rooted by a trap.');

  const { width, height } = state.boardSize;
  if (to.x < 0 || to.y < 0 || to.x >= width || to.y >= height) {
    return reject('That tile is off the board.');
  }

  const reachable = computeReachable(state, unit);
  const isLegal = reachable.some((tile) => tile.x === to.x && tile.y === to.y);
  if (!isLegal) return reject('That tile is out of reach.');

  const next = cloneState(state);
  const moved = next.units.get(unitId) as Unit;
  const from = { ...moved.position };
  moved.position = { x: to.x, y: to.y };
  moved.facing = { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) };
  // Movement and action are separate points, in either order. Spending the move
  // must NOT spend the action: a unit that walks can still swing or cast, and a
  // unit that casts first must still be able to reposition afterwards.
  moved.hasMoved = true;
  next.revision += 1;

  // Stepping on someone else's armed trap roots you where you land.
  const events: GameEvent[] = [{ type: 'UNIT_MOVED', unitId, from, to: { x: to.x, y: to.y } }];
  triggerTrap(next, moved, events);

  return {
    ok: true,
    state: next,
    events,
  };
};

const resolveRangerShot = (
  state: GameState,
  attacker: Unit,
  target: Position,
  rng: Rng,
): CommandResult => {
  const isRanger = attacker.type === 'RANGER';
  const accuracy = isRanger ? rangerAccuracyPercent(chebyshev(attacker.position, target)) : 100;
  const hit = rng() * 100 < accuracy;
  const victim = unitAt(state, target, attacker.id);
  const damage = hit && victim
    ? isRanger
      ? Math.min(
          RANGER_ATTACK.maxDamage,
          RANGER_ATTACK.minDamage + Math.floor(rng() * (RANGER_ATTACK.maxDamage - RANGER_ATTACK.minDamage + 1)),
        )
      : attacker.stats.attackDamage
    : 0;
  const damageDealer = { ...attacker, stats: { ...attacker.stats, attackDamage: damage } };
  const effects = hit && victim ? computeAttackEffects(state, damageDealer, victim) : [];
  const scaled = effects.map((effect) => {
    const unit = state.units.get(effect.unitId);
    const cut = unit ? damageReductionFor(state, unit) : 0;
    if (cut <= 0) return effect;
    const amount = Math.max(1, Math.round(effect.amount * (1 - cut)));
    return { ...effect, amount, hpAfter: Math.max(0, effect.hpBefore - amount) };
  });

  const next = cloneState(state);
  const nextAttacker = next.units.get(attacker.id) as Unit;
  nextAttacker.hasAttacked = true;
  nextAttacker.hasActed = true;
  let destroyedTrap = false;
  let destroyedIce = false;
  if (hit) {
    const trapCount = next.traps.length;
    next.traps = next.traps.filter((trap) => trap.x !== target.x || trap.y !== target.y);
    destroyedTrap = next.traps.length !== trapCount;
    const iceCount = next.iceWalls.length;
    next.iceWalls = next.iceWalls.filter((wall) => wall.x !== target.x || wall.y !== target.y);
    destroyedIce = next.iceWalls.length !== iceCount;
  }
  const defeated = applyDamageEffects(next, scaled);
  next.revision += 1;

  const events: GameEvent[] = [{
    type: 'RANGER_SHOT',
    unitId: attacker.id,
    from: { ...attacker.position },
    to: { ...target },
    hit,
    accuracy,
    ...(victim ? { targetId: victim.id } : {}),
    destroyedTrap,
    destroyedIce,
  }];
  if (victim && hit) {
    const primaryHit = scaled.find((effect) => effect.unitId === victim.id);
    events.push({
      type: 'UNIT_ATTACKED',
      attackerId: attacker.id,
      targetId: victim.id,
      hit: true,
      accuracy,
      damage: primaryHit ? primaryHit.hpBefore - primaryHit.hpAfter : 0,
      defeated,
      hits: scaled.map((effect) => ({
        targetId: effect.unitId,
        damage: effect.hpBefore - effect.hpAfter,
      })),
    });
    if (!effects.some((effect) => effect.unitId === victim.id)) {
      const guardian = guardOf(state, victim.id);
      if (guardian) {
        events.push({
          type: 'GUARD_ABSORBED',
          guardianId: guardian.id,
          targetId: victim.id,
          damage: scaled.find((effect) => effect.unitId === guardian.id)?.amount ?? 0,
        });
      }
    }
  }
  registerDeaths(next, defeated, events);
  settleVictory(next, events);
  return { ok: true, state: next, events };
};

export const applyRangerShot = (
  state: GameState,
  playerId: string,
  unitId: string,
  target: Position,
  rng: Rng = Math.random,
): CommandResult => {
  const guard = validateActor(state, playerId, unitId);
  if ('error' in guard) return reject(guard.error);
  const { unit } = guard;
  if (unit.hasAttacked) return reject('That unit has already acted this turn.');
  if (!inBounds(target, state.boardSize)) return reject('That tile is off the board.');
  if (target.x === unit.position.x && target.y === unit.position.y) return reject('You cannot target your own tile.');

  /*
 * Reach goes through `canReachTile`, which is the same test the board overlay
 * and the AI use.
 *
 * This used to be an inline distance check of its own. That was invisible until
 * a monster existed whose reach was not purely a distance: a Beast's claw
 * covers only the four orthogonal neighbours, and a Beast could still fire this
 * command at a diagonal tile — the generic tile attack was the one path that
 * skipped the rule. Which is how a "one attack, sideways only" monster got a
 * diagonal swing.
 */
if (!canReachTile(unit, unit.position, target)) return reject('Target is out of range.');
  if (state.terrain.get(positionKey(target)) === 'WALL') return reject('Stone blocks the attack.');
  if (unit.type === 'RANGER' && !hasLineOfSight(state, unit.position, target)) return reject('No line of sight to the target.');
  return resolveRangerShot(state, unit, target, rng);
};

export const applyAttack = (
  state: GameState,
  playerId: string,
  attackerId: string,
  targetId: string,
  rng: Rng = Math.random,
): CommandResult => {
  const guard = validateActor(state, playerId, attackerId);
  if ('error' in guard) return reject(guard.error);
  const { unit: attacker } = guard;

  if (attacker.hasAttacked) return reject('That unit has already acted this turn.');
  // Blind: next attack misses completely. Cloned first so the pure engine never
  // mutates the caller's state (the server and the optimistic client share it).
  if ((attacker.blindedTurns ?? 0) > 0) {
    const next = cloneState(state);
    const nextAttacker = next.units.get(attackerId) as Unit;
    nextAttacker.blindedTurns = 0;
    nextAttacker.hasAttacked = true;
    nextAttacker.hasActed = true;
    next.revision += 1;
    return { ok: true, state: next, events: [{ type: 'UNIT_ATTACKED', attackerId, targetId, hit: false, damage: 0, defeated: [], hits: [] }] };
  }

  const target = state.units.get(targetId);
  if (!target) return reject('Target unit does not exist.');
  if (target.stats.currentHp <= 0) return reject('That target is already defeated.');
  if (target.ownerId === playerId) return reject('You cannot attack your own units.');
  if (!hasValidAttackGeometry(state, attacker, target)) {
    return reject(
      attacker.type === 'RANGER' &&
        chebyshev(attacker.position, target.position) <= attacker.stats.attackRange
        ? 'No line of sight to the target.'
        : 'Target is out of range.',
    );
  }
  if (attacker.type === 'RANGER') return resolveRangerShot(state, attacker, target.position, rng);

  const effects = computeAttackEffects(state, attacker, target);
  if (effects.length === 0) return reject('The attack would have no effect.');

  // Blessed allies shrug off a quarter of incoming damage.
  const scaled = effects.map((effect) => {
    const victim = state.units.get(effect.unitId);
    const cut = victim ? damageReductionFor(state, victim) : 0;
    let amount = effect.amount;
    if (cut > 0) amount = Math.max(1, Math.round(amount * (1 - cut)));
    return { ...effect, amount, hpAfter: Math.max(0, effect.hpBefore - amount) };
  });

  const next = cloneState(state);
  // Divine Shield absorbs damage on the clone.
  for (const effect of scaled) {
    const victim = next.units.get(effect.unitId);
    if (!victim || (victim.shieldHp ?? 0) <= 0) continue;
    const absorbed = Math.min(victim.shieldHp!, effect.amount);
    victim.shieldHp! -= absorbed;
    if (victim.shieldHp! <= 0) victim.shieldHp = 0;
    effect.amount -= absorbed;
    effect.hpAfter = Math.max(0, effect.hpBefore - effect.amount);
  }
  const defeated = applyDamageEffects(next, scaled);
  const primaryHit = scaled.find((effect) => effect.unitId === targetId);
  const nextAttacker = next.units.get(attackerId) as Unit;
  nextAttacker.hasAttacked = true;
  nextAttacker.hasActed = true;
  next.revision += 1;

  const events: GameEvent[] = [
    {
      type: 'UNIT_ATTACKED',
      attackerId,
      targetId,
      hit: true,
      damage: primaryHit ? primaryHit.hpBefore - primaryHit.hpAfter : 0,
      defeated,
      hits: scaled.map((effect) => ({
        targetId: effect.unitId,
        damage: effect.hpBefore - effect.hpAfter,
      })),
    },
  ];
  // If the target no longer has an effect of its own, a shield ate the hit.
  const targetTookDamage = effects.some((e) => e.unitId === targetId);
  if (!targetTookDamage) {
    const absorbedBy = guardOf(state, targetId);
    if (absorbedBy) {
      events.push({
        type: 'GUARD_ABSORBED',
        guardianId: absorbedBy.id,
        targetId,
        damage: scaled.find((e) => e.unitId === absorbedBy.id)?.amount ?? 0,
      });
    }
  }
  registerDeaths(next, defeated, events);
  settleVictory(next, events);

  return { ok: true, state: next, events };
};

export const applyHeal = (
  state: GameState,
  playerId: string,
  healerId: string,
  targetId: string,
): CommandResult => {
  const guard = validateActor(state, playerId, healerId);
  if ('error' in guard) return reject(guard.error);
  const { unit: healer } = guard;

  if (healer.type !== 'CLERIC') return reject('Only a Cleric can heal.');
  if (healer.hasAttacked) return reject('That unit has already acted this turn.');

  const target = state.units.get(targetId);
  if (!target) return reject('Target unit does not exist.');
  if (target.ownerId !== playerId) return reject('You can only heal your own units.');
  if (target.stats.currentHp <= 0) return reject('That unit has fallen and cannot be healed.');
  if (!inClericHealRange(healer.position, target.position)) {
    return reject('Target is out of heal range.');
  }
  if (target.stats.currentHp >= target.stats.maxHp) {
    return reject('That unit is already at full health.');
  }

  const next = cloneState(state);
  const nextHealer = next.units.get(healerId) as Unit;
  const nextTarget = next.units.get(targetId) as Unit;
  const restored = restoreUnitHp(nextTarget, nextHealer.healPower ?? 0);
  nextHealer.hasAttacked = true;
  nextHealer.hasActed = true;
  next.revision += 1;

  return {
    ok: true,
    state: next,
    events: [{ type: 'UNIT_HEALED', healerId, targetId, restored }],
  };
};

// ─────────────────────────── Class abilities ───────────────────────────

/**
 * Shared guard for tile-targeted abilities: the caller must own a live unit of
 * the right class, still have its action, and target a tile on the board within
 * its ability's range.
 */
const validateAbility = (
  state: GameState,
  playerId: string,
  unitId: string,
  className: string,
  range: number,
  target: Position,
  diagonalCostsTwo = false,
): { error: string } | { unit: Unit } => {
  const guard = validateActor(state, playerId, unitId);
  if ('error' in guard) return { error: guard.error };
  const { unit } = guard;
  if (unit.type !== className) return { error: `Only a ${className} can do that.` };
  if (unit.hasAttacked) return { error: 'That unit has already acted this turn.' };
  if (target.x < 0 || target.y < 0 || target.x >= state.boardSize.width || target.y >= state.boardSize.height) {
    return { error: 'That tile is off the board.' };
  }
  const distance = diagonalCostsTwo
    ? manhattan(unit.position, target)
    : chebyshev(unit.position, target);
  if (distance > range) return { error: 'That target is out of range.' };
  return { unit };
};

/**
 * Apply damage to a set of units on the (already cloned) state, emitting one
 * SPELL_HIT per victim plus DEFEAT events, then settling victory.
 */
const dealDamage = (
  next: GameState,
  victims: Unit[],
  amount: number,
  ability: AbilityId,
  sourceId: string,
  events: GameEvent[],
): void => {
  const effects = victims.map<DamageEffect>((unit) => {
    const hpAfter = Math.max(0, unit.stats.currentHp - amount);
    return {
      unitId: unit.id,
      amount,
      hpBefore: unit.stats.currentHp,
      hpAfter,
      defeated: hpAfter === 0,
    };
  });
  const defeated = applyDamageEffects(next, effects);
  for (const effect of effects) {
    events.push({
      type: 'SPELL_HIT',
      unitId: effect.unitId,
      sourceId,
      targetId: effect.unitId,
      damage: effect.hpBefore - effect.hpAfter,
    });
  }
  registerDeaths(next, defeated, events);
  if (ability !== 'FIREBALL') {
    // ability is recorded on the cast event; nothing further to do here
  }
  settleVictory(next, events);
};

/**
 * Every living unit standing on any of the given tiles, regardless of owner.
 *
 * Friendly fire is always on, so this deliberately does NOT filter by owner. It
 * used to, which made area denial impossible and let a Wizard erase their own
 * back line to no consequence. The caster is included too: standing in your own
 * blast is a mistake the blast preview shows before the cast, not an accident to
 * shield against.
 */
const unitsOn = (state: GameState, tiles: Position[]): Unit[] =>
  Array.from(state.units.values()).filter(
    (unit) =>
      unit.stats.currentHp > 0 &&
      tiles.some((t) => t.x === unit.position.x && t.y === unit.position.y),
  );

export const applyCastFireball = (
  state: GameState,
  playerId: string,
  unitId: string,
  target: Position,
): CommandResult => {
  const cfg = ABILITIES.FIREBALL;
  const guard = validateAbility(state, playerId, unitId, 'WIZARD', cfg.range, target, true);
  if ('error' in guard) return reject(guard.error);

  // Aiming at an empty tile is allowed on purpose: the player can see the blast
  // shape before casting, and choosing to waste the action is a valid choice.
  // The blast is the whole 3x3 block, so it catches anything standing beside the
  // target as well — which is the whole point of picking Fireball over Thunder.
  // Friendly fire is on: the wizard's own units in that 3x3 burn too.
  const victims = unitsOn(state, fireballTiles(state, target, cfg.size));

  // Two tiers: the aimed tile takes the full hit, the ring takes the splash.
  const onTarget = victims.filter(
    (u) => u.position.x === target.x && u.position.y === target.y,
  );
  const inRing = victims.filter(
    (u) => u.position.x !== target.x || u.position.y !== target.y,
  );

  const next = cloneState(state);
  const caster = next.units.get(unitId) as Unit;
  caster.hasAttacked = true;
  caster.hasActed = true;
  next.revision += 1;
  const events: GameEvent[] = [{ type: 'SPELL_CAST', unitId, ability: 'FIREBALL', x: target.x, y: target.y }];
  // Ring first, centre second, so a lethal centre reports its own death last and
  // the floats read inside-out.
  dealDamage(next, inRing, cfg.splash, 'FIREBALL', unitId, events);
  dealDamage(next, onTarget, cfg.damage, 'FIREBALL', unitId, events);
  return { ok: true, state: next, events };
};

export const applyCastThunderStrike = (
  state: GameState,
  playerId: string,
  unitId: string,
  target: Position,
): CommandResult => {
  const cfg = ABILITIES.THUNDER_STRIKE;
  const guard = validateAbility(state, playerId, unitId, 'WIZARD', cfg.range, target, true);
  if ('error' in guard) return reject(guard.error);

  const caster = state.units.get(unitId) as Unit;
  const tiles = thunderTiles(state, caster.position, target, cfg.tiles);
  // Like Fireball, a bolt into empty space is allowed and simply hits nothing,
  // and friendly fire is on — a line drawn down your own column hurts you.
  const victims = unitsOn(state, tiles);

  const next = cloneState(state);
  const nextCaster = next.units.get(unitId) as Unit;
  nextCaster.hasAttacked = true;
  nextCaster.hasActed = true;
  next.revision += 1;
  const events: GameEvent[] = [
    { type: 'SPELL_CAST', unitId, ability: 'THUNDER_STRIKE', x: target.x, y: target.y },
  ];
  dealDamage(next, victims, cfg.damage, 'THUNDER_STRIKE', unitId, events);
  return { ok: true, state: next, events };
};

export const applySummonIceWall = (
  state: GameState,
  playerId: string,
  unitId: string,
  target: Position,
): CommandResult => {
  const cfg = ABILITIES.ICE_WALL ?? { range: 3 };
  const guard = validateAbility(state, playerId, unitId, 'WIZARD', cfg.range, target, true);
  if ('error' in guard) return reject(guard.error);

  // Casting onto an occupied tile is allowed *because* that is the point: ice
  // forms around whoever is standing there and holds them. Only stone and an
  // existing wall of ice refuse it.
  if (state.terrain.get(positionKey(target)) === 'WALL') {
    return reject('Ice cannot form on stone.');
  }
  if (state.iceWalls.some((wall) => wall.x === target.x && wall.y === target.y)) {
    return reject('There is already ice there.');
  }
  if (state.zones.some((zone) => zoneCovers(zone, target.x, target.y))) {
    return reject('Blessed ground will not freeze.');
  }

  const next = cloneState(state);
  const caster = next.units.get(unitId) as Unit;
  caster.hasAttacked = true;
  caster.hasActed = true;
  /*
   * One wall per caster: re-casting melts your previous wall and raises a new
   * one where you aimed. Same bargain as Sanctified Ground.
   *
   * It used to append, so a Wizard could bank ice across the whole map in one
   * turn and lock down every approach. Walls with no owner are from an older
   * persisted room and are left alone — see the note on `IceWall.ownerId`.
   */
  next.iceWalls = [
    ...next.iceWalls.filter((wall) => wall.ownerId !== playerId),
    { x: target.x, y: target.y, expiresInTurns: cfg.durationTurns, ownerId: playerId },
  ];
  next.revision += 1;
  return {
    ok: true,
    state: next,
    events: [
      { type: 'SPELL_CAST', unitId, ability: 'ICE_WALL', x: target.x, y: target.y },
      { type: 'ICE_WALL_SUMMONED', unitId, x: target.x, y: target.y },
    ],
  };
};

export const applyBlessGround = (
  state: GameState,
  playerId: string,
  unitId: string,
  target: Position,
): CommandResult => {
  const cfg = ABILITIES.SANCTIFIED_GROUND;
  const guard = validateAbility(state, playerId, unitId, 'CLERIC', cfg.range, target);
  if ('error' in guard) return reject(guard.error);

  // The ground may be blessed on top of anyone — it is sanctuary, so it does
  // not need clear ground and does not check who is standing there.
  // The cross is deliberately NOT validated against the board. It used to be,
  // and that made the ability unusable in the two positions it most often gets
  // used from: hugging an edge, or standing beside a wall. A cleric who had to
  // walk out into open ground to bless anything was not making a tactical
  // choice, just paying a tax on the terrain.
  //
  // An arm that falls off the board or lands on stone is simply not covered —
  // `activeZoneTiles` is what the aim preview draws, so the player is shown the
  // reduced shape before committing, and `resolveZones` only ever touches units,
  // neither of which can be on a wall or off the edge anyway. So ignoring those
  // tiles is not a shortcut: it is the only behaviour the zone could have had.
  //
  // The anchor itself must still be a real on-board tile, which
  // `validateAbility` has already enforced above.

  const next = cloneState(state);
  const caster = next.units.get(unitId) as Unit;
  caster.hasAttacked = true;
  caster.hasActed = true;
  const zone: Zone = {
    id: `zone-${unitId}-${next.revision}`,
    kind: 'SANCTIFIED_GROUND',
    ownerId: playerId,
    x: target.x,
    y: target.y,
    size: cfg.size,
    durationTurns: cfg.durationTurns,
  };
  // Re-blessing lifts the cleric's previous ground instead of stacking a second
  // one on top of it: one sanctuary per caster, repositioned by re-casting.
  // Zones are drawn straight from state, so dropping the old one is enough to
  // make it disappear — no removal event needed.
  next.zones = [...next.zones.filter((z) => z.ownerId !== playerId), zone];
  next.revision += 1;
  return {
    ok: true,
    state: next,
    events: [
      { type: 'SPELL_CAST', unitId, ability: 'BLESS_GROUND', x: target.x, y: target.y },
      { type: 'ZONE_SUMMONED', zoneId: zone.id, ownerId: playerId, x: zone.x, y: zone.y },
    ],
  };
};

export const applyPlaceTrap = (
  state: GameState,
  playerId: string,
  unitId: string,
  target: Position,
): CommandResult => {
  const cfg = ABILITIES.TRAP;
  const guard = validateAbility(state, playerId, unitId, 'RANGER', cfg.range, target);
  if ('error' in guard) return reject(guard.error);

  if (!isTileFree(state, target.x, target.y, unitId)) {
    return reject('A trap needs clear, empty ground.');
  }
  // `isTileFree` ignores the caster, so its own tile passes as free. A trap is
  // set *around* the ranger, never under it.
  if (target.x === guard.unit.position.x && target.y === guard.unit.position.y) {
    return reject('Set the trap on a tile beside you.');
  }
  if (trapAt(state, target.x, target.y)) return reject('There is already a trap there.');

  const next = cloneState(state);
  const ranger = next.units.get(unitId) as Unit;
  ranger.hasAttacked = true;
  ranger.hasActed = true;
  const trap = {
    id: `trap-${unitId}-${next.revision}`,
    ownerId: playerId,
    x: target.x,
    y: target.y,
    armed: true,
  };
  next.traps = [...next.traps, trap];
  next.revision += 1;
  return {
    ok: true,
    state: next,
    events: [
      { type: 'SPELL_CAST', unitId, ability: 'TRAP', x: target.x, y: target.y },
      { type: 'TRAP_PLACED', trapId: trap.id, ownerId: playerId, x: trap.x, y: trap.y },
    ],
  };
};

/**
 * Ranger grapple, two ways to use the same hook.
 *
 * On a wall: the Ranger swings to a free tile beside it, along a straight line.
 * Costs the move and the action, exactly like hooking a unit: this is one
 * ability with one price, so it can be used once per turn whichever end of it
 * the player aims at.
 *
 * On a unit: the target is dragged to a free tile beside the Ranger — enemy or
 * ally, no distinction, matching the friendly-fire-is-always-on rule the rest of
 * the kit follows. Dragging someone into melee is an *offensive* play, so it
 * costs the action instead; otherwise the Ranger could haul a victim next to a
 * Warrior and still have that Warrior attack for free.
 *
 * The straight-line restriction applies to the wall only. Dragging a unit is not
 * a rope swing — you reach out and grab someone — so it may hook diagonally.
 */
export const applyGrapple = (
  state: GameState,
  playerId: string,
  unitId: string,
  target: Position,
): CommandResult => {
  const cfg = ABILITIES.GRAPPLE;
  const guard = validateAbility(state, playerId, unitId, 'RANGER', cfg.range, target, true);
  if ('error' in guard) return reject(guard.error);

  const hooked = grappleAnchor(state, target);
  if (!hooked) return reject('Grapple needs a wall or a unit to hook into.');

  const unit = state.units.get(unitId) as Unit;

  // ── hooking a unit: drag them beside the Ranger ─────────────────────────
  // Deliberately NOT line-locked: a dragged unit may come from any direction,
  // which is what makes pulling worth choosing over walking over and hitting.
  if (hooked !== 'ANCHOR') {
    if (hooked.id === unitId) return reject('You cannot grapple yourself.');
    const landing = grapplePullDestination(state, unit, hooked);
    if (!landing) return reject('There is nowhere to pull them to.');

    const next = cloneState(state);
    const pulled = next.units.get(hooked.id) as Unit;
    const from = { ...pulled.position };
    pulled.position = landing;
    // Moving someone else is an action; the Ranger keeps its move.
    const ranger = next.units.get(unitId) as Unit;
    ranger.hasAttacked = true;
    ranger.hasActed = true;
    next.revision += 1;
    return {
      ok: true,
      state: next,
      events: [
        { type: 'SPELL_CAST', unitId, ability: 'GRAPPLE', x: from.x, y: from.y },
        { type: 'UNIT_MOVED', unitId: pulled.id, from, to: { ...landing } },
      ],
    };
  }

  // ── hooking a wall: swing past it ────────────────────────────────────────
  // The swing IS line-locked, unlike dragging a unit above: the rope is thrown at
  // fixed stone, so it has to travel in a straight line or the landing tile
  // becomes ambiguous.
  const straightLine =
    (target.x === unit.position.x && target.y !== unit.position.y) ||
    (target.y === unit.position.y && target.x !== unit.position.x);
  if (!straightLine) {
    return reject('The hook only reaches up, down, left or right.');
  }

  const landing = grappleDestination(state, unit, target);
  if (!landing) return reject('There is nowhere to land there.');

  const next = cloneState(state);
  const ranger = next.units.get(unitId) as Unit;
  const from = { ...ranger.position };
  ranger.position = landing;
  // A swing spends the whole action as well as the move. It used to refund the
  // action so the Ranger could still shoot afterwards, which read in the UI as
  // a free hook: the button stayed lit and every wall in range could be swung
  // from in one turn.
  ranger.hasMoved = true;
  ranger.hasAttacked = true;
  ranger.hasActed = true;
  next.revision += 1;
  return {
    ok: true,
    state: next,
    events: [
      { type: 'SPELL_CAST', unitId, ability: 'GRAPPLE', x: target.x, y: target.y },
      { type: 'UNIT_MOVED', unitId, from, to: { ...landing } },
    ],
  };
};

/**
 * Warrior: slam a tile. Friendly fire is always on, so an ally standing in the
 * way is hit exactly like an enemy — the swing is aimed at the ground, not at
 * a person. Hitting nothing is allowed and simply spends the action.
 */
const applyDamageWithShield = (unit: Unit, amount: number): number => {
  if ((unit.shieldHp ?? 0) > 0) {
    const absorbed = Math.min(unit.shieldHp!, amount);
    unit.shieldHp! -= absorbed;
    if (unit.shieldHp! <= 0) unit.shieldHp = 0;
    amount -= absorbed;
  }
  return amount;
};

/**
 * Land a single-target ability hit on the already-cloned state.
 *
 * Every class ability used to open-code shield absorption, HP subtraction and the
 * SPELL_HIT event, and every one of them forgot `registerDeaths`/`settleVictory`
 * — so a kill with a spell left the body on the board and never ended the match.
 * One helper means a new ability cannot miss the death path.
 */
const resolveAbilityHit = (
  next: GameState,
  struck: Unit,
  amount: number,
  sourceId: string,
  events: GameEvent[],
): number => {
  const before = struck.stats.currentHp;
  const throughShield = applyDamageWithShield(struck, amount);
  struck.stats.currentHp = Math.max(0, before - throughShield);
  events.push({
    type: 'SPELL_HIT',
    unitId: sourceId,
    sourceId,
    targetId: struck.id,
    damage: before - struck.stats.currentHp,
  });
  const defeated = struck.stats.currentHp === 0 ? [struck.id] : [];
  registerDeaths(next, defeated, events);
  settleVictory(next, events);
  return struck.stats.currentHp;
};

export const applyShieldSlam = (
  state: GameState,
  playerId: string,
  unitId: string,
  target: Position,
): CommandResult => {
  const cfg = ABILITIES.SHIELD_SLAM;
  const guard = validateAbility(state, playerId, unitId, 'WARRIOR', cfg.range, target);
  if ('error' in guard) return reject(guard.error);

  const slammer = state.units.get(unitId) as Unit;
  const victim = unitAt(state, target, unitId);
  const next = cloneState(state);
  const nextSlammer = next.units.get(unitId) as Unit;
  nextSlammer.hasAttacked = true;
  nextSlammer.hasActed = true;
  next.revision += 1;

  const events: GameEvent[] = [
    { type: 'SPELL_CAST', unitId, ability: 'SHIELD_SLAM', x: target.x, y: target.y },
  ];

  if (!victim) {
    // A wasted swing, exactly like an aimed spell that hits bare stone.
    return { ok: true, state: next, events };
  }

  const struck = next.units.get(victim.id) as Unit;
  const dx = Math.sign(struck.position.x - slammer.position.x);
  const dy = Math.sign(struck.position.y - slammer.position.y);
  const from = { ...struck.position };
  const push = pushUnit(next, struck, dx, dy);

  // A stopped push adds impact damage and a stun.
  const bonus = push.blocked ? IMPACT_BONUS_DAMAGE : 0;
  const hpAfter = Math.max(0, struck.stats.currentHp - SHIELD_SLAM_DAMAGE - bonus);
  const damage = struck.stats.currentHp - hpAfter;
  const defeated = hpAfter === 0;
  struck.stats.currentHp = hpAfter;

  events.push({ type: 'SPELL_HIT', unitId, sourceId: unitId, targetId: struck.id, damage });
  if (push.blocked) {
    events.push({ type: 'UNIT_PUSHED', unitId: struck.id, from, to: { ...from } });
    events.push({ type: 'IMPACT_BONUS', unitId: struck.id, damage: bonus });
    struck.stunnedTurns = SHIELD_SLAM_STUN_TURNS + 1;
    events.push({ type: 'UNIT_STUNNED', unitId: struck.id, turns: SHIELD_SLAM_STUN_TURNS });
  } else {
    events.push({ type: 'UNIT_PUSHED', unitId: struck.id, from, to: { ...push.to } });
  }
  registerDeaths(next, defeated ? [struck.id] : [], events);

  settleVictory(next, events);
  return { ok: true, state: next, events };
};

/**
 * Warrior only: raise the shield over an adjacent ally.
 *
 * Costs the action, like attack, slam, heal and every class ability: one action
 * per unit per turn, no class gets a second one. It still consumes no *movement*,
 * so a Warrior may shield and then reposition, and the shield covers the whole
 * opponent turn (it lapses when this player's next turn starts, see
 * `resetPlayerTurnFlags`).
 */
export const applyHolySmite = (
  state: GameState,
  playerId: string,
  unitId: string,
  target: Position,
): CommandResult => {
  const cfg = ABILITIES.HOLY_SMITE;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const dist = Math.max(Math.abs(target.x - unit.position.x), Math.abs(target.y - unit.position.y));
  if (dist === 0 || dist > cfg.rangedRange) return reject('Out of range.');
  const isMelee = dist <= cfg.meleeRange;
  const damage = isMelee ? cfg.meleeDamage : cfg.rangedDamage;

  const guard = validateAbility(state, playerId, unitId, 'PALADIN', cfg.rangedRange, target);
  if ('error' in guard) return reject(guard.error);

  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  nextUnit.hasAttacked = true;
  nextUnit.hasActed = true;
  next.revision += 1;

  const events: GameEvent[] = [{ type: 'SPELL_CAST', unitId, ability: 'HOLY_SMITE', x: target.x, y: target.y }];
  const victim = unitAt(next, target, unitId);
  if (victim) {
    const struck = next.units.get(victim.id) as Unit;
    resolveAbilityHit(next, struck, damage, unitId, events);
  }
  // Heal adjacent allies on melee hit
  if (isMelee && victim) {
    for (const off of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const ally = unitAt(next, { x: unit.position.x + off.x, y: unit.position.y + off.y }, unitId);
      if (ally && ally.ownerId === playerId) {
        const a = next.units.get(ally.id) as Unit;
        a.stats.currentHp = Math.min(a.stats.maxHp, a.stats.currentHp + cfg.healAdjacent);
      }
    }
  }
  return { ok: true, state: next, events };
};

export const applyDivineShield = (
  state: GameState,
  playerId: string,
  unitId: string,
  target: Position,
): CommandResult => {
  const cfg = ABILITIES.DIVINE_SHIELD;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const guard = validateAbility(state, playerId, unitId, 'PALADIN', cfg.range, target);
  if ('error' in guard) return reject(guard.error);

  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  nextUnit.hasAttacked = true;
  nextUnit.hasActed = true;
  // One cross centred on the aimed tile (self or an adjacent ally). The old code
  // added the shield to the caster and *then* looped over a cross that included
  // the caster's own tile, so a self-cast granted 16 instead of 8.
  for (const off of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
    // No ignoreUnitId: the caster is a legal recipient of its own shield.
    const ally = unitAt(next, { x: target.x + off.x, y: target.y + off.y });
    if (ally && ally.ownerId === playerId) {
      const a = next.units.get(ally.id) as Unit;
      a.shieldHp = (a.shieldHp ?? 0) + cfg.shieldHp;
    }
  }
  next.revision += 1;
  const events: GameEvent[] = [{ type: 'SPELL_CAST', unitId, ability: 'DIVINE_SHIELD', x: target.x, y: target.y }];
  return { ok: true, state: next, events };
};

export const applyHolyLight = (
  state: GameState,
  playerId: string,
  unitId: string,
  target: Position,
): CommandResult => {
  const cfg = ABILITIES.HOLY_LIGHT;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const dist = Math.max(Math.abs(target.x - unit.position.x), Math.abs(target.y - unit.position.y));
  if (dist === 0 || dist > cfg.range) return reject('Out of range.');
  const guard = validateAbility(state, playerId, unitId, 'PALADIN', cfg.range, target);
  if ('error' in guard) return reject(guard.error);

  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  nextUnit.hasAttacked = true;
  nextUnit.hasActed = true;
  next.revision += 1;

  const events: GameEvent[] = [{ type: 'SPELL_CAST', unitId, ability: 'HOLY_LIGHT', x: target.x, y: target.y }];
  const tgt = unitAt(next, target, unitId);
  if (tgt) {
    if (tgt.ownerId === playerId) {
      tgt.stats.currentHp = Math.min(tgt.stats.maxHp, tgt.stats.currentHp + cfg.heal);
      events.push({ type: 'UNIT_HEALED', healerId: unitId, targetId: tgt.id, restored: cfg.heal });
    } else {
      // Stored as 2 because blind decays on ENTRY to the victim's turn (see
      // `resetPlayerTurnFlags`), not at the end of the caster's. At 1 it expired
      // before the victim ever got to swing, so the blind did nothing at all.
      tgt.blindedTurns = 2;
      events.push({ type: 'UNIT_STUNNED', unitId: tgt.id, turns: 1 });
    }
  }
  return { ok: true, state: next, events };
};

// ── New class ability handlers ──────────────────────────────────────────────

export const applyDissonantMelody = (state: GameState, playerId: string, unitId: string, target: Position): CommandResult => {
  const cfg = ABILITIES.DISSONANT_MELODY;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const dist = Math.max(Math.abs(target.x - unit.position.x), Math.abs(target.y - unit.position.y));
  if (dist === 0 || dist > cfg.range) return reject('Out of range.');
  const guard = validateAbility(state, playerId, unitId, 'BARD', cfg.range, target);
  if ('error' in guard) return reject(guard.error);
  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  nextUnit.hasAttacked = true; nextUnit.hasActed = true; next.revision += 1;
  const events: GameEvent[] = [{ type: 'SPELL_CAST', unitId, ability: 'DISSONANT_MELODY', x: target.x, y: target.y }];
  const victim = unitAt(next, target, unitId);
  if (victim) {
    const struck = next.units.get(victim.id) as Unit;
    resolveAbilityHit(next, struck, cfg.damage, unitId, events);
    // Push back 1 tile. A dead unit is not shoved, and `from` has to be captured
    // before `pushUnit` mutates the position or the event animates a no-op.
    if (struck.stats.currentHp > 0) {
      const from = { ...struck.position };
      const dx = Math.sign(struck.position.x - unit.position.x);
      const dy = Math.sign(struck.position.y - unit.position.y);
      const push = pushUnit(next, struck, dx, dy);
      if (!push.blocked) events.push({ type: 'UNIT_PUSHED', unitId: struck.id, from, to: { ...push.to } });
    }
  }
  return { ok: true, state: next, events };
};

export const applyInspiringAnthem = (state: GameState, playerId: string, unitId: string, target: Position): CommandResult => {
  const cfg = ABILITIES.INSPIRING_ANTHEM;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const dist = Math.max(Math.abs(target.x - unit.position.x), Math.abs(target.y - unit.position.y));
  if (dist > cfg.range) return reject('Out of range.');
  const guard = validateAbility(state, playerId, unitId, 'BARD', cfg.range, target);
  if ('error' in guard) return reject(guard.error);
  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  nextUnit.hasAttacked = true; nextUnit.hasActed = true; next.revision += 1;
  // Buff the allies around the AIMED tile — the old code ignored the target and
  // buffed whoever stood next to the Bard, so aiming did nothing.
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const ally = unitAt(next, { x: target.x + dx, y: target.y + dy }, unitId);
      if (!ally || ally.ownerId !== playerId) continue;
      const a = next.units.get(ally.id) as Unit;
      // Re-casting on an already inspired ally used to add another +1 move that
      // the single -1 on expiry could never take back: permanent speed creep.
      if ((a.inspiredTurns ?? 0) <= 0) a.stats.moveReach += 1;
      a.inspiredTurns = 2;
    }
  }
  const events: GameEvent[] = [{ type: 'SPELL_CAST', unitId, ability: 'INSPIRING_ANTHEM', x: target.x, y: target.y }];
  return { ok: true, state: next, events };
};

export const applySongOfRest = (state: GameState, playerId: string, unitId: string, target: Position): CommandResult => {
  const cfg = ABILITIES.SONG_OF_REST;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const dist = Math.max(Math.abs(target.x - unit.position.x), Math.abs(target.y - unit.position.y));
  if (dist > cfg.range) return reject('Out of range.');
  const guard = validateAbility(state, playerId, unitId, 'BARD', cfg.range, target);
  if ('error' in guard) return reject(guard.error);
  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  nextUnit.hasAttacked = true; nextUnit.hasActed = true; next.revision += 1;
  // Heal all allies in 3x3 area
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const ally = unitAt(next, { x: target.x + dx, y: target.y + dy }, unitId);
      if (ally && ally.ownerId === playerId) {
        const a = next.units.get(ally.id) as Unit;
        a.stats.currentHp = Math.min(a.stats.maxHp, a.stats.currentHp + cfg.regen);
        a.regenTurns = 2; a.regenAmount = cfg.regen;
      }
    }
  }
  const events: GameEvent[] = [{ type: 'SPELL_CAST', unitId, ability: 'SONG_OF_REST', x: target.x, y: target.y }];
  return { ok: true, state: next, events };
};

export const applyEldritchBolt = (state: GameState, playerId: string, unitId: string, target: Position): CommandResult => {
  const cfg = ABILITIES.ELDRITCH_BOLT;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const dist = Math.max(Math.abs(target.x - unit.position.x), Math.abs(target.y - unit.position.y));
  if (dist === 0 || dist > cfg.range) return reject('Out of range.');
  const guard = validateAbility(state, playerId, unitId, 'WARLOCK', cfg.range, target);
  if ('error' in guard) return reject(guard.error);
  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  nextUnit.hasAttacked = true; nextUnit.hasActed = true; next.revision += 1;
  const events: GameEvent[] = [{ type: 'SPELL_CAST', unitId, ability: 'ELDRITCH_BOLT', x: target.x, y: target.y }];
  const victim = unitAt(next, target, unitId);
  if (victim) {
    const struck = next.units.get(victim.id) as Unit;
    resolveAbilityHit(next, struck, cfg.damage, unitId, events);
  }
  return { ok: true, state: next, events };
};

export const applyCurseOfAgony = (state: GameState, playerId: string, unitId: string, target: Position): CommandResult => {
  const cfg = ABILITIES.CURSE_OF_AGONY;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const dist = Math.max(Math.abs(target.x - unit.position.x), Math.abs(target.y - unit.position.y));
  if (dist === 0 || dist > cfg.range) return reject('Out of range.');
  const guard = validateAbility(state, playerId, unitId, 'WARLOCK', cfg.range, target);
  if ('error' in guard) return reject(guard.error);
  const victim = unitAt(state, target, unitId);
  if (!victim || victim.ownerId === playerId) return reject('Target an enemy.');
  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  nextUnit.hasAttacked = true; nextUnit.hasActed = true;
  const struck = next.units.get(victim.id) as Unit;
  struck.cursedTurns = cfg.turns;
  struck.curseDamage = cfg.dot;
  next.revision += 1;
  const events: GameEvent[] = [{ type: 'SPELL_CAST', unitId, ability: 'CURSE_OF_AGONY', x: target.x, y: target.y }];
  return { ok: true, state: next, events };
};

export const applySoulDrain = (state: GameState, playerId: string, unitId: string, target: Position): CommandResult => {
  const cfg = ABILITIES.SOUL_DRAIN;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const dist = Math.max(Math.abs(target.x - unit.position.x), Math.abs(target.y - unit.position.y));
  if (dist === 0 || dist > cfg.range) return reject('Out of range.');
  const guard = validateAbility(state, playerId, unitId, 'WARLOCK', cfg.range, target);
  if ('error' in guard) return reject(guard.error);
  const victim = unitAt(state, target, unitId);
  if (!victim || victim.ownerId === playerId) return reject('Target an enemy.');
  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  nextUnit.hasAttacked = true; nextUnit.hasActed = true;
  next.revision += 1;
  const events: GameEvent[] = [
    { type: 'SPELL_CAST', unitId, ability: 'SOUL_DRAIN', x: target.x, y: target.y },
  ];
  const struck = next.units.get(victim.id) as Unit;
  resolveAbilityHit(next, struck, cfg.damage, unitId, events);
  nextUnit.stats.currentHp = Math.min(nextUnit.stats.maxHp, nextUnit.stats.currentHp + cfg.heal);
  return { ok: true, state: next, events };
};

export const applyThornWhip = (state: GameState, playerId: string, unitId: string, target: Position): CommandResult => {
  const cfg = ABILITIES.THORN_WHIP;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const dist = Math.max(Math.abs(target.x - unit.position.x), Math.abs(target.y - unit.position.y));
  if (dist === 0 || dist > cfg.range) return reject('Out of range.');
  const guard = validateAbility(state, playerId, unitId, 'DRUID', cfg.range, target);
  if ('error' in guard) return reject(guard.error);
  const victim = unitAt(state, target, unitId);
  if (!victim || victim.ownerId === playerId) return reject('Target an enemy.');
  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  nextUnit.hasAttacked = true; nextUnit.hasActed = true;
  next.revision += 1;
  const events: GameEvent[] = [
    { type: 'SPELL_CAST', unitId, ability: 'THORN_WHIP', x: target.x, y: target.y },
  ];
  const struck = next.units.get(victim.id) as Unit;
  resolveAbilityHit(next, struck, cfg.damage, unitId, events);
  // Pull one tile toward the druid. `pushUnit` shoves away from a direction, so
  // the old code pushed and then moved the victim again by hand — two tiles, and
  // the second move ignored walls and occupancy.
  const dx = Math.sign(unit.position.x - struck.position.x);
  const dy = Math.sign(unit.position.y - struck.position.y);
  const pullTo = { x: struck.position.x + dx, y: struck.position.y + dy };
  if (struck.stats.currentHp > 0 && isTileFree(next, pullTo.x, pullTo.y, struck.id)) {
    const from = { ...struck.position };
    struck.position = pullTo;
    events.push({ type: 'UNIT_PUSHED', unitId: struck.id, from, to: { ...pullTo } });
  }
  return { ok: true, state: next, events };
};

export const applyRegrowth = (state: GameState, playerId: string, unitId: string, target: Position): CommandResult => {
  const cfg = ABILITIES.REGROWTH;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const dist = Math.max(Math.abs(target.x - unit.position.x), Math.abs(target.y - unit.position.y));
  if (dist === 0 || dist > cfg.range) return reject('Out of range.');
  const guard = validateAbility(state, playerId, unitId, 'DRUID', cfg.range, target);
  if ('error' in guard) return reject(guard.error);
  const tgt = unitAt(state, target, unitId);
  if (!tgt || tgt.ownerId !== playerId) return reject('Target an ally.');
  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  nextUnit.hasAttacked = true; nextUnit.hasActed = true;
  const ally = next.units.get(tgt.id) as Unit;
  ally.stats.currentHp = Math.min(ally.stats.maxHp, ally.stats.currentHp + cfg.heal);
  ally.regenTurns = 2; ally.regenAmount = 2;
  next.revision += 1;
  const events: GameEvent[] = [{ type: 'SPELL_CAST', unitId, ability: 'REGROWTH', x: target.x, y: target.y }];
  return { ok: true, state: next, events };
};

export const applyRootsOfEntanglement = (state: GameState, playerId: string, unitId: string, target: Position): CommandResult => {
  const cfg = ABILITIES.ROOTS_OF_ENTANGLEMENT;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const dist = Math.max(Math.abs(target.x - unit.position.x), Math.abs(target.y - unit.position.y));
  if (dist > cfg.range) return reject('Out of range.');
  const guard = validateAbility(state, playerId, unitId, 'DRUID', cfg.range, target);
  if ('error' in guard) return reject(guard.error);
  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  nextUnit.hasAttacked = true; nextUnit.hasActed = true;
  // Root any enemy standing on the target tile
  const victim = unitAt(next, target, unitId);
  if (victim && victim.ownerId !== playerId) {
    // 2, not 1: roots decay on entry to the victim's turn, so 1 would clear
    // before they ever tried to move. Same convention as the Ranger trap.
    victim.rootedTurns = Math.max(victim.rootedTurns ?? 0, 2);
  }
  next.revision += 1;
  const events: GameEvent[] = [{ type: 'SPELL_CAST', unitId, ability: 'ROOTS_OF_ENTANGLEMENT', x: target.x, y: target.y }];
  return { ok: true, state: next, events };
};

export const applyBackstab = (state: GameState, playerId: string, unitId: string, target: Position): CommandResult => {
  const cfg = ABILITIES.BACKSTAB;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const dist = Math.max(Math.abs(target.x - unit.position.x), Math.abs(target.y - unit.position.y));
  if (dist === 0 || dist > cfg.range) return reject('Out of range.');
  const guard = validateAbility(state, playerId, unitId, 'ROGUE', cfg.range, target);
  if ('error' in guard) return reject(guard.error);
  const victim = unitAt(state, target, unitId);
  if (!victim || victim.ownerId === playerId) return reject('Target an enemy.');
  // Backstab: 12 if attacking from behind/flank
  // Backstab: 12 if attacking from behind or flank.
  const dx = unit.position.x - victim.position.x;
  const dy = unit.position.y - victim.position.y;
  let crit: boolean;
  if (victim.facing && (victim.facing.x !== 0 || victim.facing.y !== 0)) {
    const dot = victim.facing.x * dx + victim.facing.y * dy;
    crit = dot < 0; // attacker is behind
  } else {
    // No facing data: crit on flank (non-straight approach)
    crit = !(dx === 0 || dy === 0);
  }
  const damage = crit ? cfg.critDamage : cfg.damage;
  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  nextUnit.hasAttacked = true; nextUnit.hasActed = true;
  next.revision += 1;
  const events: GameEvent[] = [
    { type: 'SPELL_CAST', unitId, ability: 'BACKSTAB', x: target.x, y: target.y },
  ];
  const struck = next.units.get(victim.id) as Unit;
  resolveAbilityHit(next, struck, damage, unitId, events);
  return { ok: true, state: next, events };
};

export const applyShadowStep = (state: GameState, playerId: string, unitId: string, target: Position): CommandResult => {
  const cfg = ABILITIES.SHADOW_STEP;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const dist = Math.max(Math.abs(target.x - unit.position.x), Math.abs(target.y - unit.position.y));
  if (dist === 0 || dist > cfg.range) return reject('Out of range.');
  if (unitAt(state, target, unitId)) return reject('Tile occupied.');
  const guard = validateAbility(state, playerId, unitId, 'ROGUE', cfg.range, target);
  if ('error' in guard) return reject(guard.error);
  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  const from = { ...nextUnit.position };
  nextUnit.position = { ...target };
  nextUnit.hasMoved = true; nextUnit.hasActed = true;
  next.revision += 1;
  const events: GameEvent[] = [
    { type: 'SPELL_CAST', unitId, ability: 'SHADOW_STEP', x: target.x, y: target.y },
    { type: 'UNIT_MOVED', unitId, from, to: { ...target } },
  ];
  return { ok: true, state: next, events };
};

export const applyPoisonedDagger = (state: GameState, playerId: string, unitId: string, target: Position): CommandResult => {
  const cfg = ABILITIES.POISONED_DAGGER;
  const unit = state.units.get(unitId);
  if (!unit || unit.ownerId !== playerId) return reject('Not your unit.');
  const dist = Math.max(Math.abs(target.x - unit.position.x), Math.abs(target.y - unit.position.y));
  if (dist === 0 || dist > cfg.range) return reject('Out of range.');
  const guard = validateAbility(state, playerId, unitId, 'ROGUE', cfg.range, target);
  if ('error' in guard) return reject(guard.error);
  const victim = unitAt(state, target, unitId);
  if (!victim || victim.ownerId === playerId) return reject('Target an enemy.');
  const next = cloneState(state);
  const nextUnit = next.units.get(unitId) as Unit;
  nextUnit.hasAttacked = true; nextUnit.hasActed = true;
  next.revision += 1;
  const events: GameEvent[] = [
    { type: 'SPELL_CAST', unitId, ability: 'POISONED_DAGGER', x: target.x, y: target.y },
  ];
  const struck = next.units.get(victim.id) as Unit;
  const hpAfter = resolveAbilityHit(next, struck, cfg.damage, unitId, events);
  if (hpAfter > 0) struck.poisonedTurns = cfg.poisonTurns;
  return { ok: true, state: next, events };
};

export const applyGuard = (
  state: GameState,
  playerId: string,
  unitId: string,
  targetId: string,
): CommandResult => {
  const guard = validateActor(state, playerId, unitId);
  if ('error' in guard) return reject(guard.error);
  const { unit } = guard;

  if (unit.type !== 'WARRIOR') return reject('Only a Warrior can raise a shield.');
  if (unit.hasAttacked) return reject('That unit has already acted this turn.');
  if (unit.guardingUnitId) return reject('That warrior is already guarding an ally.');
  if (targetId === unitId) return reject('A warrior cannot guard itself.');

  const target = state.units.get(targetId);
  if (!target) return reject('That unit does not exist.');
  if (target.stats.currentHp <= 0) return reject('That ally has fallen.');
  if (target.ownerId !== playerId) return reject('You can only guard your own units.');
  if (chebyshev(unit.position, target.position) > 1) {
    return reject('That ally must be standing next to the warrior.');
  }

  const next = cloneState(state);
  const warrior = next.units.get(unitId) as Unit;
  warrior.guardingUnitId = targetId;
  warrior.hasAttacked = true;
  warrior.hasActed = true;
  next.revision += 1;

  return {
    ok: true,
    state: next,
    events: [{ type: 'UNIT_GUARDED', unitId, targetId }],
  };
};

/**
 * The Altar of Shadows' two wishes.
 *
 * The arena's central monument holds a soul for every unit that has fallen on
 * the board. A unit standing beside it can spend one: whole health back, or a
 * dead ally raised at the cost of half the caster's remaining blood. Either wish
 * costs the soul and the altar's patience for the rest of the round, so a squad
 * cannot drain a full altar in a single turn.
 *
 * The wish does not spend the caster's move or action — the price is paid in
 * souls, blood, and one wish a turn, which is what the spec asks for.
 */
export const applyAltarWish = (
  state: GameState,
  playerId: string,
  unitId: string,
  wish: AltarWish,
): CommandResult => {
  // The wire is untrusted: a JSON command can carry any string.
  if (wish !== 'RESTORE' && wish !== 'RESURRECT') {
    return reject('That is not a wish the altar grants.');
  }
  if (!altarTilesFor(state)) return reject('There is no altar on this floor.');
  const guard = validateActor(state, playerId, unitId);
  if ('error' in guard) return reject(guard.error);
  const { unit } = guard;

  if (!besideAltar(state, unit.position)) return reject('That unit must stand beside the altar.');
  if ((state.altarSouls ?? 0) <= 0) return reject('The altar holds no souls.');
  if ((state.altarWishTurns ?? {})[playerId] === state.turnNumber) {
    return reject('The altar is sated — one wish a turn.');
  }

  const fallen = wish === 'RESURRECT'
    ? Array.from(state.units.values())
      .filter((candidate) => candidate.ownerId === playerId && candidate.stats.currentHp <= 0)
      .sort((a, b) => (a.id < b.id ? -1 : 1))[0]
    : undefined;
  if (wish === 'RESURRECT') {
    if (!fallen) return reject('You have no fallen ally to raise.');
  } else if (unit.stats.currentHp >= unit.stats.maxHp) {
    // Spending a soul to change nothing is a misclick, not a wish.
    return reject('That unit is already whole.');
  }

  const next = cloneState(state);
  const caster = next.units.get(unitId) as Unit;
  next.altarSouls = Math.max(0, (next.altarSouls ?? 0) - 1);
  next.altarWishTurns = { ...(next.altarWishTurns ?? {}), [playerId]: next.turnNumber };
  next.revision += 1;
  const events: GameEvent[] = [];

  if (wish === 'RESTORE') {
    const restored = caster.stats.maxHp - caster.stats.currentHp;
    caster.stats.currentHp = caster.stats.maxHp;
    events.push({ type: 'ALTAR_WISH', unitId, wish, souls: next.altarSouls, restored });
  } else if (fallen) {
    const raised = next.units.get(fallen.id) as Unit;
    // Half the caster's CURRENT blood, never below one: the altar takes what is
    // there, and a unit already at 1 HP pays what it has without dying for it.
    const sacrificed = Math.max(1, Math.floor(caster.stats.currentHp / 2));
    caster.stats.currentHp = sacrificed;
    raised.stats.currentHp = Math.min(sacrificed, raised.stats.maxHp);
    raised.position = resurrectionSpotFor(next, raised);
    // Raised spent: the dead do not come back with a full turn in hand.
    raised.hasMoved = true;
    raised.hasAttacked = true;
    raised.hasActed = true;
    events.push({
      type: 'ALTAR_WISH',
      unitId,
      wish,
      souls: next.altarSouls,
      sacrificed,
      resurrectedId: raised.id,
      position: { ...raised.position },
    });
  }

  return { ok: true, state: next, events };
};

/** Reset the per-turn action flags for one player's units, in place. */
const resetPlayerTurnFlags = (state: GameState, playerId: string): void => {
  for (const unit of state.units.values()) {
    if (unit.ownerId !== playerId) continue;
    unit.hasMoved = false;
    unit.hasAttacked = false;
    unit.hasActed = false;
    // Shields only last until the warrior's next turn comes around.
    unit.guardingUnitId = null;
    // Statuses wear off as the affected player's turn comes back round. They
    // decay on ENTRY to that turn, so an effect that must block N of their
    // moves is stored as N+1 (see triggerTrap / applyShieldSlam).
    unit.rootedTurns = Math.max(0, (unit.rootedTurns ?? 0) - 1);
    unit.stunnedTurns = Math.max(0, (unit.stunnedTurns ?? 0) - 1);
    // Holy Light's blind is "the next attack misses", so it has to survive until
    // this unit's turn and is consumed by that attack (see applyAttack).
    unit.blindedTurns = Math.max(0, (unit.blindedTurns ?? 0) - 1);
  }
};

/**
 * The monsters' automatic step.
 *
 * They have no seat in the turn order, so instead of a turn of their own they
 * move and strike once at the end of EVERY player's turn — the floor keeps
 * moving even while you are deciding what to do next.
 *
 * The active seat is borrowed for the duration and handed straight back, rather
 * than loosening `validateActor`. That guard is what stops a client commanding
 * units it does not own in an online match, and a special case here would be a
 * hole in it; borrowing means every ordinary legality check — range, line of
 * sight, stone, ice, stun — still applies to the monsters unchanged.
 *
 * `END_TURN` is dropped if the AI ever proposes it: this is not a turn, and
 * ending one would hand the match on mid-loop.
 */
const runMonsterStep = (
  state: GameState,
  rng: Rng,
  events: GameEvent[],
): GameState => {
  let next = cloneState(state);
  // Ordered by id so two clients replaying the same board agree on the order the
  // monsters resolve in, and so a fight is reproducible from a seed.
  const monsters = Array.from(next.units.values())
    .filter((unit) => unit.ownerId === MONSTER_TEAM_ID && unit.stats.currentHp > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (monsters.length === 0) return next;

  const restoreTo = next.activePlayerId;
  // Reset ONCE, before the loop. Resetting per iteration would refund the
  // monster that just acted and let the same one play every step, so the rest
  // of the team would stand still forever.
  next.activePlayerId = MONSTER_TEAM_ID;
  resetPlayerTurnFlags(next, MONSTER_TEAM_ID);
  for (let acted = 0; acted < monsters.length; acted += 1) {
    const command = chooseAiCommand(next, MONSTER_TEAM_ID, rng);
    // Every monster spent its action: `chooseAiCommand` ends the turn rather
    // than repeating a unit that cannot act again. The loop is additionally
    // bounded by the roster size so a policy that somehow never spends can
    // never spin forever.
    if (command.type === 'END_TURN') break;
    const result = applyCommand(next, MONSTER_TEAM_ID, command, rng);
    if (!result.ok || !result.state) break;
    next = result.state;
    events.push(...(result.events ?? []));
    if (next.phase !== 'playing') break;
  }
  next.activePlayerId = restoreTo;
  // Leave the monsters looking ready, so the board does not show them spent
  // between a step and the next one.
  resetPlayerTurnFlags(next, MONSTER_TEAM_ID);
  return next;
};

export const applyEndTurn = (
  state: GameState,
  playerId: string,
  rng: Rng = Math.random,
): CommandResult => {
  if (state.phase !== 'playing') return reject('The match is not in progress.');
  if (!isActivePlayer(state, playerId)) return reject('It is not your turn.');

  const order = state.turnOrder;
  if (order.length === 0) return reject('No players in the match.');

  const currentIndex = order.indexOf(playerId);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % order.length;
  const wrapped = nextIndex === 0;
  const nextPlayerId = order[nextIndex];

  let next = cloneState(state);
  next.activePlayerId = nextPlayerId;
  if (wrapped) next.turnNumber += 1;
  resetPlayerTurnFlags(next, nextPlayerId);

  // Tick status effects on all units at turn hand-over. Blind is NOT ticked
  // here: it is scoped to the victim's own turn and decays in
  // `resetPlayerTurnFlags`, otherwise it cleared before the victim could swing.
  const statusDeaths: string[] = [];
  for (const unit of next.units.values()) {
    if (unit.stats.currentHp <= 0) continue;
    if ((unit.cursedTurns ?? 0) > 0) {
      const dmg = unit.curseDamage ?? 3;
      unit.stats.currentHp = Math.max(0, unit.stats.currentHp - dmg);
      unit.cursedTurns! -= 1;
      if (unit.cursedTurns! <= 0) { unit.cursedTurns = 0; unit.curseDamage = 0; }
    }
    if ((unit.poisonedTurns ?? 0) > 0) {
      unit.stats.currentHp = Math.max(0, unit.stats.currentHp - ABILITIES.POISONED_DAGGER.poisonDamage);
      unit.poisonedTurns! -= 1;
    }
    if ((unit.regenTurns ?? 0) > 0) {
      unit.stats.currentHp = Math.min(unit.stats.maxHp, unit.stats.currentHp + (unit.regenAmount ?? 2));
      unit.regenTurns! -= 1;
    }
    if ((unit.inspiredTurns ?? 0) > 0) {
      unit.inspiredTurns! -= 1;
      if (unit.inspiredTurns === 0) {
        unit.stats.moveReach = Math.max(1, unit.stats.moveReach - 1);
      }
    }
    if (unit.stats.currentHp === 0) statusDeaths.push(unit.id);
  }

  const events: GameEvent[] = [
    {
      type: 'TURN_ENDED',
      endedPlayerId: playerId,
      activePlayerId: nextPlayerId,
      turnNumber: next.turnNumber,
    },
  ];
  // A DoT that finishes a unit has to report the death, or the body lingers and
  // the altar never gets its soul.
  registerDeaths(next, statusDeaths, events);
  // Zones tick on every hand-over so regen/burn stay predictable.
  resolveZones(next, events);
  // Ice melts on the same clock.
  next.iceWalls = next.iceWalls
    .map((wall) => ({ ...wall, expiresInTurns: wall.expiresInTurns - 1 }))
    .filter((wall) => wall.expiresInTurns > 0);
  next.revision += 1;

  settleVictory(next, events);

  /*
   * The monsters act last, after the hand-over has already been decided. Running
   * it here — rather than from the client — is what makes it work online: the
   * server applies the same `END_TURN`, gets the same automatic step in the same
   * event batch, and the monsters need no command of their own over the wire.
   *
   * A cleared or lost run stops here, so the victory screen is never followed by
   * a monster landing a last hit out of nowhere.
   */
  if (next.phase === 'playing' && isAdventureState(next)) {
    next = runMonsterStep(next, rng, events);
    settleVictory(next, events);
  }

  return { ok: true, state: next, events };
};

/** Server/client-shared faction draft transition; factions never change rules. */
export const applyChooseFaction = (
  state: GameState,
  playerId: string,
  faction: Faction,
  squad?: PlayerClass[],
): CommandResult => {
  if (state.phase !== 'deployment') return reject('Faction selection is closed.');
  if (faction !== 'INQUISITORS' && faction !== 'PENITENT_COURT') {
    return reject('That faction is not available.');
  }
  if (state.factions[playerId]) return reject('You already chose a faction.');
  const picker = state.pickOrder.find((id) => !state.factions[id]);
  if (picker !== playerId) return reject('Wait for your turn to choose a faction.');
  if (Object.values(state.factions).includes(faction)) {
    return reject('That faction has already been chosen.');
  }

  let next = cloneState(state);
  next.factions[playerId] = faction;
  if (squad && squad.length === 4) {
    if (!next.squads) next.squads = {};
    next.squads[playerId] = squad;
  }
  const nextPicker = next.pickOrder.find((id) => !next.factions[id]);
  if (nextPicker) {
    next.activePlayerId = nextPicker;
    next.revision += 1;
    return { ok: true, state: next, events: [] };
  }

  // Adventure deploys both player squads into the same corner of a 20x20 floor
  // and then seeds the monster team around them. The monsters take no tile from
  // `deploymentTiles` — they have no deployment row at all, so `playerIndex` is
  // advanced for players only and never handed to them.
  const adventure = isAdventureState(next);
  let playerIndex = 0;
  next.turnOrder.forEach((ownerId) => {
    if (ownerId === MONSTER_TEAM_ID) return;
    next = deploySquad(
      next,
      ownerId,
      playerIndex,
      adventure ? adventureDeploymentTiles(playerIndex, next.boardSize) : undefined,
      next.squads?.[ownerId],
    );
    playerIndex += 1;
  });
  if (adventure) next = spawnAdventureMonsters(next);
  return { ok: true, state: startMatch(next), events: [] };
};

/**
 * Switch the match between the Arena and Adventure.
 *
 * This is the single place the two game modes are separated, and it does three
 * things at once — resizes the board, rebuilds the terrain, and adds or removes
 * the monster team. They have to move together: a 20x20 floor with no monsters is
 * a long walk, and a monster team on a 12x10 arena is a knife fight in a phone
 * box. Keying all three off one `mapMode` value means no combination can drift.
 *
 * Allowed only during the faction draft, because that is the last moment at which
 * no unit is standing anywhere: once squads deploy, resizing would leave units
 * outside the board or inside stone, and there is no un-deploy to fix it.
 * Locking it at `playing` is also what makes it safe for either player to set —
 * it cannot be used to disturb the board mid-duel.
 *
 * Either player may set it; the last write wins. The seed is preserved, so
 * toggling back and forth is stable rather than rerolling each time.
 *
 * Server/client-shared, so an online toggle is authoritative: both clients run
 * this against the same state and reach the same board.
 */
export const applySetMapMode = (
  state: GameState,
  mapMode: MapMode,
): CommandResult => {
  if (state.phase !== 'deployment') {
    return reject('The map is locked once the match has started.');
  }
  if (mapMode !== 'CLASSIC' && mapMode !== 'RANDOM') {
    return reject('That map is not available.');
  }
  if ((state.mapMode ?? 'CLASSIC') === mapMode) {
    return reject('That map is already selected.');
  }

  const next = cloneState(state);
  next.mapMode = mapMode;
  const adventure = mapMode === 'RANDOM';

  // Board size and terrain are rebuilt together. The adventure floor is wider
  // than the arena and far more open — see `ADVENTURE_WALL_DENSITY`.
  next.boardSize = adventure
    ? { ...ADVENTURE_BOARD_SIZE }
    : { ...DEFAULT_BOARD_SIZE };
  next.terrain = buildTerrain(
    adventure
      ? adventureWallsFor(next.mapSeed, next.boardSize, ADVENTURE_WALL_DENSITY)
      : wallsForMode(mapMode, next.mapSeed, next.boardSize),
  );

  // The monsters are added to and removed from the FLOOR with the map mode, but
  // never to the turn order: they have no turn of their own and act
  // automatically at the end of each player's turn (`runMonsterStep`).
  next.turnOrder = next.turnOrder.filter((id) => id !== MONSTER_TEAM_ID);
  if (!adventure) {
    for (const [id, unit] of [...next.units]) {
      if (unit.ownerId === MONSTER_TEAM_ID) next.units.delete(id);
    }
  }

  next.revision += 1;
  return { ok: true, state: next, events: [] };
};

// ─────────────────────────── Dispatch ───────────────────────────

/**
 * The single authoritative entry point. Both the client (optimistic) and the
 * server (authoritative) call this. `playerId` must be the *verified* identity
 * on the server; never trust a playerId supplied by the client.
 */
export const applyCommand = (
  state: GameState,
  playerId: string,
  command: GameCommand,
  rng: Rng = Math.random,
): CommandResult => {
  switch (command.type) {
    case 'CHOOSE_FACTION':
      return applyChooseFaction(state, playerId, command.faction, command.squad);
    case 'SET_MAP_MODE':
      // No playerId gate: either seated player may pick the board during the
      // draft, and it cannot advantage anyone since no rule changes.
      return applySetMapMode(state, command.mapMode);
    case 'MOVE_UNIT':
      return applyMove(state, playerId, command.unitId, command.to);
    case 'ATTACK_UNIT':
      return applyAttack(state, playerId, command.attackerId, command.targetId, rng);
    case 'RANGER_SHOT':
      return applyRangerShot(state, playerId, command.unitId, { x: command.x, y: command.y }, rng);
    case 'HEAL_UNIT':
      return applyHeal(state, playerId, command.healerId, command.targetId);
    case 'GUARD_UNIT':
      return applyGuard(state, playerId, command.unitId, command.targetId);
    case 'CAST_FIREBALL':
      return applyCastFireball(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'CAST_THUNDER_STRIKE':
      return applyCastThunderStrike(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'SUMMON_ICE_WALL':
      return applySummonIceWall(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'BLESS_GROUND':
      return applyBlessGround(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'PLACE_TRAP':
      return applyPlaceTrap(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'GRAPPLE':
      return applyGrapple(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'SHIELD_SLAM':
      return applyShieldSlam(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'HOLY_SMITE':
      return applyHolySmite(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'DIVINE_SHIELD':
      return applyDivineShield(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'HOLY_LIGHT':
      return applyHolyLight(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'DISSONANT_MELODY':
      return applyDissonantMelody(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'INSPIRING_ANTHEM':
      return applyInspiringAnthem(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'SONG_OF_REST':
      return applySongOfRest(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'ELDRITCH_BOLT':
      return applyEldritchBolt(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'CURSE_OF_AGONY':
      return applyCurseOfAgony(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'SOUL_DRAIN':
      return applySoulDrain(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'THORN_WHIP':
      return applyThornWhip(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'REGROWTH':
      return applyRegrowth(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'ROOTS_OF_ENTANGLEMENT':
      return applyRootsOfEntanglement(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'BACKSTAB':
      return applyBackstab(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'SHADOW_STEP':
      return applyShadowStep(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'POISONED_DAGGER':
      return applyPoisonedDagger(state, playerId, command.unitId, { x: command.x, y: command.y });
    case 'ALTAR_WISH':
      return applyAltarWish(state, playerId, command.unitId, command.wish);
    case 'END_TURN':
      // `rng` matters now: the automatic monster step rolls accuracy and damage
      // from it, so it has to travel through the same call the player's turn does.
      return applyEndTurn(state, playerId, rng);
    default: {
      // Exhaustiveness guard — a new command type must be handled here.
      const never: never = command;
      return reject(`Unsupported command: ${JSON.stringify(never)}`);
    }
  }
};

/** Convenience: the tile a unit currently stands on, keyed for lookup. */
export const unitPositionKey = (unit: Unit): string =>
  positionKey(unit.position);
