import {
   computeSectorMapSnapshot,
  formatSectorTitle,
  TIER_COLOR_PALETTE,
} from '../engine/map';
import type { SectorCell, ThreatTier } from '../engine/types';

/**
 * Authentic 3x3 Sector Minimap (`/ui/Minimap.tsx`).
 *
 * Directive 2:
 * - Clean, grid-aligned 3x3 Sector Minimap in the top-right corner.
 * - Displays the player's current sector code (`Block B2: Nastya's Holdout`),
 *   adjacent sector danger levels (Tier 0 to Tier 3 color-coded from green to dark crimson),
 *   and directional markers for nearby safe zones.
 * - Crisp pixel-aligned borders with zero blurry vector gradients.
 */
export interface MinimapProps {
  playerX: number;
  playerY: number;
  sectorCode?: string;
  sectorName?: string;
  threatTier?: ThreatTier;
  inSafeZone?: boolean;
  sectors?: SectorCell[];
  onOpenFullMap?: () => void;
}

export function Minimap({
  playerX,
  playerY,
  sectorCode,
  sectorName,
  sectors,
  onOpenFullMap,
}: MinimapProps) {
  const snapshot = computeSectorMapSnapshot({ x: playerX, y: playerY });
  const activeCode = sectorCode ?? snapshot.currentCode;
  const activeName = sectorName ?? snapshot.currentName;
  const headerTitle = formatSectorTitle(activeCode, activeName);
  const gridCells = sectors && sectors.length === 9 ? sectors : snapshot.cells;
  const nearestSafe = snapshot.nearestSafeZone;

  return (
    <div
      className="outlands-minimap"
      onClick={onOpenFullMap}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenFullMap?.();
        }
      }}
      title="Click or press [M] to open 3x3 Sector Atlas"
      style={{ imageRendering: 'pixelated' }}
    >
      {/* Top Sector Header (`Block B2: Nastya's Holdout`) */}
      <div className="outlands-minimap-head">
        <span className="outlands-minimap-code">BLOCK {activeCode}</span>
        <strong className="outlands-minimap-title">{headerTitle}</strong>
      </div>

      {/* 3x3 Sector Grid Color-Coded Tier 0 (Green) -> Tier 3 (Dark Crimson) */}
      <div className="outlands-minimap-grid">
        {gridCells.map((cell) => {
          const isCurrent = cell.code === activeCode;
          const palette = TIER_COLOR_PALETTE[cell.tier];
          const relX = Math.max(
            12,
            Math.min(88, ((playerX - cell.x) / Math.max(1, cell.width)) * 100),
          );
          const relY = Math.max(
            12,
            Math.min(88, ((playerY - cell.y) / Math.max(1, cell.height)) * 100),
          );

          return (
            <div
              key={cell.code}
              className={`outlands-minimap-cell tier-${cell.tier} ${cell.isSafeZone ? 'is-safe' : ''} ${isCurrent ? 'is-current' : ''}`}
              style={{
                backgroundColor: palette.fillHex,
                borderColor: isCurrent ? '#f8fafc' : palette.borderHex,
              }}
            >
              <span
                className="outlands-minimap-cell-code"
                style={{ color: palette.badgeHex }}
              >
                {cell.code}
              </span>
              <small
                className="outlands-minimap-cell-tier"
                style={{
                  color: palette.badgeHex,
                  fontSize: '0.52rem',
                  lineHeight: 1,
                }}
              >
                {cell.isSafeZone ? 'SAFE' : palette.shortLabel}
              </small>
              {isCurrent && (
                <i
                  className="outlands-minimap-dot"
                  style={{
                    left: `${relX}%`,
                    top: `${relY}%`,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Directional Safe-Zone Beacon Strip */}
      <div
        className="outlands-minimap-safe-strip"
        style={{
          marginTop: 5,
          paddingTop: 4,
          borderTop: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.62rem',
          color: nearestSafe.insidePerimeter ? '#4ade80' : '#cbd5e1',
        }}
      >
        <span>
          {nearestSafe.insidePerimeter
            ? `SAFE: ${nearestSafe.name}`
            : `S-ZONE [${nearestSafe.sectorCode}]`}
        </span>
        <strong style={{ color: '#4ade80' }}>
          {nearestSafe.insidePerimeter
            ? 'INSIDE'
            : `${nearestSafe.cardinal} · ${nearestSafe.distanceMeters}m`}
        </strong>
      </div>
    </div>
  );
}
