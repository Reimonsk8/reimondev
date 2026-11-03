import { describe, expect, it } from 'vitest';
import { IMPACT_FOR_ABILITY, impactKindForAbility } from './highlight';

describe('Square of Shadows highlight vocabulary', () => {
  it('classifies every tile-targeted ability by effect family', () => {
    expect(IMPACT_FOR_ABILITY.FIREBALL).toBe('damage');
    expect(IMPACT_FOR_ABILITY.THUNDER_STRIKE).toBe('damage');
    expect(IMPACT_FOR_ABILITY.SHIELD_SLAM).toBe('damage');
    expect(IMPACT_FOR_ABILITY.BLESS_GROUND).toBe('boon');
    expect(IMPACT_FOR_ABILITY.ICE_WALL).toBe('control');
    expect(IMPACT_FOR_ABILITY.TRAP).toBe('control');
    expect(IMPACT_FOR_ABILITY.GRAPPLE).toBe('utility');
  });

  it('never falls back to the damage wash for a non-damaging spell', () => {
    expect(impactKindForAbility('BLESS_GROUND')).not.toBe('damage');
    expect(impactKindForAbility('ICE_WALL')).not.toBe('damage');
    expect(impactKindForAbility('TRAP')).not.toBe('damage');
    expect(impactKindForAbility('GRAPPLE')).not.toBe('damage');
  });
});
