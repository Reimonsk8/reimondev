import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  activeZoneTiles,
  MONSTER_TEAM_ID,
  positionKey,
} from './engine';
import type { CameraWindow, GameState, Position, UnitType } from './engine';
import { minimapTileAtPoint, minimapViewport } from './minimap';
import { floorToneIndexFor } from './terrainTheme';

interface SosMinimapProps {
  state: GameState;
  /** The board rectangle currently drawn by the main camera. */
  view: CameraWindow;
  /** Whose squad reads as friendly in a duel. Adventure treats both squads as allied. */
  squadOwnerId: string;
  isAdventure: boolean;
  /** Class colours shared with the main board, so the minimap cannot drift from it. */
  unitColors: Record<UnitType, string>;
  /** Centre the main camera on a floor tile. */
  onNavigate: (tile: Position) => void;
}

/**
 * Live overhead map for the free-camera state.
 *
 * This is a canvas rather than a grid of DOM tiles: the whole floor is redrawn
 * whenever the authoritative state changes, while the camera window is a DOM
 * outline above it. That split matters — the canvas is the expensive part and
 * does not need to redraw while the camera steps, and the outline can use a CSS
 * transition to glide between integer tile origins.
 *
 * It is purely a view. Clicking it only moves `manualViewOrigin` in the React
 * component; it never dispatches a game command or touches a shared room.
 */
export function SosMinimap({
  state,
  view,
  squadOwnerId,
  isAdventure,
  unitColors,
  onNavigate,
}: SosMinimapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragPointerRef = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  /*
   * The preview is sized by CSS (a `cqw`/`cqh` fit, so a 20x20 floor stays
   * square inside a tall rail). A ResizeObserver is what turns that layout into
   * a canvas backing-store size; without it the first paint is a 300x150
   * default canvas stretched by CSS.
   */
  useLayoutEffect(() => {
    // Measure the canvas, not the map frame: the frame has a 1px border, and
    // drawing to the border-box width would scale the map by a couple of
    // pixels against the outline sitting inside the same frame.
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const update = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.round(rect.width * 100) / 100;
      const height = Math.round(rect.height * 100) / 100;
      setSize((previous) =>
        Math.abs(previous.width - width) < 0.5 && Math.abs(previous.height - height) < 0.5
          ? previous
          : { width, height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(size.width * dpr));
    const pixelHeight = Math.max(1, Math.round(size.height * dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const board = state.boardSize;
    const tileWidth = size.width / Math.max(1, board.width);
    const tileHeight = size.height / Math.max(1, board.height);
    const floorSeed = state.mapSeed ?? 0;
    const floorTones = ['#17121f', '#1b1526', '#20192c'];

    const ice = new Set(state.iceWalls.map((wall) => positionKey(wall)));
    const traps = new Set(state.traps.map((trap) => positionKey(trap)));
    const holy = new Set<string>();
    for (const zone of state.zones) {
      for (const tile of activeZoneTiles(state, zone)) holy.add(positionKey(tile));
    }

    ctx.fillStyle = '#07060d';
    ctx.fillRect(0, 0, size.width, size.height);

    /*
     * Terrain first. Walls are deliberately lighter than floor and carry a
     * bright top edge, so a room reads as rooms at a glance instead of as a
     * field of identical dark squares.
     */
    for (let y = 0; y < board.height; y += 1) {
      for (let x = 0; x < board.width; x += 1) {
        const key = positionKey({ x, y });
        const wall = state.terrain.get(key) === 'WALL';
        const frozen = ice.has(key);
        const left = x * tileWidth;
        const top = y * tileHeight;

        if (wall) {
          ctx.fillStyle = '#3b3550';
        } else if (frozen) {
          ctx.fillStyle = '#155e75';
        } else {
          ctx.fillStyle = floorTones[floorToneIndexFor(x, y, floorSeed) % floorTones.length];
        }
        // A hair of overdraw closes sub-pixel seams between adjacent tiles.
        ctx.fillRect(left, top, tileWidth + 0.35, tileHeight + 0.35);

        if (wall) {
          ctx.fillStyle = 'rgba(190, 181, 218, 0.2)';
          ctx.fillRect(left, top, tileWidth + 0.35, Math.max(1, tileHeight * 0.12));
        }
        if (holy.has(key)) {
          ctx.fillStyle = 'rgba(250, 204, 21, 0.15)';
          ctx.fillRect(left, top, tileWidth + 0.35, tileHeight + 0.35);
        }
        if (traps.has(key)) {
          ctx.fillStyle = '#fb923c';
          const dot = Math.max(1, Math.min(tileWidth, tileHeight) * 0.12);
          ctx.fillRect(left + tileWidth / 2 - dot / 2, top + tileHeight / 2 - dot / 2, dot, dot);
        }
      }
    }

    /*
     * Units last so they never disappear under terrain. Allies keep their class
     * colour; hostiles are a single warning red diamond in every mode. In
     * Adventure both player squads are allies — the monsters are the enemy —
     * which matches the main board's three-way team treatment.
     */
    const radius = Math.max(2.4, Math.min(tileWidth, tileHeight) * 0.3);
    for (const unit of state.units.values()) {
      if (unit.stats.currentHp <= 0) continue;
      const ally = isAdventure
        ? unit.ownerId !== MONSTER_TEAM_ID
        : unit.ownerId === squadOwnerId;
      const cx = (unit.position.x + 0.5) * tileWidth;
      const cy = (unit.position.y + 0.5) * tileHeight;
      ctx.beginPath();
      if (ally) {
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      } else {
        ctx.moveTo(cx, cy - radius);
        ctx.lineTo(cx + radius, cy);
        ctx.lineTo(cx, cy + radius);
        ctx.lineTo(cx - radius, cy);
        ctx.closePath();
      }
      ctx.fillStyle = ally ? unitColors[unit.type] ?? '#94a3b8' : '#ef4444';
      ctx.fill();
      ctx.lineWidth = Math.max(1, radius * 0.36);
      ctx.strokeStyle = ally ? 'rgba(255, 255, 255, 0.88)' : 'rgba(32, 6, 6, 0.92)';
      ctx.stroke();
    }
  }, [state, squadOwnerId, isAdventure, unitColors, size.width, size.height]);

  const navigateFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const map = mapRef.current;
    if (!map) return;
    const rect = map.getBoundingClientRect();
    onNavigate(
      minimapTileAtPoint(
        { x: event.clientX, y: event.clientY },
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        state.boardSize,
      ),
    );
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragPointerRef.current = event.pointerId;
    navigateFromPointer(event);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    navigateFromPointer(event);
  };

  const releasePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerRef.current !== event.pointerId) return;
    dragPointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const viewport = minimapViewport(view, state.boardSize);
  const stageStyle = {
    '--sos-minimap-cols': String(state.boardSize.width),
    '--sos-minimap-rows': String(state.boardSize.height),
  } as CSSProperties;
  const viewportStyle: CSSProperties = {
    left: `${viewport.leftPct}%`,
    top: `${viewport.topPct}%`,
    width: `${viewport.widthPct}%`,
    height: `${viewport.heightPct}%`,
  };

  return (
    <div className="sos-minimap">
      <div className="sos-minimap-stage" style={stageStyle}>
        <div
          ref={mapRef}
          className="sos-minimap-map"
          role="group"
          aria-label={`Tactical minimap, ${state.boardSize.width} by ${state.boardSize.height} tiles. Click or drag to move the camera.`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
          onLostPointerCapture={() => {
            dragPointerRef.current = null;
          }}
        >
          <canvas ref={canvasRef} className="sos-minimap-canvas" aria-hidden="true" />
          {/* The red camera box is DOM, not canvas: it can transition smoothly
              while the board camera steps from one integer origin to the next. */}
          <span className="sos-minimap-viewport" style={viewportStyle} aria-hidden="true" />
        </div>
      </div>
      <p className="sos-minimap-hint">
        Click or drag to move the camera. Select a squad member above to act.
      </p>
    </div>
  );
}
