/**
 * Which travelling sprite (if any) a class uses for its basic attack.
 *
 * The engine's `RANGER_SHOT` event is misnamed: it is the generic *tile attack*
 * command and **every** class can emit it — `legalRangerShotTargetsFor` returns
 * all in-range non-stone tiles regardless of who is attacking. So the renderer
 * must never infer the sprite from the event name; doing so made every class
 * fire an arrow. Always resolve it from the acting unit's class instead.
 *
 * `null` is the right answer for the monsters' melee, and it is deliberate: a
 * Beast's claw is a lunge and a hit at the target, not something that travels.
 * A Spitter's spit IS a projectile, so it gets the bolt.
 *
 * Returns `null` for an unknown class so callers fall back to a lunge-only
 * attack with no projectile.
 */
export const attackLinkFor = (
  unitType: string | undefined,
): 'arrow' | 'firebolt' | 'slash' | 'acidbolt' | null => {
  switch (unitType) {
    case 'RANGER':
      return 'arrow';
    case 'WIZARD':
      return 'firebolt';
    case 'SPITTER':
      return 'acidbolt';
    case 'WARRIOR':
    case 'CLERIC':
    case 'BEAST':
      return 'slash';
    default:
      return null;
  }
};