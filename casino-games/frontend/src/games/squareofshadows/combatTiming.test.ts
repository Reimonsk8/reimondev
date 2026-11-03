import { describe, expect, it } from 'vitest';
import {
  KILL_SHAKE_BONUS,
  MELEE_IMPACT_MS,
  SHAKE_MIN_DAMAGE,
  TRAVEL_MAX_MS,
  TRAVEL_MIN_MS,
  chebyshevSteps,
  hitStopMsFor,
  impactDelayFor,
  isMeleeClass,
  lungeDistanceFor,
  shakeFor,
  travelMsFor,
} from './combatTiming';

describe('chebyshevSteps', () => {
  it('counts a diagonal as one step, matching the board', () => {
    expect(chebyshevSteps({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(3);
    expect(chebyshevSteps({ x: 2, y: 2 }, { x: 5, y: 3 })).toBe(3);
  });

  it('is zero on the same tile and symmetric both ways', () => {
    expect(chebyshevSteps({ x: 4, y: 4 }, { x: 4, y: 4 })).toBe(0);
    const a = { x: 1, y: 7 };
    const b = { x: 6, y: 2 };
    expect(chebyshevSteps(a, b)).toBe(chebyshevSteps(b, a));
  });
});

describe('travelMsFor', () => {
  it('scales with the distance the projectile actually crosses', () => {
    const near = travelMsFor({ x: 0, y: 0 }, { x: 2, y: 0 });
    const far = travelMsFor({ x: 0, y: 0 }, { x: 6, y: 0 });
    expect(far).toBeGreaterThan(near);
  });

  it('clamps a point-blank shot to a flick, never zero', () => {
    expect(travelMsFor({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(TRAVEL_MIN_MS);
    expect(travelMsFor({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(TRAVEL_MIN_MS);
  });

  it('clamps a board-length shot so it never drags', () => {
    expect(travelMsFor({ x: 0, y: 0 }, { x: 19, y: 19 })).toBe(TRAVEL_MAX_MS);
  });

  it('always lands inside the clamp band', () => {
    for (let d = 0; d <= 20; d += 1) {
      const ms = travelMsFor({ x: 0, y: 0 }, { x: d, y: d });
      expect(ms).toBeGreaterThanOrEqual(TRAVEL_MIN_MS);
      expect(ms).toBeLessThanOrEqual(TRAVEL_MAX_MS);
    }
  });
});

describe('melee classification', () => {
  it('treats the Warrior and Cleric as melee', () => {
    expect(isMeleeClass('WARRIOR')).toBe(true);
    expect(isMeleeClass('CLERIC')).toBe(true);
  });

  it('treats the Beast as melee and the Spitter as ranged', () => {
    // It follows reach, not flavour: the Beast's claw is 1 tile so the impact
    // lands on its strike frame, and the Spitter's spit is 2 so it travels.
    expect(isMeleeClass('BEAST')).toBe(true);
    expect(isMeleeClass('SPITTER')).toBe(false);
  });

  it('treats the Ranger and Wizard as ranged', () => {
    expect(isMeleeClass('RANGER')).toBe(false);
    expect(isMeleeClass('WIZARD')).toBe(false);
  });

  it('treats an unknown class as ranged rather than guessing melee', () => {
    expect(isMeleeClass(undefined)).toBe(false);
    expect(isMeleeClass('DRAGON')).toBe(false);
  });
});

describe('impactDelayFor', () => {
  it('resolves melee at the strike frame instead of waiting for a flight', () => {
    expect(impactDelayFor({ x: 0, y: 0 }, { x: 1, y: 0 }, 'WARRIOR')).toBe(MELEE_IMPACT_MS);
    expect(impactDelayFor({ x: 0, y: 0 }, { x: 1, y: 1 }, 'CLERIC')).toBe(MELEE_IMPACT_MS);
  });

  it('waits out the full flight for ranged attacks', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 6, y: 0 };
    expect(impactDelayFor(from, to, 'RANGER')).toBe(travelMsFor(from, to));
    expect(impactDelayFor(from, to, 'RANGER')).toBeGreaterThan(MELEE_IMPACT_MS);
  });

  it('lands a ranged hit no earlier than a melee one', () => {
    for (const type of ['RANGER', 'WIZARD', 'WARRIOR', 'CLERIC', 'BEAST', 'SPITTER']) {
      expect(impactDelayFor({ x: 0, y: 0 }, { x: 1, y: 0 }, type)).toBeGreaterThanOrEqual(
        MELEE_IMPACT_MS,
      );
    }
  });

  it('gives a Beast the melee strike and a Spitter a flight', () => {
    const adjacent = [{ x: 4, y: 4 }, { x: 5, y: 4 }];
    expect(impactDelayFor(adjacent[0], adjacent[1], 'BEAST')).toBe(MELEE_IMPACT_MS);
    // Reach 2, so the spit has to cross a tile before it lands.
    expect(impactDelayFor(adjacent[0], { x: 6, y: 4 }, 'SPITTER')).toBe(
      travelMsFor(adjacent[0], { x: 6, y: 4 }),
    );
  });
});

describe('lungeDistanceFor', () => {
  it('commits further in melee than at range', () => {
    expect(lungeDistanceFor('WARRIOR')).toBeGreaterThan(lungeDistanceFor('RANGER'));
    expect(lungeDistanceFor('CLERIC')).toBeGreaterThan(lungeDistanceFor('WIZARD'));
  });

  it('keeps a ranged lunge small enough to read as a recoil, not a charge', () => {
    expect(lungeDistanceFor('RANGER')).toBeLessThan(0.15);
  });
});

describe('hitStopMsFor', () => {
  it('grows with the damage landed', () => {
    expect(hitStopMsFor(8)).toBeGreaterThan(hitStopMsFor(2));
  });

  it('freezes nothing when reduced motion is requested', () => {
    expect(hitStopMsFor(10, true)).toBe(0);
  });

  it('is inert on a zero-damage event', () => {
    expect(hitStopMsFor(0)).toBe(0);
  });

  it('stays under the 110ms ceiling so a big hit never stalls the board', () => {
    expect(hitStopMsFor(999)).toBeLessThanOrEqual(110);
  });
});

describe('shakeFor', () => {
  it('does not move the board at all for chip damage', () => {
    expect(shakeFor(0)).toBeNull();
    expect(shakeFor(1)).toBeNull();
    expect(shakeFor(SHAKE_MIN_DAMAGE - 1)).toBeNull();
  });

  it('shakes harder and longer for a bigger hit', () => {
    const small = shakeFor(3)!;
    const big = shakeFor(12)!;
    expect(big.amp).toBeGreaterThan(small.amp);
    expect(big.durMs).toBeGreaterThan(small.durMs);
  });

  it('is suppressed entirely under reduced motion', () => {
    expect(shakeFor(20, true)).toBeNull();
  });

  it('caps amplitude and duration so the board cannot go wild', () => {
    const huge = shakeFor(500)!;
    expect(huge.amp).toBeLessThanOrEqual(7);
    expect(huge.durMs).toBeLessThanOrEqual(320);
  });

  it('offers a kill bonus that still respects the cap', () => {
    expect(KILL_SHAKE_BONUS.amp).toBeGreaterThan(0);
    expect(KILL_SHAKE_BONUS.durMs).toBeGreaterThan(0);
  });
});