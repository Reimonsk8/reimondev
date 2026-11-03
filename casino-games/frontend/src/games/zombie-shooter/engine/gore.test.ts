import { describe, expect, it } from 'vitest';
import {
  BLOOD_PALETTE,
  applyDismemberment,
  calculateGoreTrajectory,
  decalRadiusFor,
  goreBurstFor,
} from './gore';

const fixedRng = () => 0.5;

describe('gore trajectory', () => {
  it('throws debris in the impact hemisphere with force-scaled speed', () => {
    const weak = calculateGoreTrajectory(0, 1, fixedRng);
    const strong = calculateGoreTrajectory(0, 4, fixedRng);
    expect(weak.x).toBeGreaterThan(0);
    expect(Math.hypot(strong.x, strong.y)).toBeGreaterThan(Math.hypot(weak.x, weak.y));
    expect(weak.y).toBeCloseTo(0, 8);
  });

  it('scatters around the impact angle rather than in a single line', () => {
    let roll = 0;
    const rng = () => {
      roll = (roll + 0.23) % 1;
      return roll;
    };
    const angles = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      const v = calculateGoreTrajectory(Math.PI / 2, 2, rng);
      angles.add(v.x.toFixed(3));
    }
    expect(angles.size).toBeGreaterThan(3);
  });
});

describe('gore emitter', () => {
  it('uses only the low-luminance blood palette for blood droplets', () => {
    const seeds = goreBurstFor(
      {
        angle: 0.4,
        force: 1,
        headshot: false,
        lethal: false,
        variant: 'walker',
        weapon: 'rifle',
      },
      fixedRng,
    );
    const bloodColors = seeds
      .filter((s) => s.kind === 'blood' || s.kind === 'mist')
      .map((s) => s.color);
    expect(bloodColors.length).toBeGreaterThan(0);
    for (const color of bloodColors) {
      expect(BLOOD_PALETTE).toContain(color);
    }
  });

  it('emits more particles and bone/organ chunks on lethal shotgun headshots', () => {
    const body = goreBurstFor(
      {
        angle: 0,
        force: 0.5,
        headshot: false,
        lethal: false,
        variant: 'walker',
        weapon: 'rifle',
      },
      fixedRng,
    );
    const gib = goreBurstFor(
      {
        angle: 0,
        force: 1.5,
        headshot: true,
        lethal: true,
        variant: 'brute',
        weapon: 'shotgun',
      },
      fixedRng,
    );
    expect(gib.length).toBeGreaterThan(body.length);
    expect(gib.some((s) => s.kind === 'bone')).toBe(true);
    expect(gib.some((s) => s.kind === 'organ')).toBe(true);
  });

  it('scales baked decal splat size with impact force and particle kind', () => {
    expect(decalRadiusFor(0.4, 'blood')).toBeLessThan(decalRadiusFor(2.2, 'blood'));
    expect(decalRadiusFor(1.2, 'organ')).toBeGreaterThan(decalRadiusFor(1.2, 'bone'));
  });

  it('severs segmented zombie limbs based on dismemberment type', () => {
    const limbs = { head: true, torso: true, leftArm: true, rightArm: true, legs: true };
    const slashPart = applyDismemberment(limbs, 'SLASH_SLICE', false, false, true, () => 0.2);
    expect(slashPart).toBe('leftArm');
    expect(limbs.leftArm).toBe(false);

    const headPart = applyDismemberment(limbs, 'HEADSHOT', true, true, true, fixedRng);
    expect(headPart).toBe('head');
    expect(limbs.head).toBe(false);

    const gibPart = applyDismemberment(limbs, 'EXPLOSIVE_GIB', false, true, true, fixedRng);
    expect(gibPart).toBe('torso');
    expect(limbs.torso).toBe(false);
  });
});
