import { clamp, distance, normalize } from './isometric';
import type {
  Obstacle,
  PlayerState,
  SoundPulse,
  ThreatTier,
  Vec2,
  WeaponState,
  WorldMap,
  WorldState,
  ZombieState,
} from './types';
import { CHUNK_SIZE, chunkCoordAt, isInsideSafeZone } from './world';

function shortestAngleDelta(fromRad: number, toRad: number): number {
  let diff = (toRad - fromRad) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/**
 * Sound-Driven Dumb Zombie AI 4-State Finite State Machine (`/engine/zombieAI.ts`).
 *
 * Directive 3:
 * 1. `IDLE` (`IDLE / WANDERING`): Zombies slowly shuffle or stand dormant within their
 *    14x14 chunk boundaries. They NEVER track the player across the map.
 * 2. `INVESTIGATING`: When a player fires an unsuppressed weapon or sprints, a `SoundPulse`
 *    is emitted. Zombies ignore the player's live coordinates and walk toward the exact
 *    sound origin coordinates (`investigateTarget`), scratching and searching the area.
 * 3. `CHASE` (`CHARGING` alias kept for backwards compatibility): Triggered ONLY when a
 *    zombie enters visual range (line-of-sight cone) or is physically bumped (`<= 2.2` tiles).
 *    Pursues the player directly while line-of-sight holds.
 * 4. `ATTACK`: Melee lunge and bite range with directional hitboxes (`MELEE_BITE_ARC_RAD`)
 *    and stagger reactions.
 */
export type ZombieFsmState = 'IDLE' | 'INVESTIGATING' | 'CHASE' | 'ATTACK' | 'CHARGING';

export const BUMP_DETECTION_RADIUS = 2.4;
export const CLOSE_VISUAL_PERCEPTION_RADIUS = 4.6;
export const LOS_VISUAL_RANGE = 9.5;
export const VISION_CONE_HALF_ARC_RAD = (68 * Math.PI) / 180;
export const INVESTIGATE_ARRIVAL_RADIUS = 0.85;
export const INVESTIGATE_MEMORY_SECONDS = 6.5;
export const MELEE_ATTACK_RANGE_BONUS = 0.24;
export const MELEE_BITE_HALF_ARC_RAD = (58 * Math.PI) / 180;
export const SPRINT_STEP_NOISE_RADIUS = 7.5;

export interface ZombieAiMemory {
  state: ZombieFsmState;
  investigateTarget: Vec2 | null;
  investigateTimer: number;
  wanderAngle: number;
  wanderTimer: number;
  homeChunkX: number;
  homeChunkY: number;
  scratchPhase: number;
}

export interface ZombieAiDecision {
  state: ZombieFsmState;
  target: Vec2;
  speedMultiplier: number;
  inAttackRange: boolean;
  biteHitboxActive: boolean;
}

const aiMemoryMap = new Map<string, ZombieAiMemory>();

export function getZombieAggroMemory(zombie: ZombieState): ZombieAiMemory {
  let mem = aiMemoryMap.get(zombie.id);
  if (!mem) {
    mem = {
      state: zombie.alerted ? 'CHASE' : 'IDLE',
      investigateTarget: null,
      investigateTimer: 0,
      wanderAngle: zombie.angle ?? 0,
      wanderTimer: 1.5,
      homeChunkX: chunkCoordAt(zombie.x),
      homeChunkY: chunkCoordAt(zombie.y),
      scratchPhase: 0,
    };
    aiMemoryMap.set(zombie.id, mem);
  }
  return mem;
}

export function pruneAggroMemory(aliveZombieIds: Set<string>): void {
  for (const id of aiMemoryMap.keys()) {
    if (!aliveZombieIds.has(id)) {
      aiMemoryMap.delete(id);
    }
  }
}

/**
 * Raycasts from `from` to `to` against solid map obstacles to check whether
 * clear visual line-of-sight exists (walls and solid blocks occlude vision).
 */
export function hasLineOfSight(
  from: Vec2,
  to: Vec2,
  obstacles: Obstacle[],
  stepSize = 0.32,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= stepSize) return true;

  // Zombie vision tests run every simulation tick. Restrict ray checks to
  // obstacles whose bounds intersect this segment's AABB instead of scanning
  // every obstacle in every loaded world chunk for every ray sample.
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);
  const rayObstacles = obstacles.filter((obstacle) =>
    obstacle.x <= maxX && obstacle.x + obstacle.width >= minX
    && obstacle.y <= maxY && obstacle.y + obstacle.height >= minY,
  );

  const ux = dx / dist;
  const uy = dy / dist;
  for (let d = stepSize; d < dist; d += stepSize) {
    const px = from.x + ux * d;
    const py = from.y + uy * d;
    for (const obs of rayObstacles) {
      if (
        px >= obs.x &&
        px <= obs.x + obs.width &&
        py >= obs.y &&
        py <= obs.y + obs.height
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Computes a local steering waypoint around solid obstacles or through indoor doorway gaps
 * when direct line-of-sight between `from` and `target` is blocked by a partition wall.
 */
export function resolveObstacleWaypoint(
  from: Vec2,
  target: Vec2,
  obstacles: Obstacle[],
): Vec2 {
  if (hasLineOfSight(from, target, obstacles)) {
    return target;
  }

  let bestCandidate: Vec2 = target;
  let bestScore = Infinity;

  for (const obs of obstacles) {
    const corners: Vec2[] = [
      { x: obs.x - 0.55, y: obs.y - 0.55 },
      { x: obs.x + obs.width + 0.55, y: obs.y - 0.55 },
      { x: obs.x - 0.55, y: obs.y + obs.height + 0.55 },
      { x: obs.x + obs.width + 0.55, y: obs.y + obs.height + 0.55 },
    ];
    for (const c of corners) {
      if (!hasLineOfSight(from, c, obstacles)) continue;
      const score = distance(from, c) + distance(c, target) * 1.15;
      if (score < bestScore) {
        bestScore = score;
        bestCandidate = c;
      }
    }
  }

  return bestCandidate;
}

/**
 * Checks whether `target` lies inside the zombie's forward vision cone or physical bump radius.
 */
export function isTargetInZombieVisionCone(
  zombie: Pick<ZombieState, 'x' | 'y' | 'angle' | 'alerted'>,
  target: Vec2,
  obstacles: Obstacle[],
  maxVisualRange = LOS_VISUAL_RANGE,
): boolean {
  const dist = distance(zombie, target);
  if (dist <= BUMP_DETECTION_RADIUS) {
    return hasLineOfSight(zombie, target, obstacles);
  }
  if (dist > maxVisualRange) return false;

  const angleToTarget = Math.atan2(target.y - zombie.y, target.x - zombie.x);
  const angleDiff = Math.abs(shortestAngleDelta(zombie.angle ?? angleToTarget, angleToTarget));
  const allowedCone = zombie.alerted
    ? Math.PI
    : dist <= CLOSE_VISUAL_PERCEPTION_RADIUS
      ? Math.PI * 0.72
      : VISION_CONE_HALF_ARC_RAD;

  if (angleDiff > allowedCone) return false;
  return hasLineOfSight(zombie, target, obstacles);
}

/**
 * Directional melee lunge & bite hitbox test (`ATTACK` state).
 * Returns `true` when the player is within bite reach and inside the zombie's front bite arc
 * while the zombie is not staggered.
 */
export function isPlayerInZombieAttackHitbox(
  zombie: Pick<ZombieState, 'x' | 'y' | 'angle' | 'radius' | 'staggerTimer'>,
  player: Pick<PlayerState, 'x' | 'y' | 'radius'>,
): boolean {
  if ((zombie.staggerTimer ?? 0) > 0) return false;
  const dist = distance(zombie, player);
  const reach = zombie.radius + player.radius + MELEE_ATTACK_RANGE_BONUS;
  if (dist > reach) return false;

  const angleToPlayer = Math.atan2(player.y - zombie.y, player.x - zombie.x);
  const delta = Math.abs(shortestAngleDelta(zombie.angle ?? angleToPlayer, angleToPlayer));
  return delta <= MELEE_BITE_HALF_ARC_RAD;
}

/**
 * Collects all active obstacles in the current outdoor chunk neighborhood or interior.
 */
export function collectActiveObstacles(state: WorldState): Obstacle[] {
  if (state.activeInterior) {
    return state.activeInterior.obstacles;
  }
  const list = [...state.map.obstacles];
  if (state.map.activeChunks) {
    for (const chunk of Object.values(state.map.activeChunks)) {
      for (const obs of chunk.obstacles) {
        list.push(obs);
      }
    }
  }
  return list;
}

/**
 * Emits a `SoundPulse` into `state.soundPulses` (from unsuppressed gunfire, sprinting footsteps,
 * or smashing doors/windows) and transitions hearing zombies into `INVESTIGATING` toward the exact
 * sound origin coordinates.
 */
export function emitSoundPulse(
  state: WorldState,
  origin: Vec2,
  noiseRadius: number,
  silent = false,
  ttl = 0.48,
): SoundPulse | null {
  const pulse: SoundPulse = {
    id: `snd-${state.nextEntityId++}`,
    x: origin.x,
    y: origin.y,
    radius: 0.45,
    maxRadius: noiseRadius,
    ttl,
    maxTtl: ttl,
    silent,
  };
  state.soundPulses.push(pulse);
  propagateAcousticPulse(state, origin, noiseRadius, silent);
  return pulse;
}

/**
 * Propagates an acoustic sound pulse (`noiseRadius`) from `origin`.
 * Zombies ignore player coordinates and walk toward the exact sound origin `(origin.x, origin.y)`.
 */
export function propagateAcousticPulse(
  state: WorldState,
  origin: Vec2,
  noiseRadius: number,
  silent: boolean,
): void {
  if (silent || noiseRadius <= 1.6) return;

  // Cap alerted zombies to the nearest 6 so a single shot doesn't wake the whole map.
  const candidates = state.zombies
    .map((z) => ({ z, d: distance(z, origin) }))
    .filter((c) => c.d <= noiseRadius)
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
  for (const { z } of candidates) {
    const mem = getZombieAggroMemory(z);
    if (mem.state !== 'CHASE' && mem.state !== 'CHARGING' && mem.state !== 'ATTACK') {
      mem.state = 'INVESTIGATING';
    }
    mem.investigateTarget = { x: origin.x, y: origin.y };
    mem.investigateTimer = INVESTIGATE_MEMORY_SECONDS;
    z.alerted = true;
  }
}

export function computeWeaponAcousticAggroSpike(weapon: WeaponState): number {
  if (weapon.isSilent || weapon.isMelee) return 0;
  return weapon.noiseRadius * 0.32;
}

export function stepDynamicAggroAccumulator(
  currentAggro: number,
  player: PlayerState,
  sprinting: boolean,
  moving: boolean,
  dt: number,
): number {
  if (player.inSafeZone) {
    return clamp(currentAggro - 16 * dt, 0, 100);
  }
  const tierPressure = player.threatTier * 0.72;
  const movementPressure = sprinting ? 4.8 : moving ? 1.15 : -2.4;
  const lightPressure = player.flashlightOn && player.threatTier >= 2 ? 1.35 : 0;
  const delta = (movementPressure + tierPressure + lightPressure) * dt;
  return clamp(currentAggro + delta, 0, 100);
}

export function getAggroSpawnRateMultiplier(aggroIndex: number, tier: ThreatTier): number {
  if (tier === 0) return 0;
  return 1 + clamp(aggroIndex, 0, 100) * 0.012;
}

export function getAggroSpeedMultiplier(aggroIndex: number): number {
  return 1 + clamp(aggroIndex, 0, 100) * 0.0032;
}

/**
 * Evaluates the 4-State Sound-Driven Zombie FSM:
 * 1. `IDLE`: Dumb wandering constrained inside the zombie's home chunk boundaries.
 * 2. `INVESTIGATING`: Walks to the exact `SoundPulse` origin coordinates and searches/scratches.
 * 3. `CHASE` (`CHARGING`): Direct pursuit only when line-of-sight or physical bump holds.
 * 4. `ATTACK`: Melee lunge & directional bite hitbox when within strike distance.
 */
export function evaluateZombieAI(
  zombie: ZombieState,
  player: PlayerState,
  map: WorldMap,
  obstacles: Obstacle[],
  soundPulses: SoundPulse[],
  aggroIndex: number,
  dt: number,
): ZombieAiDecision {
  const mem = getZombieAggroMemory(zombie);
  mem.investigateTimer = Math.max(0, mem.investigateTimer - dt);
  mem.wanderTimer -= dt;
  mem.scratchPhase += dt * 4.2;

  // Safe Zone sanctuary rule: zombies never track or enter the Safe Zone perimeter
  if (player.inSafeZone || isInsideSafeZone(map, player.x, player.y)) {
    mem.state = 'IDLE';
    mem.investigateTarget = null;
    zombie.alerted = false;
    const orbitAngle =
      Math.atan2(zombie.y - map.safeCenter.y, zombie.x - map.safeCenter.x) + 0.35;
    const ring = Math.max(map.safeRadius + 3.4, distance(zombie, map.safeCenter));
    return {
      state: 'IDLE',
      target: {
        x: map.safeCenter.x + Math.cos(orbitAngle) * ring,
        y: map.safeCenter.y + Math.sin(orbitAngle) * ring,
      },
      speedMultiplier: 0.36,
      inAttackRange: false,
      biteHitboxActive: false,
    };
  }

  const distToPlayer = distance(zombie, player);
  const attackReach = zombie.radius + player.radius + MELEE_ATTACK_RANGE_BONUS;
  const visualRange = LOS_VISUAL_RANGE + aggroIndex * 0.04;
  const canSeePlayer = isTargetInZombieVisionCone(zombie, player, obstacles, visualRange);

  // STATE 4: ATTACK (Melee Lunge & Directional Bite Range)
  if (distToPlayer <= attackReach && hasLineOfSight(zombie, player, obstacles)) {
    mem.state = 'ATTACK';
    mem.investigateTarget = { x: player.x, y: player.y };
    mem.investigateTimer = INVESTIGATE_MEMORY_SECONDS;
    zombie.alerted = true;
    const lungeSpeed = (zombie.staggerTimer ?? 0) > 0 ? 0.18 : 1.18;
    return {
      state: 'ATTACK',
      target: { x: player.x, y: player.y },
      speedMultiplier: lungeSpeed,
      inAttackRange: true,
      biteHitboxActive: isPlayerInZombieAttackHitbox(zombie, player),
    };
  }

  // STATE 3: CHASE / CHARGING (Visual Line-of-Sight Cone or Physical Bump)
  if (canSeePlayer || zombie.siegeWave) {
    mem.state = 'CHARGING';
    mem.investigateTarget = { x: player.x, y: player.y };
    mem.investigateTimer = INVESTIGATE_MEMORY_SECONDS;
    zombie.alerted = true;
    const chaseWaypoint = resolveObstacleWaypoint(
      zombie,
      { x: player.x, y: player.y },
      obstacles,
    );
    return {
      state: 'CHARGING',
      target: chaseWaypoint,
      speedMultiplier: getAggroSpeedMultiplier(aggroIndex),
      inAttackRange: false,
      biteHitboxActive: false,
    };
  }

  // STATE 2: INVESTIGATING (SoundPulse Origin — Ignores live player position!)
  for (const pulse of soundPulses) {
    if (pulse.silent) continue;
    if (distance(zombie, pulse) <= pulse.maxRadius) {
      mem.state = 'INVESTIGATING';
      mem.investigateTarget = { x: pulse.x, y: pulse.y };
      mem.investigateTimer = INVESTIGATE_MEMORY_SECONDS;
      zombie.alerted = true;
      break;
    }
  }

  if (mem.investigateTarget && mem.investigateTimer > 0) {
    mem.state = 'INVESTIGATING';
    const distToSound = distance(zombie, mem.investigateTarget);
    if (distToSound <= INVESTIGATE_ARRIVAL_RADIUS) {
      // Zombie reached the exact sound coordinate: scratch and search around the sound origin
      const searchX = mem.investigateTarget.x + Math.cos(mem.scratchPhase) * 0.65;
      const searchY = mem.investigateTarget.y + Math.sin(mem.scratchPhase) * 0.65;
      return {
        state: 'INVESTIGATING',
        target: { x: searchX, y: searchY },
        speedMultiplier: 0.35,
        inAttackRange: false,
        biteHitboxActive: false,
      };
    }

    const investigateWaypoint = resolveObstacleWaypoint(
      zombie,
      mem.investigateTarget,
      obstacles,
    );
    return {
      state: 'INVESTIGATING',
      target: investigateWaypoint,
      speedMultiplier: 0.76 * getAggroSpeedMultiplier(aggroIndex),
      inAttackRange: false,
      biteHitboxActive: false,
    };
  }

  // STATE 1: IDLE / WANDERING (Dumb shuffling confined within home chunk boundaries)
  mem.state = 'IDLE';
  mem.investigateTarget = null;
  zombie.alerted = false;

  if (mem.wanderTimer <= 0) {
    let hash = 0;
    for (let i = 0; i < zombie.id.length; i += 1) {
      hash = (hash * 31 + zombie.id.charCodeAt(i)) | 0;
    }
    mem.wanderAngle += ((hash & 7) - 3.5) * 0.45 + 0.9;
    mem.wanderTimer = 2.4 + (Math.abs(hash) % 3);
  }

  const chunkMinX = mem.homeChunkX * CHUNK_SIZE + 1.2;
  const chunkMaxX = (mem.homeChunkX + 1) * CHUNK_SIZE - 1.2;
  const chunkMinY = mem.homeChunkY * CHUNK_SIZE + 1.2;
  const chunkMaxY = (mem.homeChunkY + 1) * CHUNK_SIZE - 1.2;

  const rawWanderX = zombie.x + Math.cos(mem.wanderAngle) * 2.2;
  const rawWanderY = zombie.y + Math.sin(mem.wanderAngle) * 2.2;

  const clampedWander: Vec2 = {
    x: clamp(rawWanderX, chunkMinX, chunkMaxX),
    y: clamp(rawWanderY, chunkMinY, chunkMaxY),
  };

  // If zombie hits its chunk border, turn back toward chunk center
  if (rawWanderX !== clampedWander.x || rawWanderY !== clampedWander.y) {
    const centerDir = normalize({
      x: (chunkMinX + chunkMaxX) * 0.5 - zombie.x,
      y: (chunkMinY + chunkMaxY) * 0.5 - zombie.y,
    });
    mem.wanderAngle = Math.atan2(centerDir.y, centerDir.x);
  }

  return {
    state: 'IDLE',
    target: clampedWander,
    speedMultiplier: 0.34,
    inAttackRange: false,
    biteHitboxActive: false,
  };
}

// Backwards-compatible alias used by simulation.ts and unit tests
export const evaluateZombieAggroDecision = evaluateZombieAI;
export type ZombieAggroState = ZombieFsmState;
export type ZombieAggroMemory = ZombieAiMemory;
