import { describe, expect, it } from 'vitest';
import { splitEventBeats } from './enemyPacing';
import type { GameEvent } from './engine';

const moved = (unitId: string): GameEvent => ({
  type: 'UNIT_MOVED',
  unitId,
  from: { x: 0, y: 0 },
  to: { x: 1, y: 0 },
});

const attacked = (attackerId: string, targetId: string): GameEvent => ({
  type: 'UNIT_ATTACKED',
  attackerId,
  targetId,
  damage: 2,
  defeated: [],
});

const hit = (sourceId: string, targetId: string): GameEvent => ({
  type: 'SPELL_HIT',
  unitId: targetId,
  sourceId,
  targetId,
  damage: 3,
});

const defeated = (unitId: string): GameEvent => ({ type: 'UNIT_DEFEATED', unitId });

describe('splitEventBeats', () => {
  it('keeps one unit action together, including what it caused', () => {
    const beats = splitEventBeats(
      [moved('m1'), attacked('m1', 'A:WARRIOR'), hit('m1', 'A:WARRIOR'), defeated('A:WARRIOR')],
      'A',
    );
    expect(beats).toHaveLength(1);
    expect(beats[0]).toHaveLength(4);
  });

  it('starts a new beat when a different enemy acts', () => {
    const beats = splitEventBeats(
      [moved('m1'), attacked('m1', 'A:WARRIOR'), moved('m2'), attacked('m2', 'B:WARRIOR')],
      'A',
    );
    expect(beats.map((beat) => beat.length)).toEqual([2, 2]);
    expect(beats[1][0]).toMatchObject({ unitId: 'm2' });
  });

  it('does not split on the viewer acting in the same batch', () => {
    const beats = splitEventBeats([attacked('A:WARRIOR', 'm1'), defeated('m1')], 'A');
    expect(beats).toHaveLength(1);
  });

  it('never splits on a unit that does not exist on the board', () => {
    // A guard whose shield absorbs a hit is not acting; only the melee blow is.
    const beats = splitEventBeats(
      [
        {
          type: 'GUARD_ABSORBED',
          guardianId: 'A:WARRIOR',
          targetId: 'B:WARRIOR',
          damage: 4,
        },
        attacked('m1', 'A:WARRIOR'),
      ],
      'A',
    );
    expect(beats).toHaveLength(1);
  });

  it('returns a single beat for an empty batch', () => {
    expect(splitEventBeats([], 'A')).toEqual([[]]);
  });
});
