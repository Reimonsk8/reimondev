import type { CSSProperties } from 'react';
import { PIXEL_FX, type PixelFxSlug } from '../pixelFx.generated';
import { publicAsset } from '../../utils/publicAsset';

/**
 * Square of Shadows spell VFX, generated from pixelfx (see scripts/vfx/).
 *
 * `SOS_PIXEL_FX` maps a spell ability to a generated strip. Anything absent
 * falls back to the hand-drawn `sos-vfx-*` art, so this can be adopted one
 * ability at a time.
 */
export const SOS_PIXEL_FX: Record<string, PixelFxSlug> = {
  SLASH: 'slash',
  BACKSTAB: 'slash',
  FIREBALL: 'fireball',
  THUNDER_STRIKE: 'thunder-strike',
  ICE_WALL: 'frost-nova',
  ICE_RISE: 'frost-nova',
  HEAL: 'heal',
  HOLY_LIGHT: 'heal',
  BLESS_GROUND: 'heal-aoe',
  SONG_OF_REST: 'heal-aoe',
  HOLY_SIGIL: 'holy-pillar',
  TRAP: 'earth-spike',
  TRAP_SPRING: 'earth-spike',
  SHIELD_SLAM: 'ground-slam',
  HOLY_SMITE: 'holy-smite',
  DIVINE_SHIELD: 'divine-shield',
  THORN_WHIP: 'vine-whip',
  ROOTS_OF_ENTANGLEMENT: 'root-snare',
  CURSE_OF_AGONY: 'curse',
  POISONED_DAGGER: 'poisoned',
};

/**
 * How wide each effect is drawn, in CSS pixels. The board tile is ~48px on a
 * desktop layout, so single-target hits stay around one tile and area spells
 * deliberately spill across their neighbours.
 */
const SOS_PIXEL_FX_WIDTH: Partial<Record<PixelFxSlug, number>> = {
  slash: 72,
  fireball: 84,
  'thunder-strike': 132,
  'frost-nova': 120,
  heal: 60,
  'heal-aoe': 116,
  'holy-pillar': 120,
  'earth-spike': 116,
  'ground-slam': 120,
  'holy-smite': 128,
  'divine-shield': 64,
  'vine-whip': 116,
  'root-snare': 92,
  curse: 76,
  poisoned: 48,
};

/**
 * Inline style for a pixelfx strip: a CSS `steps()` animation across the
 * horizontal sheet, anchored by the effect's own pivot so it lands on the tile
 * rather than being naively centred.
 */
export function sosPixelFxStyle(slug: PixelFxSlug): CSSProperties {
  const meta = PIXEL_FX[slug];
  const width = SOS_PIXEL_FX_WIDTH[slug] ?? meta.frameWidth;
  const scale = width / meta.frameWidth;
  const [pivotX, pivotY] = meta.pivot;

  return {
    backgroundImage: `url(${publicAsset(`/sprites/vfx/${slug}/strip.png`)})`,
    width: `${width}px`,
    height: `${meta.frameHeight * scale}px`,
    transform: `translate(${-pivotX * scale}px, ${-pivotY * scale}px)`,
    backgroundSize: `${meta.frames * 100}% 100%`,
    animationName: 'sos-pixelfx-strip',
    animationDuration: `${meta.durationMs}ms`,
    // N frames need N stops across 0→100%; `jump-none` keeps both end frames.
    animationTimingFunction: `steps(${meta.frames}, jump-none)`,
    // Spell bursts are transient even when the source effect is a loop.
    animationIterationCount: '1',
    animationFillMode: 'forwards',
  };
}
