import type { Obstacle, Vec2, ZombieState } from './types';

/**
 * Room-Based Line of Sight & Fog of War (`/engine/vision.ts`).
 *
 * Enforces Project Zomboid / Darkwood indoor darkness:
 * - Unexplored indoor rooms are hidden beneath a solid black fog-of-war layer (`#000000`, `1.0` alpha).
 * - `calculateRoomVision` casts radial line-of-sight rays from the survivor:
 *   - Walls, closed doors, and solid partitions block vision rays.
 *   - Opening a door or looking through a glass window punctures the vision mask,
 *     revealing the adjacent room's tiles and enemy occupants in real time.
 */
export const UNEXPLORED_ROOM_FOG_COLOR = 0x000000;
export const UNEXPLORED_ROOM_FOG_ALPHA = 1.0;

export type PortalKind = 'door' | 'window';
export type PortalState = 'closed' | 'opening' | 'open' | 'closing' | 'smashed' | 'barricaded';

export interface InteriorPortal {
  id: string;
  kind: PortalKind;
  state: PortalState;
  x: number;
  y: number;
  width: number;
  height: number;
  roomA: string;
  roomB: string;
  barricadeHp: number;
  transitionTimer: number;
}

export interface InteriorRoomBounds {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  explored: boolean;
  currentlyVisible: boolean;
}

export interface RoomVisionResult {
  visibilityPolygonWorld: Vec2[];
  visibleRoomIds: Set<string>;
  visibleZombieIds: Set<string>;
}

/**
 * Returns whether an `InteriorPortal` (door or window) blocks line-of-sight rays.
 * - Open or smashed doors/windows allow vision rays through.
 * - Unbarricaded glass windows allow vision rays through even when closed.
 * - Closed doors and barricaded portals block vision rays.
 */
export function doesPortalBlockVision(portal: InteriorPortal): boolean {
  if (portal.state === 'barricaded' || portal.state === 'closed' || portal.state === 'closing') return true;
  if (portal.kind === 'window') return false;
  return portal.state !== 'open' && portal.state !== 'smashed';
}

export function doesPortalBlockMovement(portal: InteriorPortal): boolean {
  return portal.state !== 'open' && portal.state !== 'smashed';
}

function pointInObstacle(x: number, y: number, obs: Obstacle): boolean {
  return x >= obs.x && x <= obs.x + obs.width && y >= obs.y && y <= obs.y + obs.height;
}

function pointInBlockingPortal(x: number, y: number, portals: InteriorPortal[]): boolean {
  for (const portal of portals) {
    if (!doesPortalBlockVision(portal)) continue;
    if (
      x >= portal.x - portal.width * 0.5 &&
      x <= portal.x + portal.width * 0.5 &&
      y >= portal.y - portal.height * 0.5 &&
      y <= portal.y + portal.height * 0.5
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Casts a single vision ray from `origin` along `angle` up to `maxRange` tiles,
 * stopping at the first wall, closed door, or solid partition.
 */
export function castVisionRay(
  origin: Vec2,
  angle: number,
  maxRange: number,
  obstacles: Obstacle[],
  portals: InteriorPortal[] = [],
  bounds?: { width: number; height: number },
  stepSize = 0.22,
): Vec2 {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let lastValidX = origin.x;
  let lastValidY = origin.y;

  for (let d = stepSize; d <= maxRange; d += stepSize) {
    const px = origin.x + dx * d;
    const py = origin.y + dy * d;

    if (bounds && (px <= 0.3 || py <= 0.3 || px >= bounds.width - 0.3 || py >= bounds.height - 0.3)) {
      return { x: px, y: py };
    }
    if (pointInBlockingPortal(px, py, portals)) {
      return { x: px, y: py };
    }
    for (const obs of obstacles) {
      if (pointInObstacle(px, py, obs)) {
        return { x: px, y: py };
      }
    }
    lastValidX = px;
    lastValidY = py;
  }

  return { x: lastValidX, y: lastValidY };
}

/**
 * Calculates room-based raycast line-of-sight (`calculateRoomVision`).
 * Punctures the `#000000` (`1.0` alpha) fog mask through open doors and glass windows
 * and returns visible rooms, visible enemy occupants, and the world-space visibility polygon.
 */
export function calculateRoomVision(
  playerPos: Vec2,
  obstacles: Obstacle[],
  rooms: InteriorRoomBounds[] = [],
  portals: InteriorPortal[] = [],
  zombies: ZombieState[] = [],
  maxRange = 11.5,
  rayCount = 72,
  bounds?: { width: number; height: number },
): RoomVisionResult {
  const visibilityPolygonWorld: Vec2[] = [];
  const visibleRoomIds = new Set<string>();

  for (const room of rooms) {
    room.currentlyVisible = false;
    if (
      playerPos.x >= room.x &&
      playerPos.x <= room.x + room.width &&
      playerPos.y >= room.y &&
      playerPos.y <= room.y + room.height
    ) {
      room.currentlyVisible = true;
      room.explored = true;
      visibleRoomIds.add(room.id);
    }
  }

  for (let i = 0; i < rayCount; i += 1) {
    const angle = (i / rayCount) * Math.PI * 2;
    const hit = castVisionRay(
      playerPos,
      angle,
      maxRange,
      obstacles,
      portals,
      bounds,
    );
    visibilityPolygonWorld.push(hit);

    for (const room of rooms) {
      if (
        hit.x >= room.x + 0.25 &&
        hit.x <= room.x + room.width - 0.25 &&
        hit.y >= room.y + 0.25 &&
        hit.y <= room.y + room.height - 0.25
      ) {
        room.currentlyVisible = true;
        room.explored = true;
        visibleRoomIds.add(room.id);
      }
    }
  }

  const visibleZombieIds = new Set<string>();
  for (const zombie of zombies) {
    const dist = Math.hypot(zombie.x - playerPos.x, zombie.y - playerPos.y);
    if (dist > maxRange) continue;
    const angle = Math.atan2(zombie.y - playerPos.y, zombie.x - playerPos.x);
    const rayHit = castVisionRay(playerPos, angle, dist + 0.3, obstacles, portals, bounds);
    const rayDist = Math.hypot(rayHit.x - playerPos.x, rayHit.y - playerPos.y);
    if (rayDist + 0.35 >= dist) {
      visibleZombieIds.add(zombie.id);
    }
  }

  return {
    visibilityPolygonWorld,
    visibleRoomIds,
    visibleZombieIds,
  };
}
