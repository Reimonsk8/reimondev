/**
 * Outlands — shared simulation contracts.
 *
 * The simulation is deliberately plain data. A local run, a Vitest step, and a
 * future authoritative WebSocket server all operate on the same WorldState, so
 * the renderer never owns gameplay truth. Keep this file free of Pixi imports.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** 0 = militarized safe zone, 3 = corporate core / bio-lab. */
export type ThreatTier = 0 | 1 | 2 | 3;

export type ZombieVariant =
  | 'walker'
  | 'runner'
  | 'brute'
  | 'burning'
  | 'spitter'
  | 'leaper'
  | 'titan'
  | 'wraith'
  | 'hound';

export type WeaponId =
  | 'melee'
  | 'pistol'
  | 'shotgun'
  | 'smg'
  | 'sniper'
  | 'rifle'
  | 'heavy';

export type WeaponProficiencyId =
  | 'melee'
  | 'pistol'
  | 'shotgun'
  | 'smg'
  | 'rifle'
  | 'assault'
  | 'heavy';

export type DismemberType =
  | 'HEADSHOT'
  | 'EXPLOSIVE_GIB'
  | 'SLASH_SLICE'
  | 'BLUNT_CRUSH';

export type ZombieBodyPart = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'legs';

export interface ZombieLimbs {
  head: boolean;
  torso: boolean;
  leftArm: boolean;
  rightArm: boolean;
  legs: boolean;
}

export type ProfessionId = 'Doctor' | 'Chef' | 'Engineer';

export type OutpostId = 'nastya' | 'pastor' | 'secronom' | 'sector09';

export interface OutpostInfo {
  id: OutpostId;
  name: string;
  subtitle: string;
  x: number;
  y: number;
  radius: number;
  tier: ThreatTier;
}

export type ObstacleKind = 'ruin' | 'wreck' | 'container' | 'tower';

export type PickupKind =
  | 'scrap'
  | 'ammo'
  | 'medkit'
  | 'corpse'
  | 'cash'
  | 'food'
  | 'antiviral'
  | 'armor_plate';

export type GamePhase = 'playing' | 'dead';

export interface RemotePlayerSnapshot {
  id: string;
  nickname: string;
  player: PlayerState;
}

export interface RoomPlayer {
  playerId: string;
  nickname: string;
  state: PlayerState;
}

export interface Obstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: ObstacleKind;
}

export type ContainerKind =
  | 'car_trunk'
  | 'trash_bin'
  | 'dead_body'
  | 'wooden_crate'
  | 'military_cabinet';

export interface WorldContainer {
  id: string;
  kind: ContainerKind;
  label: string;
  x: number;
  y: number;
  searched: boolean;
  searchProgress: number;
  searchDuration: number;
  threatTier: ThreatTier;
}

export type StreetPropKind =
  | 'burned_car'
  | 'barricade'
  | 'foliage'
  | 'trash_mound'
  | 'blood_stain'
  | 'rubble'
  | 'cracked_asphalt'
  | 'streetlight'
  | 'barrel_fire';

export interface StreetProp {
  id: string;
  kind: StreetPropKind;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  castsLight?: boolean;
  flickerPhase?: number;
}

export interface WorldChunk {
  cx: number;
  cy: number;
  key: string;
  code: string;
  regionName: string;
  worldX: number;
  worldY: number;
  size: number;
  tier: ThreatTier;
  isSafeZone: boolean;
  outpostId?: OutpostId;
  obstacles: Obstacle[];
  containers: WorldContainer[];
  props: StreetProp[];
}

export interface SpatialNetPacket {
  tick: number;
  origin: Vec2;
  interestRadius: number;
  players: Array<{
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    angle: number;
    weapon: WeaponId;
    health: number;
  }>;
  shots: Array<{
    weapon: WeaponId;
    x: number;
    y: number;
    angle: number;
    goreSeed: number;
  }>;
  zombies: Array<{
    id: string;
    variant: ZombieVariant;
    x: number;
    y: number;
    angle: number;
    health: number;
  }>;
}

export type InteriorKind = 'residential' | 'commercial' | 'bunker';

export interface BuildingDoor {
  id: string;
  buildingId: string;
  kind: InteriorKind;
  label: string;
  x: number;
  y: number;
  tier: ThreatTier;
  state: 'closed' | 'opening' | 'open' | 'closing' | 'barricaded' | 'smashed';
  transitionTimer: number;
  barricadeHp: number;
  locked: boolean;
}

export interface InteriorInstance {
  id: string;
  doorId: string;
  kind: InteriorKind;
  label: string;
  tier: ThreatTier;
  width: number;
  height: number;
  entrySpawn: Vec2;
  exitDoor: Vec2;
  outdoorReturnPos: Vec2;
  obstacles: Obstacle[];
  containers: WorldContainer[];
  zombies: ZombieState[];
  outdoorZombiesBackup: ZombieState[];
  hordeBreachTriggered: boolean;
  exitLocked: boolean;
}

export interface SectorCell {
  col: number;
  row: number;
  code: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tier: ThreatTier;
  isSafeZone: boolean;
  outpostId?: OutpostId;
}

export interface WorldMap {
  width: number;
  height: number;
  seed: number;
  safeCenter: Vec2;
  safeRadius: number;
  infinite?: boolean;
  chunkSize?: number;
  activeChunks?: Record<string, WorldChunk>;
  doors?: BuildingDoor[];
  outposts: OutpostInfo[];
  sectors?: SectorCell[];
  obstacles: Obstacle[];
  containers: WorldContainer[];
}

export interface WeaponState {
  id: WeaponId;
  name: string;
  proficiencyId: WeaponProficiencyId;
  ammo: number;
  reserve: number;
  magSize: number;
  fireInterval: number;
  reloadSeconds: number;
  damage: number;
  pellets: number;
  spread: number;
  range: number;
  knockback: number;
  headshotChance: number;
  critChance: number;
  critMultiplier: number;
  noiseRadius: number;
  isSilent: boolean;
  isMelee: boolean;
  staggerDuration: number;
  dismemberType: DismemberType;
  unlocked: boolean;
  priceUsd: number;
}

export interface PlayerAttributes {
  strength: number;
  agility: number;
  endurance: number;
  criticalHit: number;
  accuracy: number;
  reloading: number;
}

export type InventoryCategory =
  | 'med'
  | 'food'
  | 'antiviral'
  | 'ammo'
  | 'armor'
  | 'scrap'
  | 'weapon'
  | 'valuables';

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'military' | 'bio';

export interface InventoryItem {
  id: string;
  templateId: string;
  name: string;
  category: InventoryCategory;
  width: number;
  height: number;
  gridX: number;
  gridY: number;
  quantity: number;
  valueUsd: number;
  rarity: ItemRarity;
  description: string;
  healAmount?: number;
  hungerAmount?: number;
  curesInfection?: boolean;
  armorRepair?: number;
  ammoType?: WeaponId;
  ammoCount?: number;
}

export interface OutpostQuest {
  id: string;
  title: string;
  description: string;
  targetKills: number;
  progressKills: number;
  targetVariant?: ZombieVariant;
  rewardCash: number;
  rewardXp: number;
  rewardScrap: number;
  completed: boolean;
  claimed: boolean;
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  knockbackVx: number;
  knockbackVy: number;
  knockbackTimer: number;
  angle: number;
  radius: number;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  hunger: number;
  maxHunger: number;
  armorName: string;
  armorAbsorption: number;
  armorDurability: number;
  armorMaxDurability: number;
  armorWeightPenalty: number;
  infected: boolean;
  infectionSeverity: number;
  flashlightOn: boolean;
  reticleBloom: number;
  focusFactor: number;
  activeWeapon: WeaponId;
  weapons: Record<WeaponId, WeaponState>;
  /** Two firearms the survivor swaps between; melee is always available. */
  loadout: [WeaponId, WeaponId];
  fireCooldown: number;
  /** Prevents held melee input from starting another swing after cooldown. */
  meleeInputHeld: boolean;
  meleeImpactTimer: number;
  meleeImpactPending: boolean;
  interactionCooldown: number;
  reloadTimer: number;
  invulnerableTimer: number;
  carriedScrap: number;
  stash: number;
  carriedCash: number;
  bankCash: number;
  level: number;
  xp: number;
  unbankedXp: number;
  statPoints: number;
  proficiencyPoints: number;
  attributes: PlayerAttributes;
  proficiencies: Record<WeaponProficiencyId, number>;
  profession: ProfessionId;
  inventoryCols: number;
  inventoryRows: number;
  inventory: InventoryItem[];
  stashedItems: InventoryItem[];
  quests: OutpostQuest[];
  activeOutpostId: OutpostId;
  kills: number;
  deaths: number;
  inSafeZone: boolean;
  threatTier: ThreatTier;
  alive: boolean;
}

export interface ZombieState {
  id: string;
  variant: ZombieVariant;
  x: number;
  y: number;
  vx: number;
  vy: number;
  knockbackVx: number;
  knockbackVy: number;
  knockbackTimer: number;
  angle: number;
  radius: number;
  health: number;
  maxHealth: number;
  speed: number;
  damage: number;
  attackCooldown: number;
  hitFlash: number;
  staggerTimer: number;
  alerted: boolean;
  limbs: ZombieLimbs;
  spitCooldown: number;
  leapCooldown: number;
  leapingTimer: number;
  armorReduction: number;
  cloakAlpha: number;
  burningAura: boolean;
  inflictsInfection: boolean;
  isBoss: boolean;
  siegeWave: boolean;
}

export interface LootPickup {
  id: string;
  kind: PickupKind;
  x: number;
  y: number;
  amount: number;
  cashAmount?: number;
  xpAmount?: number;
  items?: InventoryItem[];
  ttl: number;
}

export interface AcidProjectile {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  ttl: number;
  inflictsInfection: boolean;
}

export interface SoundPulse {
  id: string;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  ttl: number;
  maxTtl: number;
  silent: boolean;
}

export interface ShotTrace {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  hit: boolean;
  headshot: boolean;
  crit?: boolean;
}

export interface RemoteOutlandsPlayer {
  playerId: string;
  nickname: string;
  avatarColor?: string | null;
  x: number;
  y: number;
  angle: number;
  weapon: WeaponId;
  health: number;
  maxHealth: number;
  firing?: boolean;
  shotSeq?: number;
  lastSeen: number;
}

export type GameEvent =
  | {
      type: 'shot';
      weapon: WeaponId;
      x: number;
      y: number;
      angle: number;
      traces: ShotTrace[];
      silent?: boolean;
      noiseRadius?: number;
      shakePx?: number;
      recoilVector?: Vec2;
    }
  | {
      type: 'weapon_switched';
      weapon: WeaponId;
    }
  | {
      type: 'reload_clip_insert';
      weapon: WeaponId;
    }
  | {
      type: 'reload_rack';
      weapon: WeaponId;
    }
  | {
      type: 'zombie_hit';
      zombieId: string;
      variant: ZombieVariant;
      x: number;
      y: number;
      angle: number;
      force: number;
      headshot: boolean;
      crit?: boolean;
      severedPart?: ZombieBodyPart;
      dismemberType?: DismemberType;
      lethal: boolean;
      weapon: WeaponId;
    }
  | {
      type: 'zombie_killed';
      zombieId: string;
      variant: ZombieVariant;
      x: number;
      y: number;
      angle: number;
      headshot: boolean;
      dismemberType?: DismemberType;
      weapon: WeaponId;
      xpEarned?: number;
    }
  | { type: 'player_hit'; x: number; y: number; damage: number; absorbed?: number; infected?: boolean }
  | { type: 'player_died'; x: number; y: number; droppedScrap: number; droppedCash?: number; droppedXp?: number }
  | { type: 'pickup'; kind: PickupKind; x: number; y: number; amount: number }
  | { type: 'stash_banked'; amount: number; cashBanked?: number; xpBanked?: number }
  | { type: 'reload_start'; weapon: WeaponId }
  | { type: 'reload_complete'; weapon: WeaponId }
  | { type: 'container_searched'; containerId: string; label: string; itemNames: string[]; cashFound: number }
  | { type: 'loot_aggro'; x: number; y: number; count: number }
  | { type: 'level_up'; level: number }
  | { type: 'acid_spit'; x: number; y: number; angle: number }
  | { type: 'interior_entered'; label: string; kind: InteriorKind; tier: ThreatTier }
  | { type: 'interior_exited'; label: string }
  | { type: 'horde_breach'; label: string; waveCount: number };

export interface InputState {
  move: Vec2;
  aim: Vec2;
  firing: boolean;
  reload: boolean;
  sprint: boolean;
  weapon?: WeaponId;
  weaponSwitch?: WeaponId;
  /** Grid Pack picker: move `loadoutWeapon` into `loadoutSlot`. */
  loadoutSlot?: 0 | 1;
  loadoutWeapon?: WeaponId;
  interact?: boolean;
  toggleFlashlight?: boolean;
}

export interface WorldState {
  phase: GamePhase;
  tick: number;
  time: number;
  map: WorldMap;
  player: PlayerState;
  zombies: ZombieState[];
  pickups: LootPickup[];
  projectiles: AcidProjectile[];
  soundPulses: SoundPulse[];
  events: GameEvent[];
  spawnTimer: number;
  nextEntityId: number;
  aggroIndex: number;
  activeInterior?: InteriorInstance | null;
  remotePlayers?: RemotePlayerSnapshot[];
  lostScrap?: number;
}

/** Process-local shared sector; per-player avatars sit over shared world entities. */
export interface OutlandsRoomState extends WorldState {
  players: Record<string, RoomPlayer>;
  lostScrapByPlayer: Record<string, number>;
}

export interface SteppableGameServer {
  readonly state: WorldState;
  step(dt: number, input: InputState): WorldState;
  reset(seed?: number, stash?: number): WorldState;
  drainEvents(): GameEvent[];
}
