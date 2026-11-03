import { rngFromSeed } from '../../squareofshadows/engine/maps';
import { createDoorsForMap } from './interiors';
import { MELEE_SWING_DURATION } from './animation';
import { clamp, distance, normalize } from './isometric';
import { selectZoneThemedZombieVariant } from './spawner';

export { rngFromSeed };
import type {
  ContainerKind,
  InventoryCategory,
  InventoryItem,
  ItemRarity,
  Obstacle,
  OutpostId,
  OutpostInfo,
  OutpostQuest,
  PlayerAttributes,
  PlayerState,
  SectorCell,
  SpatialNetPacket,
  StreetProp,
  StreetPropKind,
  ThreatTier,
  Vec2,
  WeaponId,
  WeaponProficiencyId,
  WeaponState,
  WorldChunk,
  WorldContainer,
  WorldMap,
  WorldState,
  ZombieState,
  ZombieVariant,
} from './types';

/**
 * Infinite Chunk-Based Quarantine World.
 *
 * Each city chunk is a 14x14-tile rectangular Dead Frontier sector block separated
 * by city streets. Chunk (1, 1) at world coordinates [14..28, 14..28] is the
 * primary Safe Outpost Sanctuary (Nastya's Holdout), while chunks stream
 * infinitely in all directions as the survivor travels deeper into the Outlands.
 */
export const WORLD_WIDTH = 42;
export const WORLD_HEIGHT = 42;
export const CHUNK_SIZE = 14;
export const ACTIVE_CHUNK_RADIUS = 1;
export const CHUNK_UNLOAD_MARGIN = 1;
export const SHARED_OUTLANDS_SEED = 0x51f15e;
export const SECTOR_COLS = 3;
export const SECTOR_ROWS = 3;
export const SECTOR_SIZE = 14;
export const SAFE_CENTER: Vec2 = { x: 21, y: 21 };
export const SAFE_RADIUS = 12;

// Keep the early expedition ring broad: Tier II begins 30 tiles from Nastya's
// Holdout, and Tier III starts beyond 45 tiles. The map itself keeps streaming.
export const THREAT_BAND_1 = 30;
export const THREAT_BAND_2 = 45;
// Chance a base-map container placement is kept, so loot thins near the Outpost and pools in risky bands.
const BASE_CONTAINER_KEEP: Record<ThreatTier, number> = { 0: 0, 1: 0.3, 2: 0.65, 3: 1 };

export const MAP_SEED_MASK = 0x9e3779b9;

const STRUCTURE_COUNT = 52;
const TOWER_COUNT = 4;
const WORLD_MARGIN = 2;

export const OUTPOSTS: OutpostInfo[] = [
  {
    id: 'nastya',
    name: "Nastya's Holdout",
    subtitle: 'Block B2 · Tier 0 Survivor Sanctuary Compound',
    x: SAFE_CENTER.x,
    y: SAFE_CENTER.y,
    radius: SAFE_RADIUS,
    tier: 0,
  },
  {
    id: 'pastor',
    name: 'Fort Pastor',
    subtitle: 'Block B-1 · Tier 1 National Guard Garrison (North Highway)',
    x: 21,
    y: -7,
    radius: 4.5,
    tier: 1,
  },
  {
    id: 'secronom',
    name: 'Secronom Bunker',
    subtitle: 'Block D4 · Tier 3 Deep Outlands Bio-Research Command',
    x: 49,
    y: 49,
    radius: 4.5,
    tier: 3,
  },
  {
    id: 'sector09',
    name: 'Sector 09 Quarantine Perimeter',
    subtitle: 'Block A1 · Tier 2 Quarantine Perimeter',
    x: 7,
    y: 7,
    radius: 4,
    tier: 2,
  },
];

const SECTOR_NAMES: string[][] = [
  ['Westgate Ruins', 'Fort Pastor Outskirts', 'North Industrial Yard'],
  ['Old Suburbia West', "Nastya's Holdout (S-Zone)", 'East Commercial Plaza'],
  ['Quarantine Slums', 'South Evac Highway', 'Secronom Bio-Core'],
];

const PROCEDURAL_DISTRICTS = [
  'Collapsed Overpass',
  'Quarantine Rail Yard',
  'Burned Tenements',
  'Dead Mall Boulevard',
  'CEDA Triage Sector',
  'Toxic Canal Crossing',
  'Red Zone Highrise',
  'Bio-Hazard Crater',
  'Abandoned Hospital Wing',
  'Sunken Metro Plaza',
  'Mercenary Checkpoint',
  'Necrotic Freight Depot',
];

export function chunkCoordAt(worldCoord: number): number {
  return Math.floor(worldCoord / CHUNK_SIZE);
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function chunkCodeFor(cx: number, cy: number): string {
  const rowChar =
    cy >= 0 && cy < 26 ? String.fromCharCode(65 + cy) : `R${cy < 0 ? cy : `+${cy}`}`;
  const colLabel = cx + 1;
  return `${rowChar}${colLabel}`;
}

export function regionNameForChunk(cx: number, cy: number): string {
  if (cx === 1 && cy === 1) return "Nastya's Holdout (S-Zone)";
  if (cx === 1 && cy === -1) return 'Fort Pastor Garrison';
  if (cx === 3 && cy === 3) return 'Secronom Bunker Core';
  if (cy >= 0 && cy < SECTOR_ROWS && cx >= 0 && cx < SECTOR_COLS) {
    return SECTOR_NAMES[cy][cx];
  }
  const hash = Math.abs((cx * 73856093) ^ (cy * 19349663));
  return PROCEDURAL_DISTRICTS[hash % PROCEDURAL_DISTRICTS.length];
}

export function chunkThreatTier(cx: number, cy: number): ThreatTier {
  if (cx === 1 && cy === 1) return 0;
  const dist = Math.hypot(cx - 1, cy - 1);
  if (dist <= 2.1) return 1;
  if (dist <= 3.2) return 2;
  return 3;
}

export function buildSectorGrid(centerCx = 1, centerCy = 1, radius = 1): SectorCell[] {
  const cells: SectorCell[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const col = centerCx + dx;
      const row = centerCy + dy;
      const code = chunkCodeFor(col, row);
      const isCenter = col === 1 && row === 1;
      const tier = chunkThreatTier(col, row);
      const outpostId: OutpostId | undefined = isCenter
        ? 'nastya'
        : col === 1 && row === -1
          ? 'pastor'
          : col === 0 && row === 0
            ? 'sector09'
          : col === 3 && row === 3
            ? 'secronom'
            : undefined;
      cells.push({
        col,
        row,
        code,
        name: regionNameForChunk(col, row),
        x: col * SECTOR_SIZE,
        y: row * SECTOR_SIZE,
        width: SECTOR_SIZE,
        height: SECTOR_SIZE,
        tier,
        isSafeZone: isCenter || Boolean(outpostId),
        outpostId,
      });
    }
  }
  return cells;
}

export function getSectorAt(_map: WorldMap, x: number, y: number): SectorCell {
  const col = chunkCoordAt(x);
  const row = chunkCoordAt(y);
  const isCenter = col === 1 && row === 1;
  const outpostId: OutpostId | undefined = isCenter
    ? 'nastya'
    : col === 1 && row === -1
      ? 'pastor'
      : col === 0 && row === 0
        ? 'sector09'
      : col === 3 && row === 3
        ? 'secronom'
        : undefined;
  return {
    col,
    row,
    code: chunkCodeFor(col, row),
    name: regionNameForChunk(col, row),
    x: col * SECTOR_SIZE,
    y: row * SECTOR_SIZE,
    width: SECTOR_SIZE,
    height: SECTOR_SIZE,
    tier: chunkThreatTier(col, row),
    isSafeZone: isCenter || Boolean(outpostId),
    outpostId,
  };
}

export const WEAPON_PROFICIENCY_LABELS: Record<
  WeaponProficiencyId,
  { name: string; archetype: string; icon: string }
> = {
  melee: { name: 'Melee (Blunt / Edged)', archetype: 'Silent · High Stagger · Zero Ammo', icon: 'Blade' },
  pistol: { name: 'Pistols / Revolvers', archetype: 'Accurate · High Crit · Fast Draw', icon: 'Sidearm' },
  shotgun: { name: 'Shotguns', archetype: '7-Pellet Spread · Heavy Knockback · Gib', icon: 'Buckshot' },
  smg: { name: 'Submachine Guns', archetype: 'High Fire Rate · Mobile Suppression', icon: 'SMG' },
  rifle: { name: 'Rifles / Sniper Rifles', archetype: 'Long Range · Armor Piercing · Headshot', icon: 'Marksman' },
  assault: { name: 'Assault Rifles', archetype: 'Versatile Automatic · Balanced Stopping Power', icon: 'Carbine' },
  heavy: { name: 'Heavy Weapons', archetype: 'Explosive / Gatling / Crowd Annihilation', icon: 'Heavy' },
};

export function masteryRankLabel(points: number): string {
  if (points >= 110) return 'Grandmaster (120)';
  if (points >= 80) return 'Master (90)';
  if (points >= 50) return 'Specialist (60)';
  if (points >= 25) return 'Adept (30)';
  return 'Novice (0)';
}

export function xpToNextLevel(level: number): number {
  return Math.max(100, level * 100);
}

const WEAPONS: Record<WeaponId, WeaponState> = {
  melee: {
    id: 'melee',
    name: 'Kukri Machete',
    proficiencyId: 'melee',
    ammo: 999,
    reserve: 999,
    magSize: 999,
    fireInterval: MELEE_SWING_DURATION,
    reloadSeconds: 0.2,
    damage: 46,
    pellets: 1,
    spread: 0.14,
    range: 2.6,
    knockback: 5.2,
    headshotChance: 0.28,
    critChance: 0.26,
    critMultiplier: 1.9,
    noiseRadius: 2.2,
    isSilent: true,
    isMelee: true,
    staggerDuration: 0.58,
    dismemberType: 'SLASH_SLICE',
    unlocked: true,
    priceUsd: 0,
  },
  pistol: {
    id: 'pistol',
    name: '.357 Python Revolver',
    proficiencyId: 'pistol',
    ammo: 8,
    reserve: 64,
    magSize: 8,
    fireInterval: 0.26,
    reloadSeconds: 1.25,
    damage: 44,
    pellets: 1,
    spread: 0.025,
    range: 14.5,
    knockback: 0.55,
    headshotChance: 0.34,
    critChance: 0.28,
    critMultiplier: 2.1,
    noiseRadius: 8.5,
    isSilent: false,
    isMelee: false,
    staggerDuration: 0.25,
    dismemberType: 'HEADSHOT',
    unlocked: true,
    priceUsd: 120,
  },
  rifle: {
    id: 'rifle',
    name: 'M4 Carbine',
    proficiencyId: 'assault',
    ammo: 30,
    reserve: 120,
    magSize: 30,
    fireInterval: 0.115,
    reloadSeconds: 1.45,
    damage: 34,
    pellets: 1,
    spread: 0.045,
    range: 16,
    knockback: 0.42,
    headshotChance: 0.22,
    critChance: 0.18,
    critMultiplier: 1.75,
    noiseRadius: 13.5,
    isSilent: false,
    isMelee: false,
    staggerDuration: 0.16,
    dismemberType: 'HEADSHOT',
    unlocked: true,
    priceUsd: 240,
  },
  shotgun: {
    id: 'shotgun',
    name: 'Breacher 12g',
    proficiencyId: 'shotgun',
    ammo: 6,
    reserve: 30,
    magSize: 6,
    fireInterval: 0.58,
    reloadSeconds: 1.85,
    damage: 18,
    pellets: 7,
    spread: 0.24,
    range: 9.5,
    knockback: 1.05,
    headshotChance: 0.16,
    critChance: 0.2,
    critMultiplier: 1.65,
    noiseRadius: 16.5,
    isSilent: false,
    isMelee: false,
    staggerDuration: 0.48,
    dismemberType: 'EXPLOSIVE_GIB',
    unlocked: true,
    priceUsd: 280,
  },
  smg: {
    id: 'smg',
    name: 'MP5K Tactical SMG',
    proficiencyId: 'smg',
    ammo: 40,
    reserve: 160,
    magSize: 40,
    fireInterval: 0.075,
    reloadSeconds: 1.15,
    damage: 22,
    pellets: 1,
    spread: 0.085,
    range: 12.5,
    knockback: 0.26,
    headshotChance: 0.18,
    critChance: 0.16,
    critMultiplier: 1.6,
    noiseRadius: 10.5,
    isSilent: false,
    isMelee: false,
    staggerDuration: 0.12,
    dismemberType: 'HEADSHOT',
    unlocked: true,
    priceUsd: 220,
  },
  sniper: {
    id: 'sniper',
    name: 'M24 Marksman Rifle',
    proficiencyId: 'rifle',
    ammo: 6,
    reserve: 30,
    magSize: 6,
    fireInterval: 0.68,
    reloadSeconds: 1.9,
    damage: 98,
    pellets: 1,
    spread: 0.01,
    range: 22,
    knockback: 1.15,
    headshotChance: 0.48,
    critChance: 0.38,
    critMultiplier: 2.35,
    noiseRadius: 18,
    isSilent: false,
    isMelee: false,
    staggerDuration: 0.55,
    dismemberType: 'HEADSHOT',
    unlocked: true,
    priceUsd: 380,
  },
  heavy: {
    id: 'heavy',
    name: 'M134 Vulcan Minigun',
    proficiencyId: 'heavy',
    ammo: 80,
    reserve: 240,
    magSize: 80,
    fireInterval: 0.065,
    reloadSeconds: 2.35,
    damage: 32,
    pellets: 2,
    spread: 0.13,
    range: 15,
    knockback: 0.85,
    headshotChance: 0.15,
    critChance: 0.2,
    critMultiplier: 1.7,
    noiseRadius: 21,
    isSilent: false,
    isMelee: false,
    staggerDuration: 0.32,
    dismemberType: 'EXPLOSIVE_GIB',
    unlocked: true,
    priceUsd: 520,
  },
};

export interface ItemTemplate {
  templateId: string;
  name: string;
  category: InventoryCategory;
  width: number;
  height: number;
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

export const ITEM_TEMPLATES: Record<string, ItemTemplate> = {
  bandage: {
    templateId: 'bandage',
    name: 'Sterile Bandages',
    category: 'med',
    width: 1,
    height: 1,
    valueUsd: 35,
    rarity: 'common',
    description: 'Field dressing that staunches bleeding and restores +28 HP.',
    healAmount: 28,
  },
  medkit: {
    templateId: 'medkit',
    name: 'First Aid Kit',
    category: 'med',
    width: 2,
    height: 2,
    valueUsd: 90,
    rarity: 'uncommon',
    description: 'Surgical trauma pack restoring +65 HP in the field.',
    healAmount: 65,
  },
  trauma_kit: {
    templateId: 'trauma_kit',
    name: 'Secronom Trauma Pack',
    category: 'med',
    width: 2,
    height: 2,
    valueUsd: 165,
    rarity: 'military',
    description: 'Restores +100 HP and purges early-stage bio-infection.',
    healAmount: 100,
    curesInfection: true,
  },
  antiviral: {
    templateId: 'antiviral',
    name: 'Antiviral Auto-Injector',
    category: 'antiviral',
    width: 1,
    height: 2,
    valueUsd: 110,
    rarity: 'bio',
    description: 'Neutralizes active zombie mutation/infection and restores +18 HP.',
    healAmount: 18,
    curesInfection: true,
  },
  canned_beans: {
    templateId: 'canned_beans',
    name: 'Canned Rations',
    category: 'food',
    width: 1,
    height: 1,
    valueUsd: 30,
    rarity: 'common',
    description: 'Preserved ration tin restoring +35% Hunger.',
    hungerAmount: 35,
  },
  cooked_steak: {
    templateId: 'cooked_steak',
    name: 'Char-Grilled Meal',
    category: 'food',
    width: 2,
    height: 1,
    valueUsd: 65,
    rarity: 'uncommon',
    description: 'Chef-prepared hot meal restoring +65% Hunger and +10 HP.',
    hungerAmount: 65,
    healAmount: 10,
  },
  mre_ration: {
    templateId: 'mre_ration',
    name: 'Military MRE Pack',
    category: 'food',
    width: 2,
    height: 1,
    valueUsd: 115,
    rarity: 'military',
    description: 'High-calorie combat ration restoring 100% Hunger and +20 HP.',
    hungerAmount: 100,
    healAmount: 20,
  },
  armor_patch: {
    templateId: 'armor_patch',
    name: 'Kevlar Repair Kit',
    category: 'armor',
    width: 2,
    height: 1,
    valueUsd: 75,
    rarity: 'uncommon',
    description: 'Ballistic fiber weave that repairs +45 Armor Durability.',
    armorRepair: 45,
  },
  kevlar_plate: {
    templateId: 'kevlar_plate',
    name: 'Exo-Ceramic Armor Plate',
    category: 'armor',
    width: 2,
    height: 2,
    valueUsd: 180,
    rarity: 'military',
    description: 'Heavy trauma plate restoring +100 Durability and boosting absorption to 60%.',
    armorRepair: 100,
  },
  rifle_ammo: {
    templateId: 'rifle_ammo',
    name: '5.56mm NATO Box',
    category: 'ammo',
    width: 1,
    height: 2,
    valueUsd: 45,
    rarity: 'common',
    description: 'Adds +60 rounds to Assault Rifle & SMG reserves.',
    ammoType: 'rifle',
    ammoCount: 60,
  },
  shotgun_shells: {
    templateId: 'shotgun_shells',
    name: '12-Gauge Buckshot Box',
    category: 'ammo',
    width: 1,
    height: 2,
    valueUsd: 50,
    rarity: 'common',
    description: 'Adds +24 shells to Shotgun reserves.',
    ammoType: 'shotgun',
    ammoCount: 24,
  },
  sniper_ammo: {
    templateId: 'sniper_ammo',
    name: '7.62mm Match Grade',
    category: 'ammo',
    width: 1,
    height: 2,
    valueUsd: 65,
    rarity: 'rare',
    description: 'Adds +18 high-velocity rounds to Sniper & Pistol reserves.',
    ammoType: 'sniper',
    ammoCount: 18,
  },
  heavy_fuel: {
    templateId: 'heavy_fuel',
    name: 'Vulcan Linked Drum',
    category: 'ammo',
    width: 2,
    height: 2,
    valueUsd: 95,
    rarity: 'military',
    description: 'Adds +100 rounds to Heavy Weapon reserves.',
    ammoType: 'heavy',
    ammoCount: 100,
  },
  bio_sample: {
    templateId: 'bio_sample',
    name: 'Mutagenic Tissue Vial',
    category: 'valuables',
    width: 1,
    height: 2,
    valueUsd: 220,
    rarity: 'bio',
    description: 'High-value Secronom specimen sought by Outpost researchers.',
  },
};

export function canPlaceInGrid(
  cols: number,
  rows: number,
  items: InventoryItem[],
  width: number,
  height: number,
  gridX: number,
  gridY: number,
  ignoreId?: string,
): boolean {
  if (gridX < 0 || gridY < 0 || gridX + width > cols || gridY + height > rows) {
    return false;
  }
  for (const item of items) {
    if (ignoreId && item.id === ignoreId) continue;
    const overlapsX = gridX < item.gridX + item.width && gridX + width > item.gridX;
    const overlapsY = gridY < item.gridY + item.height && gridY + height > item.gridY;
    if (overlapsX && overlapsY) return false;
  }
  return true;
}

export function findGridSlot(
  cols: number,
  rows: number,
  items: InventoryItem[],
  width: number,
  height: number,
): { gridX: number; gridY: number } | null {
  for (let y = 0; y <= rows - height; y += 1) {
    for (let x = 0; x <= cols - width; x += 1) {
      if (canPlaceInGrid(cols, rows, items, width, height, x, y)) {
        return { gridX: x, gridY: y };
      }
    }
  }
  return null;
}

export function createInventoryItem(
  templateId: string,
  id: string,
  gridX = 0,
  gridY = 0,
  quantity = 1,
): InventoryItem | null {
  const tpl = ITEM_TEMPLATES[templateId];
  if (!tpl) return null;
  return {
    id,
    templateId: tpl.templateId,
    name: tpl.name,
    category: tpl.category,
    width: tpl.width,
    height: tpl.height,
    gridX,
    gridY,
    quantity,
    valueUsd: tpl.valueUsd,
    rarity: tpl.rarity,
    description: tpl.description,
    healAmount: tpl.healAmount,
    hungerAmount: tpl.hungerAmount,
    curesInfection: tpl.curesInfection,
    armorRepair: tpl.armorRepair,
    ammoType: tpl.ammoType,
    ammoCount: tpl.ammoCount,
  };
}

export function addItemToInventory(
  player: PlayerState,
  templateId: string,
  id: string,
  quantity = 1,
): InventoryItem | null {
  const tpl = ITEM_TEMPLATES[templateId];
  if (!tpl) return null;
  const slot = findGridSlot(
    player.inventoryCols,
    player.inventoryRows,
    player.inventory,
    tpl.width,
    tpl.height,
  );
  if (!slot) return null;
  const item = createInventoryItem(templateId, id, slot.gridX, slot.gridY, quantity);
  if (!item) return null;
  player.inventory.push(item);
  return item;
}

export function moveInventoryItem(
  player: PlayerState,
  itemId: string,
  targetX: number,
  targetY: number,
): boolean {
  const item = player.inventory.find((entry) => entry.id === itemId);
  if (!item) return false;
  if (
    !canPlaceInGrid(
      player.inventoryCols,
      player.inventoryRows,
      player.inventory,
      item.width,
      item.height,
      targetX,
      targetY,
      item.id,
    )
  ) {
    return false;
  }
  item.gridX = targetX;
  item.gridY = targetY;
  return true;
}

export function createWeapons(): Record<WeaponId, WeaponState> {
  return {
    melee: { ...WEAPONS.melee },
    pistol: { ...WEAPONS.pistol },
    rifle: { ...WEAPONS.rifle },
    shotgun: { ...WEAPONS.shotgun },
    smg: { ...WEAPONS.smg },
    sniper: { ...WEAPONS.sniper },
    heavy: { ...WEAPONS.heavy },
  };
}

export function createDefaultQuests(): OutpostQuest[] {
  return [
    {
      id: 'q-perimeter',
      title: 'Perimeter Sweep',
      description: "Eliminate 6 Infected outside Nastya's Holdout.",
      targetKills: 6,
      progressKills: 0,
      rewardCash: 160,
      rewardXp: 140,
      rewardScrap: 25,
      completed: false,
      claimed: false,
    },
    {
      id: 'q-mutants',
      title: 'Bio-Hazard Purge',
      description: 'Eliminate 2 Acid Spitters or Leapers in the quarantine zone.',
      targetKills: 2,
      progressKills: 0,
      targetVariant: 'spitter',
      rewardCash: 280,
      rewardXp: 240,
      rewardScrap: 45,
      completed: false,
      claimed: false,
    },
    {
      id: 'q-titan',
      title: 'Secronom Priority Alpha',
      description: 'Bring down 1 Flesh Pounder Titan in the Deep Outlands.',
      targetKills: 1,
      progressKills: 0,
      targetVariant: 'titan',
      rewardCash: 550,
      rewardXp: 450,
      rewardScrap: 90,
      completed: false,
      claimed: false,
    },
  ];
}

function rectsOverlap(a: Obstacle, b: Obstacle, pad = 0.6): boolean {
  return !(
    a.x + a.width + pad <= b.x ||
    b.x + b.width + pad <= a.x ||
    a.y + a.height + pad <= b.y ||
    b.y + b.height + pad <= a.y
  );
}

const CONTAINER_KINDS: Array<{ kind: ContainerKind; label: string; duration: number }> = [
  { kind: 'car_trunk', label: 'Abandoned Sedan Trunk', duration: 1.0 },
  { kind: 'trash_bin', label: 'Quarantine Dumpster', duration: 0.85 },
  { kind: 'dead_body', label: 'Fallen Evacuation Medic', duration: 0.95 },
  { kind: 'wooden_crate', label: 'CEDA Supply Crate', duration: 1.1 },
  { kind: 'military_cabinet', label: 'Secronom Field Locker', duration: 1.25 },
];

// City grid: every chunk is one block ringed by streets. Local tile 0 and 13 are road (neighbouring
// chunks meet in a 2-tile street), 1 and 12 are sidewalk, 2..11 is the block's lot where buildings stand.
export type SurfaceKind = 'road' | 'sidewalk' | 'lot';
const LOT_MIN = 2;
const LOT_MAX = CHUNK_SIZE - 2;

export function surfaceAt(x: number, y: number): SurfaceKind {
  const lx = ((Math.floor(x) % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((Math.floor(y) % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const edge = Math.min(lx, ly, CHUNK_SIZE - 1 - lx, CHUNK_SIZE - 1 - ly);
  return edge === 0 ? 'road' : edge === 1 ? 'sidewalk' : 'lot';
}

const snapQ = (v: number) => Math.round(v * 4) / 4;

/** Top-left of a w x h footprint fully inside block (cx, cy)'s lot. */
function lotSpot(rng: () => number, cx: number, cy: number, w: number, h: number): Vec2 {
  return {
    x: snapQ(cx * CHUNK_SIZE + LOT_MIN + rng() * (LOT_MAX - LOT_MIN - w)),
    y: snapQ(cy * CHUNK_SIZE + LOT_MIN + rng() * (LOT_MAX - LOT_MIN - h)),
  };
}

/** Top-left of a w x h wreck sitting in one lane of a street bordering block (cx, cy), clear of intersections. */
function roadSpot(rng: () => number, cx: number, cy: number, w: number, h: number): Vec2 {
  const ox = cx * CHUNK_SIZE;
  const oy = cy * CHUNK_SIZE;
  const along = LOT_MIN + rng() * (LOT_MAX - LOT_MIN - Math.max(w, h));
  // The street's centre line is the chunk border; drift into either lane but stay on the 2-tile road.
  const lane = rng() < 0.5 ? -0.3 : 0.3;
  switch (Math.floor(rng() * 4)) {
    case 0: return { x: snapQ(ox + lane - w / 2), y: snapQ(oy + along) };
    case 1: return { x: snapQ(ox + CHUNK_SIZE + lane - w / 2), y: snapQ(oy + along) };
    case 2: return { x: snapQ(ox + along), y: snapQ(oy + lane - h / 2) };
    default: return { x: snapQ(ox + along), y: snapQ(oy + CHUNK_SIZE + lane - h / 2) };
  }
}

/** Point `out` tiles outside a wall of `obs`; the middle of the south wall is the door, so it stays clear. */
function wallSpot(rng: () => number, obs: Obstacle, out: number): Vec2 {
  const t = 0.12 + rng() * 0.76;
  switch (Math.floor(rng() * 4)) {
    case 0: return { x: obs.x - out, y: obs.y + obs.height * t };
    case 1: return { x: obs.x + obs.width + out, y: obs.y + obs.height * t };
    case 2: return { x: obs.x + obs.width * t, y: obs.y - out };
    default: return { x: obs.x + obs.width * (rng() < 0.5 ? 0.12 : 0.88), y: obs.y + obs.height + out };
  }
}

/** Point on block (cx, cy)'s sidewalk; `inner` hugs the lot edge (fences, debris), otherwise the curb (lamps). */
function sidewalkSpot(rng: () => number, cx: number, cy: number, inner: boolean): Vec2 {
  const along = LOT_MIN + 0.5 + rng() * (LOT_MAX - LOT_MIN - 1);
  const off = inner ? 1.8 : 1.3;
  const ox = cx * CHUNK_SIZE;
  const oy = cy * CHUNK_SIZE;
  switch (Math.floor(rng() * 4)) {
    case 0: return { x: ox + off, y: oy + along };
    case 1: return { x: ox + CHUNK_SIZE - off, y: oy + along };
    case 2: return { x: ox + along, y: oy + off };
    default: return { x: ox + along, y: oy + CHUNK_SIZE - off };
  }
}

/** Point somewhere on the street band bordering block (cx, cy). */
function streetSpot(rng: () => number, cx: number, cy: number): Vec2 {
  const along = rng() * CHUNK_SIZE;
  const across = (rng() - 0.5) * 1.8;
  const ox = cx * CHUNK_SIZE;
  const oy = cy * CHUNK_SIZE;
  return rng() < 0.5
    ? { x: ox + (rng() < 0.5 ? 0 : CHUNK_SIZE) + across, y: oy + along }
    : { x: ox + along, y: oy + (rng() < 0.5 ? 0 : CHUNK_SIZE) + across };
}

/** Top-left for a structure: buildings in the lot, wrecks in the street, crate stacks against a building. */
function structureSpot(
  rng: () => number,
  kind: Obstacle['kind'],
  cx: number,
  cy: number,
  width: number,
  height: number,
  existing: Obstacle[],
): Vec2 {
  if (kind === 'wreck') return roadSpot(rng, cx, cy, width, height);
  const ruins = existing.filter((o) => o.kind === 'ruin');
  if (kind === 'container' && ruins.length > 0) {
    const c = wallSpot(rng, ruins[Math.floor(rng() * ruins.length)], width / 2 + 0.15);
    return { x: snapQ(c.x - width / 2), y: snapQ(c.y - height / 2) };
  }
  return lotSpot(rng, cx, cy, width, height);
}

/** A searchable container where it would really be: trunks at wrecks, crates/lockers/bodies by walls, dumpsters on the sidewalk. */
function placeContainer(
  rng: () => number,
  id: string,
  anchors: Obstacle[],
  cx: number,
  cy: number,
  tier: ThreatTier,
): WorldContainer {
  const anchor = anchors.length > 0 && rng() < 0.8 ? anchors[Math.floor(rng() * anchors.length)] : null;
  let kind: ContainerKind;
  let p: Vec2;
  if (anchor?.kind === 'wreck') {
    kind = 'car_trunk';
    p = wallSpot(rng, anchor, 0.8);
  } else if (anchor) {
    const wallKinds: ContainerKind[] = tier >= 2
      ? ['wooden_crate', 'military_cabinet', 'dead_body', 'trash_bin']
      : ['wooden_crate', 'dead_body', 'trash_bin'];
    kind = wallKinds[Math.floor(rng() * wallKinds.length)];
    p = wallSpot(rng, anchor, 0.8);
  } else {
    kind = rng() < 0.6 ? 'trash_bin' : 'dead_body';
    p = sidewalkSpot(rng, cx, cy, true);
  }
  const spec = CONTAINER_KINDS.find((k) => k.kind === kind) ?? CONTAINER_KINDS[0];
  return {
    id,
    kind,
    label: spec.label,
    x: snapQ(p.x),
    y: snapQ(p.y),
    searched: false,
    searchProgress: 0,
    searchDuration: spec.duration,
    threatTier: tier,
  };
}

function chunkHashSeed(seed: number, cx: number, cy: number): number {
  let h = (seed ^ MAP_SEED_MASK) >>> 0;
  h = Math.imul(h ^ (cx * 374761393), 668265263);
  h = Math.imul(h ^ (cy * 2246822519), 3266489917);
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * Deterministically generates a 14x14-tile city chunk anywhere in the infinite
 * quarantine coordinate plane, complete with obstacles, searchable loot containers,
 * and AAA street props (burned vehicles, barricades, streetlights, barrel fires,
 * blood stains, cracked asphalt, and overgrown foliage).
 */
export function generateChunk(seed: number, cx: number, cy: number): WorldChunk {
  const rng = rngFromSeed(chunkHashSeed(seed, cx, cy));
  const key = chunkKey(cx, cy);
  const worldX = cx * CHUNK_SIZE;
  const worldY = cy * CHUNK_SIZE;
  const tier = chunkThreatTier(cx, cy);
  const outpost = OUTPOSTS.find(
    (o) => chunkCoordAt(o.x) === cx && chunkCoordAt(o.y) === cy,
  );
  const isSafeZone = (cx === 1 && cy === 1) || Boolean(outpost);

  const obstacles: Obstacle[] = [];
  const containers: WorldContainer[] = [];
  const props: StreetProp[] = [];

  const addProp = (kind: StreetPropKind, p: Vec2, castsLight = false) => {
    props.push({
      id: `prop-${key}-${props.length}`,
      kind,
      x: snapQ(p.x),
      y: snapQ(p.y),
      scale: 0.85 + rng() * 0.3,
      rotation: (rng() - 0.5) * 0.6,
      castsLight,
      flickerPhase: rng() * Math.PI * 2,
    });
  };

  // Street lamps stand on the curb of every sidewalk, two per side; some are dead or missing.
  for (const along of [4.5, 9.5]) {
    for (const curb of [1.3, CHUNK_SIZE - 1.3]) {
      for (const [dx, dy] of [[curb, along], [along, curb]]) {
        if (rng() < 0.3) continue;
        addProp('streetlight', { x: worldX + dx, y: worldY + dy }, true);
      }
    }
  }

  // Blood and cracked asphalt are flat decals on the street and sidewalk.
  const decalCount = isSafeZone ? 2 : 4 + tier * 2;
  for (let i = 0; i < decalCount; i += 1) {
    addProp(rng() < 0.45 ? 'blood_stain' : 'cracked_asphalt', streetSpot(rng, cx, cy));
  }

  // Abandoned cars and checkpoint barricades only ever sit in the street.
  if (!isSafeZone) {
    if (rng() < 0.35 + tier * 0.15) {
      const p = roadSpot(rng, cx, cy, 1.3, 1.3);
      addProp('burned_car', { x: p.x + 0.65, y: p.y + 0.65 });
    }
    if (rng() < 0.15 + tier * 0.12) {
      const p = roadSpot(rng, cx, cy, 1, 1);
      addProp('barricade', { x: p.x + 0.5, y: p.y + 0.5 });
    }
  }

  // Outside the primary 3x3 starting sector, procedurally populate obstacles & containers per chunk
  const inStarterGrid = cx >= 0 && cx <= 2 && cy >= 0 && cy <= 2;
  if (!inStarterGrid && !isSafeZone) {
    const kinds: Obstacle['kind'][] = ['ruin', 'ruin', 'wreck', 'container'];
    const targetObstacles = 5 + tier;
    let attempts = 0;
    while (obstacles.length < targetObstacles && attempts < 50) {
      attempts += 1;
      const kind = kinds[Math.floor(rng() * kinds.length)];
      const width = kind === 'ruin' ? 2.5 + Math.floor(rng() * 3) * 0.5 : 1.3;
      const height = kind === 'ruin' ? 2.5 + Math.floor(rng() * 3) * 0.5 : 1.3;
      const spot = structureSpot(rng, kind, cx, cy, width, height, obstacles);
      const candidate: Obstacle = {
        id: `obs-chunk-${key}-${obstacles.length}`,
        x: spot.x,
        y: spot.y,
        width,
        height,
        kind,
      };
      const pad = kind === 'container' ? 0.1 : 0.7;
      if (obstacles.some((existing) => rectsOverlap(existing, candidate, pad))) continue;
      obstacles.push(candidate);
    }

    const anchors = obstacles.filter((o) => o.kind === 'ruin' || o.kind === 'wreck');
    const targetContainers = 1 + tier;
    for (let i = 0; i < targetContainers; i += 1) {
      const c = placeContainer(rng, `cnt-chunk-${key}-${i}`, anchors, cx, cy, tier);
      if (
        obstacles.some(
          (o) => c.x >= o.x - 0.6 && c.x <= o.x + o.width + 0.6 && c.y >= o.y - 0.6 && c.y <= o.y + o.height + 0.6,
        )
      ) {
        continue;
      }
      containers.push(c);
    }
  }

  // Rubble, trash and weeds pile against building walls, or along the lot edge where there are none.
  const ruins = obstacles.filter((o) => o.kind === 'ruin');
  const debrisKinds: StreetPropKind[] = ['rubble', 'trash_mound', 'foliage', 'trash_mound', 'cracked_asphalt', 'blood_stain'];
  const debrisCount = isSafeZone ? 1 : 2 + tier;
  for (let i = 0; i < debrisCount; i += 1) {
    const kind: StreetPropKind =
      tier >= 1 && rng() < 0.12 ? 'barrel_fire' : debrisKinds[Math.floor(rng() * debrisKinds.length)];
    const p =
      ruins.length > 0 && rng() < 0.7
        ? wallSpot(rng, ruins[Math.floor(rng() * ruins.length)], 0.55)
        : sidewalkSpot(rng, cx, cy, true);
    addProp(kind, p, kind === 'barrel_fire');
  }

  return {
    cx,
    cy,
    key,
    code: chunkCodeFor(cx, cy),
    regionName: regionNameForChunk(cx, cy),
    worldX,
    worldY,
    size: CHUNK_SIZE,
    tier,
    isSafeZone,
    outpostId: outpost?.id,
    obstacles,
    containers,
    props,
  };
}

/**
 * Streams in chunks within `radius` around the survivor's current chunk and
 * unloads distant chunks outside `radius + 1` to keep memory and draw calls bounded.
 */
export function syncActiveChunks(
  map: WorldMap,
  playerX: number,
  playerY: number,
  radius = ACTIVE_CHUNK_RADIUS,
): WorldChunk[] {
  if (!map.activeChunks) {
    map.activeChunks = {};
  }
  const pcx = chunkCoordAt(playerX);
  const pcy = chunkCoordAt(playerY);
  const keepKeys = new Set<string>();

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const cx = pcx + dx;
      const cy = pcy + dy;
      const key = chunkKey(cx, cy);
      keepKeys.add(key);
      if (!map.activeChunks[key]) {
        map.activeChunks[key] = generateChunk(map.seed, cx, cy);
      }
    }
  }

  // Unload chunks more than radius + CHUNK_UNLOAD_MARGIN away so chunk edges never clip into the 2.0x viewport
  for (const [key, chunk] of Object.entries(map.activeChunks)) {
    if (
      Math.abs(chunk.cx - pcx) > radius + CHUNK_UNLOAD_MARGIN ||
      Math.abs(chunk.cy - pcy) > radius + CHUNK_UNLOAD_MARGIN
    ) {
      delete map.activeChunks[key];
    }
  }

  map.sectors = buildSectorGrid(pcx, pcy);
  return Object.values(map.activeChunks);
}

export function createMap(seed: number = 0x51f15e): WorldMap {
  const rng = rngFromSeed((seed ^ MAP_SEED_MASK) >>> 0);
  const obstacles: Obstacle[] = [];

  // 4 rectangular guard towers flanking the North/South/East/West gates of Block B2 (clear of corner diagonals)
  const towerCorners: Vec2[] = [
    { x: SAFE_CENTER.x - SAFE_RADIUS - 1.4, y: SAFE_CENTER.y - 3.6 },
    { x: SAFE_CENTER.x + 2.4, y: SAFE_CENTER.y - SAFE_RADIUS - 1.4 },
    { x: SAFE_CENTER.x + SAFE_RADIUS + 0.2, y: SAFE_CENTER.y + 2.4 },
    { x: SAFE_CENTER.x - 3.6, y: SAFE_CENTER.y + SAFE_RADIUS + 0.2 },
  ];
  for (let i = 0; i < TOWER_COUNT; i += 1) {
    const corner = towerCorners[i % towerCorners.length];
    obstacles.push({
      id: `tower-${i}`,
      x: corner.x,
      y: corner.y,
      width: 1.2,
      height: 1.2,
      kind: 'tower',
    });
  }

  const kinds: Obstacle['kind'][] = ['ruin', 'ruin', 'wreck', 'container'];
  let attempts = 0;
  while (obstacles.length < STRUCTURE_COUNT + TOWER_COUNT && attempts < 400) {
    attempts += 1;
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const width = kind === 'ruin' ? 2.5 + Math.floor(rng() * 3) * 0.5 : 1.3;
    const height = kind === 'ruin' ? 2.5 + Math.floor(rng() * 3) * 0.5 : 1.3;
    const block = { x: Math.floor(rng() * SECTOR_COLS), y: Math.floor(rng() * SECTOR_ROWS) };
    const { x, y } = structureSpot(rng, kind, block.x, block.y, width, height, obstacles);
    if (x < WORLD_MARGIN || y < WORLD_MARGIN || x + width > WORLD_WIDTH - WORLD_MARGIN || y + height > WORLD_HEIGHT - WORLD_MARGIN) {
      continue;
    }
    const center = { x: x + width / 2, y: y + height / 2 };
    const dist = distance(center, SAFE_CENTER);
    const boxDist = Math.max(Math.abs(center.x - SAFE_CENTER.x), Math.abs(center.y - SAFE_CENTER.y));
    if (dist < SAFE_RADIUS + 2.8 || boxDist < SAFE_RADIUS + 1.8) continue;

    const candidate: Obstacle = {
      id: `obs-${obstacles.length}`,
      x: Math.round(x * 4) / 4,
      y: Math.round(y * 4) / 4,
      width,
      height,
      kind,
    };
    const pad = kind === 'container' ? 0.1 : 0.85;
    if (obstacles.some((existing) => rectsOverlap(existing, candidate, pad))) {
      continue;
    }
    obstacles.push(candidate);
  }

  const baseMap: WorldMap = {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    seed,
    safeCenter: { ...SAFE_CENTER },
    safeRadius: SAFE_RADIUS,
    infinite: false,
    chunkSize: CHUNK_SIZE,
    activeChunks: {},
    outposts: OUTPOSTS.map((o) => ({ ...o })),
    sectors: buildSectorGrid(1, 1),
    obstacles,
    containers: [],
  };

  // Populate searchable world containers outside the S-Zone, against walls, wrecks and sidewalks.
  const containers: WorldContainer[] = [];
  const anchors = obstacles.filter((o) => o.kind === 'ruin' || o.kind === 'wreck');
  let containerAttempts = 0;
  while (containers.length < 22 && containerAttempts < 180) {
    containerAttempts += 1;
    const block = { x: Math.floor(rng() * SECTOR_COLS), y: Math.floor(rng() * SECTOR_ROWS) };
    // Pick from every kind; the real tier is only known once placed, so lockers are filtered below.
    const probe = placeContainer(rng, `cnt-${containers.length + 1}`, anchors, block.x, block.y, 3);
    if (isInsideSafeZone(baseMap, probe.x, probe.y, -1.2)) continue;
    if (isBlocked(baseMap, probe.x, probe.y, 0.65)) continue;
    if (containers.some((c) => distance(c, probe) < 3.4)) continue;

    const tier = threatTierAt(baseMap, probe.x, probe.y);
    if (rng() > BASE_CONTAINER_KEEP[tier]) continue;
    if (tier < 2 && probe.kind === 'military_cabinet') continue;
    containers.push({ ...probe, threatTier: tier });
  }
  baseMap.containers = containers;
  baseMap.doors = createDoorsForMap(baseMap);
  syncActiveChunks(baseMap, SAFE_CENTER.x, SAFE_CENTER.y, ACTIVE_CHUNK_RADIUS);

  return baseMap;
}

export function distanceOutsideSafeZone(map: WorldMap, x: number, y: number): number {
  let minDist = Infinity;
  const checkCenters = [
    { x: map.safeCenter.x, y: map.safeCenter.y, r: map.safeRadius },
    ...map.outposts.map((o) => ({ x: o.x, y: o.y, r: o.radius })),
  ];
  for (const c of checkCenters) {
    const dx = Math.max(0, Math.abs(x - c.x) - c.r);
    const dy = Math.max(0, Math.abs(y - c.y) - c.r);
    const d = Math.hypot(dx, dy);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

export function isInsideSafeZone(map: WorldMap, x: number, y: number, pad = 0): boolean {
  const half = map.safeRadius - pad;
  if (Math.abs(x - map.safeCenter.x) <= half && Math.abs(y - map.safeCenter.y) <= half) {
    return true;
  }
  for (const outpost of map.outposts) {
    const oHalf = outpost.radius - pad;
    if (Math.abs(x - outpost.x) <= oHalf && Math.abs(y - outpost.y) <= oHalf) {
      return true;
    }
  }
  return false;
}

export function getActiveOutpost(map: WorldMap, x: number, y: number): OutpostInfo | null {
  for (const outpost of map.outposts) {
    if (
      Math.abs(x - outpost.x) <= outpost.radius &&
      Math.abs(y - outpost.y) <= outpost.radius
    ) {
      return outpost;
    }
  }
  if (isInsideSafeZone(map, x, y)) {
    return map.outposts[0] ?? null;
  }
  return null;
}

export function getNearestOutpost(map: WorldMap, x: number, y: number): OutpostInfo {
  let best = map.outposts[0] ?? OUTPOSTS[0];
  let bestDist = distance({ x, y }, best);
  for (const outpost of map.outposts) {
    const d = distance({ x, y }, outpost);
    if (d < bestDist) {
      bestDist = d;
      best = outpost;
    }
  }
  return best;
}

export function threatTierAt(map: WorldMap, x: number, y: number): ThreatTier {
  if (isInsideSafeZone(map, x, y)) return 0;
  const d = distance({ x, y }, map.safeCenter);
  if (d <= THREAT_BAND_1) return 1;
  if (d <= THREAT_BAND_2) return 2;
  return 3;
}

/** Circle-vs-AABB test across both core sector obstacles and dynamically streamed chunks. */
export function isBlocked(map: WorldMap, x: number, y: number, radius: number): boolean {
  if (!map.infinite) {
    if (
      x - radius < 0.8 ||
      y - radius < 0.8 ||
      x + radius > map.width - 0.8 ||
      y + radius > map.height - 0.8
    ) {
      return true;
    }
  }

  for (const obs of map.obstacles) {
    const nearestX = clamp(x, obs.x, obs.x + obs.width);
    const nearestY = clamp(y, obs.y, obs.y + obs.height);
    const dx = x - nearestX;
    const dy = y - nearestY;
    if (dx * dx + dy * dy < radius * radius) {
      return true;
    }
  }

  if (map.activeChunks) {
    const cx = chunkCoordAt(x);
    const cy = chunkCoordAt(y);
    const chunk = map.activeChunks[chunkKey(cx, cy)];
    if (chunk) {
      for (const obs of chunk.obstacles) {
        const nearestX = clamp(x, obs.x, obs.x + obs.width);
        const nearestY = clamp(y, obs.y, obs.y + obs.height);
        const dx = x - nearestX;
        const dy = y - nearestY;
        if (dx * dx + dy * dy < radius * radius) {
          return true;
        }
      }
    }
  }

  return false;
}

/** Axis-separated slide so diagonal movement glides along walls instead of sticking. */
export function moveWithCollision(
  map: WorldMap,
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius: number,
): Vec2 {
  let nextX = x;
  let nextY = y;
  if (!isBlocked(map, x + dx, y, radius)) {
    nextX = x + dx;
  }
  if (!isBlocked(map, nextX, y + dy, radius)) {
    nextY = y + dy;
  }
  return { x: nextX, y: nextY };
}

/** Zombies cannot enter the rectangular S-Zone Block (B2); if they step across the perimeter, push them out. */
export function safeZoneStopPoint(map: WorldMap, x: number, y: number, radius: number): Vec2 {
  const half = map.safeRadius + radius + 0.15;
  const dx = x - map.safeCenter.x;
  const dy = y - map.safeCenter.y;
  if (Math.abs(dx) >= half || Math.abs(dy) >= half) {
    return { x, y };
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    const signX = dx === 0 ? 1 : Math.sign(dx);
    return { x: map.safeCenter.x + signX * half, y };
  }
  const signY = dy === 0 ? 1 : Math.sign(dy);
  return { x, y: map.safeCenter.y + signY * half };
}

export function createPlayer(stash = 0): PlayerState {
  const attributes: PlayerAttributes = {
    strength: 25,
    agility: 25,
    endurance: 25,
    criticalHit: 25,
    accuracy: 25,
    reloading: 25,
  };
  const proficiencies: Record<WeaponProficiencyId, number> = {
    melee: 20,
    pistol: 20,
    shotgun: 20,
    smg: 15,
    rifle: 15,
    assault: 25,
    heavy: 10,
  };

  const player: PlayerState = {
    x: SAFE_CENTER.x,
    y: SAFE_CENTER.y,
    vx: 0,
    vy: 0,
    knockbackVx: 0,
    knockbackVy: 0,
    knockbackTimer: 0,
    angle: 0,
    radius: 0.36,
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    hunger: 100,
    maxHunger: 100,
    armorName: 'Light Kevlar Vest',
    armorAbsorption: 0.45,
    armorDurability: 80,
    armorMaxDurability: 80,
    armorWeightPenalty: 0.03,
    infected: false,
    infectionSeverity: 0,
    flashlightOn: true,
    reticleBloom: 0.18,
    focusFactor: 0.82,
    activeWeapon: 'rifle',
    weapons: createWeapons(),
    loadout: ['rifle', 'shotgun'],
    fireCooldown: 0,
    meleeInputHeld: false,
    meleeImpactTimer: 0,
    meleeImpactPending: false,
    interactionCooldown: 0,
    reloadTimer: 0,
    invulnerableTimer: 0,
    carriedScrap: 0,
    stash,
    carriedCash: 0,
    bankCash: 150,
    level: 1,
    xp: 0,
    unbankedXp: 0,
    statPoints: 5,
    proficiencyPoints: 10,
    attributes,
    proficiencies,
    profession: 'Doctor',
    inventoryCols: 6,
    inventoryRows: 4,
    inventory: [],
    stashedItems: [],
    quests: createDefaultQuests(),
    activeOutpostId: 'nastya',
    kills: 0,
    deaths: 0,
    inSafeZone: true,
    threatTier: 0,
    alive: true,
  };

  // Starter survival kit in grid inventory
  addItemToInventory(player, 'bandage', 'init-item-1');
  addItemToInventory(player, 'canned_beans', 'init-item-2');
  addItemToInventory(player, 'antiviral', 'init-item-3');
  addItemToInventory(player, 'armor_patch', 'init-item-4');

  return player;
}

const ZOMBIE_ARCHETYPES: Record<
  ZombieVariant,
  {
    radius: number;
    health: number;
    speed: number;
    damage: number;
    armorReduction: number;
    cloakAlpha: number;
    burningAura: boolean;
    inflictsInfection: boolean;
    isBoss: boolean;
  }
> = {
  walker: {
    radius: 0.36,
    health: 64,
    speed: 1.85,
    damage: 14,
    armorReduction: 0,
    cloakAlpha: 1,
    burningAura: false,
    inflictsInfection: false,
    isBoss: false,
  },
  runner: {
    radius: 0.32,
    health: 42,
    speed: 3.35,
    damage: 11,
    armorReduction: 0,
    cloakAlpha: 1,
    burningAura: false,
    inflictsInfection: false,
    isBoss: false,
  },
  brute: {
    radius: 0.48,
    health: 170,
    speed: 1.35,
    damage: 26,
    armorReduction: 0.15,
    cloakAlpha: 1,
    burningAura: false,
    inflictsInfection: false,
    isBoss: false,
  },
  burning: {
    radius: 0.37,
    health: 78,
    speed: 2.35,
    damage: 19,
    armorReduction: 0,
    cloakAlpha: 1,
    burningAura: true,
    inflictsInfection: false,
    isBoss: false,
  },
  spitter: {
    radius: 0.38,
    health: 68,
    speed: 1.75,
    damage: 12,
    armorReduction: 0,
    cloakAlpha: 1,
    burningAura: false,
    inflictsInfection: true,
    isBoss: false,
  },
  leaper: {
    radius: 0.35,
    health: 86,
    speed: 2.85,
    damage: 20,
    armorReduction: 0.08,
    cloakAlpha: 1,
    burningAura: false,
    inflictsInfection: true,
    isBoss: false,
  },
  titan: {
    radius: 0.56,
    health: 320,
    speed: 1.55,
    damage: 34,
    armorReduction: 0.42,
    cloakAlpha: 1,
    burningAura: false,
    inflictsInfection: true,
    isBoss: true,
  },
  wraith: {
    radius: 0.34,
    health: 74,
    speed: 3.1,
    damage: 22,
    armorReduction: 0.05,
    cloakAlpha: 0.32,
    burningAura: false,
    inflictsInfection: true,
    isBoss: false,
  },
  hound: {
    radius: 0.3,
    health: 48,
    speed: 3.7,
    damage: 13,
    armorReduction: 0,
    cloakAlpha: 1,
    burningAura: false,
    inflictsInfection: true,
    isBoss: false,
  },
};

export function createZombie(
  id: string,
  variant: ZombieVariant,
  pos: Vec2,
  angle = 0,
  siegeWave = false,
): ZombieState {
  const stats = ZOMBIE_ARCHETYPES[variant];
  return {
    id,
    variant,
    x: pos.x,
    y: pos.y,
    vx: 0,
    vy: 0,
    knockbackVx: 0,
    knockbackVy: 0,
    knockbackTimer: 0,
    angle,
    radius: stats.radius,
    health: stats.health,
    maxHealth: stats.health,
    speed: stats.speed,
    damage: stats.damage,
    attackCooldown: 0,
    hitFlash: 0,
    staggerTimer: 0,
    alerted: siegeWave,
    limbs: {
      head: true,
      torso: true,
      leftArm: true,
      rightArm: true,
      legs: true,
    },
    spitCooldown: variant === 'spitter' ? 1.4 : 0,
    leapCooldown: variant === 'leaper' ? 2.2 : 0,
    leapingTimer: 0,
    armorReduction: stats.armorReduction,
    cloakAlpha: stats.cloakAlpha,
    burningAura: stats.burningAura,
    inflictsInfection: stats.inflictsInfection,
    isBoss: stats.isBoss,
    siegeWave,
  };
}

export function chooseZombieVariant(
  tier: ThreatTier,
  rng: () => number = Math.random,
): ZombieVariant {
  const roll = rng();
  if (tier === 0) return 'walker';
  if (tier === 1) {
    return roll < 0.72 ? 'walker' : 'runner';
  }
  if (tier === 2) {
    if (roll < 0.48) return 'walker';
    if (roll < 0.86) return 'runner';
    return 'brute';
  }
  if (roll < 0.28) return 'walker';
  if (roll < 0.72) return 'runner';
  return 'brute';
}

/**
 * Extended Dead Frontier / Dead Nation variant selector factoring in threat
 * zone tier and current Zombie Aggro Index to spawn standard infected, spitters,
 * burning zombies, hounds, wraiths, leapers, and boss Titans.
 */
export function chooseExtendedZombieVariant(
  tier: ThreatTier,
  aggroIndex: number,
  rng: () => number = Math.random,
): ZombieVariant {
  const roll = rng();
  const aggroBoost = clamp(aggroIndex / 100, 0, 1) * 0.14;

  if (tier <= 1) {
    if (roll < 0.48 - aggroBoost) return 'walker';
    if (roll < 0.74) return 'runner';
    if (roll < 0.88) return 'hound';
    return 'burning';
  }

  if (tier === 2) {
    if (roll < 0.24) return 'walker';
    if (roll < 0.44) return 'runner';
    if (roll < 0.58) return 'burning';
    if (roll < 0.72) return 'spitter';
    if (roll < 0.84) return 'hound';
    if (roll < 0.93) return 'leaper';
    return 'brute';
  }

  // Tier 3 (Deep Outlands / Bio-Labs)
  if (roll < 0.14) return 'walker';
  if (roll < 0.28) return 'runner';
  if (roll < 0.40) return 'burning';
  if (roll < 0.54) return 'spitter';
  if (roll < 0.67) return 'leaper';
  if (roll < 0.78) return 'wraith';
  if (roll < 0.88) return 'hound';
  if (roll < 0.94) return 'brute';
  return 'titan';
}

export function findSpawnPoint(
  map: WorldMap,
  around: Vec2,
  minDistance: number,
  maxDistance: number,
  rng: () => number = Math.random,
): Vec2 | null {
  for (let i = 0; i < 36; i += 1) {
    const angle = rng() * Math.PI * 2;
    const dist = minDistance + rng() * (maxDistance - minDistance);
    const x = around.x + Math.cos(angle) * dist;
    const y = around.y + Math.sin(angle) * dist;
    if (isInsideSafeZone(map, x, y, -1.6)) continue;
    if (isBlocked(map, x, y, 0.5)) continue;
    return { x, y };
  }
  return null;
}

export function createWorld(seed: number = 0x51f15e, stash = 0, outpostId?: string): WorldState {
  const map = createMap(seed);
  map.infinite = true;
  const player = createPlayer(stash);
  const rng = rngFromSeed((seed ^ 0x85ebca6b) >>> 0);

  // Spawn override: deploy directly into a chosen safezone outpost.
  if (outpostId) {
    const outpost = OUTPOSTS.find((o) => o.id === outpostId);
    if (outpost) {
      player.x = outpost.x;
      player.y = outpost.y;
    }
  }
  const zombies: ZombieState[] = [];
  let nextEntityId = 1;

  // Sparse just outside the Outpost, thickening with each threat band (base-map corners only reach tier 3).
  const seedBands: Array<[minDist: number, maxDist: number, count: number]> = [
    [SAFE_RADIUS + 2, THREAT_BAND_1, 13],
  ];
  for (const [minDist, maxDist, count] of seedBands) {
    let placed = 0;
    for (let attempt = 0; placed < count && attempt < count * 6; attempt += 1) {
      const pos = findSpawnPoint(map, map.safeCenter, minDist, maxDist, rng);
      if (!pos || pos.x < 1 || pos.y < 1 || pos.x > map.width - 1 || pos.y > map.height - 1) continue;
      const variant = selectZoneThemedZombieVariant(map, pos.x, pos.y, 12, rng);
      const dir = normalize({ x: map.safeCenter.x - pos.x, y: map.safeCenter.y - pos.y });
      zombies.push(
        createZombie(`z-${nextEntityId++}`, variant, pos, Math.atan2(dir.y, dir.x)),
      );
      placed += 1;
    }
  }

  return {
    phase: 'playing',
    tick: 0,
    time: 0,
    map,
    player,
    zombies,
    pickups: [],
    projectiles: [],
    soundPulses: [],
    events: [],
    spawnTimer: 1.6,
    nextEntityId,
    aggroIndex: 12,
  };
}

/**
 * Spatial Interest Management (AoI) packet builder for multiplayer netcode.
 * Filters players, shots,gore seeds, and zombies strictly within `interestRadius`
 * of `origin` so clients only receive state within their vision radius.
 */
export function buildSpatialNetPacket(
  state: WorldState,
  origin: Vec2 = { x: state.player.x, y: state.player.y },
  interestRadius = 18,
): SpatialNetPacket {
  const rSq = interestRadius * interestRadius;
  const inRange = (p: Vec2) => {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    return dx * dx + dy * dy <= rSq;
  };

  const shots = state.events
    .filter(
      (e): e is Extract<typeof state.events[number], { type: 'shot' }> =>
        e.type === 'shot' && inRange({ x: e.x, y: e.y }),
    )
    .map((e, idx) => ({
      weapon: e.weapon,
      x: Number(e.x.toFixed(2)),
      y: Number(e.y.toFixed(2)),
      angle: Number(e.angle.toFixed(3)),
      goreSeed: ((state.tick * 2654435761 + idx * 374761393) >>> 0),
    }));

  const zombies = state.zombies
    .filter((z) => inRange(z))
    .map((z) => ({
      id: z.id,
      variant: z.variant,
      x: Number(z.x.toFixed(2)),
      y: Number(z.y.toFixed(2)),
      angle: Number(z.angle.toFixed(2)),
      health: Math.round(z.health),
    }));

  return {
    tick: state.tick,
    origin: { x: Number(origin.x.toFixed(2)), y: Number(origin.y.toFixed(2)) },
    interestRadius,
    players: inRange(state.player)
      ? [
          {
            id: 'local-survivor',
            x: Number(state.player.x.toFixed(2)),
            y: Number(state.player.y.toFixed(2)),
            vx: Number(state.player.vx.toFixed(2)),
            vy: Number(state.player.vy.toFixed(2)),
            angle: Number(state.player.angle.toFixed(3)),
            weapon: state.player.activeWeapon,
            health: Math.round(state.player.health),
          },
        ]
      : [],
    shots,
    zombies,
  };
}
