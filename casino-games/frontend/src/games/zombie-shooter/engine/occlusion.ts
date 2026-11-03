import { clamp } from './isometric';
import type { BuildingDoor, Obstacle, Vec2, ZombieState } from './types';
import {
  calculateRoomVision,
  doesPortalBlockVision,
  type InteriorPortal,
  type InteriorRoomBounds,
  type RoomVisionResult,
} from './vision';

/**
 * Project Zomboid Roof Culling, Wall Cutaway & Line-of-Sight Occlusion (`/engine/occlusion.ts`).
 *
 * Directive 2:
 * - Outdoors: Building roofs render at `1.0` opacity (`roofAlpha = 1.0`).
 * - Doorway / Footprint Trigger: Crossing a building doorway or footprint fades the roof
 *   layer to `0.0` opacity over `150ms` (`ROOF_FADE_DURATION_MS = 150`) to reveal the
 *   interior floor tiles and rooms, while North/West front walls drop to `0.28` cutaway alpha.
 * - Raycast Vision Cone: Unexplored rooms behind closed doors remain in soft shadow (`0.82`–`0.94` alpha)
 *   until the player opens the door or looks through a window.
 */
export type WallOrientation = 'NORTH' | 'WEST' | 'SOUTH' | 'EAST' | 'INTERIOR';

export interface BuildingFootprint {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  doorwayTrigger?: Vec2;
  roofAlpha: number;
  frontWallAlpha: number;
  playerInside: boolean;
}

export const CUTAWAY_WALL_ALPHA = 0.28;
export const ROOF_FADE_DURATION_MS = 150;
export const ROOF_FADE_DURATION_SEC = ROOF_FADE_DURATION_MS / 1000; // 0.15s
export const ROOF_FADE_OUT_SPEED = 1 / ROOF_FADE_DURATION_SEC; // ~6.67 alpha/sec (1.0 -> 0.0 in 150ms)
export const ROOF_RESTORE_INSTANT = true;

export const UNEXPLORED_ROOM_SHADOW_ALPHA = 0.88;
export const EXPLORED_HIDDEN_ROOM_SHADOW_ALPHA = 0.62;

/**
 * Builds a `BuildingFootprint` for an outdoor building/ruin obstacle and optional doorway trigger.
 */
export function createBuildingFootprintFromObstacle(
  obstacle: Obstacle,
  door?: BuildingDoor,
): BuildingFootprint {
  return {
    id: obstacle.id,
    x: obstacle.x,
    y: obstacle.y,
    width: obstacle.width,
    height: obstacle.height,
    doorwayTrigger: door ? { x: door.x, y: door.y } : undefined,
    roofAlpha: 1.0,
    frontWallAlpha: 1.0,
    playerInside: false,
  };
}

/**
 * Point-in-rectangle + doorway-trigger test (`marginTiles` around footprint or within `1.35` tiles of doorway).
 */
export function isPlayerInsideFootprint(
  playerPos: Vec2,
  footprint: Pick<BuildingFootprint, 'x' | 'y' | 'width' | 'height' | 'doorwayTrigger'>,
  marginTiles = 0.65,
): boolean {
  if (footprint.doorwayTrigger) {
    const dDoor = Math.hypot(
      playerPos.x - footprint.doorwayTrigger.x,
      playerPos.y - footprint.doorwayTrigger.y,
    );
    if (dDoor <= 1.35) return true;
  }

  return (
    playerPos.x >= footprint.x - marginTiles &&
    playerPos.x <= footprint.x + footprint.width + marginTiles &&
    playerPos.y >= footprint.y - marginTiles &&
    playerPos.y <= footprint.y + footprint.height + marginTiles
  );
}

/**
 * Classifies an obstacle's wall orientation relative to its parent building footprint
 * or the player's isometric camera view.
 */
export function classifyWallOrientation(
  obstacle: Obstacle,
  buildingBounds?: Pick<BuildingFootprint, 'x' | 'y' | 'width' | 'height'>,
): WallOrientation {
  if (!buildingBounds) {
    return obstacle.width >= obstacle.height ? 'NORTH' : 'WEST';
  }
  const relX = obstacle.x - buildingBounds.x;
  const relY = obstacle.y - buildingBounds.y;
  if (relY <= 0.6) return 'NORTH';
  if (relX <= 0.6) return 'WEST';
  if (relY + obstacle.height >= buildingBounds.height - 0.6) return 'SOUTH';
  if (relX + obstacle.width >= buildingBounds.width - 0.6) return 'EAST';
  return 'INTERIOR';
}

/**
 * Updates roof and front-wall cutaway alphas for a building footprint:
 * - Crossing a building doorway or footprint fades `roofAlpha` to `0.0` over `150ms` (`0.15s`)
 *   and drops `frontWallAlpha` to `0.28`.
 * - Outdoors: restores `roofAlpha` to `1.0`.
 */
export function stepBuildingOcclusion(
  footprint: BuildingFootprint,
  playerPos: Vec2,
  dt: number,
  forceInside = false,
): BuildingFootprint {
  const inside = forceInside || isPlayerInsideFootprint(playerPos, footprint);
  footprint.playerInside = inside;

  if (inside) {
    footprint.roofAlpha = clamp(footprint.roofAlpha - ROOF_FADE_OUT_SPEED * dt, 0, 1);
    footprint.frontWallAlpha = CUTAWAY_WALL_ALPHA;
  } else {
    footprint.roofAlpha = ROOF_RESTORE_INSTANT
      ? 1
      : clamp(footprint.roofAlpha + ROOF_FADE_OUT_SPEED * dt, 0, 1);
    footprint.frontWallAlpha = 1;
  }

  return footprint;
}

/**
 * Computes the occlusion alpha `[0.28 .. 1.0]` for an individual obstacle/wall
 * relative to the player's isometric position so south/east walls behind the player
 * or north/west walls inside an active building do not obscure interior tiles.
 */
export function computeObstacleOcclusionAlpha(
  obstacle: Obstacle,
  playerPos: Vec2,
  inInterior = false,
): number {
  const cx = obstacle.x + obstacle.width * 0.5;
  const cy = obstacle.y + obstacle.height * 0.5;
  const dist = Math.hypot(cx - playerPos.x, cy - playerPos.y);

  if (inInterior && (obstacle.x <= 1.2 || obstacle.y <= 1.2)) {
    return CUTAWAY_WALL_ALPHA;
  }

  if (
    dist < 2.8 &&
    playerPos.x <= obstacle.x + obstacle.width + 0.5 &&
    playerPos.y <= obstacle.y + obstacle.height + 0.5 &&
    cx + cy > playerPos.x + playerPos.y
  ) {
    return 0.38;
  }

  return 1.0;
}

/**
 * Evaluates the raycast vision cone across interior rooms and portals (`open` doors / glass `window`s)
 * and returns the soft shadow opacity (`0.0` when visible, `0.62` when previously explored, `0.88` when unexplored).
 */
export function evaluateIndoorVisionOcclusion(
  playerPos: Vec2,
  obstacles: Obstacle[],
  rooms: InteriorRoomBounds[],
  portals: InteriorPortal[],
  zombies: ZombieState[],
  bounds?: { width: number; height: number },
): RoomVisionResult & { roomShadowAlpha: Map<string, number> } {
  const vision = calculateRoomVision(
    playerPos,
    obstacles,
    rooms,
    portals,
    zombies,
    11.5,
    72,
    bounds,
  );
  const roomShadowAlpha = new Map<string, number>();
  for (const room of rooms) {
    if (room.currentlyVisible) {
      roomShadowAlpha.set(room.id, 0.0);
    } else if (room.explored) {
      roomShadowAlpha.set(room.id, EXPLORED_HIDDEN_ROOM_SHADOW_ALPHA);
    } else {
      roomShadowAlpha.set(room.id, UNEXPLORED_ROOM_SHADOW_ALPHA);
    }
  }
  return { ...vision, roomShadowAlpha };
}

export { doesPortalBlockVision };
