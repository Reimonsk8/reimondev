import type {
  DismemberType,
  Vec2,
  WeaponId,
  ZombieBodyPart,
  ZombieLimbs,
  ZombieVariant,
} from './types';

/**
 * Gore math lives apart from Pixi on purpose.
 *
 * The server decides that a hit happened, which body part was hit, and how much
 * force it carried. The client turns those facts into particles and decals. That
 * split is what keeps dismemberment from desyncing once multiplayer lands.
 */

/** Low-luminance, high-saturation blood reads under the fog-of-war overlay. */
export const BLOOD_PALETTE = ['#4A0404', '#5A0505', '#730A0A', '#8B0000'] as const;

export type GoreParticleKind = 'blood' | 'mist' | 'bone' | 'organ' | 'limb';

export interface GoreParticleSeed {
  kind: GoreParticleKind;
  vx: number;
  vy: number;
  /** Faked height, in screen pixels, for an isometric arc. */
  vz: number;
  gravity: number;
  drag: number;
  ttl: number;
  size: number;
  color: string;
}

export interface GoreBurstOptions {
  /** Direction of the projectile, in world radians. */
  angle: number;
  /** 0..1-ish impact force; shotguns and headshots push this higher. */
  force: number;
  headshot: boolean;
  lethal: boolean;
  variant: ZombieVariant;
  weapon: WeaponId;
  dismemberType?: DismemberType;
  severedPart?: ZombieBodyPart;
}

const BONE_COLORS = ['#c8bea6', '#9e8e74', '#7a1c1c'] as const;
const ORGAN_COLORS = ['#3d0206', '#58090e', '#6f0f15'] as const;
const TOXIC_BLOOD_COLORS = ['#2b580c', '#4a7c10', '#5A0505', '#730A0A'] as const;

/**
 * Resolves which segmented limb (`head`, `torso`, `leftArm`, `rightArm`, `legs`)
 * is severed or crushed by a weapon hit, mutating `limbs` in place and returning
 * the severed part (if any).
 */
export function applyDismemberment(
  limbs: ZombieLimbs,
  dismemberType: DismemberType,
  headshot: boolean,
  lethal: boolean,
  crit: boolean,
  rng: () => number = Math.random,
): ZombieBodyPart | undefined {
  if (headshot && limbs.head && (lethal || crit || dismemberType === 'HEADSHOT')) {
    limbs.head = false;
    return 'head';
  }
  if (dismemberType === 'EXPLOSIVE_GIB' && (lethal || crit)) {
    if (lethal && limbs.torso) {
      limbs.torso = false;
      limbs.leftArm = false;
      limbs.rightArm = false;
      return 'torso';
    }
    if (limbs.leftArm) {
      limbs.leftArm = false;
      return 'leftArm';
    }
    if (limbs.rightArm) {
      limbs.rightArm = false;
      return 'rightArm';
    }
  }
  if (dismemberType === 'SLASH_SLICE' && (crit || lethal || rng() < 0.42)) {
    if (limbs.leftArm && (rng() < 0.5 || !limbs.rightArm)) {
      limbs.leftArm = false;
      return 'leftArm';
    }
    if (limbs.rightArm) {
      limbs.rightArm = false;
      return 'rightArm';
    }
    if (lethal && limbs.head) {
      limbs.head = false;
      return 'head';
    }
  }
  if (dismemberType === 'BLUNT_CRUSH' && (crit || lethal || rng() < 0.38)) {
    if (limbs.legs && !lethal) {
      limbs.legs = false;
      return 'legs';
    }
    if (lethal && limbs.head) {
      limbs.head = false;
      return 'head';
    }
  }
  return undefined;
}

/**
 * Pure helper from plan.md §7.2, kept deterministic through an injected RNG so
 * tests can assert cone spread and force scaling without mocking globals.
 */
export function calculateGoreTrajectory(
  impactAngle: number,
  force: number,
  rng: () => number = Math.random,
): Vec2 {
  const safeForce = Math.max(0.15, force);
  const spread = (rng() - 0.5) * 0.8;
  const speed = safeForce * (0.5 + rng() * 0.8);
  return {
    x: Math.cos(impactAngle + spread) * speed,
    y: Math.sin(impactAngle + spread) * speed,
  };
}

function pick<T>(items: readonly T[], rng: () => number): T {
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[index];
}

/**
 * Builds the particle seeds for one hit. Returns data only; the renderer owns
 * pooling, screen-space projection, and baking into the ground RenderTexture.
 */
export function goreBurstFor(
  options: GoreBurstOptions,
  rng: () => number = Math.random,
): GoreParticleSeed[] {
  const { angle, force, headshot, lethal, variant, weapon, dismemberType, severedPart } = options;
  const isHeavyGib =
    weapon === 'shotgun' ||
    weapon === 'heavy' ||
    dismemberType === 'EXPLOSIVE_GIB';
  const weaponBonus = isHeavyGib ? 7 : weapon === 'sniper' ? 5 : 0;
  const headshotBonus = headshot ? 9 : 0;
  const lethalBonus = lethal ? 12 : 0;
  const variantBonus =
    variant === 'brute' || variant === 'titan'
      ? 8
      : variant === 'spitter' || variant === 'leaper'
        ? 4
        : 0;
  const dropletCount = 6 + weaponBonus + headshotBonus + lethalBonus + variantBonus;

  const seeds: GoreParticleSeed[] = [];
  const baseForce = Math.max(0.6, force) * (headshot ? 1.35 : 1) * (lethal ? 1.25 : 1);
  const palette = variant === 'spitter' ? TOXIC_BLOOD_COLORS : BLOOD_PALETTE;

  for (let i = 0; i < dropletCount; i += 1) {
    const v = calculateGoreTrajectory(angle, baseForce * 95, rng);
    const mist = i % 4 === 0;
    seeds.push({
      kind: mist ? 'mist' : 'blood',
      vx: v.x,
      vy: v.y,
      vz: 45 + rng() * (headshot ? 110 : 70),
      gravity: mist ? 150 : 320,
      drag: mist ? 0.86 : 0.91,
      ttl: mist ? 0.28 + rng() * 0.16 : 0.34 + rng() * 0.28,
      size: mist ? 3.5 + rng() * 4.5 : 1.6 + rng() * (lethal ? 3.4 : 2.3),
      color: pick(palette, rng),
    });
  }

  if (headshot || lethal || severedPart) {
    const chunkCount = (headshot ? 4 : 2) + (lethal ? 4 : 0) + (isHeavyGib ? 3 : 0) + (severedPart ? 3 : 0);
    for (let i = 0; i < chunkCount; i += 1) {
      const v = calculateGoreTrajectory(angle, baseForce * 78, rng);
      const isBone = headshot ? i % 2 === 0 : i % 3 === 0;
      seeds.push({
        kind: isBone ? 'bone' : 'organ',
        vx: v.x,
        vy: v.y,
        vz: 65 + rng() * 95,
        gravity: 360,
        drag: 0.9,
        ttl: 0.38 + rng() * 0.26,
        size: isBone ? 2.1 + rng() * 1.8 : 2.8 + rng() * 2.4,
        color: isBone ? pick(BONE_COLORS, rng) : pick(ORGAN_COLORS, rng),
      });
    }
  }

  return seeds;
}

/** Radius (in screen pixels) of the permanent splat baked when a particle rests. */
export function decalRadiusFor(force: number, kind: GoreParticleKind): number {
  const clamped = Math.max(0.3, Math.min(3, force));
  if (kind === 'organ' || kind === 'limb') return 3.2 + clamped * 2.4;
  if (kind === 'bone') return 1.6 + clamped * 0.9;
  if (kind === 'mist') return 2.4 + clamped * 1.8;
  return 2 + clamped * 2;
}
