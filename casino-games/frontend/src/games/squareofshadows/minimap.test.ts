import { describe, expect, it } from 'vitest';
import type { BoardSize, CameraWindow } from './engine';
import { minimapTileAtPoint, minimapViewport } from './minimap';

const floor = (width: number, height: number): BoardSize => ({ width, height });
const box = { left: 100, top: 50, width: 300, height: 200 };

describe('live minimap geometry', () => {
  it('maps the minimap corners onto the first and last board tiles', () => {
    const board = floor(20, 10);
    expect(minimapTileAtPoint({ x: 100, y: 50 }, box, board)).toEqual({ x: 0, y: 0 });
    expect(minimapTileAtPoint({ x: 399.9, y: 249.9 }, box, board)).toEqual({ x: 19, y: 9 });
  });

  it('maps the middle of the minimap onto the middle tile', () => {
    expect(minimapTileAtPoint({ x: 250, y: 150 }, box, floor(20, 10))).toEqual({ x: 10, y: 5 });
    // An even board has no single centre tile; the pointer still lands on one
    // half of the middle line rather than an out-of-range index.
    expect(minimapTileAtPoint({ x: 250, y: 150 }, box, floor(12, 10))).toEqual({ x: 6, y: 5 });
  });

  it('clamps pointer positions outside the preview onto the floor', () => {
    const board = floor(20, 20);
    expect(minimapTileAtPoint({ x: -500, y: -500 }, box, board)).toEqual({ x: 0, y: 0 });
    expect(minimapTileAtPoint({ x: 900, y: 900 }, box, board)).toEqual({ x: 19, y: 19 });
  });

  it('turns the camera window into floor-relative percentages', () => {
    const view: CameraWindow = { originX: 6, originY: 4, cols: 9, rows: 9 };
    expect(minimapViewport(view, floor(20, 20))).toEqual({
      leftPct: 30,
      topPct: 20,
      widthPct: 45,
      heightPct: 45,
    });
  });

  it('fills the minimap when the camera window is the whole floor', () => {
    const view: CameraWindow = { originX: 0, originY: 0, cols: 12, rows: 10 };
    expect(minimapViewport(view, floor(12, 10))).toEqual({
      leftPct: 0,
      topPct: 0,
      widthPct: 100,
      heightPct: 100,
    });
  });

  it('never reports a viewport outside the floor even for a stale window', () => {
    const view: CameraWindow = { originX: 18, originY: 18, cols: 9, rows: 9 };
    expect(minimapViewport(view, floor(20, 20))).toEqual({
      leftPct: 90,
      topPct: 90,
      widthPct: 10,
      heightPct: 10,
    });
  });
});
