/**
 * How much of the tactical map is drawn at once.
 *
 * This is a VIEW setting, not a map-generation setting. Arena is always 12x10
 * and Adventure is always 20x20; the selected size is the camera window placed
 * over that floor. Keeping it out of `GameState` is deliberate: two online
 * players may want different zoom levels on the same authoritative board, and
 * a view preference must never be serialized into a room.
 */

import type { BoardSize } from './engine';

/** Square tactical camera windows offered by the 3–11 range control. */
export const BOARD_VIEW_SIZES = [3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

export type BoardViewSize = (typeof BOARD_VIEW_SIZES)[number];

/**
 * 10x10 is the default everywhere.
 *
 * It is the widest window that still fits the 12x10 Arena without hiding more
 * than one row, and it gives the 20x20 Adventure floor enough context to read.
 * The odd sizes remain available for a tighter tactical read, and 3x3 is the
 * close-up view.
 */
export const DEFAULT_BOARD_VIEW_SIZE: BoardViewSize = 10;

// Bumped with the 10x10 default: an old entry would otherwise keep pinning a
// returning player to the previous window and the new default would never show.
const STORAGE_KEY = 'c888_sos_board_view_size_v2';

/** The square `BoardSize` a camera window of `size` draws. */
export const boardViewDimensions = (size: BoardViewSize): BoardSize => ({
  width: size,
  height: size,
});

/**
 * Coerce stored/hand-written values onto the offered range.
 *
 * `localStorage` is user-editable, so a stale or corrupted value must fall back
 * to the default rather than producing a 0-wide grid or an off-list window.
 */
export const parseBoardViewSize = (value: unknown): BoardViewSize => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return BOARD_VIEW_SIZES.find((size) => size === numeric) ?? DEFAULT_BOARD_VIEW_SIZE;
};

/** Read the player's last choice, falling back to the default when storage is unavailable. */
export const readBoardViewSize = (): BoardViewSize => {
  if (typeof localStorage === 'undefined') return DEFAULT_BOARD_VIEW_SIZE;
  try {
    return parseBoardViewSize(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Private browsing / blocked storage: a missing preference is not an error.
    return DEFAULT_BOARD_VIEW_SIZE;
  }
};

/** Persist the choice. Storage failures are non-fatal and leave the default in place. */
export const writeBoardViewSize = (size: BoardViewSize): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    // Same as read: the camera still works for this session.
  }
};
