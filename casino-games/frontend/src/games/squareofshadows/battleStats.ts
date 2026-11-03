import type { GameEvent } from './engine/protocol';
import type { GameState } from './engine/types';

export interface BattleStats {
  damageDealt: number;
  damageTaken: number;
  kills: number;
  losses: number;
  /** HP restored to living members of your squad. */
  healed: number;
  abilities: number;
  rounds: number;
  /** Souls spent at the Altar of Shadows — one per wish. */
  soulsSpent: number;
}

export const emptyBattleStats = (): BattleStats => ({
  damageDealt: 0,
  damageTaken: 0,
  kills: 0,
  losses: 0,
  healed: 0,
  abilities: 0,
  rounds: 0,
  soulsSpent: 0,
});

/** Add one committed event batch to the player's match totals. */
export const tallyBattleStats = (
  current: BattleStats,
  events: GameEvent[],
  state: GameState,
  playerId: string,
): BattleStats => {
  const next = { ...current };
  const mine = (unitId: string) => state.units.get(unitId)?.ownerId === playerId;
  let spellSourceId: string | undefined;

  for (const event of events) {
    if (event.type === 'SPELL_CAST') {
      spellSourceId = event.unitId;
      if (mine(event.unitId)) next.abilities += 1;
    } else if (event.type === 'UNIT_ATTACKED') {
      const hits = event.hits ?? [{ targetId: event.targetId, damage: event.damage }];
      for (const hit of hits) {
        if (mine(event.attackerId)) next.damageDealt += hit.damage;
        if (mine(hit.targetId)) next.damageTaken += hit.damage;
      }
    } else if (event.type === 'SPELL_HIT') {
      // Older room payloads omit sourceId; SPELL_CAST precedes these hits in
      // the same command batch, while the legacy unitId is sometimes the victim.
      const sourceId = event.sourceId ?? spellSourceId ?? event.unitId;
      if (mine(sourceId)) next.damageDealt += event.damage;
      if (mine(event.targetId)) next.damageTaken += event.damage;
    } else if (event.type === 'UNIT_DEFEATED') {
      if (mine(event.unitId)) next.losses += 1;
      else next.kills += 1;
    } else if (event.type === 'UNIT_HEALED') {
      if (mine(event.targetId)) next.healed += event.restored;
    } else if (event.type === 'ALTAR_WISH') {
      // Every wish costs exactly one soul, whichever of the two it is.
      if (mine(event.unitId)) next.soulsSpent += 1;
    } else if (event.type === 'ZONE_TICK') {
      for (const heal of event.healed) {
        if (mine(heal.unitId)) next.healed += heal.amount;
      }
      for (const hit of event.burned) {
        if (mine(event.ownerId)) next.damageDealt += hit.amount;
        if (mine(hit.unitId)) next.damageTaken += hit.amount;
      }
    }
  }

  return next;
};
