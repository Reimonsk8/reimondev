import type { Faction, GameState, MapMode, PlayerClass, Position } from './types';
import type { SerializedGameState } from './state';

/**
 * Square of Shadows — client/server protocol.
 *
 * The client never sends a resulting state; it sends an *intent* (a command).
 * `applyCommand` re-validates that intent against the authoritative state and
 * returns the next state (or a rejection). Because the engine is pure and
 * deterministic, the client can run the exact same `applyCommand` optimistically
 * and the server can run it as the source of truth — they can only disagree if
 * the client's input was illegal, in which case the server's state wins and the
 * client reconciles on the next `sos:state`.
 */

// ─────────────────────────── Player commands ───────────────────────────

/** Move one of your units to a reachable tile. */
export interface MoveUnitCommand {
  type: 'MOVE_UNIT';
  unitId: string;
  to: Position;
}

/** Attack an enemy unit with one of your units. */
export interface AttackUnitCommand {
  type: 'ATTACK_UNIT';
  attackerId: string;
  targetId: string;
}

/** Ranger: shoot any visible tile, occupied or empty. */
export interface RangerShotCommand {
  type: 'RANGER_SHOT';
  unitId: string;
  x: number;
  y: number;
}

/** Cleric-only: restore HP to a friendly unit (or self) in range. */
export interface HealUnitCommand {
  type: 'HEAL_UNIT';
  healerId: string;
  targetId: string;
}

/** Finish the current player's turn and pass initiative. */
export interface EndTurnCommand {
  type: 'END_TURN';
}

/** Pick the cosmetic faction during the deployment phase. */
export interface ChooseFactionCommand {
  type: 'CHOOSE_FACTION';
  faction: Faction;
  squad?: PlayerClass[];
}

/**
 * Choose the floor for this match: the hand-authored classic arena or a fresh
 * procedural one.
 *
 * Unlike `CHOOSE_FACTION` this is NOT turn-ordered — either player may set it at
 * any point during the faction draft, and the last write wins. That is
 * deliberate: a map preference is not a competitive action, it is a "which board
 * do you want to play on" toggle, and making players alternate draft turns over
 * it would be friction for no fairness gain. It changes terrain only, never rules
 * or stats, so it cannot advantage either side.
 */
export interface SetMapModeCommand {
  type: 'SET_MAP_MODE';
  mapMode: MapMode;
}

/**
 * Warrior only: raise the shield over an adjacent ally. Damage aimed at that
 * ally is redirected to the warrior for as long as the guard stands (it lapses
 * when the warrior's next turn begins). Costs no action, so it is a free
 * defensive choice rather than a trade against attacking.
 */
export interface GuardUnitCommand {
  type: 'GUARD_UNIT';
  unitId: string;
  targetId: string;
}

/** Target-tile ability: every spell/placement resolves against an (x,y). */
interface TargetedCommandBase {
  x: number;
  y: number;
}

/** Wizard: heavy area damage over a 3x3 block centred on the target. */
export interface CastFireballCommand extends TargetedCommandBase {
  type: 'CAST_FIREBALL';
  unitId: string;
}

/** Wizard: a line of tiles centred on the target, damaging everything caught. */
export interface CastThunderStrikeCommand extends TargetedCommandBase {
  type: 'CAST_THUNDER_STRIKE';
  unitId: string;
}

/** Wizard: raises an impassable ice tile — the board changes shape. */
export interface SummonIceWallCommand extends TargetedCommandBase {
  type: 'SUMMON_ICE_WALL';
  unitId: string;
}

/** Cleric: blesses a 2x2 area. */
export interface BlessGroundCommand extends TargetedCommandBase {
  type: 'BLESS_GROUND';
  unitId: string;
}

/** Ranger: lays a hidden trap on an empty tile. */
export interface PlaceTrapCommand extends TargetedCommandBase {
  type: 'PLACE_TRAP';
  unitId: string;
}

/** Ranger: throw to a wall and land beside it. Target is the wall tile. */
export interface GrappleCommand extends TargetedCommandBase {
  type: 'GRAPPLE';
  unitId: string;
}

/**
 * Warrior: slam a tile. Whatever stands on it — enemy, ally, or nothing — is
 * hit the same way, so friendly fire is always live and the choice of where to
 * swing is entirely the player's.
 */
export interface ShieldSlamCommand extends TargetedCommandBase {
  type: 'SHIELD_SLAM';
  unitId: string;
}

export interface DissonantMelodyCommand extends TargetedCommandBase { type: 'DISSONANT_MELODY'; unitId: string; }
export interface InspiringAnthemCommand extends TargetedCommandBase { type: 'INSPIRING_ANTHEM'; unitId: string; }
export interface SongOfRestCommand extends TargetedCommandBase { type: 'SONG_OF_REST'; unitId: string; }
export interface EldritchBoltCommand extends TargetedCommandBase { type: 'ELDRITCH_BOLT'; unitId: string; }
export interface CurseOfAgonyCommand extends TargetedCommandBase { type: 'CURSE_OF_AGONY'; unitId: string; }
export interface SoulDrainCommand extends TargetedCommandBase { type: 'SOUL_DRAIN'; unitId: string; }
export interface ThornWhipCommand extends TargetedCommandBase { type: 'THORN_WHIP'; unitId: string; }
export interface RegrowthCommand extends TargetedCommandBase { type: 'REGROWTH'; unitId: string; }
export interface RootsOfEntanglementCommand extends TargetedCommandBase { type: 'ROOTS_OF_ENTANGLEMENT'; unitId: string; }
export interface BackstabCommand extends TargetedCommandBase { type: 'BACKSTAB'; unitId: string; }
export interface ShadowStepCommand extends TargetedCommandBase { type: 'SHADOW_STEP'; unitId: string; }
export interface PoisonedDaggerCommand extends TargetedCommandBase { type: 'POISONED_DAGGER'; unitId: string; }

export interface HolySmiteCommand extends TargetedCommandBase {
  type: 'HOLY_SMITE';
  unitId: string;
}

export interface DivineShieldCommand extends TargetedCommandBase {
  type: 'DIVINE_SHIELD';
  unitId: string;
}

export interface HolyLightCommand extends TargetedCommandBase {
  type: 'HOLY_LIGHT';
  unitId: string;
}

/** What the Altar of Shadows grants. */
export type AltarWish = 'RESTORE' | 'RESURRECT';

/**
 * Spend a harvested soul at the arena altar.
 *
 * `unitId` is the unit standing beside the monument. It is the unit the altar
 * heals, and the one that pays for a resurrection out of its own blood.
 */
export interface AltarWishCommand {
  type: 'ALTAR_WISH';
  unitId: string;
  wish: AltarWish;
}

/** Discriminated union of every legal player intent. */
export type GameCommand =
  | MoveUnitCommand
  | AttackUnitCommand
  | RangerShotCommand
  | HealUnitCommand
  | GuardUnitCommand
  | CastFireballCommand
  | CastThunderStrikeCommand
  | SummonIceWallCommand
  | BlessGroundCommand
  | PlaceTrapCommand
  | GrappleCommand
  | ShieldSlamCommand
  | HolySmiteCommand
  | DivineShieldCommand
  | HolyLightCommand
  | DissonantMelodyCommand
  | InspiringAnthemCommand
  | SongOfRestCommand
  | EldritchBoltCommand
  | CurseOfAgonyCommand
  | SoulDrainCommand
  | ThornWhipCommand
  | RegrowthCommand
  | RootsOfEntanglementCommand
  | BackstabCommand
  | ShadowStepCommand
  | PoisonedDaggerCommand
  | AltarWishCommand
  | ChooseFactionCommand
  | SetMapModeCommand
  | EndTurnCommand;

export type GameCommandType = GameCommand['type'];

/** Which ability a ZONE_TICK / SPELL_CAST refers to. */
export type AbilityId =
  | 'FIREBALL'
  | 'THUNDER_STRIKE'
  | 'ICE_WALL'
  | 'BLESS_GROUND'
  | 'TRAP'
  | 'GRAPPLE'
  | 'SHIELD_SLAM'
  | 'HOLY_SMITE'
  | 'DIVINE_SHIELD'
  | 'HOLY_LIGHT'
  | 'DISSONANT_MELODY'
  | 'INSPIRING_ANTHEM'
  | 'SONG_OF_REST'
  | 'ELDRITCH_BOLT'
  | 'CURSE_OF_AGONY'
  | 'SOUL_DRAIN'
  | 'THORN_WHIP'
  | 'REGROWTH'
  | 'ROOTS_OF_ENTANGLEMENT'
  | 'BACKSTAB'
  | 'SHADOW_STEP'
  | 'POISONED_DAGGER';

// ─────────────────────────── Engine outcomes ───────────────────────────

/** Animation/telemetry events emitted alongside an accepted command. */
export type GameEvent =
  | { type: 'UNIT_MOVED'; unitId: string; from: Position; to: Position }
  | {
      type: 'RANGER_SHOT';
      unitId: string;
      from: Position;
      to: Position;
      hit: boolean;
      accuracy: number;
      targetId?: string;
      destroyedTrap: boolean;
      destroyedIce: boolean;
    }
  | {
      type: 'UNIT_ATTACKED';
      attackerId: string;
      targetId: string;
      damage: number;
      defeated: string[];
      /** False when a Ranger shot missed; absent is treated as a legacy hit. */
      hit?: boolean;
      /** Ranger hit chance in percent at the shot's distance. */
      accuracy?: number;
      /** Actual post-guard/post-reduction damage applied to every unit (includes AoE splash). */
      hits?: Array<{ targetId: string; damage: number }>;
    }
  | { type: 'UNIT_HEALED'; healerId: string; targetId: string; restored: number }
  | { type: 'UNIT_GUARDED'; unitId: string; targetId: string }
  | { type: 'GUARD_ABSORBED'; guardianId: string; targetId: string; damage: number }
  | { type: 'SPELL_CAST'; unitId: string; ability: AbilityId; x: number; y: number }
  | { type: 'SPELL_HIT'; unitId: string; sourceId?: string; targetId: string; damage: number }
  | { type: 'ICE_WALL_SUMMONED'; unitId: string; x: number; y: number }
  | { type: 'ZONE_SUMMONED'; zoneId: string; ownerId: string; x: number; y: number }
  | {
      type: 'ZONE_TICK';
      zoneId: string;
      ownerId: string;
      /** Units that regained HP, and how much each got. */
      healed: Array<{ unitId: string; amount: number }>;
      /** Units that took radiant damage. */
      burned: Array<{ unitId: string; amount: number }>;
    }
  | { type: 'TRAP_PLACED'; trapId: string; ownerId: string; x: number; y: number }
  | { type: 'TRAP_TRIGGERED'; trapId: string; unitId: string; x: number; y: number }
  | { type: 'UNIT_ROOTED'; unitId: string; turns: number }
  | { type: 'UNIT_PUSHED'; unitId: string; from: Position; to: Position }
  | { type: 'IMPACT_BONUS'; unitId: string; damage: number }
  | { type: 'UNIT_STUNNED'; unitId: string; turns: number }
  | { type: 'TURN_ENDED'; endedPlayerId: string; activePlayerId: string; turnNumber: number }
  | { type: 'UNIT_DEFEATED'; unitId: string }
  | {
      type: 'SOUL_HARVESTED';
      /** The unit that fell. */
      unitId: string;
      /** Where it died, and the altar tile the soul flies to. */
      from: Position;
      to: Position;
      /** Souls held once this one lands. */
      souls: number;
    }
  | {
      type: 'ALTAR_WISH';
      unitId: string;
      wish: AltarWish;
      /** Souls left after the price. */
      souls: number;
      /** RESTORE: HP the altar handed back. */
      restored?: number;
      /** RESURRECT: HP the caster gave up, which is also what the ally arrives with. */
      sacrificed?: number;
      resurrectedId?: string;
      /** Where the raised unit came back. */
      position?: Position;
    }
  | { type: 'VICTORY'; winnerId: string };

/** Result of applying a command to a state. `ok === false` leaves state intact. */
export interface CommandResult {
  ok: boolean;
  /** Present on success. */
  state?: GameState;
  /** Present on failure — safe to surface in the UI. */
  error?: string;
  events?: GameEvent[];
}

// ─────────────────────────── Wire envelopes ───────────────────────────

/** Client → server. `playerId` is advisory only; the server uses the verified connection identity. */
export interface CommandEnvelope {
  action: 'sos:command';
  gameId: string;
  command: GameCommand;
}

export interface JoinEnvelope {
  action: 'sos:join';
  gameId?: string;
  /** Matchmaking hints for Phase 2; ignored by the Phase 1 local engine. */
  mode?: 'matchmaking' | 'private';
}

export type ClientMessage = CommandEnvelope | JoinEnvelope;

/** Server → client. */
export interface StateEnvelope {
  type: 'sos:state';
  gameId: string;
  state: SerializedGameState;
}

export interface ErrorEnvelope {
  type: 'sos:error';
  message: string;
  /** Echoed command type when the error is a rejected command. */
  commandType?: GameCommandType;
}

export interface AckEnvelope {
  type: 'sos:ack';
  gameId: string;
  commandType: GameCommandType;
  revision: number;
}

export interface MatchFoundEnvelope {
  type: 'sos:match';
  gameId: string;
  players: Array<{ playerId: string; nickname: string }>;
}

export type ServerMessage =
  | StateEnvelope
  | ErrorEnvelope
  | AckEnvelope
  | MatchFoundEnvelope;

/** Type guard for websocket frames belonging to this game. */
export const isSquareOfShadowsMessage = (
  value: unknown,
): value is ServerMessage => {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return (
    typeof type === 'string' &&
    (type === 'sos:state' ||
      type === 'sos:error' ||
      type === 'sos:ack' ||
      type === 'sos:match')
  );
};
