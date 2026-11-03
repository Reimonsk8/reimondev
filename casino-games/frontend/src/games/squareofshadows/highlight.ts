import type { AbilityId } from './engine';

/**
 * What a highlighted tile's effect would DO, as opposed to how far it reaches.
 *
 * The board paints two independent questions:
 *
 *   range   "this tile is inside the action you selected"
 *   impact  "this is the ground the effect would land on right now"
 *
 * Range is coloured by the action itself (move green, attack red, heal green,
 * guard blue, spell violet). Impact is coloured by the effect, so a Fireball
 * never wears Sanctified Ground's gold and a Trap never wears damage red.
 */
export type ImpactKind = 'damage' | 'boon' | 'control' | 'utility';

/**
 * Effect family for every tile-targeted ability.
 *
 * Kept as a total `Record<AbilityId, …>` so adding an ability to the engine is a
 * compile error here until its board preview has been classified — the previous
 * `is-blast` vs `is-bless-preview` pair was a binary test on one ability id, and
 * every new spell silently fell through to the red damage wash.
 */
export const IMPACT_FOR_ABILITY: Record<AbilityId, ImpactKind> = {
  FIREBALL: 'damage',
  THUNDER_STRIKE: 'damage',
  ICE_WALL: 'control',
  BLESS_GROUND: 'boon',
  TRAP: 'control',
  GRAPPLE: 'utility',
  SHIELD_SLAM: 'damage',
  HOLY_SMITE: 'damage',
  DIVINE_SHIELD: 'boon',
  HOLY_LIGHT: 'boon',
  DISSONANT_MELODY: 'damage',
  INSPIRING_ANTHEM: 'boon',
  SONG_OF_REST: 'boon',
  ELDRITCH_BOLT: 'damage',
  CURSE_OF_AGONY: 'damage',
  SOUL_DRAIN: 'damage',
  THORN_WHIP: 'damage',
  REGROWTH: 'boon',
  ROOTS_OF_ENTANGLEMENT: 'control',
  BACKSTAB: 'damage',
  SHADOW_STEP: 'utility',
  POISONED_DAGGER: 'damage',
};

export const impactKindForAbility = (ability: AbilityId): ImpactKind =>
  IMPACT_FOR_ABILITY[ability];
