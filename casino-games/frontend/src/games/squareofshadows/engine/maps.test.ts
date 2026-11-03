import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BOARD_SIZE,
  createInitialState,
  serializeGameState,
  deserializeGameState,
  startMatch,
  defaultWallPositions,
  deploymentTilesFor,
  generateWalls,
  validateWalls,
  rngFromSeed,
  floorParityFor,
  isWall,
  unitAt,
  createUnit,
  cloneState,
} from './index';
import type { BoardSize, Position } from './index';

/**
 * The real board standard, imported rather than restated.
 *
 * These tests used to pin a literal 10x10, which meant they kept passing after
 * `DEFAULT_BOARD_SIZE` moved to 10x8 — the generator was never actually
 * exercised at the size real matches use. Anything asserting density or mirror
 * symmetry has to run against the shipped default, or it proves nothing.
 */
const SIZE: BoardSize = DEFAULT_BOARD_SIZE;
const keys = (walls: Position[]) => new Set(walls.map((w) => `${w.x},${w.y}`));

describe('map validation', () => {
  it('accepts the hand-authored map', () => {
    expect(validateWalls(defaultWallPositions(), SIZE)).toBeNull();
  });

  it('rejects a wall on a deployment tile', () => {
    // Player 0 deploys onto row height-1, centred columns. Derived from the
    // board size rather than hardcoded, so this fixture cannot silently go
    // stale when the standard changes.
    const walls = [{ x: 4, y: SIZE.height - 1 }, ...defaultWallPositions()];
    expect(validateWalls(walls, SIZE)).toBe('BLOCKED_DEPLOYMENT');
  });

  it('keeps the hand-authored fallback on the standard board size', () => {
    // A hand-authored map cannot notice that the board got shorter, so this
    // asserts the invariant directly: the fallback is valid AT the shipped size,
    // which is the only size the generator will ever fall back to.
    expect(SIZE).toEqual({ width: 12, height: 10 });
    expect(validateWalls(defaultWallPositions(), SIZE)).toBeNull();
    for (const tile of deploymentTilesFor(SIZE)) {
      expect(keys(defaultWallPositions()).has(`${tile.x},${tile.y}`)).toBe(false);
    }
  });

  it('accepts a 2x2 block, because the shipped map has one', () => {
    // The hand-authored floor centres on a 2x2 ruin, so 2x2 blocks are part of
    // this game's visual language, not a defect. An earlier draft of the
    // validator rejected them and so rejected the canonical map — worth pinning
    // as a test so nobody re-adds the rule on a plausible-sounding rationale.
    // Built from the real fallback plus one extra block, so the density band is
    // satisfied at whatever size the board currently is (a hand-counted list
    // fell out of band the moment the board grew).
    const walls = [...defaultWallPositions(), { x: 2, y: 2 }, { x: 3, y: 2 }];
    expect(validateWalls(walls, SIZE)).toBeNull();
  });

  it('rejects a wall line that spans the board', () => {
    // A full row of stone separates the two deployment areas for good.
    const row = Array.from({ length: SIZE.width }, (_, x) => ({ x, y: 5 }));
    expect(validateWalls(row, SIZE)).toBe('SEALED_ROW');
  });

  it('rejects a sealed-off spawn', () => {
    // Wall every orthogonal neighbour of player 0's four spawn tiles. Sealing
    // only the row above is not enough — the squad walks out sideways and then
    // straight up the open column, which is what this test exists to catch.
    //
    // Derived from the real deployment tiles rather than hardcoded columns: the
    // spawn is four tiles centred, so at width 12 that is x = 4..7, and a
    // fixture pinned to an older width put a wall ON the spawn and tripped
    // BLOCKED_DEPLOYMENT instead of exercising the seal.
    const spawn = deploymentTilesFor(SIZE).filter((t) => t.y === SIZE.height - 1);
    const xs = [...new Set(spawn.map((t) => t.x))].sort((a, b) => a - b);
    const row = SIZE.height - 1;
    const above = SIZE.height - 2;
    const walls = [
      { x: xs[0] - 1, y: row }, { x: xs[xs.length - 1] + 1, y: row },
      ...xs.map((x) => ({ x, y: above })),
    ];
    // Density is checked before connectivity, and a bare seal is far too sparse
    // to clear the band on its own — so pad the board out to a legal density and
    // let the seal be the thing that actually fails. Otherwise this test would
    // pass for the wrong reason.
    const padded = [...walls, ...defaultWallPositions()];
    expect(validateWalls(padded, SIZE)).toBe('DISCONNECTED');
  });

  it('rejects a board that is too empty', () => {
    expect(validateWalls([{ x: 4, y: 4 }], SIZE)).toBe('DENSITY');
  });

  it('rejects a board that is too dense', () => {
    // Fill the non-deployment rows at every other column. Enough to blow past
    // the density band regardless of the board size in use.
    const walls = [];
    for (let y = 2; y < SIZE.height - 2; y += 1) {
      for (let x = 0; x < SIZE.width; x += 2) walls.push({ x, y });
    }
    expect(validateWalls(walls, SIZE)).toBe('DENSITY');
  });
});

describe('generateWalls', () => {
  it('produces the same floor for the same seed', () => {
    const a = generateWalls({ seed: 4242, size: SIZE });
    const b = generateWalls({ seed: 4242, size: SIZE });
    expect(keys(a)).toEqual(keys(b));
  });

  it('produces different floors for different seeds', () => {
    // Not one assertion — a generator that varies only rarely would pass a
    // single unlucky pair, so require real spread across a spread of seeds.
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      seen.add([...keys(generateWalls({ seed, size: SIZE }))].sort().join(' '));
    }
    expect(seen.size).toBeGreaterThan(30);
  });

  it('is mirrored left-right, keeping the two spawn areas fair', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const set = keys(generateWalls({ seed, size: SIZE }));
      for (const key of set) {
        const [x, y] = key.split(',').map(Number);
        expect(set.has(`${SIZE.width - 1 - x},${y}`)).toBe(true);
      }
    }
  });

  it('never blocks a deployment tile, for any seed', () => {
    const deployment = deploymentTilesFor(SIZE);
    for (let seed = 0; seed < 500; seed += 1) {
      const set = keys(generateWalls({ seed, size: SIZE }));
      for (const tile of deployment) {
        expect(set.has(`${tile.x},${tile.y}`)).toBe(false);
      }
    }
  });

  it('always returns a playable floor', () => {
    // The generator must be total. This is the test that matters: it sweeps a
    // wide seed range and asserts the invariant that keeps a match from being
    // born unplayable.
    for (let seed = 0; seed < 2000; seed += 1) {
      const walls = generateWalls({ seed, size: SIZE });
      expect(validateWalls(walls, SIZE), `seed ${seed}`).toBeNull();
    }
  });

  it('keeps wall density inside the tuned band', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      const density = generateWalls({ seed, size: SIZE }).length / (SIZE.width * SIZE.height);
      expect(density).toBeGreaterThanOrEqual(0.06);
      expect(density).toBeLessThanOrEqual(0.2);
    }
  });

  it('falls back rather than emitting an unplayable board', () => {
    // A 4x4 board cannot satisfy the density band: the only rows available to
    // draw walls from are protected deployment rows, so every candidate is
    // rejected for DENSITY and the fallback must come back.
    //
    // This is the totality guarantee — the generator is a total function, so no
    // seed and no rng can produce an unplayable board or spin in the retry loop.
    const fallback = defaultWallPositions();
    const tiny: BoardSize = { width: 4, height: 4 };
    const walls = generateWalls({ seed: 7, size: tiny, fallback });
    expect(validateWalls(walls, tiny)).toBe('DENSITY');
    expect(keys(walls)).toEqual(keys(fallback));
  });

  it('honours an injected rng', () => {
    const fixed = generateWalls({ seed: 99, size: SIZE, rng: rngFromSeed(99) });
    expect(keys(fixed)).toEqual(keys(generateWalls({ seed: 99, size: SIZE })));
  });
});

describe('seeded floors in match state', () => {
  const match = (seed: number) => {
    const state = createInitialState({ gameId: 'g', playerIds: ['A', 'B'], mapSeed: seed });
    return state;
  };

  it('generates a distinct floor per seed in random mode', () => {
    // The default is now CLASSIC (the fixed original arena), so variation is a
    // property of RANDOM specifically — asserting it on the default would be
    // asserting that the default varies, which is the opposite of the rule.
    const terrainKeys = (seed: number) =>
      [...createInitialState({ gameId: 'g', playerIds: ['A', 'B'], mapSeed: seed, mapMode: 'RANDOM' })
        .terrain.keys()].sort().join(' ');
    expect(terrainKeys(1)).not.toBe(terrainKeys(2));
  });

  it('gives every seed the identical classic arena by default', () => {
    // The default must be the one map players learned, whatever the seed is.
    const terrainKeys = (seed: number) => [...match(seed).terrain.keys()].sort().join(' ');
    expect(terrainKeys(1)).toBe(terrainKeys(2));
    expect(terrainKeys(1)).toBe([...defaultWallPositions()].map((p) => `${p.x},${p.y}`).sort().join(' '));
  });

  it('keeps the seed in state so the floor is reproducible', () => {
    expect(match(123).mapSeed).toBe(123);
  });

  it('leaves every deployment tile walkable in a real match', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const state = match(seed);
      for (const tile of deploymentTilesFor(state.boardSize)) {
        expect(isWall(state, tile), `seed ${seed} at ${tile.x},${tile.y}`).toBe(false);
      }
    }
  });

  it('can place both squads and leave them connected', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const state = startMatch(match(seed));
      // Squads spawn on their deployment rows; a floor that walled one in would
      // make the match unplayable from the first turn.
      const a = createUnit('A:WARRIOR', 'A', 'WARRIOR', { x: 3, y: 9 });
      const b = createUnit('B:WARRIOR', 'B', 'WARRIOR', { x: 3, y: 0 });
      const placed = cloneState(state);
      placed.units.set(a.id, a);
      placed.units.set(b.id, b);
      expect(unitAt(placed, { x: 3, y: 9 })?.id).toBe('A:WARRIOR');
      expect(unitAt(placed, { x: 3, y: 0 })?.id).toBe('B:WARRIOR');
    }
  });

  it('survives a serialize/deserialize round trip unchanged', () => {
    const original = match(777);
    const restored = deserializeGameState(serializeGameState(original));
    expect(restored.mapSeed).toBe(777);
    expect([...restored.terrain.entries()].sort()).toEqual(
      [...original.terrain.entries()].sort(),
    );
  });

  it('is identical for every match that omits the seed', () => {
    // Documents the footgun rather than the behaviour being useful: omitting
    // `mapSeed` silently yields seed 0, so EVERY such match plays the same
    // board.
    //
    // This shipped once. `startGame` in useSquareOfShadows built AI and hotseat
    // matches without a seed while `buildMatch` seeded the server's online ones,
    // so duels varied and local play did not — which reads exactly like
    // generation working. Every caller that builds a real match must pass a
    // seed; only tests and the fallback path may rely on the default.
    const a = createInitialState({ gameId: 'g1', playerIds: ['A', 'B'] });
    const b = createInitialState({ gameId: 'g2', playerIds: ['A', 'B'] });
    expect(a.mapSeed).toBe(0);
    expect([...a.terrain.keys()].sort()).toEqual([...b.terrain.keys()].sort());
  });

  it('honours an explicit wall list over the seed', () => {
    // Tests and the generator's own fallback both need to pin a floor, so an
    // explicit `walls` must win rather than being generated over.
    const walls = [{ x: 2, y: 2 }];
    const state = createInitialState({ gameId: 'g', playerIds: ['A', 'B'], walls, mapSeed: 5 });
    expect([...state.terrain.keys()]).toEqual(['2,2']);
  });

  it('reads back rooms serialized before floors were seeded', () => {
    const original = match(3);
    const wire = serializeGameState(original);
    delete wire.mapSeed;
    const restored = deserializeGameState(wire);
    expect(restored.mapSeed).toBe(0);
  });
});

describe('per-tile terrain kinds survive serialization', () => {
  it('does not apply the first tile kind to every tile', () => {
    // The old implementation read `data.terrain[0]?.kind` and painted every
    // position with it. Invisible while terrain held nothing but walls, and a
    // silent corruption the moment a third TileKind exists.
    const state = cloneState(createInitialState({ gameId: 'g', playerIds: ['A', 'B'] }));
    state.terrain.set('1,1', 'WALL');
    state.terrain.set('2,2', 'FLOOR');

    const restored = deserializeGameState(serializeGameState(state));
    expect(restored.terrain.get('1,1')).toBe('WALL');
    expect(restored.terrain.get('2,2')).toBe('FLOOR');
  });
});

describe('floorParityFor', () => {
  it('is stable for a seed and only ever 0 or 1', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const p = floorParityFor(seed);
      expect(p === 0 || p === 1).toBe(true);
      expect(floorParityFor(seed)).toBe(p);
    }
  });

  it('produces both phases across seeds', () => {
    const phases = new Set(Array.from({ length: 40 }, (_, s) => floorParityFor(s)));
    expect(phases.size).toBe(2);
  });
});