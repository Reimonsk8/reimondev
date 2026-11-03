import { describe, expect, it } from 'vitest';
import { ASPHALT_NOISE_SHADES } from './ground';
import { surfaceAt } from './world';

describe('ground helpers', () => {
  it('uses the documented noise formula', () => {
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const noise = (((x * 37 + y * 17) % 5) + 5) % 5;
        expect(noise).toBeGreaterThanOrEqual(0);
        expect(noise).toBeLessThan(5);
        expect(ASPHALT_NOISE_SHADES[noise]).toBeDefined();
      }
    }
  });

  it('surfaceAt classifies road/sidewalk/lot by chunk edge', () => {
    expect(surfaceAt(0.5, 0.5)).toBe('road');
    expect(surfaceAt(1.5, 1.5)).toBe('sidewalk');
    expect(surfaceAt(2.5, 2.5)).toBe('lot');
    expect(surfaceAt(12.5, 12.5)).toBe('sidewalk');
    expect(surfaceAt(14.5, 14.5)).toBe('road');
  });
});
