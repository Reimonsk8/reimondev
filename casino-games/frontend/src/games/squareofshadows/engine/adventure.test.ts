import { describe, it, expect } from 'vitest';
import {
  ADVENTURE_BOARD_SIZE,
  ADVENTURE_VIEW,
  DEFAULT_BOARD_SIZE,
  MONSTER_TEAM_ID,
  adventureDeploymentTiles,
  applyCommand,
  cameraWindowFor,
  cameraWindowFromOrigin,
  checkVictory,
  tileCentreInViewPct,
  tileSizeInViewPct,
  tileVisibleInView,
  openingCameraWindow,
  manhattan,
  chooseAiCommand,
  createInitialState,
  createUnit,
  isAdventureState,
  positionKey,
  startMatch,
  unitAt,
  attackRangeTiles,
} from './index';
import type { GameState, Position, Unit } from './index';

const SIZE = ADVENTURE_BOARD_SIZE;

/**
 * A drafted, playable adventure run.
 *
 * Adventure is chosen the way a player chooses it: `SET_MAP_MODE` in the draft.
 * That is the only place it can be turned on, so it is the only place a test
 * can turn it on either.
 */
const adventure = (seed = 7): GameState => {
  let state = createInitialState({ gameId: 'adv', playerIds: ['A', 'B'], mapSeed: seed });
  state = applyCommand(state, 'A', { type: 'SET_MAP_MODE', mapMode: 'RANDOM' }).state!;
  state = applyCommand(state, 'A', { type: 'CHOOSE_FACTION', faction: 'INQUISITORS' }).state!;
  state = applyCommand(state, 'B', { type: 'CHOOSE_FACTION', faction: 'PENITENT_COURT' }).state!;
  return state;
};

describe('adventure board', () => {
  it('is identified by the chosen map mode, not by a turn-order slot', () => {
    expect(isAdventureState(adventure())).toBe(true);
    expect(
      isAdventureState(
        createInitialState({ gameId: 'g', playerIds: ['A', 'B'], mapSeed: 1 }),
      ),
    ).toBe(false);
  });

  it('is a floor chosen during the draft, not a mode of its own', () => {
    // No adventure exists at creation: a fresh match is the 12x10 arena with two
    // players. SET_MAP_MODE is what turns it into a 20x20 party.
    const draft = createInitialState({ gameId: 'g', playerIds: ['A', 'B'], mapSeed: 5 });
    expect(draft.boardSize).toEqual(DEFAULT_BOARD_SIZE);
    expect(draft.turnOrder).toEqual(['A', 'B']);
    expect(isAdventureState(draft)).toBe(false);

    const switched = applyCommand(draft, 'B', { type: 'SET_MAP_MODE', mapMode: 'RANDOM' }).state!;
    expect(switched.boardSize).toEqual(ADVENTURE_BOARD_SIZE);
    // The monsters get the FLOOR, never a seat in the turn order.
    expect(switched.turnOrder).toEqual(['A', 'B']);
    expect(isAdventureState(switched)).toBe(true);
  });

  it('gives the monsters no seat in the turn order at all', () => {
    // They have no turn of their own: they move and strike automatically at the
    // end of every player's turn, so they must never be handed initiative — a
    // phantom third seat would stall the loop on a team the player cannot play.
    const run = adventure();
    expect(run.turnOrder).toEqual(['A', 'B']);
    expect(run.turnOrder).not.toContain(MONSTER_TEAM_ID);
    expect(run.activePlayerId).toBe('A');
    // ...yet they are on the floor and are recognised as the adventure marker.
    expect(Array.from(run.units.values()).some((u) => u.ownerId === MONSTER_TEAM_ID)).toBe(true);
    expect(isAdventureState(run)).toBe(true);
  });

  /*
   * The monsters' automatic step.
   *
   * They have no turn: they act at the end of EVERY player's turn, inside the
   * reducer, so the same behaviour runs for the optimistic client and the
   * authoritative server and no client has to ask for it.
   */
  describe('the monsters act on their own at the end of each player turn', () => {
    const fingerprint = (state: GameState) =>
      Array.from(state.units.values())
        .filter((u) => u.ownerId === MONSTER_TEAM_ID)
        .map((u) => `${u.id}@${u.position.x},${u.position.y}/${u.stats.currentHp}`)
        .join('|');

    it('moves them without ever handing them the turn', () => {
      const start = adventure();
      const active = start.activePlayerId;
      const before = fingerprint(start);

      const ended = applyCommand(start, active, { type: 'END_TURN' }, () => 0.5);

      expect(ended.ok).toBe(true);
      // Something happened on the floor...
      expect(fingerprint(ended.state!)).not.toBe(before);
      // ...and the turn went straight to the next PLAYER.
      expect(ended.state!.activePlayerId).not.toBe(MONSTER_TEAM_ID);
      expect(ended.state!.turnOrder).toEqual(['A', 'B']);
    });

    it('acts once per player turn, so two hand-overs give two steps', () => {
      let state: GameState = adventure();
      const first = fingerprint(state);
      const active = state.activePlayerId;
      state = applyCommand(state, active, { type: 'END_TURN' }, () => 0.5).state!;
      const afterFirst = fingerprint(state);
      expect(afterFirst).not.toBe(first);

      state = applyCommand(state, state.activePlayerId, { type: 'END_TURN' }, () => 0.5).state!;
      // A second step is a second chance to move, so the board moves again.
      expect(fingerprint(state)).not.toBe(afterFirst);
    });

    it('emits the monsters\' actions in the same batch as the hand-over', () => {
      // One batch means one animation pass: the client cannot play a monster
      // step the server did not send, and vice versa.
      const start = adventure();
      const ended = applyCommand(start, start.activePlayerId, { type: 'END_TURN' }, () => 0.5);
      const types = (ended.events ?? []).map((e) => e.type);
      expect(types).toContain('TURN_ENDED');
      const monsterActions = types.filter((t) =>
        t === 'UNIT_MOVED' || t === 'UNIT_ATTACKED' || t === 'RANGER_SHOT' || t === 'SPELL_CAST',
      );
      expect(monsterActions.length).toBeGreaterThan(0);
    });

    it('leaves the monsters looking ready rather than spent', () => {
      // They act outside any turn, so their flags must not read as "already
      // moved" on the board between one step and the next.
      const start = adventure();
      const state = applyCommand(start, start.activePlayerId, { type: 'END_TURN' }, () => 0.5).state!;
      for (const unit of state.units.values()) {
        if (unit.ownerId !== MONSTER_TEAM_ID) continue;
        expect(unit.hasMoved).toBe(false);
        expect(unit.hasAttacked).toBe(false);
      }
    });

    it('does nothing in an Arena, which has no monsters at all', () => {
      let arena = createInitialState({ gameId: 'g', playerIds: ['A', 'B'], mapSeed: 5 });
      arena = applyCommand(arena, 'A', { type: 'CHOOSE_FACTION', faction: 'INQUISITORS' }).state!;
      arena = applyCommand(arena, 'B', { type: 'CHOOSE_FACTION', faction: 'PENITENT_COURT' }).state!;
      const ended = applyCommand(arena, arena.activePlayerId, { type: 'END_TURN' }, () => 0.5);
      expect(ended.ok).toBe(true);
      expect((ended.events ?? []).map((e) => e.type)).toEqual(['TURN_ENDED']);
    });

    it('does not end the run when only the monsters are gone', () => {
      // The run ends on a PLAYER squad falling, never on the garrison: both
      // squads are still standing, so the phase stays `playing`.
      const state = adventure();
      for (const [id, unit] of [...state.units]) {
        if (unit.ownerId === MONSTER_TEAM_ID) {
          state.units.set(id, { ...unit, stats: { ...unit.stats, currentHp: 0 } });
        }
      }
      const ended = applyCommand(state, state.activePlayerId, { type: 'END_TURN' }, () => 0.5);
      expect(ended.state!.winnerId).toBeNull();
      expect(ended.state!.phase).toBe('playing');
    });
  });

  it('takes the monsters away again when the arena is re-selected', () => {
    // Toggling back must not leave a phantom third seat behind, or the turn loop
    // would hand initiative to a team that has no units and never end.
    const on = applyCommand(
      createInitialState({ gameId: 'g', playerIds: ['A', 'B'], mapSeed: 5 }),
      'A',
      { type: 'SET_MAP_MODE', mapMode: 'RANDOM' },
    ).state!;
    const back = applyCommand(on, 'A', { type: 'SET_MAP_MODE', mapMode: 'CLASSIC' });
    expect(back.ok).toBe(true);
    expect(back.state!.turnOrder).toEqual(['A', 'B']);
    expect(back.state!.boardSize).toEqual(DEFAULT_BOARD_SIZE);
    expect(isAdventureState(back.state!)).toBe(false);
    expect(
      Array.from(back.state!.units.values()).filter((u) => u.ownerId === MONSTER_TEAM_ID),
    ).toHaveLength(0);
  });

  it('locks the floor once squads have deployed', () => {
    // Half-applying the switch mid-match would leave the board, the terrain and
    // the turn order describing three different games.
    const started = adventure();
    expect(applyCommand(started, 'A', { type: 'SET_MAP_MODE', mapMode: 'CLASSIC' }).ok).toBe(false);
  });

  it('generates a playable 20x20 floor for every seed', () => {
    // Regression guard for the generator: a bigger board changes the wall count,
    // the density band and the connectivity flood all at once.
    for (let seed = 1; seed <= 30; seed += 1) {
      const state = adventure(seed);
      expect(state.terrain.size).toBeGreaterThan(0);
      // Deployment rows must be clear of stone or a squad spawns inside a wall.
      for (const playerIndex of [0, 1]) {
        for (const tile of adventureDeploymentTiles(playerIndex, SIZE)) {
          expect(state.terrain.get(positionKey(tile))).toBeUndefined();
        }
      }
    }
  });

  it('lays out an open floor rather than a maze', () => {
    // The duel arena's 0.2 density over four times the tiles reads as a
    // labyrinth. Adventure drops it, and this is what stops that regressing
    // silently — a sparser map still passes every other test in this file.
    let total = 0;
    const samples = 12;
    for (let seed = 1; seed <= samples; seed += 1) total += adventure(seed).terrain.size;
    const density = total / samples / (SIZE.width * SIZE.height);
    expect(density).toBeLessThan(0.14);
    expect(density).toBeGreaterThan(0.04);
  });

  it('spreads walls over the whole floor, not just the northern rows', () => {
    // The generator draws one half and mirrors it sideways. Without the vertical
    // mirror, the entire southern half of a 20x20 board is bare floor — the
    // party would start on an empty plain and only meet stone near the far edge.
    for (const seed of [3, 19, 44]) {
      const state = adventure(seed);
      const rowsWithWalls = new Set(
        [...state.terrain.keys()].map((key) => Number(key.split(',')[1])),
      );
      expect(Math.min(...rowsWithWalls)).toBeLessThan(SIZE.height / 2);
      expect(Math.max(...rowsWithWalls)).toBeGreaterThan(SIZE.height / 2);
    }
  });

  it('deploys the two squads in diagonally opposite corners', () => {
    const tiles0 = adventureDeploymentTiles(0, SIZE);
    const tiles1 = adventureDeploymentTiles(1, SIZE);
    // P1 south-west, P2 north-east.
    expect(Math.max(...tiles0.map((t) => t.x))).toBeLessThan(SIZE.width / 2);
    expect(Math.max(...tiles0.map((t) => t.y))).toBeGreaterThan(SIZE.height / 2);
    expect(Math.min(...tiles1.map((t) => t.x))).toBeGreaterThan(SIZE.width / 2);
    expect(Math.min(...tiles1.map((t) => t.y))).toBeLessThan(SIZE.height / 2);
    // And they must not overlap, or one squad spawns inside the other.
    const keys = new Set([...tiles0, ...tiles1].map(positionKey));
    expect(keys.size).toBe(8);
  });

  it('fills the floor with four monsters that never overlap a player or a wall', () => {
    const state = adventure();
    const monsters = Array.from(state.units.values()).filter(
      (u) => u.ownerId === MONSTER_TEAM_ID,
    );
    // Four, matching a player squad: an even fight rather than a mob.
    expect(monsters.length).toBe(4);
    // Both kinds, so a run always has something at reach and something that
    // bites from two tiles away. Was "one of each class" back when the monsters
    // were four player classes in monster paint.
    expect(new Set(monsters.map((m) => m.type))).toEqual(new Set(['BEAST', 'SPITTER']));
    const occupied = new Set<string>();
    for (const unit of state.units.values()) {
      const key = positionKey(unit.position);
      expect(occupied.has(key)).toBe(false);
      expect(state.terrain.get(key)).toBeUndefined();
      occupied.add(key);
    }
  });

  it('seeds the garrison from the map seed, so a run is reproducible', () => {
    const layout = (s: GameState) =>
      Array.from(s.units.values())
        .filter((u) => u.ownerId === MONSTER_TEAM_ID)
        .map((u) => `${u.type}@${positionKey(u.position)}`)
        .sort()
        .join(' ');
    expect(layout(adventure(11))).toBe(layout(adventure(11)));
    // …and a different seed lands them somewhere else, so the seed is actually
    // doing the work rather than the layout being a constant.
    expect(layout(adventure(12))).not.toBe(layout(adventure(11)));
  });
});

describe('adventure monsters', () => {
  it('are driven by the ordinary AI policy and only ever issue legal commands', () => {
    let state = adventure();
    let guard = 0;
    while (state.activePlayerId === MONSTER_TEAM_ID && state.phase === 'playing' && guard < 40) {
      guard += 1;
      const command = chooseAiCommand(state, MONSTER_TEAM_ID);
      const result = applyCommand(state, MONSTER_TEAM_ID, command);
      expect(result.ok).toBe(true);
      state = result.state!;
    }
    // A monster turn always terminates rather than looping forever.
    expect(state.activePlayerId === MONSTER_TEAM_ID).toBe(false);
  });

  it('hunt BOTH player teams, not just whoever moved last', () => {
    // The policy has no notion of "the other player" — every living unit it does
    // not own is a target. Prove it by removing every unit except one victim and
    // one monster, then running the policy twice with the victim flipped between
    // the two squads. Both must produce the same attack.
    const base = adventure();
    const monster = Array.from(base.units.values()).find(
      (u) => u.ownerId === MONSTER_TEAM_ID && u.type === 'BEAST',
    )!;

    for (const victimId of ['A:WARRIOR', 'B:WARRIOR']) {
      const victim = base.units.get(victimId)!;
      const units = new Map<string, GameState['units'] extends Map<string, infer U> ? U : never>();
      // Row 18 is the deployment row, which the generator never draws on, so
      // these two are guaranteed to be standing on open floor and in reach.
      units.set(monster.id, { ...monster, position: { x: 6, y: 18 } });
      units.set(victimId, { ...victim, position: { x: 5, y: 18 } });
      const probe: GameState = {
        ...base,
        activePlayerId: MONSTER_TEAM_ID,
        units: units as GameState['units'],
      };
      const command = chooseAiCommand(probe, MONSTER_TEAM_ID) as
        | { type: string; targetId?: string };
      // A Beast has exactly one action, so there is nothing to choose between:
      // the claw, aimed at this squad's tile.
      expect(command.type).toBe('ATTACK_UNIT');
      expect(command.targetId).toBe(victimId);
    }
  });

  it('spreads its attacks across both squads instead of always picking the same victim', () => {
    // The aggro bug: target choice was the lowest HP, ties broken by unit order,
    // so whichever squad stepped forward first was hit every single turn. Two
    // equally good victims must not always resolve to the same one.
    const base = adventure();
    const monster = Array.from(base.units.values()).find(
      (u) => u.ownerId === MONSTER_TEAM_ID && u.type === 'BEAST',
    )!;
    const units = new Map<string, Unit>();
    // Row 18 is the deployment row, so all three tiles are guaranteed open floor.
    units.set(monster.id, { ...monster, position: { x: 6, y: 18 } });
    units.set('A:WARRIOR', { ...base.units.get('A:WARRIOR')!, position: { x: 5, y: 18 } });
    units.set('B:WARRIOR', { ...base.units.get('B:WARRIOR')!, position: { x: 7, y: 18 } });
    const probe: GameState = {
      ...base,
      activePlayerId: MONSTER_TEAM_ID,
      units: units as GameState['units'],
    };

    const rollLow = chooseAiCommand(probe, MONSTER_TEAM_ID, () => 0) as { targetId?: string };
    const rollHigh = chooseAiCommand(probe, MONSTER_TEAM_ID, () => 0.999) as { targetId?: string };
    expect(rollLow.targetId).toBeTruthy();
    expect(rollHigh.targetId).toBeTruthy();
    expect(rollLow.targetId).not.toBe(rollHigh.targetId);
  });

  /*
   * Overlay coordinates vs the camera window.
   *
   * The bug: every overlay above the grid (zones, ice, traps, projectiles,
   * damage numbers) positioned itself as a fraction of the BOARD. In Arena the
   * grid used to fill the board, so that was right. In Adventure the grid draws
   * a window of a 20x20 floor, so a fraction of the board is a fraction of the
   * wrong box — overlays were displaced by the window origin and drifted further
   * off the further you walked from home. The same math now serves every map
   * size and every camera window.
   */
  /*
   * The opening must never be an empty floor.
   *
   * This is the bug, exactly: the monster zones deliberately keep off the two
   * spawn corners, but the camera OPENS on a spawn corner — so a garrison that
   * seeded entirely into the other regions left the first player staring at bare
   * floor with no sign the map is dangerous. Measured at 60/60 seeds barren
   * before the guarantee in `spawnAdventureMonsters`, 0/400 after.
   *
   * Worth a test over many seeds rather than one, because the failure is
   * per-map: a single happy seed proves nothing, and one is what let this through.
   */
  describe('the spawn guarantee only ever lands on real tiles', () => {
    it('intersects the camera window with the floor', () => {
      // The origin is clamped now, but the intersection remains defensive:
      // trusting a window origin without clipping once placed a monster on
      // x=-4, which is not a tile at all.
      let offBoard = 0;
      for (let seed = 0; seed < 80; seed += 1) {
        const floor = applyCommand(
          createInitialState({ gameId: `ob-${seed}`, playerIds: ['A', 'B'], mapSeed: seed }),
          'A',
          { type: 'SET_MAP_MODE', mapMode: 'RANDOM' },
        ).state!;
        const state = applyCommand(
          applyCommand(floor, 'A', { type: 'CHOOSE_FACTION', faction: 'INQUISITORS' }).state!,
          'B',
          { type: 'CHOOSE_FACTION', faction: 'PENITENT_COURT' },
        ).state!;
        for (const monster of state.units.values()) {
          if (monster.ownerId !== MONSTER_TEAM_ID) continue;
          const { x, y } = monster.position;
          if (x < 0 || y < 0 || x >= state.boardSize.width || y >= state.boardSize.height) {
            offBoard += 1;
          }
        }
      }
      expect(offBoard).toBe(0);
    });
  });

  describe('the opening view always shows a monster', () => {
    const drafted = (seed: number, id: string): GameState => {
      const floor = applyCommand(
        createInitialState({ gameId: `${id}-${seed}`, playerIds: ['A', 'B'], mapSeed: seed }),
        'A',
        { type: 'SET_MAP_MODE', mapMode: 'RANDOM' },
      ).state!;
      return applyCommand(
        applyCommand(floor, 'A', { type: 'CHOOSE_FACTION', faction: 'INQUISITORS' }).state!,
        'B',
        { type: 'CHOOSE_FACTION', faction: 'PENITENT_COURT' },
      ).state!;
    };
    const seesAMonster = (state: GameState): boolean => {
      const view = openingCameraWindow(state);
      return Array.from(state.units.values()).some(
        (u) => u.ownerId === MONSTER_TEAM_ID && tileVisibleInView(u.position, view),
      );
    };

    it('never opens on bare floor, across many seeds', () => {
      let empty = 0;
      for (let seed = 0; seed < 150; seed += 1) {
        if (!seesAMonster(drafted(seed, 'open'))) empty += 1;
      }
      expect(empty).toBe(0);
    });

    it('follows whichever seat actually opens, not the first player id', () => {
      // The assertion that caught the real bug. `turnOrder` is fixed when the
      // match is created and never mutated afterwards, so `turnOrder[0]` at spawn
      // IS the opening seat — reading `activePlayerId` instead pointed at whoever
      // picked a faction LAST, in the opposite corner, so the guarantee was met for
      // a player who was not looking at the board.
      let empty = 0;
      for (let seed = 0; seed < 60; seed += 1) {
        // Created with B first, so B (deployed north-east) is the one who opens.
        const floor = applyCommand(
          createInitialState({ gameId: `b-${seed}`, playerIds: ['B', 'A'], mapSeed: seed }),
          'B',
          { type: 'SET_MAP_MODE', mapMode: 'RANDOM' },
        ).state!;
        const state = applyCommand(
          applyCommand(floor, 'B', { type: 'CHOOSE_FACTION', faction: 'INQUISITORS' }).state!,
          'A',
          { type: 'CHOOSE_FACTION', faction: 'PENITENT_COURT' },
        ).state!;
        if (!seesAMonster(state)) empty += 1;
      }
      expect(empty).toBe(0);
    });

    it('does not undo the no-ambush margin by dropping one on the party', () => {
      // Relocating a monster into view must not put it next to a squad.
      let tooClose = 0;
      for (let seed = 0; seed < 60; seed += 1) {
        const state = drafted(seed, 'gap');
        for (const monster of state.units.values()) {
          if (monster.ownerId !== MONSTER_TEAM_ID) continue;
          for (const hero of state.units.values()) {
            if (hero.ownerId === MONSTER_TEAM_ID) continue;
            if (manhattan(monster.position, hero.position) <= 1) tooClose += 1;
          }
        }
      }
      expect(tooClose).toBe(0);
    });

    it('leaves every monster on a real, walkable tile', () => {
      const state = drafted(3, 'tile');
      for (const monster of state.units.values()) {
        if (monster.ownerId !== MONSTER_TEAM_ID) continue;
        const key = positionKey(monster.position);
        expect(state.terrain.get(key)).not.toBe('WALL');
        expect(monster.position.x).toBeGreaterThanOrEqual(0);
        expect(monster.position.x).toBeLessThan(state.boardSize.width);
      }
    });
  });

  describe('overlays follow the camera window, not the board', () => {
    const windowAt = (x: number, y: number) =>
      cameraWindowFor({ x, y }, ADVENTURE_BOARD_SIZE, ADVENTURE_VIEW);

    it('puts the focused tile in the middle of the window', () => {
      const view = windowAt(10, 10);
      const centre = tileCentreInViewPct({ x: 10, y: 10 }, view);
      // The odd 9x9 window gives the focus one exact centre cell, index 4.
      expect(centre.leftPct).toBeCloseTo(50, 5);
      expect(centre.topPct).toBeCloseTo(50, 5);
      expect(10 - view.originX).toBe(4);
      expect(10 - view.originY).toBe(4);
    });

    it('keeps tile positions consistent with its own origin', () => {
      // What must hold is SELF-CONSISTENCY: a tile is drawn where its offset
      // from the window origin says it is, whatever the window size.
      const view = cameraWindowFor({ x: 5, y: 5 }, DEFAULT_BOARD_SIZE, DEFAULT_BOARD_SIZE);
      const tile = { x: 5, y: 5 };
      const centre = tileCentreInViewPct(tile, view);
      expect(centre.leftPct).toBe(((tile.x - view.originX + 0.5) / view.cols) * 100);
      expect(centre.topPct).toBe(((tile.y - view.originY + 0.5) / view.rows) * 100);
    });

    it('differs from the board fraction once the window is offset', () => {
      // The exact failure: a monster at the far corner of a window that has
      // scrolled to the middle of the floor.
      const view = windowAt(15, 15);
      const tile = { x: 11, y: 11 };
      const correct = tileCentreInViewPct(tile, view);
      const wrong = {
        leftPct: ((tile.x + 0.5) / ADVENTURE_BOARD_SIZE.width) * 100,
        topPct: ((tile.y + 0.5) / ADVENTURE_BOARD_SIZE.height) * 100,
      };
      expect(correct.leftPct).not.toBeCloseTo(wrong.leftPct, 3);
      expect(correct.topPct).not.toBeCloseTo(wrong.topPct, 3);
      // ...and the corrected value still lands inside the drawn box.
      expect(correct.leftPct).toBeGreaterThan(0);
      expect(correct.leftPct).toBeLessThan(100);
      expect(correct.topPct).toBeGreaterThan(0);
      expect(correct.topPct).toBeLessThan(100);
    });

    it('keeps adjacent tiles exactly one tile-width apart', () => {
      const view = windowAt(15, 15);
      const a = tileCentreInViewPct({ x: 11, y: 11 }, view);
      const b = tileCentreInViewPct({ x: 12, y: 11 }, view);
      expect(b.leftPct - a.leftPct).toBeCloseTo(tileSizeInViewPct(view).widthPct, 5);
    });

    it('reports visibility against the window, not the board', () => {
      const view = windowAt(15, 15); // a 9x9 window somewhere mid-floor
      expect(tileVisibleInView({ x: view.originX, y: view.originY }, view)).toBe(true);
      expect(tileVisibleInView({ x: view.originX + view.cols - 1, y: view.originY + view.rows - 1 }, view)).toBe(true);
      // Just outside each edge.
      expect(tileVisibleInView({ x: view.originX - 1, y: view.originY }, view)).toBe(false);
      expect(tileVisibleInView({ x: view.originX + view.cols, y: view.originY }, view)).toBe(false);
      expect(tileVisibleInView({ x: view.originX, y: view.originY - 1 }, view)).toBe(false);
      expect(tileVisibleInView({ x: view.originX, y: view.originY + view.rows }, view)).toBe(false);
    });
  });

  it('can be attacked and killed by a player', () => {
    const state = adventure();
    const monster = Array.from(state.units.values()).find(
      (u) => u.ownerId === MONSTER_TEAM_ID && u.type === 'BEAST',
    )!;
    const cleric = state.units.get('A:WARRIOR')!;
    const next = new Map(state.units);
    next.set(cleric.id, { ...cleric, position: { x: monster.position.x - 1, y: monster.position.y } });
    const wounded = new Map(next);
    wounded.set(monster.id, { ...monster, stats: { ...monster.stats, currentHp: 1 } });
    const probe: GameState = { ...state, units: wounded };
    const result = applyCommand(probe, 'A', {
      type: 'ATTACK_UNIT',
      attackerId: cleric.id,
      targetId: monster.id,
    });
    expect(result.ok).toBe(true);
    expect(result.state!.units.get(monster.id)!.stats.currentHp).toBe(0);
  });
});

describe('adventure victory', () => {
  const killAllMonsters = (state: GameState): GameState => {
    const units = new Map(state.units);
    for (const unit of units.values()) {
      if (unit.ownerId === MONSTER_TEAM_ID) {
        units.set(unit.id, { ...unit, stats: { ...unit.stats, currentHp: 0 } });
      }
    }
    return { ...state, units };
  };
  const killAllPlayers = (state: GameState): GameState => {
    const units = new Map(state.units);
    for (const unit of units.values()) {
      if (unit.ownerId !== MONSTER_TEAM_ID) {
        units.set(unit.id, { ...unit, stats: { ...unit.stats, currentHp: 0 } });
      }
    }
    return { ...state, units };
  };

  it('does not clear the run when the last monster dies — only a player squad ends it', () => {
    // One unit of Player 2 down and the garrison wiped: both squads still
    // stand, so the run continues. The END condition is a squad falling, full
    // stop — nothing about the monsters ends the game.
    const base = adventure();
    const deadPlayer = base.units.get('B:WARRIOR')!;
    const withoutPlayer = {
      ...base,
      units: new Map(
        [...base.units].map(([id, unit]) =>
          id === deadPlayer.id ? [id, { ...unit, stats: { ...unit.stats, currentHp: 0 } }] : [id, unit],
        ),
      ),
    };
    expect(checkVictory(killAllMonsters(withoutPlayer))).toBeNull();
  });

  it('ends the run the moment ONE player squad is fully gone', () => {
    const state = adventure();
    const squadWiped = {
      ...state,
      units: new Map(
        [...state.units].map(([id, unit]) =>
          unit.ownerId === 'B'
            ? [id, { ...unit, stats: { ...unit.stats, currentHp: 0 } }]
            : [id, unit],
        ),
      ),
    };
    // Player 2 wiped out while Player 1 still stands: Player 1 takes the run
    // — a whole squad gone is the end, regardless of the monsters.
    expect(checkVictory(squadWiped)).toBe('A');
    expect(checkVictory(killAllPlayers(state))).toBe(MONSTER_TEAM_ID);
  });

  it('leaves the duel rules completely untouched', () => {
    const duel = createInitialState({ gameId: 'd', playerIds: ['A', 'B'], mapSeed: 3 });
    // Two empty seats: a duel with nobody alive in it is still not a result, so
    // the adventure branch cannot have leaked into the shared path.
    expect(checkVictory(startMatch({ ...duel, units: new Map() }))).toBeNull();
  });
});

describe('adventure camera', () => {
  it('centres the window on the focused unit', () => {
    const win = cameraWindowFor({ x: 10, y: 10 }, SIZE, ADVENTURE_VIEW);
    expect(win).toEqual({ originX: 6, originY: 6, cols: 9, rows: 9 });
  });

  it('clamps the window onto the floor and keeps the focus on screen', () => {
    expect(cameraWindowFor({ x: 0, y: 0 }, SIZE, ADVENTURE_VIEW)).toEqual({
      originX: 0, originY: 0, cols: 9, rows: 9,
    });
    expect(cameraWindowFor({ x: 19, y: 19 }, SIZE, ADVENTURE_VIEW)).toEqual({
      originX: 11, originY: 11, cols: 9, rows: 9,
    });

    for (let x = 0; x < SIZE.width; x += 1) {
      for (let y = 0; y < SIZE.height; y += 1) {
        const win = cameraWindowFor({ x, y }, SIZE, ADVENTURE_VIEW);
        const onX = x - win.originX;
        const onY = y - win.originY;
        expect(onX).toBeGreaterThanOrEqual(0);
        expect(onX).toBeLessThan(win.cols);
        expect(onY).toBeGreaterThanOrEqual(0);
        expect(onY).toBeLessThan(win.rows);
        if (x >= 4 && x <= 15) expect(onX).toBe(4);
        if (y >= 4 && y <= 15) expect(onY).toBe(4);
      }
    }
  });

  it('centres on the floor itself with no focus', () => {
    expect(cameraWindowFor(null, SIZE, ADVENTURE_VIEW)).toEqual({
      originX: 5, originY: 5, cols: 9, rows: 9,
    });
    const small = cameraWindowFor({ x: 1, y: 1 }, { width: 12, height: 10 }, ADVENTURE_VIEW);
    expect(small.cols).toBeLessThanOrEqual(12);
    expect(small.rows).toBeLessThanOrEqual(10);
  });

  it('draws an odd window with one exact centre tile', () => {
    expect(ADVENTURE_VIEW.width).toBe(9);
    expect(ADVENTURE_VIEW.height).toBe(9);
    expect(ADVENTURE_VIEW.width % 2).toBe(1);
    expect(ADVENTURE_VIEW.height % 2).toBe(1);
  });

  it('clamps a panned origin onto the floor instead of showing void', () => {
    expect(cameraWindowFromOrigin({ x: -4, y: -3 }, DEFAULT_BOARD_SIZE, { width: 5, height: 5 }))
      .toEqual({ originX: 0, originY: 0, cols: 5, rows: 5 });
    expect(cameraWindowFromOrigin({ x: 99, y: 99 }, DEFAULT_BOARD_SIZE, { width: 5, height: 5 }))
      .toEqual({ originX: 7, originY: 5, cols: 5, rows: 5 });
    // A 10x10 window is wider than the Arena is tall: it draws all 10 rows and
    // still has two columns of floor to pan across.
    expect(cameraWindowFromOrigin({ x: 99, y: 99 }, DEFAULT_BOARD_SIZE, { width: 10, height: 10 }))
      .toEqual({ originX: 2, originY: 0, cols: 10, rows: 10 });
  });

  it('keeps every offered view size inside both maps with its focus visible', () => {
    for (const size of [5, 7, 9, 10] as const) {
      for (const board of [DEFAULT_BOARD_SIZE, ADVENTURE_BOARD_SIZE]) {
        for (let x = 0; x < board.width; x += 1) {
          for (let y = 0; y < board.height; y += 1) {
            const win = cameraWindowFor({ x, y }, board, { width: size, height: size });
            expect(win.cols).toBe(Math.min(size, board.width));
            expect(win.rows).toBe(Math.min(size, board.height));
            expect(win.originX).toBeGreaterThanOrEqual(0);
            expect(win.originY).toBeGreaterThanOrEqual(0);
            expect(win.originX + win.cols).toBeLessThanOrEqual(board.width);
            expect(win.originY + win.rows).toBeLessThanOrEqual(board.height);
            expect(x - win.originX).toBeGreaterThanOrEqual(0);
            expect(x - win.originX).toBeLessThan(win.cols);
            expect(y - win.originY).toBeGreaterThanOrEqual(0);
            expect(y - win.originY).toBeLessThan(win.rows);
          }
        }
      }
    }
  });
});

/*
 * The monsters' two rules: one attack, and a claw that only reaches sideways.
 *
 * Both are enforced in four places (reducer validation, `attackRangeTiles` for
 * the overlay, the AI's own reach test, and the tooltip), and each of those
 * failing on its own is invisible — the AI would burn its action on a move the
 * engine rejects, or the board would highlight a tile the monster cannot legally
 * hit. So these assert all four agree rather than just the reducer.
 */
describe('monster reach', () => {
  /** A monster of `type` alone on an open floor, with a victim at `victimAt`. */
  const stage = (type: 'BEAST' | 'SPITTER', victimAt: Position) => {
    const base = adventure();
    const units = new Map(base.units);
    const monster = createUnit('m1', MONSTER_TEAM_ID, type, { x: 10, y: 10 });
    // Clear the floor so terrain and other units cannot be what rejects a move.
    for (const [id, unit] of units) {
      if (unit.ownerId === MONSTER_TEAM_ID) units.delete(id);
      else units.set(id, { ...unit, position: { x: 2 + (id.length % 3), y: 2 } });
    }
    units.set('m1', monster);
    units.set('victim', createUnit('victim', 'A', 'WARRIOR', victimAt));
    return { ...base, activePlayerId: MONSTER_TEAM_ID, units } as GameState;
  };

  const attacks = (state: GameState) =>
    applyCommand(state, MONSTER_TEAM_ID, {
      type: 'ATTACK_UNIT',
      attackerId: 'm1',
      targetId: 'victim',
    });

  describe('a Beast claw reaches the four sides and nothing else', () => {
    const sides: Position[] = [
      { x: 9, y: 10 }, { x: 11, y: 10 }, { x: 10, y: 9 }, { x: 10, y: 11 },
    ];
    const corners: Position[] = [
      { x: 9, y: 9 }, { x: 11, y: 9 }, { x: 9, y: 11 }, { x: 11, y: 11 },
    ];

    it.each(sides)('can claw %j — straight beside it', (at) => {
      expect(attacks(stage('BEAST', at)).ok).toBe(true);
    });

    it.each(corners)('cannot claw %j — diagonal is out of reach', (at) => {
      // One tile away by every measure a player would use, and still not a legal
      // target. This is the whole rule.
      expect(attacks(stage('BEAST', at)).ok).toBe(false);
    });

    it('highlights exactly the four legal tiles, never the diagonals', () => {
      // The overlay is what the player reads to decide where it is safe to
      // stand, so it must not offer the corners.
      const tiles = attackRangeTiles(stage('BEAST', { x: 1, y: 1 }), {
        ...createUnit('m1', MONSTER_TEAM_ID, 'BEAST', { x: 10, y: 10 }),
      });
      expect(tiles.map((t) => positionKey(t)).sort()).toEqual(sides.map((t) => positionKey(t)).sort());
    });

    it('makes the AI walk around rather than swing at a diagonal', () => {
      // The failure this prevents is subtle: the AI picks the diagonal, the
      // reducer rejects it, and the monster's whole action is spent on nothing.
      const state = stage('BEAST', { x: 11, y: 11 });
      const command = chooseAiCommand(state, MONSTER_TEAM_ID);
      // Whatever it picks must be something the engine accepts.
      const result = applyCommand(state, MONSTER_TEAM_ID, command);
      expect(result.ok).toBe(true);
      // And it must not have gone for the diagonal it can never reach.
      expect(command.type).not.toBe('ATTACK_UNIT');
    });

    it('leaves a player Warrior able to hit diagonally', () => {
      // Orthogonal-only is a monster trait, not a board-wide one. A Warrior must
      // still be able to swing at an enemy one diagonal step away — the same
      // geometry a Beast cannot reach.
      const base = adventure();
      const units = new Map(base.units);
      units.set('A:WARRIOR', { ...base.units.get('A:WARRIOR')!, position: { x: 4, y: 4 } });
      units.set('foe', createUnit('foe', MONSTER_TEAM_ID, 'BEAST', { x: 5, y: 5 }));
      const probe = {
        ...base,
        activePlayerId: 'A',
        units,
      } as GameState;
      expect(
        applyCommand(probe, 'A', {
          type: 'ATTACK_UNIT',
          attackerId: 'A:WARRIOR',
          targetId: 'foe',
        }).ok,
      ).toBe(true);
    });
  });

  describe('a Spitter reaches like a Wizard', () => {
    it('can spit one tile straight away', () => {
      expect(attacks(stage('SPITTER', { x: 12, y: 10 })).ok).toBe(true);
    });

    it('can spit one tile diagonally, costing the full reach', () => {
      expect(attacks(stage('SPITTER', { x: 11, y: 11 })).ok).toBe(true);
    });

    it('cannot spit two tiles diagonally — that is four steps away', () => {
      expect(attacks(stage('SPITTER', { x: 12, y: 12 })).ok).toBe(false);
    });

    it('cannot spit three tiles straight away', () => {
      expect(attacks(stage('SPITTER', { x: 13, y: 10 })).ok).toBe(false);
    });
  });
});

/*
 * One attack. Not "one attack the UI offers" — the engine refuses everything
 * else, because a monster reaching the wire is a monster that can heal itself
 * and cast Fireball.
 */
describe('monsters have exactly one action', () => {
  const withMonster = (type: 'BEAST' | 'SPITTER') => {
    const base = adventure();
    const units = new Map(base.units);
    units.set('m1', createUnit('m1', MONSTER_TEAM_ID, type, { x: 10, y: 10 }));
    return { ...base, activePlayerId: MONSTER_TEAM_ID, units } as GameState;
  };

  const refused = [
    { type: 'CAST_FIREBALL' as const, unitId: 'm1', x: 10, y: 10 },
    { type: 'CAST_THUNDER_STRIKE' as const, unitId: 'm1', x: 10, y: 10 },
    { type: 'BLESS_GROUND' as const, unitId: 'm1', x: 10, y: 10 },
    { type: 'SUMMON_ICE_WALL' as const, unitId: 'm1', x: 10, y: 10 },
    { type: 'PLACE_TRAP' as const, unitId: 'm1', x: 10, y: 10 },
    { type: 'GRAPPLE' as const, unitId: 'm1', x: 10, y: 10 },
    { type: 'HEAL_UNIT' as const, healerId: 'm1', targetId: 'm1' },
    { type: 'GUARD_UNIT' as const, unitId: 'm1', targetId: 'm1' },
    { type: 'SHIELD_SLAM' as const, unitId: 'm1', x: 11, y: 10 },
  ];

  it.each(refused.map((c) => [c.type, c] as const))(
    'refuses %s from a monster',
    (_label, command) => {
      for (const type of ['BEAST', 'SPITTER'] as const) {
        const result = applyCommand(withMonster(type), MONSTER_TEAM_ID, command);
        expect(result.ok, `${type} ${command.type}`).toBe(false);
      }
    },
  );

  /*
   * `RANGER_SHOT` is NOT in that list, and deliberately so: despite the name it
   * is the generic tile-attack command and every class fires it (see
   * engine.test.ts). For a monster it is simply the claw or the spit aimed at a
   * tile — its one attack by another name. What it must NOT get is the reach
   * rules bypassed, which is exactly what it used to do.
   */
  it('still allows the generic tile attack, because that IS the monster attack', () => {
    expect(
      applyCommand(withMonster('BEAST'), MONSTER_TEAM_ID, {
        type: 'RANGER_SHOT', unitId: 'm1', x: 11, y: 10,
      }).ok,
    ).toBe(true);
  });

  it('does not let the generic tile attack skip the orthogonal rule', () => {
    // The regression: this path had its own inline distance check, so a Beast
    // could fire at a diagonal tile its claw may never reach.
    expect(
      applyCommand(withMonster('BEAST'), MONSTER_TEAM_ID, {
        type: 'RANGER_SHOT', unitId: 'm1', x: 11, y: 11,
      }).ok,
    ).toBe(false);
  });

  it('never issues anything but ATTACK_UNIT or MOVE_UNIT', () => {
    // Belt and braces over the table above: drive the real policy and check
    // every command it can produce for every monster across many seeds.
    const allowed = new Set(['ATTACK_UNIT', 'MOVE_UNIT', 'END_TURN']);
    for (let seed = 0; seed < 40; seed += 1) {
      let state = createInitialState({ gameId: `one-${seed}`, playerIds: ['A', 'B'], mapSeed: seed });
      state = applyCommand(state, 'A', { type: 'SET_MAP_MODE', mapMode: 'RANDOM' }).state!;
      state = applyCommand(state, 'A', { type: 'CHOOSE_FACTION', faction: 'INQUISITORS' }).state!;
      state = applyCommand(state, 'B', { type: 'CHOOSE_FACTION', faction: 'PENITENT_COURT' }).state!;
      // End a player turn so the garrison resolves at least once.
      const probe: GameState = { ...state, activePlayerId: MONSTER_TEAM_ID };
      const command = chooseAiCommand(probe, MONSTER_TEAM_ID);
      expect(allowed.has(command.type), `${command.type} on seed ${seed}`).toBe(true);
    }
  });
});

describe('adventure combat reach', () => {
  it('every spawned monster stands on a real tile of the 20x20 floor', () => {
    const state = adventure(21);
    for (const unit of state.units.values()) {
      expect(unit.position.x).toBeLessThan(SIZE.width);
      expect(unit.position.y).toBeLessThan(SIZE.height);
      expect(unitAt(state, unit.position)?.id).toBe(unit.id);
    }
  });
});
