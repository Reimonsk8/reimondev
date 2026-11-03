import { clamp, distance, normalize } from './isometric';
import type {
  OutpostId,
  OutpostInfo,
  SectorCell,
  ThreatTier,
  Vec2,
  WorldMap,
} from './types';
import {
  CHUNK_SIZE,
  OUTPOSTS,
  SAFE_CENTER,
  SAFE_RADIUS,
  SECTOR_SIZE,
  buildSectorGrid,
  chunkCodeFor,
  chunkCoordAt,
  chunkThreatTier,
  regionNameForChunk,
} from './world';

/**
 * Authentic Dead Frontier 3x3 Sector Map & Safe-Zone Compass Engine (`/engine/map.ts`).
 *
 * Directive 2:
 * - Provides a clean, grid-aligned 3x3 Sector Matrix centered on the player's current block.
 * - Formats sector readouts (`Block B2: Nastya's Holdout`) and maps Threat Tiers (0..3)
 *   from Safe Sanctuary Green (`#22c55e`) to Dark Crimson (`#7f1d1d`).
 * - Computes directional bearings and tile/meter distances to all Safe Outposts
 *   (`Nastya's Holdout`, `Fort Pastor`, `Secronom Bunker`).
 */
export const TIER_COLOR_PALETTE: Record<
  ThreatTier,
  {
    tier: ThreatTier;
    label: string;
    shortLabel: string;
    fillHex: string;
    borderHex: string;
    badgeHex: string;
  }
> = {
  0: {
    tier: 0,
    label: 'Tier 0 · Safe Sanctuary',
    shortLabel: 'SAFE',
    fillHex: '#0b291e',
    borderHex: '#22c55e',
    badgeHex: '#4ade80',
  },
  1: {
    tier: 1,
    label: 'Tier I · Low Danger',
    shortLabel: 'T-I',
    fillHex: '#27200c',
    borderHex: '#eab308',
    badgeHex: '#facc15',
  },
  2: {
    tier: 2,
    label: 'Tier II · High Danger',
    shortLabel: 'T-II',
    fillHex: '#2c150c',
    borderHex: '#ea580c',
    badgeHex: '#fb923c',
  },
  3: {
    tier: 3,
    label: 'Tier III · Red Zone',
    shortLabel: 'T-III',
    fillHex: '#2b090d',
    borderHex: '#991b1b',
    badgeHex: '#f87171',
  },
};

export type CompassCardinal = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface SafeZoneDirectionalMarker {
  outpostId: OutpostId;
  name: string;
  sectorCode: string;
  tier: ThreatTier;
  distanceMeters: number;
  bearingRad: number;
  bearingDeg: number;
  cardinal: CompassCardinal;
  directionVector: Vec2;
  insidePerimeter: boolean;
}

export interface SectorMapSnapshot {
  currentCode: string;
  currentName: string;
  formattedHeader: string;
  currentTier: ThreatTier;
  inSafeZone: boolean;
  playerRelativePercent: Vec2;
  cells: SectorCell[];
  safeZoneMarkers: SafeZoneDirectionalMarker[];
  nearestSafeZone: SafeZoneDirectionalMarker;
}

/**
 * Converts a world-space radian angle into an 8-way compass cardinal (`N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`).
 */
export function angleToCardinal(angleRad: number): CompassCardinal {
  const deg = (((angleRad * 180) / Math.PI) % 360 + 360) % 360;
  if (deg >= 337.5 || deg < 22.5) return 'E';
  if (deg >= 22.5 && deg < 67.5) return 'SE';
  if (deg >= 67.5 && deg < 112.5) return 'S';
  if (deg >= 112.5 && deg < 157.5) return 'SW';
  if (deg >= 157.5 && deg < 202.5) return 'W';
  if (deg >= 202.5 && deg < 247.5) return 'NW';
  if (deg >= 247.5 && deg < 292.5) return 'N';
  return 'NE';
}

/**
 * Formats the canonical sector title (`Block B2: Nastya's Holdout`).
 */
export function formatSectorTitle(code: string, name: string): string {
  const cleanName = name.replace(/\s*\(S-Zone\)\s*/i, '');
  return `Block ${code}: ${cleanName}`;
}

/**
 * Computes directional markers and distances from `playerPos` to all Safe Outposts.
 */
export function computeSafeZoneMarkers(
  playerPos: Vec2,
  outposts: OutpostInfo[] = OUTPOSTS,
): SafeZoneDirectionalMarker[] {
  const markers = outposts.map((op) => {
    const dx = op.x - playerPos.x;
    const dy = op.y - playerPos.y;
    const rawDist = distance(playerPos, op);
    const insidePerimeter = rawDist <= op.radius;
    const distOutside = Math.max(0, rawDist - op.radius);
    const distanceMeters = Math.round(distOutside * 20);
    const bearingRad = Math.atan2(dy, dx);
    const bearingDeg = Math.round((((bearingRad * 180) / Math.PI) % 360 + 360) % 360);
    const dir = normalize({ x: dx, y: dy });
    const cx = chunkCoordAt(op.x);
    const cy = chunkCoordAt(op.y);

    return {
      outpostId: op.id,
      name: op.name,
      sectorCode: chunkCodeFor(cx, cy),
      tier: op.tier,
      distanceMeters,
      bearingRad,
      bearingDeg,
      cardinal: angleToCardinal(bearingRad),
      directionVector: dir,
      insidePerimeter,
    };
  });

  return markers.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/**
 * Builds the complete 3x3 Sector Minimap snapshot for the player's world coordinates.
 */
export function computeSectorMapSnapshot(
  playerPos: Vec2,
  map?: Pick<WorldMap, 'outposts'>,
): SectorMapSnapshot {
  const cx = chunkCoordAt(playerPos.x);
  const cy = chunkCoordAt(playerPos.y);
  const currentCode = chunkCodeFor(cx, cy);
  const currentName = regionNameForChunk(cx, cy);
  const currentTier = chunkThreatTier(cx, cy);
  const cells = buildSectorGrid(cx, cy);

  const originX = cx * SECTOR_SIZE;
  const originY = cy * SECTOR_SIZE;
  const relX = clamp(((playerPos.x - originX) / CHUNK_SIZE) * 100, 8, 92);
  const relY = clamp(((playerPos.y - originY) / CHUNK_SIZE) * 100, 8, 92);

  const safeZoneMarkers = computeSafeZoneMarkers(playerPos, map?.outposts ?? OUTPOSTS);
  const nearestSafeZone = safeZoneMarkers[0] ?? {
    outpostId: 'nastya',
    name: "Nastya's Holdout",
    sectorCode: 'B2',
    tier: 0,
    distanceMeters: Math.round(Math.max(0, distance(playerPos, SAFE_CENTER) - SAFE_RADIUS) * 20),
    bearingRad: 0,
    bearingDeg: 0,
    cardinal: 'N',
    directionVector: { x: 0, y: -1 },
    insidePerimeter: distance(playerPos, SAFE_CENTER) <= SAFE_RADIUS,
  };

  return {
    currentCode,
    currentName,
    formattedHeader: formatSectorTitle(currentCode, currentName),
    currentTier,
    inSafeZone: nearestSafeZone.insidePerimeter,
    playerRelativePercent: { x: relX, y: relY },
    cells,
    safeZoneMarkers,
    nearestSafeZone,
  };
}
