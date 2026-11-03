import { describe, it, expect } from 'vitest';
import {
  ALTAR_SIZE,
  SQUAD_ROSTER,
  ADVENTURE_ALTAR_COUNT,
  altarSitesFor,
  deploymentTilesFor,
  isPassable,
  NEIGHBOUR_OFFSETS,
  positionKey,
  applyAttack,
  applyCommand,
  besideAltar,
  cloneState,
  createInitialState,
  createUnit,
  deploymentTiles,
  deserializeGameState,
  originalSpawnFor,
  resurrectionSpotFor,
  serializeGameState,
  soulTargetFor,
  startMatch,
} from './index';
import type { GameState, Position, UnitType } from './index';

const ARENA = { width: 12, height: 10 };

/** The arena's central ruin, which is what the altar is. */
const ALTAR = [
  { x: 5, y: 4 },
  { x: 6, y: 4 },
  { x: 5, y: 5 },
  { x: 6, y: 5 },
];

const arena = (): GameState =>
  startMatch(createInitialState({ gameId: 'altar-test', playerIds: ['A', 'B'], boardSize: ARENA }));

const addUnit = (
  state: GameState,
  id: string,
  ownerId: string,
  type: UnitType,
  position: { x: number; y: number },
  hp?: number,
): GameState => {
  const next = cloneState(state);
  const unit = createUnit(id, ownerId, type, position);
  if (hp !== undefined) unit.stats.currentHp = hp;
  next.units.set(id, unit);
  return next;
};

/** Enough bodies on both sides that killing one is not a victory. */
const populated = (): GameState => {
  let state = arena();
  state = addUnit(state, 'A:WARRIOR', 'A', 'WARRIOR', { x: 4, y: 4 });
  state = addUnit(state, 'A:CLERIC', 'A', 'CLERIC', { x: 3, y: 6 });
  state = addUnit(state, 'B:WIZARD', 'B', 'WIZARD', { x: 8, y: 7 });
  state = addUnit(state, 'B:RANGER', 'B', 'RANGER', { x: 9, y: 8 });
  return state;
};

describe('the altar of shadows', () => {
  describe('the monument', () => {
    it('stands on the four centre tiles of the arena', () => {
      expect(altarSitesFor(arena())).toEqual([ALTAR]);
      expect(ALTAR).toHaveLength(ALTAR_SIZE * ALTAR_SIZE);
    });

    /*
     * The renderer draws the lower half of the block as floor, but the rules
     * must not follow the paint: all four tiles stay stone, so nothing can walk
     * into the monument and nothing can see through it.
     */
    it('stays impassable on every tile, including the two drawn as floor', () => {
      const state = populated();
      for (const tile of ALTAR) {
        expect(state.terrain.get(`${tile.x},${tile.y}`)).toBe('WALL');
        expect(isPassable(state, tile)).toBe(false);
      }
    });

    it('does not exist on a floor whose centre is not stone', () => {
      const bare = startMatch(
        createInitialState({
          gameId: 'bare',
          playerIds: ['A', 'B'],
          boardSize: { width: 8, height: 8 },
          walls: [],
        }),
      );
      expect(altarSitesFor(bare)).toBeNull();
    });

    it('raises two monuments in Adventure, both on stone', () => {
      const adventure = startMatch(
        createInitialState({
          gameId: 'adv',
          playerIds: ['A', 'B'],
          boardSize: { width: 20, height: 20 },
          mapMode: 'RANDOM',
          mapSeed: 4242,
        }),
      );
      const sites = altarSitesFor(adventure) ?? [];
      expect(sites).toHaveLength(ADVENTURE_ALTAR_COUNT);
      for (const tiles of sites) {
        expect(tiles).toHaveLength(ALTAR_SIZE * ALTAR_SIZE);
        for (const tile of tiles) {
          // Stone is the monument: the generator writes the block into the
          // terrain, which is what makes it impassable without a second rule.
          expect(adventure.terrain.get(`${tile.x},${tile.y}`)).toBe('WALL');
          expect(isPassable(adventure, tile)).toBe(false);
        }
      }
      const [first, second] = sites;
      expect(first.some((tile) => second.some((other) => other.x === tile.x && other.y === tile.y))).toBe(false);
    });

    it('puts Adventure monuments where the seed says, on every replay', () => {
      const build = (seed: number) => startMatch(
        createInitialState({
          gameId: 'adv',
          playerIds: ['A', 'B'],
          boardSize: { width: 20, height: 20 },
          mapMode: 'RANDOM',
          mapSeed: seed,
        }),
      );
      expect(altarSitesFor(build(9))).toEqual(altarSitesFor(build(9)));
      expect(altarSitesFor(build(9))).not.toEqual(altarSitesFor(build(10)));
    });

    /*
     * A monument is two extra walls on a floor the generator already validated,
     * so the only way it can break a run is by sealing one side off. Checked
     * across seeds rather than argued about: the blocks are small and spaced,
     * but "small and spaced" is not a proof.
     */
    it('never walls a squad off from the other side', () => {
      for (let seed = 0; seed < 120; seed += 1) {
        const state = startMatch(
          createInitialState({
            gameId: 'adv',
            playerIds: ['A', 'B'],
            boardSize: { width: 20, height: 20 },
            mapMode: 'RANDOM',
            mapSeed: seed,
          }),
        );
        const spawns = deploymentTilesFor(state.boardSize);
        const seen = new Set([positionKey(spawns[0])]);
        const queue = [spawns[0]];
        while (queue.length > 0) {
          const current = queue.shift() as Position;
          for (const { dx, dy } of NEIGHBOUR_OFFSETS) {
            const next = { x: current.x + dx, y: current.y + dy };
            const key = positionKey(next);
            if (seen.has(key) || !isPassable(state, next)) continue;
            seen.add(key);
            queue.push(next);
          }
        }
        for (const spawn of spawns) {
          expect(seen.has(positionKey(spawn)), `seed ${seed}`).toBe(true);
        }
      }
    });

    it('is not there on a floor that never got one', () => {
      const bareAdventure = startMatch(
        createInitialState({
          gameId: 'adv',
          playerIds: ['A', 'B'],
          boardSize: ARENA,
          mapMode: 'RANDOM',
          walls: [],
        }),
      );
      expect(altarSitesFor(bareAdventure)).toBeNull();
    });

    it('counts orthogonal and diagonal neighbours, and nothing further', () => {
      const state = arena();
      expect(besideAltar(state, { x: 4, y: 4 })).toBe(true);
      expect(besideAltar(state, { x: 7, y: 6 })).toBe(true);
      expect(besideAltar(state, { x: 3, y: 4 })).toBe(false);
    });

    it('sends a soul to the nearest altar tile', () => {
      expect(soulTargetFor(arena(), { x: 4, y: 5 })).toEqual({ x: 5, y: 4 });
      expect(soulTargetFor(arena(), { x: 9, y: 8 })).toEqual({ x: 6, y: 5 });
    });
  });

  describe('harvesting', () => {
    it('takes a soul from any death, and reports where it came from', () => {
      let state = populated();
      state = addUnit(state, 'B:SPITTER', 'B', 'SPITTER', { x: 4, y: 3 }, 1);
      expect(state.altarSouls).toBe(0);

      const result = applyAttack(state, 'A', 'A:WARRIOR', 'B:SPITTER');
      expect(result.ok).toBe(true);
      expect(result.state!.altarSouls).toBe(1);

      const soul = result.events!.find((event) => event.type === 'SOUL_HARVESTED');
      expect(soul).toEqual({
        type: 'SOUL_HARVESTED',
        unitId: 'B:SPITTER',
        from: { x: 4, y: 3 },
        to: { x: 5, y: 4 },
        souls: 1,
      });
    });

    it('harvests nothing on a floor with no monument', () => {
      let state = startMatch(
        createInitialState({
          gameId: 'adv',
          playerIds: ['A', 'B'],
          boardSize: ARENA,
          mapMode: 'RANDOM',
          walls: [],
        }),
      );
      state = addUnit(state, 'A:WARRIOR', 'A', 'WARRIOR', { x: 4, y: 4 });
      state = addUnit(state, 'A:CLERIC', 'A', 'CLERIC', { x: 3, y: 6 });
      state = addUnit(state, 'B:WIZARD', 'B', 'WIZARD', { x: 5, y: 4 }, 1);
      state = addUnit(state, 'B:RANGER', 'B', 'RANGER', { x: 9, y: 8 });

      const result = applyAttack(state, 'A', 'A:WARRIOR', 'B:WIZARD');
      expect(result.ok).toBe(true);
      expect(result.state!.altarSouls).toBe(0);
      expect(result.events!.some((event) => event.type === 'SOUL_HARVESTED')).toBe(false);
    });
  });

  describe('wishes', () => {
    const withSouls = (souls: number): GameState => {
      const state = populated();
      const next = cloneState(state);
      next.altarSouls = souls;
      return next;
    };

    it('restores a unit to full for one soul', () => {
      const state = withSouls(1);
      const hurt = cloneState(state);
      hurt.units.get('A:WARRIOR')!.stats.currentHp = 5;

      const result = applyCommand(hurt, 'A', {
        type: 'ALTAR_WISH',
        unitId: 'A:WARRIOR',
        wish: 'RESTORE',
      });
      expect(result.ok).toBe(true);
      expect(result.state!.units.get('A:WARRIOR')!.stats.currentHp).toBe(30);
      expect(result.state!.altarSouls).toBe(0);
      expect(result.state!.altarWishTurns.A).toBe(1);
    });

    it('refuses a wish with no soul', () => {
      const state = withSouls(0);
      const result = applyCommand(state, 'A', {
        type: 'ALTAR_WISH',
        unitId: 'A:WARRIOR',
        wish: 'RESTORE',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/no souls/i);
    });

    it('refuses a wish from a unit that is not beside it', () => {
      const state = withSouls(1);
      const result = applyCommand(state, 'A', {
        type: 'ALTAR_WISH',
        unitId: 'A:CLERIC',
        wish: 'RESTORE',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/beside/i);
    });

    it('refuses a wish from the enemy', () => {
      const state = withSouls(1);
      const result = applyCommand(state, 'A', {
        type: 'ALTAR_WISH',
        unitId: 'B:WIZARD',
        wish: 'RESTORE',
      });
      expect(result.ok).toBe(false);
    });

    it('allows one wish per turn cycle', () => {
      let state = withSouls(2);
      const hurt = cloneState(state);
      hurt.units.get('A:WARRIOR')!.stats.currentHp = 5;
      state = applyCommand(hurt, 'A', {
        type: 'ALTAR_WISH',
        unitId: 'A:WARRIOR',
        wish: 'RESTORE',
      }).state!;

      const again = applyCommand(state, 'A', {
        type: 'ALTAR_WISH',
        unitId: 'A:WARRIOR',
        wish: 'RESTORE',
      });
      expect(again.ok).toBe(false);
      expect(again.error).toMatch(/sated/i);

      // A full round later the altar is patient again.
      const toB = applyEndTurnSafe(state, 'A');
      const toA = applyEndTurnSafe(toB, 'B');
      expect(toA.turnNumber).toBe(2);
      expect(toA.activePlayerId).toBe('A');

      // Wounded again, and the altar has a second soul to spend.
      const hurtAgain = cloneState(toA);
      hurtAgain.altarSouls = 1;
      hurtAgain.units.get('A:WARRIOR')!.stats.currentHp = 5;

      const third = applyCommand(hurtAgain, 'A', {
        type: 'ALTAR_WISH',
        unitId: 'A:WARRIOR',
        wish: 'RESTORE',
      });
      expect(third.ok).toBe(true);
    });

    it('refuses a resurrection with no fallen ally', () => {
      const state = withSouls(1);
      const result = applyCommand(state, 'A', {
        type: 'ALTAR_WISH',
        unitId: 'A:WARRIOR',
        wish: 'RESURRECT',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/fallen/i);
    });

    it('raises the fallen at their spawn point for half the caster blood', () => {
      let state = withSouls(1);
      state = addUnit(state, 'A:RANGER', 'A', 'RANGER', { x: 10, y: 8 }, 0);
      state = addUnit(state, 'A:WIZARD', 'A', 'WIZARD', { x: 3, y: 8 });

      const caster = state.units.get('A:WARRIOR')!;
      const spawn = deploymentTiles(0, ARENA)[SQUAD_ROSTER.indexOf('RANGER')];
      expect(originalSpawnFor(state, state.units.get('A:RANGER')!)).toEqual(spawn);

      const result = applyCommand(state, 'A', {
        type: 'ALTAR_WISH',
        unitId: 'A:WARRIOR',
        wish: 'RESURRECT',
      });
      expect(result.ok).toBe(true);

      const raised = result.state!.units.get('A:RANGER')!;
      expect(caster.stats.currentHp).toBe(30);
      expect(raised.position).toEqual(spawn);
      expect(raised.stats.currentHp).toBe(15);
      expect(result.state!.units.get('A:WARRIOR')!.stats.currentHp).toBe(15);
      expect(result.state!.altarSouls).toBe(0);
      // Raised spent, so the dead cannot act the instant they return.
      expect(raised.hasMoved).toBe(true);
      expect(raised.hasAttacked).toBe(true);
    });

    it('never sacrifices below one HP, and raises with what was paid', () => {
      let state = withSouls(1);
      state = addUnit(state, 'A:RANGER', 'A', 'RANGER', { x: 10, y: 8 }, 0);
      state = addUnit(state, 'A:WIZARD', 'A', 'WIZARD', { x: 3, y: 8 });
      state.units.get('A:WARRIOR')!.stats.currentHp = 2;

      const result = applyCommand(state, 'A', {
        type: 'ALTAR_WISH',
        unitId: 'A:WARRIOR',
        wish: 'RESURRECT',
      });
      expect(result.ok).toBe(true);
      expect(result.state!.units.get('A:WARRIOR')!.stats.currentHp).toBe(1);
      expect(result.state!.units.get('A:RANGER')!.stats.currentHp).toBe(1);
    });

    it('raises onto the nearest free tile when the spawn point is taken', () => {
      let state = withSouls(1);
      state = addUnit(state, 'A:RANGER', 'A', 'RANGER', { x: 10, y: 8 }, 0);
      state = addUnit(state, 'A:WIZARD', 'A', 'WIZARD', { x: 3, y: 8 });
      const spawn = deploymentTiles(0, ARENA)[SQUAD_ROSTER.indexOf('RANGER')];
      state = addUnit(state, 'B:BEAST', 'B', 'BEAST', spawn);

      const raised = state.units.get('A:RANGER')!;
      const spot = resurrectionSpotFor(state, raised);
      expect(spot).not.toEqual(spawn);
      expect(Math.abs(spot.x - spawn.x) + Math.abs(spot.y - spawn.y)).toBe(1);
    });
  });

  describe('persistence', () => {
    it('round-trips souls and the wish clock', () => {
      let state = populated();
      state = cloneState(state);
      state.altarSouls = 3;
      state.altarWishTurns = { A: 2 };

      const back = deserializeGameState(serializeGameState(state));
      expect(back.altarSouls).toBe(3);
      expect(back.altarWishTurns).toEqual({ A: 2 });
    });

    it('reads a room persisted before the altar existed', () => {
      const serialized = serializeGameState(populated()) as unknown as Record<string, unknown>;
      delete serialized.altarSouls;
      delete serialized.altarWishTurns;

      const back = deserializeGameState(serialized as never);
      expect(back.altarSouls).toBe(0);
      expect(back.altarWishTurns).toEqual({});
    });
  });
});

/** Tidy the repeated "must have succeeded" assertion out of the cooldown test. */
function applyEndTurnSafe(state: GameState, playerId: string): GameState {
  const result = applyCommand(state, playerId, { type: 'END_TURN' });
  if (!result.ok || !result.state) throw new Error(result.error ?? 'end turn failed');
  return result.state;
}
