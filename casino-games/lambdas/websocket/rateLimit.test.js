import { beforeEach, describe, expect, it, vi } from 'vitest';
import utils from './utils.js';

describe('cheap websocket action throttle', () => {
  beforeEach(() => utils.clearLocalActionTimes());

  it('limits repeated action per connection without coupling other actions or users', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    expect(utils.allowLocalAction('a', 'move', 50)).toBe(true);
    expect(utils.allowLocalAction('a', 'move', 50)).toBe(false);
    expect(utils.allowLocalAction('a', 'piano', 50)).toBe(true);
    expect(utils.allowLocalAction('b', 'move', 50)).toBe(true);
    vi.advanceTimersByTime(50);
    expect(utils.allowLocalAction('a', 'move', 50)).toBe(true);
    vi.useRealTimers();
  });
});
