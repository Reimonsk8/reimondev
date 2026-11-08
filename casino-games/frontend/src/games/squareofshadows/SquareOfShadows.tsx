import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  FormEvent,
  HTMLAttributes,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import {
  ArrowLeft, Shield, Sparkles, Cross, Crosshair, Swords, Copy, Volume2, VolumeX, Anchor,
  Bot, Users, Globe, Hammer, ChevronsRight, ChevronsDown, KeyRound, RotateCcw, Snowflake,
  Map as MapIcon, Music, Flame, Leaf, Eye, Skull,
} from 'lucide-react';
import { useSquareOfShadows } from '../../hooks/useSquareOfShadows';
import { attackLinkFor } from './attackLink';
import { SOS_PIXEL_FX, sosPixelFxStyle } from './pixelFx';
import {
  KILL_SHAKE_BONUS,
  hitStopMsFor,
  impactDelayFor,
  isMeleeClass,
  lungeDistanceFor,
  prefersReducedMotion,
  shakeFor,
  travelMsFor,
} from './combatTiming';
import {
  positionKey,
  unitAt,
  chebyshev,
  guardOf,
  isFrozen,
  isWall,
  allActiveUnitsSpent,
  legalRangerShotTargetsFor,
  ADVENTURE_CLEARED,
  MONSTER_TEAM_ID,
  altarSitesFor,
  besideAltar,
  soulTargetFor,
  cameraWindowFor,
  cameraWindowFromOrigin,
  tileCentreInViewPct,
  tileVisibleInView,
  isAdventureState,
  ABILITIES,
  CLERIC_HEAL_RANGE,
  DRAFTABLE_CLASSES,
  RANGER_ATTACK,
  rangerAccuracyPercent,
  abilityAffectedTiles,
  attackRangeTiles,
  fireballTiles,
  thunderTiles,
  activeZoneTiles,
  floorParityFor,
} from './engine';
import type { AbilityId, Faction, GameCommand, GameEvent, GameState, MapMode, MonsterType, PlayerClass, Position, Unit, UnitType } from './engine';
import {
  boardViewDimensions,
  readBoardViewSize,
  writeBoardViewSize,
} from './boardView';
import type { BoardViewSize } from './boardView';
import { SosActionIcon } from './SosActionIcon';
import { SosMinimap } from './SosMinimap';
import type { LobbyPlayer, LobbyRoom } from './lobby';
import VictoryCinematic from './VictoryCinematic';
import { impactKindForAbility } from './highlight';
import type { ImpactKind } from './highlight';
import { useTurnTimer, formatTurnClock, TURN_SECONDS } from './useTurnTimer';
import { ENEMY_STEP_MS, splitEventBeats } from './enemyPacing';
import { roomInviteUrl } from './invite';
import {
  getAudioPrefs,
  footstepWeightFor,
  panFromColumn,
  playFootstep,
  playSfx,
  playSpell,
  restoreAudio,
  setMusicEnabled,
  setMusicVolume,
  setMusicTrack,
  setSfxEnabled,
  setSfxVolume,
  setAudioSuspended,
  stopAudio,
  unlockAudio,
} from './audio';
import type { SpellCue } from './audio';
import { burstConfetti } from '../../utils/fx';
import { emptyBattleStats, tallyBattleStats, type BattleStats } from './battleStats';
import {
  floorToneFor,
  floorToneIndexFor,
  floorWearFor,
  floorWearIndexFor,
  terrainAtlasName,
  terrainThemeForGame,
  wangTileIndexFor,
} from './terrainTheme';
import {
  ALTAR_DECORATION_COUNT,
  GROUND_DECORATION_COUNT,
  altarDecorationForCell,
  altarSpriteFor,
  wallDecorationForCell,
} from './terrainDecor';

/**
 * Live/offline pill for the online screens.
 *
 * Both the duel lobby and the waiting room were silently frozen when the socket
 * dropped — the player had no way to tell a hang from a lost connection, which
 * is the worst possible state to be left in while waiting for an opponent.
 */
function ConnectionPill({ isOnline }: { isOnline: boolean }) {
  return (
    <span
      className={`sos-conn${isOnline ? ' is-live' : ' is-down'}`}
      role="status"
      aria-live="polite"
    >
      <span className="sos-conn-dot" aria-hidden="true" />
      {isOnline ? 'Live' : 'Reconnecting…'}
    </span>
  );
}

/**
 * Round avatar for a duel-lobby roster row.
 *
 * Falls back to initials when a player has no picture, because a bare name in a
 * list you pick people out of is exactly what this was meant to fix. `onError`
 * matters here: `avatarImage` is a stored data URL, so one that fails to decode
 * would otherwise leave a broken-image glyph in the row.
 */
function SosLobbyAvatar({
  src,
  name,
}: {
  src?: string | null;
  name?: string | null;
}) {
  const [broken, setBroken] = useState(false);
  const label = (name || 'Player').trim();
  const initials =
    label
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] || '')
      .join('')
      .toUpperCase() || 'P';

  // A new src deserves a fresh attempt; without this, one failed load would
  // stick for the rest of the session even after the image was replaced.
  useEffect(() => setBroken(false), [src]);

  return (
    <span className="sos-lobby-avatar" aria-hidden="true">
      {src && !broken ? (
        <img src={src} alt="" onError={() => setBroken(true)} />
      ) : (
        <span className="sos-lobby-avatar-initials">{initials}</span>
      )}
    </span>
  );
}

/**
 * A popover anchored to a board tile that is guaranteed to stay inside it.
 *
 * A percentage offset puts the card where the tile is, not where the card fits:
 * an anchor in the top two rows pushed it past the stage's top edge, and one in
 * the right column pushed it past the right edge, where the board's
 * `overflow: hidden` cut it in half. The card's own size is only known after it
 * renders, so placement is measured in a layout effect (before paint) and
 * recomputed whenever the card or the board changes size.
 */
function BoardPopover({
  leftPct,
  topPct,
  cols,
  rows,
  className,
  children,
  ...rest
}: {
  leftPct: number;
  topPct: number;
  cols: number;
  rows: number;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children'>) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    // The parent is `.sos-overlay-layer`, which is stretched over the board.
    const layer = el?.parentElement;
    if (!el || !layer) return;

    const place = () => {
      const mapW = layer.clientWidth;
      const mapH = layer.clientHeight;
      const popupW = el.offsetWidth;
      const popupH = el.offsetHeight;
      if (!mapW || !mapH || !popupW || !popupH) return;

      const MARGIN = 6;
      const GAP = 8;
      const anchorX = (leftPct / 100) * mapW;
      const anchorY = (topPct / 100) * mapH;

      // Above the tile by default; below it when the top rows leave no room.
      let top = anchorY - mapH / Math.max(1, rows) / 2 - popupH - GAP;
      if (top < MARGIN) top = anchorY + mapH / Math.max(1, rows) / 2 + GAP;
      // Right of the tile by default; against its left side near the right edge.
      let left = anchorX + popupW * 0.06;
      if (left + popupW > mapW - MARGIN) left = anchorX - popupW;

      setAt({
        left: Math.max(MARGIN, Math.min(left, mapW - popupW - MARGIN)),
        top: Math.max(MARGIN, Math.min(top, mapH - popupH - MARGIN)),
      });
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [leftPct, topPct, cols, rows]);

  return (
    <div
      ref={ref}
      className={`sos-confirm${className ? ` ${className}` : ''}`}
      style={at ? { left: at.left, top: at.top } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

interface SquareOfShadowsProps {
  userId?: string | null;
  nickname?: string;
  /**
   * Your own avatar as a data URL, so the "you" row of the duel lobby shows your
   * face. Roster rows get theirs from the server via `LobbyPlayer.avatarImage`;
   * the server does not publish you until you have a row, which is why the local
   * copy is needed for the synthesised self entry.
   */
  avatarImage?: string | null;
  /** False when the lobby socket is not connected, so online play is unavailable. */
  isOnline?: boolean;
  /** Lobby socket transport used for authoritative online duels. */
  sendRaw?: (payload: unknown) => void;
  subscribe?: (listener: (message: unknown) => void) => () => void;
  /** Invite code from `?room=`. */
  initialRoom?: string | null;
}

interface ClassMeta {
  label: string;
  color: string;
  blurb: string;
}

/** A transient number/label floating above a board cell. */
interface SosFloater {
  id: string;
  x: number;
  y: number;
  text: string;
  kind: 'damage' | 'heal' | 'defeat' | 'block';
  /** Hold the number back until the blow it reports has actually landed. */
  delayMs?: number;
}

/** A transient elemental burst anchored to the tile a spell was cast on. */
interface SosSpellFx {
  id: string;
  x: number;
  y: number;
  /** Engine abilities, plus HEAL/GUARD/SLASH which have no SPELL_CAST of their own. */
  ability: AbilityId | 'HEAL' | 'GUARD' | 'ICE_RISE' | 'TRAP_SPRING' | 'BLOOD' | 'DEATH' | 'SLASH'
  | 'HOLY_SIGIL' | 'HOLY_FLASH' | 'ALTAR';
}

/**
 * Something that travels between two tiles: a Warrior's shield crossing to the
 * ally it covers, a body being shoved back, a grapple rope, a Ranger's arrow, a
 * Wizard's firebolt streaking to the target, a Spitter's acid bolt, or a soul
 * torn from a corpse and drawn into the altar.
 */
interface SosLinkFx {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  kind: 'shield' | 'push' | 'rope' | 'arrow' | 'firebolt' | 'slash' | 'acidbolt' | 'soul';
  angleDeg?: number;
  /** Flight time for this hop, so the sprite and its impact stay in step. */
  travelMs?: number;
  /** Unit vector along the flight; CSS cannot take cos/sin of a custom property. */
  dirX?: number;
  dirY?: number;
}

const VFX_SPRITE_FOR: Partial<Record<SosSpellFx['ability'], string>> = {
  SLASH: publicAsset('/sprites/sos-vfx-slash/sprite-sheet-alpha.png'),
  FIREBALL: publicAsset('/sprites/sos-vfx-fireball/sprite-sheet-alpha.png'),
  THUNDER_STRIKE: publicAsset('/sprites/sos-vfx-thunder/sprite-sheet-alpha.png'),
  ICE_WALL: publicAsset('/sprites/sos-vfx-ice/sprite-sheet-alpha.png'),
  ICE_RISE: publicAsset('/sprites/sos-vfx-ice/sprite-sheet-alpha.png'),
  HEAL: publicAsset('/sprites/sos-vfx-heal/sprite-sheet-alpha.png'),
  BLESS_GROUND: publicAsset('/sprites/sos-vfx-heal/sprite-sheet-alpha.png'),
  HOLY_SIGIL: publicAsset('/sprites/sos-vfx-holy-sigil/sprite-sheet-alpha.png'),
  TRAP: publicAsset('/sprites/sos-vfx-trap/sprite-sheet-alpha.png'),
  TRAP_SPRING: publicAsset('/sprites/sos-vfx-trap/sprite-sheet-alpha.png'),
};

const VFX_GIF_FOR: Partial<
  Record<SosSpellFx['ability'], { src: string; width: number; height: number; durationMs: number }>
> = {
  BLESS_GROUND: {
    src: publicAsset('/sprites/sos-pixellab/effects/sanctified-ground/animation.preview.gif'),
    width: 130,
    height: 54,
    durationMs: 900,
  },
  SHIELD_SLAM: {
    src: publicAsset('/sprites/sos-pixellab/effects/shield-slam/animation.preview.gif'),
    width: 106,
    height: 46,
    durationMs: 700,
  },
};

const LINK_SPRITE_FOR: Partial<Record<SosLinkFx['kind'], string>> = {
  arrow: publicAsset('/sprites/sos-vfx-arrow/sprite-sheet-alpha.png'),
  firebolt: publicAsset('/sprites/sos-vfx-firebolt/sprite-sheet-alpha.png'),
  slash: publicAsset('/sprites/sos-vfx-slash/sprite-sheet-alpha.png'),
};

// `attackLinkFor` lives in ./attackLink and the timing maths in ./combatTiming,
// both unit tested directly — this bug shipped because the class→sprite mapping
// had no test guarding it.

/** One row in the combat log / live action feed. */
interface CombatLogEntry {
  id: string;
  turn: number;
  kind: 'damage' | 'spell' | 'heal' | 'guard' | 'move' | 'trap' | 'defeat' | 'turn';
  text: string;
  icon?: string;
}

const ABILITY_ICON: Partial<Record<AbilityId, string>> = {
  FIREBALL: publicAsset('/sprites/sos-pixellab/icon-fireball/sprite-sheet-alpha.png'),
  THUNDER_STRIKE: publicAsset('/sprites/sos-pixellab/icon-thunder-strike/sprite-sheet-alpha.png'),
  ICE_WALL: publicAsset('/sprites/sos-pixellab/icon-ice-wall/sprite-sheet-alpha.png'),
  BLESS_GROUND: publicAsset('/sprites/sos-pixellab/icon-bless-ground/sprite-sheet-alpha.png'),
  TRAP: publicAsset('/sprites/sos-pixellab/icon-trap/sprite-sheet-alpha.png'),
  GRAPPLE: publicAsset('/sprites/sos-pixellab/icon-grapple/sprite-sheet-alpha.png'),
  SHIELD_SLAM: publicAsset('/sprites/sos-pixellab/icon-shield-slam/sprite-sheet-alpha.png'),
};

const ABILITY_DISPLAY_NAME: Record<AbilityId, string> = {
  FIREBALL: 'Fireball',
  THUNDER_STRIKE: 'Thunder Strike',
  ICE_WALL: 'Ice Wall',
  BLESS_GROUND: 'Sanctified Ground',
  TRAP: 'Spiked Trap',
  GRAPPLE: 'Grapple Chain',
  SHIELD_SLAM: 'Shield Slam',
  HOLY_SMITE: 'Holy Smite',
  DIVINE_SHIELD: 'Divine Shield',
  HOLY_LIGHT: 'Holy Light',
  DISSONANT_MELODY: 'Dissonant Melody',
  INSPIRING_ANTHEM: 'Inspiring Anthem',
  SONG_OF_REST: 'Song of Rest',
  ELDRITCH_BOLT: 'Eldritch Bolt',
  CURSE_OF_AGONY: 'Curse of Agony',
  SOUL_DRAIN: 'Soul Drain',
  THORN_WHIP: 'Thorn Whip',
  REGROWTH: 'Regrowth',
  ROOTS_OF_ENTANGLEMENT: 'Roots of Entanglement',
  BACKSTAB: 'Backstab',
  SHADOW_STEP: 'Shadow Step',
  POISONED_DAGGER: 'Poisoned Dagger',
};

/** Map an engine ability id onto its audio cue. */
const spellCueFor = (ability: AbilityId): SpellCue =>
  ({
    FIREBALL: 'fireball',
    THUNDER_STRIKE: 'thunder',
    ICE_WALL: 'ice',
    BLESS_GROUND: 'bless',
    TRAP: 'trap',
    GRAPPLE: 'grapple',
    SHIELD_SLAM: 'slam',
  } as Partial<Record<AbilityId, SpellCue>>)[ability] ?? 'fireball';

/** One row in the selected unit's skill list. */
const CLASS_META: Record<UnitType, ClassMeta> = {
  WARRIOR: { label: 'Warrior', color: '#f59e0b', blurb: 'High HP melee bruiser' },
  WIZARD: { label: 'Wizard', color: '#a855f7', blurb: 'Fragile ranged AoE caster' },
  CLERIC: { label: 'Cleric', color: '#10b981', blurb: 'Support healer' },
  RANGER: { label: 'Ranger', color: '#0ea5e9', blurb: 'Long-range line of sight' },
  PALADIN: { label: 'Paladin', color: '#fbbf24', blurb: 'Tank/support hybrid' },
  BARD: { label: 'Bard', color: '#ec4899', blurb: 'Support / control' },
  WARLOCK: { label: 'Warlock', color: '#7c3aed', blurb: 'Ranged DPS / curse' },
  DRUID: { label: 'Druid', color: '#22c55e', blurb: 'Hybrid / summoner' },
  ROGUE: { label: 'Rogue', color: '#94a3b8', blurb: 'Agile burst / ambush' },
  // Monsters, not draftable classes — named so the log reads as a bestiary
  // rather than "a Warrior attacked you".
  BEAST: { label: 'Demonic Claw', color: '#a855f7', blurb: 'Orthogonal melee claw' },
  SPITTER: { label: 'Acid Spitter', color: '#84cc16', blurb: 'Spits acid at reach 2' },
};

/**
 * Class colours for the canvas minimap.
 *
 * A canvas cannot resolve a CSS class, so the exact palette is passed down
 * rather than copied into the minimap component. If a class colour changes,
 * the main board and its overview change together.
 */
const CLASS_COLORS = Object.fromEntries(
  (Object.keys(CLASS_META) as UnitType[]).map((type) => [type, CLASS_META[type].color]),
) as Record<UnitType, string>;

/**
 * Faction identity for the draft screen.
 *
 * `subtitle` is the one-line identity of the order, shown under the name.
 */
const FACTION_META: Record<
  Faction,
  { name: string; subtitle: string; lore: string; skins: Record<PlayerClass, string> }
> = {
  INQUISITORS: {
    name: 'Inquisitors of Truth',
    subtitle: 'A Dark Holy Order of Martyrs',
    lore: 'A truth-blinded fanatical order purging heresy with holy flame and sacred blood in the name of God. Suffering and torture are the only offerings worthy of God.',
    skins: { WARRIOR: 'templar', WIZARD: 'confessor', CLERIC: 'martyr', RANGER: 'penitent', PALADIN: 'templar', BARD: 'confessor', WARLOCK: 'martyr', DRUID: 'penitent', ROGUE: 'penitent' },
  },
  PENITENT_COURT: {
    name: 'Penitent Court',
    subtitle: 'The Church of Leviathan',
    lore: 'Soul harvesters and hell-worshiping occultists bound to the demon Leviathan, servant of the almighty hell ruler on the infernal throne.',
    skins: { WARRIOR: 'warrior', WIZARD: 'wizard', CLERIC: 'cleric', RANGER: 'ranger', PALADIN: 'warrior', BARD: 'wizard', WARLOCK: 'cleric', DRUID: 'ranger', ROGUE: 'ranger' },
  },
};

const FACTIONS = Object.keys(FACTION_META) as Faction[];

/**
 * Monster skins.
 *
 * The monster team has no `Faction` — adding a third value would put a cosmetic
 * choice on the wire and into the server's faction validation for no gameplay
 * reason. They get their OWN sheets instead of reusing a squad's: reusing one
 * made a monster indistinguishable from the unit it was hunting, and matching
 * the Penitent Court made it look like whichever squad the player had drafted.
 *
 * Keyed by `MonsterType` rather than `UnitType` because a monster can only ever
 * be a Beast or a Spitter. It used to be keyed by the whole union and point at
 * four recoloured *class* atlases, which is the other half of the reason they
 * read as a second squad instead of a bestiary.
 */
const MONSTER_SKINS: Record<MonsterType, string> = {
  BEAST: 'monster-beast',
  SPITTER: 'monster-spitter',
};

/**
 * Which sprite atlas a unit draws from.
 *
 * Monsters use their own sheets; everyone else uses their faction's. The tables
 * are checked rather than cast, because `ownerId` says who a unit belongs to and
 * not what it is — indexing the faction table with a `BEAST` would silently
 * yield `undefined` and draw a unit with no background image, which is the kind
 * of blank that reads as "loading" and gets missed.
 */
const skinForUnit = (unit: Unit, factions: GameState['factions']): string => {
  if (unit.ownerId === MONSTER_TEAM_ID) {
    const skins = MONSTER_SKINS as Record<UnitType, string | undefined>;
    return skins[unit.type] ?? MONSTER_SKINS.BEAST;
  }
  const faction = FACTION_META[factions[unit.ownerId] ?? 'INQUISITORS'];
  const skins = faction.skins as Record<UnitType, string | undefined>;
  return skins[unit.type] ?? faction.skins.WARRIOR;
};

const MAP_MODES = ['CLASSIC', 'RANDOM'] as const;

/**
 * The two game modes offered on the draft screen.
 *
 * These are display names over the engine's `CLASSIC` / `RANDOM`. The engine
 * values are deliberately left alone — they describe how the terrain is built,
 * and renaming them would churn the wire format, the persistence layer and
 * three test suites to say nothing new.
 *
 * `ARENA` is the honest default: a fixed 12x10 board, two squads, and nothing
 * else on it. `ADVENTURE` is the 20x20 exploration floor — procedurally
 * generated, seeded, and populated with a monster team that hunts both squads.
 * They are chosen here, in the draft, inside AI / Local Duel / Online Duel:
 * adventure is a floor, not a fourth way to play.
 */
const MAP_MODE_META: Record<
  MapMode,
  { name: string; tagline: string; blurb: string; upcoming: boolean }
> = {
  CLASSIC: {
    name: 'Arena',
    tagline: 'Duelling floor',
    blurb:
      'A fixed 12×10 board, mirrored for both sides. Two squads, no monsters, no items, no surprises — what you see is the whole match.',
    upcoming: false,
  },
  RANDOM: {
    name: 'Adventure',
    tagline: 'Exploration floor',
    blurb:
      'A 20×20 floor generated fresh every match. Two squads of four against four monsters that hunt you both — the view follows whoever is taking their turn.',
    upcoming: false,
  },
};

/**
 * Terrain tile index into the `sos-terrain` sheet.
 *
 * Must stay in step with `TILE` in `scripts/sprite-gen/sos-pixel-art.mjs`, which
 * bakes the sheet as: FLOOR, FLOOR_ALT, then one `WALL_<mask>` per 4-bit
 * neighbour mask. Built the same way rather than listed by hand so adding a mask
 * cannot be half-done on one side.
 *
 * The checkerboard comes from the sprite itself now, so there is no CSS gradient
 * doing the tiling.
 */
const TILE_INDEX = (() => {
  const tiles: Record<string, number> = { FLOOR: 0, FLOOR_ALT: 1 };
  for (let mask = 0; mask < 16; mask += 1) tiles[`WALL_${mask}`] = 2 + mask;
  return tiles;
})();

/** Tiles in the terrain sheet — the background-position maths divides by this. */
const TILE_COLS = Object.keys(TILE_INDEX).length;

/**
 * Wall dressing is PARKED, not deleted.
 *
 * Adventure's walls used to carry two sparse decal layers — `wallDecorationForCell`
 * (rubble, cracks, staining) and `altarDecorationForCell` (small wall shrines) —
 * both seeded from match data so two online clients agreed. They are switched
 * off here so stone reads as clean masonry: at 10x10 with a camera window, a
 * decorated wall was competing with the range and target overlays for the same
 * attention.
 *
 * The loaders, the pools and the coordinate hashing all still live in
 * `terrainDecor.ts` and are still called below, so flipping this to `true`
 * restores the old floor exactly — no re-seeding, no re-wiring. `CLASSIC` was
 * never dressed, so the arena is untouched either way.
 */
const WALL_DRESSING = false;

/** Neighbour bits, matching the generator. */
const N_UP = 1;
const N_RIGHT = 2;
const N_DOWN = 4;
const N_LEFT = 8;

/**
 * Frames per class atlas, and where each state starts in the row.
 *
 * Must stay in step with `STATES` in `scripts/sprite-gen/sos-pixel-art.mjs`,
 * which bakes the sheet in exactly this order. The generator writes the same
 * numbers into each atlas manifest under `states`, so if the two ever drift this
 * is where it shows: the sprite plays the wrong slice rather than going blank.
 */
const SPRITE_TOTAL = 27;

/** Which sprite animation a unit should be playing right now. */
type SpriteState = 'idle' | 'attack' | 'cast' | 'death' | 'walk';

/**
 * Hoisted from the component so the sprite-state helper (module scope) can name
 * it. The runtime `reactions` record and this type must stay together.
 */
type UnitReactionKind = 'hit' | 'heal' | 'cast' | 'lunge' | 'defeat' | 'walk';

/**
 * Pick the sprite state from the unit's own situation, and let a live reaction
 * override it.
 *
 * The reaction wins because it is the more specific fact: a unit that is mid-swing
 * should show the swing even though it is still standing and alive. Defeat is
 * checked first and is not overridable — a corpse does not cast.
 */
const spriteStateFor = (
  unit: Unit,
  reaction: UnitReactionKind | null,
): SpriteState => {
  if (unit.stats.currentHp <= 0) return 'death';
  if (reaction === 'lunge') return 'attack';
  if (reaction === 'cast') return 'cast';
  if (reaction === 'walk') return 'walk';
  return 'idle';
};

/**
 * Which tile a cell draws.
 *
 * Walls pick their variant by where they sit, so a block reads as a solid mass
 * with a lit cap on top and a dark base underneath instead of one flat tile
 * repeated. That single detail is most of what makes the board look built rather
 * than grid-stamped.
 */
const terrainTileFor = (
  terrain: Map<string, string>,
  x: number,
  y: number,
  wall: boolean,
  width: number,
  height: number,
  seed: number,
): string => {
  // The floor's two-tone checkerboard keeps its pattern; only the phase comes
  // from the map seed, so each generated floor starts its tiling on a different
  // tile. Derived from the seed rather than stored, so both players see the same
  // board without it costing anything on the wire.
  if (!wall) return (x + y + floorParityFor(seed)) % 2 === 0 ? 'FLOOR' : 'FLOOR_ALT';

  // Four-bit neighbour mask. A wall asks for the tile that knows which of its
  // own edges are exposed, so a run of stone suppresses the seams between its
  // cells and reads as one block instead of a row of stamped tiles.
  const solid = (cx: number, cy: number) =>
    cx >= 0 && cy >= 0 && cx < width && cy < height && terrain.has(`${cx},${cy}`);

  let mask = 0;
  if (solid(x, y - 1)) mask |= N_UP;
  if (solid(x + 1, y)) mask |= N_RIGHT;
  if (solid(x, y + 1)) mask |= N_DOWN;
  if (solid(x - 1, y)) mask |= N_LEFT;
  return `WALL_${mask}`;
};

const SpriteIcon = ({ id, size, fallback }: { id: string; size: number; fallback: ReactNode }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  if (failed) return fallback;
  return (
    <img
      className="sos-pixel-icon"
      src={publicAsset(`/sprites/sos-pixellab/icon-${id}/sprite-sheet-alpha.png`)}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  );
};

const ClassIcon = ({ type, size = 18 }: { type: UnitType; size?: number }) => {
  const color = CLASS_META[type].color;
  const Icon = type === 'WARRIOR'
    ? Swords
    : type === 'WIZARD'
      ? Sparkles
      : type === 'CLERIC'
        ? Cross
        : type === 'RANGER'
          ? Crosshair
          : type === 'PALADIN'
            ? Shield
            : type === 'BARD'
              ? Music
              : type === 'WARLOCK'
                ? Flame
                : type === 'DRUID'
                  ? Leaf
                  : Eye;
  return (
    <SpriteIcon
      id={`class-${type.toLowerCase()}`}
      size={size}
      fallback={<Icon size={size} color={color} />}
    />
  );
};

/** Reach of each tile-targeted ability, for the board overlay. */
const ABILITY_RANGE: Record<AbilityId, { range: number }> = {
  FIREBALL: ABILITIES.FIREBALL,
  THUNDER_STRIKE: ABILITIES.THUNDER_STRIKE,
  ICE_WALL: ABILITIES.ICE_WALL,
  BLESS_GROUND: ABILITIES.SANCTIFIED_GROUND,
  TRAP: ABILITIES.TRAP,
  GRAPPLE: ABILITIES.GRAPPLE,
  SHIELD_SLAM: ABILITIES.SHIELD_SLAM,
  HOLY_SMITE: ABILITIES.HOLY_SMITE,
  DIVINE_SHIELD: ABILITIES.DIVINE_SHIELD,
  HOLY_LIGHT: ABILITIES.HOLY_LIGHT,
  DISSONANT_MELODY: ABILITIES.DISSONANT_MELODY,
  INSPIRING_ANTHEM: ABILITIES.INSPIRING_ANTHEM,
  SONG_OF_REST: ABILITIES.SONG_OF_REST,
  ELDRITCH_BOLT: ABILITIES.ELDRITCH_BOLT,
  CURSE_OF_AGONY: ABILITIES.CURSE_OF_AGONY,
  SOUL_DRAIN: ABILITIES.SOUL_DRAIN,
  THORN_WHIP: ABILITIES.THORN_WHIP,
  REGROWTH: ABILITIES.REGROWTH,
  ROOTS_OF_ENTANGLEMENT: ABILITIES.ROOTS_OF_ENTANGLEMENT,
  BACKSTAB: ABILITIES.BACKSTAB,
  SHADOW_STEP: ABILITIES.SHADOW_STEP,
  POISONED_DAGGER: ABILITIES.POISONED_DAGGER,
};

/** Which action a unit performs when you click a target in Act mode. */
type ActChoice = 'ATTACK' | 'HEAL' | 'GUARD' | 'SLAM';

/**
 * How a tile is painted on the board.
 *
 * `move` and `range` are separate layers on purpose: movement is always a
 * reachable destination, while `range` is "inside the action you selected".
 * They can coexist on one tile, but they no longer fight over one tint slot.
 */
type CellRange = 'attack' | 'heal' | 'guard' | 'spell';

type CellMark = {
  move?: boolean;
  range?: CellRange;
  target?: boolean;
  impact?: ImpactKind;
  focus?: boolean;
  pending?: boolean;
  invalid?: boolean;
};

/**
 * The actions each class picks between in Act mode.
 *
 * A Cleric can both swing and mend and a Warrior can hit, slam or cover an
 * ally, so which one a click means has to be an explicit choice — otherwise a
 * tile that is both attackable and healable is ambiguous, and there is no way
 * to say "I meant to attack".
 */
const ACT_CHOICES: Record<UnitType, ActChoice[]> = {
  WARRIOR: ['ATTACK', 'SLAM', 'GUARD'],
  CLERIC: ['ATTACK', 'HEAL'],
  WIZARD: ['ATTACK'],
  RANGER: ['ATTACK'],
  PALADIN: ['ATTACK'],
  BARD: ['ATTACK'],
  WARLOCK: ['ATTACK'],
  DRUID: ['ATTACK'],
  ROGUE: ['ATTACK'],
  // One action each. There is no selector to open for a monster because there is
  // nothing to choose between — no heal, no slam, no guard.
  BEAST: ['ATTACK'],
  SPITTER: ['ATTACK'],
};

const ACT_LABEL: Record<ActChoice, string> = {
  ATTACK: 'Attack',
  HEAL: 'Heal',
  GUARD: 'Guard',
  SLAM: 'Slam',
};

/** Pixel size for lucide fallbacks in the action list; attack art has its own SVG. */
const SKILL_ICON_SIZE = 40;

const FALLBACK_ICON: Partial<Record<ActChoice | AbilityId, typeof Swords>> = {
  ATTACK: Swords,
  HEAL: Cross,
  GUARD: Shield,
  SLAM: Hammer,
  // `SLAM` and `SHIELD_SLAM` are the same action under two ids — the Act list
  // calls it Slam, the ability list Shield Slam.
  SHIELD_SLAM: Hammer,
  // New classes have no pixel art yet, so each skill gets a distinct lucide glyph
  // instead of all fifteen sharing the generic sparkle.
  HOLY_SMITE: Swords,
  DIVINE_SHIELD: Shield,
  HOLY_LIGHT: Cross,
  DISSONANT_MELODY: Music,
  INSPIRING_ANTHEM: Sparkles,
  SONG_OF_REST: Cross,
  ELDRITCH_BOLT: Flame,
  CURSE_OF_AGONY: Skull,
  SOUL_DRAIN: Eye,
  THORN_WHIP: Anchor,
  REGROWTH: Leaf,
  ROOTS_OF_ENTANGLEMENT: Anchor,
  BACKSTAB: Swords,
  SHADOW_STEP: ChevronsRight,
  POISONED_DAGGER: Skull,
};

/** Class-specific pixel attack art; lucide remains only for non-attack actions. */
const ActGlyph = ({ choice, unitType }: { choice: ActChoice; unitType: UnitType }) => {
  if (choice === 'ATTACK') {
    return (
      <SpriteIcon
        id={`attack-${unitType.toLowerCase()}`}
        size={SKILL_ICON_SIZE}
        fallback={<SosActionIcon kind="attack" unitType={unitType} size={SKILL_ICON_SIZE} />}
      />
    );
  }
  if (choice === 'SLAM') {
    return (
      <SpriteIcon
        id="shield-slam"
        size={SKILL_ICON_SIZE}
        fallback={<Hammer size={SKILL_ICON_SIZE} aria-hidden="true" />}
      />
    );
  }
  if (choice === 'HEAL' || choice === 'GUARD') {
    const Icon = FALLBACK_ICON[choice] ?? Cross;
    return (
      <SpriteIcon
        id={choice.toLowerCase()}
        size={SKILL_ICON_SIZE}
        fallback={<Icon size={SKILL_ICON_SIZE} aria-hidden="true" />}
      />
    );
  }
  return null;
};

/** Fallback glyph for an ability row that has no generated sprite. */
const IconOf = ({ id }: { id: AbilityId }) => {
  const Icon = FALLBACK_ICON[id] ?? Sparkles;
  return <Icon size={SKILL_ICON_SIZE} aria-hidden="true" />;
};

/** Plain-language rules text for an action, read from the unit's live stats. */
const actDescription = (choice: ActChoice, unit: Unit): string => {
  const { attackDamage, attackRange, moveReach } = unit.stats;
  switch (choice) {
    case 'ATTACK':
      if (unit.type === 'RANGER') {
        return `${RANGER_ATTACK.minDamage}–${RANGER_ATTACK.maxDamage} damage · ${rangerAccuracyPercent(1)}% accuracy at 1 tile, −${RANGER_ATTACK.accuracyLossPerTilePercent}% per tile to ${rangerAccuracyPercent(attackRange)}% at ${attackRange} · line of sight.`;
      }
      return unit.type === 'WIZARD'
        ? `${attackDamage} damage · range ${attackRange} (diagonals cost 2) · splashes adjacent enemies.`
        : `${attackDamage} damage · range ${attackRange}.`;
    case 'HEAL':
      return `Restore ${unit.healPower ?? 0} HP to an ally or yourself: up to ${CLERIC_HEAL_RANGE.straight} orthogonal tiles or ${CLERIC_HEAL_RANGE.diagonal} diagonal tile away.`;
    case 'GUARD':
      return 'Free. Cover an adjacent ally — every hit on them lands on you until your next turn.';
    case 'SLAM':
      return `Slam a tile within reach 1. ${attackDamage} damage and a shove. Hits allies too.`;
    default:
      return `Move up to ${moveReach} tiles.`;
  }
};

/**
 * Grace period before the turn is handed on once every living unit has moved.
 *
 * Not zero because the player may still be looking at the board — reading the
 * log, checking the new positions, deciding they would rather reset the pieces
 * mentally. Three seconds is long enough to cancel by hand and short enough that
 * the next turn is not made to wait on it.
 */
const AUTO_END_SECONDS = 3;

const CLASS_LABELS: Record<UnitType, string> = {
  WARRIOR: 'Warrior',
  CLERIC: 'Cleric',
  WIZARD: 'Wizard',
  RANGER: 'Ranger',
  PALADIN: 'Paladin',
  BARD: 'Bard',
  WARLOCK: 'Warlock',
  DRUID: 'Druid',
  ROGUE: 'Rogue',
  BEAST: 'Beast',
  SPITTER: 'Spitter',
};

const abilityName = (ability: AbilityId): string => ABILITY_DISPLAY_NAME[ability];

const abilityDescription = (ability: AbilityId): string => {
  switch (ability) {
    case 'FIREBALL':
      return `${ABILITIES.FIREBALL.damage} damage on the aimed tile and ${ABILITIES.FIREBALL.splash} to the ${ABILITIES.FIREBALL.size}×${ABILITIES.FIREBALL.size} ring around it · range ${ABILITIES.FIREBALL.range} (diagonals cost 2). Burns your own units too.`;
    case 'THUNDER_STRIKE':
      return `${ABILITIES.THUNDER_STRIKE.damage} damage down a ${ABILITIES.THUNDER_STRIKE.tiles}-tile line · range ${ABILITIES.THUNDER_STRIKE.range} (diagonals cost 2). Burns your own units too.`;
    case 'ICE_WALL':
      return `Raise an impassable ice tile that melts after ${ABILITIES.ICE_WALL.durationTurns} turns. Cast on a unit to freeze it — it cannot move or act until the ice breaks. Range ${ABILITIES.ICE_WALL.range} (diagonals cost 2).`;
    case 'BLESS_GROUND':
      return `Bless a cross — the tile and its four orthogonal neighbours, no diagonals. Your units inside regenerate ${ABILITIES.SANCTIFIED_GROUND.regen} HP per turn. Lasts ${ABILITIES.SANCTIFIED_GROUND.durationTurns} turns; blessing again replaces your previous ground.`;
    case 'TRAP':
      return `Hide a trap on a tile right beside you · the 3×3 around you · lasts until triggered. Roots the first enemy to step on it.`;
    case 'GRAPPLE':
      return `Hook a wall up to ${ABILITIES.GRAPPLE.range} tiles away — straight up, down, left or right only — and land beside it (uses your move). Or hook any unit within ${ABILITIES.GRAPPLE.range} range (diagonals cost 2) and drag them next to you (uses your action).`;
    case 'HOLY_SMITE':
      return `${ABILITIES.HOLY_SMITE.meleeDamage} damage in melee, ${ABILITIES.HOLY_SMITE.rangedDamage} at range ${ABILITIES.HOLY_SMITE.rangedRange}. A melee smite also restores ${ABILITIES.HOLY_SMITE.healAdjacent} HP to each ally beside you.`;
    case 'DIVINE_SHIELD':
      return `Grant ${ABILITIES.DIVINE_SHIELD.shieldHp} shield HP to your units in a cross centred on the aimed tile (self or an adjacent ally).`;
    case 'HOLY_LIGHT':
      return `Heal an ally ${ABILITIES.HOLY_LIGHT.heal} HP, or blind an enemy so its next attack misses · range ${ABILITIES.HOLY_LIGHT.range}.`;
    case 'DISSONANT_MELODY':
      return `${ABILITIES.DISSONANT_MELODY.damage} damage and push 1 tile · range ${ABILITIES.DISSONANT_MELODY.range}.`;
    case 'INSPIRING_ANTHEM':
      return `Allies in the 3×3 around the aimed tile gain +1 movement for 2 turns · range ${ABILITIES.INSPIRING_ANTHEM.range}.`;
    case 'SONG_OF_REST':
      return `Allies in the 3×3 around the aimed tile heal ${ABILITIES.SONG_OF_REST.regen} HP and regenerate ${ABILITIES.SONG_OF_REST.regen} HP for 2 turns · range ${ABILITIES.SONG_OF_REST.range}.`;
    case 'ELDRITCH_BOLT':
      return `${ABILITIES.ELDRITCH_BOLT.damage} damage · range ${ABILITIES.ELDRITCH_BOLT.range}.`;
    case 'CURSE_OF_AGONY':
      return `${ABILITIES.CURSE_OF_AGONY.dot} damage per turn for ${ABILITIES.CURSE_OF_AGONY.turns} turns · range ${ABILITIES.CURSE_OF_AGONY.range}.`;
    case 'SOUL_DRAIN':
      return `${ABILITIES.SOUL_DRAIN.damage} damage and heal the Warlock ${ABILITIES.SOUL_DRAIN.heal} HP · range ${ABILITIES.SOUL_DRAIN.range}.`;
    case 'THORN_WHIP':
      return `${ABILITIES.THORN_WHIP.damage} damage and pull the target 1 tile closer · range ${ABILITIES.THORN_WHIP.range}.`;
    case 'REGROWTH':
      return `Heal an ally ${ABILITIES.REGROWTH.heal} HP and regenerate 2 HP for 2 turns · range ${ABILITIES.REGROWTH.range}.`;
    case 'ROOTS_OF_ENTANGLEMENT':
      return `Root an enemy in place for its next turn · range ${ABILITIES.ROOTS_OF_ENTANGLEMENT.range}.`;
    case 'BACKSTAB':
      return `${ABILITIES.BACKSTAB.damage} damage, or ${ABILITIES.BACKSTAB.critDamage} when striking from behind · range ${ABILITIES.BACKSTAB.range}.`;
    case 'SHADOW_STEP':
      return `Teleport to a free tile up to ${ABILITIES.SHADOW_STEP.range} away (uses your move and action).`;
    case 'POISONED_DAGGER':
      return `${ABILITIES.POISONED_DAGGER.damage} damage plus ${ABILITIES.POISONED_DAGGER.poisonDamage} poison for ${ABILITIES.POISONED_DAGGER.poisonTurns} turns · range ${ABILITIES.POISONED_DAGGER.range}.`;
    default:
      return '';
  }
};

/**
 * The abilities each class can use, mapped to the command they dispatch.
 * Ordering is the order the buttons appear in. Slam and Guard moved out of here
 * and into the Act selector, so a unit's actions live in one place.
 */
const CLASS_ABILITIES: Record<UnitType, Array<{ id: AbilityId; label: string }>> = {
  WARRIOR: [],
  WIZARD: [
    { id: 'FIREBALL', label: 'Fireball' },
    { id: 'THUNDER_STRIKE', label: 'Thunder Strike' },
    { id: 'ICE_WALL', label: 'Ice Wall' },
  ],
  CLERIC: [{ id: 'BLESS_GROUND', label: 'Sanctified Ground' }],
  RANGER: [
    { id: 'TRAP', label: 'Trap' },
    { id: 'GRAPPLE', label: 'Grapple' },
  ],
  // Empty, and that is the fix. The garrison used to be WARRIOR/RANGER/WIZARD/
  // CLERIC, so the monster Wizard threw Fireball and the monster Cleric blessed
  // the ground — a monster should bite you, not open a spellbook.
  BEAST: [],
  SPITTER: [],
  PALADIN: [
    { id: 'HOLY_SMITE', label: 'Holy Smite' },
    { id: 'DIVINE_SHIELD', label: 'Divine Shield' },
    { id: 'HOLY_LIGHT', label: 'Holy Light' },
  ],
  BARD: [
    { id: 'DISSONANT_MELODY', label: 'Dissonant Melody' },
    { id: 'INSPIRING_ANTHEM', label: 'Inspiring Anthem' },
    { id: 'SONG_OF_REST', label: 'Song of Rest' },
  ],
  WARLOCK: [
    { id: 'ELDRITCH_BOLT', label: 'Eldritch Bolt' },
    { id: 'CURSE_OF_AGONY', label: 'Curse of Agony' },
    { id: 'SOUL_DRAIN', label: 'Soul Drain' },
  ],
  DRUID: [
    { id: 'THORN_WHIP', label: 'Thorn Whip' },
    { id: 'REGROWTH', label: 'Regrowth' },
    { id: 'ROOTS_OF_ENTANGLEMENT', label: 'Roots of Entanglement' },
  ],
  ROGUE: [
    { id: 'BACKSTAB', label: 'Backstab' },
    { id: 'SHADOW_STEP', label: 'Shadow Step' },
    { id: 'POISONED_DAGGER', label: 'Poisoned Dagger' },
  ],
};

/**
 * Map an armed ability + chosen tile onto its command. Returns null when the
 * tile cannot legally be targeted at all (occupied for a wall/trap, etc.), so
 * the UI can buzz instead of sending a doomed request.
 */
const buildAbilityCommand = (
  ability: AbilityId,
  unit: Unit,
  tile: Position,
): GameCommand | null =>
  ({
    type: abilityCommand(ability),
    unitId: unit.id,
    x: tile.x,
    y: tile.y,
  }) as GameCommand;

/**
 * Command name for every tile-targeted ability.
 *
 * Total on purpose: the partial map + non-null assertion this replaced silently
 * produced `{ type: undefined }` for all twelve new abilities, so every new class
 * skill confirmed and then did nothing.
 */
const ABILITY_COMMAND: Record<AbilityId, GameCommand['type']> = {
  FIREBALL: 'CAST_FIREBALL',
  THUNDER_STRIKE: 'CAST_THUNDER_STRIKE',
  ICE_WALL: 'SUMMON_ICE_WALL',
  BLESS_GROUND: 'BLESS_GROUND',
  TRAP: 'PLACE_TRAP',
  GRAPPLE: 'GRAPPLE',
  SHIELD_SLAM: 'SHIELD_SLAM',
  HOLY_SMITE: 'HOLY_SMITE',
  DIVINE_SHIELD: 'DIVINE_SHIELD',
  HOLY_LIGHT: 'HOLY_LIGHT',
  DISSONANT_MELODY: 'DISSONANT_MELODY',
  INSPIRING_ANTHEM: 'INSPIRING_ANTHEM',
  SONG_OF_REST: 'SONG_OF_REST',
  ELDRITCH_BOLT: 'ELDRITCH_BOLT',
  CURSE_OF_AGONY: 'CURSE_OF_AGONY',
  SOUL_DRAIN: 'SOUL_DRAIN',
  THORN_WHIP: 'THORN_WHIP',
  REGROWTH: 'REGROWTH',
  ROOTS_OF_ENTANGLEMENT: 'ROOTS_OF_ENTANGLEMENT',
  BACKSTAB: 'BACKSTAB',
  SHADOW_STEP: 'SHADOW_STEP',
  POISONED_DAGGER: 'POISONED_DAGGER',
};

const abilityCommand = (ability: AbilityId) => ABILITY_COMMAND[ability];

export default function SquareOfShadows({
  userId,
  nickname,
  avatarImage = null,
  isOnline = false,
  sendRaw,
  subscribe,
  initialRoom = null,
}: SquareOfShadowsProps) {
  const sos = useSquareOfShadows({ userId, nickname, sendRaw, subscribe, initialRoom, isOnline });
  const {
    mode,
    state,
    events,
    error,
    clearError,
    room,
    roomError,
    clearRoomError,
    canPlayOnline,
    hostOnline,
    joinOnline,
    leaveOnline,
    lobbyPlayers,
    lobbyRooms,
    lobbyResume,
    lobbyResumeLoaded,
    rejoinSecondsLeft,
    enterLobby,
    leaveLobby,
    refreshLobby,
    sendChallenge,
    incomingChallenge,
    outgoingChallenge,
    challengeSecondsLeft,
    respondChallenge,
    challengeToast,
    clearChallengeToast,
    graceNotice,
    graceSecondsLeft,
    turnDeadline,
    selectedUnitId,
    selectedUnit,
    selectUnit,
    legalMoves,
    legalAttackTargets,
    legalHealTargets,
    dispatch,
    startGame,
    backToMenu,
    resumeOnline,
    resumeRoomId,
    humanId,
    playerLabels,
    isAiTurn,
    activePlayerIsHuman,
  } = sos;
  const mapMode = state?.mapMode ?? 'CLASSIC';
  const terrainTheme = state ? terrainThemeForGame(state.gameId, mapMode) : 'dungeon';
  const terrainSheet = terrainAtlasName(terrainTheme);
  const usesWangTerrain = terrainTheme !== 'dungeon';

  /**
   * The batch of events actually being played.
   *
   * The engine resolves a whole enemy turn — every monster in adventure — inside
   * a single command, so one batch can describe five units moving and striking
   * at once. Nothing here can slow the engine down, but the *presentation* can
   * be released one acting unit at a time, which is what makes an enemy turn
   * followable. Every effect, floater and log line below reads this, never the
   * raw `events`, so the board and the log can never disagree about who is
   * acting.
   */
  const [playedEvents, setPlayedEvents] = useState<GameEvent[]>(events);
  useEffect(() => {
    const beats = splitEventBeats(events, humanId);
    if (beats.length <= 1) {
      setPlayedEvents(events);
      return undefined;
    }
    setPlayedEvents(beats[0]);
    const timers = beats
      .slice(1)
      .map((beat, index) =>
        window.setTimeout(() => setPlayedEvents(beat), ENEMY_STEP_MS * (index + 1)),
      );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [events, humanId]);

  // Drop a stale selection when control changes hands or the unit falls.
  useEffect(() => {
    if (!state || !selectedUnitId) return;
    const unit = state.units.get(selectedUnitId);
    if (!unit || unit.stats.currentHp <= 0 || unit.ownerId !== state.activePlayerId) {
      selectUnit(null);
    }
  }, [state, selectedUnitId, selectUnit]);

  // ── audio ───────────────────────────────────────────────────────────────
  // Browsers require a gesture before music can play. Remember the first menu
  // click, then resume the already-requested loop.
  const [audioPrefs, setAudioPrefs] = useState(getAudioPrefs);
  const audioUnlocked = useRef(false);

  // ── camera window ───────────────────────────────────────────────────────
  // A view preference, not game state. Persisted locally so a player who likes
  // a 5x5 window keeps it across sessions, while the other player in an online
  // room can still choose their own.
  const [boardViewSize, setBoardViewSize] = useState<BoardViewSize>(readBoardViewSize);
  /**
   * Where a drag left the camera. `null` means "follow the focused unit"; any
   * origin means the player is inspecting/pushing toward a target outside the
   * auto-centred window. It is cleared on selection/turn changes so the camera
   * never stays parked on a unit that is no longer acting.
   */
  const [manualViewOrigin, setManualViewOrigin] = useState<Position | null>(null);
  const boardDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    tilePx: number;
    moved: boolean;
  } | null>(null);
  const suppressBoardClickRef = useRef(false);
  const suppressBoardClickTimerRef = useRef<number | null>(null);
  /** Active requestAnimationFrame for a click-to-centre camera glide. */
  const cameraTweenRef = useRef<number | null>(null);
  /**
   * Set for the one render where deselecting must NOT clear the camera.
   *
   * The usual "selection changed" reset is correct for picking another unit,
   * but the Free Nav button deliberately deselects while preserving the view.
   * This flag lets that single transition keep the origin it just captured.
   */
  const keepManualOnDeselectRef = useRef(false);

  const cancelCameraTween = useCallback(() => {
    if (cameraTweenRef.current !== null) {
      cancelAnimationFrame(cameraTweenRef.current);
      cameraTweenRef.current = null;
    }
  }, []);

  useEffect(() => () => cancelCameraTween(), [cancelCameraTween]);

  const handleFirstGesture = useCallback(() => {
    if (audioUnlocked.current) return;
    audioUnlocked.current = true;
    unlockAudio();
    restoreAudio();
  }, []);

  // Only the actual board uses battle music. Drafting, online lobbies, waiting
  // rooms, and results keep the same menu loop running without restarting it.
  const musicTrack = state?.phase === 'playing' ? 'battle' : 'menu';
  useEffect(() => {
    setMusicTrack(musicTrack);
  }, [musicTrack]);

  // Stop the soundscape when the player is not actually looking at the game:
  // on tab hide, on window blur, and on unmount. Suspending the context rather
  // than tearing it down keeps playback position, so returning is seamless.
  useEffect(() => {
    const suspend = () => setAudioSuspended(true);
    const resume = () => {
      if (!document.hidden) setAudioSuspended(false);
    };
    const onVisibility = () => (document.hidden ? suspend() : resume());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', suspend);
    window.addEventListener('focus', resume);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', suspend);
      window.removeEventListener('focus', resume);
      stopAudio();
    };
  }, []);

  /** Transient elemental bursts, one per spell cast. */
  const [spellFx, setSpellFx] = useState<SosSpellFx[]>([]);
  const fxSeq = useRef(0);

  /** Things that travel between tiles. */
  const [linkFx, setLinkFx] = useState<SosLinkFx[]>([]);
  const linkSeq = useRef(0);

  /**
   * Spawn a short-lived effect; `ms` matches the CSS animation length.
   *
   * `delayMs` holds the effect back so an impact can be scheduled to land at
   * the instant a projectile arrives, rather than on the frame the command
   * resolved.
   */
  const spawnFx = useCallback(
    (make: (id: string) => SosSpellFx | null, ms: number, delayMs = 0) => {
      const id = `fx-${(fxSeq.current += 1)}`;
      const fx = make(id);
      if (!fx) return;
      const show = () => {
        setSpellFx((prev) => [...prev.slice(-10), fx]);
        // Retire by the effect's own id. Multi-tile effects (a Fireball's blast,
        // a Thunder line, the holy sigil stamps) suffix the id per tile, so
        // filtering on the base id matched nothing and left the emitters on the
        // board forever.
        window.setTimeout(() => setSpellFx((prev) => prev.filter((f) => f.id !== fx.id)), ms);
      };
      if (delayMs > 0) window.setTimeout(show, delayMs);
      else show();
    },
    [],
  );

  /**
   * Launch a travelling sprite between two tiles and return how long the flight
   * takes, so the caller can schedule the impact to match. Melee has no gap to
   * cross and returns 0 — its arc is drawn at the target instead.
   */
  const spawnLink = useCallback(
    (from: Position | undefined, to: Position | undefined, kind: SosLinkFx['kind']): number => {
      if (!from || !to) return 0;
      const id = `ln-${(linkSeq.current += 1)}`;
      const angleDeg = Math.atan2(to.y - from.y, to.x - from.x) * (180 / Math.PI);
      const rad = (angleDeg * Math.PI) / 180;
      const travelMs = travelMsFor(from, to);
      setLinkFx((prev) => [
        ...prev.slice(-6),
        {
          id,
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
          kind,
          angleDeg,
          travelMs,
          // Unit vector along the flight, for the motion-blur trail. Passed in
          // because CSS cannot derive cos/sin from a custom angle property.
          dirX: Math.cos(rad),
          dirY: Math.sin(rad),
        },
      ]);
      window.setTimeout(() => setLinkFx((prev) => prev.filter((f) => f.id !== id)), travelMs + 80);
      return travelMs;
    },
    [],
  );

  /**
   * Transient reaction attached to a unit itself.
   *
   * The existing effects live in a separate tile-positioned layer, which reads
   * as "something happened on that square" rather than "that piece reacted".
   * These go on the unit element, so a hit, a heal or a lunge is visibly
   * *somebody's* — which is the whole problem when the opponent's turn plays
   * out on your board and you are watching two red pieces.
   *
   * The parity suffix is load-bearing: re-applying the same class would not
   * restart a CSS animation, so the same reaction twice in a row would play
   * once. Alternating the suffix forces the class to change.
   */
  const [reactions, setReactions] = useState<
    Record<string, { kind: UnitReactionKind; seq: number; dx?: number; dy?: number; lunge?: number }>
  >({});
  const reactionSeq = useRef(0);

  const react = useCallback(
    (
      unitId: string,
      kind: UnitReactionKind,
      dir?: { dx: number; dy: number; lunge?: number },
      delayMs = 0,
    ) => {
      if (!unitId) return;
      const seq = (reactionSeq.current += 1);
      const entry = { kind, seq, dx: dir?.dx, dy: dir?.dy, lunge: dir?.lunge };
      const show = () => {
        setReactions((prev) => ({ ...prev, [unitId]: entry }));
        window.setTimeout(() => {
          setReactions((prev) => {
            // A newer reaction on the same unit has already taken over.
            if (prev[unitId]?.seq !== seq) return prev;
            const next = { ...prev };
            delete next[unitId];
            return next;
          });
        }, 560);
      };
      if (delayMs > 0) window.setTimeout(show, delayMs);
      else show();
    },
    [],
  );

  const reactionClass = useCallback((unitId: string) => {
    const r = reactions[unitId];
    if (!r) return '';
    return `rx-${r.kind}-${r.seq % 2}`;
  }, [reactions]);

  // ── combat log & board hit-stop shake ───────────────────────────────────
  const [combatLog, setCombatLog] = useState<CombatLogEntry[]>([]);
  const logSeq = useRef(0);
  const [boardShake, setBoardShake] = useState<
    { seq: number; dx: number; dy: number; amp: number; durMs: number } | null
  >(null);
  const shakeSeq = useRef(0);

  /**
   * Shake the board. `spec` scales the kick to the damage that landed; without
   * one it falls back to a small fixed nudge so non-damaging events (a shove, a
   * guard) still register as landing on the board.
   */
  const triggerBoardShake = useCallback(
    (dx = 1, dy = 0, spec?: { amp: number; durMs: number }) => {
      const seq = (shakeSeq.current += 1);
      const sx = dx === 0 && dy === 0 ? 1 : Math.sign(dx);
      const sy = Math.sign(dy);
      setBoardShake({ seq, dx: sx, dy: sy, amp: spec?.amp ?? 3, durMs: spec?.durMs ?? 220 });
      window.setTimeout(() => {
        setBoardShake((prev) => (prev?.seq === seq ? null : prev));
      }, spec?.durMs ?? 220);
    },
    [],
  );

  /**
   * Hit-stop. A short freeze on the frame a blow lands, which is most of what
   * makes a hit feel heavy rather than merely registered. Suppressed under
   * `prefers-reduced-motion`, where a full-board stall reads as a dropped frame.
   */
  const [hitStop, setHitStop] = useState<{ seq: number; ms: number } | null>(null);
  const hitStopSeq = useRef(0);
  const triggerHitStop = useCallback((ms: number) => {
    if (ms <= 0) return;
    const seq = (hitStopSeq.current += 1);
    setHitStop({ seq, ms });
    window.setTimeout(() => {
      setHitStop((prev) => (prev?.seq === seq ? null : prev));
    }, ms);
  }, []);

  // Reset combat log when returning to menu or starting a fresh match.
  const matchResetKey = state ? `${mode}:${state.gameId}` : 'none';
  const battleStatsRef = useRef<BattleStats>(emptyBattleStats());
  const [battleStats, setBattleStats] = useState<BattleStats>(emptyBattleStats());
  useEffect(() => {
    setCombatLog([]);
    battleStatsRef.current = emptyBattleStats();
    setBattleStats(emptyBattleStats());
    // A new match is a new turn identity; without this the auto-select latch
    // from the previous game would suppress the first selection of this one.
    autoSelectedTurnRef.current = null;
  }, [matchResetKey]);

  // Play the newest batch of events exactly once.
  // A counter latch was wrong here: events are replaced per action but never
  // emptied in between, so everything after the first action was skipped and
  // spells appeared to do nothing. Comparing the array identity is what
  // actually distinguishes one action's events from the last.
  const lastPlayedEvents = useRef<GameEvent[] | null>(null);
  useEffect(() => {
    if (!state || playedEvents.length === 0) {
      lastPlayedEvents.current = null;
      return undefined;
    }
    if (lastPlayedEvents.current === playedEvents) return undefined;
    lastPlayedEvents.current = playedEvents;
    battleStatsRef.current = tallyBattleStats(battleStatsRef.current, playedEvents, state, humanId);
    // Captured once so the closures below keep the non-null narrowing.
      const width = state.boardSize.width;
      const at = (unitId: string) => {
        const unit = state.units.get(unitId);
        return { pan: panFromColumn(unit?.position.x ?? 0, width) };
      };
      const describeUnit = (unitId: string): string => {
        const u = state.units.get(unitId);
        if (!u) return 'Unit';
        const side = u.ownerId === humanId ? 'Your' : 'Enemy';
        return `${side} ${CLASS_META[u.type].label}`;
      };
      const newLogs: CombatLogEntry[] = [];
      const pushLog = (kind: CombatLogEntry['kind'], text: string, icon?: string) => {
        newLogs.push({
          id: `lg-${(logSeq.current += 1)}`,
          turn: state.turnNumber,
          kind,
          text,
          icon,
        });
      };

      // Pre-collect spell hits in this batch so SPELL_CAST can report its exact damage targets.
      const spellHitsInBatch = playedEvents.filter(
        (e): e is Extract<GameEvent, { type: 'SPELL_HIT' }> => e.type === 'SPELL_HIT',
      );
      const guardAbsorbedInBatch = playedEvents.filter(
        (e): e is Extract<GameEvent, { type: 'GUARD_ABSORBED' }> => e.type === 'GUARD_ABSORBED',
      );
      const rangerShotUnits = new Set(
        playedEvents.filter((e): e is Extract<GameEvent, { type: 'RANGER_SHOT' }> => e.type === 'RANGER_SHOT')
          .map((e) => e.unitId),
      );

      // Frozen for this batch's choreography: impact shake and hit-stop are
      // skipped outright when the player has asked for reduced motion.
      const reducedMotion = prefersReducedMotion();

      /**
       * Everything that should read as "the blow landed", scheduled to fire at
       * `delayMs` — the moment the projectile arrives — instead of on the frame
       * the command resolved.
       */
      const landImpact = (opts: {
        damage: number;
        dx: number;
        dy: number;
        delayMs: number;
        killed: boolean;
        targetId?: string;
        where?: { pan: number };
      }) => {
        const run = () => {
          if (opts.where) playSfx('hit', opts.where);
          if (opts.targetId) {
            react(opts.targetId, 'hit', { dx: -opts.dx, dy: -opts.dy });
          }
          const spec = shakeFor(opts.damage, reducedMotion);
          if (spec) {
            triggerBoardShake(
              opts.dx,
              opts.dy,
              opts.killed
                ? {
                    amp: Math.min(9, spec.amp + KILL_SHAKE_BONUS.amp),
                    durMs: spec.durMs + KILL_SHAKE_BONUS.durMs,
                  }
                : spec,
            );
          }
          triggerHitStop(hitStopMsFor(opts.damage, reducedMotion));
        };
        if (opts.delayMs > 0) window.setTimeout(run, opts.delayMs);
        else run();
      };

      for (const ev of playedEvents) {
        if (ev.type === 'RANGER_SHOT') {
          const shooter = state.units.get(ev.unitId);
          // `RANGER_SHOT` is the engine's generic *tile attack* event that every
          // class can emit, so the travelling sprite must come from the shooter's
          // class — never from the event name. Only a Ranger gets an arrow.
          const linkKind = attackLinkFor(shooter?.type);
          const melee = isMeleeClass(shooter?.type);
          const arrivalMs = shooter ? impactDelayFor(shooter.position, ev.to, shooter.type) : 0;
          const sdx = ev.to.x - (shooter?.position.x ?? ev.to.x);
          const sdy = ev.to.y - (shooter?.position.y ?? ev.to.y);

          if (shooter) {
            // Melee never crosses a gap: its slash arc is drawn at the target on
            // the strike frame rather than flying a sprite across the board.
            if (!melee && linkKind) spawnLink(shooter.position, ev.to, linkKind);
            react(ev.unitId, 'lunge', {
              dx: sdx,
              dy: sdy,
              lunge: lungeDistanceFor(shooter.type),
            });
          }
          playSfx('attack', { pan: panFromColumn(ev.to.x, width) });

          // A melee blow onto bare ground or a breakable still needs to read as
          // landing somewhere, so it gets its arc drawn on the tile.
          if (melee) {
            spawnFx((id) => ({ id, x: ev.to.x, y: ev.to.y, ability: 'SLASH' }), 560, arrivalMs);
          }

          if (ev.hit && ev.targetId) {
            const destroyed = [
              ev.destroyedTrap ? 'trap' : '',
              ev.destroyedIce ? 'ice barrier' : '',
            ].filter(Boolean).join(' and ');
            if (destroyed) pushLog('damage', `${describeUnit(ev.unitId)}'s blow breaks the ${destroyed}`);
            continue; // UNIT_ATTACKED logs and resolves the hit.
          }
          if (!ev.hit) {
            const targetName = ev.targetId ? describeUnit(ev.targetId) : `tile (${ev.to.x}, ${ev.to.y})`;
            pushLog('damage', `${describeUnit(ev.unitId)} misses ${targetName} (${ev.accuracy}% accuracy)`);
          } else {
            const destroyed = [
              ev.destroyedTrap ? 'trap' : '',
              ev.destroyedIce ? 'ice barrier' : '',
            ].filter(Boolean).join(' and ');
            // The crack of a barrier breaking belongs on arrival, not on release.
            if (destroyed) {
              window.setTimeout(
                () => playSfx('hit', { pan: panFromColumn(ev.to.x, width) }),
                arrivalMs,
              );
            }
            pushLog(
              'damage',
              destroyed
                ? `${describeUnit(ev.unitId)} breaks the ${destroyed} at (${ev.to.x}, ${ev.to.y})`
                : `${describeUnit(ev.unitId)}'s attack is spent on empty tile (${ev.to.x}, ${ev.to.y})`,
            );
          }
        } else if (ev.type === 'UNIT_ATTACKED') {
          // Panned to the target so you can hear which side took the hit.
          const where = at(ev.targetId);
          playSfx('attack', where);
          const struck = state.units.get(ev.targetId);
          const attacker = state.units.get(ev.attackerId);
          const melee = isMeleeClass(attacker?.type);
          const dx = struck && attacker ? struck.position.x - attacker.position.x : 1;
          const dy = struck && attacker ? struck.position.y - attacker.position.y : 0;
          // The impact lands when the projectile does. A RANGER_SHOT earlier in
          // this same batch already put the sprite in the air, so reuse the same
          // arrival time instead of starting a second clock.
          const arrivalMs =
            attacker && struck ? impactDelayFor(attacker.position, struck.position, attacker.type) : 0;

          // The swing itself starts now; only the *landing* waits.
          playSfx('attack', where);
          if (attacker) {
            react(ev.attackerId, 'lunge', {
              dx,
              dy,
              lunge: lungeDistanceFor(attacker.type),
            });
          }
          // Melee has no gap to cross — its arc is drawn at the target instead.
          // Skip too when a RANGER_SHOT in this batch already drew the shot, or
          // the projectile renders twice.
          if (attacker && struck && !melee && !rangerShotUnits.has(ev.attackerId)) {
            const hitKind = attackLinkFor(attacker.type);
            if (hitKind) spawnLink(attacker.position, struck.position, hitKind);
          }

          if (ev.hit === false) {
            pushLog(
              'damage',
              `${describeUnit(ev.attackerId)} misses ${describeUnit(ev.targetId)} (${ev.accuracy ?? 0}% accuracy)`,
            );
            continue;
          }

          // Everything below reads as contact, so it waits for the sprite.
          if (struck) {
            spawnFx(
              (id) => ({ id, x: struck.position.x, y: struck.position.y, ability: 'BLOOD' }),
              700,
              arrivalMs,
            );
            spawnFx(
              (id) => ({ id, x: struck.position.x, y: struck.position.y, ability: 'SLASH' }),
              560,
              arrivalMs,
            );
          }
          landImpact({
            damage: ev.damage,
            dx,
            dy,
            delayMs: arrivalMs,
            killed: (ev.defeated?.length ?? 0) > 0,
            targetId: ev.targetId,
            where,
          });
          const guardHit = guardAbsorbedInBatch.find((g) => g.targetId === ev.targetId);
          const guardNote = guardHit
            ? ` (${describeUnit(guardHit.guardianId)} absorbed ${guardHit.damage} DMG)`
            : '';
          const accuracyNote = ev.accuracy === undefined ? '' : ` (${ev.accuracy}% accuracy)`;
          pushLog(
            'damage',
            `${describeUnit(ev.attackerId)} strikes ${describeUnit(ev.targetId)} for ${ev.damage} DMG${accuracyNote}${guardNote}`,
          );
        } else if (ev.type === 'UNIT_HEALED') {
          playSfx('heal', at(ev.targetId));
          const target = state.units.get(ev.targetId);
          if (target) {
            spawnFx(
              (id) => ({ id, x: target.position.x, y: target.position.y, ability: 'HEAL' }),
              900,
            );
          }
          react(ev.targetId, 'heal');
          pushLog(
            'heal',
            `${describeUnit(ev.healerId)} mends ${describeUnit(ev.targetId)} for +${ev.restored} HP`,
          );
        } else if (ev.type === 'ZONE_TICK') {
          // Standing on blessed ground: a green rise for allies, a burn for foes.
          if (ev.healed.length > 0) {
            const who = state.units.get(ev.healed[0].unitId);
            playSfx('heal', { pan: panFromColumn(who?.position.x ?? 0, width) });
            const list = ev.healed.map((h) => `${describeUnit(h.unitId)} (+${h.amount} HP)`).join(', ');
            pushLog('heal', `Sanctified Ground restores ${list}`, ABILITY_ICON.BLESS_GROUND);
          }
          if (ev.burned.length > 0) {
            const who = state.units.get(ev.burned[0].unitId);
            playSfx('hit', { pan: panFromColumn(who?.position.x ?? 0, width) });
            react(ev.burned[0].unitId, 'hit');
            const list = ev.burned.map((b) => `${describeUnit(b.unitId)} (-${b.amount} HP)`).join(', ');
            pushLog('damage', `Sanctified Ground sears ${list}`, ABILITY_ICON.BLESS_GROUND);
          }
        } else if (ev.type === 'SPELL_CAST') {
          // Every cast animates and sounds off, even a wasted one on bare stone.
          const where = { pan: panFromColumn(ev.x, width) };
          playSpell(spellCueFor(ev.ability), where);
          const caster = state.units.get(ev.unitId);
          // The cast reaction carries the pop, so the sprite's own cast row is
          // what sells the charge rather than a stray VFX over its head.
          react(ev.unitId, 'cast', caster ? {
            dx: ev.x - caster.position.x,
            dy: ev.y - caster.position.y,
          } : undefined);
          const spellName = ABILITY_DISPLAY_NAME[ev.ability] ?? ev.ability;
          const hits = spellHitsInBatch.filter((h) => h.unitId === ev.unitId);
          if (hits.length > 0) {
            // Area spells paint every victim on the same frame, which reads as one
            // flat wash. Scale the shake off the hardest single hit instead of
            // assuming a flat amount.
            const hardest = hits.reduce((max, h) => Math.max(max, h.damage), 0);
            const spec = shakeFor(hardest, reducedMotion);
            if (spec) {
              triggerBoardShake(
                caster ? ev.x - caster.position.x : 1,
                caster ? ev.y - caster.position.y : 1,
                spec,
              );
            }
            const hitDesc = hits
              .map((h) => `${describeUnit(h.targetId)} (-${h.damage} HP)`)
              .join(', ');
            pushLog(
              'spell',
              `${describeUnit(ev.unitId)} casts ${spellName} at (${ev.x}, ${ev.y}) → hits ${hitDesc}`,
              ABILITY_ICON[ev.ability],
            );
          } else {
            const frozenTarget =
              ev.ability === 'ICE_WALL' ? unitAt(state, { x: ev.x, y: ev.y }) : undefined;
            const extra = frozenTarget ? ` → freezes ${describeUnit(frozenTarget.id)}!` : '';
            pushLog(
              'spell',
              `${describeUnit(ev.unitId)} casts ${spellName} at (${ev.x}, ${ev.y})${extra}`,
              ABILITY_ICON[ev.ability],
            );
          }

          if (ev.ability === 'THUNDER_STRIKE') {
            // The bolt runs the length of its line rather than popping once.
            if (caster) {
              const tiles = thunderTiles(
                state,
                caster.position,
                { x: ev.x, y: ev.y },
                ABILITIES.THUNDER_STRIKE.tiles,
              );
              tiles.forEach((tile, i) =>
                spawnFx(
                  (id) => ({ id: `${id}-${i}`, x: tile.x, y: tile.y, ability: 'THUNDER_STRIKE' }),
                  900,
                ),
              );
            }
          } else if (ev.ability === 'GRAPPLE') {
            // Rope from the ranger to the wall it hooked.
            spawnLink(caster?.position, { x: ev.x, y: ev.y }, 'rope');
            spawnFx((id) => ({ id, x: ev.x, y: ev.y, ability: 'GRAPPLE' }), 900);
          } else if (ev.ability === 'FIREBALL') {
            spawnLink(caster?.position, { x: ev.x, y: ev.y }, 'firebolt');
            const blastTiles = fireballTiles(state, { x: ev.x, y: ev.y }, ABILITIES.FIREBALL.size);
            blastTiles.forEach((tile, i) =>
              spawnFx(
                (id) => ({ id: `${id}-${i}`, x: tile.x, y: tile.y, ability: 'FIREBALL' }),
                900,
              ),
            );
          } else if (ev.ability === 'BLESS_GROUND') {
            // Keep the original cast sigil as beat one. Then stamp the affected
            // tiles and finish with a single brief flash; no persistent tint.
            const anchor = { x: ev.x, y: ev.y };
            const covered = activeZoneTiles(state, anchor);
            const castMs = VFX_GIF_FOR.BLESS_GROUND!.durationMs;
            const sigilMs = 420;
            const staggerMs = 75;
            spawnFx((id) => ({ id, x: ev.x, y: ev.y, ability: 'BLESS_GROUND' }), castMs);
            // Centre first, then cross arms, each constrained to exactly one tile.
            const ordered = [...covered].sort((a, b) =>
              Number(a.x !== ev.x || a.y !== ev.y) - Number(b.x !== ev.x || b.y !== ev.y));
            ordered.forEach((tile, i) => {
              spawnFx(
                (id) => ({ id: `${id}-sig-${i}`, x: tile.x, y: tile.y, ability: 'HOLY_SIGIL' }),
                sigilMs,
                castMs + 60 + i * staggerMs,
              );
            });
            const flashDelay = castMs + 60 + Math.max(0, ordered.length - 1) * staggerMs + sigilMs;
            ordered.forEach((tile, i) => spawnFx(
              (id) => ({ id: `${id}-flash-${i}`, x: tile.x, y: tile.y, ability: 'HOLY_FLASH' }),
              260,
              flashDelay,
            ));
          } else {
            spawnFx((id) => ({ id, x: ev.x, y: ev.y, ability: ev.ability }), 900);
          }
        } else if (ev.type === 'UNIT_GUARDED') {
          // The shield visibly crosses from the warrior to the ally it covers.
          const warrior = state.units.get(ev.unitId);
          const ally = state.units.get(ev.targetId);
          spawnLink(warrior?.position, ally?.position, 'shield');
          spawnFx(
            (id) => (ally ? { id, x: ally.position.x, y: ally.position.y, ability: 'GUARD' } : null),
            900,
          );
          playSfx('select', {
            pan: panFromColumn(ally?.position.x ?? 0, width),
          });
          pushLog('guard', `${describeUnit(ev.unitId)} shields ${describeUnit(ev.targetId)}`);
        } else if (ev.type === 'UNIT_PUSHED') {
          // The target is visibly shoved, then lands with an impact.
          spawnLink({ x: ev.from.x, y: ev.from.y }, ev.to, 'push');
          spawnFx(
            (id) => ({ id, x: ev.to.x, y: ev.to.y, ability: 'SHIELD_SLAM' }),
            700,
          );
          const dx = ev.to.x - ev.from.x;
          const dy = ev.to.y - ev.from.y;
          react(ev.unitId, 'hit', { dx, dy });
          triggerBoardShake(dx, dy);
          pushLog('damage', `${describeUnit(ev.unitId)} is slammed to (${ev.to.x}, ${ev.to.y})`);
        } else if (ev.type === 'TRAP_TRIGGERED') {
          spawnFx((id) => ({ id, x: ev.x, y: ev.y, ability: 'TRAP_SPRING' }), 900);
          playSfx('hit', { pan: panFromColumn(ev.x, width) });
          react(ev.unitId, 'hit');
          triggerBoardShake(0, 1);
          pushLog(
            'trap',
            `${describeUnit(ev.unitId)} triggers a Spiked Trap at (${ev.x}, ${ev.y}) — rooted!`,
            ABILITY_ICON.TRAP,
          );
        } else if (ev.type === 'ICE_WALL_SUMMONED') {
          // A block of ice rises, then settles into the board.
          spawnFx((id) => ({ id, x: ev.x, y: ev.y, ability: 'ICE_RISE' }), 1000);
        } else if (ev.type === 'SPELL_HIT') {
          playSfx('hit', at(ev.targetId));
          const struck = state.units.get(ev.targetId);
          if (struck) {
            spawnFx((id) => ({ id, x: struck.position.x, y: struck.position.y, ability: 'BLOOD' }), 700);
          }
          react(ev.targetId, 'hit');
        } else if (ev.type === 'GUARD_ABSORBED') {
          playSfx('hit', at(ev.targetId));
          react(ev.targetId, 'hit');
        } else if (ev.type === 'UNIT_DEFEATED') {
          playSfx('unitDefeated', at(ev.unitId));
          const corpse = state.units.get(ev.unitId);
          if (corpse) {
            // A last, heavier splatter as the unit goes down.
            spawnFx((id) => ({ id, x: corpse.position.x, y: corpse.position.y, ability: 'DEATH' }), 1000);
          }
          react(ev.unitId, 'defeat');
          pushLog('defeat', `${describeUnit(ev.unitId)} has fallen!`);
        } else if (ev.type === 'SOUL_HARVESTED') {
          // The orb is the only feedback that the altar got anything out of a
          // kill, so it flies the whole way from the corpse to the stone.
          playSfx('soulHarvest', { pan: panFromColumn(ev.from.x, state.boardSize.width) });
          spawnLink(ev.from, ev.to, 'soul');
          pushLog('defeat', `A soul is drawn to the altar (${ev.souls} held).`);
        } else if (ev.type === 'ALTAR_WISH') {
          playSfx('altarWish');
          const raised = ev.position;
          const where = ev.wish === 'RESTORE' ? state.units.get(ev.unitId)?.position : raised;
          if (where) {
            spawnFx((id) => ({ id, x: where.x, y: where.y, ability: 'ALTAR' }), 1000);
          }
          if (ev.wish === 'RESTORE') {
            pushLog('heal', `${describeUnit(ev.unitId)} is made whole by the altar`);
          } else if (ev.resurrectedId) {
            // Named, not implied: a resurrection is the one altar wish that moves
            // a unit back onto the board, and the chronicle has to say who paid
            // for it. The chronicle already prints the turn chip for the row, so
            // the line carries only the story.
            const caster = state.units.get(ev.unitId);
            const raisedUnit = state.units.get(ev.resurrectedId);
            const casterName = playerLabels[caster?.ownerId ?? ''] ?? describeUnit(ev.unitId);
            const allyName = raisedUnit ? CLASS_META[raisedUnit.type].label : 'an ally';
            pushLog(
              'heal',
              `${casterName} sacrificed blood to resurrect ${allyName} at the Altar of Shadows!`,
            );
          }
        } else if (ev.type === 'UNIT_MOVED') {
          // Footstep timbre follows the mover's bulk, panned to where it landed.
          const mover = state.units.get(ev.unitId);
          playFootstep(footstepWeightFor(mover?.type ?? 'RANGER'), at(ev.unitId));
          // The board is a CSS grid, so the unit's element is already sitting in
          // its destination cell the instant this event lands. Reacting with the
          // move vector is what makes the step read: the sprite starts offset
          // back at `from` and slides home, so the tile change is a stride rather
          // than a teleport.
          react(ev.unitId, 'walk', {
            dx: ev.to.x - ev.from.x,
            dy: ev.to.y - ev.from.y,
          });
          pushLog('move', `${describeUnit(ev.unitId)} moves to (${ev.to.x}, ${ev.to.y})`);
        } else if (ev.type === 'TURN_ENDED') {
          const who =
            ev.activePlayerId === humanId
              ? 'Your turn begins'
              : `${playerLabels[ev.activePlayerId] ?? ev.activePlayerId}'s turn`;
          pushLog('turn', `Turn ${ev.turnNumber} — ${who}`);
        }
    }
    if (newLogs.length > 0) {
      setCombatLog((prev) => [...prev, ...newLogs].slice(-60));
    }
  }, [playedEvents, state, playSpell, spawnFx, spawnLink, playSfx, playFootstep, footstepWeightFor, panFromColumn, react, triggerBoardShake, triggerHitStop, humanId, playerLabels]);

  // Turn hand-off chime.
  const lastTurnRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state) return;
    const key = `${state.turnNumber}:${state.activePlayerId}`;
    if (lastTurnRef.current !== null && lastTurnRef.current !== key) {
      playSfx('turnStart');
    }
    lastTurnRef.current = key;
  }, [state]);

  // Match result sting + animation.
  //
  // `victory`/`defeat` cues already exist in this game's own audio module, so
  // audio is only the sting; the animation is a CSS layer plus the shared
  /**
   * End-of-match timeline.
   *
   * The last blow lands and several effects are still in flight — the death
   * splatter, damage floaters, the unit reactions. Showing the dialog the
   * instant `phase` flips buries all of it: the modal flashes over the top and
   * the payoff is gone. So the result waits for the board to settle, then the
   * sting plays, then the dialog arrives.
   *
   * `RESOLVE_MIN` stops a fast kill feeling abrupt; `RESOLVE_MAX` is the cap, so
   * a stuck effect can never leave the player staring at a board with no dialog.
   */
  const RESOLVE_MIN = 520;
  const RESOLVE_MAX = 1500;
  /** Beat between the victory sting and the winning faction's film. */
  const CINEMATIC_DELAY = 900;
  const [resultKind, setResultKind] = useState<'victory' | 'defeat' | null>(null);
  const [showResult, setShowResult] = useState(false);
  /** Winning faction whose victory film is up; null when none is showing. */
  const [cinematicFaction, setCinematicFaction] = useState<Faction | null>(null);
  const resultPlayedRef = useRef(false);

  useEffect(() => {
    if (!state) return;

    if (state.phase !== 'ended') {
      resultPlayedRef.current = false;
      setResultKind(null);
      setShowResult(false);
      setCinematicFaction(null);
      return;
    }

    if (resultPlayedRef.current) return;
    resultPlayedRef.current = true;

    // A cleared adventure run is a shared win: `checkVictory` names no single
    // player, so the sentinel counts as a win for everyone in the party.
    const won = state.winnerId === humanId || state.winnerId === ADVENTURE_CLEARED;
    setResultKind(won ? 'victory' : 'defeat');
    setBattleStats({ ...battleStatsRef.current, rounds: state.turnNumber });

    // Whose film: the winner's faction, or the party's own on an adventure clear.
    const winnerKey = state.winnerId === ADVENTURE_CLEARED ? humanId : state.winnerId;
    const winningFaction = (winnerKey && state.factions?.[winnerKey]) || null;

    const timers: number[] = [];
    // Let the board finish, then sting, then the film, then the tally. The extra
    // beat before the film is deliberate — the last blow's splatter and floaters
    // are still on screen, and cutting away the instant the sting lands throws
    // the payoff away.
    timers.push(window.setTimeout(() => {
      playSfx(won ? 'victory' : 'defeat');
      if (won) burstConfetti();
      // The film belongs to the winner, whoever that is — losing shows the
      // enemy faction's celebration before the tally. `prefers-reduced-motion`
      // still suppresses the autoplay; the tally keeps the replay button.
      const showFilm = winningFaction && !prefersReducedMotion();
      timers.push(window.setTimeout(() => {
        if (showFilm) setCinematicFaction(winningFaction);
        else setShowResult(true);
      }, showFilm ? CINEMATIC_DELAY : 260));
    }, RESOLVE_MAX));

    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [state, humanId]);

  /** The film's exit. Reveals the tally it was standing in front of. */
  const finishCinematic = useCallback(() => {
    setCinematicFaction(null);
    setShowResult(true);
  }, []);

  // ── chat ───────────────────────────────────────────────────────────────
  // Reuses the lobby's existing chat broadcast rather than adding transport.
  const [chatLog, setChatLog] = useState<Array<{ from: string; text: string }>>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [draftFaction, setDraftFaction] = useState<Faction | null>(FACTIONS[0]);
  const randomDraftSquad = useCallback((): PlayerClass[] => {
    const shuffled = [...DRAFTABLE_CLASSES];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled.slice(0, 4);
  }, []);
  const [factionDrafts, setFactionDrafts] = useState<Record<Faction, PlayerClass[]>>(() => ({
    INQUISITORS: randomDraftSquad(),
    PENITENT_COURT: randomDraftSquad(),
  }));
  const activeDraftFaction = draftFaction
    ?? FACTIONS.find((faction) => !Object.values(state?.factions ?? {}).includes(faction))
    ?? FACTIONS[0];
  const draftedSquad = factionDrafts[activeDraftFaction];
  const updateDraftedSquad = useCallback((faction: Faction, squad: PlayerClass[]) => {
    setFactionDrafts((previous) => ({ ...previous, [faction]: squad }));
  }, []);

  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((raw) => {
      const msg = raw as { type?: string; from?: string; nickname?: string; message?: string };
      if (msg.type !== 'chat') return;
      const text = (msg.message ?? '').trim();
      if (!text) return;
      setChatLog((prev) => [
        ...prev.slice(-40),
        { from: msg.nickname || msg.from || 'Player', text },
      ]);
    });
  }, [subscribe]);

  const sendChat = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const text = chatDraft.trim().slice(0, 160);
      if (!text || !sendRaw || !isOnline) return;
      sendRaw({ type: 'chat', message: text });
      setChatDraft('');
    },
    [chatDraft, sendRaw, isOnline],
  );

  // ── whose turn is it ────────────────────────────────────────────────────
  /**
   * Whether this client is allowed to act at all right now.
   *
   * This is NOT the same question as "is it my turn". In AI and Online Duel the
   * opponent is not at this keyboard, so only the human's own id counts. In a
   * Local Duel both seats are the people at this keyboard, so whoever the
   * engine says is active is playable — gating on `humanId` there locked
   * Player 2 out entirely the moment Player 1 ended their turn.
   */
  // Adventure is a FLOOR, not a mode: it is picked during the draft and is visible
  // from the state alone, whichever of AI / Local Duel / Online Duel is running.
  const isAdventure = isAdventureState(state);
  // The monsters hold no turn of their own — they act automatically at the end of
  // each player's turn — so there is no monster seat to exclude here any more.
  // What still matters is that they are never at this keyboard.
  const isLocalDuel = mode === 'hotseat' || (isAdventure && mode !== 'online');
  const isFactionPicker =
    !!state &&
    state.phase === 'deployment' &&
    (isLocalDuel || state.activePlayerId === humanId);
  const isPlayableTurn =
    !!state &&
    state.phase === 'playing' &&
    (isLocalDuel ? true : state.activePlayerId === humanId);

  /** Label for the turn banner, which differs per mode. */
  const turnLabel = (() => {
    if (!state) return '';
    if (state.phase === 'ended') {
      return state.winnerId ? `${playerLabels[state.winnerId] ?? state.winnerId} wins!` : 'Draw';
    }
    if (isAiTurn) return isAdventure ? 'The monsters are hunting…' : 'AI is scheming…';
    if (isLocalDuel) {
      return `${playerLabels[state.activePlayerId] ?? state.activePlayerId}'s turn`;
    }
    if (activePlayerIsHuman) return 'Your turn';
    return `${playerLabels[state.activePlayerId] ?? state.activePlayerId}'s turn`;
  })();

  const moveKeys = new Set(legalMoves.map((p) => positionKey(p)));
  const attackIds = new Set(legalAttackTargets.map((u) => u.id));
  const healIds = new Set(legalHealTargets.map((u) => u.id));
  const rangerShotKeys = new Set(
    state && selectedUnit
      ? legalRangerShotTargetsFor(state, selectedUnit.id).map(positionKey)
      : [],
  );

  /*
   * The Altar of Shadows.
   *
   * All of this is derived, never stored: the tiles each monument occupies (they
   * ARE stone in the terrain — see engine/altar.ts), the unit standing beside
   * one, and the altar corner its prompt hangs over. The arena has one; Adventure
   * has two, sharing a soul count but not a sprite, so the renderer keys a
   * quadrant map by tile rather than assuming a single block.
   */
  const altarSites = state ? altarSitesFor(state) : null;
  const altarSpriteForSite = altarSites && state
    ? altarSites.map((_, index) => altarSpriteFor(state.gameId, state.mapSeed ?? 0, index))
    : [];
  /** tile key -> which quadrant of which monument it paints. */
  const altarQuads = new Map<string, { site: number; col: number; row: number }>();
  (altarSites ?? []).forEach((tiles, site) => {
    const origin = tiles[0];
    for (const tile of tiles) {
      altarQuads.set(positionKey(tile), {
        site,
        col: tile.x - origin.x,
        row: tile.y - origin.y,
      });
    }
  });
  const altarTileKeys = new Set(altarQuads.keys());
  const altarSouls = state?.altarSouls ?? 0;
  const altarUnit = (() => {
    if (!state || !altarSites || !isPlayableTurn) return null;
    const actingId = isLocalDuel ? state.activePlayerId : humanId;
    const beside = Array.from(state.units.values()).filter(
      (unit) =>
        unit.stats.currentHp > 0 &&
        unit.ownerId === actingId &&
        besideAltar(state, unit.position),
    );
    // Prefer the piece whose panel is already open, so the wish applies to the
    // unit the player is looking at rather than to whoever the map lists first.
    return beside.find((unit) => unit.id === selectedUnitId) ?? beside[0] ?? null;
  })();
  /** One wish a turn per player — the same rule the engine enforces. */
  const altarWishSpent =
    !!state &&
    !!altarUnit &&
    (state.altarWishTurns ?? {})[altarUnit.ownerId] === state.turnNumber;
  const altarReady = !!altarUnit && altarSouls > 0 && !altarWishSpent;
  /**
   * Why the altar will not answer, or null when it will.
   *
   * The menu used to be unreachable in this state: the tiles were only clickable
   * while a wish was available, so a spent altar swallowed the click and the
   * player was left guessing. The menu now opens either way and says this out
   * loud — the difference between "nothing happened" and "you are on cooldown"
   * is the whole feature.
   */
  const altarDormantReason = !altarUnit
    ? null
    : altarWishSpent
      ? 'The Altar is dormant — You must wait until the next turn cycle to perform another ritual.'
      : altarSouls <= 0
        ? 'The altar is empty — no soul has been offered to it yet.'
        : null;
  const altarPromptCell = state && altarUnit ? soulTargetFor(state, altarUnit.position) : null;
  const altarFallen = state && altarUnit
    ? Array.from(state.units.values())
      .filter((unit) => unit.ownerId === altarUnit.ownerId && unit.stats.currentHp <= 0)
      .sort((a, b) => (a.id < b.id ? -1 : 1))[0] ?? null
    : null;
  const [altarMenuOpen, setAltarMenuOpen] = useState(false);
  // A menu anchored to a turn that has passed is stale; close it on the turn
  // change instead of letting it reopen itself the next time the same unit is
  // standing there.
  useEffect(() => {
    setAltarMenuOpen(false);
  }, [state?.gameId, state?.turnNumber, state?.activePlayerId]);

  // ── board focus: Move or Act, in either order ───────────────────────────
  // Both point types stay available for the whole unit turn; this only decides
  // which reading an ambiguous bare-ground click gets (a Ranger's line shot can
  // land on a tile the unit could also walk to). It never gates what the player
  // is allowed to spend.
  const [aimMode, setAimMode] = useState<'move' | 'action'>('move');
  const prevUnitStatusRef = useRef<{ id: string | null; hasMoved: boolean; hasAttacked: boolean }>({
    id: null,
    hasMoved: false,
    hasAttacked: false,
  });

  /*
   * The artwork is permanent.
   *
   * This used to be a `showWallpaper` state behind a click on the wordmark, with
   * the preference persisted to `sos_wallpaper`. It was removed because the
   * cathedral IS this screen: a title screen you can switch to a blank
   * background is a title screen with a settings toggle wearing a costume, and
   * the wordmark was a button that looked like a logo. The stale
   * `sos_wallpaper` key is left alone in localStorage rather than cleaned up —
   * nothing reads it, and a migration for a deleted feature is not worth a
   * version bump.
   */

  /**
   * Which action a click means in Act mode. Resets per unit and defaults to the
   * unit's first option, so a Cleric always has an explicit Attack/Heal choice.
   */
  const [actChoice, setActChoice] = useState<ActChoice>('ATTACK');

  /*
   * An attack or spell the player has aimed but not yet committed.
   *
   * Moves, heals and guards are NOT staged. Moves are the bulk of every turn,
   * and confirming each one triples the clicks for a mistake that costs nothing
   * to walk back; a heal or a guard is forgiving and cheap. What gets staged is
   * the set where being wrong is expensive: you cannot un-hit an enemy, and
   * Sanctified Ground claims a tile for two turns.
   *
   * The command itself is held, not a callback. Storing a function in state
   * would make it impossible to compare, log or serialise, and it would outlive
   * the board it was built against; holding the plain `GameCommand` means the
   * reducer sees exactly what it would have seen had this never existed.
   */
  const [pendingConfirm, setPendingConfirm] = useState<{
    command: GameCommand;
    title: string;
    detail: string;
    at: Position;
  } | null>(null);

  const commitPending = useCallback(() => {
    if (!pendingConfirm) return;
    const { command } = pendingConfirm;
    setPendingConfirm(null);
    dispatch(command);
  }, [dispatch, pendingConfirm]);

  const cancelPending = useCallback(() => {
    if (!pendingConfirm) return;
    setPendingConfirm(null);
    playSfx('invalid');
  }, [pendingConfirm]);

  /*
   * Escape backs out of a staged action. The whole cost of the confirmation is
   * the keystroke to abandon it, so it must be one key and no mouse travel.
   */
  useEffect(() => {
    if (!pendingConfirm) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPendingConfirm(null);
        playSfx('invalid');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingConfirm]);

  useEffect(() => {
    setActChoice(ACT_CHOICES[selectedUnit?.type ?? 'WARRIOR'][0]);
    setArmedAbility(null);
    setPreviewTarget(null);
    if (selectedUnit) {
      if (!selectedUnit.hasMoved) setAimMode('move');
      else if (!selectedUnit.hasAttacked) setAimMode('action');
    }
  }, [selectedUnitId]);

  /**
   * Pre-select a unit when a turn begins, so the board is never sitting empty at
   * the moment it is your move.
   *
   * Without this the selection is cleared by whatever ended the opponent's turn
   * (a defeat, a deselect) and the first thing you see on your turn is a blank
   * board with no hint of who to move. Keyed on the turn identity rather than on
   * `state`, so it fires exactly once per hand-over instead of on every
   * animation frame, and it leaves an existing usable selection alone so it
   * never yanks a unit out from under a deliberate choice.
   */
  const autoSelectedTurnRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state || state.phase !== 'playing' || !activePlayerIsHuman) return;
    const turnKey = `${state.gameId}:${state.turnNumber}:${state.activePlayerId}`;
    if (autoSelectedTurnRef.current === turnKey) return;
    autoSelectedTurnRef.current = turnKey;

    const stillUsable = (u: Unit | undefined): u is Unit =>
      !!u && u.ownerId === state.activePlayerId && u.stats.currentHp > 0 &&
      (!u.hasMoved || !u.hasAttacked);

    // A unit the player already has selected and can still act wins outright.
    if (stillUsable(selectedUnit ?? undefined)) return;

    const ours = Array.from(state.units.values()).filter(stillUsable);
    // Prefer somebody who has not moved yet — they have the most options left.
    const next = ours.find((u) => !u.hasMoved) ?? ours[0];
    if (next) selectUnit(next.id);
  }, [state, activePlayerIsHuman, selectedUnit, selectUnit]);

  // Auto-switch from Move -> Act (or Act -> Move) when one is spent, with a
  // brief transition flash + audio cue so the player sees and hears the lock.
  useEffect(() => {
    if (!selectedUnit) {
      prevUnitStatusRef.current = { id: null, hasMoved: false, hasAttacked: false };
      return undefined;
    }
    const prev = prevUnitStatusRef.current;
    prevUnitStatusRef.current = {
      id: selectedUnit.id,
      hasMoved: !!selectedUnit.hasMoved,
      hasAttacked: !!selectedUnit.hasAttacked,
    };
    if (prev.id !== selectedUnit.id) return undefined;

    if (!prev.hasMoved && selectedUnit.hasMoved) {
      playSfx('select');
      // Movement spent; keep the board reading actions. The action stays
      // enabled — the player can still swing or cast.
      if (!selectedUnit.hasAttacked) setAimMode('action');
      return undefined;
    }

    if (!prev.hasAttacked && selectedUnit.hasAttacked) {
      setArmedAbility(null);
      setActChoice(ACT_CHOICES[selectedUnit.type][0]);
      playSfx('select');
      // The action is spent, so the board hands the turn back to movement.
      // Abilities grey out; movement tiles stay live for a reposition.
      if (!selectedUnit.hasMoved) setAimMode('move');
      return undefined;
    }
    return undefined;
  }, [selectedUnit]);

  /**
   * Squad units belonging to the player who controls this keyboard right now,
   * ordered Warrior -> Wizard -> Cleric -> Ranger for the quick-shortcut bar.
   */
  const squadUnits = useMemo(() => {
    if (!state) return [] as Unit[];
    const owner = isLocalDuel ? state.activePlayerId : humanId;
    const order: Record<UnitType, number> = {
      WARRIOR: 0, WIZARD: 1, CLERIC: 2, RANGER: 3,
      PALADIN: 4, BARD: 5, WARLOCK: 6, DRUID: 7, ROGUE: 8,
      // Never reachable — this list is filtered to the player's own squad — but
      // the table is total, so the monsters need somewhere to sit.
      BEAST: 9, SPITTER: 10,
    };
    return Array.from(state.units.values())
      .filter((u) => u.ownerId === owner)
      .sort((a, b) => order[a.type] - order[b.type]);
  }, [state, isLocalDuel, humanId]);

  /**
   * Who the camera is watching.
   *
   * The selected unit if there is one — that is what makes the view follow your
   * finger around the map — otherwise whoever is active, then anyone of yours,
   * so the board is never parked on empty floor with no reason.
   */
  const cameraFocus = useMemo<Position | null>(() => {
    if (!state) return null;
    const alive = Array.from(state.units.values()).filter((u) => u.stats.currentHp > 0);

    /*
     * Follow the character whose turn it is.
     *
     * A selection only wins when it belongs to the side currently ACTING.
     * Before this, any selection at all pinned the view, so through the
     * monsters' turn the camera sat on your own squad and you never saw the
     * fight that was deciding your game.
     */
    if (selectedUnit && selectedUnit.ownerId === state.activePlayerId) {
      return selectedUnit.position;
    }

    // Mid-action, follow whichever of their units is actually moving or
    // striking, so the camera tracks the character rather than the team.
    const acting = Object.keys(reactions).find((unitId) => {
      const unit = state.units.get(unitId);
      return !!unit && unit.ownerId === state.activePlayerId && unit.stats.currentHp > 0;
    });
    if (acting) return state.units.get(acting)!.position;

    return (
      alive.find((u) => u.ownerId === state.activePlayerId)?.position ??
      alive.find((u) => u.ownerId === humanId)?.position ??
      null
    );
  }, [state, selectedUnit, humanId, reactions]);

  /**
   * The rectangle of the floor actually drawn.
   *
   * Every map mode uses the same camera now. Adventure is a 20x20 floor and
   * Arena is 12x10; the selected 3/5/7/9/10/11 window is laid over either one. A
   * window larger than an axis is capped to that axis, so an 11x11 choice on the
   * 12x10 Arena shows all ten rows and pans horizontally.
   *
   * Kept as one value so the grid template, the `--sos-board-cols/rows` aspect
   * ratio and the tile loop can never disagree about how many cells are on
   * screen.
   */
  const boardView = useMemo(() => {
    // No state means no board is rendered at all (the whole subtree is guarded on
    // `state &&` upstream), so this fallback is never drawn — it just keeps the
    // memo's return type non-nullable for the grid maths below.
    if (!state) return { originX: 0, originY: 0, cols: 1, rows: 1 };
    const view = boardViewDimensions(boardViewSize);
    if (manualViewOrigin) {
      return cameraWindowFromOrigin(manualViewOrigin, state.boardSize, view);
    }
    return cameraWindowFor(cameraFocus, state.boardSize, view);
  }, [state, cameraFocus, boardViewSize, manualViewOrigin]);

  /** True while the selected window is smaller than the floor in either axis. */
  const canPanBoard = !!state && (
    boardView.cols < state.boardSize.width || boardView.rows < state.boardSize.height
  );

  /**
   * Put a floor tile at the centre of the camera window.
   *
   * Board clicks in free-nav glide there over a few integer tile steps. Tile
   * rendering is discrete, so the board itself cannot be sub-pixel interpolated
   * without drawing extra off-window cells; stepping the origin through eased
   * frames still reads as a camera move rather than a teleport, and the minimap
   * outline (DOM) keeps a CSS transition so it glides continuously.
   *
   * The minimap uses the non-smooth path: dragging it has to track the pointer
   * immediately, and the camera should already be under the finger.
   */
  const centerCameraOn = useCallback((target: Position, smooth: boolean) => {
    if (!state) return;
    const destination = cameraWindowFor(target, state.boardSize, {
      width: boardView.cols,
      height: boardView.rows,
    });
    const origin = { x: destination.originX, y: destination.originY };
    cancelCameraTween();
    if (!smooth || prefersReducedMotion()) {
      setManualViewOrigin(origin);
      return;
    }

    const start = { x: boardView.originX, y: boardView.originY };
    const dx = origin.x - start.x;
    const dy = origin.y - start.y;
    if (dx === 0 && dy === 0) {
      setManualViewOrigin(origin);
      return;
    }

    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    const duration = Math.min(320, 110 + distance * 26);
    const startedAt = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - t) ** 3;
      const x = Math.round(start.x + dx * eased);
      const y = Math.round(start.y + dy * eased);
      setManualViewOrigin({ x, y });
      if (t < 1) {
        cameraTweenRef.current = requestAnimationFrame(step);
      } else {
        cameraTweenRef.current = null;
        setManualViewOrigin(origin);
      }
    };
    cameraTweenRef.current = requestAnimationFrame(step);
  }, [boardView.cols, boardView.originX, boardView.originY, boardView.rows, cancelCameraTween, state]);

  /** Minimap navigation is immediate; only the main-board click glides. */
  const navigateFromMinimap = useCallback(
    (tile: Position) => centerCameraOn(tile, false),
    [centerCameraOn],
  );

  /** Pending hand-back to where the camera was before the enemy acted. */
  const followHandBackRef = useRef<number | null>(null);
  /**
   * The view to restore after the enemy's turn: `null` inside means "follow the
   * focused unit", which is also a valid thing to restore, so the wrapper
   * distinguishes "nothing captured yet" from "captured, follow focus".
   */
  const cameraResumeRef = useRef<{ origin: Position | null } | null>(null);

  /*
   * Recentre whenever the thing the camera was following changes.
   *
   * Dragging is an inspection tool; it must not survive a unit move, a new
   * selection, a turn hand-over or a window-size change, or the next player
   * would open on a corner nobody is standing in.
   *
   * Deselecting for Free Nav is the exception: that handler captures the
   * current window first and must keep it, otherwise entering the mode would
   * yank the camera back to the active unit before the player could inspect
   * anything.
   */
  useEffect(() => {
    // Whoever is taking control now owns the camera: a follow hand-back still
    // in flight must not pull it back to the view from before the enemy acted.
    if (followHandBackRef.current !== null) {
      window.clearTimeout(followHandBackRef.current);
      followHandBackRef.current = null;
    }
    cameraResumeRef.current = null;
    if (keepManualOnDeselectRef.current) {
      keepManualOnDeselectRef.current = false;
      return;
    }
    // A turn hand-over or a new selection invalidates a glide still in flight;
    // otherwise it would keep writing the old destination over the recentre.
    cancelCameraTween();
    setManualViewOrigin(null);
  }, [
    boardViewSize,
    selectedUnitId,
    selectedUnit?.position.x,
    selectedUnit?.position.y,
    state?.activePlayerId,
    state?.turnNumber,
    state?.boardSize.width,
    state?.boardSize.height,
    cancelCameraTween,
  ]);

  /**
   * Watch the enemy act, even from free nav.
   *
   * The camera only follows the acting side when it is `playerId`'s turn, so an
   * opponent's move in a duel and a monster's step in adventure used to happen
   * wherever the player had left the view — often off-screen entirely while
   * they inspected the map. A unit reacting on its own action (walk, lunge,
   * cast) takes the camera smoothly; a unit merely being hit does not, or your
   * own attack would drag the view onto its target and leave it there.
   *
   * The recentre effect above hands the camera back on the next turn hand-over.
   */
  const centerCameraRef = useRef(centerCameraOn);
  useEffect(() => {
    centerCameraRef.current = centerCameraOn;
  }, [centerCameraOn]);
  useEffect(() => () => {
    if (followHandBackRef.current !== null) window.clearTimeout(followHandBackRef.current);
  }, []);
  const watchedReactionSeq = useRef(0);
  useEffect(() => {
    if (!state) return;
    for (const [unitId, reaction] of Object.entries(reactions)) {
      if (reaction.seq <= watchedReactionSeq.current) continue;
      watchedReactionSeq.current = reaction.seq;
      if (reaction.kind !== 'walk' && reaction.kind !== 'lunge' && reaction.kind !== 'cast') {
        continue;
      }
      const unit = state.units.get(unitId);
      if (!unit || unit.ownerId === humanId) continue;
      // Remember the view the player had before the first enemy action of this
      // burst, so a free-nav inspection is restored rather than replaced.
      if (cameraResumeRef.current === null) cameraResumeRef.current = { origin: manualViewOrigin };
      centerCameraRef.current(unit.position, true);
      // Once the enemy has stopped, hand the camera back. Falling back to `null`
      // means "follow whoever is focused", so a player who was not panning gets
      // their own unit back in view instead of the last place the enemy stood.
      if (followHandBackRef.current !== null) window.clearTimeout(followHandBackRef.current);
      followHandBackRef.current = window.setTimeout(() => {
        followHandBackRef.current = null;
        const resume = cameraResumeRef.current?.origin ?? null;
        cameraResumeRef.current = null;
        setManualViewOrigin(resume);
      }, ENEMY_STEP_MS + 500);
    }
  }, [reactions, state, humanId, manualViewOrigin]);

  /**
   * Squad Shortcuts' Free Nav control.
   *
   * With a unit selected it captures the current window, deselects, and opens
   * the minimap without moving the camera. Already free, it clears the manual
   * origin so the camera re-follows the active unit — a useful way back from a
   * corner the player inspected and forgot.
   */
  const toggleFreeNav = useCallback(() => {
    playSfx('select');
    cancelCameraTween();
    if (selectedUnit) {
      keepManualOnDeselectRef.current = true;
      setManualViewOrigin({ x: boardView.originX, y: boardView.originY });
      selectUnit(null);
      return;
    }
    setManualViewOrigin(null);
  }, [boardView.originX, boardView.originY, cancelCameraTween, selectUnit, selectedUnit]);

  /**
   * Select a unit and hand it the camera.
   *
   * The recentre effect does this too, but it deliberately keeps the view for
   * the one transition where Free Nav deselected — so a selection made out of
   * that mode depended on the latch having been consumed first. Doing it here
   * makes "pick a unit, see the unit" unconditional.
   */
  const selectAndFocus = useCallback((unit: Unit) => {
    keepManualOnDeselectRef.current = false;
    cancelCameraTween();
    setManualViewOrigin(null);
    selectUnit(unit.id);
    setAimMode(!unit.hasMoved ? 'move' : 'action');
    playSfx('select');
  }, [cancelCameraTween, selectUnit]);

  /** Centre the camera on the focused unit again after a drag. */
  const recentreBoard = useCallback(() => {
    setManualViewOrigin(null);
  }, []);

  const chooseBoardViewSize = useCallback((size: BoardViewSize) => {
    setBoardViewSize(size);
    writeBoardViewSize(size);
    setManualViewOrigin(null);
    playSfx('select');
  }, []);

  /*
   * Drag-to-pan.
   *
   * A 5x5 window cannot show a Ranger's whole firing lane or the far end of a
   * Thunder line, so shrinking the camera must not shrink the game. Dragging
   * the board pushes the window one tile at a time and `cameraWindowFromOrigin`
   * clamps it to the floor, which is what keeps this from revealing void.
   *
   * A drag is not a click: once the pointer has travelled past the threshold,
   * the click that follows is swallowed so the player does not accidentally
   * move onto the tile they used as a handle.
   */
  const handleBoardPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canPanBoard || event.button !== 0) return;
    const board = event.currentTarget;
    const cell = board.querySelector<HTMLElement>('.sos-cell:not(.is-void)');
    const tilePx = cell?.getBoundingClientRect().width ?? 0;
    if (!Number.isFinite(tilePx) || tilePx <= 0) return;
    boardDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: boardView.originX,
      originY: boardView.originY,
      tilePx,
      moved: false,
    };
  }, [canPanBoard, boardView.originX, boardView.originY]);

  const handleBoardPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = boardDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setManualViewOrigin({
      x: drag.originX + Math.round(-dx / drag.tilePx),
      y: drag.originY + Math.round(-dy / drag.tilePx),
    });
  }, []);

  const releaseBoardDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = boardDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    boardDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (cancelled || !drag.moved) return;
    // Suppress the click generated by this gesture, then re-arm normal clicks.
    suppressBoardClickRef.current = true;
    if (suppressBoardClickTimerRef.current !== null) {
      window.clearTimeout(suppressBoardClickTimerRef.current);
    }
    suppressBoardClickTimerRef.current = window.setTimeout(() => {
      suppressBoardClickRef.current = false;
      suppressBoardClickTimerRef.current = null;
    }, 350);
  }, []);

  useEffect(() => () => {
    if (suppressBoardClickTimerRef.current !== null) {
      window.clearTimeout(suppressBoardClickTimerRef.current);
    }
  }, []);

  /*
   * Board tile -> percentage WITHIN the camera window.
   *
   * Everything drawn above the grid (zones, ice, traps, projectiles, damage
   * numbers) is positioned as a fraction of the board. That only worked while
   * the grid filled the board; now both modes draw a window of a larger floor,
   * so a fraction of the board is the fraction of the WRONG box — every overlay
   * would be displaced by the window's origin and drift further off the further
   * from home it sat.
   *
   * These subtract the window origin and divide by the window's own size, which
   * is exactly the box the overlay layer is stretched over.
   */
  const viewLeftPct = useCallback(
    (x: number, y = 0) => tileCentreInViewPct({ x, y }, boardView).leftPct,
    [boardView],
  );
  const viewTopPct = useCallback(
    (y: number, x = 0) => tileCentreInViewPct({ x, y }, boardView).topPct,
    [boardView],
  );
  const inBoardView = useCallback(
    (x: number, y: number) => tileVisibleInView({ x, y }, boardView),
    [boardView],
  );

  /**
   * Whether the selected unit still has its move and its action to spend.
   *
   * Every affordance on the board reads these rather than testing the flags
   * itself, so "one move and one action per unit per turn" has exactly one
   * meaning in this component. The engine already rejects a second action — this
   * is about not *offering* one, so the board cannot advertise a move the unit
   * can no longer make.
   */
  const unitCanMove = !!selectedUnit && !selectedUnit.hasMoved;
  // A stun costs the ACTION, not the turn: Move stays live while every action
  // row goes dead, which is what the engine enforces.
  const unitCanAct =
    !!selectedUnit && !selectedUnit.hasAttacked && (selectedUnit.stunnedTurns ?? 0) <= 0;
  const unitTurnComplete = !!selectedUnit && selectedUnit.hasMoved && selectedUnit.hasAttacked;

  /** The winner's faction — drives the victory film and its replay button. */
  const winningFaction = state?.factions
    ? (state.factions[state.winnerId === ADVENTURE_CLEARED ? humanId : (state.winnerId ?? '')] ?? null)
    : null;

  /**
   * No unit selected = the left panel is a live minimap and the board is a
   * free-camera surface rather than an action surface.
   */
  const isFreeNav = !selectedUnit;

  /** Adjacent living allies a selected Warrior could shield. */
  const guardTargets = useMemo(() => {
    if (!state || !selectedUnit) return [] as Unit[];
    if (selectedUnit.type !== 'WARRIOR') return [] as Unit[];
    if (selectedUnit.hasAttacked) return [];
    if (selectedUnit.guardingUnitId) return [] as Unit[];
    const owner = state.activePlayerId;
    return Array.from(state.units.values()).filter(
      (u) =>
        u.ownerId === owner &&
        u.stats.currentHp > 0 &&
        u.id !== selectedUnit.id &&
        chebyshev(u.position, selectedUnit.position) <= 1,
    );
  }, [state, selectedUnit]);
  const guardIds = new Set(guardTargets.map((u) => u.id));

  /** True when the selected unit is currently covered by a Warrior. */
  const selectedGuard = selectedUnit ? guardOf(state!, selectedUnit.id) : undefined;

  // ── ability bar ─────────────────────────────────────────────────────────
  // Picking a tile-targeted ability arms it; the next board click is the
  // target. Targetable cells are tinted so the shape of the blast is obvious.
  const [armedAbility, setArmedAbility] = useState<AbilityId | null>(null);
  const [confirmEndTurn, setConfirmEndTurn] = useState(false);
  /**
   * The right rail folds away to a slim vertical strip. It is the only rail that
   * can go: the left one holds the squad bar and the unit you are acting for, so
   * hiding it would hide the controls. The chronicle and chat are reference, not
   * controls, and players who want the board as large as possible fold them.
   */
  const [railFolded, setRailFolded] = useState(false);
  /** Tile the player is pointing at, used to preview the blast before casting. */
  const [previewTarget, setPreviewTarget] = useState<Position | null>(null);
  const previewAbility: AbilityId | null = armedAbility ?? null;

  /**
   * The tile whose last click did nothing, flashed briefly so an illegal click
   * has a visible answer and not just a sound. The timer is cleared on every new
   * miss so rapid clicking cannot leave a stale tile lit.
   */
  const [invalidCell, setInvalidCell] = useState<string | null>(null);
  const invalidTimerRef = useRef<number | null>(null);
  const flashInvalid = useCallback((pos: Position) => {
    if (invalidTimerRef.current !== null) {
      window.clearTimeout(invalidTimerRef.current);
    }
    setInvalidCell(positionKey(pos));
    invalidTimerRef.current = window.setTimeout(() => {
      invalidTimerRef.current = null;
      setInvalidCell(null);
    }, 420);
  }, []);
  useEffect(() => () => {
    if (invalidTimerRef.current !== null) {
      window.clearTimeout(invalidTimerRef.current);
    }
  }, []);

  /**
 * Cells an armed tile ability may target, and the tiles its blast would cover.
 *
 * Both are computed here rather than on click so the player can see the shape
 * of an AoE before committing — including on tiles with nothing to hit, since
 * the player is allowed to waste a cast.
 */
  /** Every tile the selected unit could reach an enemy from. */
  const attackReach = useMemo(() => {
    const cells = new Set<string>();
    // A unit that has already acted has no reach left to show. Without this the
    // board kept painting its attack range after the action was spent, which
    // read as "you can still hit something" on a unit that could not.
    if (!state || !selectedUnit || selectedUnit.hasAttacked) return cells;
    for (const tile of attackRangeTiles(state, selectedUnit)) {
      cells.add(positionKey(tile));
    }
    return cells;
  }, [state, selectedUnit]);

  const abilityTargets = useMemo(() => {
    const cells = new Set<string>();
    const cfg = previewAbility ? ABILITY_RANGE[previewAbility] : undefined;
    if (!state || !selectedUnit || !previewAbility || !cfg) return cells;
    if (selectedUnit.hasAttacked) return cells;
    for (let y = 0; y < state.boardSize.height; y += 1) {
      for (let x = 0; x < state.boardSize.width; x += 1) {
        const pos = { x, y };
        const dx = Math.abs(selectedUnit.position.x - x);
        const dy = Math.abs(selectedUnit.position.y - y);
        const range =
          previewAbility === 'GRAPPLE' || selectedUnit.type === 'WIZARD'
            ? dx + dy
            : chebyshev(selectedUnit.position, pos);
        if (range > cfg.range) continue;
        const wall = isWall(state, pos);
        // Stone and ice are not cast targets. The engine already rejects them —
        // Sanctified Ground needs a clear cross, Ice Wall cannot form on stone —
        // but a range-only check used to paint them as aimable, so the board
        // said "you can bless that wall" and then refused the click. Slam and
        // Grapple are the two exceptions that may deliberately target stone.
        if (previewAbility === 'GRAPPLE') {
          const hookedUnit = unitAt(state, pos, selectedUnit.id);
          if (!hookedUnit && !wall) continue;
          // Wall swings are straight-line; hooking a unit may be diagonal.
          if (wall && dx > 0 && dy > 0) continue;
        } else if (previewAbility !== 'SHIELD_SLAM' && wall) {
          continue;
        }
        cells.add(`${x},${y}`);
      }
    }
    return cells;
  }, [state, selectedUnit, previewAbility]);

  /**
   * Ground a selected Slam can hit, including walls and empty tiles.
   *
   * Slam is aimed at the ground, not at a unit, so it cannot reuse the attack
   * target set (which only contains units) and it must include wall tiles — a
   * Warrior is allowed to crack a wall even when nothing is standing there.
   */
  const slamKeys = useMemo(() => {
    const cells = new Set<string>();
    if (!state || !selectedUnit || actChoice !== 'SLAM' || selectedUnit.hasAttacked) {
      return cells;
    }
    for (let y = 0; y < state.boardSize.height; y += 1) {
      for (let x = 0; x < state.boardSize.width; x += 1) {
        if (chebyshev(selectedUnit.position, { x, y }) <= ABILITIES.SHIELD_SLAM.range) {
          cells.add(`${x},${y}`);
        }
      }
    }
    return cells;
  }, [state, selectedUnit, actChoice]);

  /**
   * Tiles the selected action would actually affect at the hovered target.
   *
   * This is the HIT ZONE, not the range: it follows the pointer, and its colour
   * comes from the effect family (damage / boon / control / utility). Heals and
   * guards are single-target, so their hit zone is the hovered ally; Slam and a
   * basic ground attack are single tiles. An empty set means "this hover is not
   * a legal action target", and the board draws no impact.
   */
  const abilityBlast = useMemo(() => {
    const cells = new Set<string>();
    if (!state || !selectedUnit || !previewTarget) return cells;
    if (selectedUnit.hasAttacked) return cells;
    const hoverKey = positionKey(previewTarget);
    if (previewAbility) {
      // Only a tile the click would accept may show a blast preview. Without
      // this, hovering a stone wall while a Fireball was armed still painted a
      // hit zone on it, and the click then refused.
      if (!abilityTargets.has(hoverKey)) return cells;
      for (const tile of abilityAffectedTiles(state, previewAbility, selectedUnit, previewTarget)) {
        cells.add(positionKey(tile));
      }
      return cells;
    }
    const hovered = unitAt(state, previewTarget);
    if (actChoice === 'ATTACK') {
      if (hovered && attackIds.has(hovered.id)) {
        cells.add(hoverKey);
      } else if (!hovered && aimMode === 'action' && rangerShotKeys.has(hoverKey)) {
        cells.add(hoverKey);
      }
    } else if (actChoice === 'HEAL') {
      if (hovered && healIds.has(hovered.id)) cells.add(hoverKey);
    } else if (actChoice === 'GUARD') {
      if (hovered && guardIds.has(hovered.id)) cells.add(hoverKey);
    } else if (
      actChoice === 'SLAM' &&
      aimMode === 'action' &&
      chebyshev(selectedUnit.position, previewTarget) <= ABILITIES.SHIELD_SLAM.range
    ) {
      cells.add(hoverKey);
    }
    return cells;
  }, [
    state, selectedUnit, previewTarget, previewAbility, actChoice, aimMode,
    attackIds, healIds, guardIds, rangerShotKeys, abilityTargets,
  ]);

  /** Effect family of the current preview, so the hit-zone colour matches it. */
  const impactKind: ImpactKind | null = useMemo(() => {
    if (abilityBlast.size === 0) return null;
    if (previewAbility) return impactKindForAbility(previewAbility);
    if (actChoice === 'ATTACK' || actChoice === 'SLAM') return 'damage';
    if (actChoice === 'HEAL' || actChoice === 'GUARD') return 'boon';
    return null;
  }, [abilityBlast, previewAbility, actChoice]);

  /**
   * Tiles currently under a Sanctified Ground zone, whoever cast it.
   *
   * Built from `activeZoneTiles` — the SAME function the aim preview draws — so
   * the ground that appears after a cast is guaranteed to be the ground that was
   * previewed before it.
   *
   * It used to be `state.zones.some((z) => zoneCovers(z, x, y))` inline per cell,
   * which is the raw cross with no clipping. That is why an enemy Cleric's zone
   * painted itself across stone: `zoneCovers` answers "is this tile part of the
   * cross", while `activeZoneTiles` answers "is this tile part of the cross AND
   * can anything stand there". The preview used the second, the render used the
   * first, so the two disagreed exactly where it was most visible — the enemy
   * cast, which is the only one the player never aimed.
   *
   * Computed once per state instead of once per cell per zone: the board is 120
   * tiles and this ran a linear scan of every zone for each of them.
   */
  const holyTiles = useMemo(() => {
    const cells = new Set<string>();
    if (!state) return cells;
    for (const zone of state.zones) {
      for (const tile of activeZoneTiles(state, zone)) cells.add(positionKey(tile));
    }
    return cells;
  }, [state]);



  // ── turn clock ───────────────────────────────────────────────────────────
  // Online matches read the server's deadline; offline matches run a local
  // 3-minute budget. Either way an expired turn is surrendered, never held.
  const isOnlineMatch = mode === 'online';
  const secondsLeft = useMemo(() => {
    if (!turnDeadline) return undefined;
    return Math.max(1, Math.ceil((turnDeadline - Date.now()) / 1000));
  }, [turnDeadline]);

  /**
   * Faction-draft countdown. ONLINE ONLY.
   *
   * The clock exists because the opponent is waiting on you and cannot answer
   * for you; that is a real cost online and none at all against the AI or a
   * second player on the same keyboard, who is looking at the screen. Offline it
   * ran anyway and auto-assigned a faction at zero — so the draft quietly
   * picked a side for someone who had walked away from their own match, and did
   * it with a visible countdown implying they had to hurry.
   *
   * Nothing offline is waiting, so nothing offline should expire.
   */
  const factionDraftTimer = useTurnTimer({
    active: isFactionPicker && isOnlineMatch,
    turnKey: state?.phase === 'deployment'
      ? `draft:${state.gameId}:${state.activePlayerId}`
      : null,
    seconds: secondsLeft,
    onExpire: () => {
      if (!state || state.phase !== 'deployment') return;
      if (sendRaw && room) sendRaw({ action: 'sos:tick', gameId: room.roomId });
    },
  });

  /*
   * No monster heartbeat any more.
   *
   * The monsters used to hold a turn that only the server could advance, so the
   * client had to nudge it with `sos:tick` or the turn would sit until the clock
   * killed the room. They no longer hold a turn: the server's `END_TURN` runs
   * their step in the same event batch as the hand-over, so there is nothing
   * left to nudge and nothing for a client to forge.
   */

  // Every living unit owned by the active player has spent BOTH its movement and
  // its action; this applies to either hotseat player, not just `humanId`.
  // Eight points, not four — see `allActiveUnitsSpent`.
  const activeUnitsSpent = useMemo(
    () => (state ? allActiveUnitsSpent(state) : false),
    [state],
  );

  /**
   * Turn clock expiry. ONLINE ONLY — see `factionDraftTimer` for why.
   *
   * The offline branch this used to have dispatched a local `END_TURN` after
   * three minutes, silently skipping the turn of anyone who stepped away from an
   * AI match or thought about their next move for too long. There is no opponent
   * being kept waiting, so there is nothing to forfeit.
   */
  const handleExpire = useCallback(() => {
    if (isOnlineMatch) {
      if (sendRaw && room) sendRaw({ action: 'sos:tick', gameId: room.roomId });
    } else {
      if (state && isPlayableTurn) {
        dispatch({ type: 'END_TURN' });
      }
    }
  }, [isOnlineMatch, sendRaw, room, state, isPlayableTurn, dispatch]);

  const timer = useTurnTimer({
    // Once the three-second auto-end is armed, its grace period owns the
    // handoff. Do not let the regular clock fire an earlier timeout tick.
    active: isPlayableTurn && !activeUnitsSpent && state?.phase === 'playing',
    turnKey: state ? `${state.turnNumber}:${state.activePlayerId}` : null,
    onExpire: handleExpire,
    seconds: isOnlineMatch ? (secondsLeft ?? TURN_SECONDS) : TURN_SECONDS,
  });

  /** The clock is shown during playing phase for all match types. */
  const showTurnClock = state?.phase === 'playing';

  // ── auto end turn ─────────────────────────────────────────────────────────
  /**
   * Bumped once each time the active player first runs out of things to do, so
   * the countdown starts once and is not reset by unrelated renders. Including
   * the turn number below also resets it if the next player is already spent.
   */
  const [autoEndKey, setAutoEndKey] = useState(0);
  const spentLatchRef = useRef(false);
  useEffect(() => {
    if (activeUnitsSpent && !spentLatchRef.current) {
      spentLatchRef.current = true;
      setAutoEndKey((k) => k + 1);
    } else if (!activeUnitsSpent) {
      spentLatchRef.current = false;
    }
  }, [activeUnitsSpent]);

  const autoEnd = useTurnTimer({
    active: isPlayableTurn && activeUnitsSpent,
    turnKey: `${state?.turnNumber ?? 0}:${autoEndKey}`,
    // Deliberately `dispatch`, not `handleExpire`. That one sends `sos:tick`,
    // which is the server's *timeout* forfeit — the player ran out of clock.
    // Here they finished their turn, so it has to be the ordinary END_TURN
    // command, which the server validates exactly like a manual one.
    onExpire: () => {
      if (state && isPlayableTurn) {
        setConfirmEndTurn(false);
        dispatch({ type: 'END_TURN' });
      }
    },
    seconds: AUTO_END_SECONDS,
  });
  const autoEndArmed = isPlayableTurn && activeUnitsSpent;

  // ── floating combat numbers ─────────────────────────────────────────────
  // Derived from the engine's event list so damage shown can never disagree
  // with the damage applied. Cells are positioned proportionally from the grid
  // coordinates, which avoids measuring the DOM on every hit.
  const [floaters, setFloaters] = useState<SosFloater[]>([]);
  const floaterSeq = useRef(0);
  const lastFloatedEvents = useRef<GameEvent[] | null>(null);
  /**
   * Retirement timers for numbers already on screen.
   *
   * Deliberately NOT part of the spawn effect below: that effect re-runs on
   * every `state` change, so its cleanup used to cancel the 1200ms removal of
   * every number still in the air. Only unmount clears these.
   */
  const floaterDeadlines = useRef<number[]>([]);
  useEffect(
    () => () => {
      floaterDeadlines.current.forEach((deadline) => window.clearTimeout(deadline));
    },
    [],
  );

  useEffect(() => {
    if (!state || playedEvents.length === 0) return undefined;
    // Same identity guard as the audio pass, so each action's numbers spawn
    // exactly once instead of only the first batch ever rendering.
    if (lastFloatedEvents.current === playedEvents) return undefined;
    lastFloatedEvents.current = playedEvents;
    const spawned: SosFloater[] = [];
    for (const ev of playedEvents) {
      if (ev.type === 'UNIT_ATTACKED') {
        const target = state.units.get(ev.targetId);
        const attacker = state.units.get(ev.attackerId);
        // Same arrival time as the impact, so the number does not appear while
        // the projectile is still in the air.
        const arrival = (at: Position) =>
          impactDelayFor(attacker?.position ?? at, at, attacker?.type);
        if (target && ev.hit !== false && ev.damage > 0) {
          spawned.push({
            id: `f${(floaterSeq.current += 1)}`,
            x: target.position.x,
            y: target.position.y,
            text: `-${ev.damage}`,
            kind: 'damage',
            delayMs: arrival(target.position),
          });
        }
        for (const id of ev.defeated) {
          const fallen = state.units.get(id);
          if (fallen) {
            spawned.push({
              id: `f${(floaterSeq.current += 1)}`,
              x: fallen.position.x,
              y: fallen.position.y,
              text: 'DEFEATED',
              kind: 'defeat',
              delayMs: arrival(fallen.position),
            });
          }
        }
      } else if (ev.type === 'UNIT_HEALED') {
        const target = state.units.get(ev.targetId);
        if (target) {
          spawned.push({
            id: `f${(floaterSeq.current += 1)}`,
            x: target.position.x,
            y: target.position.y,
            text: `+${ev.restored}`,
            kind: 'heal',
          });
        }
      } else if (ev.type === 'ZONE_TICK') {
        // Allies standing in Sanctified Ground rise in green.
        for (const gain of ev.healed) {
          const unit = state.units.get(gain.unitId);
          if (!unit) continue;
          spawned.push({
            id: `f${(floaterSeq.current += 1)}`,
            x: unit.position.x,
            y: unit.position.y,
            text: `+${gain.amount}`,
            kind: 'heal',
          });
        }
        for (const burn of ev.burned) {
          const unit = state.units.get(burn.unitId);
          if (!unit) continue;
          spawned.push({
            id: `f${(floaterSeq.current += 1)}`,
            x: unit.position.x,
            y: unit.position.y,
            text: `-${burn.amount}`,
            kind: 'damage',
          });
        }
      } else if (ev.type === 'SPELL_HIT') {
        const target = state.units.get(ev.targetId);
        if (target) {
          spawned.push({
            id: `f${(floaterSeq.current += 1)}`,
            x: target.position.x,
            y: target.position.y,
            text: `-${ev.damage}`,
            kind: 'damage',
          });
        }
      } else if (ev.type === 'IMPACT_BONUS') {
        const target = state.units.get(ev.unitId);
        if (target) {
          spawned.push({
            id: `f${(floaterSeq.current += 1)}`,
            x: target.position.x,
            y: target.position.y,
            text: `-${ev.damage}`,
            kind: 'damage',
          });
        }
      } else if (ev.type === 'GUARD_ABSORBED') {
        const target = state.units.get(ev.targetId);
        if (target) {
          spawned.push({
            id: `f${(floaterSeq.current += 1)}`,
            x: target.position.x,
            y: target.position.y,
            text: `BLOCKED ${ev.damage}`,
            kind: 'block',
          });
        }
      }
    }
    if (!spawned.length) return undefined;
    // A floater appears at its own delay and then lives the usual 1200ms, so a
    // delayed number is not cut short by a clock that started before it existed.
    const timers: number[] = [];
    for (const floater of spawned) {
      timers.push(
        window.setTimeout(() => {
          setFloaters((prev) => [...prev, floater]);
          /*
           * `1200` is a hard lifespan, counted from the frame the number
           * appears — not from the command that produced it, so a delayed
           * number is not cut short by a clock that started before it existed.
           *
           * Retirement used to be scheduled into `timers` instead. That array
           * is wiped by the effect cleanup on the next `state` change, i.e. on
           * the very next move: every number still rising when the turn moved
           * on kept its DOM entry for the rest of the match. It went invisible
           * after its 1.1s CSS animation but stayed in `floaters`, which is
           * what pinned `busy` true (so the result dialog never opened) and
           * what a camera pan dragged back over the board.
           */
          floaterDeadlines.current.push(
            window.setTimeout(
              () => setFloaters((prev) => prev.filter((f) => f.id !== floater.id)),
              1200,
            ),
          );
        }, floater.delayMs ?? 0),
      );
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [playedEvents, state]);

  /**
   * Shorten the end-of-battle wait when nothing is actually still animating, so
   * a clean win does not sit dead for the full cap — but never below
   * `RESOLVE_MIN`, or the dialog would pop on the same frame as the last hit.
   */
  useEffect(() => {
    if (!resultKind || showResult) return undefined;
    const busy =
      spellFx.length > 0 || linkFx.length > 0 || floaters.length > 0 ||
      Object.keys(reactions).length > 0;
    if (busy) return undefined;
    const t = window.setTimeout(() => setShowResult(true), RESOLVE_MIN);
    return () => window.clearTimeout(t);
  }, [resultKind, showResult, spellFx, linkFx, floaters, reactions, RESOLVE_MIN]);

  const handleCellClick = (x: number, y: number) => {
    if (!state) return;
    const pos = { x, y };

    /*
     * The altar answers clicks on its own four tiles, and only while a wish is
     * actually available — the tiles are walls, so the button underneath is
     * disabled otherwise and this never runs. Clicking anywhere else steps away
     * from the menu rather than leaving it hanging over the board.
     */
    if (altarMenuOpen) setAltarMenuOpen(false);
    if (altarUnit && altarTileKeys.has(positionKey(pos))) {
      setAltarMenuOpen(true);
      playSfx('select');
      return;
    }

    /*
     * Free camera first, before any turn/phase guard.
     *
     * With no unit selected the board is a map, not an action surface: a click
     * centres the camera on that tile. A click that lands on one of your own
     * units is still a selection, though — picking a piece out of the overview
     * has to open its panel and bring the camera with it, otherwise the click
     * pans to the tile you were aiming at and the squad stays unselected.
     *
     * This deliberately works on the opponent's turn too — inspecting the floor
     * is exactly when a player wants the overview — and it must not require a
     * playable turn.
     *
     * Selection is still one click away in Squad Shortcuts, which also exits
     * this mode and restores the normal stats/skills panel.
     */
    if (!selectedUnit) {
      const picked = unitAt(state, pos);
      if (
        picked &&
        state.phase === 'playing' &&
        picked.ownerId === state.activePlayerId &&
        picked.stats.currentHp > 0
      ) {
        selectAndFocus(picked);
        return;
      }
      centerCameraOn(pos, true);
      return;
    }

    if (state.phase !== 'playing' || !isPlayableTurn) return;
    const clicked = unitAt(state, pos);
    const invalidAt = (target: Position) => {
      flashInvalid(target);
      playSfx('invalid');
    };

    /**
     * Does this click pick a unit rather than act with the selected one?
     *
     * Selection lives at the end of this handler, so the guard below has to
     * recognise a selection click and step aside — otherwise a spent unit blocks
     * the very click that would select the next one. An armed ability may target
     * an ally, and Slam is aimed at the ground and does friendly fire, so in
     * those cases clicking your own unit is still an action.
     *
     * Clicking the *already selected* unit is always a selection, though. Without
     * that, a spent unit selected in Slam mode could not be deselected and the
     * player would be trapped with no way to pick up another piece.
     */
    const selectsUnit =
      !!clicked &&
      clicked.ownerId === state.activePlayerId &&
      clicked.stats.currentHp > 0 &&
      // With an ability armed, a click on your own unit is a TARGET (self-heal,
      // self shield, Song of Rest on the Bard), not a deselect.
      ((clicked.id === selectedUnitId && !armedAbility) ||
        !unitCanAct ||
        (!armedAbility && actChoice !== 'SLAM' && actChoice !== 'ATTACK'));

    /**
     * Movement and the action are independent points, so there is no "wrong
     * mode" to block here. Each branch below checks the point it costs: a move
     * needs `unitCanMove`, every attack/heal/guard/slam needs `unitCanAct`.
     * Whatever falls through was not a legal target and gets the invalid cue.
     */
    if (selectedUnit && !selectsUnit && !unitCanMove && !unitCanAct) {
      invalidAt(pos);
      return;
    }

    // An armed tile ability consumes this click as its target. The target set is
    // the same one painted on the board, so a tile that is not highlighted can
    // never send a doomed command.
    if (armedAbility && selectedUnit && unitCanAct) {
      if (!abilityTargets.has(positionKey(pos))) {
        invalidAt(pos);
        return;
      }
      const command = buildAbilityCommand(armedAbility, selectedUnit, pos);
      if (command) {
        setPendingConfirm({
          command,
          title: abilityName(armedAbility),
          detail: abilityDescription(armedAbility),
          at: pos,
        });
        setArmedAbility(null);
      } else {
        invalidAt(pos);
      }
      return;
    }

    // Enemy-occupied tiles must resolve to ATTACK_UNIT, never the generic tile
    // attack, so the class-specific `UNIT_ATTACKED` visuals run. `RANGER_SHOT`
    // is reserved for bare ground / traps / ice.
    if (
      selectedUnit &&
      clicked &&
      actChoice === 'ATTACK' &&
      unitCanAct &&
      attackIds.has(clicked.id)
    ) {
      setPendingConfirm({
        command: { type: 'ATTACK_UNIT', attackerId: selectedUnit.id, targetId: clicked.id },
        title: `${CLASS_LABELS[selectedUnit.type]} — Attack`,
        detail: `${CLASS_LABELS[selectedUnit.type]} strikes ${CLASS_LABELS[clicked.type]} for ${selectedUnit.stats.attackDamage}`,
        at: pos,
      });
      return;
    }

    if (
      selectedUnit &&
      actChoice === 'ATTACK' &&
      unitCanAct &&
      aimMode === 'action' &&
      rangerShotKeys.has(positionKey(pos))
    ) {
      setPendingConfirm({
        command: { type: 'RANGER_SHOT', unitId: selectedUnit.id, x, y },
        title: `${CLASS_LABELS[selectedUnit.type]} — Attack`,
        detail: `${CLASS_LABELS[selectedUnit.type]} attacks (${x}, ${y}) for ${selectedUnit.stats.attackDamage}`,
        at: pos,
      });
      return;
    }

    if (
      selectedUnit && clicked && unitCanAct &&
      actChoice === 'HEAL' && aimMode === 'action' && healIds.has(clicked.id)
    ) {
      dispatch({ type: 'HEAL_UNIT', healerId: selectedUnit.id, targetId: clicked.id });
      return;
    }
    if (
      selectedUnit && clicked && unitCanAct &&
      actChoice === 'GUARD' && aimMode === 'action' && guardIds.has(clicked.id)
    ) {
      dispatch({ type: 'GUARD_UNIT', unitId: selectedUnit.id, targetId: clicked.id });
      playSfx('heal');
      return;
    }
    // Slam aims at the ground, so an empty tile is a legal (if wasted) target.
    // It keeps the action-mode check because bare ground is also a move tile:
    // the mode only breaks that tie, it does not sequence the turn.
    if (selectedUnit && unitCanAct && actChoice === 'SLAM' && aimMode === 'action') {
      if (chebyshev(selectedUnit.position, pos) <= ABILITIES.SHIELD_SLAM.range) {
        dispatch({ type: 'SHIELD_SLAM', unitId: selectedUnit.id, x: pos.x, y: pos.y });
      } else {
        invalidAt(pos);
      }
      return;
    }
    if (clicked && clicked.ownerId === state.activePlayerId && clicked.stats.currentHp > 0) {
      selectUnit(clicked.id === selectedUnitId ? null : clicked.id);
      playSfx('select');
      return;
    }
    if (selectedUnit && unitCanMove && moveKeys.has(positionKey(pos))) {
      dispatch({ type: 'MOVE_UNIT', unitId: selectedUnit.id, to: pos });
      return;
    }
    // Anything else was an illegal click — tell the player audibly and visibly.
    invalidAt(pos);
  };

  // ── private room invite ──────────────────────────────────────────────────
  const [copyState, setCopyState] = useState<'idle' | 'link' | 'code' | 'failed'>('idle');
  /** True once we have been queued for a lobby and should show the waiting room. */
  const [onlineWanted, setOnlineWanted] = useState(false);

  const handleCopyLink = useCallback(async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(roomInviteUrl(room.roomId));
      setCopyState('link');
    } catch {
      setCopyState('failed');
    }
  }, [room]);

  const handleCopyCode = useCallback(async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.roomId);
      setCopyState('code');
    } catch {
      setCopyState('failed');
    }
  }, [room]);

  // A new room deserves a clean status line, not "copied" from the last one.
  useEffect(() => {
    setCopyState('idle');
  }, [room?.roomId]);

  // ── duel lobby ───────────────────────────────────────────────────────────
  /** True once the player has opened the duel lobby this session. */
  const [lobbyOpen, setLobbyOpen] = useState(false);
  /*
   * The code a guest typed, and whether they are still typing it.
   *
   * `joinCodeOpen` is kept rather than derived from a `<details>` open event,
   * because the form has to survive the lobby being torn down: submitting an
   * empty code is a mistake worth keeping the text on screen for, not worth
   * clearing what they half-typed. It also stops the field reappearing
   * collapsed after a failed join, which reads as the app resetting itself.
   */
  const [joinCodeOpen, setJoinCodeOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  const submitJoinCode = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const code = joinCode.trim();
      // An empty box is a misclick, not a request to join room "". Silently
      // doing nothing leaves the player thinking it is loading.
      if (!code) return;
      // Standing in your own roster while joining somebody else's room is a
      // state the server has to resolve, so drop off the roster first — the
      // same reason opening a private room leaves before hosting.
      leaveLobby();
      setLobbyOpen(false);
      setOnlineWanted(true);
      joinOnline(code);
    },
    [joinCode, joinOnline, leaveLobby],
  );

  /** Create a private room and show its invite code. */
  const openPrivateRoom = useCallback(() => {
    playSfx('select');
    leaveLobby();
    setLobbyOpen(false);
    setJoinCodeOpen(false);
    setJoinCode('');
    setOnlineWanted(true);
    hostOnline();
  }, [hostOnline, leaveLobby]);

  /** Join a friend's open private room with one click. */
  const joinLobbyRoom = useCallback(
    (lobbyRoom: LobbyRoom) => {
      playSfx('select');
      leaveLobby();
      setLobbyOpen(false);
      setOnlineWanted(true);
      joinOnline(lobbyRoom.roomId);
    },
    [joinOnline, leaveLobby],
  );

  /**
   * Walk back into a duel that is still holding this browser's seat.
   *
   * Same exit sequence as joining a room: leave the roster first so the other
   * lobby clients stop showing a player who is now in a match, then send the
   * remembered room id. The server remains the authority on whether the grace
   * window is still open.
   */
  const rejoinFromLobby = useCallback(() => {
    if (!resumeRoomId) return;
    playSfx('select');
    leaveLobby();
    setLobbyOpen(false);
    setOnlineWanted(true);
    resumeOnline();
  }, [leaveLobby, resumeOnline, resumeRoomId]);

  /** Close a private room and go back to the roster rather than the menu. */
  const closePrivateRoom = useCallback(() => {
    leaveOnline();
    setOnlineWanted(false);
    setLobbyOpen(true);
  }, [leaveOnline]);
  const returnToGameMenu = useCallback(() => {
    if (lobbyOpen) {
      leaveLobby();
      setLobbyOpen(false);
      setOnlineWanted(false);
      backToMenu();
      return;
    }
    if (mode === 'online') {
      setOnlineWanted(false);
      leaveOnline();
      return;
    }
    if (mode !== 'menu') backToMenu();
  }, [backToMenu, leaveLobby, leaveOnline, lobbyOpen, mode]);

  // The lobby is a menu-only surface. Once a challenge or private room turns
  // into a match, leaving this flag set made the top bar's Menu button take the
  // lobby exit path instead of leaving the duel.
  useEffect(() => {
    if (mode !== 'menu' && lobbyOpen) setLobbyOpen(false);
  }, [mode, lobbyOpen]);

  // Register with the duel lobby as soon as the Online Duel card is pressed, then
  // refresh the roster while it is open. The periodic read is also what makes a
  // friend's newly created private room appear, and its closed room disappear,
  // without making the match server push lobby broadcasts from `sos.js`.
  useEffect(() => {
    if (!lobbyOpen || !canPlayOnline) return undefined;
    enterLobby();
    // Ask immediately rather than waiting for the first poll: this is the reply
    // that carries the held seat and its grace deadline.
    refreshLobby();
    const timer = setInterval(refreshLobby, 6000);
    return () => clearInterval(timer);
  }, [lobbyOpen, canPlayOnline, enterLobby, refreshLobby]);

  /** Everyone except me — you cannot duel yourself. */
  const duelOpponents = lobbyPlayers.filter((p) => p.id !== humanId);
  /** Private rooms hosted by somebody else. Own rooms are covered by Rejoin. */
  const openRooms = lobbyRooms.filter((room) => room.hostId !== humanId);
  /**
   * A host is in a room, not looking for a random challenge. The server drops
   * them from the roster when they create the room, but filtering again here
   * closes the race where a stale snapshot shows them in both lists.
   */
  const openRoomHostIds = new Set(openRooms.map((room) => room.hostId));
  /**
   * One list of opponents, challengeable players first. The two columns below
   * split this at render time: a free player belongs in "Players online", a
   * seated one in "In a duel". Keeping the ordering here means both lists use
   * the same stable order.
   */
  const sortedOpponents = duelOpponents
    .filter((player) => !openRoomHostIds.has(player.id))
    .sort(
      (a, b) =>
        Number(b.challengeable) - Number(a.challengeable) ||
        a.username.localeCompare(b.username),
    );

  /*
   * You are part of the roster too.
   *
   * The server only publishes a roster row once `lobby:enter` has landed, so a
   * player who has just opened the lobby would otherwise see an empty list and
   * wonder whether their own presence had registered. The local row is
   * synthesised from the same snapshot when it exists (keeping the server's
   * avatar and status) and falls back to the signed-in profile before it lands.
   *
   * `resumeRoomId` is the important part: a player who reloaded mid-duel is
   * still holding a seat on the server but is not in `lobbyPlayers` yet. That is
   * exactly the row that must appear under "In a duel" with a Rejoin action,
   * rather than as a free player with no way back.
   */
  const selfRow = lobbyPlayers.find((player) => player.id === humanId);
  /*
   * "In a duel" is a claim about a held seat, not about the last lobby status
   * the server wrote: after a forfeit the players row can still say IN_GAME, and
   * trusting it would strand the player in the busy column with no Rejoin. The
   * seat answer is the only thing that can be right here.
   */
  const selfInDuel = !!lobbyResume || (!!resumeRoomId && !lobbyResumeLoaded);
  const selfCanRejoin = !!lobbyResume || (!!resumeRoomId && !lobbyResumeLoaded);
  const selfPlayer: LobbyPlayer = {
    id: humanId,
    username: selfRow?.username || nickname?.trim() || 'You',
    avatarImage: selfRow?.avatarImage || avatarImage || null,
    status: selfRow?.status ?? 'IN_LOBBY',
    challengeable: false,
    inGame: selfInDuel,
    connected: true,
  };
  const rosterPlayers = [selfPlayer, ...sortedOpponents];
  const onlinePlayers = rosterPlayers.filter((player) => !player.inGame);
  const inDuelPlayers = rosterPlayers.filter((player) => player.inGame);
  const freeOpponentCount = sortedOpponents.filter((player) => !player.inGame).length;
  const selfRejoinClock = rejoinSecondsLeft > 0
    ? `${Math.floor(rejoinSecondsLeft / 60)}:${String(rejoinSecondsLeft % 60).padStart(2, '0')}`
    : null;

  // A lapsed incoming prompt must not hang on screen if the poll that retires it
  // was the thing that died with the socket.
  useEffect(() => {
    if (!incomingChallenge || challengeSecondsLeft > 0) return;
    respondChallenge(incomingChallenge.challengeId, false);
  }, [incomingChallenge, challengeSecondsLeft, respondChallenge]);

  const isPlayingMatch = !!(mode !== 'menu' && state && state.phase !== 'deployment');
  const renderBrandControls = () => (
    <div className="sos-topbar-header sos-chronicle-brand">
      {(mode !== 'menu' || lobbyOpen) && (
        <button
          type="button"
          className="ghost-button sos-back"
          onClick={returnToGameMenu}
          aria-label="Back to Square of Shadows menu"
          title="Back to Square of Shadows menu"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span>MENU</span>
        </button>
      )}
      <a
        href="/projects#games"
        className="sos-brand-mark"
        aria-label="Back to Work"
        title="Back to Work"
        onClick={(event) => {
          event.preventDefault();
          window.location.href = '/projects#games';
        }}
      >
        GG
      </a>
      <div className="sos-brand">
        <span className="sos-brand-crest" aria-hidden="true" />
        <span>Square of Shadows</span>
      </div>
    </div>
  );
  const renderSoundControl = () => (
    <div className="sos-audio-bar sos-chronicle-audio">
      <details className="sos-sound-control">
        <summary
          className={`sos-audio-btn sos-sound-trigger${audioPrefs.sfx || audioPrefs.music ? ' is-on' : ''}`}
          aria-label="Open sound settings"
          title="Sound settings"
          onClick={handleFirstGesture}
        >
          {audioPrefs.sfx || audioPrefs.music
            ? <Volume2 size={16} aria-hidden="true" />
            : <VolumeX size={16} aria-hidden="true" />}
        </summary>
        <div className="sos-sound-popover" role="group" aria-label="Sound settings">
          <div className="sos-sound-channel">
            <div className="sos-sound-channel-heading">
              <label htmlFor="sos-sfx-volume">Sound effects</label>
              <output htmlFor="sos-sfx-volume">{audioPrefs.sfxVolume}%</output>
            </div>
            <button
              type="button"
              className={`sos-sound-toggle${audioPrefs.sfx ? ' is-on' : ''}`}
              aria-label={audioPrefs.sfx ? 'Mute sound effects' : 'Enable sound effects'}
              aria-pressed={audioPrefs.sfx}
              onClick={() => {
                setSfxEnabled(!audioPrefs.sfx);
                setAudioPrefs(getAudioPrefs());
              }}
            >
              {audioPrefs.sfx ? 'On' : 'Muted'}
            </button>
            <input
              id="sos-sfx-volume"
              className="sos-sound-slider"
              type="range"
              min="0"
              max="100"
              step="1"
              value={audioPrefs.sfxVolume}
              aria-label="Sound effects volume"
              onChange={(event) => {
                setSfxVolume(Number(event.currentTarget.value));
                setAudioPrefs(getAudioPrefs());
              }}
            />
          </div>
          <div className="sos-sound-channel">
            <div className="sos-sound-channel-heading">
              <label htmlFor="sos-music-volume">Background music</label>
              <output htmlFor="sos-music-volume">{audioPrefs.musicVolume}%</output>
            </div>
            <button
              type="button"
              className={`sos-sound-toggle${audioPrefs.music ? ' is-on' : ''}`}
              aria-label={audioPrefs.music ? 'Mute background music' : 'Enable background music'}
              aria-pressed={audioPrefs.music}
              onClick={() => {
                setMusicEnabled(!audioPrefs.music);
                setAudioPrefs(getAudioPrefs());
              }}
            >
              {audioPrefs.music ? 'On' : 'Muted'}
            </button>
            <input
              id="sos-music-volume"
              className="sos-sound-slider"
              type="range"
              min="0"
              max="100"
              step="1"
              value={audioPrefs.musicVolume}
              aria-label="Background music volume"
              onChange={(event) => {
                setMusicVolume(Number(event.currentTarget.value));
                setAudioPrefs(getAudioPrefs());
              }}
            />
          </div>
        </div>
      </details>
    </div>
  );

  return (
    <div className="sos-root" onPointerDownCapture={handleFirstGesture}>
      <div className="sos-topbar">
        {!isPlayingMatch && (
          <div className="sos-topbar-left">{renderBrandControls()}</div>
        )}

        {/*
          Turn state and the clock, in one top-anchored gothic tab.

          They used to be two separate widgets inside the top bar's centre cell,
          which cost a row of board height and read as a HUD rather than as part
          of the room. One hanging crest, pinned to the top edge of the viewport
          (`position: fixed`, so it stays put when a phone scrolls the column),
          carries both readouts in a single line.

          `.sos-turn-banner` and `.sos-timer` keep their names on purpose: the
          browser smoke measures those two boxes, and the greeting still has to
          be readable as plain text inside the crest.
        */}
        {mode !== 'menu' && state && state.phase === 'playing' && (
          <>
            <div
              className={`sos-turn-tab${isPlayableTurn ? ' is-mine' : ''}`}
              role="status"
              aria-live="off"
            >
              <span className="sos-turn-banner">
                <span className="sos-turn-label">{turnLabel}</span>
                <span className="sos-turn-sub">• Turn {state.turnNumber}</span>
              </span>
              {showTurnClock && (
                <>
                  <span className="sos-turn-divider" aria-hidden="true">|</span>
                  <div
                    className={`sos-timer${timer.isUrgent ? ' is-urgent' : ''}${timer.isCritical ? ' is-critical' : ''}`}
                    role="timer"
                    aria-live="off"
                  >
                    <span className="sos-timer-label">Time</span>
                    <span className="sos-timer-clock">{formatTurnClock(timer.remaining)}</span>
                    <div className="sos-timer-track" aria-hidden="true">
                      <div className="sos-timer-fill" style={{ width: `${timer.fraction * 100}%` }} />
                    </div>
                  </div>
                </>
              )}
            </div>

          </>
        )}

        {!isPlayingMatch && <div className="sos-topbar-right">{renderSoundControl()}</div>}
      </div>

      {/* The duel lobby REPLACES the menu rather than rendering beneath it.
          `.sos-root` is a flex column and the menu is taller than the viewport,
          so a sibling block below it opened off-screen — clicking Online Duel
          looked like it did nothing at all.

          Layout is the AAA title-screen convention rather than a centred card:
          the artwork is the page, the wordmark sits top-left, and the mode list
          runs vertically down the left edge. There is no panel, because a panel
          would box the artwork in and put a border back around the thing the
          whole screen exists to show. */}
      {mode === 'menu' && !lobbyOpen && (
        <div className="sos-menu has-wallpaper">
          {/*
            The wallpaper is its own element, not a background layer on `.sos-menu`.

            Fitted to height it leaves bare columns at the sides on a wide window,
            and those columns have to fade out. As a background layer that fade
            would be sized to the VIEWPORT while the artwork's edge lands wherever
            its aspect ratio puts it — so on an ultrawide you get a visible
            vertical seam where the image stops. As an element, the mask covers
            exactly the image's own box, so the fade always lands on the artwork's
            edges whatever shape the window is.
          */}
          {/*
            Unconditional. This was gated on `showWallpaper`, which let the click
            on the wordmark pull the cathedral out from under the title. The class
            stays hard-on for the same reason: it carries the `background-color`
            behind the image and the scrim that shows through the mask's faded
            edges, so dropping it would leave the fade with nothing to fade into.
          */}
          <img className="sos-menu-wallpaper" src={publicAsset('/sprites/wallpaper.jpg')} alt="" />

          {/* Legibility scrim. The artwork is the point, so this darkens the
              edges rather than washing the whole frame — white text over the
              bright middle of a cathedral still reads. */}
          <div className="sos-menu-vignette" aria-hidden="true" />

          <div className="sos-menu-hero-art" aria-hidden="true">
            <img
              src={publicAsset('/sprites/sos-pixellab/gothic-altar.png')}
              alt=""
              className="sos-altar-art"
            />
          </div>

          <header className="sos-title-block">
            <p className="eyebrow">Holy Wars — Tactics of Blood &amp; Faith</p>
            <h1 className="sos-title">Square of Shadows</h1>
            <p className="sos-lead">
              Command a squad of four across desecrated cathedrals and bloodstained
              ruins. Outmanoeuvre your rival: move, strike, heal, and claim the altar
              of shadows.
            </p>
          </header>

          {/*
            Exactly three ways to play, as a left-aligned list. Online Duel opens
            the lobby sub-view rather than doing anything itself, so hosting and
            joining a code stay in one obvious place.

            The icon is kept inline with the label rather than dropped: it is the
            only thing distinguishing "two people share a keyboard" from "two
            people duel online" once the explanatory copy is gone, and a row of
            bare serif text is the one part of this screen a player new to the
            game would find hardest to scan.

            The class showcase is NOT here. It moved to the faction draft, which
            is where a player has actually committed to a match and can afford
            to spend attention on it — on the title screen it was four more
            things competing with the artwork for the eye.
          */}
          <nav className="sos-menu-nav" aria-label="Ways to play">
            <button
              type="button"
              className="sos-menu-entry"
              onClick={() => {
                playSfx('select');
                startGame('ai');
              }}
            >
              <Bot size={22} aria-hidden="true" />
              <span className="sos-menu-entry-label">AI</span>
              <span className="sos-menu-entry-hint">You against a dungeon AI squad.</span>
            </button>
            <button
              type="button"
              className="sos-menu-entry"
              onClick={() => {
                playSfx('select');
                startGame('hotseat');
              }}
            >
              <Users size={22} aria-hidden="true" />
              <span className="sos-menu-entry-label">Local Duel</span>
              <span className="sos-menu-entry-hint">Two players, one keyboard and mouse.</span>
            </button>
            <button
              type="button"
              className={`sos-menu-entry${canPlayOnline ? '' : ' is-disabled'}`}
              disabled={!canPlayOnline}
              onClick={() => {
                playSfx('select');
                setLobbyOpen(true);
              }}
              title={
                canPlayOnline
                  ? 'Challenge another player from the duel lobby'
                  : isOnline
                    ? 'The lobby socket is still connecting…'
                    : 'Online duels need the lobby connection'
              }
            >
              <Globe size={22} aria-hidden="true" />
              <span className="sos-menu-entry-label">Online Duel</span>
              <span className="sos-menu-entry-hint">
                {canPlayOnline
                  ? 'Challenge another player to a duel.'
                  : isOnline
                    ? 'Connecting to the lobby…'
                    : 'Needs the lobby connection.'}
              </span>
            </button>
          </nav>

          {/*
            Resume.

            Not a fourth mode — it is a state, not a way to play, so it is a
            separate card and the three mode entries stay exactly three. Without
            it a player who closed the tab mid-duel came back to a title screen
            with no way back into a live match: the only door was the invite link,
            and they no longer had it.
          */}
          {resumeRoomId && canPlayOnline && (
            <button
              type="button"
              className="sos-menu-resume"
              onClick={() => {
                playSfx('select');
                setOnlineWanted(true);
                resumeOnline();
              }}
            >
              <RotateCcw size={20} aria-hidden="true" />
              <span>
                <strong>Rejoin your duel</strong>
                <em>You have 1 minute to rejoin before it is forfeited.</em>
              </span>
            </button>
          )}
        </div>
      )}

      {/* The duel lobby: one compact roster and one action per row. */}
      {mode === 'menu' && lobbyOpen && (
        <div className="sos-lobby sos-duel-lobby">
          <div className="sos-lobby-head">
            <div className="sos-lobby-head-copy">
              <p className="sos-lobby-eyebrow">Online duel</p>
              <h2 className="sos-lobby-title">Find a rival</h2>
              <p className="sos-lobby-hint">
                Challenge someone who is ready. Private rooms are in the footer.
              </p>
            </div>
            <ConnectionPill isOnline={isOnline} />
          </div>

          {outgoingChallenge && (
            <p className="sos-challenge-waiting">
              Waiting for {outgoingChallenge.toNickname} to answer…
            </p>
          )}

          {openRooms.length > 0 && (
            <section className="sos-lobby-section is-rooms" aria-labelledby="sos-open-rooms-title">
              <h3 id="sos-open-rooms-title" className="sos-roster-col-title">
                Open rooms
                <span className="sos-roster-col-count">{openRooms.length}</span>
              </h3>
              <ul className="sos-duel-list">
                {openRooms.map((lobbyRoom) => (
                  <li key={lobbyRoom.roomId} className="sos-duel-row is-room">
                    <span className="sos-room-mark" aria-hidden="true">
                      <KeyRound size={16} />
                    </span>
                    <span className="sos-duel-name">
                      {lobbyRoom.hostNickname}
                      <em className="sos-duel-sub">Room code · {lobbyRoom.roomId}</em>
                    </span>
                    <button
                      type="button"
                      className="sos-duel-challenge"
                      onClick={() => joinLobbyRoom(lobbyRoom)}
                    >
                      Join
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* The old split is back: free players left, live duels right. */}
          <div className="sos-lobby-roster-grid">
            <section
              className="sos-lobby-section is-available"
              aria-labelledby="sos-players-title"
            >
              <h3 id="sos-players-title" className="sos-roster-col-title">
                Players online
                <span className="sos-roster-col-count">{onlinePlayers.length}</span>
              </h3>
              <ul className="sos-duel-list">
                {onlinePlayers.map((player) => {
                  const isYou = player.id === humanId;
                  const status = isYou
                    ? outgoingChallenge
                      ? 'Waiting for challenge acceptance'
                      : incomingChallenge
                        ? 'Answering an offer'
                        : player.status === 'PENDING_CHALLENGE'
                          ? 'Waiting on a challenge'
                          : 'You · Online'
                    : !player.connected
                      ? 'Offline'
                      : player.status === 'PENDING_CHALLENGE'
                        ? 'Waiting on a challenge'
                        : 'Ready';
                  return (
                    <li
                      key={player.id}
                      className={`sos-duel-row${player.connected ? '' : ' is-dropped'}${isYou ? ' is-you' : ''}`}
                    >
                      <SosLobbyAvatar src={player.avatarImage} name={player.username} />
                      <span className="sos-duel-name">
                        {player.username}
                        <em
                          className={`sos-duel-sub${player.challengeable || isYou ? ' is-ready' : ''}`}
                        >
                          {status}
                        </em>
                      </span>
                      {player.challengeable && !isYou && (
                        <button
                          type="button"
                          className="sos-duel-challenge"
                          onClick={() => {
                            playSfx('select');
                            sendChallenge(player);
                          }}
                        >
                          Challenge
                        </button>
                      )}
                    </li>
                  );
                })}
                {freeOpponentCount === 0 && (
                  <li className="sos-duel-empty">
                    No one else is waiting for a duel right now. Open a room and share
                    the code, or wait for a friend.
                  </li>
                )}
              </ul>
            </section>

            <section
              className="sos-lobby-section is-busy"
              aria-labelledby="sos-duels-title"
            >
              <h3 id="sos-duels-title" className="sos-roster-col-title">
                In a duel
                <span className="sos-roster-col-count">{inDuelPlayers.length}</span>
              </h3>
              <ul className="sos-duel-list">
                {inDuelPlayers.map((player) => {
                  const isYou = player.id === humanId;
                  const canRejoin = isYou && selfCanRejoin;
                  const status = isYou
                    ? selfRejoinClock
                      ? `You · ${selfRejoinClock} to rejoin`
                      : canRejoin
                        ? 'You · Seat held'
                        : 'You · In a duel'
                    : !player.connected
                      ? 'Offline'
                      : 'In a duel';
                  return (
                    <li
                      key={player.id}
                      className={`sos-duel-row is-duel${player.connected ? '' : ' is-dropped'}${isYou ? ' is-you' : ''}`}
                    >
                      <SosLobbyAvatar src={player.avatarImage} name={player.username} />
                      <span className="sos-duel-name">
                        {player.username}
                        <em className={`sos-duel-sub${canRejoin ? ' is-rejoin' : ''}`}>
                          {status}
                        </em>
                      </span>
                      {canRejoin && (
                        <button
                          type="button"
                          className="sos-duel-challenge sos-duel-rejoin"
                          onClick={rejoinFromLobby}
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                          Rejoin
                        </button>
                      )}
                    </li>
                  );
                })}
                {inDuelPlayers.length === 0 && (
                  <li className="sos-duel-empty">No duels in progress.</li>
                )}
              </ul>
            </section>
          </div>

          {roomError && (
            <button type="button" className="sos-error" onClick={clearRoomError}>
              {roomError} — dismiss
            </button>
          )}

          {/* Private rooms are the secondary path: tiny controls in the footer,
              leaving Challenge as the obvious action on each player row. */}
          <div className="sos-lobby-foot">
            {joinCodeOpen && (
              <form className="sos-join-form" onSubmit={submitJoinCode}>
                <label className="sos-join-label" htmlFor="sos-join-code">
                  Room code
                </label>
                <div className="sos-join-row">
                  <input
                    id="sos-join-code"
                    className="sos-join-input"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    placeholder="Enter code"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={12}
                    autoFocus
                  />
                  <button type="submit" className="primary-button" disabled={!joinCode.trim()}>
                    Join
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setJoinCodeOpen(false);
                      setJoinCode('');
                    }}
                    aria-label="Cancel joining by code"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <footer className="sos-lobby-footer" aria-label="Private rooms">
              <button
                type="button"
                className="sos-lobby-footer-btn"
                onClick={openPrivateRoom}
              >
                <Hammer size={13} aria-hidden="true" />
                Create room
              </button>
              <button
                type="button"
                className="sos-lobby-footer-btn"
                onClick={() => {
                  playSfx('select');
                  setJoinCodeOpen((open) => !open);
                }}
                aria-expanded={joinCodeOpen}
              >
                <KeyRound size={13} aria-hidden="true" />
                Join with code
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Incoming offer. Rendered above everything so it survives the menu being
          swapped for the board the instant the duel is accepted. */}
      {incomingChallenge && (
        <div className="sos-challenge-prompt" role="dialog" aria-label="Duel challenge">
          <p className="sos-challenge-text">
            <strong>{incomingChallenge.fromNickname}</strong> has challenged you to a duel!
          </p>
          <p className="sos-challenge-timer" aria-live="polite">
            Expires in {challengeSecondsLeft}s
          </p>
          <div className="sos-challenge-actions">
            <button
              type="button"
              className="sos-challenge-accept"
              onClick={() => {
                playSfx('select');
                respondChallenge(incomingChallenge.challengeId, true);
              }}
            >
              Accept
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => respondChallenge(incomingChallenge.challengeId, false)}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* Gentle toast for an offer that died. Not an error — declining and
          letting it lapse are both ordinary outcomes. */}
      {challengeToast && (
        <button type="button" className="sos-challenge-toast" onClick={clearChallengeToast}>
          {challengeToast.outcome === 'declined'
            ? `${challengeToast.fromNickname} declined your challenge.`
            : challengeToast.outcome === 'expired'
              ? 'Your challenge expired — nobody answered.'
              : `${challengeToast.fromNickname} could not start a duel.`}
        </button>
      )}

      {/* Result animation. One layer, two moods, driven by the class so the
          keyframes stay in App.css with the rest of the theme. */}
      {resultKind && <div className={`sos-result-fx is-${resultKind}`} aria-hidden="true" />}

      {/* Opponent dropped mid-duel: their seat is held open for 60 seconds. */}
      {graceNotice && (
        <div className="sos-grace-banner" role="status">
          Opponent disconnected. Waiting {graceSecondsLeft}s for reconnection…
        </div>
      )}

      {/* Shown from the moment the card is pressed. This has to live OUTSIDE the
          menu block: hosting flips the mode to `online`, which hides the menu,
          so a placeholder nested in the menu would disappear along with it and
          leave a blank screen while the lobby is still being created. */}
      {mode === 'online' && onlineWanted && !room && (
        <div className="sos-lobby sos-waiting">
          <span className="sos-wait-spinner" aria-hidden="true" />
          <p className="sos-lobby-eyebrow">Opening your lobby</p>
          <p className="sos-lobby-hint">
            {isOnline ? 'Asking the server for a code…' : 'Waiting for the lobby connection…'}
          </p>
          <ConnectionPill isOnline={isOnline} />
          <div className="sos-lobby-actions">
            <button type="button" className="ghost-button" onClick={() => { setOnlineWanted(false); backToMenu(); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* The waiting room. The code is the first thing on the screen because
          it is the one thing a host has to hand over; hiding it behind a key made
          a simple "send this to your friend" step feel like a secret. */}
      {mode === 'online' && room && room.phase === 'lobby' && (
        <div className="sos-lobby sos-waiting sos-private-room">
          <div className="sos-lobby-head">
            <div className="sos-lobby-head-copy">
              <p className="sos-lobby-eyebrow">Private room</p>
              <h2 className="sos-lobby-title">Waiting for a rival</h2>
              <p className="sos-lobby-hint">
                {room.seats.length >= 2
                  ? 'Both players are in — starting…'
                  : 'Send the code or invite link. The duel starts as soon as they join.'}
              </p>
            </div>
            <ConnectionPill isOnline={isOnline} />
          </div>

          <div className="sos-room-code-card">
            <span className="sos-room-code-label">Room code</span>
            <p className="sos-lobby-code" aria-label="Room code">
              {room.roomId}
            </p>
            <div className="sos-lobby-actions">
              <button type="button" className="primary-button" onClick={handleCopyLink}>
                <Copy size={15} aria-hidden="true" />
                {copyState === 'link' ? 'Link copied' : 'Copy invite link'}
              </button>
              <button type="button" className="ghost-button" onClick={handleCopyCode}>
                <KeyRound size={15} aria-hidden="true" />
                {copyState === 'code' ? 'Code copied' : 'Copy code'}
              </button>
            </div>
            {copyState !== 'idle' && (
              <p
                className={`sos-room-copy-status${copyState === 'failed' ? ' is-error' : ''}`}
                role="status"
              >
                {copyState === 'link'
                  ? 'Invite link copied — send it to your friend.'
                  : copyState === 'code'
                    ? 'Room code copied.'
                    : 'Could not copy automatically. Select the code above.'}
              </p>
            )}
          </div>

          <ol className="sos-seats" aria-label="Players in this room">
            {[0, 1].map((slot) => {
              const seat = room.seats.find((s) => s.slot === slot);
              const isYou = !!seat && seat.playerId === humanId;
              return (
                <li key={slot} className={`sos-seat${seat ? ' is-filled' : ''}`}>
                  <span className="sos-seat-mark" aria-hidden="true" />
                  <span className="sos-seat-name">
                    {seat ? seat.nickname : 'Waiting for a friend…'}
                    {isYou && <em className="sos-seat-you">you</em>}
                  </span>
                  <span className="sos-seat-state">
                    {seat ? (isYou ? 'Host' : 'Joined') : 'Empty'}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="sos-lobby-actions sos-private-room-actions">
            <button type="button" className="ghost-button" onClick={closePrivateRoom}>
              Close room
            </button>
          </div>
          {roomError && (
            <button type="button" className="sos-error" onClick={clearRoomError}>
              {roomError} — dismiss
            </button>
          )}
        </div>
      )}

      {mode !== 'menu' && state && (
        state.phase === 'deployment' ? (
          <section className="sos-faction-draft" aria-labelledby="sos-mode-title" style={{ marginTop: 0 }}>
            {/* The corners are drawn in CSS as four tapering rules rather than
                as an image, so they stay crisp at any zoom and cost no request.
                Purely decorative — the whole block is hidden from assistive
                tech. */}
            <span className="sos-draft-corner is-tl" aria-hidden="true" />
            <span className="sos-draft-corner is-tr" aria-hidden="true" />
            <span className="sos-draft-corner is-bl" aria-hidden="true" />
            <span className="sos-draft-corner is-br" aria-hidden="true" />

            {/*
                Game mode is the FIRST question, because it is the one that was
                being asked second. The screen used to open with "Choose your
                faction" and park the Arena/Adventure choice underneath it, which
                read as a footnote — even though the mode decides the floor both
                squads fight on, and the faction is just a colour swap on top.

                The "Before the first turn" eyebrow is gone with it: it described
                the phase rather than asking anything, and the two headings below
                now say what the player is actually being asked to do.
            */}
            <h2 id="sos-mode-title" className="sos-draft-title">
              Choose game mode
            </h2>
            {isFactionPicker && isOnlineMatch && (
              <p className="sos-faction-countdown" role="status">
                Choose within {formatTurnClock(factionDraftTimer.remaining)}; otherwise a faction is assigned automatically.
              </p>
            )}
            {/*
                Game mode, offered here because this is the last moment at which
                the board can still change: once squads deploy the terrain is
                locked, so a player who wanted a different arena cannot get it
                afterwards.

                Either seated player may set it and it is not turn-ordered — a
                mode preference is a preference, not a competitive action, and
                making players alternate draft turns over it would be friction
                for no fairness gain. The engine rebuilds the board from the same
                seed, so both clients land on identical terrain.

                NOTE the braces: a bare block comment in JSX children is TEXT,
                not a comment, and the compiler emits the whole paragraph as
                visible string children. It did exactly that once. Wrapping a
                comment in braces is the only form valid in children position.
              */}
              {/* This is where Adventure is chosen — inside the draft, inside whichever mode
                  is running. It is not a fourth card on the main menu. */}
              <div className="sos-map-mode" role="group" aria-label="Game mode">
                {/* No visible label here: the heading above already says "Choose
                    game mode", and saying it twice in adjacent sizes reads as a
                    mistake. The aria-label stays for screen readers, who get the
                    group's purpose without a second visible string. */}
                <div className="sos-map-mode-options">
                  {MAP_MODES.map((mode) => {
                    const active = (state.mapMode ?? 'CLASSIC') === mode;
                    const meta = MAP_MODE_META[mode];
                    return (
                      <button
                        key={mode}
                        type="button"
                        className={`sos-map-mode-btn${active ? ' is-active' : ''}`}
                        aria-pressed={active}
                        onClick={() => {
                          playSfx('select');
                          dispatch({ type: 'SET_MAP_MODE', mapMode: mode });
                        }}
                      >
                        {/*
                            `tagline` is decoration for sighted players, but
                            "coming soon" is load-bearing information rather than
                            flavour, so it is announced instead of hidden.
                        */}
                        <strong>{meta.name}</strong>
                        <span className="sos-map-mode-tagline" aria-hidden="true">
                          {meta.tagline}
                        </span>
                        <span className="sos-map-mode-blurb">{meta.blurb}</span>
                        {meta.upcoming && <span className="sos-mode-upcoming">In development</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* The faction question, now second — and below its own heading,
                  because "Choose your faction" is still worth saying. It just is
                  not what the screen opens with any more. */}
              <h3 id="sos-faction-title" className="sos-draft-subtitle">
                Choose your faction
              </h3>
              <p className="sos-draft-lead">
                {mode === 'hotseat'
                  ? `${playerLabels[state.activePlayerId] ?? 'Next player'} chooses. The other faction goes to their rival.`
                  : state.activePlayerId === humanId
                    ? 'Choose your side. Your rival will take the other faction.'
                    : `Waiting for ${playerLabels[state.activePlayerId] ?? 'your rival'} to choose first…`}
              </p>
              {(() => {
                const faction = activeDraftFaction;
                const meta = FACTION_META[faction];
                const takenBy = Object.entries(state.factions).find(([, value]) => value === faction)?.[0];
                const canChoose = !takenBy && (isLocalDuel || state.activePlayerId === humanId);
                const moveFaction = (direction: number) => {
                  const current = FACTIONS.indexOf(faction);
                  for (let step = 1; step <= FACTIONS.length; step += 1) {
                    const candidate = FACTIONS[(current + direction * step + FACTIONS.length) % FACTIONS.length];
                    setDraftFaction(candidate);
                    return;
                  }
                };
                return (
                  <div className="sos-faction-carousel" aria-label="Faction squad carousel">
                    <button type="button" className="sos-faction-arrow" aria-label="Previous faction" onClick={() => moveFaction(-1)}>‹</button>
                    <div className="sos-faction-carousel-card" aria-live="polite">
                      <span className="sos-faction-portrait" aria-label={`${draftedSquad.length} drafted units`}>
                        {draftedSquad.map((type, index) => (
                          <i key={`${type}-${index}`} title={CLASS_META[type].label} aria-label={CLASS_META[type].label}
                            style={{ backgroundImage: `url('${publicAsset(`/sprites/sos-${meta.skins[type]}/sprite-sheet-alpha.png`)}')` }} />
                        ))}
                      </span>
                      <div className="sos-faction-carousel-head">
                        <div>
                          <strong className="sos-faction-name">{meta.name}</strong>
                          <span className="sos-faction-subtitle">{meta.subtitle}</span>
                        </div>
                      </div>
                      <p className="sos-faction-lore">{meta.lore}</p>
                      {takenBy && <span className="sos-faction-taken">Taken by {playerLabels[takenBy] ?? 'your rival'}</span>}
                      <span className="sos-faction-carousel-index">{FACTIONS.indexOf(faction) + 1} / {FACTIONS.length}</span>
                    </div>
                    <button type="button" className="sos-faction-arrow" aria-label="Next faction" onClick={() => moveFaction(1)}>›</button>
                    {!canChoose && <span className="sos-faction-lock-hint">{takenBy ? 'Faction already chosen' : 'Waiting for your rival'}</span>}
                  </div>
                );
              })()}
            {/*
              One panel for the whole draft: heading, squad slots, the three
              actions, the faction readout and the nine class cards.

              These were three stacked boxes (a squad box, a status line and the
              roster) with a gap between each, which is where the dead vertical
              space under the faction cards came from. One card, one border, one
              scroll target.
            */}
            <div className="sos-draft-squad">
              <div className="sos-draft-squad-head">
                <h3 className="sos-draft-squad-title">
                  Drafting squad for {FACTION_META[activeDraftFaction].name} ({draftedSquad.length}/4)
                </h3>
              </div>

              <div className="sos-draft-squad-actions">
                    <button
                      type="button"
                      className="sos-draft-btn"
                      onClick={() => {
                        updateDraftedSquad(activeDraftFaction, randomDraftSquad());
                      }}
                    >
                      Randomize Squad
                    </button>
                  <button
                      type="button"
                      className={`sos-draft-btn is-primary${draftedSquad.length === 4 ? ' is-complete' : ''}`}
                      disabled={draftedSquad.length !== 4
                        || (!isLocalDuel && (Object.values(state.factions).includes(activeDraftFaction) || state.activePlayerId !== humanId))}
                      onClick={() => {
                        dispatch({ type: 'CHOOSE_FACTION', faction: activeDraftFaction, squad: draftedSquad });
                        setDraftFaction(FACTIONS.find((faction) => faction !== activeDraftFaction) ?? null);
                      }}
                    >
                      Confirm Squad ({draftedSquad.length}/4)
                    </button>
              </div>

              <div className="sos-faction-status" aria-live="polite">
                {Object.entries(state.factions).map(([playerId, faction]) => (
                  <span key={playerId}>{playerLabels[playerId] ?? 'Player'}: {FACTION_META[faction].name}</span>
                ))}
              </div>

              {/*
                The squad showcase, moved off the title screen.

                It used to sit under the mode buttons, where it was four more
                things competing with the artwork and told you about your squad
                before you had chosen a mode. Here the match is already committed
                and a squad is the only thing still worth thinking about, so this is
                the one screen where the four classes earn the space.
              */}
              <div className="sos-roster">
                {(['WARRIOR', 'WIZARD', 'CLERIC', 'RANGER', 'PALADIN', 'BARD', 'WARLOCK', 'DRUID', 'ROGUE'] as PlayerClass[]).map((type) => {
                  const count = draftedSquad.filter((c) => c === type).length;
                  return (
                    <button
                      key={type}
                      type="button"
                      className={`sos-roster-item${count > 0 ? ' is-selected' : ''}`}
                      aria-pressed={count > 0}
                      disabled={(count === 0 && draftedSquad.length >= 4)
                        || (!isLocalDuel && (Object.values(state.factions).includes(activeDraftFaction) || state.activePlayerId !== humanId))}
                      onClick={() => {
                        const nextSquad = count > 0
                          ? draftedSquad.filter((unitType, index) => unitType !== type || index !== draftedSquad.lastIndexOf(type))
                          : [...draftedSquad, type];
                        updateDraftedSquad(activeDraftFaction, nextSquad);
                      }}
                    >
                      <ClassIcon type={type} size={20} />
                      <div>
                        <strong style={{ color: CLASS_META[type].color }}>{CLASS_META[type].label}</strong>
                        <p>{CLASS_META[type].blurb}</p>
                      </div>
                      {count > 0 && <span className="sos-roster-count">x{count}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            {/*
              No "Leave match" button here.

              The draft already has a back arrow in the top bar that returns to
              the SoS menu (and, online, leaves the room properly), so a second
              control for the same action sat directly under the roster and
              competed with the faction cards that are the actual decision on
              this screen. One way out, in the place the eye already looks.
            */}
          </section>
        ) : (
        <div className="sos-board-layout">
          <div className="sos-sidebar">
            {/* Left rail: squad shortcuts on top, then the selected character's stats and
                full spell list. */}
            <div className="sos-rail-left">
            <div className="sos-panel sos-squad-panel sos-slot-squad">
              <div className="sos-log-header">
                <h3 className="sos-panel-title">Squad Shortcuts</h3>
                <span className="sos-squad-ready">
                  {
                    squadUnits.filter(
                      (u) =>
                        u.stats.currentHp > 0 &&
                        !isFrozen(state, u) &&
                        (!u.hasMoved || !u.hasAttacked),
                    ).length
                  }{' '}
                  ready
                </span>
              </div>
              <div className="sos-squad-bar" role="group" aria-label="Quick select unused squad units">
                {squadUnits.map((u) => {
                  const dead = u.stats.currentHp <= 0;
                  const frozen = !dead && isFrozen(state, u);
                  const spent = !dead && !frozen && u.hasMoved && u.hasAttacked;
                  const unavailable = dead || frozen || spent || !isPlayableTurn;
                  const active = selectedUnitId === u.id;
                  const meta = CLASS_META[u.type];
                  return (
                    <button
                      key={u.id}
                      type="button"
                      // The class colour is exposed as a variable so the selected
                      // glow can match the unit instead of being one hardcoded
                      // blue for all four classes.
                      style={{ '--squad-color': meta.color } as CSSProperties}
                      className={[
                        'sos-squad-btn',
                        active ? 'is-selected' : '',
                        spent || dead || frozen ? 'is-done' : 'is-ready',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      disabled={unavailable}
                      title={
                        dead
                          ? `${meta.label} — Defeated`
                          : frozen
                            ? `${meta.label} — Frozen in ice`
                            : spent
                              ? `${meta.label} — Turn complete (Move & Act used)`
                              : `Select ${meta.label} (${!u.hasMoved ? 'Move' : ''}${
                                  !u.hasMoved && !u.hasAttacked ? ' + ' : ''
                                }${!u.hasAttacked ? 'Act' : ''} ready)`
                      }
                      onClick={() => selectAndFocus(u)}
                    >
                      {/*
                        The class icon, not a sprite thumbnail. The atlas is a
                        27-frame strip, so a 20px thumbnail was showing frame 0
                        scaled down to a shape nobody could name. `ClassIcon` is
                        already colour-coded per class, which is what makes four
                        of them tellable at a glance.
                      */}
                      <span className="sos-squad-icon">
                        <ClassIcon type={u.type} size={22} />
                      </span>
                      {/* Act first, then Move — the order the turn resolves in,
                          so reading left to right matches what happens next. */}
                      <span className="sos-squad-state">
                        {dead ? (
                          'KO'
                        ) : frozen ? (
                          'ICE'
                        ) : spent ? (
                          'DONE'
                        ) : (
                          <>
                            <i
                              className={`sos-pip${u.hasAttacked ? ' is-spent' : ''}`}
                              title={u.hasAttacked ? 'Act used' : 'Act ready'}
                            />
                            <i
                              className={`sos-pip${u.hasMoved ? ' is-spent' : ''}`}
                              title={u.hasMoved ? 'Move used' : 'Move ready'}
                            />
                          </>
                        )}
                      </span>
                      {/* Pinned to the bottom edge, spanning the card. */}
                      <span className="sos-squad-hp">
                        <i
                          style={{
                            width: `${Math.max(0, (u.stats.currentHp / u.stats.maxHp) * 100)}%`,
                          }}
                        />
                      </span>
                    </button>
                  );
                })}
                {/*
                  The way into free navigation, as the fifth card so the strip is
                  five equal squares. With a unit selected it drops the selection
                  and swaps the panel for the live minimap; while already free it
                  re-centres the camera on the active unit.
                */}
                <button
                  type="button"
                  className={`sos-squad-btn sos-free-nav-btn${isFreeNav ? ' is-selected' : ''}`}
                  aria-pressed={isFreeNav}
                  aria-label={
                    selectedUnit
                      ? 'Deselect and open the minimap free-camera view'
                      : 'Free navigation active. Re-centre the camera on the active unit.'
                  }
                  title={
                    selectedUnit
                      ? 'Deselect and open the minimap free-camera view'
                      : 'Free navigation active — re-centre on the active unit'
                  }
                  onClick={toggleFreeNav}
                >
                  <span className="sos-squad-icon">
                    <MapIcon size={22} aria-hidden="true" />
                  </span>
                  <span className="sos-squad-state">Free</span>
                </button>
              </div>
            </div>

            <div className="sos-panel sos-slot-unit">
              {/*
                The tactical-map header carries the size selector, so the window
                can be changed where the map is being described rather than from
                a corner of the grid or a popover over the board.
              */}
              <div className="sos-panel-head">
                <h3 className="sos-panel-title">
                  {selectedUnit ? 'Selected unit' : 'Tactical map'}
                </h3>
                {/*
                  Always shown, not just when the panel reads "Tactical map":
                  the window is something you resize mid-turn, with a unit
                  selected, and hiding it there is how a control becomes
                  unreachable exactly when it is wanted.
                */}
                <div className="sos-map-size" role="group" aria-label="Tactical unit view size">
                  <label className="sos-map-size-readout" htmlFor="sos-unit-range">
                    UNIT: <output htmlFor="sos-unit-range">[ {boardViewSize} ]</output>
                  </label>
                  <input
                    id="sos-unit-range"
                    className="sos-unit-range"
                    type="range"
                    min={3}
                    max={11}
                    step={1}
                    value={boardViewSize}
                    aria-label="Tactical unit view size"
                    aria-valuetext={`${boardViewSize} by ${boardViewSize} tactical view`}
                    onChange={(event) => chooseBoardViewSize(event.currentTarget.valueAsNumber as BoardViewSize)}
                  />
                  {manualViewOrigin && (
                    <button
                      type="button"
                      className="sos-map-size-btn is-recentre"
                      aria-label="Re-centre the camera on the focused unit"
                      title="Re-centre on unit"
                      onClick={() => recentreBoard()}
                    >
                      <Crosshair size={11} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
              {selectedUnit ? (
                <div className="sos-selected">
                  <div className="sos-selected-head">
                    <ClassIcon type={selectedUnit.type} size={22} />
                    <strong style={{ color: CLASS_META[selectedUnit.type].color }}>
                      {CLASS_META[selectedUnit.type].label}
                    </strong>
                  </div>
                  <div className="sos-hpbar">
                    <div
                      className="sos-hpbar-fill"
                      style={{
                        width: `${(selectedUnit.stats.currentHp / selectedUnit.stats.maxHp) * 100}%`,
                        background: CLASS_META[selectedUnit.type].color,
                      }}
                    />
                  </div>
                  <p className="sos-stat">HP {selectedUnit.stats.currentHp} / {selectedUnit.stats.maxHp}</p>
                    <p className="sos-stat">
                      Move {selectedUnit.stats.moveReach} · Range {selectedUnit.stats.attackRange}
                      {selectedUnit.type === 'WIZARD' ? ' (diagonals cost 2)' : ''} · DMG{' '}
                      {selectedUnit.type === 'RANGER'
                        ? `${RANGER_ATTACK.minDamage}–${RANGER_ATTACK.maxDamage}`
                        : selectedUnit.stats.attackDamage}
                    </p>
                  <p className="sos-stat sos-stat-muted">
                    {selectedUnit.hasMoved ? 'Moved' : 'Can move'} · {selectedUnit.hasAttacked ? 'Acted' : 'Can act'}
                  </p>
                  {selectedGuard && (
                    <p className="sos-stat sos-stat-guard">
                      <Shield size={12} aria-hidden="true" /> Shielded by{' '}
                      {CLASS_META[selectedGuard.type].label}
                    </p>
                  )}
                  {selectedUnit.guardingUnitId && (
                    <p className="sos-stat sos-stat-guard">
                      <Shield size={12} aria-hidden="true" /> Guarding an ally
                    </p>
                  )}
                  {isFrozen(state, selectedUnit) && (
                    <p className="sos-stat sos-stat-frozen">
                      <Snowflake size={12} aria-hidden="true" /> Frozen in ice — cannot move or act until the ice melts
                    </p>
                  )}
                  {(selectedUnit.rootedTurns ?? 0) > 0 && (
                    <p className="sos-stat sos-stat-rooted">
                      <Anchor size={12} aria-hidden="true" /> Rooted by a trap ({selectedUnit.rootedTurns}t)
                    </p>
                  )}
                  {(selectedUnit.stunnedTurns ?? 0) > 0 && (
                    <p className="sos-stat sos-stat-stunned">
                      <Sparkles size={12} aria-hidden="true" /> Stunned ({selectedUnit.stunnedTurns}t)
                    </p>
                  )}

                  {unitTurnComplete && (
                    <div className="sos-unit-done-banner" role="status">
                      <span className="sos-status-pill is-complete">Unit Turn Complete</span>
                      <span className="sos-unit-done-hint">Pick an unused ally above</span>
                    </div>
                  )}

                  {/* Status reads as engraved text, not system emoji. Both points
                      are tracked independently so the player can see exactly
                      which half of the turn is still open. */}
                  {(selectedUnit.hasMoved || selectedUnit.hasAttacked || !!selectedUnit.stunnedTurns) && (
                    <div className="sos-status-row" role="status" aria-live="polite">
                      {selectedUnit.hasMoved && <span className="sos-status-pill">Moved</span>}
                      {selectedUnit.hasAttacked && (
                        <span className="sos-status-pill is-spent">Action Spent</span>
                      )}
                      {!!selectedUnit.stunnedTurns && (
                        <span className="sos-status-pill is-spent">Action Stunned</span>
                      )}
                    </div>
                  )}

                  {/* One unified list: every point a unit can spend this turn, each
                      row showing what it does. Move and every action are listed at
                      the same time and enabled independently, so the player may
                      act first and walk after — or walk first and act after.
                      Selecting a row is how you choose what a board click means;
                      it never spends the other point. */}
                  <ul className="sos-skills">
                    <li key="move">
                      <button
                        type="button"
                        data-action="move"
                        className={`sos-skill${aimMode === 'move' ? ' is-active' : ''}${!unitCanMove ? ' is-spent' : ''}`}
                        disabled={!unitCanMove}
                        aria-pressed={aimMode === 'move'}
                        onClick={() => {
                          playSfx('select');
                          setAimMode('move');
                          setArmedAbility(null);
                          setPreviewTarget(null);
                        }}
                      >
                        <span className="sos-skill-icon">
                          <img
                            className="sos-ability-icon"
                            src={publicAsset('/sprites/sos-pixellab/icon-move/sprite-sheet-alpha.png')}
                            alt=""
                            aria-hidden="true"
                          />
                        </span>
                        <span className="sos-skill-text">
                          <span className="sos-skill-label">Move</span>
                          <span className="sos-skill-detail">
                            {unitCanMove
                              ? `Up to ${selectedUnit.stats.moveReach} tiles — before or after acting.`
                              : 'Move used this turn.'}
                          </span>
                        </span>
                      </button>
                    </li>
                    {ACT_CHOICES[selectedUnit.type].map((choice) => {
                      const active = actChoice === choice && aimMode === 'action';
                      // One action per unit per turn, no exemptions: once a
                      // unit has acted, every row here greys out, Guard
                      // included. The engine enforces the same rule. A basic
                      // action also greys while a spell is armed, so an aimed
                      // cast cannot be swapped for a swing by accident.
                      const spent = !unitCanAct || armedAbility !== null;
                      return (
                        <li key={choice}>
                          <button
                            type="button"
                            data-action={choice}
                            className={`sos-skill${active ? ' is-active' : ''}${spent ? ' is-spent' : ''}`}
                            disabled={spent}
                            aria-pressed={active}
                            onClick={() => {
                              playSfx('select');
                              setAimMode('action');
                              setActChoice(choice);
                              setPreviewTarget(null);
                            }}
                          >
                            <span className="sos-skill-icon">
                              <ActGlyph choice={choice} unitType={selectedUnit.type} />
                            </span>
                            <span className="sos-skill-text">
                              <span className="sos-skill-label">{ACT_LABEL[choice]}</span>
                              <span className="sos-skill-detail">
                                {actDescription(choice, selectedUnit)}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                    {CLASS_ABILITIES[selectedUnit.type].map((ability) => (
                      <li key={ability.id}>
                        <button
                          type="button"
                          data-action={ability.id}
                          className={`sos-skill${armedAbility === ability.id ? ' is-active' : ''}${!unitCanAct ? ' is-spent' : ''}`}
                          // Grey out once the action is spent. Note what is NOT here:
                          // the old rule also locked every OTHER row while a
                          // spell was armed, so the only way to change your
                          // mind was to cancel first and then pick again — two
                          // clicks to fix a misclick, and the "switch spell"
                          // gesture simply did not exist. Arming is free and
                          // costs nothing until the board click commits it, so
                          // switching straight across is strictly safer than
                          // leaving the player on a spell they cannot undo.
                          // Clicking the armed row still cancels it.
                          disabled={!unitCanAct}
                          aria-pressed={armedAbility === ability.id}
                          onClick={() => {
                            playSfx('select');
                            setAimMode('action');
                            setArmedAbility(armedAbility === ability.id ? null : ability.id);
                            setPreviewTarget(null);
                          }}
                        >
                          <span className="sos-skill-icon">
                            {ABILITY_ICON[ability.id] ? (
                              <img
                                className="sos-ability-icon"
                                src={ABILITY_ICON[ability.id]}
                                alt=""
                                aria-hidden="true"
                              />
                            ) : (
                              <IconOf id={ability.id} />
                            )}
                          </span>
                          <span className="sos-skill-text">
                            <span className="sos-skill-label">{ability.label}</span>
                            <span className="sos-skill-detail">{abilityDescription(ability.id)}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <SosMinimap
                  state={state}
                  view={boardView}
                  squadOwnerId={isLocalDuel ? state.activePlayerId : humanId}
                  isAdventure={isAdventure}
                  unitColors={CLASS_COLORS}
                  onNavigate={navigateFromMinimap}
                />
              )}

              {/* Sits at the foot of the panel, not pinned to the bottom of the
                  rail: `margin-top: auto` was pushing it away from the unit it
                  belongs to and leaving it stranded under empty space.

                  The confirmation expands INLINE, under the button. A dialog was
                  tried twice and was worse both times: it covered the board and
                  the unit being acted for, and the cost you needed in order to
                  weigh — units that haven't moved forfeit the rest of their turn
                  — was behind the very thing it was warning you about. */}
              <div className="sos-end-block sos-slot-end">
                {/* Countdown strip. `role="status"` so it is announced once per
                    second change rather than dumped on every tick. */}
                {autoEndArmed && (
                  <p className="sos-end-auto" role="status">
                    All living units have spent move and action — ending the turn in{' '}
                    {Math.min(autoEnd.remaining, AUTO_END_SECONDS)}s
                  </p>
                )}
                <button
                  type="button"
                  className="primary-button sos-end-turn"
                  aria-expanded={confirmEndTurn}
                  disabled={!isPlayableTurn || state.phase !== 'playing'}
                  onClick={() => setConfirmEndTurn((open) => !open)}
                >
                  {confirmEndTurn ? 'Cancel' : 'End Turn'}
                </button>
                {confirmEndTurn && (
                  <div className="sos-end-confirm">
                    <p className="sos-end-confirm-text">
                      No unit will take any further action. Any unused moves or actions
                      are forfeited.
                    </p>
                    <div className="sos-end-confirm-actions">
                      <button
                        type="button"
                        className="primary-button btn-purple"
                        onClick={() => {
                          setConfirmEndTurn(false);
                          dispatch({ type: 'END_TURN' });
                          selectUnit(null);
                        }}
                      >
                        Confirm End Turn
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {error && (
              <button type="button" className="sos-error" onClick={clearError}>
                {error} — dismiss
              </button>
            )}
            </div>

            {/* Right rail: Battle Chronicle over chat, split half and half. They
                are separate elements so they need a shared flex parent to divide
                the column — as loose grid items they would both claim `right`
                and overlap. */}
            <div className={`sos-rail-right${railFolded ? ' is-folded' : ''}`}>
            <div className="sos-panel sos-log-panel sos-slot-log">
              <div className="sos-log-header">
                <h3 className="sos-panel-title">Battle Chronicle</h3>
                {combatLog.length > 0 && (
                  <span className="sos-log-count">{combatLog.length}</span>
                )}
                <button
                  type="button"
                  className="sos-rail-fold"
                  onClick={() => setRailFolded((f) => !f)}
                  aria-expanded={!railFolded}
                  aria-label={railFolded ? 'Show the battle chronicle' : 'Collapse the battle chronicle'}
                  title={railFolded ? 'Show' : 'Collapse'}
                >
                  {railFolded ? (
                    <ChevronsDown size={16} aria-hidden="true" />
                  ) : (
                    <ChevronsRight size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
              <div className="sos-combat-log" role="log" aria-live="polite" aria-label="Combat action log">
                {combatLog.length === 0 ? (
                  <p className="sos-log-empty">No blood spilled yet. Select a unit to act.</p>
                ) : (
                  [...combatLog].reverse().map((entry) => (
                    <div key={entry.id} className={`sos-log-row is-${entry.kind}`}>
                      <span className="sos-log-turn">T{entry.turn}</span>
                      {entry.icon && (
                        <img
                          className="sos-log-icon"
                          src={entry.icon}
                          alt=""
                          aria-hidden="true"
                        />
                      )}
                      <span className="sos-log-text">{entry.text}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="sos-chronicle-controls">
                {renderBrandControls()}
                {renderSoundControl()}
              </div>
            </div>

            {/* Chat only exists in Online Duel — there is nobody to talk to in a solo
                or hotseat game, so the box is not shown at all. */}
            {mode === 'online' && isOnline && (
              <div className="sos-chat">
                <div className="sos-chat-log" aria-live="polite">
                  {!isOnline ? (
                    <span className="sos-chat-line">Connecting to chat…</span>
                  ) : chatLog.length === 0 ? (
                    <span className="sos-chat-line">No messages yet.</span>
                  ) : (
                    chatLog.map((line, i) => (
                      <span className="sos-chat-line" key={`${i}-${line.text}`}>
                        <strong>{line.from}:</strong> {line.text}
                      </span>
                    ))
                  )}
                </div>
                <form className="sos-chat-form" onSubmit={sendChat}>
                  <input
                    className="form-input"
                    value={chatDraft}
                    maxLength={160}
                    placeholder="Say something…"
                    aria-label="Chat message"
                    onChange={(e) => setChatDraft(e.target.value)}
                  />
                  <button type="submit" className="ghost-button" disabled={!chatDraft.trim() || !isOnline}>
                    Send
                  </button>
                </form>
              </div>
            )}
            </div>
          </div>

          <div className="sos-board-wrap">
            {previewAbility && (
              <p className="sos-aim-preview-hint" role="status">
                Highlighted tiles are in range. Hover one to light up exactly where the effect lands; click to use the skill.
              </p>
            )}
            {/* Size container for the board. Kept separate from the wrap so the
                action banner does not count against the height the board may use
                — `container-type: size` ignores contents, so if the banner were
                inside, the board would grow to 100cqh and cover it.

                `--sos-board-cols/rows` are written HERE rather than on the board,
                because the frame needs them to size itself to the grid's shape.
                They inherit down to the board, which uses them for its own
                `aspect-ratio`, so nothing can disagree about how many tiles
                there are. */}
            <div
              className="sos-board-frame"
              style={
                {
                  '--sos-board-cols': String(boardView.cols),
                  '--sos-board-rows': String(boardView.rows),
                } as CSSProperties
              }
            >
            <div
              className={`sos-board${boardShake ? ` is-shaking-${boardShake.seq % 2}` : ''}${hitStop ? ' is-hitstop' : ''}${aimMode === 'action' || previewAbility !== null ? ' is-targeting' : ''}${canPanBoard ? ' is-pannable' : ''}${isFreeNav ? ' is-free-nav' : ''}`}
              onPointerDown={handleBoardPointerDown}
              onPointerMove={handleBoardPointerMove}
              onPointerUp={(event) => releaseBoardDrag(event, false)}
              onPointerCancel={(event) => releaseBoardDrag(event, true)}
              onClickCapture={(event) => {
                if (!suppressBoardClickRef.current) return;
                event.preventDefault();
                event.stopPropagation();
                suppressBoardClickRef.current = false;
              }}
              style={
                {
                  gridTemplateColumns: `repeat(${boardView.cols}, minmax(0, 1fr))`,
                  /*
                   * Explicit rows, not `grid-auto-rows`.
                   *
                   * Auto rows take their height from each cell's `aspect-ratio`
                   * content. On the 12x10 arena the padding and gutters make that
                   * content a couple of pixels taller than the aspect-ratio box,
                   * so the last row overflowed the board and was clipped by the
                   * stage. A bounded 1fr track forces every row to share the
                   * height the board actually has; the board's own aspect-ratio
                   * keeps the tracks square.
                   */
                  gridTemplateRows: `repeat(${boardView.rows}, minmax(0, 1fr))`,
                  // `--sos-board-cols/rows` are inherited from `.sos-board-frame`
                  // (see the note there), so the frame can size itself to this
                  // grid's shape and the aspect ratio can never drift from the
                  // columns actually laid out. These describe the selected camera
                  // window, not the full 12x10 / 20x20 floor behind it.
                  ...(boardShake
                    ? {
                        '--shake-dx': String(boardShake.dx),
                        '--shake-dy': String(boardShake.dy),
                        '--shake-amp': `${boardShake.amp}px`,
                        '--shake-dur': `${boardShake.durMs}ms`,
                      }
                    : {}),
                } as CSSProperties
              }
            >
              {Array.from({ length: boardView.rows }).map((_, row) =>
                Array.from({ length: boardView.cols }).map((__, col) => {
                  // Adventure draws a window onto a bigger floor; the offsets do
                  // nothing on a duel, where the window is the whole board.
                  const x = boardView.originX + col;
                  const y = boardView.originY + row;
                  const pos = { x, y };
                  const key = positionKey(pos);
                  /*
                   * Outside the floor.
                   *
                   * `cameraWindowFromOrigin` clamps the window, so a correctly
                   * framed camera should never produce one of these. The branch is
                   * kept as a defensive guard: if an origin ever escapes, drawing
                   * the tile as ordinary floor would let the player aim at a
                   * coordinate the engine treats as off-board.
                   */
                  if (
                    x < 0 || y < 0 ||
                    x >= state.boardSize.width || y >= state.boardSize.height
                  ) {
                    return <span key={key} className="sos-cell is-void" aria-hidden="true" />;
                  }
                  const wall = state.terrain.get(key) === 'WALL';
                  const unit = unitAt(state, pos);
                  const isMove = moveKeys.has(key);
                  const isAttack = !!unit && attackIds.has(unit.id);
                  const isHeal = !!unit && healIds.has(unit.id);
                  const isGuard = !!unit && guardIds.has(unit.id);
                  // Blessed ground tints the tiles themselves, so the ground reads as
                  // holy rather than just carrying a badge.
                  //
                  // One treatment for every zone, yours and your rival's alike: a
                  // red cross for the opponent's cast told the player nothing
                  // that the white-yellow one does not, and read as damage —
                  // the same misreading that made the old blast preview wrong.
                  // Whoever owns it is still legible from the badge on the units
                  // standing in it.
                  const isHoly = holyTiles.has(key);
                  const hasIceWall = state.iceWalls.some((ice) => ice.x === x && ice.y === y);
                  const isSelected = !!unit && unit.id === selectedUnitId;
                  // In adventure the other player's squad is an ALLY — they share a fate and a
              // fate line — so "enemy" collapses to "monster". Everywhere else the
              // previous reading stands.
              const isEnemy = !!unit && (isAdventure
                ? unit.ownerId === MONSTER_TEAM_ID
                : unit.ownerId !== humanId);
                  /*
                   * Three groups have to be told apart at a glance in Adventure:
                   * your own squad, the other player's squad, and the monsters.
                   * A binary ally/enemy split collapses the first two into the
                   * same colour and leaves the monsters sharing the class ring
                   * with everything else — so three classes, one per group.
                   *
                   * A duel only has two groups and keeps the old pair.
                   */
                  const isMonster = !!unit && unit.ownerId === MONSTER_TEAM_ID;
                  const isPartner = !!unit && !isMonster && unit.ownerId !== humanId;
                  const teamClass = isAdventure
                    ? isMonster ? 'is-monster' : isPartner ? 'is-partner' : 'is-ally'
                    : isEnemy ? 'is-enemy' : 'is-ally';
                  const meta = unit ? CLASS_META[unit.type] : null;

                  /*
                   * What this tile means right now.
                   *
                   * Ground layers (terrain, holy zone, team ownership on units)
                   * are painted underneath by theme.css. These marks are
                   * interaction only, and they are deliberately independent:
                   *
                   *   move     a tile the selected unit can still walk to. A
                   *            green edge, never a wash, so it can sit under an
                   *            action's range without fighting it.
                   *   range    every tile inside the selected action's reach.
                   *   target   a tile the click would resolve as that action
                   *            (enemy, ally under friendly fire, slam tile).
                   *   impact   the effect's hit zone at the hovered tile.
                   *   focus    the tile under the pointer (white outline).
                   *   pending  the staged action's tile (gold outline).
                   *   invalid  the last click that did nothing (slate flash).
                   */
                  const movementClaimedByAction =
                    aimMode === 'action' && (actChoice === 'ATTACK' || actChoice === 'SLAM');
                  const moveMark =
                    isPlayableTurn && unitCanMove && isMove &&
                    !previewAbility && !movementClaimedByAction;

                  // In action mode ATTACK claims every in-range non-stone tile,
                  // allies included: the engine allows a ground shot at any of
                  // them. In move mode only enemy units are targets and a bare
                  // tile is a move. This is exactly what the click handler
                  // resolves, so the paint can never promise a different action.
                  const actionTileTarget =
                    isPlayableTurn && actChoice === 'ATTACK' && aimMode === 'action' &&
                    rangerShotKeys.has(key);
                  const slamTarget =
                    isPlayableTurn && unitCanAct && actChoice === 'SLAM' &&
                    aimMode === 'action' && slamKeys.has(key);

                  let range: CellRange | undefined;
                  let target = false;
                  if (isPlayableTurn && unitCanAct) {
                    if (aimMode === 'action') {
                      if (previewAbility) {
                        if (abilityTargets.has(key)) range = 'spell';
                      } else if (actChoice === 'ATTACK') {
                        // Stone is never a ground-shot target, and painting it
                        // as reach made a wall look attackable and then refuse
                        // the click. Wall-cracking lives in Slam and Grapple.
                        if (attackReach.has(key) && !wall) range = 'attack';
                        target = isAttack || actionTileTarget;
                      } else if (actChoice === 'HEAL') {
                        if (isHeal) { range = 'heal'; target = true; }
                      } else if (actChoice === 'GUARD') {
                        if (isGuard) { range = 'guard'; target = true; }
                      } else if (actChoice === 'SLAM') {
                        if (slamTarget) { range = 'attack'; target = true; }
                      }
                    }
                    // An enemy in reach is a one-click attack even while Move
                    // owns the board, so it keeps its target rim. It does NOT
                    // drag the whole attack range back onto a movement-focused
                    // board: only the legal unit is marked, not the area.
                    if (!previewAbility && actChoice === 'ATTACK' && isAttack) target = true;
                  }

                  const impact = abilityBlast.has(key) ? impactKind ?? undefined : undefined;
                  const hovered = previewTarget?.x === x && previewTarget?.y === y;
                  // In free nav the board is a map, so the hover frame is the only
                  // thing telling the player which tile a click will centre on.
                  const focus =
                    hovered &&
                    (isFreeNav || (
                      isPlayableTurn && (moveMark || range !== undefined || target)
                    ));
                  const pending =
                    pendingConfirm?.at.x === x && pendingConfirm.at.y === y;
                  const invalid = invalidCell === key;
                  const mark: CellMark = {
                    move: moveMark || undefined,
                    range,
                    target: target || undefined,
                    impact,
                    focus: focus || pending || undefined,
                    pending: pending || undefined,
                    invalid: invalid || undefined,
                  };
                  /*
                   * The altar is drawn as one 64x64 monument split across its
                   * four tiles: each cell shows its own quadrant of the same
                   * image, so the block reads as one object without an overlay
                   * layer that would have to track the camera window.
                   *
                   * Its two halves do NOT paint the same ground. The top row is
                   * the stone face the shrine is cut into; the bottom row is the
                   * plinth it stands on, so it draws the same floor as its
                   * neighbours and the sprite's base sits ON the slab.
                   *
                   * Collision never follows the paint: all four tiles stay WALL
                   * in `terrain`, which is what keeps them impassable and opaque
                   * to line of sight. Only the texture changes.
                   */
                  const altarQuad = altarQuads.get(key) ?? null;
                  const isAltar = altarQuad !== null;
                  const altarPlinth = altarQuad?.row === 1;
                  const altarSprite = altarQuad ? altarSpriteForSite[altarQuad.site] : null;
                  // What this tile DRAWS, as opposed to what it IS. The plinth
                  // is stone for the rules and floor for the eye.
                  const rendersStone = wall && !altarPlinth;
                  // The monument supplies its own silhouette, so its cells take
                  // no wall chrome: a recessed film and an exposed-edge rim on
                  // each would box a quarter of a statue.
                  const wallChrome = wall && !isAltar;
                  const wallActionable =
                    wall && (
                      (previewAbility !== null && abilityTargets.has(key)) ||
                      slamTarget ||
                      actionTileTarget ||
                      // The altar is a wall you talk to, not walk on. Clickable
                      // even while dormant, so the menu can say why.
                      (!!altarUnit && altarTileKeys.has(key))
                    );
                  const rangerAccuracy =
                    unit && isEnemy && selectedUnit?.type === 'RANGER' && attackIds.has(unit.id)
                      ? rangerAccuracyPercent(chebyshev(selectedUnit.position, unit.position))
                      : null;
                  /*
                   * The number the shot is actually rolled against.
                   *
                   * The engine rolls one accuracy check per arrow against the
                   * distance from the Ranger's CURRENT tile, so the preview has
                   * to use the same distance and only while the arrow is the
                   * armed action — anywhere else it would be a number about a
                   * shot the next click would not fire. The tile count is shown
                   * too: "80%" alone reads like a coin flip, "3 tiles · 80%"
                   * reads like a shot you chose to take.
                   */
                  const shotTip =
                    hovered &&
                    isPlayableTurn &&
                    unitCanAct &&
                    aimMode === 'action' &&
                    actChoice === 'ATTACK' &&
                    !previewAbility &&
                    selectedUnit?.type === 'RANGER' &&
                    (isAttack || actionTileTarget)
                      ? (() => {
                          const distance = chebyshev(selectedUnit.position, { x, y });
                          return { distance, percent: rangerAccuracyPercent(distance) };
                        })()
                      : null;
                  const tile = terrainTileFor(
                    state.terrain,
                    x,
                    y,
                    rendersStone,
                    state.boardSize.width,
                    state.boardSize.height,
                    state.mapSeed ?? 0,
                  );
                  // 0 is the flat-ground frame and 15 the solid stone one; the
                  // plinth asks for flat ground even though `terrain` says wall.
                  const wangIndex = usesWangTerrain
                    ? rendersStone ? wangTileIndexFor(state.terrain, x, y) : 0
                    : 0;
                  const tileIndex = usesWangTerrain ? wangIndex : TILE_INDEX[tile];
                  const tileColumn = usesWangTerrain ? wangIndex % 4 : tileIndex;
                  const tileRow = usesWangTerrain ? Math.floor(wangIndex / 4) : 0;
                  // Decoration dresses plain WALLS only. Enemy traps are redacted
                  // per client, so never use trap state to vary shared decoration.
                  // The altar's own tiles are skipped: its sprite covers them.
                  const dressed =
                    WALL_DRESSING && wall && !isAltar && !unit && !isHoly && !hasIceWall;
                  const decorIndex = dressed
                    ? wallDecorationForCell(state.gameId, state.mapSeed, x, y, terrainTheme, mapMode)
                    : null;
                  const altarIndex = dressed
                    ? altarDecorationForCell(state.gameId, state.mapSeed, x, y, mapMode)
                    : null;

                  /*
                   * Floor variation.
                   *
                   * The atlas has one honest flat floor frame per biome, so the
                   * tile itself cannot supply the variety a 9x9 window needs.
                   * These two deterministic layers do it without borrowing a
                   * raised Wang tile: a subtle tonal wash and a rare crack/stain
                   * decal. They are addressed by tile coordinates, exactly like
                   * the terrain sheet, so both online clients agree and a rerender
                   * never shuffles the floor under a unit.
                   */
                  const floorSeed = state.mapSeed ?? 0;
                  const floorTone = !rendersStone ? floorToneFor(x, y, floorSeed) : null;
                  const floorWear = !rendersStone ? floorWearFor(x, y, floorSeed) : 'none';
                  const floorToneIndex = !rendersStone ? floorToneIndexFor(x, y, floorSeed) : null;
                  const floorWearIndex = !rendersStone ? floorWearIndexFor(x, y, floorSeed) : null;

                  return (
                    <button
                      key={key}
                      type="button"
                      // Terrain comes from the generated sheet, so the board stops
                      // being CSS gradients that merely suggest stone.
                      style={
                        {
                          '--tile-index': tileIndex,
                          '--tile-cols': usesWangTerrain ? 4 : TILE_COLS,
                          '--tile-position': usesWangTerrain
                            ? `${(tileColumn / 3) * 100}% ${(tileRow / 3) * 100}%`
                            : undefined,
                          '--terrain-sheet-height': usesWangTerrain ? 'calc(100% * 4)' : '100%',
                          '--terrain-sheet': `url('${publicAsset(`/sprites/${terrainSheet}/sprite-sheet-alpha.png`)}')`,
                          '--decoration-image': decorIndex === null
                            ? 'none'
                            : `url('${publicAsset('/sprites/sos-ground-decor/sprite-sheet-alpha.png')}')`,
                          '--decoration-index': decorIndex ?? 0,
                          '--decoration-count': GROUND_DECORATION_COUNT,
                          '--altar-image': altarIndex === null
                            ? 'none'
                            : `url('${publicAsset('/sprites/sos-altar-decor/sprite-sheet-alpha.png')}')`,
                          '--altar-index': altarIndex ?? 0,
                          '--altar-count': ALTAR_DECORATION_COUNT,
                          ...(rendersStone
                            ? {}
                            : {
                                '--tint': floorTone,
                                '--floor-wear': floorWear,
                              }),
                        } as CSSProperties
                      }
                      className={[
                        'sos-cell',
                        // Wall chrome (stone film, exposed-edge rim) belongs to
                        // stone that is one tile wide. The altar's four cells draw
                        // their own monument instead; a rim on each would cut it
                        // into quarters.
                        wallChrome ? 'is-wall' : '',
                        // Which edges of this wall face open ground, so CSS only
                        // rims the EXPOSED sides. A cluster then reads as one mass
                        // instead of a grid of tiles each outlined in isolation.
                        wallChrome && !isWall(state, { x, y: y - 1 }) ? 'is-wall-open-up' : '',
                        wallChrome && !isWall(state, { x: x + 1, y }) ? 'is-wall-open-right' : '',
                        wallChrome && !isWall(state, { x, y: y + 1 }) ? 'is-wall-open-down' : '',
                        wallChrome && !isWall(state, { x: x - 1, y }) ? 'is-wall-open-left' : '',
                        // The floor side of the same contact. Walls cast a
                        // short, soft shadow onto the slab they meet, which is
                        // the border transition that makes the block read as
                        // sitting ON the floor rather than pasted over it.
                        !wall && state.terrain.has(positionKey({ x, y: y - 1 })) ? 'is-floor-wall-up' : '',
                        !wall && state.terrain.has(positionKey({ x: x + 1, y })) ? 'is-floor-wall-right' : '',
                        !wall && state.terrain.has(positionKey({ x, y: y + 1 })) ? 'is-floor-wall-down' : '',
                        !wall && state.terrain.has(positionKey({ x: x - 1, y })) ? 'is-floor-wall-left' : '',
                        /*
                          Highlights are DATA, not classes.

                          The button carries what the tile means (move / range /
                          target / impact / focus / pending / invalid) and CSS
                          paints each on its own pseudo-layer. This is what keeps
                          a wall's stone rim, a blessed floor and a range wash
                          from overwriting one another: no highlight is allowed
                          to set the cell's `background` or `box-shadow` any
                          more, so the terrain sheet stays intact.
                        */
                        isHoly ? 'is-holy' : '',
                        isAltar ? 'is-altar' : '',
                        // Which corner of the 2x2 this tile is. The glow is a
                        // property of the composite box, so each quadrant lights
                        // only the sides it shares with the outside world.
                        isAltar && altarQuad
                          ? `is-altar-q-${altarQuad.row === 0 ? 't' : 'b'}${altarQuad.col === 0 ? 'l' : 'r'}`
                          : '',
                        altarPlinth ? 'is-altar-plinth' : '',
                        isAltar && altarSouls > 0 ? 'is-altar-lit' : '',
                        isAltar && altarReady ? 'is-altar-ready' : '',
                      ].filter(Boolean).join(' ')}
                      data-move={mark.move || undefined}
                      data-range={mark.range}
                      data-target={mark.target || undefined}
                      data-impact={mark.impact}
                      data-focus={mark.focus || undefined}
                      data-pending={mark.pending || undefined}
                      data-invalid={mark.invalid || undefined}
                      data-floor-tone={floorToneIndex ?? undefined}
                      data-floor-wear={floorWearIndex ?? undefined}
                      onMouseEnter={() => setPreviewTarget({ x, y })}
                      onMouseLeave={() => setPreviewTarget(null)}
                      onFocus={() => setPreviewTarget({ x, y })}
                      onBlur={() => setPreviewTarget(null)}
                      onClick={() => handleCellClick(x, y)}
                      disabled={!isFreeNav && wall && !wallActionable}
                      aria-label={`Tile ${x},${y}${isFreeNav ? (unit ? ', select this unit' : ', centre camera here') : ''}${target ? ', action target' : ''}${impact ? ', impact preview' : ''}${isAltar ? `, Altar of Shadows (${altarSouls} souls)` : ''}`}
                    >
                      {altarQuad && altarSprite && (
                        <span
                          className="sos-altar-quad"
                          aria-hidden="true"
                          style={{
                            backgroundImage: `url('${altarSprite}')`,
                            backgroundPosition: `${altarQuad.col * 100}% ${altarQuad.row * 100}%`,
                          }}
                        />
                      )}
                      {isAltar && altarReady && altarPromptCell?.x === x && altarPromptCell?.y === y && (
                        // The count lives IN the orb: a number beside a labelled
                        // badge spends two lines of a 48px tile saying one thing,
                        // and "Altar" was the only word on the board nobody
                        // needed — the tiles underneath are the altar.
                        <span className="sos-altar-prompt" aria-hidden="true">
                          <i className="sos-altar-prompt-sigil">
                            <b>{altarSouls}</b>
                          </i>
                        </span>
                      )}
                      {unit && meta && (
                        <span
                          className={[
                            'sos-unit',
                            teamClass,
                            isSelected ? 'is-selected' : '',
                            unit.stats.currentHp <= 0 ? 'is-defeated' : '',
                            unit.hasMoved ? 'has-moved' : 'can-move',
                            unit.hasAttacked ? 'has-acted' : 'can-act',
                            (unit.rootedTurns ?? 0) > 0 ? 'is-rooted' : '',
                            (unit.stunnedTurns ?? 0) > 0 ? 'is-stunned' : '',
                            isFrozen(state, unit) ? 'is-frozen' : '',
                            reactionClass(unit.id),
                          ].filter(Boolean).join(' ')}
                          style={
                            {
                              '--class-color': meta.color,
                              // Lunge direction, in tile units, so the punch aims
                              // at the target rather than always to the right.
                              // Test BOTH axes: a purely vertical move has
                              // `dx === 0`, and the old truthiness check then
                              // dropped the whole reaction block, so the walk
                              // slide and vertical lunge silently did nothing.
                              ...(reactions[unit.id] &&
                              ((reactions[unit.id].dx ?? 0) !== 0 ||
                                (reactions[unit.id].dy ?? 0) !== 0)
                                ? {
                                    '--rx-dx': String(reactions[unit.id].dx ?? 0),
                                    '--rx-dy': String(reactions[unit.id].dy ?? 0),
                                    // How far to commit, and how long the swing
                                    // takes to reach full extension. The strike
                                    // lands at ~60% of this, which is tuned to
                                    // coincide with the impact delay.
                                    '--rx-lunge': String(reactions[unit.id].lunge ?? 0.12),
                                    '--rx-lunge-dur': `${Math.round(
                                      impactDelayFor(
                                        unit.position,
                                        {
                                          x: unit.position.x + (reactions[unit.id].dx ?? 0),
                                          y: unit.position.y + (reactions[unit.id].dy ?? 0),
                                        },
                                        unit.type,
                                      ) * 1.7,
                                    )}ms`,
                                    // Turn to face the blow. The sheets are drawn
                                    // one way, so a leftward attack mirrors rather
                                    // than swinging at empty air.
                                    '--rx-face': (reactions[unit.id].dx ?? 0) < 0 ? '-1' : '1',
                                    // Tiles covered, so the slide can be timed to
                                    // the distance rather than always taking the
                                    // same number of milliseconds.
                                    '--rx-steps': String(
                                      Math.max(
                                        1,
                                        Math.abs(reactions[unit.id].dx ?? 0) +
                                          Math.abs(reactions[unit.id].dy ?? 0),
                                      ),
                                    ),
                                  }
                                : {}),
                            } as CSSProperties
                          }
                          title={`${meta.label} · ${
                            // In adventure the other squad is an ally, not "yours",
                            // so name the owner there rather than collapsing both
                            // squads into one word.
                            isAdventure
                              ? playerLabels[unit.ownerId] ?? 'Unknown'
                              : isEnemy
                                ? playerLabels[unit.ownerId] ?? 'Enemy'
                                : 'Yours'
                          } · ${unit.stats.currentHp}/${unit.stats.maxHp} HP${
                            isFrozen(state, unit) ? ' · Frozen in ice' : ''
                          }${rangerAccuracy === null ? '' : ` · Ranger hit chance ${rangerAccuracy}%`}
                          `}
                          aria-label={`${meta.label}, ${
                            isAdventure
                              ? playerLabels[unit.ownerId] ?? 'unknown owner'
                              : isEnemy
                                ? 'enemy'
                                : 'yours'
                          }, ${unit.stats.currentHp} of ${unit.stats.maxHp} health, ${
                            unit.hasMoved ? 'already moved' : 'can move'
                          }, ${unit.hasAttacked ? 'already acted' : 'can act'}${
                            isFrozen(state, unit) ? ', frozen in ice' : ''
                          }${rangerAccuracy === null ? '' : `, Ranger accuracy ${rangerAccuracy}%`}`}
                        >
                          {/* The class atlas is one row of SPRITE_TOTAL frames. A
                              background, not an <img>: an <img> with object-fit
                              none renders at natural size pinned left, which is
                              what made the whole strip show off-centre. */}
                          <span
                            className={`sos-unit-sprite is-${spriteStateFor(unit, reactions[unit.id]?.kind ?? null)}`}
                            style={
                              {
                                '--sprite-total': SPRITE_TOTAL,
                                backgroundImage: `url('${publicAsset(`/sprites/sos-${skinForUnit(unit, state.factions)}/sprite-sheet-alpha.png`)}')`,
                              } as CSSProperties
                            }
                            aria-hidden="true"
                          />
                          <span className="sos-unit-team" aria-hidden="true">
                            {isEnemy ? '▼' : '▲'}
                          </span>
                          {unit.guardingUnitId && (
                            <span className="sos-unit-badge is-guard" title="Guarding an ally">
                              <Shield size={9} aria-hidden="true" />
                            </span>
                          )}
                          {guardOf(state, unit.id) && (
                            <span className="sos-unit-badge is-covered" title="Shielded by a Warrior">
                              <Shield size={9} aria-hidden="true" />
                            </span>
                          )}
                          {(unit.rootedTurns ?? 0) > 0 && (
                            <span className="sos-unit-badge is-rooted" title="Rooted by a trap">
                              <Anchor size={9} aria-hidden="true" />
                            </span>
                          )}
                          {(unit.stunnedTurns ?? 0) > 0 && (
                            <span className="sos-unit-badge is-stunned" title="Stunned">
                              <Sparkles size={9} aria-hidden="true" />
                            </span>
                          )}
                          {(unit.shieldHp ?? 0) > 0 && (
                            <span className="sos-unit-badge is-shielded" title="Divine Shield">
                              <Shield size={9} aria-hidden="true" />
                            </span>
                          )}
                          {(unit.blindedTurns ?? 0) > 0 && (
                            <span className="sos-unit-badge is-blinded" title="Blinded">
                              <Eye size={9} aria-hidden="true" />
                            </span>
                          )}
                          {(unit.poisonedTurns ?? 0) > 0 && (
                            <span className="sos-unit-badge is-poisoned" title="Poisoned">
                              <Flame size={9} aria-hidden="true" />
                            </span>
                          )}
                          {(unit.cursedTurns ?? 0) > 0 && (
                            <span className="sos-unit-badge is-cursed" title="Cursed">
                              <Skull size={9} aria-hidden="true" />
                            </span>
                          )}
                          {(unit.regenTurns ?? 0) > 0 && (
                            <span className="sos-unit-badge is-regen" title="Regenerating">
                              <Leaf size={9} aria-hidden="true" />
                            </span>
                          )}
                          {(unit.inspiredTurns ?? 0) > 0 && (
                            <span className="sos-unit-badge is-inspired" title="Inspired">
                              <Music size={9} aria-hidden="true" />
                            </span>
                          )}
                          {/*
                            No ClassIcon here. It used to sit inside the ring as
                            the only class marker, and it stayed after the sprite
                            atlases landed — so crossed swords and sparkles were
                            painted on top of the character. The atlas is the
                            identity now; ▲/▼ carries the side.
                          */}
                          <span className="sos-unit-pips" aria-hidden="true">
                            <i className={unit.hasMoved ? 'is-spent' : ''} />
                            <i className={unit.hasAttacked ? 'is-spent' : ''} />
                          </span>
                          <span className="sos-unit-hp">
                            <i
                              style={{
                                width: `${(unit.stats.currentHp / unit.stats.maxHp) * 100}%`,
                              }}
                            />
                          </span>
                        </span>
                      )}
                      {/* Accuracy and damage for the arrow this click would fire.
                          Nothing is shown unless the shot is actually armed, so
                          the tile never advertises a roll it would not make. */}
                      {shotTip !== null && (
                        <span className="sos-shot-tip">
                          {shotTip.distance} tiles · {shotTip.percent}% · {RANGER_ATTACK.minDamage}–{RANGER_ATTACK.maxDamage} dmg
                        </span>
                      )}
                    </button>
                  );
                }),
              )}

              {/* Active ice walls and your own traps sit in an overlay layer above the grid.
                  Enemy traps are absent by design — the server strips them.

                  Sanctified Ground deliberately draws NOTHING here. It used to
                  paint five permanent highlighted squares for the zone's whole
                  two turns, which is the "continuously highlighted squares" the
                  cast animation replaced: the zone is now a rune circle, five
                  sigils and one flash, then the board is clear. The effect still
                  happens — the regen and the damage cut tick every hand-over —
                  it just stops being permanent furniture on the floor. */}
              <div className="sos-overlay-layer" aria-hidden="true">
                {state.iceWalls.filter((ice) => inBoardView(ice.x, ice.y)).map((ice) => (
                  <span
                    key={`ice-${ice.x},${ice.y}`}
                    className="sos-ice-block"
                    style={{
                      left: `${viewLeftPct(ice.x)}%`,
                      top: `${viewTopPct(ice.y)}%`,
                    }}
                    title={`Ice Wall — melts in ${ice.expiresInTurns} turn(s)`}
                  >
                    <span className="sos-ice-block-sprite" />
                    <span className="sos-overlay-turns">{ice.expiresInTurns}t</span>
                  </span>
                ))}
                {state.traps
                  .filter((trap) => trap.ownerId === humanId && trap.armed && inBoardView(trap.x, trap.y))
                  .map((trap) => (
                    <span
                      key={trap.id}
                      className="sos-trap"
                      style={{
                        left: `${viewLeftPct(trap.x)}%`,
                        top: `${viewTopPct(trap.y)}%`,
                      }}
                      title="Your trap — hidden from the enemy"
                    />
                  ))}
              </div>
                  {pendingConfirm && inBoardView(pendingConfirm.at.x, pendingConfirm.at.y) && (
                    <BoardPopover
                      leftPct={viewLeftPct(pendingConfirm.at.x)}
                      topPct={viewTopPct(pendingConfirm.at.y)}
                      cols={boardView.cols}
                      rows={boardView.rows}
                      role="dialog"
                      aria-label={`Confirm ${pendingConfirm.title}`}
                    >
                      <p className="sos-confirm-title">{pendingConfirm.title}</p>
                      <p className="sos-confirm-detail">{pendingConfirm.detail}</p>
                      <div className="sos-confirm-actions">
                        <button
                          type="button"
                          className="sos-confirm-ok"
                          onClick={() => { playSfx('select'); commitPending(); }}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          className="sos-confirm-cancel"
                          onClick={cancelPending}
                        >
                          Cancel
                        </button>
                      </div>
                    </BoardPopover>
                  )}

                  {/*
                    * The Altar of Shadows.
                    *
                    * Same card the ability confirm uses — it already anchors to a
                    * tile and opts back into pointer events — because a second
                    * popover style would only differ in colour.
                    */}
                  {altarMenuOpen && altarUnit && altarPromptCell && (
                    <BoardPopover
                      className={`sos-altar-menu${altarDormantReason ? ' is-dormant' : ''}`}
                      leftPct={viewLeftPct(altarPromptCell.x)}
                      topPct={viewTopPct(altarPromptCell.y)}
                      cols={boardView.cols}
                      rows={boardView.rows}
                      role="dialog"
                      aria-label="Altar of Shadows"
                    >
                      <p className="sos-confirm-title">Altar of Shadows</p>
                      <p className="sos-confirm-detail">
                        {CLASS_META[altarUnit.type].label} · {altarSouls} soul
                        {altarSouls === 1 ? '' : 's'} offered
                      </p>
                      {altarDormantReason && (
                        <p className="sos-altar-dormant" role="status">
                          <span>{altarDormantReason}</span>
                          {altarWishSpent && (
                            <span className="sos-altar-cooldown">[ Cooldown Active ]</span>
                          )}
                        </p>
                      )}
                      <div className="sos-confirm-actions">
                        <button
                          type="button"
                          className="sos-confirm-ok sos-altar-restore"
                          disabled={
                            !altarReady ||
                            altarUnit.stats.currentHp >= altarUnit.stats.maxHp
                          }
                          onClick={() => {
                            playSfx('select');
                            setAltarMenuOpen(false);
                            dispatch({ type: 'ALTAR_WISH', unitId: altarUnit.id, wish: 'RESTORE' });
                          }}
                        >
                          Full Restoration
                        </button>
                        {altarFallen && (
                          <button
                            type="button"
                            className="sos-confirm-ok sos-altar-resurrect"
                            disabled={!altarReady}
                            onClick={() => {
                              playSfx('select');
                              setAltarMenuOpen(false);
                              dispatch({
                                type: 'ALTAR_WISH',
                                unitId: altarUnit.id,
                                wish: 'RESURRECT',
                              });
                            }}
                          >
                            Blood Sacrifice · raise {CLASS_META[altarFallen.type].label}
                          </button>
                        )}
                        <button
                          type="button"
                          className="sos-confirm-cancel"
                          onClick={() => setAltarMenuOpen(false)}
                        >
                          Step away
                        </button>
                      </div>
                    </BoardPopover>
                  )}

                <div className="sos-floaters" aria-hidden="true">
                {/* Things that travel between tiles: shield, shove, rope, arrow, firebolt. */}
                {linkFx
                  // A projectile between two off-screen tiles would fly across
                  // empty space; both ends must be drawn for it to mean anything.
                  .filter((fx) => inBoardView(fx.fromX, fx.fromY) && inBoardView(fx.toX, fx.toY))
                  .map((fx) => {
                  const linkSprite = LINK_SPRITE_FOR[fx.kind];
                  return (
                    <span
                      key={fx.id}
                      className={`sos-linkfx is-${fx.kind}`}
                      style={
                        {
                          '--fx-from-left': `${viewLeftPct(fx.fromX)}%`,
                          '--fx-from-top': `${viewTopPct(fx.fromY)}%`,
                          '--fx-to-left': `${viewLeftPct(fx.toX)}%`,
                          '--fx-to-top': `${viewTopPct(fx.toY)}%`,
                          '--fx-angle': `${fx.angleDeg ?? 0}deg`,
                          // Flight time is per-hop, so a point-blank flick and a
                          // board-length arrow each take the time they should.
                          '--fx-travel': `${fx.travelMs ?? 550}ms`,
                          '--fx-dir-x': String(fx.dirX ?? 0),
                          '--fx-dir-y': String(fx.dirY ?? 0),
                        } as CSSProperties
                      }
                    >
                      {fx.kind === 'shield' && <Shield size={15} />}
                      {linkSprite && (
                        <span
                          className="sos-linkfx-sprite"
                          style={{ backgroundImage: `url(${linkSprite})` }}
                        />
                      )}
                    </span>
                  );
                })}
                {spellFx.filter((fx) => inBoardView(fx.x, fx.y)).map((fx) => {
                  const vfxSprite = VFX_SPRITE_FOR[fx.ability];
                  const vfxGif = VFX_GIF_FOR[fx.ability];
                  // Generated pixelfx strips win over the hand-drawn art for
                  // every ability listed in SOS_PIXEL_FX.
                  const pixelFx = SOS_PIXEL_FX[fx.ability];
                  return (
                    <span
                      key={fx.id}
                      className={`sos-spellfx is-${fx.ability.toLowerCase()}${vfxGif ? ' has-pixel-vfx' : ''}${pixelFx ? ' has-pixelfx' : ''}`}
                      style={{
                        left: `${viewLeftPct(fx.x)}%`,
                        top: `${viewTopPct(fx.y)}%`,
                      }}
                    >
                      {/* The old core/ring burst would double up with the strip. */}
                      {!pixelFx && <i className="sos-spellfx-core" />}
                      {!pixelFx && <i className="sos-spellfx-ring" />}
                      {pixelFx ? (
                        <span
                          className="sos-spellfx-pixel"
                          style={sosPixelFxStyle(pixelFx)}
                          aria-hidden="true"
                        />
                      ) : vfxGif ? (
                        <img
                          className="sos-spellfx-gif"
                          src={vfxGif.src}
                          width={vfxGif.width}
                          height={vfxGif.height}
                          style={{ animationDuration: `${vfxGif.durationMs}ms` }}
                          alt=""
                          aria-hidden="true"
                        />
                      ) : vfxSprite && (
                        <span
                          className="sos-spellfx-sprite"
                          style={{ backgroundImage: `url(${vfxSprite})` }}
                        />
                      )}
                    </span>
                  );
                })}
                {floaters.filter((f) => inBoardView(f.x, f.y)).map((f) => (
                  <span
                    key={f.id}
                    className={`sos-floater is-${f.kind}`}
                    style={{
                      left: `${viewLeftPct(f.x)}%`,
                      top: `${viewTopPct(f.y)}%`,
                    }}
                  >
                    {f.text}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        </div>
        )
      )}

      {/*
        The winning faction's film. Mounted between the sting and the tally, and
        again from the tally's replay button; it hands control back on `onDone`
        no matter how it ends.
      */}
      {cinematicFaction && (
        <VictoryCinematic faction={cinematicFaction} onDone={finishCinematic} />
      )}

      {/*
        The end-of-battle dialog. Gated on `showResult`, not on `phase`, so it
        waits for the board to settle and the sting to play instead of flashing
        over the top of the last effect. Rematch only becomes reachable once the
        sequence has run, so nobody skips the payoff by mashing it.
      */}
      {state?.phase === 'ended' && (
        <div
          className={`sos-overlay${showResult ? ' is-revealed' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-hidden={!showResult}
        >
          <div className={`sos-overlay-card${resultKind ? ` is-${resultKind}` : ''}`}>
            <h2>{turnLabel}</h2>
            <p>
              {room?.forfeit
                ? room.forfeit.winnerId === humanId
                  ? 'Your rival fell silent and never came back. The square is yours.'
                  : 'You were disconnected too long — the duel was forfeited.'
                : state.winnerId === ADVENTURE_CLEARED
                  ? 'The last monster falls. The floor is yours.'
                  : state.winnerId === humanId
                    ? 'The shadows bend to your will.'
                    : state.winnerId
                      ? isAdventure
                        ? 'Your party has been wiped out.'
                        : 'Your squad has fallen into shadow.'
                      : 'The duel ended before the battle began.'}
            </p>

            <dl className="sos-tally">
              <div className="sos-tally-card">
                <dt>Damage Dealt</dt>
                <dd>{battleStats.damageDealt}</dd>
              </div>
              <div className="sos-tally-card">
                <dt>Units Lost</dt>
                <dd>{battleStats.losses}</dd>
              </div>
              <div className="sos-tally-card">
                <dt>Turns Passed</dt>
                <dd>{state.turnNumber}</dd>
              </div>
              <div className="sos-tally-card">
                <dt>Souls Sacrificed</dt>
                <dd>{battleStats.soulsSpent}</dd>
              </div>
            </dl>
            {/* The four cards are the story; this line keeps the rest of the
                tally reachable instead of deleting it from the screen. */}
            <p className="sos-tally-note">
              Damage taken {battleStats.damageTaken} · Enemies down {battleStats.kills} · Squad
              healed {battleStats.healed} · Abilities {battleStats.abilities}
            </p>

            <div className="sos-overlay-actions">
              {/* The film is replayable by name — it is the one scene somebody
                  might want to watch twice, and on a loss it is the only way to
                  see the winner's cut again. */}
              {winningFaction && (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!showResult}
                  onClick={() => {
                    setShowResult(false);
                    setCinematicFaction(winningFaction);
                  }}
                >
                  {resultKind === 'victory' ? 'Watch Victory' : 'Watch Their Victory'}
                </button>
              )}
              <button
                type="button"
                className="primary-button btn-purple"
                disabled={!showResult}
                onClick={() => {
                  // An online duel is re-created server-side; the old room is done.
                  if (mode === 'online') {
                    leaveOnline();
                    hostOnline();
                    return;
                  }
                  startGame(mode === 'ai' ? 'ai' : 'hotseat');
                }}
              >
                Rematch
              </button>
              <button type="button" className="ghost-button" disabled={!showResult} onClick={() => {
                if (mode === 'online') leaveOnline();
                backToMenu();
              }}>
                Main Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
import { publicAsset } from '../../utils/publicAsset';
