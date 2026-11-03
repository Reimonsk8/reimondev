import { describe, expect, it } from 'vitest';
import {
  BOARD_VIEW_SIZES,
  DEFAULT_BOARD_VIEW_SIZE,
  boardViewDimensions,
  parseBoardViewSize,
  readBoardViewSize,
  writeBoardViewSize,
} from './boardView';

describe('board view size', () => {
  it('offers every square window from 3 through 11 for the range control', () => {
    expect([...BOARD_VIEW_SIZES]).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('defaults to 10x10', () => {
    expect(DEFAULT_BOARD_VIEW_SIZE).toBe(10);
    expect(boardViewDimensions(DEFAULT_BOARD_VIEW_SIZE)).toEqual({ width: 10, height: 10 });
  });

  it('turns every offered size into a square board window', () => {
    for (const size of BOARD_VIEW_SIZES) {
      expect(boardViewDimensions(size)).toEqual({ width: size, height: size });
    }
  });

  it('accepts every in-range integer from storage and recovers from junk', () => {
    for (const size of BOARD_VIEW_SIZES) {
      expect(parseBoardViewSize(String(size))).toBe(size);
      expect(parseBoardViewSize(size)).toBe(size);
    }
    for (const bad of ['', '2', '12', '11x11', 'null', null, undefined, NaN]) {
      expect(parseBoardViewSize(bad)).toBe(DEFAULT_BOARD_VIEW_SIZE);
    }
  });

  it('round-trips the player choice through localStorage', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    } as unknown as Storage;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    try {
      expect(readBoardViewSize()).toBe(DEFAULT_BOARD_VIEW_SIZE);
      writeBoardViewSize(7);
      expect(readBoardViewSize()).toBe(7);
      writeBoardViewSize(5);
      expect(readBoardViewSize()).toBe(5);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
      else delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    }
  });
});
