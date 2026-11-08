import { describe, expect, it } from 'vitest';
import { GAMES, PLATFORM_NAME, gameById, gameByPath } from './catalog';

describe('platform catalog', () => {
  it('has a platform name and tagline', () => {
    expect(PLATFORM_NAME.length).toBeGreaterThan(0);
  });

  it('lists only Square of Shadows and Zombie Shooter', () => {
    expect(GAMES.map((game) => game.id)).toEqual(['square-of-shadows', 'outlands']);
    expect(GAMES).toHaveLength(2);
  });

  it('uses unique ids and canonical absolute paths', () => {
    const ids = GAMES.map((game) => game.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const game of GAMES) {
      expect(game.path.startsWith('/')).toBe(true);
      expect(game.path.endsWith('/')).toBe(false);
      expect(game.title.length).toBeGreaterThan(0);
      expect(game.icon.length).toBeGreaterThan(0);
      expect(game.accent.length).toBeGreaterThan(0);
      expect(['sos', 'outlands']).toContain(game.theme);
      expect(['live', 'soon']).toContain(game.status);
    }
  });

  it('resolves games by id and by path', () => {
    expect(gameById('square-of-shadows')?.path).toBe('/square-of-shadows');
    expect(gameByPath('/outlands')?.id).toBe('outlands');
    expect(gameById('does-not-exist')).toBeUndefined();
    expect(gameByPath('/nope')).toBeUndefined();
  });
});
