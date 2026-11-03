import { describe, expect, it } from 'vitest';
import { createInitialState, createUnit } from './engine';
import { emptyBattleStats, tallyBattleStats } from './battleStats';

describe('Square of Shadows end-match stats', () => {
  it('counts actual hit targets, damage sources, squad healing, defeats, and casts', () => {
    const state = createInitialState({ gameId: 'stats', playerIds: ['P1', 'P2'] });
    state.units.set('hero', createUnit('hero', 'P1', 'WIZARD', { x: 1, y: 1 }));
    state.units.set('ally', createUnit('ally', 'P1', 'CLERIC', { x: 2, y: 1 }));
    state.units.set('foe', createUnit('foe', 'P2', 'RANGER', { x: 4, y: 1 }));

    const initial = { ...emptyBattleStats(), damageDealt: 2 };
    const result = tallyBattleStats(
      initial,
      [
        {
          type: 'UNIT_ATTACKED',
          attackerId: 'hero',
          targetId: 'foe',
          damage: 4,
          defeated: [],
          // Actual hit list includes friendly-fire damage and an AoE victim.
          hits: [
            { targetId: 'foe', damage: 4 },
            { targetId: 'ally', damage: 2 },
          ],
        },
        { type: 'SPELL_CAST', unitId: 'hero', ability: 'FIREBALL', x: 4, y: 1 },
        { type: 'SPELL_HIT', unitId: 'foe', sourceId: 'hero', targetId: 'foe', damage: 3 },
        { type: 'UNIT_HEALED', healerId: 'hero', targetId: 'ally', restored: 4 },
        {
          type: 'ZONE_TICK',
          zoneId: 'zone',
          ownerId: 'P2',
          healed: [
            { unitId: 'ally', amount: 2 },
            { unitId: 'foe', amount: 3 },
          ],
          burned: [],
        },
        { type: 'UNIT_DEFEATED', unitId: 'foe' },
        { type: 'UNIT_DEFEATED', unitId: 'ally' },
        { type: 'ALTAR_WISH', unitId: 'hero', wish: 'RESURRECT', souls: 2, resurrectedId: 'ally' },
        // The rival's wish is not the player's tally.
        { type: 'ALTAR_WISH', unitId: 'foe', wish: 'RESTORE', souls: 1, restored: 5 },
      ],
      state,
      'P1',
    );

    expect(result).toMatchObject({
      damageDealt: 11,
      damageTaken: 2,
      kills: 1,
      losses: 1,
      healed: 6,
      abilities: 1,
      soulsSpent: 1,
    });
    expect(initial.damageDealt).toBe(2);
  });

  it('keeps reading legacy hit events and single-target attack events', () => {
    const state = createInitialState({ gameId: 'legacy-stats', playerIds: ['P1', 'P2'] });
    state.units.set('hero', createUnit('hero', 'P1', 'WIZARD', { x: 1, y: 1 }));
    state.units.set('foe', createUnit('foe', 'P2', 'RANGER', { x: 4, y: 1 }));

    const result = tallyBattleStats(emptyBattleStats(), [
      { type: 'SPELL_CAST', unitId: 'hero', ability: 'FIREBALL', x: 4, y: 1 },
      { type: 'SPELL_HIT', unitId: 'foe', targetId: 'foe', damage: 5 },
      { type: 'UNIT_ATTACKED', attackerId: 'foe', targetId: 'hero', damage: 3, defeated: [] },
    ], state, 'P1');

    expect(result.damageDealt).toBe(5);
    expect(result.damageTaken).toBe(3);
  });
});
