import { describe, expect, it } from 'vitest';
import { GAMES, PLATFORM_NAME, gameById, gameByPath } from './catalog';

describe('platform catalog', () => {
  it('has a platform name and tagline', () => {
    expect(PLATFORM_NAME.length).toBeGreaterThan(0);
  });

  it('lists the launch games', () => {
    const ids = GAMES.map((game) => game.id);
    expect(ids).toEqual(
      expect.arrayContaining(['square-of-shadows', 'casino', 'arcade', 'outlands']),
    );
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
      expect(['casino', 'sos', 'arcade', 'outlands']).toContain(game.theme);
      expect(['live', 'soon']).toContain(game.status);
    }
  });

  it('resolves games by id and by path', () => {
    expect(gameById('casino')?.path).toBe('/casino');
    expect(gameByPath('/arcade')?.id).toBe('arcade');
    expect(gameById('does-not-exist')).toBeUndefined();
    expect(gameByPath('/nope')).toBeUndefined();
  });
});
