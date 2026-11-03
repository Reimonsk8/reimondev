import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAudioPrefs, MUSIC_FADE_SECONDS, MUSIC_SFX_RATIO, MUSIC_TRACK_URLS } from './audio';

describe('Square of Shadows music', () => {
  it('defaults new players to music on', () => {
    expect(getAudioPrefs()).toEqual({ sfx: true, music: true, sfxVolume: 100, musicVolume: 40 });
  });

  it('keeps music at forty percent of the SFX bus and uses compressed public tracks', () => {
    expect(MUSIC_SFX_RATIO).toBe(0.4);
    expect(MUSIC_FADE_SECONDS).toBe(2);
    expect(MUSIC_TRACK_URLS.menu).toMatch(/\.mp3$/);
    expect(MUSIC_TRACK_URLS.battle).toMatch(/\.mp3$/);
    expect(readFileSync('frontend/public/audio/square-of-shadows/menu-loop.mp3').length).toBeLessThan(1_500_000);
    expect(readFileSync('frontend/public/audio/square-of-shadows/battle-loop.mp3').length).toBeLessThan(4_500_000);
  });
});
