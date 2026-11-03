import * as PIXI from 'pixi.js';
import type { Vec2 } from './types';
import { surfaceAt } from './world';

/**
 * Desaturated dark asphalt (#0d1117 base) noise shades indexed by:
 * `const noise = (x * 37 + y * 17) % 5;`
 */
export const ASPHALT_NOISE_SHADES: readonly [number, number, number, number, number] = [
  0x0d1117, // #0d1117
  0x0e131a,
  0x0b0f14,
  0x10151d,
  0x0c1016,
];

export const SIDEWALK_SHADES = [0x1d232a, 0x1f252c, 0x1b2127, 0x20262d, 0x1c2228] as const;
export const LOT_SHADES = [0x17161a, 0x191816, 0x151417, 0x1a1917, 0x161719] as const;
export const SAFE_LOT_SHADES = [0x111814, 0x131a15, 0x101612, 0x141b16, 0x121713] as const;

/**
 * Procedural isometric ground tile painter. Surface type (road/sidewalk/lot) is derived
 * from tile coordinates via `surfaceAt`, so the whole grid blends without harsh borders.
 */
export function paintProceduralAsphaltTile(
  g: PIXI.Graphics,
  x: number,
  y: number,
  center: Vec2,
  halfW: number,
  halfH: number,
  inSafeZone: boolean,
): void {
  const noise = (((x * 37 + y * 17) % 5) + 5) % 5;
  const surface = surfaceAt(x + 0.5, y + 0.5);
  const fill =
    surface === 'road'
      ? ASPHALT_NOISE_SHADES[noise]
      : surface === 'sidewalk'
        ? SIDEWALK_SHADES[noise]
        : (inSafeZone ? SAFE_LOT_SHADES : LOT_SHADES)[noise];

  g.lineStyle(0);
  g.beginFill(fill, 1);
  g.drawPolygon([
    center.x,
    center.y - halfH,
    center.x + halfW,
    center.y,
    center.x,
    center.y + halfH,
    center.x - halfW,
    center.y,
  ]);
  g.endFill();

  const detailHash = Math.abs((x * 73856093) ^ (y * 19349663));
  if (surface === 'road' && (noise === 1 || detailHash % 7 === 0)) {
    const ox = ((detailHash >> 3) % 9) - 4;
    const oy = ((detailHash >> 7) % 5) - 2;
    g.beginFill(0x07090d, 0.55);
    g.drawEllipse(center.x + ox, center.y + oy, 5 + (noise % 3), 2.5 + (noise % 2));
    g.endFill();
  }

  if (noise === 2 || noise === 4) {
    const cx = center.x + (((detailHash >> 5) % 11) - 5);
    const cy = center.y + (((detailHash >> 9) % 5) - 2);
    g.lineStyle(1, 0x080a0e, 0.62);
    g.moveTo(cx - 5, cy - 2);
    g.lineTo(cx + 1, cy + 1);
    g.lineTo(cx + 6, cy - 1);
    g.lineStyle(0);
  }

  const gx = center.x + ((x * 13 + y * 7) % 9) - 4;
  const gy = center.y + ((x * 5 + y * 11) % 5) - 2;
  g.beginFill(noise % 2 === 0 ? 0x161c24 : 0x090c10, 0.65);
  g.drawRect(gx, gy, 1.5, 1.5);
  g.endFill();

  const top = { x: center.x, y: center.y - halfH };
  const right = { x: center.x + halfW, y: center.y };
  const bottom = { x: center.x, y: center.y + halfH };
  const left = { x: center.x - halfW, y: center.y };
  const edge = (a: Vec2, b: Vec2, from = 0, to = 1) => {
    g.moveTo(a.x + (b.x - a.x) * from, a.y + (b.y - a.y) * from);
    g.lineTo(a.x + (b.x - a.x) * to, a.y + (b.y - a.y) * to);
  };
  const lx = ((x % 14) + 14) % 14;
  const ly = ((y % 14) + 14) % 14;

  if (surface === 'road') {
    g.lineStyle(1.2, 0x8f7d3c, 0.42);
    if (lx === 0 && ly > 0 && ly < 13) edge(top, left, 0.25, 0.75);
    if (ly === 0 && lx > 0 && lx < 13) edge(top, right, 0.25, 0.75);
    g.lineStyle(0);
  } else if (surface === 'sidewalk') {
    g.lineStyle(1, 0x12161b, 0.55);
    edge(top, right);
    edge(top, left);
    g.lineStyle(1.5, 0x3a424c, 0.9);
    if (lx === 1) edge(top, left);
    if (lx === 12) edge(right, bottom);
    if (ly === 1) edge(top, right);
    if (ly === 12) edge(left, bottom);
    g.lineStyle(0);
  }
}