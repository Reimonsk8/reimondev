import { describe, expect, it } from 'vitest';
import { attackLinkFor } from './attackLink';

describe('attackLinkFor', () => {
  it('gives an arrow to the Ranger and nothing like one to anyone else', () => {
    expect(attackLinkFor('RANGER')).toBe('arrow');
    expect(attackLinkFor('WIZARD')).not.toBe('arrow');
    expect(attackLinkFor('WARRIOR')).not.toBe('arrow');
    expect(attackLinkFor('CLERIC')).not.toBe('arrow');
  });

  it('maps every class to its own travelling sprite', () => {
    expect(attackLinkFor('WIZARD')).toBe('firebolt');
    expect(attackLinkFor('WARRIOR')).toBe('slash');
    expect(attackLinkFor('CLERIC')).toBe('slash');
  });

  it('falls back to no projectile for an unknown or missing class', () => {
    // A projectile drawn from a stale/missing unit would be a wrong-class
    // sprite, so returning null makes the caller lunge with nothing attached.
    expect(attackLinkFor(undefined)).toBeNull();
    expect(attackLinkFor('')).toBeNull();
    expect(attackLinkFor('DRAGON')).toBeNull();
  });

  it('is total: every class the game can field resolves to a sprite', () => {
    for (const type of ['RANGER', 'WIZARD', 'WARRIOR', 'CLERIC', 'BEAST', 'SPITTER']) {
      expect(attackLinkFor(type)).not.toBeNull();
    }
  });

  it('gives the monsters a claw and a bolt, never each other', () => {
    // The claw is a melee slash and the spit flies, because the Spitter's reach
    // is 2 and the Beast's is 1. Swapping them reads as a monster shooting a
    // sword, or a lizard spitting from its own mouth at melee range.
    expect(attackLinkFor('BEAST')).toBe('slash');
    expect(attackLinkFor('SPITTER')).toBe('acidbolt');
    expect(attackLinkFor('SPITTER')).not.toBe('arrow');
    expect(attackLinkFor('BEAST')).not.toBe('acidbolt');
  });
});