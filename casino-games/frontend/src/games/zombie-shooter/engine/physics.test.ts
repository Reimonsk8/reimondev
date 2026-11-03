import { describe, expect, it } from 'vitest';
import { applyKnockback, stepKnockback } from './physics';

describe('knockback physics', () => {
  it('safely initializes missing impulse fields from an old network snapshot', () => {
    const target = {
      x: 4,
      y: 7,
      radius: 0.4,
    } as Parameters<typeof stepKnockback>[0];

    const moved = stepKnockback(
      target,
      1 / 60,
      (x, y, dx, dy) => ({ x: x + dx, y: y + dy }),
      (x, y) => ({ x, y }),
    );

    expect(moved).toEqual({ x: 0, y: 0 });
    expect(target.x).toBe(4);
    expect(target.y).toBe(7);
  });

  it('applies and decays an impulse, then clears the velocity at the end of stagger', () => {
    const target = {
      x: 2,
      y: 3,
      radius: 0.4,
      knockbackVx: 0,
      knockbackVy: 0,
      knockbackTimer: 0,
    } as Parameters<typeof applyKnockback>[0];
    applyKnockback(target, 1, 3, 8, { staggerDuration: 0.05 });

    stepKnockback(target, 0.1, (x, y, dx, dy) => ({ x: x + dx, y: y + dy }), (x, y) => ({ x, y }));
    expect(target.x).toBeGreaterThan(2);
    expect(target.knockbackVx).toBe(0);
    expect(target.knockbackTimer).toBe(0);
  });
});
