import * as PIXI from 'pixi.js';
import { ISO_TILE_HEIGHT, ISO_TILE_WIDTH } from './isometric';
import { BUILDING_DOOR_WIDTH_WORLD } from './doorGeometry';
import type { Vec2 } from './types';

export function facadeNoise(seed: number, i: number): number {
  let h = Math.imul(seed ^ Math.imul(i + 1, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function shade(color: number, k: number): number {
  const ch = (shift: number) => Math.min(255, Math.round(((color >> shift) & 255) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export const FACADE_MATERIALS: ReadonlyArray<readonly [number, number]> = [
  [0x3d2a25, 0x1a1311],
  [0x2e343c, 0x15181c],
  [0x3a3327, 0x19160f],
];

export function paintBrickFace(
  g: PIXI.Graphics,
  a: Vec2,
  b: Vec2,
  h: number,
  wall: number,
  mortar: number,
  seed: number,
): (u: number, v: number) => Vec2 {
  const P = (u: number, v: number): Vec2 => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u - v });
  const quad = (u0: number, v0: number, u1: number, v1: number, color: number, alpha: number) => {
    const p = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
    g.beginFill(color, alpha);
    g.drawPolygon(p.flatMap((q) => [q.x, q.y]));
    g.endFill();
  };
  quad(0, 0, 1, h, wall, 1);

  const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  const course = 5;
  const brick = 10;
  const rows = Math.floor(h / course);
  const cols = Math.ceil(len / brick) + 1;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const n = facadeNoise(seed, r * 131 + c);
      if (n > 0.24) continue;
      const u0 = Math.max(0, (c * brick - (r % 2) * brick * 0.5) / len);
      const u1 = Math.min(1, u0 + brick / len);
      if (u1 > u0) quad(u0, r * course, u1, (r + 1) * course, n < 0.12 ? shade(wall, 1.22) : shade(wall, 0.78), 0.7);
    }
  }
  g.lineStyle(1, mortar, 0.6);
  for (let r = 1; r < rows; r += 1) {
    const p0 = P(0, r * course);
    const p1 = P(1, r * course);
    g.moveTo(p0.x, p0.y);
    g.lineTo(p1.x, p1.y);
    for (let c = 0; c < cols; c += 1) {
      const u = (c * brick - (r % 2) * brick * 0.5) / len;
      if (u <= 0 || u >= 1) continue;
      const j0 = P(u, r * course);
      const j1 = P(u, (r + 1) * course);
      g.moveTo(j0.x, j0.y);
      g.lineTo(j1.x, j1.y);
    }
  }
  g.lineStyle(0);
  quad(0, 0, 1, 6, 0x050608, 0.35);
  quad(0, h - 7, 1, h, 0x050608, 0.28);
  return P;
}

export function paintRuinFace(
  g: PIXI.Graphics,
  a: Vec2,
  b: Vec2,
  h: number,
  material: readonly [number, number],
  light: number,
  seed: number,
  doorAt: number | null,
  doorOpen: boolean,
  doorBarricaded = false,
): void {
  const [wall, mortar] = material;
  const P = paintBrickFace(g, a, b, h, shade(wall, light), mortar, seed);
  const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  const poly = (pts: Vec2[], color: number, alpha: number) => {
    g.beginFill(color, alpha);
    g.drawPolygon(pts.flatMap((q) => [q.x, q.y]));
    g.endFill();
  };
  const line = (p0: Vec2, p1: Vec2, width: number, color: number, alpha: number) => {
    g.lineStyle(width, color, alpha);
    g.moveTo(p0.x, p0.y);
    g.lineTo(p1.x, p1.y);
    g.lineStyle(0);
  };

  const windows = Math.max(1, Math.floor(len / 30));
  const halfW = 4.5 / len;
  for (let i = 0; i < windows; i += 1) {
    const u = (i + 0.5) / windows;
    if (doorAt !== null && Math.abs(u - doorAt) < 0.16) continue;
    const v0 = h * 0.4;
    const v1 = h * 0.72;
    const n = facadeNoise(seed, 900 + i);
    poly([P(u - halfW, v0), P(u + halfW, v0), P(u + halfW, v1), P(u - halfW, v1)], 0x06080b, 0.96);
    if (n < 0.18) {
      poly([P(u - halfW * 0.6, v0 + 2), P(u + halfW * 0.6, v0 + 2), P(u + halfW * 0.6, v1 - 2), P(u - halfW * 0.6, v1 - 2)], 0x7a4a1c, 0.55);
    } else if (n < 0.45) {
      line(P(u - halfW, v0 + 3), P(u + halfW, v1 - 4), 2, 0x5a4430, 0.95);
      line(P(u - halfW, v1 - 3), P(u + halfW, v0 + 4), 2, 0x4e3a29, 0.95);
    } else if (n < 0.8) {
      poly([P(u - halfW, v1), P(u - halfW * 0.2, v1), P(u - halfW, v1 - 5)], 0x56616c, 0.8);
      poly([P(u + halfW, v0), P(u + halfW * 0.3, v0), P(u + halfW, v0 + 4)], 0x56616c, 0.7);
    }
    line(P(u - halfW - 1 / len, v0 - 1), P(u + halfW + 1 / len, v0 - 1), 1.5, shade(material[0], 1.45), 0.9);
  }

  if (doorAt !== null) {
    const doorWidthPx = BUILDING_DOOR_WIDTH_WORLD * Math.hypot(ISO_TILE_WIDTH / 2, ISO_TILE_HEIGHT / 2);
    const dw = doorWidthPx * 0.5 / len;
    const dh = Math.min(h * 0.9, 46);
    poly([P(doorAt - dw, 0), P(doorAt + dw, 0), P(doorAt + dw, dh), P(doorAt - dw, dh)], 0x040506, 0.98);
    line(P(doorAt - dw, dh), P(doorAt + dw, dh), 1.5, 0x4b4f55, 0.95);
    line(P(doorAt - dw, 0), P(doorAt - dw, dh), 1, 0x4b4f55, 0.9);
    line(P(doorAt + dw, 0), P(doorAt + dw, dh), 1, 0x4b4f55, 0.9);
    if (!doorOpen || doorBarricaded) {
      for (const k of [0.25, 0.55, 0.8]) line(P(doorAt - dw * 1.2, dh * k), P(doorAt + dw * 1.2, dh * k + 2), 2, 0x6b5236, 0.95);
    }
    if (doorBarricaded) {
      for (const k of [0.18, 0.48, 0.78]) {
        line(P(doorAt - dw * 0.82, dh * k), P(doorAt + dw * 0.82, dh * k - 4), 3, 0xb45309, 1);
      }
    }
  }

  for (let k = 0; k < 2; k += 1) {
    if (facadeNoise(seed, 700 + k) > 0.65) continue;
    let u = 0.1 + facadeNoise(seed, 710 + k) * 0.8;
    let v = h;
    g.lineStyle(1, 0x07080b, 0.85);
    g.moveTo(P(u, v).x, P(u, v).y);
    for (let s = 0; s < 4; s += 1) {
      u += (facadeNoise(seed, 720 + k * 8 + s) - 0.5) * (8 / len);
      v -= 4 + facadeNoise(seed, 740 + k * 8 + s) * 5;
      g.lineTo(P(u, v).x, P(u, v).y);
    }
    g.lineStyle(0);
  }

  line(P(0, h), P(1, h), 2, shade(material[0], 1.6), 0.95);
}
