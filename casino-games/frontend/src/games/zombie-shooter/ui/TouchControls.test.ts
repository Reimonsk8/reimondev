import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientToLocal } from './TouchControls';
import { zoomForViewport, CAMERA_ZOOM } from '../engine/camera';

/** 375x812 portrait phone: the shell is rotated, so its AABB is the transposed box. */
const portraitStage = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 375, height: 812 }),
} as unknown as HTMLElement;

const landscapeStage = {
  getBoundingClientRect: () => ({ left: 10, top: 20, width: 844, height: 390 }),
} as unknown as HTMLElement;

const stubRotation = (rotated: boolean) =>
  vi.stubGlobal('window', { matchMedia: () => ({ matches: rotated }) });

afterEach(() => vi.unstubAllGlobals());

describe('clientToLocal', () => {
  it('passes screen deltas through when the shell is not rotated', () => {
    stubRotation(false);
    expect(clientToLocal(landscapeStage, 110, 60)).toEqual({ x: 100, y: 40 });
  });

  it('swaps axes for the 90° forced-landscape shell', () => {
    stubRotation(true);
    // local x = screen dy, local y = rect.width - screen dx
    expect(clientToLocal(portraitStage, 100, 40)).toEqual({ x: 40, y: 275 });
    // Bottom-left of the physical screen is the top-left of the rotated shell.
    expect(clientToLocal(portraitStage, 0, 0)).toEqual({ x: 0, y: 375 });
    expect(clientToLocal(portraitStage, 375, 812)).toEqual({ x: 812, y: 0 });
  });
});

describe('zoomForViewport', () => {
  it('keeps the desktop zoom on tall viewports', () => {
    expect(zoomForViewport(1920, 1080)).toBe(CAMERA_ZOOM);
    expect(zoomForViewport(1440, 900)).toBe(CAMERA_ZOOM);
  });

  it('zooms out on phone-sized viewports', () => {
    expect(zoomForViewport(844, 390)).toBeCloseTo(390 / 480, 5);
    expect(zoomForViewport(375, 812)).toBeLessThan(CAMERA_ZOOM);
  });

  it('never drops below the floor', () => {
    expect(zoomForViewport(320, 240)).toBe(0.75);
  });
});
