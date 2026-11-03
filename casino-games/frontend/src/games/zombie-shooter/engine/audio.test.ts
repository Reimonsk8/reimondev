import { describe, expect, it } from 'vitest';
import { computeSpatialAttenuation, SPATIAL_MAX_DISTANCE } from './audio';

describe('Outlands spatial audio mix', () => {
  it('attenuates distant sources and pans them to the correct side', () => {
    const listener = { x: 10, y: 10 };
    const left = computeSpatialAttenuation(listener, { x: 8, y: 10 });
    const right = computeSpatialAttenuation(listener, { x: 10, y: 8 });
    const far = computeSpatialAttenuation(listener, { x: 10 + SPATIAL_MAX_DISTANCE, y: 10 });

    expect(left.gain).toBeGreaterThan(0);
    expect(left.pan).toBeLessThan(0);
    expect(right.pan).toBeGreaterThan(0);
    expect(far.gain).toBe(0);
    expect(far.pan).toBe(0);
  });
});
