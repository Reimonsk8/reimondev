import { ABILITIES, NEIGHBOUR_OFFSETS } from './constants';
import { chebyshev, manhattan, positionKey, inBounds, hasLineOfSight, unitAt, positionsEqual } from './board';
import { DamageEffect } from './combat';
import type { GameEvent } from './protocol';
import type { GameState, Position, Unit, UnitStats, Zone } from './types';

/**
 * Shared mechanics behind the class abilities.
 *
 * Kept separate from reducer.ts because these are mostly *queries* about the
 * board (who is standing where, what can I reach) rather than commands. The
 * reducer still owns validation and mutation; nothing here mutates `state`
 * except the two clearly-named resolvers that the reducer calls deliberately.
 */

// ── zones ───────────────────────────────────────────────────────────────────

/**
 * Sanctified Ground is a plus: the tile it was cast on, plus the four tiles
 * orthogonally adjacent to it. Diagonals are NOT covered — the ground reads as
 * a cross of consecration radiating outward along one axis, and leaving the
 * corners bare stops a cleric from parking a 3x3 blob of damage reduction on
 * the field for two turns.
 */
const ZONE_OFFSETS: ReadonlyArray<Position> = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** Tiles covered by a zone, centred on its anchor. */
export const zoneTiles = (zone: Position): Position[] =>
  ZONE_OFFSETS.map((offset) => ({ x: zone.x + offset.x, y: zone.y + offset.y }));

/**
 * Tiles a zone actually does something on: the cross minus the parts that fall
 * off the board or land on stone.
 *
 * This is what the aim preview draws, so it has to be the same set the cast
 * resolves against. Both out-of-bounds and wall tiles are dropped rather than
 * refusing the cast — see `applyBlessGround`, which is where that rule is
 * enforced. A wall tile is covered by the zone mathematically but can never hold
 * a unit, so showing it as "blessed" would overstate the effect.
 *
 * Takes a bare `Position` rather than a `Zone`, because a `Zone` is assignable
 * to it and nothing here reads anything but x/y. That lets the cast animation ask
 * "which tiles would this anchor cover" without inventing a throwaway zone
 * object to ask it.
 */
export const activeZoneTiles = (state: GameState, zone: Position): Position[] =>
  zoneTiles(zone).filter((tile) => inBounds(tile, state.boardSize) && !isWallAt(state, tile.x, tile.y));

export const zoneCovers = (zone: Zone, x: number, y: number): boolean =>
  ZONE_OFFSETS.some((offset) => zone.x + offset.x === x && zone.y + offset.y === y);

/** The zone at this tile that belongs to `ownerId`, if any. */
export const zoneAt = (state: GameState, x: number, y: number, ownerId?: string): Zone | undefined =>
  state.zones.find((zone) => zoneCovers(zone, x, y) && (ownerId === undefined || zone.ownerId === ownerId));

/** True when the unit stands on ground blessed by its own owner. */
export const isBlessed = (state: GameState, unit: Unit): boolean =>
  zoneAt(state, unit.position.x, unit.position.y, unit.ownerId) !== undefined;

/**
 * Fraction of incoming damage a blessed unit shrugs off (0 when not blessed).
 * Applied by the caller when building DamageEffects, not by mutating units.
 */
export const damageReductionFor = (state: GameState, unit: Unit): number =>
  isBlessed(state, unit) ? ABILITIES.SANCTIFIED_GROUND.damageReduction : 0;

/** A unit caught in an enemy zone cannot be blessed by that same zone. */
export const isInEnemyZone = (state: GameState, unit: Unit): boolean =>
  zoneAt(state, unit.position.x, unit.position.y) !== undefined &&
  zoneAt(state, unit.position.x, unit.position.y, unit.ownerId) === undefined;

/**
 * Tick every zone once: heal the owner's living units standing in it.
 * Durations then tick down and expired zones are dropped.
 *
 * Mutates `state` — called deliberately by END_TURN, and only on a clone.
 */
export const resolveZones = (state: GameState, events: GameEvent[]): void => {
  for (const zone of state.zones) {
    const { regen } = ABILITIES.SANCTIFIED_GROUND;
    // Sanctified Ground heals its owner's squad only. `burned` stays empty for
    // wire compatibility with the old neutral-zone rule.
    const healed: Array<{ unitId: string; amount: number }> = [];

    for (const unit of state.units.values()) {
      if (unit.stats.currentHp <= 0) continue;
      if (unit.ownerId !== zone.ownerId) continue;
      if (!zoneCovers(zone, unit.position.x, unit.position.y)) continue;
      const before = unit.stats.currentHp;
      unit.stats.currentHp = Math.min(unit.stats.maxHp, before + regen);
      const gained = unit.stats.currentHp - before;
      if (gained > 0) healed.push({ unitId: unit.id, amount: gained });
    }
    const burned: Array<{ unitId: string; amount: number }> = [];

    events.push({ type: 'ZONE_TICK', zoneId: zone.id, ownerId: zone.ownerId, healed, burned });
  }

  state.zones = state.zones
    .map((zone) => ({ ...zone, durationTurns: zone.durationTurns - 1 }))
    .filter((zone) => zone.durationTurns > 0);
};

// ── traps ───────────────────────────────────────────────────────────────────

export const trapAt = (state: GameState, x: number, y: number): GameState['traps'][number] | undefined =>
  state.traps.find((trap) => trap.armed && trap.x === x && trap.y === y);

/**
 * Fire the armed trap under `unit` (if any): disarm it and root the victim so
 * it cannot move on its next turn. Never triggers for the owner.
 * Mutates `state`; called from the reducer on a clone.
 */
export const triggerTrap = (state: GameState, unit: Unit, events: GameEvent[]): boolean => {
  if (unit.stats.currentHp <= 0) return false;
  const trap = trapAt(state, unit.position.x, unit.position.y);
  if (!trap || trap.ownerId === unit.ownerId) return false;

  trap.armed = false;
  // Off-by-one is deliberate: statuses decay at the START of the victim's next
  // turn, so N blocked moves needs N+1 stored. See resetPlayerTurnFlags.
  unit.rootedTurns = ABILITIES.TRAP_ROOT_TURNS + 1;
  events.push({ type: 'TRAP_TRIGGERED', trapId: trap.id, unitId: unit.id, x: trap.x, y: trap.y });
  events.push({ type: 'UNIT_ROOTED', unitId: unit.id, turns: ABILITIES.TRAP_ROOT_TURNS });
  return true;
};

/**
 * Per-viewer projection of the board.
 *
 * A Ranger's trap is meant to be hidden, so it must never appear in the state
 * sent to the opponent — otherwise "hidden" is a UI convention rather than a
 * rule, and a player can just read their own network traffic. The server must
 * filter per recipient; the client cannot be trusted to hide it.
 */
export const redactTrapsFor = (state: GameState, viewerId: string): GameState => ({
  ...state,
  traps: state.traps.filter((trap) => trap.ownerId === viewerId),
});

// ── basic-attack reach ──────────────────────────────────────────────────────

/**
 * Distance from `from` to `to` as the unit's own attack measures it.
 *
 * The Wizard is the one class that counts in Manhattan steps, so a diagonal
 * target costs it two rather than one — that is what lets its reach-2 attack
 * mean "one tile straight, or one diagonal" instead of "anything adjacent".
 */
export const attackReachDistance = (
  unit: Pick<Unit, 'type'>,
  from: Position,
  to: Position,
): number => (unit.type === 'WIZARD' || unit.type === 'SPITTER'
  ? manhattan(from, to)
  : chebyshev(from, to));

/**
 * Can `unit` land its basic attack on `to` from `from`?
 *
 * This is THE reach rule, and it is deliberately a single exported function
 * rather than the same three-line check written out at each call site. Reach
 * has to agree in four places — the reducer's validation, `attackRangeTiles`
 * for the board overlay, the AI's own reach test, and the tooltip — and a
 * monster's orthogonal-only claw is exactly the kind of rule that silently
 * rots when one of them is missed. The AI missing it is the nastiest case: it
 * picks a diagonal the reducer then rejects, and the monster burns its action
 * on a move the engine refuses.
 */
export const canReachTile = (
  unit: Pick<Unit, 'type' | 'stats'>,
  from: Position,
  to: Position,
): boolean => {
  if (positionsEqual(from, to)) return false;
  const stats: UnitStats = unit.stats;
  if (stats.orthogonalAttackOnly) {
    // Not a distance test at all: the four neighbours and nothing else. Written
    // as "one tile on exactly one axis" so it cannot be satisfied by a diagonal
    // by accident.
    return Math.abs(from.x - to.x) + Math.abs(from.y - to.y) === 1;
  }
  return attackReachDistance(unit, from, to) <= stats.attackRange;
};

// ── previews ────────────────────────────────────────────────────────────────

/**
 * Every tile the unit could attack from, not just the ones that happen to hold
 * an enemy. The Ranger in particular was impossible to plan with otherwise:
 * you could never see your reach until a target was already standing in it.
 *
 * Line-of-sight units (Ranger) only see tiles they actually have sight on.
 */
export const attackRangeTiles = (state: GameState, unit: Unit): Position[] => {
  const tiles: Position[] = [];
  for (let y = 0; y < state.boardSize.height; y += 1) {
    for (let x = 0; x < state.boardSize.width; x += 1) {
      const tile = { x, y };
      // `canReachTile` rather than an inline distance test, so the highlighted
      // tiles are exactly the tiles the engine will accept a click on. A
      // monster's claw highlights four tiles, never the diagonals.
      if (!canReachTile(unit, unit.position, tile)) continue;
      if (unit.type === 'RANGER' && !hasLineOfSight(state, unit.position, tile)) continue;
      tiles.push(tile);
    }
  }
  return tiles;
};

/**
 * Tiles an armed ability's blast would cover at `target`, regardless of whether
 * anything is standing there. Drives the AoE preview so the player can see the
 * shape of the effect — and aim a deliberately wasted cast.
 */
export const abilityAffectedTiles = (
  state: GameState,
  ability: string,
  unit: Unit | null,
  target: Position,
): Position[] => {
  switch (ability) {
    case 'FIREBALL':
      return fireballTiles(state, target, ABILITIES.FIREBALL.size);
    case 'ICE_WALL':
    case 'TRAP':
    case 'GRAPPLE':
      return [target];
    case 'BLESS_GROUND':
      // The cross, clipped to the tiles the cast will really cover, so the aim
      // preview cannot promise more ground than the zone ends up blessing.
      // This used to build a throwaway Zone to ask; the anchor is all that is
      // ever read.
      return activeZoneTiles(state, target);
    case 'THUNDER_STRIKE': {
      if (!unit) return [target];
      return thunderTiles(state, unit.position, target, ABILITIES.THUNDER_STRIKE.tiles);
    }
    case 'SHIELD_SLAM':
      // The slammed tile is the hit zone. The actual shove destination depends
      // on occupancy/walls and is resolved authoritatively by the reducer.
      return [target];
    case 'SONG_OF_REST':
    case 'INSPIRING_ANTHEM':
      // 3x3 around the aimed tile, matching what the handlers actually affect.
      return fireballTiles(state, target, ABILITIES.SONG_OF_REST.size);
    case 'DIVINE_SHIELD':
      // Cross centred on the aimed tile: the shield covers exactly these five.
      return [
        { x: target.x, y: target.y },
        { x: target.x + 1, y: target.y },
        { x: target.x - 1, y: target.y },
        { x: target.x, y: target.y + 1 },
        { x: target.x, y: target.y - 1 },
      ].filter((tile) => inBounds(tile, state.boardSize));
    default:
      return [target];
  }
};

// ── movement helpers ────────────────────────────────────────────────────────

export const isWallAt = (state: GameState, x: number, y: number): boolean =>
  state.terrain.get(positionKey({ x, y })) === 'WALL' ||
  state.iceWalls.some((wall) => wall.x === x && wall.y === y);

/**
 * True while a unit is trapped inside a summoned ice wall.
 *
 * Derived from the ice rather than stored as a counter on the unit, so the freeze
 * lifts the moment the ice breaks — whether that is melting on the turn clock or
 * the tile being cleared — with nothing to keep in sync and no way for a unit to
 * stay frozen after its ice is gone. This is what "frozen until the ice breaks"
 * means; a `stunnedTurns`-style copy of the number would outlive the ice.
 */
export const isFrozen = (state: GameState, unit: Unit): boolean =>
  unit.stats.currentHp > 0 &&
  state.iceWalls.some((wall) => wall.x === unit.position.x && wall.y === unit.position.y);

/** True when nothing occupies the tile and it is inside the board. */
export const isTileFree = (state: GameState, x: number, y: number, ignoreUnitId?: string): boolean => {
  if (!inBounds({ x, y }, state.boardSize)) return false;
  if (isWallAt(state, x, y)) return false;
  for (const unit of state.units.values()) {
    if (unit.id === ignoreUnitId) continue;
    if (unit.stats.currentHp <= 0) continue;
    if (unit.position.x === x && unit.position.y === y) return false;
  }
  return true;
};

/**
 * Push `unit` one tile along (dx, dy). Returns where it ended up and whether the
 * push was stopped by terrain/occupancy — a stopped push is what turns Shield
 * Slam into a wall impact.
 * Mutates `state`; called from the reducer on a clone.
 */
export const pushUnit = (
  state: GameState,
  unit: Unit,
  dx: number,
  dy: number,
): { to: Position; blocked: boolean } => {
  const from = { ...unit.position };
  const tx = unit.position.x + dx;
  const ty = unit.position.y + dy;

  if (!isTileFree(state, tx, ty, unit.id)) {
    return { to: from, blocked: true };
  }
  unit.position = { x: tx, y: ty };
  return { to: { x: tx, y: ty }, blocked: false };
};

/**
 * Grapple: land on a free tile orthogonally adjacent to the targeted wall, as
 * close to the caster as possible. Orthogonal only (no diagonal) so the rope
 * reads as swinging around an obstacle, and so the landing spot is predictable.
 * Returns null when no such tile exists, which is what stops grapple becoming
 * free blinking.
 */
export const grappleDestination = (
  state: GameState,
  unit: Unit,
  wall: Position,
): Position | null => {
  const candidates: Position[] = [
    { x: wall.x, y: wall.y - 1 },
    { x: wall.x, y: wall.y + 1 },
    { x: wall.x - 1, y: wall.y },
    { x: wall.x + 1, y: wall.y },
  ];
  candidates.sort(
    (a, b) =>
      chebyshev(unit.position, a) - chebyshev(unit.position, b) ||
      Math.hypot(a.x - unit.position.x, a.y - unit.position.y) -
        Math.hypot(b.x - unit.position.x, b.y - unit.position.y),
  );
  return candidates.find((tile) => isTileFree(state, tile.x, tile.y, unit.id)) ?? null;
};

/**
 * Grapple a unit: drag the target to a free tile next to the caster.
 *
 * Three design points worth stating, because they are judgement calls rather
 * than consequences of the code:
 *
 *  - The target lands *beside* the Ranger, not on the Ranger's tile. Pulling
 *    someone onto your own square would stack two units, and the board allows
 *    one unit per tile.
 *  - Adjacency is 8-directional here, unlike the wall variant's strict
 *    orthogonality. When you are hauling a body to you, "the nearest free square"
 *    is the honest answer; a forced orthogonal landing reads as arbitrary,
 *    especially in a corner. Ties break toward the target's original position so
 *    the rope never appears to swing backwards.
 *  - Diagonal hooks are allowed. The straight-line rule on the wall swing exists
 *    so the *rope* reads as one clean line; grabbing a person is not a rope
 *    swing, so it does not inherit that constraint.
 *
 * Returns null when the caster has no free adjacent tile at all, which is what
 * stops the pull from ever being a free teleport.
 */
export const grapplePullDestination = (
  state: GameState,
  caster: Unit,
  target: Unit,
): Position | null => {
  const candidates = NEIGHBOUR_OFFSETS.map(({ dx, dy }) => ({
    x: caster.position.x + dx,
    y: caster.position.y + dy,
  }));
  candidates.sort(
    (a, b) =>
      chebyshev(target.position, a) - chebyshev(target.position, b) ||
      Math.hypot(a.x - target.position.x, a.y - target.position.y) -
        Math.hypot(b.x - target.position.x, b.y - target.position.y),
  );
  // The dragged unit's own tile is vacated by the pull, so it counts as free.
  return (
    candidates.find(
      (tile) => isTileFree(state, tile.x, tile.y, caster.id) && !positionsEqual(tile, target.position),
    ) ?? null
  );
};

/**
 * What a grapple aimed at `target` would actually hook: a unit standing there, or
 * a wall/ice tile. Returns null for bare ground, which the reducer turns into a
 * rejection and the UI can use to grey the cast out.
 */
export const grappleAnchor = (state: GameState, target: Position): Unit | 'ANCHOR' | null => {
  const occupant = unitAt(state, target);
  if (occupant) return occupant;
  if (isWallAt(state, target.x, target.y)) return 'ANCHOR';
  return null;
};

/**
 * Fireball: a `size`x`size` block centred on the target, clipped to the board so
 * a cast at the edge never reports tiles that are not there.
 *
 * An odd `size` gives a true centre; an even one biases like `thunderTiles`, so
 * both area abilities aim the same way.
 */
export const fireballTiles = (state: GameState, target: Position, size: number): Position[] => {
  const half = Math.floor(size / 2);
  const out: Position[] = [];
  for (let dy = -half; dy <= size - 1 - half; dy += 1) {
    for (let dx = -half; dx <= size - 1 - half; dx += 1) {
      const tile = { x: target.x + dx, y: target.y + dy };
      if (inBounds(tile, state.boardSize)) out.push(tile);
    }
  }
  return out;
};

/**
 * Thunder Strike: a straight run of tiles centred on the target, along whichever
 * axis the caster is further from it. `tiles` is the total length.
 */
export const thunderTiles = (state: GameState, caster: Position, target: Position, count: number): Position[] => {
  const dx = target.x - caster.x;
  const dy = target.y - caster.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const stepX = horizontal ? Math.sign(dx) || 1 : 0;
  const stepY = horizontal ? 0 : Math.sign(dy) || 1;

  const half = Math.floor(count / 2);
  const out: Position[] = [];
  for (let i = -half; i <= count - 1 - half; i += 1) {
    const x = target.x + stepX * i;
    const y = target.y + stepY * i;
    if (inBounds({ x, y }, state.boardSize)) out.push({ x, y });
  }
  return out;
};

/** Scale a damage list by a fractional reduction (blessed allies). */
export const reduceEffects = (effects: DamageEffect[], forUnit: (unitId: string) => number): DamageEffect[] =>
  effects.map((effect) => {
    const cut = forUnit(effect.unitId);
    if (cut <= 0) return effect;
    const amount = Math.max(1, Math.round(effect.amount * (1 - cut)));
    return { ...effect, amount, hpAfter: Math.max(0, effect.hpBefore - amount) };
  });
