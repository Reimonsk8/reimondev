import type { GameEvent } from './engine';

/**
 * How long one enemy action is held on screen before the next one plays.
 *
 * The engine resolves a whole monster step server-side in one call, so pacing
 * has to live in the presentation layer. Long enough to read a walk and the
 * swing that follows it, short enough that a turn does not drag.
 */
export const ENEMY_STEP_MS = 1000;

/**
 * Which unit an event is the *acting* unit of, if any.
 *
 * Only acting units count. A defeat, a push or a trap springing is something
 * that happened *to* a unit and belongs to the beat already playing, otherwise
 * one attack would be sliced in half and stall on its own consequence.
 */
const actorOf = (event: GameEvent): string | null => {
  switch (event.type) {
    case 'UNIT_MOVED':
    case 'RANGER_SHOT':
    case 'UNIT_GUARDED':
    case 'SPELL_CAST':
    case 'ICE_WALL_SUMMONED':
      return event.unitId;
    case 'UNIT_ATTACKED':
      return event.attackerId;
    case 'UNIT_HEALED':
      return event.healerId;
    case 'SPELL_HIT':
      return event.sourceId ?? null;
    default:
      return null;
  }
};

/**
 * Split an event batch into one beat per opposing unit's action.
 *
 * Adventure resolves every monster inside the turn hand-over, and the AI seat
 * resolves a whole turn per command, so a batch can hold several units' moves
 * and strikes. Playing it in one frame made the enemy turn unreadable: five
 * monsters moved, hit and cast at once and the log filled instantly. Splitting
 * on the acting unit — never inside one unit's action — lets the board play
 * them out in order.
 */
export const splitEventBeats = (
  events: readonly GameEvent[],
  playerId: string,
): GameEvent[][] => {
  const beats: GameEvent[][] = [[]];
  let previousActor: string | null = null;
  for (const event of events) {
    const actor = actorOf(event);
    if (
      actor !== null &&
      actor !== playerId &&
      previousActor !== null &&
      actor !== previousActor
    ) {
      beats.push([]);
    }
    if (actor !== null) previousActor = actor;
    beats[beats.length - 1].push(event);
  }
  return beats;
};
