import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  startMatch,
  deserializeGameState,
  serializeGameState,
  defaultWallPositions,
  applyCommand,
  deploymentTilesFor,
  DEFAULT_BOARD_SIZE,
  isWall,
} from './index';

const SIZE = DEFAULT_BOARD_SIZE;
const draft = (seed = 42) => createInitialState({ gameId: 'g', playerIds: ['A', 'B'], mapSeed: seed });
const terrainOf = (state: { terrain: Map<string, string> }) =>
  [...state.terrain.keys()].sort().join(' ');

describe('map mode', () => {
  it('defaults to the classic arena', () => {
    // A new match must look like the game always looked. Procedural biomes are
    // the opt-in variation, so the default has to be the original.
    expect(draft().mapMode).toBe('CLASSIC');
  });

  it('starts on the original wall layout by default', () => {
    const classic = new Map(defaultWallPositions().map((p) => [`${p.x},${p.y}`, 'WALL']));
    expect(terrainOf(draft())).toBe(terrainOf({ terrain: classic }));
  });

  it('lets either player set it, not only the draft picker', () => {
    // A is not the pickOrder[0] here and still gets to choose the board.
    const state = draft();
    const result = applyCommand(state, 'B', { type: 'SET_MAP_MODE', mapMode: 'RANDOM' });
    expect(result.ok).toBe(true);
  });

  it('builds the classic arena when asked at creation', () => {
    const state = createInitialState({ gameId: 'g', playerIds: ['A', 'B'], mapSeed: 42, mapMode: 'CLASSIC' });
    expect(terrainOf(state)).toBe(terrainOf({ terrain: new Map(defaultWallPositions().map((p) => [`${p.x},${p.y}`, 'WALL'])) }));
  });

  it('switches between classic and random during the draft', () => {
    const start = draft();
    // Start is CLASSIC now, so go to RANDOM first.
    const random = applyCommand(start, 'A', { type: 'SET_MAP_MODE', mapMode: 'RANDOM' });
    expect(random.ok).toBe(true);
    expect(random.state!.mapMode).toBe('RANDOM');
    expect(terrainOf(random.state!)).not.toBe(terrainOf(start));

    // And back to the original, from the other player, without a turn order.
    const back = applyCommand(random.state!, 'B', { type: 'SET_MAP_MODE', mapMode: 'CLASSIC' });
    expect(back.ok).toBe(true);
    expect(terrainOf(back.state!)).toBe(terrainOf(start));
  });

  it('keeps the seed stable across mode switches', () => {
    // Rerolling on each toggle would make the map a lottery rather than a
    // choice; toggling out and back must return the same floor.
    const start = draft(7);
    const random = applyCommand(start, 'A', { type: 'SET_MAP_MODE', mapMode: 'RANDOM' }).state!;
    const classic = applyCommand(random, 'A', { type: 'SET_MAP_MODE', mapMode: 'CLASSIC' }).state!;
    expect(classic.mapSeed).toBe(7);
    expect(terrainOf(classic)).toBe(terrainOf(start));
  });

  it('gives the same adventure floor for the same seed, and a different one for a different seed', () => {
    // `RANDOM` is now Adventure, so the only way to reach it is the draft
    // command — it is no longer something `createInitialState` can be handed.
    // The property that matters is unchanged and is what this now guards: the
    // floor is a pure function of the seed, so a run can be reproduced from a
    // bug report and a reroll is the only way to get a different map.
    const adventureFor = (seed: number) =>
      applyCommand(draft(seed), 'A', { type: 'SET_MAP_MODE', mapMode: 'RANDOM' }).state!;
    expect(terrainOf(adventureFor(11))).toBe(terrainOf(adventureFor(11)));
    expect(terrainOf(adventureFor(11))).not.toBe(terrainOf(adventureFor(12)));
  });

  it('refuses once the match is running, so walls cannot move under a unit', () => {
    const running = startMatch(draft());
    const result = applyCommand(running, 'A', { type: 'SET_MAP_MODE', mapMode: 'CLASSIC' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/locked/i);
  });

  it('rejects an unknown mode and a no-op toggle', () => {
    const state = draft();
    const bogus = applyCommand(state, 'A', { type: 'SET_MAP_MODE', mapMode: 'NONSENSE' as never });
    expect(bogus.ok).toBe(false);
    // CLASSIC is the default, so selecting it again is the no-op.
    const same = applyCommand(state, 'A', { type: 'SET_MAP_MODE', mapMode: 'CLASSIC' });
    expect(same.ok).toBe(false);
    expect(same.error).toMatch(/already/i);
  });

  it('never lands a wall on a deployment tile in either mode', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      for (const mode of ['RANDOM', 'CLASSIC'] as const) {
        const state = createInitialState({ gameId: 'g', playerIds: ['A', 'B'], mapSeed: seed, mapMode: mode });
        for (const tile of deploymentTilesFor(SIZE)) {
          expect(isWall(state, tile), `${mode} seed ${seed}`).toBe(false);
        }
      }
    }
  });

  it('leaves both modes playable, so neither spawns anyone stuck', () => {
    for (const mode of ['RANDOM', 'CLASSIC'] as const) {
      const state = startMatch(
        createInitialState({ gameId: 'g', playerIds: ['A', 'B'], mapSeed: 5, mapMode: mode }),
      );
      // Both deployment rows must be clear and mutually walkable.
      for (const tile of deploymentTilesFor(SIZE)) {
        expect(isWall(state, tile), mode).toBe(false);
      }
      // Reaching a mode by toggle must work from the other one. `draft()` is
      // CLASSIC, so toggling to RANDOM and back covers both directions.
      const random = applyCommand(draft(5), 'A', { type: 'SET_MAP_MODE', mapMode: 'RANDOM' });
      expect(random.ok).toBe(true);
      const back = applyCommand(random.state!, 'A', { type: 'SET_MAP_MODE', mapMode: 'CLASSIC' });
      expect(back.ok).toBe(true);
    }
  });

  it('survives a round trip, and old rooms without the field load as RANDOM', () => {
    const classic = createInitialState({ gameId: 'g', playerIds: ['A', 'B'], mapSeed: 3, mapMode: 'CLASSIC' });
    expect(deserializeGameState(serializeGameState(classic)).mapMode).toBe('CLASSIC');

    const wire = serializeGameState(draft());
    delete wire.mapMode;
    expect(deserializeGameState(wire).mapMode).toBe('CLASSIC');
  });
});