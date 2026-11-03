import { normalize } from './isometric';
import type { PlayerState, Vec2, ZombieState } from './types';

/**
 * Rigid-body impulse / knockback system.
 *
 * A knockback is stored as a decaying velocity vector on the target (`knockbackVx/Vy`)
 * plus a `knockbackTimer` that briefly locks out normal movement input so the
 * victim visibly staggers/recoils before recovering control. Decaying the impulse
 * over time (instead of teleporting) is what gives the "visceral" stagger feel.
 */

export interface KnockbackOptions {
  /** Duration of the stagger lockout in seconds. Defaults to 0.25. */
  staggerDuration?: number;
  /** Exponential decay rate for the impulse (higher = shorter recoil). Defaults to 8. */
  decayRate?: number;
  /** Hard cap on impulse magnitude in world units/sec. Defaults to 14. */
  maxImpulse?: number;
}

const DEFAULTS: Required<KnockbackOptions> = {
  staggerDuration: 0.25,
  decayRate: 8,
  maxImpulse: 14,
};

export type KnockbackTarget = PlayerState | ZombieState;

/**
 * Applies an immediate velocity impulse pushing `target` away from (sourceX, sourceY).
 * Returns the impulse vector that was applied (useful for event payloads).
 */
export function applyKnockback(
  target: KnockbackTarget,
  sourceX: number,
  sourceY: number,
  force: number,
  options: KnockbackOptions = {},
): Vec2 {
  const opts = { ...DEFAULTS, ...options };
  const dx = target.x - sourceX;
  const dy = target.y - sourceY;
  const dir = normalize({ x: dx, y: dy });
  const mag = Math.min(opts.maxImpulse, Math.max(0, force));

  // Impulses stack (don't overwrite a bigger in-flight recoil) but clamp magnitude.
  const baseVx = Number.isFinite(target.knockbackVx) ? target.knockbackVx : 0;
  const baseVy = Number.isFinite(target.knockbackVy) ? target.knockbackVy : 0;
  const nx = baseVx + dir.x * mag;
  const ny = baseVy + dir.y * mag;
  const len = Math.hypot(nx, ny);
  if (len > opts.maxImpulse) {
    const s = opts.maxImpulse / len;
    target.knockbackVx = nx * s;
    target.knockbackVy = ny * s;
  } else {
    target.knockbackVx = nx;
    target.knockbackVy = ny;
  }
  const baseTimer = Number.isFinite(target.knockbackTimer) ? target.knockbackTimer : 0;
  target.knockbackTimer = Math.max(baseTimer, opts.staggerDuration);
  // Keep the stagger flag coherent with the timer for callers/tests that read it.
  if ('staggerTimer' in target) {
    const current = (target as { staggerTimer: number }).staggerTimer;
    (target as { staggerTimer: number }).staggerTimer = Math.max(
      Number.isFinite(current) ? current : 0,
      opts.staggerDuration,
    );
  }
  return { x: target.knockbackVx, y: target.knockbackVy };
}

/**
 * Steps the knockback decay: applies the remaining impulse to position (with
 * collision + safe-zone clamping supplied by the caller via `move`), then
 * decays the impulse and counts down the stagger timer. Returns the per-frame
 * displacement that was actually applied.
 */
export function stepKnockback(
  target: KnockbackTarget,
  dt: number,
  move: (x: number, y: number, dx: number, dy: number, radius: number) => { x: number; y: number },
  clampSafe: (x: number, y: number, radius: number) => { x: number; y: number },
  options: KnockbackOptions = {},
): Vec2 {
  const opts = { ...DEFAULTS, ...options };
  // Snapshots (local saves, or an older authoritative server) may omit the
  // knockback fields entirely. Treat missing/non-finite values as zero instead
  // of letting `undefined` propagate into the position as NaN.
  const vx = Number.isFinite(target.knockbackVx) ? target.knockbackVx : 0;
  const vy = Number.isFinite(target.knockbackVy) ? target.knockbackVy : 0;
  const timer = Number.isFinite(target.knockbackTimer) ? target.knockbackTimer : 0;
  if (timer <= 0 && vx === 0 && vy === 0) {
    return { x: 0, y: 0 };
  }
  const impulse = { x: vx * dt, y: vy * dt };
  const moved = move(target.x, target.y, impulse.x, impulse.y, target.radius);
  const clamped = clampSafe(moved.x, moved.y, target.radius);
  const applied = { x: clamped.x - target.x, y: clamped.y - target.y };
  target.x = clamped.x;
  target.y = clamped.y;

  const decay = Math.exp(-opts.decayRate * dt);
  const nextVx = vx * decay;
  const nextVy = vy * decay;
  const nextTimer = Math.max(0, timer - dt);
  target.knockbackVx = nextTimer <= 0 ? 0 : nextVx;
  target.knockbackVy = nextTimer <= 0 ? 0 : nextVy;
  target.knockbackTimer = nextTimer;
  if ('staggerTimer' in target) {
    (target as { staggerTimer: number }).staggerTimer = Math.max(0, (target as { staggerTimer: number }).staggerTimer - dt * 0.5);
  }
  return applied;
}

export function isStaggered(target: KnockbackTarget): boolean {
  const st = 'staggerTimer' in target ? (target as { staggerTimer: number }).staggerTimer : 0;
  return target.knockbackTimer > 0 || st > 0;
}

export function clearKnockback(target: KnockbackTarget): void {
  target.knockbackVx = 0;
  target.knockbackVy = 0;
  target.knockbackTimer = 0;
}