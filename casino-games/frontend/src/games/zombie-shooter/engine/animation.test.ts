import { describe, expect, it } from 'vitest';
import {
  angleToOctant,
  CharacterAnimationStateMachine,
  MELEE_SWING_DURATION,
  SHOOT_RECOVERY_DURATION,
  type CharacterAnimState,
  SHEET_ROWS,
  resolveSheetLayout,
  sheetRowForOctant,
  survivorSheetForState,
} from './animation';

/**
 * Every shipped directional sheet is 8 rows of square cells. The old aspect
 * heuristic (`height < width * 2`) rejected anything wider than 4 columns and
 * drew the whole grid, so these numbers are the actual PNG dimensions.
 */
const SHIPPED_SHEETS: Array<[name: string, width: number, height: number, cols: number]> = [
  ['survivor_idle', 256, 512, 4],
  ['survivor_walk', 512, 512, 8],
  ['survivor_run', 512, 512, 8],
  ['survivor_shoot', 320, 512, 5],
  ['survivor_reload', 320, 512, 5],
  ['survivor_melee', 384, 512, 6],
  ['survivor_death', 448, 512, 7],
];

describe('resolveSheetLayout', () => {
  it.each(SHIPPED_SHEETS)('slices %s into 8 rows x %i cols', (_name, width, height, cols) => {
    const layout = resolveSheetLayout(width, height);
    expect(layout).not.toBeNull();
    expect(layout!.rows).toBe(SHEET_ROWS);
    expect(layout!.cols).toBe(cols);
    expect(layout!.frameH).toBe(64);
    // cells must tile the image exactly — no partial cell, no bleed
    expect(layout!.cols * layout!.frameW).toBe(width);
    expect(layout!.rows * layout!.frameH).toBe(height);
  });

  it('treats single-frame 64x64 art as whole sprites', () => {
    expect(resolveSheetLayout(64, 64)).toBeNull();
    expect(resolveSheetLayout(32, 32)).toBeNull();
  });

  it('rejects non-multiples of 8 rows and degenerate sizes', () => {
    expect(resolveSheetLayout(0, 0)).toBeNull();
    expect(resolveSheetLayout(256, 500)).toBeNull();
    expect(resolveSheetLayout(8, 512)).toBeNull();
  });
});

describe('sheetRowForOctant', () => {
  it('maps each octant to its art row (art rows start at East, octants at South-East)', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(sheetRowForOctant)).toEqual([1, 2, 3, 4, 5, 6, 7, 0]);
  });

  it('wraps out-of-range octants instead of reading past the sheet', () => {
    expect(sheetRowForOctant(8)).toBe(1);
    expect(sheetRowForOctant(-1)).toBe(0);
  });
});

describe('8-direction player animation selection', () => {
  it('maps all eight aim directions to matching clockwise sprite rows', () => {
    const directions = Array.from({ length: 8 }, (_, index) => angleToOctant(index * Math.PI / 4));
    expect(directions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(directions.map(sheetRowForOctant)).toEqual([1, 2, 3, 4, 5, 6, 7, 0]);
  });

  it('uses the matching directional sheet for every animation state, including shooting', () => {
    const states: CharacterAnimState[] = ['IDLE', 'WALK', 'RUN', 'SHOOT', 'RELOAD', 'MELEE', 'DEAD'];
    expect(states.map(survivorSheetForState))
      .toEqual([
        'survivor_idle', 'survivor_walk', 'survivor_run', 'survivor_shoot',
        'survivor_reload', 'survivor_melee', 'survivor_death',
      ]);
  });

  it('keeps knife fire on the melee sheet and advances through the slash frames', () => {
    const animator = new CharacterAnimationStateMachine();
    const input = {
      velocity: { x: 0, y: 0 }, aimAngle: Math.PI / 2, alive: true, sprinting: false,
      firing: true, reloading: false, melee: true, muzzleFlashTimer: 0.03, reloadTimer: 0,
    };
    const first = animator.step(input, 1 / 60);
    const next = animator.step(input, 0.15);
    expect(first.state).toBe('MELEE');
    expect(first.frameIndex).toBe(0);
    expect(next.frameIndex).toBeGreaterThan(first.frameIndex);
    expect(survivorSheetForState(next.state)).toBe('survivor_melee');
    expect(next.meleeReachPx).toBeGreaterThan(first.meleeReachPx ?? 0);
    expect(next.meleeSwingRad).not.toBe(first.meleeSwingRad);

    const recovery = animator.step(input, MELEE_SWING_DURATION);
    expect(recovery.frameIndex).toBe(5);
    expect(recovery.meleeReachPx).toBeCloseTo(0, 5);
  });

  it('carries firearm recoil through a short recovery and scales it by weapon class', () => {
    const animator = new CharacterAnimationStateMachine();
    const input = {
      velocity: { x: 0, y: 0 }, aimAngle: 0, alive: true, sprinting: false,
      firing: true, reloading: false, muzzleFlashTimer: 0.03, reloadTimer: 0,
      weaponId: 'shotgun' as const,
    };
    const kick = animator.step(input, 1 / 60);
    const recovering = animator.step({ ...input, firing: false, muzzleFlashTimer: 0 }, 0.05);
    expect(kick.state).toBe('SHOOT');
    expect(kick.recoilKickPx).toBeGreaterThan(7);
    expect(recovering.state).toBe('SHOOT');
    expect(recovering.recoilKickPx).toBeLessThan(kick.recoilKickPx);
    expect(recovering.frameIndex).toBeGreaterThan(kick.frameIndex);
    expect(animator.step({ ...input, firing: false, muzzleFlashTimer: 0 }, SHOOT_RECOVERY_DURATION).state)
      .toBe('IDLE');
  });

  it('plays reload poses in order and lowers then raises the weapon across reload progress', () => {
    const animator = new CharacterAnimationStateMachine();
    const input = {
      velocity: { x: 0, y: 0 }, aimAngle: 0, alive: true, sprinting: false,
      firing: false, reloading: true, muzzleFlashTimer: 0, reloadTimer: 1,
      reloadProgress: 0,
    };
    const start = animator.step(input, 1 / 60);
    const insert = animator.step({ ...input, reloadProgress: 0.5 }, 1 / 60);
    const finish = animator.step({ ...input, reloadProgress: 1 }, 1 / 60);
    expect(start.state).toBe('RELOAD');
    expect(start.frameIndex).toBe(0);
    expect(insert.frameIndex).toBe(2);
    expect(insert.reloadDropPx).toBeGreaterThan(5);
    expect(finish.frameIndex).toBe(4);
    expect(finish.reloadDropPx).toBe(0);
  });
});
