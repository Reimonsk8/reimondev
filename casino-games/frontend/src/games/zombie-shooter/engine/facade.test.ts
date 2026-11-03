import { describe, expect, it } from 'vitest';
import { facadeNoise, hashId, shade, FACADE_MATERIALS } from './facade';

describe('facade helpers', () => {
  it('facadeNoise is deterministic and in [0,1)', () => {
    for (let i = 0; i < 100; i += 1) {
      const a = facadeNoise(42, i);
      const b = facadeNoise(42, i);
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('hashId is deterministic', () => {
    expect(hashId('ruin-1')).toBe(hashId('ruin-1'));
    expect(hashId('ruin-1')).not.toBe(hashId('ruin-2'));
  });

  it('shade scales rgb channels', () => {
    const c = shade(0x333333, 2);
    expect(c).toBeGreaterThan(0x333333);
  });

  it('FACADE_MATERIALS has 3 entries', () => {
    expect(FACADE_MATERIALS.length).toBe(3);
  });
});
