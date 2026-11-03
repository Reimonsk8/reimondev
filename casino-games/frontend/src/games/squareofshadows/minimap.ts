/**
 * Geometry for the live minimap.
 *
 * The minimap is a VIEW over the authoritative board, exactly like the camera
 * window. These helpers are pure so the coordinate maths can be tested without
 * a canvas or a DOM: the component may only ever ask "which tile is under this
 * pointer?" and "where does the camera window sit inside the full floor?".
 *
 * Keeping this out of the engine is deliberate. Nothing here can influence a
 * move, an attack, or a shared room; a wrong result can only put the camera in
 * the wrong place, never change the game.
 */

import type { BoardSize, CameraWindow, Position } from './engine';

/** A DOM rectangle, in client pixels. */
export interface MinimapBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A camera window expressed as percentages of the full floor. */
export interface MinimapViewport {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

/**
 * Map a pointer inside the minimap onto a board tile.
 *
 * The minimap is stretched to the floor's aspect ratio, so a client point maps
 * proportionally to the board whatever the rendered size is. Points on or past
 * an edge clamp to the nearest real tile rather than producing an off-board
 * coordinate; the camera can then clamp to the floor without ever showing void.
 */
export const minimapTileAtPoint = (
  point: { x: number; y: number },
  box: MinimapBox,
  board: BoardSize,
): Position => {
  const width = Math.max(1, board.width);
  const height = Math.max(1, board.height);
  const relativeX = (point.x - box.left) / Math.max(1, box.width);
  const relativeY = (point.y - box.top) / Math.max(1, box.height);
  const clamp = (value: number, max: number) =>
    Math.max(0, Math.min(Math.floor(value), max));

  return {
    x: clamp(relativeX * width, width - 1),
    y: clamp(relativeY * height, height - 1),
  };
};

/**
 * The camera window as percentages of the full floor.
 *
 * The result is consumed by an absolutely positioned red outline. Percentages
 * are used rather than pixels so the box tracks the minimap when the rail
 * resizes, and so the CSS transition can animate it while the board camera
 * steps between integer tile origins.
 */
export const minimapViewport = (
  view: CameraWindow,
  board: BoardSize,
): MinimapViewport => {
  const width = Math.max(1, board.width);
  const height = Math.max(1, board.height);
  const left = Math.max(0, Math.min(view.originX, width));
  const top = Math.max(0, Math.min(view.originY, height));
  const visibleWidth = Math.max(0, Math.min(view.cols, width - left));
  const visibleHeight = Math.max(0, Math.min(view.rows, height - top));

  return {
    leftPct: (left / width) * 100,
    topPct: (top / height) * 100,
    widthPct: (visibleWidth / width) * 100,
    heightPct: (visibleHeight / height) * 100,
  };
};
