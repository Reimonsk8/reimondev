import { applyKnockback, type KnockbackOptions } from './physics';
import type { PlayerState, Vec2, WeaponState, ZombieState } from './types';

/**
 * Combat facade: centralises hit resolution so melee and zombie bites both route
 * through the rigid-body knockback system instead of ad-hoc instant teleports.
 */

export interface HitResult {
  damage: number;
  knockback: Vec2;
  lethal: boolean;
}

export function applyMeleeHitToZombie(
  zombie: ZombieState,
  player: PlayerState,
  weapon: WeaponState,
  angle: number,
  damage: number,
  headshot: boolean,
  options: KnockbackOptions = {},
): HitResult {
  const knockScale = 1 + Math.max(0, player.attributes.strength - 25) * 0.01;
  const force = weapon.knockback * knockScale * (headshot ? 1.5 : 1);
  const impulse = applyKnockback(zombie, player.x, player.y, force, options);
  return { damage, knockback: impulse, lethal: zombie.health <= 0 };
}

export function applyZombieBiteToPlayer(
  player: PlayerState,
  zombie: ZombieState,
  damage: number,
  options: KnockbackOptions = {},
): HitResult {
  const force = (zombie.damage ?? 8) * 0.18 + 1.6;
  const impulse = applyKnockback(player, zombie.x, zombie.y, force, options);
  return { damage, knockback: impulse, lethal: player.health <= 0 };
}