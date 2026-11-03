import { describe, it, expect } from 'vitest';
import {
  AI_PLAYER_ID,
  applyAttack,
  applyCommand,
  applyChooseFaction,
  applyEndTurn,
  applyHeal,
  applyMove,
  checkVictory,
  chebyshev,
  chooseAiCommand,
  cloneState,
  computeReachable,
  createInitialState,
  createUnit,
  deploySquad,
  aiSquadFor,
  deserializeGameState,
  hasLineOfSight,
  legalAttackTargetsFor,
  legalRangerShotTargetsFor,
  legalHealTargetsFor,
  legalAbilityTargetsFor,
  legalMovesFor,
  manhattan,
  serializeGameState,
  startMatch,
  unitId,
  guardOf,
  ABILITIES,
  redactTrapsFor,
  attackRangeTiles,
  BASE_UNIT_STATS,
  abilityAffectedTiles,
  isWall,
  isFrozen,
  inBounds,
  allActiveUnitsSpent,
  rangerAccuracyPercent,
  zoneCovers,
  zoneTiles,
  activeZoneTiles,
  isBlessed,
} from './index';
import type { AbilityId, GameState, UnitType, Zone } from './index';
/** `isFrozen` takes a unit; this is the by-id shorthand the tests want. */
const frozen = (state: GameState, unitId: string): boolean => {
  const unit = state.units.get(unitId);
  return !!unit && isFrozen(state, unit);
};

const SIZE = { width: 8, height: 8 };

/** Bare playing state with no units. */
const baseState = (walls: { x: number; y: number }[] = []): GameState => {
  const state = createInitialState({
    gameId: 'test',
    playerIds: ['A', 'B'],
    boardSize: SIZE,
    walls,
  });
  return startMatch(state);
};

const addUnit = (
  state: GameState,
  id: string,
  ownerId: string,
  type: UnitType,
  position: { x: number; y: number },
): GameState => {
  const next = cloneState(state);
  next.units.set(id, createUnit(id, ownerId, type, position));
  return next;
};

/** Force a unit's current HP, for the "already defeated" cases. */
const setHp = (state: GameState, id: string, value: number): GameState => {
  const next = cloneState(state);
  const unit = next.units.get(id)!;
  unit.stats = { ...unit.stats, currentHp: value };
  return next;
};

describe('board distances', () => {
  it('computes Chebyshev and Manhattan distance', () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
    expect(manhattan({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(4);
  });

  it('does not let a unit reach through walls or allies', () => {
    let state = baseState([{ x: 1, y: 1 }]);
    state = addUnit(state, 'a', 'A', 'WARRIOR', { x: 0, y: 0 });
    state = addUnit(state, 'b', 'A', 'WARRIOR', { x: 1, y: 0 });
    const unit = state.units.get('a')!;
    const reachable = computeReachable(state, unit);
    // (2,2) is 2 diagonal steps out, which costs 4 against a reach of 2, and
    // every shorter route is blocked by the wall at (1,1) and the ally at (1,0).
    expect(reachable.some((p) => p.x === 2 && p.y === 2)).toBe(false);
    // Never includes a wall tile.
    expect(reachable.some((p) => p.x === 1 && p.y === 1)).toBe(false);
    // Never includes its own tile.
    expect(reachable.some((p) => p.x === 0 && p.y === 0)).toBe(false);
  });

  it('reports the active player spent only once all eight points are gone', () => {
    // A turn is eight points: two units, two points each (movement + action).
    // The countdown must not start while any single point is unspent.
    let state = baseState();
    state = addUnit(state, 'a', 'A', 'WARRIOR', { x: 1, y: 1 });
    state = addUnit(state, 'b', 'A', 'CLERIC', { x: 1, y: 3 });
    expect(allActiveUnitsSpent(state)).toBe(false);

    // 'a' fully done (2 points), 'b' untouched.
    state = cloneState(state);
    const a = state.units.get('a')!;
    a.hasMoved = true;
    a.hasAttacked = true;
    expect(allActiveUnitsSpent(state)).toBe(false);

    // THE REGRESSION: 'b' has walked but not swung — seven of eight points.
    // The old rule watched `hasMoved` alone and armed here, skipping the action.
    state = cloneState(state);
    state.units.get('b')!.hasMoved = true;
    expect(allActiveUnitsSpent(state)).toBe(false);

    // The mirror image: 'b' cast without moving. Movement is genuinely still
    // available (applyMove only checks `hasMoved`), so the countdown waits.
    state = cloneState(state);
    const b2 = state.units.get('b')!;
    b2.hasMoved = false;
    b2.hasAttacked = true;
    expect(allActiveUnitsSpent(state)).toBe(false);

    // All eight gone.
    state = cloneState(state);
    state.units.get('b')!.hasMoved = true;
    expect(allActiveUnitsSpent(state)).toBe(true);

    // A defeated unit does not hold the turn open, but a player with NO living
    // units is not "finished" — that is a state to inspect, not to auto-resolve.
    state = cloneState(state);
    state.units.get('a')!.stats.currentHp = 0;
    expect(allActiveUnitsSpent(state)).toBe(true);
    state.units.get('b')!.stats.currentHp = 0;
    expect(allActiveUnitsSpent(state)).toBe(false);
  });

  it('treats a rooted unit as having spent the movement it can never use', () => {
    // applyMove rejects a rooted unit outright, so `hasMoved` stays false all
    // turn. Without this the countdown would never arm behind a ranger trap.
    let state = baseState();
    state = addUnit(state, 'a', 'A', 'WARRIOR', { x: 1, y: 1 });
    state = cloneState(state);
    const a = state.units.get('a')!;
    a.hasAttacked = true;
    a.rootedTurns = 1;
    expect(allActiveUnitsSpent(state)).toBe(true);

    // A frozen unit is deliberately NOT excused: the freeze only bars re-entering
    // the ice, and the reachability flood seeds from the unit's own tile, so it
    // can still walk out. Excusing it would start the countdown too early.
    state = cloneState(state);
    // Re-fetch: `cloneState` copies the unit objects, so `a` is now a stale ref.
    const unfrozen = state.units.get('a')!;
    unfrozen.rootedTurns = 0;
    state.iceWalls.push({ x: unfrozen.position.x, y: unfrozen.position.y, expiresInTurns: 2, ownerId: 'B' });
    expect(allActiveUnitsSpent(state)).toBe(false);
  });

  it('charges 2 for a diagonal step, so a radius-2 warrior reaches 12 tiles', () => {
    let state = baseState();
    // Warrior moveReach is 2. Cost 1: the 4 orthogonal neighbours. Cost 2: 2
    // steps straight (8 tiles) plus 1 step diagonal (4 tiles). Two diagonal steps
    // would be cost 4, so the corners of the old 5x5 Chebyshev diamond are out.
    state = addUnit(state, 'a', 'A', 'WARRIOR', { x: 3, y: 3 });
    const unit = state.units.get('a')!;
    const reachable = computeReachable(state, unit);
    expect(reachable).toHaveLength(12);

    const key = (p: { x: number; y: number }) => reachable.some((q) => q.x === p.x && q.y === p.y);
    expect(key({ x: 5, y: 3 })).toBe(true); // 2 straight
    expect(key({ x: 4, y: 4 })).toBe(true); // 1 diagonal
    expect(key({ x: 5, y: 5 })).toBe(false); // 2 diagonals = cost 4
  });

  it('blocks line of sight through a wall only', () => {
    const clear = baseState();
    expect(hasLineOfSight(clear, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
    const blocked = baseState([{ x: 2, y: 0 }]);
    expect(hasLineOfSight(blocked, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(false);
  });
});

describe('movement validation', () => {
  it('accepts a legal move and rejects a second move in the same turn', () => {
    let state = baseState();
    state = addUnit(state, 'a', 'A', 'WARRIOR', { x: 2, y: 2 });

    const first = applyMove(state, 'A', 'a', { x: 3, y: 3 });
    expect(first.ok).toBe(true);
    expect(first.state!.units.get('a')!.position).toEqual({ x: 3, y: 3 });

    const second = applyMove(first.state!, 'A', 'a', { x: 4, y: 4 });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already moved/i);
  });

  it('rejects out-of-turn, out-of-reach and off-board moves', () => {
    let state = baseState();
    state = addUnit(state, 'a', 'A', 'WARRIOR', { x: 2, y: 2 });

    expect(applyMove(state, 'B', 'a', { x: 3, y: 3 }).ok).toBe(false);
    expect(applyMove(state, 'A', 'a', { x: 7, y: 7 }).error).toMatch(/reach/i);
    expect(applyMove(state, 'A', 'a', { x: 99, y: 0 }).ok).toBe(false);
  });

  it('will not move a unit onto an occupied tile', () => {
    let state = baseState();
    state = addUnit(state, 'a', 'A', 'WARRIOR', { x: 2, y: 2 });
    state = addUnit(state, 'b', 'B', 'WARRIOR', { x: 3, y: 3 });
    const reachable = computeReachable(state, state.units.get('a')!);
    expect(reachable.some((p) => p.x === 3 && p.y === 3)).toBe(false);
  });
});

describe('combat', () => {
  it('applies melee damage and rejects out-of-range targets', () => {
    let state = baseState();
    state = addUnit(state, 'w', 'A', 'WARRIOR', { x: 1, y: 1 });
    state = addUnit(state, 'e', 'B', 'WARRIOR', { x: 6, y: 6 });

    const far = applyAttack(state, 'A', 'w', 'e');
    expect(far.ok).toBe(false);
    expect(far.error).toMatch(/range/i);

    state = cloneState(state);
    state.units.get('e')!.position = { x: 2, y: 2 };
    const hit = applyAttack(state, 'A', 'w', 'e');
    expect(hit.ok).toBe(true);
    expect(hit.state!.units.get('e')!.stats.currentHp).toBe(30 - 8);
  });

  it('splashes Wizard AoE onto every nearby unit, including allies and the caster', () => {
    let state = baseState();
    state = addUnit(state, 'wiz', 'A', 'WIZARD', { x: 4, y: 4 });
    state = addUnit(state, 'ally', 'A', 'WARRIOR', { x: 4, y: 5 });
    state = addUnit(state, 'e1', 'B', 'WARRIOR', { x: 5, y: 5 });
    state = addUnit(state, 'e2', 'B', 'WARRIOR', { x: 6, y: 6 });

    const result = applyAttack(state, 'A', 'wiz', 'e1');
    expect(result.ok).toBe(true);
    const after = result.state!;
    expect(after.units.get('e1')!.stats.currentHp).toBe(30 - 4);
    expect(after.units.get('e2')!.stats.currentHp).toBe(30 - 4); // splash
    expect(after.units.get('ally')!.stats.currentHp).toBe(30 - 4);
    expect(after.units.get('wiz')!.stats.currentHp).toBe(14 - 4); // caster is inside the ring too
  });

  it('requires line of sight for the Ranger', () => {
    let state = baseState([{ x: 2, y: 0 }]);
    state = addUnit(state, 'r', 'A', 'RANGER', { x: 0, y: 0 });
    state = addUnit(state, 'e', 'B', 'WARRIOR', { x: 5, y: 0 });
    const blocked = applyAttack(state, 'A', 'r', 'e');
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/line of sight/i);

    const open = applyAttack(baseState(), 'A', 'r2', 'e2');
    expect(open.ok).toBe(false); // no such units — sanity
    let clear = baseState();
    clear = addUnit(clear, 'r', 'A', 'RANGER', { x: 0, y: 0 });
    clear = addUnit(clear, 'e', 'B', 'WARRIOR', { x: 5, y: 0 });
    const rolls = [0, 0.999]; // hit, then maximum Ranger damage
    const fired = applyAttack(clear, 'A', 'r', 'e', () => rolls.shift() ?? 0);
    expect(fired.ok).toBe(true);
    expect(fired.state!.units.get('e')!.stats.currentHp).toBe(30 - 6);
    expect(fired.events?.[1]).toMatchObject({ type: 'UNIT_ATTACKED', hit: true, accuracy: 60 });
  });

  it('gives Rangers short-range accuracy, 4–6 damage, and action-consuming misses', () => {
    expect([1, 2, 3, 4, 5, 6].map(rangerAccuracyPercent)).toEqual([100, 90, 80, 70, 60, 50]);

    let state = baseState();
    state = addUnit(state, 'r', 'A', 'RANGER', { x: 1, y: 1 });
    state = addUnit(state, 'e', 'B', 'WARRIOR', { x: 7, y: 1 });
    const lowRolls = [0, 0]; // hit at 50% accuracy, then minimum damage
    const longHit = applyAttack(state, 'A', 'r', 'e', () => lowRolls.shift() ?? 0);
    expect(longHit.state!.units.get('e')!.stats.currentHp).toBe(30 - 4);
    expect(longHit.events?.[1]).toMatchObject({ type: 'UNIT_ATTACKED', hit: true, accuracy: 50, damage: 4 });

    const missed = applyAttack(state, 'A', 'r', 'e', () => 0.5);
    expect(missed.ok).toBe(true);
    expect(missed.state!.units.get('e')!.stats.currentHp).toBe(30);
    expect(missed.state!.units.get('r')!.hasAttacked).toBe(true);
    expect(missed.events?.[0]).toMatchObject({
      type: 'RANGER_SHOT',
      hit: false,
      accuracy: 50,
      targetId: 'e',
      destroyedTrap: false,
      destroyedIce: false,
    });

    let short = baseState();
    short = addUnit(short, 'r', 'A', 'RANGER', { x: 1, y: 1 });
    short = addUnit(short, 'e', 'B', 'WARRIOR', { x: 2, y: 1 });
    const hit = applyAttack(short, 'A', 'r', 'e', () => 0.99);
    expect(hit.state!.units.get('e')!.stats.currentHp).toBe(30 - 6);
    expect(hit.events?.[1]).toMatchObject({ type: 'UNIT_ATTACKED', hit: true, accuracy: 100 });
  });

  it('lets a Ranger shoot allies or empty tiles and break traps and ice on a hit', () => {
    let state = baseState();
    state = addUnit(state, 'r', 'A', 'RANGER', { x: 1, y: 1 });
    state = addUnit(state, 'ally', 'A', 'CLERIC', { x: 2, y: 1 });
    const friendlyShot = applyCommand(state, 'A', { type: 'RANGER_SHOT', unitId: 'r', x: 2, y: 1 }, () => 0);
    expect(friendlyShot.ok).toBe(true);
    expect(friendlyShot.state!.units.get('ally')!.stats.currentHp).toBe(20 - 4);
    expect(friendlyShot.events?.[0]).toMatchObject({ type: 'RANGER_SHOT', targetId: 'ally', hit: true });
    expect(friendlyShot.events?.[1]).toMatchObject({ type: 'UNIT_ATTACKED', targetId: 'ally', damage: 4 });

    let emptyGround = baseState();
    emptyGround = addUnit(emptyGround, 'r', 'A', 'RANGER', { x: 1, y: 1 });
    const spentArrow = applyCommand(
      emptyGround,
      'A',
      { type: 'RANGER_SHOT', unitId: 'r', x: 2, y: 1 },
      () => 0,
    );
    expect(spentArrow.state!.units.get('r')!.hasAttacked).toBe(true);
    expect(spentArrow.events?.[0]).toMatchObject({ type: 'RANGER_SHOT', hit: true, destroyedTrap: false, destroyedIce: false });

    let empty = baseState();
    empty = addUnit(empty, 'r', 'A', 'RANGER', { x: 1, y: 1 });
    empty.traps.push({ id: 'hidden-trap', ownerId: 'B', x: 2, y: 1, armed: true });
    empty.iceWalls.push({ x: 2, y: 1, expiresInTurns: 2, ownerId: 'B' });
    const clearShot = applyCommand(empty, 'A', { type: 'RANGER_SHOT', unitId: 'r', x: 2, y: 1 }, () => 0);
    expect(clearShot.ok).toBe(true);
    expect(clearShot.state!.units.size).toBe(1);
    expect(clearShot.state!.traps).toHaveLength(0);
    expect(clearShot.state!.iceWalls).toHaveLength(0);
    expect(clearShot.events).toContainEqual(expect.objectContaining({
      type: 'RANGER_SHOT', hit: true, destroyedTrap: true, destroyedIce: true,
    }));
  });

  it('does not reveal or destroy a trap/barrier when the Ranger misses', () => {
    let state = baseState();
    state = addUnit(state, 'r', 'A', 'RANGER', { x: 1, y: 1 });
    state.traps.push({ id: 'hidden-trap', ownerId: 'B', x: 7, y: 1, armed: true });
    state.iceWalls.push({ x: 7, y: 1, expiresInTurns: 2, ownerId: 'B' });
    const shot = applyCommand(state, 'A', { type: 'RANGER_SHOT', unitId: 'r', x: 7, y: 1 }, () => 0.5);
    expect(shot.ok).toBe(true);
    expect(shot.state!.traps).toHaveLength(1);
    expect(shot.state!.iceWalls).toHaveLength(1);
    expect(shot.events?.[0]).toMatchObject({
      type: 'RANGER_SHOT', hit: false, accuracy: 50, destroyedTrap: false, destroyedIce: false,
    });
  });

  it('offers empty, allied, enemy, and ice targets but excludes stone and blocked lanes', () => {
    let state = baseState([{ x: 3, y: 1 }]);
    state = addUnit(state, 'r', 'A', 'RANGER', { x: 1, y: 1 });
    state = addUnit(state, 'ally', 'A', 'CLERIC', { x: 2, y: 2 });
    state = addUnit(state, 'enemy', 'B', 'WARRIOR', { x: 5, y: 5 });
    state.iceWalls.push({ x: 2, y: 1, expiresInTurns: 2, ownerId: 'B' });
    const targets = legalRangerShotTargetsFor(state, 'r');
    expect(targets).toContainEqual({ x: 2, y: 1 }); // destructible ice
    expect(targets).toContainEqual({ x: 2, y: 2 }); // friendly fire
    expect(targets).toContainEqual({ x: 5, y: 5 }); // enemy tile
    expect(targets).not.toContainEqual({ x: 3, y: 1 }); // static stone
    expect(targets).not.toContainEqual({ x: 5, y: 1 }); // wall blocks the lane
  });

  // The `RANGER_SHOT` name is a lie: it is the generic tile-attack command and
  // every class can fire it. The renderer used to key the arrow sprite off the
  // event name, so every class shot arrows. This pins the reason the UI must
  // resolve the sprite from the unit's class instead.
  it('is the generic tile attack — a non-RANGER also emits RANGER_SHOT', () => {
    let state = baseState();
    state = addUnit(state, 'w', 'A', 'WARRIOR', { x: 1, y: 1 });
    state = addUnit(state, 'c', 'A', 'CLERIC', { x: 1, y: 3 });
    state = addUnit(state, 'z', 'A', 'WIZARD', { x: 3, y: 1 });

    // Each target sits inside that class's own attack range on the 8x8 board
    // (melee reach 1, Wizard Manhattan reach 2).
    for (const [id, x, y] of [['w', 2, 1], ['c', 1, 4], ['z', 3, 3]] as const) {
      expect(legalRangerShotTargetsFor(state, id)).toContainEqual({ x, y });
      const shot = applyCommand(state, 'A', { type: 'RANGER_SHOT', unitId: id, x, y });
      expect(shot.ok).toBe(true);
      expect(shot.events?.[0]?.type).toBe('RANGER_SHOT');
    }
  });
});

describe('cleric healing', () => {
  it('heals a wounded ally and refuses at full health', () => {
    let state = baseState();
    state = addUnit(state, 'c', 'A', 'CLERIC', { x: 1, y: 1 });
    state = addUnit(state, 't', 'A', 'WARRIOR', { x: 2, y: 2 });

    const full = applyHeal(state, 'A', 'c', 't');
    expect(full.ok).toBe(false);
    expect(full.error).toMatch(/full health/i);

    state = cloneState(state);
    state.units.get('t')!.stats.currentHp = 10;
    const healed = applyHeal(state, 'A', 'c', 't');
    expect(healed.ok).toBe(true);
    expect(healed.state!.units.get('t')!.stats.currentHp).toBe(20);
  });

  it('heals up to two orthogonal tiles but only one diagonal tile', () => {
    let state = baseState();
    state = addUnit(state, 'c', 'A', 'CLERIC', { x: 1, y: 1 });
    state = addUnit(state, 'straight-2', 'A', 'WARRIOR', { x: 3, y: 1 });
    state = addUnit(state, 'diag-1', 'A', 'WARRIOR', { x: 2, y: 2 });
    state = addUnit(state, 'diag-2', 'A', 'WARRIOR', { x: 3, y: 2 });
    state = addUnit(state, 'straight-3', 'A', 'WARRIOR', { x: 4, y: 1 });
    for (const id of ['straight-2', 'diag-1', 'diag-2', 'straight-3']) {
      state.units.get(id)!.stats.currentHp = 10;
    }

    expect(legalHealTargetsFor(state, 'c').map((unit) => unit.id).sort())
      .toEqual(['diag-1', 'straight-2']);
    expect(applyHeal(state, 'A', 'c', 'straight-2').ok).toBe(true);
    expect(applyHeal(state, 'A', 'c', 'diag-1').ok).toBe(true);
    expect(applyHeal(state, 'A', 'c', 'diag-2').error).toMatch(/heal range/i);
    expect(applyHeal(state, 'A', 'c', 'straight-3').error).toMatch(/heal range/i);
  });

  it('rejects healing an enemy or a non-cleric healer', () => {
    let state = baseState();
    state = addUnit(state, 'c', 'A', 'CLERIC', { x: 1, y: 1 });
    state = addUnit(state, 'w', 'A', 'WARRIOR', { x: 2, y: 2 });
    state = addUnit(state, 'e', 'B', 'WARRIOR', { x: 2, y: 1 });
    expect(applyHeal(state, 'A', 'c', 'e').error).toMatch(/your own/i);
    expect(applyHeal(state, 'A', 'w', 'c').error).toMatch(/cleric/i);
  });

  it('lets a Cleric heal itself', () => {
    // Self-healing is the obvious play when a Cleric is the only wounded unit,
    // and it is what makes the class survive a duel it walked into at range. The
    // engine always allowed it (same owner, distance 0 is inside every range);
    // this test exists because the *rules text* claimed otherwise for a while,
    // and that is exactly the kind of rule a future "fix" would break silently.
    let state = baseState();
    state = addUnit(state, 'c', 'A', 'CLERIC', { x: 1, y: 1 });
    state = cloneState(state);
    state.units.get('c')!.stats.currentHp = 5;

    expect(legalHealTargetsFor(state, 'c').map((u) => u.id)).toEqual(['c']);

    const healed = applyHeal(state, 'A', 'c', 'c');
    expect(healed.ok).toBe(true);
    expect(healed.state!.units.get('c')!.stats.currentHp).toBe(15);
  });

  it('still refuses self-healing at full health', () => {
    let state = baseState();
    state = addUnit(state, 'c', 'A', 'CLERIC', { x: 1, y: 1 });
    const full = applyHeal(state, 'A', 'c', 'c');
    expect(full.ok).toBe(false);
    expect(full.error).toMatch(/full health/i);
  });
});

describe('turn sequence', () => {
  it('passes initiative and wraps the turn counter', () => {
    let state = baseState();
    state = addUnit(state, 'a', 'A', 'WARRIOR', { x: 1, y: 1 });
    state = addUnit(state, 'b', 'B', 'WARRIOR', { x: 5, y: 5 });

    const moved = applyMove(state, 'A', 'a', { x: 2, y: 2 });
    const afterA = moved.state!;
    expect(afterA.units.get('a')!.hasMoved).toBe(true);

    const endA = applyEndTurn(afterA, 'A');
    expect(endA.state!.activePlayerId).toBe('B');
    expect(endA.state!.turnNumber).toBe(1);

    const endB = applyEndTurn(endA.state!, 'B');
    expect(endB.state!.activePlayerId).toBe('A');
    expect(endB.state!.turnNumber).toBe(2);
    // Flags reset for the incoming player.
    expect(endB.state!.units.get('a')!.hasMoved).toBe(false);
  });

  it('rejects ending a turn out of turn', () => {
    const state = baseState();
    expect(applyEndTurn(state, 'B').ok).toBe(false);
  });

  /*
   * Turn order is a player choice, not a script: movement and the action are
   * two separate points, and either may be spent first. These two tests pin the
   * behaviour in both directions so a future "move implies acted" shortcut
   * cannot silently force the old move-then-act sequence back in.
   */
  it('spends only the move, leaving the action available', () => {
    let state = baseState();
    state = addUnit(state, 'a', 'A', 'WARRIOR', { x: 1, y: 1 });
    state = addUnit(state, 'e', 'B', 'WARRIOR', { x: 3, y: 1 });

    const moved = applyMove(state, 'A', 'a', { x: 2, y: 1 });
    expect(moved.ok).toBe(true);
    const afterMove = moved.state!;
    expect(afterMove.units.get('a')!.hasMoved).toBe(true);
    expect(afterMove.units.get('a')!.hasAttacked).toBeFalsy();
    expect(afterMove.units.get('a')!.hasActed).toBeFalsy();

    const attack = applyAttack(afterMove, 'A', 'a', 'e');
    expect(attack.ok).toBe(true);
    expect(attack.state!.units.get('a')!.hasAttacked).toBe(true);
  });

  it('lets a unit act first and still move afterwards', () => {
    let state = baseState();
    state = addUnit(state, 'a', 'A', 'WARRIOR', { x: 1, y: 1 });
    state = addUnit(state, 'e', 'B', 'WARRIOR', { x: 2, y: 2 });

    const attack = applyAttack(state, 'A', 'a', 'e');
    expect(attack.ok).toBe(true);
    const afterAttack = attack.state!;
    expect(afterAttack.units.get('a')!.hasAttacked).toBe(true);
    expect(afterAttack.units.get('a')!.hasMoved).toBeFalsy();

    const moved = applyMove(afterAttack, 'A', 'a', { x: 1, y: 2 });
    expect(moved.ok).toBe(true);
    const repositioned = moved.state!.units.get('a')!;
    expect(repositioned.position).toEqual({ x: 1, y: 2 });
    expect(repositioned.hasMoved).toBe(true);
  });

});

describe('victory', () => {
  it('declares a winner when the last enemy falls', () => {
    let state = baseState();
    state = addUnit(state, 'a', 'A', 'WARRIOR', { x: 1, y: 1 });
    state = addUnit(state, 'e', 'B', 'WARRIOR', { x: 2, y: 2 });
    state = cloneState(state);
    state.units.get('e')!.stats.currentHp = 5;

    const kill = applyCommand(state, 'A', {
      type: 'ATTACK_UNIT',
      attackerId: 'a',
      targetId: 'e',
    });
    expect(kill.ok).toBe(true);
    expect(kill.state!.phase).toBe('ended');
    expect(kill.state!.winnerId).toBe('A');
    expect(checkVictory(kill.state!)).toBe('A');
  });
});

describe('warrior shield', () => {
  /** Warrior next to an ally, enemy adjacent to the ally (not the warrior). */
  const guardScenario = () => {
    let state = baseState();
    state = addUnit(state, 'w', 'A', 'WARRIOR', { x: 4, y: 4 });
    state = addUnit(state, 'r', 'A', 'RANGER', { x: 5, y: 4 });
    state = addUnit(state, 'e', 'B', 'RANGER', { x: 6, y: 4 });
    return state;
  };

  it('only lets a warrior guard an adjacent living ally', () => {
    const state = guardScenario();

    const ok = applyCommand(state, 'A', { type: 'GUARD_UNIT', unitId: 'w', targetId: 'r' });
    expect(ok.ok).toBe(true);
    expect(ok.state?.units.get('w')?.guardingUnitId).toBe('r');

    // non-warrior
    const badClass = applyCommand(state, 'A', { type: 'GUARD_UNIT', unitId: 'r', targetId: 'w' });
    expect(badClass.error).toMatch(/only a warrior/i);

    // not adjacent
    const far = addUnit(state, 'r2', 'A', 'CLERIC', { x: 0, y: 0 });
    const badRange = applyCommand(far, 'A', { type: 'GUARD_UNIT', unitId: 'w', targetId: 'r2' });
    expect(badRange.error).toMatch(/next to the warrior/i);

    // enemy ally
    const badOwner = applyCommand(state, 'A', { type: 'GUARD_UNIT', unitId: 'w', targetId: 'e' });
    expect(badOwner.error).toMatch(/your own units/i);

    // itself
    const badSelf = applyCommand(state, 'A', { type: 'GUARD_UNIT', unitId: 'w', targetId: 'w' });
    expect(badSelf.error).toMatch(/cannot guard itself/i);
  });

  it('costs the action, so nothing else is left this turn', () => {
    let state = guardScenario();
    state = applyCommand(state, 'A', { type: 'GUARD_UNIT', unitId: 'w', targetId: 'r' }).state!;

    const warrior = state.units.get('w')!;
    expect(warrior.hasAttacked).toBe(true);
    expect(warrior.hasActed).toBe(true);
    // Guard costs no *movement*, so the warrior can still reposition.
    expect(warrior.hasMoved).toBeFalsy();
  });

  it('refuses a second action after guarding', () => {
    let state = guardScenario();
    state = applyCommand(state, 'A', { type: 'GUARD_UNIT', unitId: 'w', targetId: 'r' }).state!;

    // No class gets two actions out of one turn — guard included.
    const again = applyCommand(state, 'A', { type: 'GUARD_UNIT', unitId: 'w', targetId: 'r' });
    expect(again.error).toMatch(/already acted/i);
    const attack = applyCommand(state, 'A', { type: 'ATTACK_UNIT', attackerId: 'w', targetId: 'e' });
    expect(attack.error).toMatch(/already acted/i);
  });

  it('refuses guarding after attacking, for the same reason', () => {
    // Warrior reach is 1, so the enemy has to be adjacent for the swing to land.
    let state = addUnit(guardScenario(), 'near', 'B', 'RANGER', { x: 4, y: 5 });
    const swung = applyCommand(state, 'A', { type: 'ATTACK_UNIT', attackerId: 'w', targetId: 'near' });
    expect(swung.ok).toBe(true);
    state = swung.state!;

    const late = applyCommand(state, 'A', { type: 'GUARD_UNIT', unitId: 'w', targetId: 'r' });
    expect(late.error).toMatch(/already acted/i);
    expect(late.state).toBeUndefined();
  });

  it('redirects damage aimed at the guarded ally onto the warrior', () => {
    let state = guardScenario();
    state = applyCommand(state, 'A', { type: 'GUARD_UNIT', unitId: 'w', targetId: 'r' }).state!;
    // Hand the turn to B so B's ranger can strike.
    state = applyCommand(state, 'A', { type: 'END_TURN' }).state!;

    const before = {
      warrior: state.units.get('w')!.stats.currentHp,
      ranger: state.units.get('r')!.stats.currentHp,
    };
    const result = applyCommand(state, 'B', { type: 'ATTACK_UNIT', attackerId: 'e', targetId: 'r' });
    expect(result.ok).toBe(true);

    // The ally is untouched...
    expect(result.state!.units.get('r')!.stats.currentHp).toBe(before.ranger);
    // ...and the warrior soaked it.
    expect(result.state!.units.get('w')!.stats.currentHp).toBeLessThan(before.warrior);

    const absorbed = result.events!.find((e) => e.type === 'GUARD_ABSORBED');
    expect(absorbed).toBeDefined();
    if (absorbed && absorbed.type === 'GUARD_ABSORBED') {
      expect(absorbed.guardianId).toBe('w');
      expect(absorbed.targetId).toBe('r');
      expect(absorbed.damage).toBeGreaterThan(0);
    }
  });

  it('lapses when the warriors next turn begins', () => {
    let state = guardScenario();
    state = applyCommand(state, 'A', { type: 'GUARD_UNIT', unitId: 'w', targetId: 'r' }).state!;
    state = applyCommand(state, 'A', { type: 'END_TURN' }).state!;
    // Still guarding through the opponent's turn — that is the point.
    expect(state.units.get('w')?.guardingUnitId).toBe('r');

    state = applyCommand(state, 'B', { type: 'END_TURN' }).state!;
    expect(state.units.get('w')?.guardingUnitId).toBeNull();
  });

  it('stops protecting once the warrior steps away', () => {
    let state = guardScenario();
    state = applyCommand(state, 'A', { type: 'GUARD_UNIT', unitId: 'w', targetId: 'r' }).state!;
    state = applyCommand(state, 'A', { type: 'MOVE_UNIT', unitId: 'w', to: { x: 4, y: 2 } }).state!;

    expect(guardOf(state, 'r')).toBeUndefined();

    state = applyCommand(state, 'A', { type: 'END_TURN' }).state!;
    const before = state.units.get('r')!.stats.currentHp;
    const result = applyCommand(state, 'B', { type: 'ATTACK_UNIT', attackerId: 'e', targetId: 'r' });
    expect(result.state!.units.get('r')!.stats.currentHp).toBeLessThan(before);
  });
});

describe('Wizard range geometry', () => {
  it('charges diagonal range twice for basic attacks and spells', () => {
    // Range 2 Manhattan means one straight tile or one diagonal, and NOT two
    // diagonals. A Wizard used to reach 4; this pins the new, tighter reach.
    let attackState = baseState();
    attackState = addUnit(attackState, 'wz', 'A', 'WIZARD', { x: 1, y: 1 });
    attackState = addUnit(attackState, 'near', 'B', 'RANGER', { x: 2, y: 2 });
    expect(applyCommand(attackState, 'A', {
      type: 'ATTACK_UNIT', attackerId: 'wz', targetId: 'near',
    }).ok).toBe(true); // 1 + 1 = range 2

    let farAttack = baseState();
    farAttack = addUnit(farAttack, 'wz', 'A', 'WIZARD', { x: 1, y: 1 });
    farAttack = addUnit(farAttack, 'far', 'B', 'RANGER', { x: 4, y: 4 });
    expect(applyCommand(farAttack, 'A', {
      type: 'ATTACK_UNIT', attackerId: 'wz', targetId: 'far',
    }).error).toMatch(/out of range/i); // 3 + 3 = 6

    let spell = baseState();
    spell = addUnit(spell, 'wz', 'A', 'WIZARD', { x: 1, y: 1 });
    expect(applyCommand(spell, 'A', {
      type: 'CAST_FIREBALL', unitId: 'wz', x: 2, y: 3,
    }).ok).toBe(true);

    let farSpell = baseState();
    farSpell = addUnit(farSpell, 'wz', 'A', 'WIZARD', { x: 1, y: 1 });
    expect(applyCommand(farSpell, 'A', {
      type: 'CAST_FIREBALL', unitId: 'wz', x: 4, y: 4,
    }).error).toMatch(/out of range/i);
  });
});

describe('Wizard basic attack range', () => {
  it('reaches exactly two Manhattan, so one tile straight or one diagonal', () => {
    expect(BASE_UNIT_STATS.WIZARD.attackRange).toBe(2);

    // Boundary cases either side of the reach, from a Wizard standing at (1,1).
    const at = (tx: number, ty: number) => {
      const state = addUnit(baseState(), 'wz', 'A', 'WIZARD', { x: 1, y: 1 });
      return applyCommand(
        addUnit(state, 'foe', 'B', 'RANGER', { x: tx, y: ty }),
        'A',
        { type: 'ATTACK_UNIT', attackerId: 'wz', targetId: 'foe' },
      );
    };

    expect(at(1, 2).ok, 'one straight tile').toBe(true);
    expect(at(2, 1).ok, 'one straight tile').toBe(true);
    expect(at(1, 3).ok, 'two straight tiles').toBe(true);
    expect(at(3, 1).ok, 'two straight tiles').toBe(true);
    expect(at(2, 2).ok, 'one diagonal').toBe(true);

    // A second diagonal step costs 2 more and must not be reachable.
    expect(at(2, 3).error, 'one and a half diagonals').toMatch(/out of range/i);
    expect(at(3, 2).error, 'one and a half diagonals').toMatch(/out of range/i);
    expect(at(3, 3).error, 'two diagonals').toMatch(/out of range/i);
  });

  it('still advertises the wider spell ranges', () => {
    // The Wizard's reach now comes from its spells, not its basic attack.
    expect(ABILITIES.FIREBALL.range).toBeGreaterThan(BASE_UNIT_STATS.WIZARD.attackRange);
    expect(ABILITIES.THUNDER_STRIKE.range).toBeGreaterThan(BASE_UNIT_STATS.WIZARD.attackRange);
  });

  it('highlights exactly the tiles it can actually attack', () => {
    // The preview must not promise a tile the reducer would reject.
    let state = baseState();
    state = addUnit(state, 'wz', 'A', 'WIZARD', { x: 1, y: 1 });
    state = addUnit(state, 'foe', 'B', 'RANGER', { x: 3, y: 3 });
    const tiles = attackRangeTiles(state, state.units.get('wz')!);
    const keys = new Set(tiles.map((p) => `${p.x},${p.y}`));
    expect(keys.has('2,2'), 'the diagonal is in reach').toBe(true);
    expect(keys.has('3,3'), 'two diagonals is out of reach').toBe(false);
    expect(keys.has('1,3'), 'two straight tiles is in reach').toBe(true);
  });
});

describe('class abilities', () => {
  /** Left column holds A's squad; the two enemies sit inside spell range. */
  const arena = () => {
    let state = baseState();
    state = addUnit(state, 'wz', 'A', 'WIZARD', { x: 1, y: 4 });
    state = addUnit(state, 'cl', 'A', 'CLERIC', { x: 1, y: 1 });
    state = addUnit(state, 'rg', 'A', 'RANGER', { x: 1, y: 6 });
    state = addUnit(state, 'wr', 'A', 'WARRIOR', { x: 1, y: 3 });
    state = addUnit(state, 'e1', 'B', 'RANGER', { x: 4, y: 4 });
    state = addUnit(state, 'e2', 'B', 'CLERIC', { x: 3, y: 4 });
    return state;
  };
  const hp = (state: GameState, id: string) => state.units.get(id)!.stats.currentHp;

  describe('fireball', () => {
    it('hits one target hard and spends the action', () => {
      const state = arena();
      const before = hp(state, 'e1');
      const result = applyCommand(state, 'A', { type: 'CAST_FIREBALL', unitId: 'wz', x: 4, y: 4 });
      expect(result.ok).toBe(true);
      expect(hp(result.state!, 'e1')).toBe(before - ABILITIES.FIREBALL.damage);
      expect(result.state!.units.get('wz')!.hasAttacked).toBe(true);
    });

    it('damages every enemy in the 3x3 block, centre hardest', () => {
      const state = arena();
      // e1 is on (4,4) — the aimed tile — and e2 on (3,4), inside the ring.
      const before1 = hp(state, 'e1');
      const before2 = hp(state, 'e2');
      const result = applyCommand(state, 'A', { type: 'CAST_FIREBALL', unitId: 'wz', x: 4, y: 4 });

      expect(result.ok).toBe(true);
      // Two tiers: the aimed tile takes the full hit, the ring takes the splash.
      expect(hp(result.state!, 'e1')).toBe(before1 - ABILITIES.FIREBALL.damage);
      expect(hp(result.state!, 'e2')).toBe(before2 - ABILITIES.FIREBALL.splash);
      expect(ABILITIES.FIREBALL.damage).toBeGreaterThan(ABILITIES.FIREBALL.splash);
    });

    it('spares allies outside the block and spares the caster standing clear of it', () => {
      // Wizard (1,4) is outside the 3x3 centred on (3,4) — x2..4 — so it takes
      // nothing even though its own ally is in the middle of the blast.
      let state = addUnit(baseState(), 'wz', 'A', 'WIZARD', { x: 1, y: 4 });
      state = addUnit(state, 'ally', 'A', 'CLERIC', { x: 3, y: 4 });
      state = addUnit(state, 'foe', 'B', 'RANGER', { x: 4, y: 4 });
      const beforeAlly = hp(state, 'ally');

      const result = applyCommand(state, 'A', { type: 'CAST_FIREBALL', unitId: 'wz', x: 3, y: 4 });
      expect(result.ok).toBe(true);
      // The ally is on the aimed tile, so it takes the full hit, not the splash.
      expect(hp(result.state!, 'ally')).toBe(beforeAlly - ABILITIES.FIREBALL.damage);
      expect(hp(result.state!, 'wz')).toBe(14);
    });

    it('leaves enemies outside the block untouched', () => {
      // Same arena, but the blast is centred a tile clear of both enemies.
      const state = arena();
      const before1 = hp(state, 'e1');
      const before2 = hp(state, 'e2');
      const result = applyCommand(state, 'A', { type: 'CAST_FIREBALL', unitId: 'wz', x: 1, y: 4 });

      expect(result.ok).toBe(true);
      expect(hp(result.state!, 'e1')).toBe(before1);
      expect(hp(result.state!, 'e2')).toBe(before2);
    });

    it('burns the caster\'s own allies — friendly fire is always on', () => {
      // arena(): wizard (1,4), warrior (1,3), cleric (1,1), ranger (1,6).
      // Aimed at (2,4) the 3x3 covers x1..3 / y3..5, so the wizard and the
      // warrior are both in the ring and the cleric and ranger are clear of it.
      const state = arena();
      const beforeCaster = hp(state, 'wz');
      const beforeAlly = hp(state, 'wr');
      const beforeCleric = hp(state, 'cl');
      const result = applyCommand(state, 'A', { type: 'CAST_FIREBALL', unitId: 'wz', x: 2, y: 4 });

      expect(result.ok).toBe(true);
      expect(hp(result.state!, 'wr')).toBe(beforeAlly - ABILITIES.FIREBALL.splash);
      expect(hp(result.state!, 'wz')).toBe(beforeCaster - ABILITIES.FIREBALL.splash);
      expect(hp(result.state!, 'cl')).toBe(beforeCleric);
    });

    it('refuses the wrong class and out-of-range targets', () => {
      const state = arena();
      expect(applyCommand(state, 'A', { type: 'CAST_FIREBALL', unitId: 'cl', x: 4, y: 4 }).error)
        .toMatch(/only a wizard/i);
      expect(applyCommand(state, 'A', { type: 'CAST_FIREBALL', unitId: 'wz', x: 7, y: 7 }).error)
        .toMatch(/out of range/i);
      // A rejection must not spend the caster's action.
      expect(state.units.get('wz')!.hasAttacked).toBeFalsy();
    });

    it('still allows aiming at empty ground', () => {
      const state = arena();
      const result = applyCommand(state, 'A', { type: 'CAST_FIREBALL', unitId: 'wz', x: 2, y: 4 });
      expect(result.ok).toBe(true);
    });
  });

  describe('thunder strike', () => {
    it('damages every enemy caught in the line', () => {
      const state = arena();
      const before1 = hp(state, 'e1');
      const before2 = hp(state, 'e2');
      const result = applyCommand(state, 'A', { type: 'CAST_THUNDER_STRIKE', unitId: 'wz', x: 4, y: 4 });
      expect(result.ok).toBe(true);
      expect(hp(result.state!, 'e1')).toBeLessThan(before1);
      expect(hp(result.state!, 'e2')).toBeLessThan(before2);
    });

    it('conducts down its own line too — friendly fire is always on', () => {
      // A bolt fired along y=4 from (1,4) runs through its own ranger at (3,4)
      // before reaching the enemy at (4,4).
      let state = baseState();
      state = addUnit(state, 'wz', 'A', 'WIZARD', { x: 1, y: 4 });
      state = addUnit(state, 'mate', 'A', 'RANGER', { x: 3, y: 4 });
      state = addUnit(state, 'e', 'B', 'RANGER', { x: 4, y: 4 });
      const beforeMate = hp(state, 'mate');
      const beforeFoe = hp(state, 'e');
      const result = applyCommand(state, 'A', { type: 'CAST_THUNDER_STRIKE', unitId: 'wz', x: 4, y: 4 });
      expect(result.ok).toBe(true);
      expect(hp(result.state!, 'mate')).toBe(beforeMate - ABILITIES.THUNDER_STRIKE.damage);
      expect(hp(result.state!, 'e')).toBeLessThan(beforeFoe);
    });
  });

  describe('ice wall', () => {
    it('turns clear ground into an impassable tile', () => {
      const state = arena();
      const result = applyCommand(state, 'A', { type: 'SUMMON_ICE_WALL', unitId: 'wz', x: 2, y: 4 });
      expect(result.ok).toBe(true);
      // Ice lives outside `terrain` precisely because it has to melt.
      expect(result.state!.terrain.get('2,4')).toBeUndefined();
      expect(isWall(result.state!, { x: 2, y: 4 })).toBe(true);
    });

    it('freezes whoever it is cast on, holding them until it melts', () => {
      let state = arena();
      // e1 is an enemy standing on (4,4); freezing your own is equally valid.
      const result = applyCommand(state, 'A', { type: 'SUMMON_ICE_WALL', unitId: 'wz', x: 4, y: 4 });
      expect(result.ok).toBe(true);
      expect(isWall(result.state!, { x: 4, y: 4 })).toBe(true);
      expect(frozen(result.state!, 'e1')).toBe(true);

      // B's turn: the frozen unit cannot move...
      state = applyCommand(result.state!, 'A', { type: 'END_TURN' }).state!;
      const move = applyCommand(state, 'B', { type: 'MOVE_UNIT', unitId: 'e1', to: { x: 5, y: 4 } });
      expect(move.error).toMatch(/frozen/i);
      // ...nor attack.
      const attack = applyCommand(state, 'B', { type: 'ATTACK_UNIT', attackerId: 'e1', targetId: 'cl' });
      expect(attack.error).toMatch(/frozen/i);
      // And the UI is told, so it greys out instead of offering a dead end.
      expect(legalMovesFor(state, 'e1')).toHaveLength(0);
      expect(legalAttackTargetsFor(state, 'e1')).toHaveLength(0);
    });

    it('releases the unit only once the ice is gone', () => {
      let state = arena();
      state = applyCommand(state, 'A', { type: 'SUMMON_ICE_WALL', unitId: 'wz', x: 4, y: 4 }).state!;
      expect(frozen(state, 'e1')).toBe(true);

      // Burn through the ice's turn clock by handing turns back and forth.
      for (let i = 0; i < ABILITIES.ICE_WALL.durationTurns + 1; i += 1) {
        if (state.activePlayerId === 'A') state = applyCommand(state, 'A', { type: 'END_TURN' }).state!;
        if (state.phase !== 'playing') break;
        if (state.activePlayerId === 'B') state = applyCommand(state, 'B', { type: 'END_TURN' }).state!;
      }

      expect(state.iceWalls).toHaveLength(0);
      expect(frozen(state, 'e1')).toBe(false);
    });

    it('will not form on stone or on ice that is already there', () => {
      let state = baseState([{ x: 2, y: 4 }]);
      state = addUnit(state, 'wz', 'A', 'WIZARD', { x: 1, y: 4 });
      expect(applyCommand(state, 'A', { type: 'SUMMON_ICE_WALL', unitId: 'wz', x: 2, y: 4 }).error)
        .toMatch(/stone/i);

      // A second wizard, so this is about the ice and not the spent action —
      // two of the same player's units can each act in one turn.
      state = addUnit(state, 'wz2', 'A', 'WIZARD', { x: 2, y: 5 });
      state = applyCommand(state, 'A', { type: 'SUMMON_ICE_WALL', unitId: 'wz', x: 4, y: 4 }).state!;
      const repeatedIce = applyCommand(state, 'A', { type: 'SUMMON_ICE_WALL', unitId: 'wz2', x: 4, y: 4 });
      expect(repeatedIce.error)
        .toMatch(/already ice/i);
    });

    /*
     * One wall per caster.
     *
     * It used to append, so a Wizard could bank ice across the whole map in a
     * single turn and shut down every approach to their Cleric. Re-casting now
     * melts your own previous wall and raises the new one where you aimed —
     * the same bargain Sanctified Ground makes.
     */
    it('melts the caster\'s previous wall rather than stacking a second', () => {
      let state = arena();
      // A second Wizard for the same player, so this is about walls and not
      // about a unit that has already spent its action.
      state = addUnit(state, 'wz2', 'A', 'WIZARD', { x: 1, y: 5 });

      state = applyCommand(state, 'A', { type: 'SUMMON_ICE_WALL', unitId: 'wz', x: 3, y: 4 }).state!;
      expect(state.iceWalls).toHaveLength(1);
      expect(state.iceWalls[0]).toMatchObject({ x: 3, y: 4, ownerId: 'A' });

      // Same player, different Wizard, different tile: still only one wall.
      state = applyCommand(state, 'A', { type: 'SUMMON_ICE_WALL', unitId: 'wz2', x: 2, y: 6 }).state!;
      expect(state.iceWalls).toHaveLength(1);
      expect(state.iceWalls[0]).toMatchObject({ x: 2, y: 6 });
    });

    it('leaves the other player\'s wall alone', () => {
      let state = arena();
      state = addUnit(state, 'wzB', 'B', 'WIZARD', { x: 6, y: 2 });

      state = applyCommand(state, 'A', { type: 'SUMMON_ICE_WALL', unitId: 'wz', x: 2, y: 4 }).state!;
      // Hand the turn over so B can legitimately cast.
      state = { ...state, activePlayerId: 'B' };
      state = applyCommand(state, 'B', { type: 'SUMMON_ICE_WALL', unitId: 'wzB', x: 6, y: 4 }).state!;

      expect(state.iceWalls).toHaveLength(2);
      expect(state.iceWalls.map((w) => w.ownerId).sort()).toEqual(['A', 'B']);
    });

    it('never melts an unowned wall from an older room', () => {
      // A room persisted before walls had an owner. We cannot tell whose it is,
      // and melting another player's ice would be worse than leaving it.
      const legacy = arena();
      legacy.iceWalls.push({ x: 6, y: 6, expiresInTurns: 2, ownerId: '' });

      const after = applyCommand(legacy, 'A', { type: 'SUMMON_ICE_WALL', unitId: 'wz', x: 2, y: 4 }).state!;
      expect(after.iceWalls).toHaveLength(2);
      expect(after.iceWalls.some((w) => w.x === 6 && w.y === 6)).toBe(true);
    });
  });

  describe('sanctified ground', () => {
    /*
     * One zone per caster — the rule Ice Wall was missing and now matches.
     *
     * This already worked (`filter(z => z.ownerId !== playerId)` in
     * `applyBlessGround`); the test is here because it was believed broken, and
     * a rule nobody can see failing is a rule that quietly comes back.
     */
    it('replaces the caster\'s previous zone instead of stacking a second', () => {
      let state = arena();
      state = applyCommand(state, 'A', { type: 'BLESS_GROUND', unitId: 'cl', x: 2, y: 2 }).state!;
      expect(state.zones).toHaveLength(1);

      // A second Cleric for the same player, so this is about zones and not
      // about a unit that has already acted.
      state = addUnit(state, 'cl2', 'A', 'CLERIC', { x: 1, y: 7 });
      state = applyCommand(state, 'A', { type: 'BLESS_GROUND', unitId: 'cl2', x: 3, y: 5 }).state!;

      expect(state.zones).toHaveLength(1);
      expect(state.zones[0]).toMatchObject({ x: 3, y: 5, ownerId: 'A' });
    });

    it('leaves the other player\'s zone alone', () => {
      let state = arena();
      state = addUnit(state, 'clB', 'B', 'CLERIC', { x: 6, y: 2 });
      state = applyCommand(state, 'A', { type: 'BLESS_GROUND', unitId: 'cl', x: 2, y: 2 }).state!;
      // Hand the turn over so B can legitimately cast.
      state = { ...state, activePlayerId: 'B' };
      state = applyCommand(state, 'B', { type: 'BLESS_GROUND', unitId: 'clB', x: 5, y: 2 }).state!;

      expect(state.zones).toHaveLength(2);
      expect(state.zones.map((z) => z.ownerId).sort()).toEqual(['A', 'B']);
    });

    it('heals the owner’s units for four HP each tick, not enemy units', () => {
      let state = arena();
      // Bless a cross centred on (2,2): (2,2) (3,2) (1,2) (2,3) (2,1).
      state = applyCommand(state, 'A', { type: 'BLESS_GROUND', unitId: 'cl', x: 2, y: 2 }).state!;
      expect(state.zones).toHaveLength(1);

      // Drop the warrior on the southern arm, then park an enemy on the eastern one.
      state = applyCommand(state, 'A', { type: 'MOVE_UNIT', unitId: 'wr', to: { x: 2, y: 3 } }).state!;
      const positioned = cloneState(state);
      const foe = positioned.units.get('e1')!;
      foe.position = { x: 3, y: 2 };
      positioned.units.get('wr')!.stats.currentHp = 10;
      positioned.units.get('e1')!.stats.currentHp = 10;

      const allyBefore = hp(positioned, 'wr');
      const enemyBefore = hp(positioned, 'e1');
      const ticked = applyCommand(positioned, 'A', { type: 'END_TURN' });

      expect(hp(ticked.state!, 'wr')).toBe(allyBefore + 4);
      expect(hp(ticked.state!, 'e1')).toBe(enemyBefore);
    });

    it('can be raised on top of units — the ground need not be clear', () => {
      const state = arena();
      // (3,4) holds an enemy; blessing over it is allowed.
      const result = applyCommand(state, 'A', { type: 'BLESS_GROUND', unitId: 'cl', x: 3, y: 4 });
      expect(result.ok).toBe(true);
      expect(result.state!.zones).toHaveLength(1);
    });

    it('ignores a stone tile on an arm instead of refusing the cast', () => {
      // (3,2) sits on the east arm of a cross anchored at (2,2). The cast used to
      // be rejected outright, which made the ability unusable from beside a wall
      // — exactly where a cleric often stands. It now blesses the remaining tiles.
      let state = baseState([{ x: 3, y: 2 }]);
      state = addUnit(state, 'cl', 'A', 'CLERIC', { x: 1, y: 1 });
      const result = applyCommand(state, 'A', { type: 'BLESS_GROUND', unitId: 'cl', x: 2, y: 2 });
      expect(result.ok).toBe(true);
      expect(result.state!.zones).toHaveLength(1);
      // The anchor and the three clear arms are blessed; the wall is not, so the
      // preview and the effect agree instead of the preview over-promising.
      expect(activeZoneTiles(result.state!, result.state!.zones[0])).toHaveLength(4);
    });

    it('blesses the part of the cross that fits when an arm hangs off the board', () => {
      // Anchoring at the corner puts two of the five tiles outside the grid.
      let state = baseState();
      state = addUnit(state, 'cl', 'A', 'CLERIC', { x: 1, y: 1 });
      const result = applyCommand(state, 'A', { type: 'BLESS_GROUND', unitId: 'cl', x: 0, y: 0 });
      expect(result.ok).toBe(true);
      // Only the anchor and its two in-bounds neighbours survive.
      expect(activeZoneTiles(result.state!, result.state!.zones[0])).toHaveLength(3);
    });

    it('still refuses a target that is itself off the board', () => {
      // The relaxed rule is about the arms, not about aiming at nothing.
      let state = baseState();
      state = addUnit(state, 'cl', 'A', 'CLERIC', { x: 1, y: 1 });
      expect(applyCommand(state, 'A', { type: 'BLESS_GROUND', unitId: 'cl', x: -1, y: 0 }).error)
        .toMatch(/off the board/i);
    });

    it('actually blesses a unit standing where a stone arm used to block the cast', () => {
      // Proves the ignored tile is cosmetic, not a silent no-op: the ally standing
      // on the clear part of the cross really does get the damage reduction.
      let state = baseState([{ x: 3, y: 2 }]);
      state = addUnit(state, 'cl', 'A', 'CLERIC', { x: 1, y: 1 });
      state = addUnit(state, 'ally', 'A', 'WARRIOR', { x: 1, y: 2 });
      state = applyCommand(state, 'A', { type: 'BLESS_GROUND', unitId: 'cl', x: 2, y: 2 }).state!;
      expect(isBlessed(state, state.units.get('ally')!)).toBe(true);
    });

    it('covers a plus of five tiles and leaves the diagonals bare', () => {
      const zone: Zone = { id: 'z', kind: 'SANCTIFIED_GROUND', ownerId: 'A', x: 3, y: 3, size: 1, durationTurns: 2 };
      expect(zoneTiles(zone)).toHaveLength(5);
      // The four orthogonal neighbours.
      expect(zoneCovers(zone, 3, 3)).toBe(true);
      expect(zoneCovers(zone, 4, 3)).toBe(true);
      expect(zoneCovers(zone, 2, 3)).toBe(true);
      expect(zoneCovers(zone, 3, 4)).toBe(true);
      expect(zoneCovers(zone, 3, 2)).toBe(true);
      // The four diagonals are NOT covered — this is the whole point of the shape.
      expect(zoneCovers(zone, 4, 4)).toBe(false);
      expect(zoneCovers(zone, 4, 2)).toBe(false);
      expect(zoneCovers(zone, 2, 4)).toBe(false);
      expect(zoneCovers(zone, 2, 2)).toBe(false);
      // Nor is anything two tiles out.
      expect(zoneCovers(zone, 5, 3)).toBe(false);
    });

    it('never renders the zone onto stone, whoever cast it', () => {
      // The enemy Cleric's cast is the one the player never aimed, so it is the
      // one that has to be right without a preview to check it against. The board
      // used to tint from the raw `zoneCovers` cross while the aim preview used
      // the clipped `activeZoneTiles`, and the disagreement showed up as a red
      // cross painted across walls.
      //
      // The engine does not care which owner cast it — `activeZoneTiles` takes no
      // owner — so both are asserted here to pin that the renderer cannot drift
      // back to a per-owner special case.
      // One stone sits in the arm of each cross, so both zones have something to
      // spill over: (4,3) for the zone centred (3,3), (5,3) for the one at (5,4).
      let state = baseState([{ x: 4, y: 3 }, { x: 5, y: 3 }]);
      state = addUnit(state, 'cl', 'A', 'CLERIC', { x: 1, y: 1 });
      state = addUnit(state, 'foe', 'B', 'CLERIC', { x: 5, y: 5 });
      state = applyCommand(state, 'A', { type: 'BLESS_GROUND', unitId: 'cl', x: 3, y: 3 }).state!;
      state = applyCommand(state, 'A', { type: 'END_TURN' }).state!;
      state = applyCommand(state, 'B', { type: 'BLESS_GROUND', unitId: 'foe', x: 5, y: 4 }).state!;

      expect(state.zones).toHaveLength(2);
      for (const zone of state.zones) {
        for (const tile of activeZoneTiles(state, zone)) {
          expect(inBounds(tile, state.boardSize)).toBe(true);
          expect(isWall(state, tile)).toBe(false);
        }
      }
      // Specifically: the stone the enemy cross reaches over is covered
      // mathematically but is not a tile the board may paint.
      const enemyZone = state.zones.find((zone) => zone.ownerId === 'B')!;
      expect(zoneCovers(enemyZone, 5, 3)).toBe(true);
      expect(activeZoneTiles(state, enemyZone).some((t) => t.x === 5 && t.y === 3)).toBe(false);
    });

    it('expires after its duration', () => {
      let state = arena();
      state = applyCommand(state, 'A', { type: 'BLESS_GROUND', unitId: 'cl', x: 2, y: 2 }).state!;
      expect(state.zones).toHaveLength(1);
      for (let i = 0; i < ABILITIES.SANCTIFIED_GROUND.durationTurns; i += 1) {
        state = applyCommand(state, i % 2 === 0 ? 'A' : 'B', { type: 'END_TURN' }).state!;
      }
      expect(state.zones).toHaveLength(0);
    });

    it('blunts damage dealt to a blessed ally', () => {
      // Bless first, while the quadrant is genuinely empty.
      let state = baseState();
      state = addUnit(state, 'cl', 'A', 'CLERIC', { x: 0, y: 0 });
      state = applyCommand(state, 'A', { type: 'BLESS_GROUND', unitId: 'cl', x: 2, y: 2 }).state!;
      state = addUnit(state, 'wr', 'A', 'WARRIOR', { x: 2, y: 2 });
      state = addUnit(state, 'e', 'B', 'WARRIOR', { x: 3, y: 2 });
      state = applyCommand(state, 'A', { type: 'END_TURN' }).state!;

      const before = hp(state, 'wr');
      const plain = cloneState(state);
      plain.zones = [];
      const hitPlain = applyCommand(plain, 'B', { type: 'ATTACK_UNIT', attackerId: 'e', targetId: 'wr' });
      const hitBlessed = applyCommand(state, 'B', { type: 'ATTACK_UNIT', attackerId: 'e', targetId: 'wr' });

      expect(hitPlain.ok && hitBlessed.ok).toBe(true);
      const plainLoss = before - hp(hitPlain.state!, 'wr');
      const blessedLoss = before - hp(hitBlessed.state!, 'wr');
      expect(blessedLoss).toBeLessThan(plainLoss);
    });
  });

  describe('ranger trap', () => {
    it('roots the first enemy to step on it', () => {
      let state = baseState();
      // The trap is set on the 3x3 around the ranger, so the ranger starts next
      // to where it is laid.
      state = addUnit(state, 'rg', 'A', 'RANGER', { x: 2, y: 1 });
      state = addUnit(state, 'e', 'B', 'RANGER', { x: 5, y: 1 });
      state = applyCommand(state, 'A', { type: 'PLACE_TRAP', unitId: 'rg', x: 3, y: 1 }).state!;
      expect(state.traps).toHaveLength(1);

      state = applyCommand(state, 'A', { type: 'END_TURN' }).state!;
      const stepped = applyCommand(state, 'B', { type: 'MOVE_UNIT', unitId: 'e', to: { x: 3, y: 1 } });
      expect(stepped.ok).toBe(true);
      expect(stepped.state!.units.get('e')!.rootedTurns).toBeGreaterThan(0);
      // Disarmed after firing.
      expect(stepped.state!.traps[0].armed).toBe(false);
    });

    it('never fires for its own owner', () => {
      let state = baseState();
      state = addUnit(state, 'rg', 'A', 'RANGER', { x: 1, y: 1 });
      state = applyCommand(state, 'A', { type: 'PLACE_TRAP', unitId: 'rg', x: 2, y: 1 }).state!;
      const stepped = applyCommand(state, 'A', { type: 'MOVE_UNIT', unitId: 'rg', to: { x: 2, y: 1 } });
      expect(stepped.state!.traps[0].armed).toBe(true);
    });

    it('only reaches the 3x3 around the ranger', () => {
      // Each placement needs a fresh board, since one trap already spent the
      // ranger's action.
      const withRanger = () => addUnit(baseState(), 'rg', 'A', 'RANGER', { x: 1, y: 1 });

      // All eight neighbours are legal.
      for (const tile of [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
        { x: 0, y: 1 }, { x: 2, y: 1 },
        { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
      ]) {
        const placed = applyCommand(withRanger(), 'A', { type: 'PLACE_TRAP', unitId: 'rg', ...tile });
        expect(placed.error, `tile ${tile.x},${tile.y} should be placeable`).toBeUndefined();
      }

      // Two tiles out is not, however open the ground is.
      const far = applyCommand(withRanger(), 'A', { type: 'PLACE_TRAP', unitId: 'rg', x: 4, y: 1 });
      expect(far.error).toMatch(/out of range/i);
    });

    it('cannot be laid under the ranger', () => {
      const state = addUnit(baseState(), 'rg', 'A', 'RANGER', { x: 1, y: 1 });
      const own = applyCommand(state, 'A', { type: 'PLACE_TRAP', unitId: 'rg', x: 1, y: 1 });
      expect(own.error).toMatch(/beside you/i);
    });

    it('blocks movement while rooted', () => {
      let state = baseState();
      state = addUnit(state, 'rg', 'A', 'RANGER', { x: 2, y: 1 });
      state = addUnit(state, 'e', 'B', 'RANGER', { x: 5, y: 1 });
      state = applyCommand(state, 'A', { type: 'PLACE_TRAP', unitId: 'rg', x: 3, y: 1 }).state!;
      state = applyCommand(state, 'A', { type: 'END_TURN' }).state!;
      state = applyCommand(state, 'B', { type: 'MOVE_UNIT', unitId: 'e', to: { x: 3, y: 1 } }).state!;
      state = applyCommand(state, 'B', { type: 'END_TURN' }).state!;

      // A ends immediately, so it is B's next turn — exactly the move the root
      // was meant to deny.
      state = applyCommand(state, 'A', { type: 'END_TURN' }).state!;
      const blocked = applyCommand(state, 'B', { type: 'MOVE_UNIT', unitId: 'e', to: { x: 4, y: 1 } });
      expect(blocked.error).toMatch(/rooted/i);
    });
  });

  describe('grapple', () => {
    it('repositions the ranger next to a hooked wall', () => {
      // Straight shot along the row, 4 tiles: the hook reaches, and no diagonal
      // is involved.
      let state = baseState([{ x: 5, y: 3 }]);
      state = addUnit(state, 'rg', 'A', 'RANGER', { x: 1, y: 3 });
      const result = applyCommand(state, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 5, y: 3 });
      expect(result.ok).toBe(true);
      const landed = result.state!.units.get('rg')!.position;
      // Adjacent to the wall, not on it.
      expect(Math.abs(landed.x - 5) + Math.abs(landed.y - 3)).toBe(1);
    });

    it('only reaches up, down, left or right', () => {
      // The diagonal is exactly within range (2+2), but walls can only be hooked
      // on a straight row or column.
      let diag = baseState([{ x: 3, y: 3 }]);
      diag = addUnit(diag, 'rg', 'A', 'RANGER', { x: 1, y: 1 });
      const hooked = applyCommand(diag, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 3, y: 3 });
      expect(hooked.error).toMatch(/up, down, left or right/i);

      // The same wall directly to the right is fine.
      let straight = baseState([{ x: 5, y: 1 }]);
      straight = addUnit(straight, 'rg', 'A', 'RANGER', { x: 1, y: 1 });
      expect(applyCommand(straight, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 5, y: 1 }).ok).toBe(true);
    });

    it('reaches at most 4 tiles', () => {
      let near = baseState([{ x: 5, y: 1 }]);
      near = addUnit(near, 'rg', 'A', 'RANGER', { x: 1, y: 1 });
      expect(applyCommand(near, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 5, y: 1 }).ok).toBe(true);

      let far = baseState([{ x: 6, y: 1 }]);
      far = addUnit(far, 'rg', 'A', 'RANGER', { x: 1, y: 1 });
      expect(applyCommand(far, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 6, y: 1 }).error)
        .toMatch(/out of range/i);
    });

    it('needs a wall or a unit to hook', () => {
      let state = baseState();
      state = addUnit(state, 'rg', 'A', 'RANGER', { x: 1, y: 1 });
      expect(applyCommand(state, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 5, y: 1 }).error)
        .toMatch(/wall or a unit/i);
    });

    it('pulls a hooked enemy to a tile beside the ranger', () => {
      let state = baseState();
      state = addUnit(state, 'rg', 'A', 'RANGER', { x: 3, y: 3 });
      state = addUnit(state, 'e', 'B', 'WARRIOR', { x: 5, y: 3 });
      const result = applyCommand(state, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 5, y: 3 });

      expect(result.ok).toBe(true);
      const pulled = result.state!.units.get('e')!.position;
      const ranger = result.state!.units.get('rg')!.position;
      // Beside the ranger, and the ranger itself did not move.
      expect(Math.max(Math.abs(pulled.x - ranger.x), Math.abs(pulled.y - ranger.y))).toBe(1);
      expect(ranger).toEqual({ x: 3, y: 3 });
    });

    it('pulls an ally too — friendly fire is always on', () => {
      let state = baseState();
      state = addUnit(state, 'rg', 'A', 'RANGER', { x: 3, y: 3 });
      state = addUnit(state, 'mate', 'A', 'CLERIC', { x: 5, y: 3 });
      const result = applyCommand(state, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 5, y: 3 });

      expect(result.ok).toBe(true);
      const pulled = result.state!.units.get('mate')!.position;
      expect(Math.abs(pulled.x - 3) + Math.abs(pulled.y - 3)).toBe(1);
    });

    it('spends the action, not the move, when dragging a unit', () => {
      let state = baseState();
      state = addUnit(state, 'rg', 'A', 'RANGER', { x: 3, y: 3 });
      state = addUnit(state, 'e', 'B', 'WARRIOR', { x: 5, y: 3 });
      const result = applyCommand(state, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 5, y: 3 });

      const ranger = result.state!.units.get('rg')!;
      expect(ranger.hasAttacked).toBe(true);
      // The move is kept, so the Ranger can still reposition.
      expect(ranger.hasMoved).toBeFalsy();
    });

    it('charges diagonal unit hooks 2 per tile while wall swings stay line-locked', () => {
      let state = baseState();
      state = addUnit(state, 'rg', 'A', 'RANGER', { x: 1, y: 1 });
      state = addUnit(state, 'e', 'B', 'WARRIOR', { x: 3, y: 3 });
      expect(applyCommand(state, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 3, y: 3 }).ok).toBe(true);

      state = baseState();
      state = addUnit(state, 'rg', 'A', 'RANGER', { x: 1, y: 1 });
      state = addUnit(state, 'e', 'B', 'WARRIOR', { x: 3, y: 4 });
      expect(applyCommand(state, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 3, y: 4 }).error)
        .toMatch(/out of range/i);
    });

    it('spends the whole turn on a wall swing, so it cannot be spammed', () => {
      // The wall hook used to refund the action, which left the skill button lit
      // and let the Ranger swing across every wall in range on one turn.
      let state = baseState([{ x: 5, y: 1 }]);
      state = addUnit(state, 'rg', 'A', 'RANGER', { x: 1, y: 1 });
      const result = applyCommand(state, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 5, y: 1 });

      const ranger = result.state!.units.get('rg')!;
      expect(ranger.hasMoved).toBe(true);
      expect(ranger.hasAttacked).toBe(true);
      expect(ranger.hasActed).toBe(true);
    });

    it('cannot grapple itself', () => {
      let state = baseState();
      state = addUnit(state, 'rg', 'A', 'RANGER', { x: 3, y: 3 });
      expect(applyCommand(state, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 3, y: 3 }).error)
        .toMatch(/yourself/i);
    });

    it('cannot drag a unit past the rope length', () => {
      let state = baseState();
      // Manhattan 12 on an 8x8 board, well past the range of 4.
      state = addUnit(state, 'rg', 'A', 'RANGER', { x: 1, y: 1 });
      state = addUnit(state, 'e', 'B', 'WARRIOR', { x: 7, y: 7 });
      expect(applyCommand(state, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 7, y: 7 }).error)
        .toMatch(/out of range/i);
    });

    it('does not drag a defeated unit off the board', () => {
      let state = baseState();
      state = addUnit(state, 'rg', 'A', 'RANGER', { x: 3, y: 3 });
      state = addUnit(state, 'corpse', 'B', 'WARRIOR', { x: 5, y: 3 });
      state = setHp(state, 'corpse', 0);
      expect(applyCommand(state, 'A', { type: 'GRAPPLE', unitId: 'rg', x: 5, y: 3 }).error)
        .toMatch(/wall or a unit/i);
    });
  });

  describe('shield slam', () => {
    it('knocks an adjacent enemy back a tile', () => {
      let state = baseState();
      state = addUnit(state, 'wr', 'A', 'WARRIOR', { x: 3, y: 3 });
      state = addUnit(state, 'e', 'B', 'RANGER', { x: 4, y: 3 });
      const result = applyCommand(state, 'A', { type: 'SHIELD_SLAM', unitId: 'wr', x: 4, y: 3 });
      expect(result.ok).toBe(true);
      expect(result.state!.units.get('e')!.position).toEqual({ x: 5, y: 3 });
      // A slam always deals 3, not the Warrior's swing damage.
      expect(hp(state, 'e') - hp(result.state!, 'e')).toBe(3);
    });

    it('hits an ally standing in the way — friendly fire is always on', () => {
      let state = baseState();
      state = addUnit(state, 'wr', 'A', 'WARRIOR', { x: 3, y: 3 });
      state = addUnit(state, 'mate', 'A', 'CLERIC', { x: 4, y: 3 });
      state = addUnit(state, 'e', 'B', 'RANGER', { x: 7, y: 7 });
      const before = hp(state, 'mate');
      const result = applyCommand(state, 'A', { type: 'SHIELD_SLAM', unitId: 'wr', x: 4, y: 3 });
      expect(result.ok).toBe(true);
      expect(hp(result.state!, 'mate')).toBeLessThan(before);
    });

    it('wastes the swing on empty ground rather than refusing', () => {
      let state = baseState();
      state = addUnit(state, 'wr', 'A', 'WARRIOR', { x: 3, y: 3 });
      state = addUnit(state, 'e', 'B', 'RANGER', { x: 7, y: 7 });
      const result = applyCommand(state, 'A', { type: 'SHIELD_SLAM', unitId: 'wr', x: 4, y: 4 });
      expect(result.ok).toBe(true);
      // The action is still spent.
      expect(result.state!.units.get('wr')!.hasAttacked).toBe(true);
    });

    it('cannot reach further than the shield arm', () => {
      let state = baseState();
      state = addUnit(state, 'wr', 'A', 'WARRIOR', { x: 1, y: 1 });
      state = addUnit(state, 'e', 'B', 'RANGER', { x: 6, y: 6 });
      expect(applyCommand(state, 'A', { type: 'SHIELD_SLAM', unitId: 'wr', x: 6, y: 6 }).error)
        .toMatch(/out of range/i);
    });

    it('adds impact damage and a stun when the push is blocked by stone', () => {
      let state = baseState([{ x: 5, y: 3 }]);
      state = addUnit(state, 'wr', 'A', 'WARRIOR', { x: 3, y: 3 });
      state = addUnit(state, 'e', 'B', 'RANGER', { x: 4, y: 3 });
      state = addUnit(state, 'e2', 'B', 'WARRIOR', { x: 4, y: 4 });
      const before = hp(state, 'e');
      const result = applyCommand(state, 'A', { type: 'SHIELD_SLAM', unitId: 'wr', x: 4, y: 3 });

      expect(result.ok).toBe(true);
      // Pinned against the wall: does not move.
      expect(result.state!.units.get('e')!.position).toEqual({ x: 4, y: 3 });
      // A slam is a shove, not a sword swing: 3 damage, +4 for the stone.
      expect(before - hp(result.state!, 'e')).toBe(7);
      expect(result.events!.some((e) => e.type === 'IMPACT_BONUS')).toBe(true);

      const bTurn = applyCommand(result.state!, 'A', { type: 'END_TURN' }).state!;

      // Behavioural check: the stun denies their next ACTION.
      const stunned = applyCommand(bTurn, 'B', {
        type: 'ATTACK_UNIT',
        attackerId: 'e',
        targetId: 'wr',
      });
      expect(stunned.error).toMatch(/stunned/i);

      // …but not their legs: a stunned unit still gets its step.
      const walked = applyCommand(bTurn, 'B', {
        type: 'MOVE_UNIT',
        unitId: 'e',
        to: { x: 4, y: 2 },
      });
      expect(walked.ok).toBe(true);
    });
  });
});

describe('paladin abilities', () => {
  const hp = (state: GameState, id: string) => state.units.get(id)!.stats.currentHp;

  it('Holy Smite deals 10 melee damage at range 1', () => {
    let state = baseState();
    state = addUnit(state, 'p', 'A', 'PALADIN', { x: 3, y: 3 });
    state = addUnit(state, 'e', 'B', 'RANGER', { x: 4, y: 3 });
    const before = hp(state, 'e');
    const result = applyCommand(state, 'A', { type: 'HOLY_SMITE', unitId: 'p', x: 4, y: 3 });
    expect(result.ok).toBe(true);
    expect(before - hp(result.state!, 'e')).toBe(10);
  });

  it('Holy Smite deals 4 ranged damage at range 2', () => {
    let state = baseState();
    state = addUnit(state, 'p', 'A', 'PALADIN', { x: 3, y: 3 });
    state = addUnit(state, 'e', 'B', 'RANGER', { x: 5, y: 3 });
    const before = hp(state, 'e');
    const result = applyCommand(state, 'A', { type: 'HOLY_SMITE', unitId: 'p', x: 5, y: 3 });
    expect(result.ok).toBe(true);
    expect(before - hp(result.state!, 'e')).toBe(4);
  });

  it('Divine Shield applies shield HP to self and adjacent allies', () => {
    let state = baseState();
    state = addUnit(state, 'p', 'A', 'PALADIN', { x: 3, y: 3 });
    state = addUnit(state, 'a', 'A', 'CLERIC', { x: 4, y: 3 });
    const result = applyCommand(state, 'A', { type: 'DIVINE_SHIELD', unitId: 'p', x: 3, y: 3 });
    expect(result.ok).toBe(true);
    expect(result.state!.units.get('p')!.shieldHp).toBe(8);
    expect(result.state!.units.get('a')!.shieldHp).toBe(8);
  });

  it('Holy Light heals ally for 5 HP', () => {
    let state = baseState();
    state = addUnit(state, 'p', 'A', 'PALADIN', { x: 3, y: 3 });
    state = addUnit(state, 'a', 'A', 'CLERIC', { x: 4, y: 3 });
    state.units.get('a')!.stats.currentHp = 10;
    const result = applyCommand(state, 'A', { type: 'HOLY_LIGHT', unitId: 'p', x: 4, y: 3 });
    expect(result.ok).toBe(true);
    expect(hp(result.state!, 'a')).toBe(15);
  });

  it('Holy Light blinds enemy', () => {
    let state = baseState();
    state = addUnit(state, 'p', 'A', 'PALADIN', { x: 3, y: 3 });
    state = addUnit(state, 'e', 'B', 'RANGER', { x: 4, y: 3 });
    const result = applyCommand(state, 'A', { type: 'HOLY_LIGHT', unitId: 'p', x: 4, y: 3 });
    expect(result.ok).toBe(true);
    // 2, not 1: blind decays on entry to the victim's turn, so 1 would expire
    // before the victim ever swung.
    expect(result.state!.units.get('e')!.blindedTurns).toBe(2);
  });
});

describe('new class abilities', () => {
  const hp = (state: GameState, id: string) => state.units.get(id)!.stats.currentHp;

  describe('warlock', () => {
    it('Eldritch Bolt deals 7 damage', () => {
      let state = baseState();
      state = addUnit(state, 'w', 'A', 'WARLOCK', { x: 3, y: 3 });
      state = addUnit(state, 'e', 'B', 'RANGER', { x: 5, y: 3 });
      const before = hp(state, 'e');
      const result = applyCommand(state, 'A', { type: 'ELDRITCH_BOLT', unitId: 'w', x: 5, y: 3 });
      expect(result.ok).toBe(true);
      expect(before - hp(result.state!, 'e')).toBe(7);
    });

    it('Soul Drain heals the warlock', () => {
      let state = baseState();
      state = addUnit(state, 'w', 'A', 'WARLOCK', { x: 3, y: 3 });
      state = addUnit(state, 'e', 'B', 'RANGER', { x: 4, y: 3 });
      state.units.get('w')!.stats.currentHp = 5;
      const before = hp(state, 'w');
      const result = applyCommand(state, 'A', { type: 'SOUL_DRAIN', unitId: 'w', x: 4, y: 3 });
      expect(result.ok).toBe(true);
      expect(hp(result.state!, 'w')).toBeGreaterThan(before);
    });

    it('Curse of Agony applies cursedTurns', () => {
      let state = baseState();
      state = addUnit(state, 'w', 'A', 'WARLOCK', { x: 3, y: 3 });
      state = addUnit(state, 'e', 'B', 'RANGER', { x: 4, y: 3 });
      const result = applyCommand(state, 'A', { type: 'CURSE_OF_AGONY', unitId: 'w', x: 4, y: 3 });
      expect(result.ok).toBe(true);
      expect(result.state!.units.get('e')!.cursedTurns).toBe(2);
    });
  });

  describe('rogue', () => {
    it('Poisoned Dagger deals 4 damage and applies poison', () => {
      let state = baseState();
      state = addUnit(state, 'r', 'A', 'ROGUE', { x: 3, y: 3 });
      state = addUnit(state, 'e', 'B', 'RANGER', { x: 5, y: 3 });
      const before = hp(state, 'e');
      const result = applyCommand(state, 'A', { type: 'POISONED_DAGGER', unitId: 'r', x: 5, y: 3 });
      expect(result.ok).toBe(true);
      expect(before - hp(result.state!, 'e')).toBe(4);
      expect(result.state!.units.get('e')!.poisonedTurns).toBe(2);
    });

    it('Shadow Step teleports the rogue', () => {
      let state = baseState();
      state = addUnit(state, 'r', 'A', 'ROGUE', { x: 3, y: 3 });
      const result = applyCommand(state, 'A', { type: 'SHADOW_STEP', unitId: 'r', x: 5, y: 3 });
      expect(result.ok).toBe(true);
      expect(result.state!.units.get('r')!.position).toEqual({ x: 5, y: 3 });
    });
  });

  describe('druid', () => {
    it('Regrowth heals ally', () => {
      let state = baseState();
      state = addUnit(state, 'd', 'A', 'DRUID', { x: 3, y: 3 });
      state = addUnit(state, 'a', 'A', 'CLERIC', { x: 4, y: 3 });
      state.units.get('a')!.stats.currentHp = 5;
      const result = applyCommand(state, 'A', { type: 'REGROWTH', unitId: 'd', x: 4, y: 3 });
      expect(result.ok).toBe(true);
      expect(hp(result.state!, 'a')).toBe(11);
    });

    it('Roots of Entanglement roots enemy', () => {
      let state = baseState();
      state = addUnit(state, 'd', 'A', 'DRUID', { x: 3, y: 3 });
      state = addUnit(state, 'e', 'B', 'RANGER', { x: 4, y: 3 });
      const result = applyCommand(state, 'A', { type: 'ROOTS_OF_ENTANGLEMENT', unitId: 'd', x: 4, y: 3 });
      expect(result.ok).toBe(true);
      expect(result.state!.units.get('e')!.rootedTurns).toBe(2);
    });
  });

  describe('bard', () => {
    it('Song of Rest heals in 3x3', () => {
      let state = baseState();
      state = addUnit(state, 'b', 'A', 'BARD', { x: 3, y: 3 });
      state = addUnit(state, 'a', 'A', 'CLERIC', { x: 4, y: 3 });
      state.units.get('a')!.stats.currentHp = 5;
      const result = applyCommand(state, 'A', { type: 'SONG_OF_REST', unitId: 'b', x: 3, y: 3 });
      expect(result.ok).toBe(true);
      expect(hp(result.state!, 'a')).toBe(8);
    });
  });
});

describe('new class abilities: integration', () => {
  /** Every new ability paired with the class that owns it. */
  const NEW_ABILITIES: Array<[UnitType, AbilityId]> = [
    ['PALADIN', 'HOLY_SMITE'],
    ['PALADIN', 'DIVINE_SHIELD'],
    ['PALADIN', 'HOLY_LIGHT'],
    ['BARD', 'DISSONANT_MELODY'],
    ['BARD', 'INSPIRING_ANTHEM'],
    ['BARD', 'SONG_OF_REST'],
    ['WARLOCK', 'ELDRITCH_BOLT'],
    ['WARLOCK', 'CURSE_OF_AGONY'],
    ['WARLOCK', 'SOUL_DRAIN'],
    ['DRUID', 'THORN_WHIP'],
    ['DRUID', 'REGROWTH'],
    ['DRUID', 'ROOTS_OF_ENTANGLEMENT'],
    ['ROGUE', 'BACKSTAB'],
    ['ROGUE', 'SHADOW_STEP'],
    ['ROGUE', 'POISONED_DAGGER'],
  ];

  it('can plan a target for every new ability', () => {
    // `legalAbilityTargetsFor` dry-runs `abilityCommandFor`. Before the fix that
    // helper threw "No command for ability …" for all twelve new skills, which
    // crashed the AI's whole turn the moment a new class was on the board.
    for (const [type, ability] of NEW_ABILITIES) {
      let state = baseState();
      state = addUnit(state, 'x', 'A', type, { x: 3, y: 3 });
      state = addUnit(state, 'e', 'B', 'RANGER', { x: 4, y: 3 });
      state = addUnit(state, 'f', 'A', 'CLERIC', { x: 3, y: 4 });
      expect(() => legalAbilityTargetsFor(state, 'x', ability)).not.toThrow();
    }
  });

  it('an AI Warlock opens with Eldritch Bolt', () => {
    let state = baseState();
    state = addUnit(state, 'w', 'AI', 'WARLOCK', { x: 3, y: 3 });
    state = addUnit(state, 'e', 'A', 'RANGER', { x: 4, y: 3 });
    state.activePlayerId = AI_PLAYER_ID;
    const command = chooseAiCommand(state, AI_PLAYER_ID, () => 0.5);
    expect(command.type).toBe('ELDRITCH_BOLT');
  });

  it('a lethal ability registers the death and ends the match', () => {
    let state = baseState();
    state = addUnit(state, 'w', 'A', 'WARLOCK', { x: 3, y: 3 });
    state = addUnit(state, 'e', 'B', 'RANGER', { x: 4, y: 3 });
    state = setHp(state, 'e', 3);
    const result = applyCommand(state, 'A', { type: 'ELDRITCH_BOLT', unitId: 'w', x: 4, y: 3 });
    expect(result.ok).toBe(true);
    expect(result.state!.units.get('e')!.stats.currentHp).toBe(0);
    expect((result.events ?? []).some((ev) => ev.type === 'UNIT_DEFEATED' && ev.unitId === 'e')).toBe(true);
    expect(result.state!.phase).toBe('ended');
    expect(result.state!.winnerId).toBe('A');
  });

  it('Divine Shield grants 8 shield on a self-cast, not 16', () => {
    let state = baseState();
    state = addUnit(state, 'p', 'A', 'PALADIN', { x: 3, y: 3 });
    state = addUnit(state, 'a', 'A', 'CLERIC', { x: 4, y: 3 });
    const result = applyCommand(state, 'A', { type: 'DIVINE_SHIELD', unitId: 'p', x: 3, y: 3 });
    expect(result.ok).toBe(true);
    expect(result.state!.units.get('p')!.shieldHp).toBe(8);
    expect(result.state!.units.get('a')!.shieldHp).toBe(8);
  });

  it('Thorn Whip pulls the target exactly one tile', () => {
    let state = baseState();
    state = addUnit(state, 'd', 'A', 'DRUID', { x: 2, y: 3 });
    state = addUnit(state, 'e', 'B', 'RANGER', { x: 5, y: 3 });
    const result = applyCommand(state, 'A', { type: 'THORN_WHIP', unitId: 'd', x: 5, y: 3 });
    expect(result.ok).toBe(true);
    expect(result.state!.units.get('e')!.position).toEqual({ x: 4, y: 3 });
  });

  it('a blinded enemy misses on its own turn', () => {
    let state = baseState();
    state = addUnit(state, 'p', 'A', 'PALADIN', { x: 3, y: 3 });
    state = addUnit(state, 'e', 'B', 'RANGER', { x: 4, y: 3 });
    state = applyCommand(state, 'A', { type: 'HOLY_LIGHT', unitId: 'p', x: 4, y: 3 }).state!;
    state = applyCommand(state, 'A', { type: 'END_TURN' }).state!;
    expect(state.activePlayerId).toBe('B');
    const before = state.units.get('p')!.stats.currentHp;
    const strike = applyCommand(state, 'B', { type: 'ATTACK_UNIT', attackerId: 'e', targetId: 'p' });
    expect(strike.ok).toBe(true);
    expect(strike.state!.units.get('p')!.stats.currentHp).toBe(before);
    expect((strike.events ?? []).some((ev) => ev.type === 'UNIT_ATTACKED' && ev.hit === false)).toBe(true);
  });

  it('a rooted enemy cannot move on its own turn', () => {
    let state = baseState();
    state = addUnit(state, 'd', 'A', 'DRUID', { x: 3, y: 3 });
    state = addUnit(state, 'e', 'B', 'RANGER', { x: 4, y: 3 });
    state = applyCommand(state, 'A', { type: 'ROOTS_OF_ENTANGLEMENT', unitId: 'd', x: 4, y: 3 }).state!;
    state = applyCommand(state, 'A', { type: 'END_TURN' }).state!;
    const move = applyCommand(state, 'B', { type: 'MOVE_UNIT', unitId: 'e', to: { x: 5, y: 3 } });
    expect(move.ok).toBe(false);
    expect(move.error).toMatch(/rooted/i);
  });

  it('the AI plays a whole turn with every new class without a rejected command', () => {
    let state = baseState();
    state = addUnit(state, 'p1', 'AI', 'PALADIN', { x: 1, y: 1 });
    state = addUnit(state, 'b1', 'AI', 'BARD', { x: 1, y: 3 });
    state = addUnit(state, 'w1', 'AI', 'WARLOCK', { x: 1, y: 5 });
    state = addUnit(state, 'd1', 'AI', 'DRUID', { x: 2, y: 2 });
    state = addUnit(state, 'r1', 'AI', 'ROGUE', { x: 2, y: 4 });
    state = addUnit(state, 'e1', 'A', 'WARRIOR', { x: 6, y: 4 });
    state = addUnit(state, 'e2', 'A', 'CLERIC', { x: 6, y: 2 });
    state.activePlayerId = 'AI';

    let commands = 0;
    for (let i = 0; i < 16; i += 1) {
      if (state.phase !== 'playing') break;
      const cmd = chooseAiCommand(state, 'AI', () => 0.4);
      const result = applyCommand(state, 'AI', cmd, () => 0.4);
      expect(result.ok, `${cmd.type}: ${result.error}`).toBe(true);
      commands += 1;
      if (cmd.type === 'END_TURN') break;
      state = result.state!;
    }
    // The point is that it acts, not that it burns a fixed number of commands.
    expect(commands).toBeGreaterThan(1);
  });

  it('an AI Paladin smites an enemy in range', () => {
    let state = baseState();
    state = addUnit(state, 'p', 'AI', 'PALADIN', { x: 3, y: 3 });
    state = addUnit(state, 'e', 'A', 'RANGER', { x: 4, y: 3 });
    state.activePlayerId = AI_PLAYER_ID;
    const command = chooseAiCommand(state, AI_PLAYER_ID, () => 0.5);
    expect(command.type).toBe('HOLY_SMITE');
  });

  it('an AI Bard sings when two allies are wounded', () => {
    let state = baseState();
    state = addUnit(state, 'b', 'AI', 'BARD', { x: 3, y: 3 });
    state = addUnit(state, 'a1', 'AI', 'WARRIOR', { x: 3, y: 4 });
    state = addUnit(state, 'a2', 'AI', 'RANGER', { x: 4, y: 4 });
    state = addUnit(state, 'e', 'A', 'WIZARD', { x: 7, y: 7 });
    state = setHp(state, 'a1', 5);
    state = setHp(state, 'a2', 5);
    state.activePlayerId = AI_PLAYER_ID;
    const command = chooseAiCommand(state, AI_PLAYER_ID, () => 0.5);
    expect(command.type).toBe('SONG_OF_REST');
  });

  it('the solo AI drafts four distinct classes, including new ones', () => {
    for (const seed of [0, 1, 7, 42, 8880404]) {
      const squad = aiSquadFor(seed);
      expect(squad).toHaveLength(4);
      expect(new Set(squad).size).toBe(4);
      expect(squad.some((type) => !['WARRIOR', 'WIZARD', 'CLERIC', 'RANGER'].includes(type))).toBe(true);
    }
    // Deterministic per seed, so a replayed match fields the same opponent.
    expect(aiSquadFor(11)).toEqual(aiSquadFor(11));
  });

  it('plays a drafted solo match to a finish with no rejected command', () => {
    let state = createInitialState({
      gameId: 'sim',
      playerIds: ['HUMAN', AI_PLAYER_ID],
      boardSize: { width: 12, height: 10 },
      walls: [],
      mapSeed: 7,
    });
    state = applyCommand(state, 'HUMAN', {
      type: 'CHOOSE_FACTION',
      faction: 'INQUISITORS',
      squad: ['PALADIN', 'BARD', 'WARLOCK', 'DRUID'],
    }).state!;
    state = applyCommand(state, AI_PLAYER_ID, {
      type: 'CHOOSE_FACTION',
      faction: 'PENITENT_COURT',
      squad: aiSquadFor(7),
    }).state!;
    expect(state.phase).toBe('playing');

    let commands = 0;
    while (state.phase === 'playing' && commands < 800) {
      const actor = state.activePlayerId;
      const cmd = chooseAiCommand(state, actor, () => 0.5);
      const result = applyCommand(state, actor, cmd, () => 0.5);
      expect(result.ok, `${actor} ${cmd.type}: ${result.error}`).toBe(true);
      state = result.state!;
      commands += 1;
    }
    expect(state.phase).toBe('ended');
    expect(commands).toBeGreaterThan(10);
  });

  it('deploys four units even when the squad repeats a class', () => {
    const state = deploySquad(baseState(), 'A', 0, undefined, ['ROGUE', 'ROGUE', 'BARD', 'DRUID']);
    const mine = [...state.units.values()].filter((u) => u.ownerId === 'A');
    expect(mine).toHaveLength(4);
    expect(new Set(mine.map((u) => u.id)).size).toBe(4);
  });

  it('round-trips the drafted squad through the wire shape', () => {
    // Online, the first picker's squad is serialized before the second picker's
    // command deploys anything. Dropping `squads` here redeployed the default
    // roster for whoever picked first.
    const state = baseState();
    state.squads = { A: ['PALADIN', 'BARD', 'WARLOCK', 'ROGUE'] };
    const back = deserializeGameState(JSON.parse(JSON.stringify(serializeGameState(state))));
    expect(back.squads?.A).toEqual(['PALADIN', 'BARD', 'WARLOCK', 'ROGUE']);
  });

  it('Inspiring Anthem does not stack +1 movement on a repeat cast', () => {
    let state = baseState();
    state = addUnit(state, 'b', 'A', 'BARD', { x: 3, y: 3 });
    state = addUnit(state, 'a', 'A', 'CLERIC', { x: 4, y: 3 });
    const base = state.units.get('a')!.stats.moveReach;
    const first = applyCommand(state, 'A', { type: 'INSPIRING_ANTHEM', unitId: 'b', x: 4, y: 3 });
    expect(first.ok).toBe(true);
    expect(first.state!.units.get('a')!.stats.moveReach).toBe(base + 1);

    // Hand the Bard its action back so the same ally is buffed twice in a row.
    const again = cloneState(first.state!);
    again.units.get('b')!.hasAttacked = false;
    again.units.get('b')!.hasActed = false;
    const second = applyCommand(again, 'A', { type: 'INSPIRING_ANTHEM', unitId: 'b', x: 4, y: 3 });
    expect(second.ok).toBe(true);
    expect(second.state!.units.get('a')!.stats.moveReach).toBe(base + 1);
  });
});

describe('fixes: melting ice, wasted casts, range preview', () => {
  it('melts ice after its duration instead of scarring the board forever', () => {
    let state = baseState();
    state = addUnit(state, 'wz', 'A', 'WIZARD', { x: 1, y: 4 });
    // B needs a unit too, or the match would already be decided as a win.
    state = addUnit(state, 'e', 'B', 'RANGER', { x: 6, y: 6 });
    const raised = applyCommand(state, 'A', { type: 'SUMMON_ICE_WALL', unitId: 'wz', x: 3, y: 4 });
    expect(raised.ok).toBe(true);
    expect(raised.state!.iceWalls).toHaveLength(1);
    // Ice blocks movement while it stands.
    expect(isWall(raised.state!, { x: 3, y: 4 })).toBe(true);

    let melting = raised.state!;
    for (let i = 0; i < ABILITIES.ICE_WALL.durationTurns; i += 1) {
      melting = applyCommand(melting, i % 2 === 0 ? 'A' : 'B', { type: 'END_TURN' }).state!;
    }
    expect(melting.iceWalls).toHaveLength(0);
    expect(isWall(melting, { x: 3, y: 4 })).toBe(false);
  });

  it('allows a fireball aimed at empty ground', () => {
    let state = baseState();
    state = addUnit(state, 'wz', 'A', 'WIZARD', { x: 1, y: 4 });
    const wasted = applyCommand(state, 'A', { type: 'CAST_FIREBALL', unitId: 'wz', x: 3, y: 4 });
    expect(wasted.ok).toBe(true);
    // Action still spent, so it cannot be used to fish for free value.
    expect(wasted.state!.units.get('wz')!.hasAttacked).toBe(true);
  });

  it('allows a thunder strike into empty space', () => {
    let state = baseState();
    state = addUnit(state, 'wz', 'A', 'WIZARD', { x: 1, y: 4 });
    const wasted = applyCommand(state, 'A', { type: 'CAST_THUNDER_STRIKE', unitId: 'wz', x: 4, y: 4 });
    expect(wasted.ok).toBe(true);
    expect(wasted.state!.units.get('wz')!.hasAttacked).toBe(true);
  });

  it('previews the full attack reach even with no enemy in it', () => {
    let state = baseState();
    state = addUnit(state, 'rg', 'A', 'RANGER', { x: 4, y: 4 });
    const tiles = attackRangeTiles(state, state.units.get('rg')!);
    expect(tiles.length).toBeGreaterThan(10);
    // Every previewed tile is genuinely within reach.
    for (const t of tiles) {
      expect(chebyshev({ x: 4, y: 4 }, t)).toBeLessThanOrEqual(6);
    }
    // Walls are excluded so the preview does not promise tiles it cannot hit.
    expect(tiles.some((t) => state.terrain.get(`${t.x},${t.y}`) === 'WALL')).toBe(false);
  });

  it('previews the tiles a spell would actually cover', () => {
    let state = baseState();
    state = addUnit(state, 'wz', 'A', 'WIZARD', { x: 1, y: 4 });
    const caster = state.units.get('wz')!;

    // Thunder Strike is a line, so it must preview more than the one tile.
    const line = abilityAffectedTiles(state, 'THUNDER_STRIKE', caster, { x: 4, y: 4 });
    expect(line).toHaveLength(ABILITIES.THUNDER_STRIKE.tiles);

    // Fireball previews its whole blast block, not just the aimed tile.
    const blast = abilityAffectedTiles(state, 'FIREBALL', caster, { x: 4, y: 4 });
    expect(blast).toHaveLength(ABILITIES.FIREBALL.size ** 2);
    expect(blast).toContainEqual({ x: 4, y: 4 }); // the aimed tile
    expect(blast).toContainEqual({ x: 5, y: 3 }); // a corner of the block
    // Even when nothing is standing there.
    expect(state.units.size).toBe(1);
  });

  it('gives the Cleric move 2 and melee range 1', () => {
    expect(BASE_UNIT_STATS.CLERIC.moveReach).toBe(2);
    expect(BASE_UNIT_STATS.CLERIC.attackRange).toBe(1);
  });

  it('previews only the tiles Sanctified Ground will actually bless', () => {
    // The preview must not promise ground the cast cannot cover. A wall on an arm
    // is covered mathematically but can never hold a unit, and an arm off the
    // board is not a tile at all — highlighting either tells the player the cross
    // is bigger than the effect that will resolve.
    let state = baseState([{ x: 3, y: 2 }]); // stone on the east arm
    state = addUnit(state, 'cl', 'A', 'CLERIC', { x: 1, y: 1 });
    const caster = state.units.get('cl')!;

    const overStone = abilityAffectedTiles(state, 'BLESS_GROUND', caster, { x: 2, y: 2 });
    expect(overStone).toHaveLength(4);
    expect(overStone.some((t) => t.x === 3 && t.y === 2)).toBe(false);

    // Anchored in the corner, two of the five tiles are off the grid.
    const atCorner = abilityAffectedTiles(state, 'BLESS_GROUND', caster, { x: 0, y: 0 });
    expect(atCorner).toHaveLength(3);
    for (const tile of atCorner) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(state.boardSize.width);
      expect(tile.y).toBeLessThan(state.boardSize.height);
    }
  });

it('previews the target tile for single-cell skills, including Shield Slam', () => {
    let state = baseState();
    state = addUnit(state, 'war', 'A', 'WARRIOR', { x: 3, y: 3 });
    const target = { x: 4, y: 3 };
    expect(abilityAffectedTiles(state, 'SHIELD_SLAM', state.units.get('war')!, target))
      .toEqual([target]);
    expect(abilityAffectedTiles(state, 'ICE_WALL', null, target)).toEqual([target]);
    expect(abilityAffectedTiles(state, 'TRAP', null, target)).toEqual([target]);
    expect(abilityAffectedTiles(state, 'GRAPPLE', null, target)).toEqual([target]);
    expect(abilityAffectedTiles(state, 'BLESS_GROUND', null, target)).toHaveLength(5);
  });

  it('clips the fireball block at the board edge instead of reporting phantom tiles', () => {
    let state = baseState();
    state = addUnit(state, 'wz', 'A', 'WIZARD', { x: 1, y: 4 });
    const caster = state.units.get('wz')!;

    const corner = abilityAffectedTiles(state, 'FIREBALL', caster, { x: 0, y: 0 });
    // A 3x3 centred on (0,0) can only reach 2x2 before the edge of the board.
    expect(corner).toHaveLength(4);
    for (const tile of corner) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('hidden traps are redacted per viewer', () => {
  it('never sends an opponents trap to a player', () => {
    let state = baseState();
    state = addUnit(state, 'rgA', 'A', 'RANGER', { x: 1, y: 1 });
    state = addUnit(state, 'rgB', 'B', 'RANGER', { x: 6, y: 6 });
    // Laid on the tile beside rgA, since a trap is set within the 3x3 around it.
    state = applyCommand(state, 'A', { type: 'PLACE_TRAP', unitId: 'rgA', x: 2, y: 1 }).state!;
    expect(state.traps).toHaveLength(1);

    // The owner's view keeps it...
    const ownerView = redactTrapsFor(state, 'A');
    expect(ownerView.traps).toHaveLength(1);
    // ...the opponent's must not contain it at all.
    const foeView = redactTrapsFor(state, 'B');
    expect(foeView.traps).toHaveLength(0);

    // And it survives the wire round trip as hidden.
    const wire = serializeGameState(foeView);
    expect(wire.traps).toHaveLength(0);
    expect(deserializeGameState(wire).traps).toHaveLength(0);
  });
});

describe('faction draft', () => {
  it('enforces randomized pick order, assigns distinct skins, then starts the match', () => {
    const state = createInitialState({
      gameId: 'draft',
      playerIds: ['A', 'B'],
      pickOrder: ['B', 'A'],
    });
    expect(state.phase).toBe('deployment');
    expect(state.activePlayerId).toBe('B');
    expect(applyChooseFaction(state, 'A', 'INQUISITORS').ok).toBe(false);

    const first = applyChooseFaction(state, 'B', 'PENITENT_COURT');
    expect(first.ok).toBe(true);
    expect(first.state?.phase).toBe('deployment');
    expect(first.state?.activePlayerId).toBe('A');
    expect(first.state?.units.size).toBe(0);
    expect(applyChooseFaction(first.state!, 'A', 'PENITENT_COURT').ok).toBe(false);
    const restoredDraft = deserializeGameState(serializeGameState(first.state!));
    expect(restoredDraft.activePlayerId).toBe('A');
    expect(restoredDraft.pickOrder).toEqual(['B', 'A']);
    expect(restoredDraft.factions).toEqual({ B: 'PENITENT_COURT' });

    const complete = applyChooseFaction(restoredDraft, 'A', 'INQUISITORS');
    expect(complete.ok).toBe(true);
    expect(complete.state?.phase).toBe('playing');
    expect(complete.state?.activePlayerId).toBe('A'); // turn order, not pick order
    expect(complete.state?.factions).toEqual({ B: 'PENITENT_COURT', A: 'INQUISITORS' });
    expect(complete.state?.units.size).toBe(8);
  });

  it('rejects faction commands outside deployment and invalid faction values', () => {
    const state = baseState();
    expect(applyChooseFaction(state, 'A', 'INQUISITORS').ok).toBe(false);
    const draft = createInitialState({ gameId: 'draft', playerIds: ['A', 'B'] });
    expect(applyChooseFaction(draft, 'A', 'INVALID' as never).ok).toBe(false);
  });
});

describe('serialization', () => {
  it('round-trips a full state', () => {
    let state = createInitialState({ gameId: 'rt', playerIds: ['A', 'B'] });
    state = deploySquad(state, 'A', 0);
    state = deploySquad(state, 'B', 1);
    state = startMatch(state);

    const restored = deserializeGameState(serializeGameState(state));
    expect(restored.gameId).toBe('rt');
    expect(restored.turnOrder).toEqual(['A', 'B']);
    expect(restored.pickOrder).toEqual(['A', 'B']);
    expect(restored.factions).toEqual({});
    expect(restored.units.size).toBe(8);
    expect(restored.terrain.size).toBe(state.terrain.size);
    expect(restored.activePlayerId).toBe(state.activePlayerId);
    expect(restored.units.get(unitId('A', 'WARRIOR'))!.type).toBe('WARRIOR');
  });
});

describe('AI', () => {
  /**
   * The original intent of this test was "acts instead of shuffling forward".
   * A Warrior next to an enemy now slams rather than attacks: same range, but it
   * also knocks the target back and costs it its next action, so it dominates a
   * plain attack. Asserting the intent, not the old command type.
   */
  it('acts on an adjacent enemy rather than moving', () => {
    let state = baseState();
    state = cloneState(state);
    state.activePlayerId = AI_PLAYER_ID;
    state.turnOrder = ['A', AI_PLAYER_ID];
    state.units.set('ai', createUnit('ai', AI_PLAYER_ID, 'WARRIOR', { x: 4, y: 4 }));
    state.units.set('pc', createUnit('pc', 'A', 'WARRIOR', { x: 5, y: 5 }));

    const command = chooseAiCommand(state, AI_PLAYER_ID);
    expect(command.type).not.toBe('MOVE_UNIT');
    expect(command.type).toBe('SHIELD_SLAM');
  });

  it('takes a kill with a plain attack rather than trading it for a Slam', () => {
    let state = baseState();
    state = cloneState(state);
    state.activePlayerId = AI_PLAYER_ID;
    state.turnOrder = ['A', AI_PLAYER_ID];
    state.units.set('ai', createUnit('ai', AI_PLAYER_ID, 'WARRIOR', { x: 4, y: 4 }));
    // One hit from death, so the kill outranks the reposition.
    const doomed = createUnit('doomed', 'A', 'RANGER', { x: 5, y: 4 });
    doomed.stats.currentHp = 3;
    state.units.set('doomed', doomed);

    const command = chooseAiCommand(state, AI_PLAYER_ID);
    expect(command.type).toBe('ATTACK_UNIT');
  });

  it('heals a badly wounded ally instead of attacking', () => {
    let state = baseState();
    state = cloneState(state);
    state.activePlayerId = AI_PLAYER_ID;
    state.turnOrder = ['A', AI_PLAYER_ID];
    state.units.set('ai', createUnit('ai', AI_PLAYER_ID, 'CLERIC', { x: 4, y: 4 }));
    state.units.set('hurt', createUnit('hurt', AI_PLAYER_ID, 'WARRIOR', { x: 4, y: 5 }));
    state.units.get('hurt')!.stats.currentHp = 4;
    state.units.set('foe', createUnit('foe', 'A', 'RANGER', { x: 5, y: 4 }));

    const command = chooseAiCommand(state, AI_PLAYER_ID);
    expect(command.type).toBe('HEAL_UNIT');
  });

  it('casts Fireball when two enemies stand in the blast', () => {
    let state = baseState();
    state = cloneState(state);
    state.activePlayerId = AI_PLAYER_ID;
    state.turnOrder = ['A', AI_PLAYER_ID];
    state.units.set('ai', createUnit('ai', AI_PLAYER_ID, 'WIZARD', { x: 1, y: 4 }));
    // Two foes adjacent to each other, inside the 3x3 centred on (3,4).
    state.units.set('f1', createUnit('f1', 'A', 'RANGER', { x: 3, y: 4 }));
    state.units.set('f2', createUnit('f2', 'A', 'RANGER', { x: 3, y: 3 }));

    const command = chooseAiCommand(state, AI_PLAYER_ID);
    expect(command.type).toBe('CAST_FIREBALL');
  });

  it('does not cast an area spell through its own ally', () => {
    let state = baseState();
    state = cloneState(state);
    state.activePlayerId = AI_PLAYER_ID;
    state.turnOrder = ['A', AI_PLAYER_ID];
    state.units.set('ai-wizard', createUnit('ai-wizard', AI_PLAYER_ID, 'WIZARD', { x: 1, y: 4 }));
    for (const [id, x, y] of [
      ['ai-ally-1', 2, 4],
      ['ai-ally-2', 3, 3],
      ['ai-ally-3', 4, 3],
      ['ai-ally-4', 3, 5],
      ['ai-ally-5', 4, 5],
      ['ai-ally-6', 5, 4],
    ] as const) {
      state.units.set(id, createUnit(id, AI_PLAYER_ID, 'WARRIOR', { x, y }));
    }
    state.units.set('foe-1', createUnit('foe-1', 'A', 'RANGER', { x: 3, y: 4 }));
    state.units.set('foe-2', createUnit('foe-2', 'A', 'CLERIC', { x: 4, y: 4 }));

    const command = chooseAiCommand(state, AI_PLAYER_ID);
    if (command.type === 'CAST_FIREBALL' || command.type === 'CAST_THUNDER_STRIKE') {
      const ability = command.type === 'CAST_FIREBALL' ? 'FIREBALL' : 'THUNDER_STRIKE';
      const affected = abilityAffectedTiles(state, ability, state.units.get('ai-wizard')!, command);
      const allies = Array.from(state.units.values()).filter(
        (unit) => unit.ownerId === AI_PLAYER_ID && unit.stats.currentHp > 0,
      );
      expect(affected.some((tile) => allies.some(
        (unit) => unit.position.x === tile.x && unit.position.y === tile.y,
      ))).toBe(false);
    }
  });

  /*
   * Shooting beats everything else the Ranger owns: 4-6 damage at range 6
   * against a trap that only roots. The policy used to lay a trap every turn
   * because a legal trap tile almost always exists, which is why the enemy
   * Ranger felt like a 16 HP prop.
   */
  it('shoots instead of spending its action on a trap', () => {
    let state = baseState();
    state = cloneState(state);
    state.activePlayerId = AI_PLAYER_ID;
    state.turnOrder = ['A', AI_PLAYER_ID];
    state.units.set('ai-ranger', createUnit('ai-ranger', AI_PLAYER_ID, 'RANGER', { x: 2, y: 2 }));
    state.units.set('foe', createUnit('foe', 'A', 'WARRIOR', { x: 4, y: 2 }));

    const command = chooseAiCommand(state, AI_PLAYER_ID);
    expect(command.type).toBe('ATTACK_UNIT');
  });

  it('sets a trap on an enemy path when it has no shot at all', () => {
    // A wall on the line blocks line of sight, and the Ranger has no ally to
    // hook a victim toward, so the trap is the only action left.
    let state = baseState([{ x: 3, y: 2 }]);
    state = cloneState(state);
    state.activePlayerId = AI_PLAYER_ID;
    state.turnOrder = ['A', AI_PLAYER_ID];
    state.units.set('ai-ranger', createUnit('ai-ranger', AI_PLAYER_ID, 'RANGER', { x: 2, y: 2 }));
    state.units.set('foe', createUnit('foe', 'A', 'WARRIOR', { x: 4, y: 2 }));

    const command = chooseAiCommand(state, AI_PLAYER_ID);
    expect(command.type).toBe('PLACE_TRAP');
    if (command.type === 'PLACE_TRAP') {
      const enemyReach = computeReachable(state, state.units.get('foe')!);
      expect(enemyReach).toContainEqual({ x: command.x, y: command.y });
    }
  });

  it('casts at a single target instead of falling back to the staff', () => {
    // Fireball's aimed tile is 8 to the staff's 4, so one caught body is already
    // worth the cast. The old two-target rule made the Wizard hit for half.
    let state = baseState();
    state = cloneState(state);
    state.activePlayerId = AI_PLAYER_ID;
    state.turnOrder = ['A', AI_PLAYER_ID];
    state.units.set('ai-wizard', createUnit('ai-wizard', AI_PLAYER_ID, 'WIZARD', { x: 1, y: 4 }));
    state.units.set('foe', createUnit('foe', 'A', 'WARRIOR', { x: 4, y: 4 }));

    const command = chooseAiCommand(state, AI_PLAYER_ID);
    expect(command.type).toBe('CAST_FIREBALL');
  });

  it('aims at the wounded body when two targets are equally reachable', () => {
    // Focus fire: the missing-health term is squared, so four attackers converge
    // on one kill instead of chipping four different units.
    let state = baseState();
    state = cloneState(state);
    state.activePlayerId = AI_PLAYER_ID;
    state.turnOrder = ['A', AI_PLAYER_ID];
    state.units.set('ai', createUnit('ai', AI_PLAYER_ID, 'RANGER', { x: 4, y: 4 }));
    state.units.set('fresh', createUnit('fresh', 'A', 'WARRIOR', { x: 4, y: 7 }));
    const hurt = createUnit('hurt', 'A', 'WARRIOR', { x: 7, y: 4 });
    hurt.stats.currentHp = 3;
    state.units.set('hurt', hurt);

    // A middling roll lands between the two weights, so the pick is the policy's
    // and not the rng's.
    const command = chooseAiCommand(state, AI_PLAYER_ID, () => 0.5) as {
      type: string;
      targetId?: string;
    };
    if (command.type === 'ATTACK_UNIT') expect(command.targetId).toBe('hurt');
    else throw new Error(`expected an attack, got ${command.type}`);
  });

  it('pulls a wounded unit out of reach instead of letting it die in place', () => {
    let state = baseState();
    state = cloneState(state);
    state.activePlayerId = AI_PLAYER_ID;
    state.turnOrder = ['A', AI_PLAYER_ID];
    const wounded = createUnit('ai-ranger', AI_PLAYER_ID, 'RANGER', { x: 4, y: 4 });
    wounded.stats.currentHp = 3;
    state.units.set('ai-ranger', wounded);
    state.units.set('foe', createUnit('foe', 'A', 'WARRIOR', { x: 5, y: 5 }));

    // It takes its swing first, then backs out of the Warrior's threat range.
    const first = chooseAiCommand(state, AI_PLAYER_ID);
    expect(first.type).toBe('ATTACK_UNIT');
    const afterSwing = applyCommand(state, AI_PLAYER_ID, first).state!;
    const second = chooseAiCommand(afterSwing, AI_PLAYER_ID);
    expect(second.type).toBe('MOVE_UNIT');
    if (second.type === 'MOVE_UNIT') {
      const foe = afterSwing.units.get('foe')!;
      const threatened = computeReachable(afterSwing, foe).some(
        (tile) => tile.x === second.to.x && tile.y === second.to.y,
      );
      expect(threatened).toBe(false);
    }
  });

  it('never issues a command the engine rejects', () => {
    // The strongest guarantee available without an integration harness: every
    // choice the policy can reach must be accepted by the authority.
    let state = baseState();
    state = cloneState(state);
    state = deploySquad(state, 'A', 0);
    state = deploySquad(state, 'B', 1);
    state = startMatch(state);

    for (let turn = 0; turn < 60; turn += 1) {
      const playerId = state.activePlayerId;
      const command = chooseAiCommand(state, playerId);
      const result = applyCommand(state, playerId, command, () => 0);
      if (!result.ok || !result.state) {
        throw new Error(`engine rejected AI command ${JSON.stringify(command)}: ${result.error}`);
      }
      state = result.state;
      if (state.phase !== 'playing') break;
    }
  });

  /**
   * The 60-turn test above only proves commands are *accepted*. This one proves
   * they are *useful*: the AI has to close the distance. A scoring bug made the
   * AI end its turn every time — legal, and completely inert, so the legality
   * test stayed green while the opponent never moved a tile.
   */
  it('closes the distance instead of ending its turn on an open board', () => {
    let state = baseState();
    state = cloneState(state);
    state = deploySquad(state, 'A', 0);
    state = deploySquad(state, 'B', 1);
    state = startMatch(state);

    const aiId = 'B';
    state.activePlayerId = aiId;
    const closest = (s: GameState) => {
      const mine = Array.from(s.units.values()).filter((u) => u.ownerId === aiId && u.stats.currentHp > 0);
      const theirs = Array.from(s.units.values()).filter((u) => u.ownerId !== aiId && u.stats.currentHp > 0);
      return Math.min(...mine.flatMap((m) => theirs.map((t) => chebyshev(m.position, t.position))));
    };

    const before = closest(state);
    let acted = 0;
    for (let i = 0; i < 6 && state.activePlayerId === aiId; i += 1) {
      const command = chooseAiCommand(state, aiId);
      if (command.type === 'END_TURN') break;
      const result = applyCommand(state, aiId, command);
      if (!result.ok || !result.state) break;
      state = result.state;
      acted += 1;
      if (state.activePlayerId !== aiId) break;
    }

    expect(acted).toBeGreaterThan(0);
    expect(closest(state)).toBeLessThan(before);
  });

  it('ends the turn when nothing useful remains', () => {
    const state = baseState();
    state.activePlayerId = AI_PLAYER_ID;
    const command = chooseAiCommand(state, AI_PLAYER_ID);
    expect(command.type).toBe('END_TURN');
  });

  it('exposes no legal actions for a unit on the wrong turn', () => {
    let state = baseState();
    state = addUnit(state, 'a', 'A', 'WARRIOR', { x: 2, y: 2 });
    // It is A's turn, and the query is unit-scoped, so moves exist.
    expect(legalMovesFor(state, 'a').length).toBeGreaterThan(0);
    // An attacking unit with no enemies has no targets.
    expect(legalAttackTargetsFor(state, 'a')).toHaveLength(0);
    expect(legalHealTargetsFor(state, 'a')).toHaveLength(0);
  });
});
