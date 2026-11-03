import { CHUNK_SIZE } from './world';
import { clamp, screenToWorld as isoScreenToWorld, worldToScreen } from './isometric';
import type { Vec2 } from './types';

export const CAMERA_ZOOM = 2.0;
/**
 * Scale down more aggressively on phone viewports to preserve a wider tactical
 * field of view. Desktop retains the established 2x presentation.
 */
export function zoomForViewport(width: number, height: number): number {
  const shortSide = Math.min(width, height);
  if (shortSide >= 900) return CAMERA_ZOOM;
  return clamp(shortSide / 480, 0.75, CAMERA_ZOOM);
}
export const CHUNK_STREAM_RADIUS = 2;
export const CHUNK_CULL_MARGIN = 2;
export const VIEWPORT_EDGE_MASK_PX = 96;

export interface CameraTransform {
  zoom: number;
  focusScreen: Vec2;
  rootPosition: Vec2;
  worldMin: Vec2;
  worldMax: Vec2;
}

export interface ChunkStreamingBounds {
  centerChunkX: number;
  centerChunkY: number;
  streamRadius: number;
  unloadRadius: number;
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
}

/**
 * Computes a tight 2.0x camera transform centered strictly on the player's
 * isometric world coordinates, plus world-space culling bounds padded beyond
 * the viewport so chunk loading seams never appear on screen.
 */
export function computeCameraTransform(
  playerWorld: Vec2,
  viewportWidth: number,
  viewportHeight: number,
  shakeOffset: Vec2 = { x: 0, y: 0 },
  zoom: number = CAMERA_ZOOM,
): CameraTransform {
  const safeZoom = clamp(zoom, 0.5, 4.0);
  const focusScreen = worldToScreen(playerWorld.x, playerWorld.y);

  const rootPosition: Vec2 = {
    x: Math.round(viewportWidth * 0.5 - focusScreen.x * safeZoom + shakeOffset.x),
    y: Math.round(viewportHeight * 0.5 - focusScreen.y * safeZoom + shakeOffset.y),
  };

  const padX = VIEWPORT_EDGE_MASK_PX;
  const padY = VIEWPORT_EDGE_MASK_PX;
  const corners = [
    screenToWorldWithCamera(-padX, -padY, rootPosition, safeZoom),
    screenToWorldWithCamera(viewportWidth + padX, -padY, rootPosition, safeZoom),
    screenToWorldWithCamera(viewportWidth + padX, viewportHeight + padY, rootPosition, safeZoom),
    screenToWorldWithCamera(-padX, viewportHeight + padY, rootPosition, safeZoom),
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }

  return {
    zoom: safeZoom,
    focusScreen,
    rootPosition,
    worldMin: { x: minX - CHUNK_CULL_MARGIN, y: minY - CHUNK_CULL_MARGIN },
    worldMax: { x: maxX + CHUNK_CULL_MARGIN, y: maxY + CHUNK_CULL_MARGIN },
  };
}

/**
 * Converts a screen-space pointer coordinate to world-space tile coordinates
 * accounting for the active camera zoom (`2.0x`) and `worldRoot` offset.
 */
export function screenToWorldWithCamera(
  screenX: number,
  screenY: number,
  rootPosition: Vec2,
  zoom: number = CAMERA_ZOOM,
): Vec2 {
  const invZoom = 1 / Math.max(0.25, zoom);
  const localX = (screenX - rootPosition.x) * invZoom;
  const localY = (screenY - rootPosition.y) * invZoom;
  return isoScreenToWorld(localX, localY);
}

/**
 * Converts a world-space coordinate into final viewport pixel coordinates
 * under the active camera transform (`2.0x` zoom + root translation).
 */
export function worldToViewportScreen(
  worldX: number,
  worldY: number,
  rootPosition: Vec2,
  zoom: number = CAMERA_ZOOM,
): Vec2 {
  const local = worldToScreen(worldX, worldY);
  return {
    x: rootPosition.x + local.x * zoom,
    y: rootPosition.y + local.y * zoom,
  };
}

/**
 * Calculates chunk streaming and unloading bounds so chunk boundaries are
 * always loaded well outside the visible 2.0x viewport.
 */
export function getChunkStreamingBounds(
  playerX: number,
  playerY: number,
  viewportWidth = 1920,
  viewportHeight = 1080,
  zoom: number = CAMERA_ZOOM,
): ChunkStreamingBounds {
  const centerChunkX = Math.floor(playerX / CHUNK_SIZE);
  const centerChunkY = Math.floor(playerY / CHUNK_SIZE);
  const halfSpanPx = Math.hypot(viewportWidth * 0.5, viewportHeight * 0.5) + VIEWPORT_EDGE_MASK_PX * 2;
  const approxVisibleTiles = halfSpanPx / (16 * Math.max(0.5, zoom));
  const neededRadius = Math.ceil(approxVisibleTiles / CHUNK_SIZE) + 1;
  const streamRadius = Math.max(CHUNK_STREAM_RADIUS, neededRadius);
  const unloadRadius = streamRadius + CHUNK_CULL_MARGIN;

  return {
    centerChunkX,
    centerChunkY,
    streamRadius,
    unloadRadius,
    minChunkX: centerChunkX - streamRadius,
    maxChunkX: centerChunkX + streamRadius,
    minChunkY: centerChunkY - streamRadius,
    maxChunkY: centerChunkY + streamRadius,
  };
}
