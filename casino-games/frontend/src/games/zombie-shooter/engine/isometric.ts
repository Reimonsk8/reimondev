import type { Vec2 } from './types';

/**
 * 45-degree isometric projection.
 *
 * World space is measured in tiles. One tile is a 2:1 diamond on screen, so the
 * 32x32 source art recommended by plan.md occupies a 64x32 screen footprint.
 * `worldToScreen` returns the TOP corner of the tile at that world coordinate;
 * the tile centre is therefore `worldToScreen(x + 0.5, y + 0.5)`.
 */
export const ISO_TILE_WIDTH = 64;
export const ISO_TILE_HEIGHT = 32;

export function worldToScreen(
  x: number,
  y: number,
  tileWidth: number = ISO_TILE_WIDTH,
  tileHeight: number = ISO_TILE_HEIGHT,
): Vec2 {
  return {
    x: (x - y) * (tileWidth / 2),
    y: (x + y) * (tileHeight / 2),
  };
}

/** Inverse of `worldToScreen`. Also valid for screen deltas. */
export function screenToWorld(
  screenX: number,
  screenY: number,
  tileWidth: number = ISO_TILE_WIDTH,
  tileHeight: number = ISO_TILE_HEIGHT,
): Vec2 {
  return {
    x: screenY / tileHeight + screenX / tileWidth,
    y: screenY / tileHeight - screenX / tileWidth,
  };
}

/** Tile indices to the centre of that tile in world space. */
export function tileToWorld(tileX: number, tileY: number): Vec2 {
  return { x: tileX + 0.5, y: tileY + 0.5 };
}

/** World position to the tile index containing it. */
export function worldToTile(x: number, y: number): { x: number; y: number } {
  return { x: Math.floor(x), y: Math.floor(y) };
}

/**
 * Convert a screen-space direction (e.g. WASD in the view plane) into a
 * normalised world-space direction. Using the inverse projection means "W"
 * moves up-screen rather than straight along the world X axis.
 */
export function screenDirectionToWorld(
  screenX: number,
  screenY: number,
  tileWidth: number = ISO_TILE_WIDTH,
  tileHeight: number = ISO_TILE_HEIGHT,
): Vec2 {
  return normalize(screenToWorld(screenX, screenY, tileWidth, tileHeight));
}

/** Painter's-algorithm depth: further-down-screen entities draw on top. */
export function depthFor(x: number, y: number): number {
  return worldToScreen(x, y).y;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function normalize(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.y);
  if (length < 1e-6) return { x: 0, y: 0 };
  return { x: v.x / length, y: v.y / length };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Cubic ease used by the camera follow, kept here so it is testable. */
export function smoothFollow(current: Vec2, target: Vec2, dt: number, speed = 9): Vec2 {
  const t = 1 - Math.exp(-speed * dt);
  return { x: lerp(current.x, target.x, t), y: lerp(current.y, target.y, t) };
}

/** Shortest signed angle from `from` to `to`, in radians. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function rotateToward(from: number, to: number, maxStep: number): number {
  const delta = angleDelta(from, to);
  return from + clamp(delta, -maxStep, maxStep);
}
