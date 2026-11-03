import { clamp } from './isometric';
import type { Vec2, WeaponId } from './types';

/**
 * Character Animation State Machine (`/engine/animation.ts`).
 *
 * Supports local and remote peer animation states:
 * - `IDLE`: Subtle breathing bob.
 * - `WALK` / `RUN`: 8-directional footstep frame loops matching movement velocity.
 * - `SHOOT`: Transient recoil frame kickback when firing.
 * - `RELOAD`: Multi-frame weapon reload pose loop.
 * - `DEAD`: Ragdoll / prone ground decal transition.
 */
export type CharacterAnimState = 'IDLE' | 'WALK' | 'RUN' | 'SHOOT' | 'RELOAD' | 'MELEE' | 'DEAD';

export type DirectionOctant = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const SURVIVOR_ANIMATION_SHEETS: Record<CharacterAnimState, string> = {
  IDLE: 'survivor_idle',
  WALK: 'survivor_walk',
  RUN: 'survivor_run',
  SHOOT: 'survivor_shoot',
  RELOAD: 'survivor_reload',
  MELEE: 'survivor_melee',
  DEAD: 'survivor_death',
};

/** Select the matching eight-direction sheet for every player animation state. */
export function survivorSheetForState(state: CharacterAnimState): string {
  return SURVIVOR_ANIMATION_SHEETS[state];
}

export interface CharacterAnimationPose {
  state: CharacterAnimState;
  octant: DirectionOctant;
  frameIndex: number;
  bobOffsetY: number;
  strideSkewX: number;
  recoilKickPx: number;
  reloadTiltRad: number;
  reloadDropPx: number;
  proneRotationRad: number;
  proneScaleY: number;
  flipX: boolean;
  meleeSwingRad?: number;
  meleeReachPx?: number;
}

export interface CharacterAnimatorInput {
  velocity: Vec2;
  aimAngle: number;
  alive: boolean;
  sprinting: boolean;
  firing: boolean;
  reloading: boolean;
  melee?: boolean;
  muzzleFlashTimer: number;
  reloadTimer: number;
  reloadProgress?: number;
  weaponId?: WeaponId;
}

/**
 * Quantizes any radian angle into one of 8 isometric direction octants (`0..7`):
 * `const octant = Math.floor((angle + Math.PI / 8) / (Math.PI / 4) + 8) % 8;`
 */
export function angleToOctant(angle: number): DirectionOctant {
  const octant = Math.floor((angle + Math.PI / 8) / (Math.PI / 4) + 8) % 8;
  return (((octant % 8) + 8) % 8) as DirectionOctant;
}

/** Directional character/zombie sheets are always 8 stacked octant rows. */
export const SHEET_ROWS = 8;
export const MELEE_SWING_DURATION = 0.62;
export const SHOOT_RECOVERY_DURATION = 0.16;

const WEAPON_RECOIL_PX: Record<WeaponId, number> = {
  melee: 0,
  pistol: 4.2,
  shotgun: 7.2,
  smg: 2.4,
  rifle: 3.6,
  sniper: 6.2,
  heavy: 1.7,
};

/**
 * Sheet row holding the art for each direction octant.
 *
 * The shipped PixelLab sheets order their rows clockwise from East:
 * `row 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE` (measured: rows 5-7 are the
 * back views, 1-3 the front views, 0/4 the left/right profiles). This engine's
 * octants start at SE instead (see `OCTANT_HAND_OFFSETS`), so the art row is
 * always one step ahead — using the octant as the row turned every sprite 45°
 * off and made characters face the wrong way while aiming.
 */
export function sheetRowForOctant(octant: number): number {
  return (((octant % SHEET_ROWS) + SHEET_ROWS) % SHEET_ROWS + 1) % SHEET_ROWS;
}

/** Smallest believable cell. Stops a 64x64 single sprite being read as 8px cells. */
const MIN_CELL_PX = 16;

export interface SheetLayout {
  rows: number;
  cols: number;
  frameW: number;
  frameH: number;
}

/**
 * Cell grid of an 8-row directional sheet, or `null` when the image is single
 * frame art that must be used whole.
 *
 * This replaces an aspect-ratio guess (`height < width * 2`) that misclassified
 * every sheet wider than four columns — walk/run 512x512, shoot/reload 320x512,
 * melee 384x512, death 448x512 — and drew the entire 40-cell grid in place of one
 * frame. Cells are square: `frameW = frameH`, which holds for every shipped sheet.
 */
export function resolveSheetLayout(width: number, height: number): SheetLayout | null {
  if (width <= 0 || height <= 0) return null;
  if (height % SHEET_ROWS !== 0) return null;
  const frameH = height / SHEET_ROWS;
  if (frameH < MIN_CELL_PX) return null;
  const cols = Math.floor(width / frameH);
  if (cols < 1) return null;
  return { rows: SHEET_ROWS, cols, frameW: frameH, frameH };
}

/**
 * Determines the authoritative `CharacterAnimState` from player/peer flags.
 */
export function resolveCharacterAnimState(input: CharacterAnimatorInput): CharacterAnimState {
  if (!input.alive) return 'DEAD';
  // Melee swings use the fire input too; keep them on their dedicated sheet.
  if (input.melee) return 'MELEE';
  if (input.firing || input.muzzleFlashTimer > 0) return 'SHOOT';
  if (input.reloading || input.reloadTimer > 0) return 'RELOAD';
  const speed = Math.hypot(input.velocity.x, input.velocity.y);
  if (speed > 5.0 || (speed > 0.25 && input.sprinting)) return 'RUN';
  if (speed > 0.18) return 'WALK';
  return 'IDLE';
}

export class CharacterAnimationStateMachine {
  private state: CharacterAnimState = 'IDLE';
  private phaseTime = 0;
  private shotTime = Number.POSITIVE_INFINITY;
  private wasFiring = false;

  getState(): CharacterAnimState {
    return this.state;
  }

  triggerShot(): void {
    this.shotTime = 0;
    this.wasFiring = false;
  }

  step(input: CharacterAnimatorInput, dt: number): CharacterAnimationPose {
    const stepDt = Math.max(0, dt);
    const firingNow = input.firing || input.muzzleFlashTimer > 0;
    if (firingNow && !this.wasFiring) this.shotTime = 0;
    else if (Number.isFinite(this.shotTime)) this.shotTime += stepDt;
    this.wasFiring = firingNow;

    const resolvedState = resolveCharacterAnimState(input);
    const nextState = resolvedState === 'IDLE' || resolvedState === 'WALK' || resolvedState === 'RUN'
      ? this.shotTime < SHOOT_RECOVERY_DURATION ? 'SHOOT' : resolvedState
      : resolvedState;
    if (nextState !== this.state) {
      this.state = nextState;
      this.phaseTime = 0;
    } else {
      this.phaseTime += stepDt;
    }

    const octant = angleToOctant(input.aimAngle);
    const screenDirX = Math.cos(input.aimAngle) - Math.sin(input.aimAngle);
    const flipX = screenDirX < -0.12;

    if (this.state === 'DEAD') {
      return {
        state: 'DEAD',
        octant,
        frameIndex: Math.min(6, Math.floor(this.phaseTime * 8)),
        bobOffsetY: 6,
        strideSkewX: 0,
        recoilKickPx: 0,
        reloadTiltRad: 0,
        reloadDropPx: 0,
        proneRotationRad: flipX ? -Math.PI * 0.46 : Math.PI * 0.46,
        proneScaleY: 0.58,
        flipX,
      };
    }

    if (this.state === 'SHOOT') {
      const progress = clamp(this.shotTime / SHOOT_RECOVERY_DURATION, 0, 1);
      const kickProgress = Math.exp(-progress * 4.2);
      return {
        state: 'SHOOT',
        octant,
        frameIndex: Math.min(4, Math.floor(progress * 5)),
        bobOffsetY: -1.1 * kickProgress,
        strideSkewX: 0,
        recoilKickPx: (WEAPON_RECOIL_PX[input.weaponId ?? 'rifle'] ?? 3.6) * kickProgress,
        reloadTiltRad: -0.11 * kickProgress,
        reloadDropPx: 0,
        proneRotationRad: 0,
        proneScaleY: 1,
        flipX,
      };
    }

    if (this.state === 'RELOAD') {
      const progress = input.reloadProgress === undefined
        ? (this.phaseTime % 1.2) / 1.2
        : clamp(input.reloadProgress, 0, 1);
      const easeOut = (value: number) => 1 - (1 - value) ** 3;
      const lower = easeOut(clamp(progress / 0.2, 0, 1));
      const raise = easeOut(clamp((progress - 0.8) / 0.2, 0, 1));
      const working = lower * (1 - raise);
      const insert = Math.sin(clamp((progress - 0.35) / 0.3, 0, 1) * Math.PI);
      return {
        state: 'RELOAD',
        octant,
        frameIndex: Math.min(4, Math.floor(progress * 5)),
        bobOffsetY: 0.35 * Math.sin(progress * Math.PI * 2),
        strideSkewX: 0,
        recoilKickPx: 0,
        reloadTiltRad: 0.36 * working + 0.1 * insert,
        reloadDropPx: 6 * working,
        proneRotationRad: 0,
        proneScaleY: 1,
        flipX,
      };
    }

    if (this.state === 'MELEE') {
      const progress = clamp(this.phaseTime / MELEE_SWING_DURATION, 0, 1);
      const windup = clamp(progress / 0.2, 0, 1);
      const strike = clamp((progress - 0.2) / 0.48, 0, 1);
      const recovery = clamp((progress - 0.68) / 0.32, 0, 1);
      const easeOut = (value: number) => 1 - (1 - value) ** 3;
      const meleeSwingRad = progress < 0.2
        ? -0.82 * easeOut(windup)
        : progress < 0.68
          ? -0.82 + 1.64 * easeOut(strike)
          : 0.82 * (1 - easeOut(recovery));
      const meleeReachPx = progress < 0.2
        ? -2 * easeOut(windup)
        : progress < 0.48
          ? -2 + 10 * easeOut(clamp((progress - 0.2) / 0.28, 0, 1))
          : 8 * (1 - easeOut(clamp((progress - 0.48) / 0.52, 0, 1)));
      const swing = Math.sin(progress * Math.PI);
      return {
        state: 'MELEE',
        octant,
        frameIndex: Math.min(5, Math.floor(progress * 6)),
        bobOffsetY: -1.2 * swing,
        strideSkewX: Math.sin(progress * Math.PI * 2) * 0.05,
      recoilKickPx: 0,
      reloadTiltRad: 0,
      reloadDropPx: 0,
      proneRotationRad: 0,
        proneScaleY: 1,
        flipX,
        meleeSwingRad,
        meleeReachPx,
      };
    }

    if (this.state === 'RUN' || this.state === 'WALK') {
      const freq = this.state === 'RUN' ? 13.5 : 8.5;
      const ampY = this.state === 'RUN' ? 2.4 : 1.45;
      const frameIndex = Math.floor(this.phaseTime * freq) % 8;
      return {
        state: this.state,
        octant,
        frameIndex,
        bobOffsetY: Math.abs(Math.sin(this.phaseTime * freq)) * -ampY,
        strideSkewX: Math.sin(this.phaseTime * freq) * (this.state === 'RUN' ? 0.06 : 0.035),
        recoilKickPx: 0,
        reloadTiltRad: 0,
        reloadDropPx: 0,
        proneRotationRad: 0,
        proneScaleY: 1,
        flipX,
      };
    }

    // IDLE breathing bob
    const breath = Math.sin(this.phaseTime * 2.8);
    return {
      state: 'IDLE',
      octant,
      frameIndex: Math.floor(this.phaseTime * 2) % 2,
      bobOffsetY: breath * 0.75,
      strideSkewX: 0,
        recoilKickPx: 0,
        reloadTiltRad: 0,
        reloadDropPx: 0,
        proneRotationRad: 0,
      proneScaleY: 1,
      flipX,
    };
  }
}
