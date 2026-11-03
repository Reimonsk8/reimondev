import { describe, expect, it } from 'vitest';
import {
  ISO_TILE_HEIGHT,
  ISO_TILE_WIDTH,
  angleDelta,
  clamp,
  distance,
  normalize,
  screenDirectionToWorld,
  screenToWorld,
  smoothFollow,
  tileToWorld,
  worldToScreen,
  worldToTile,
} from './isometric';

describe('isometric projection', () => {
  it('maps a 2:1 tile diamond', () => {
    expect(worldToScreen(0, 0)).toEqual({ x: 0, y: 0 });
    expect(worldToScreen(1, 0)).toEqual({ x: ISO_TILE_WIDTH / 2, y: ISO_TILE_HEIGHT / 2 });
    expect(worldToScreen(0, 1)).toEqual({ x: -ISO_TILE_WIDTH / 2, y: ISO_TILE_HEIGHT / 2 });
    expect(worldToScreen(1, 1)).toEqual({ x: 0, y: ISO_TILE_HEIGHT });
  });

  it('round-trips world positions through screen space', () => {
    for (const [x, y] of [[0, 0], [12.5, 3.25], [-4, 9], [40, 40]] as const) {
      const screen = worldToScreen(x, y);
      const back = screenToWorld(screen.x, screen.y);
      expect(back.x).toBeCloseTo(x, 10);
      expect(back.y).toBeCloseTo(y, 10);
    }
  });

  it('converts tile indices to tile centres and back', () => {
    expect(tileToWorld(3, 4)).toEqual({ x: 3.5, y: 4.5 });
    expect(worldToTile(3.9, 4.1)).toEqual({ x: 3, y: 4 });
    expect(worldToTile(3, 4)).toEqual({ x: 3, y: 4 });
  });

  it('turns screen-relative WASD into the diagonal world directions', () => {
    const up = screenDirectionToWorld(0, -1);
    expect(up.x).toBeCloseTo(-Math.SQRT1_2, 10);
    expect(up.y).toBeCloseTo(-Math.SQRT1_2, 10);

    const right = screenDirectionToWorld(1, 0);
    expect(right.x).toBeCloseTo(Math.SQRT1_2, 10);
    expect(right.y).toBeCloseTo(-Math.SQRT1_2, 10);
  });

  it('keeps vector helpers safe at zero length', () => {
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(clamp(12, 0, 10)).toBe(10);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('wraps angle deltas to the shortest arc', () => {
    expect(angleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2, 10);
    expect(angleDelta(Math.PI * 2 - 0.1, 0.1)).toBeCloseTo(0.2, 10);
  });

  it('eases the camera toward its target', () => {
    const next = smoothFollow({ x: 0, y: 0 }, { x: 100, y: 50 }, 0.16, 9);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(100);
    expect(next.y).toBeGreaterThan(0);
  });
});
