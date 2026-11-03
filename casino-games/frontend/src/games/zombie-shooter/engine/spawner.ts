import { clamp, distance } from './isometric';
import type {
  PlayerState,
  ThreatTier,
  Vec2,
  WeaponId,
  WeaponProficiencyId,
  WorldMap,
  ZombieVariant,
} from './types';
import {
  THREAT_BAND_1,
  THREAT_BAND_2,
  chunkCoordAt,
  isInsideSafeZone,
  regionNameForChunk,
} from './world';

/**
 * Safe Outpost Sanctuary & Zero-to-Hero Progressive Spawner (`/engine/spawner.ts`).
 *
 * Enforces:
 * - Safe Zone Buffer (Tier 0): 400-meter radius around Outpost coordinates `(21, 21)`.
 *   ZERO zombie spawns are permitted inside the Tier 0 Safe Zone radius.
 * - Progressive Distance Threat Scaling outside the Safe Zone perimeter:
 *   `const distanceFromOutpost = Math.hypot(player.x - outpost.x, player.y - outpost.y);`
 *   `const effectiveDistance = Math.max(0, distanceFromOutpost - SAFE_ZONE_RADIUS);`
 *   `const threatTier = Math.min(3, Math.floor(effectiveDistance / 800));`
 * - Strict Weapon Proficiency gating before high-tier weapons can be equipped.
 */
export const SAFE_OUTPOST_ORIGIN: Vec2 = { x: 21, y: 21 };
export const SAFE_ZONE_RADIUS = 400; // meters around Outpost (21, 21)
export const TIER_DISTANCE_STEP_METERS = 800; // 800m per Threat Tier band outside Safe Zone
export const TIER_RADIUS_METERS = 9; // world-tile radius equivalent per tier band
export const METERS_PER_TILE = TIER_DISTANCE_STEP_METERS / TIER_RADIUS_METERS;

export interface ZoneTierMatrixRow {
  tier: ThreatTier;
  name: string;
  riskLabel: string;
  maxActiveZombies: number;
  levelRange: [number, number];
  weaponsUnlocked: WeaponId[];
  spawnableEnemies: ZombieVariant[];
  lootTable: string[];
}

export const ZONE_TIER_MATRIX: Record<ThreatTier, ZoneTierMatrixRow> = {
  0: {
    tier: 0,
    name: 'Safe Outpost Buffer (Tier 0)',
    riskLabel: 'Sanctuary — PvP & Spawns Disabled',
    maxActiveZombies: 0,
    levelRange: [1, 5],
    weaponsUnlocked: ['melee', 'pistol'],
    spawnableEnemies: [],
    lootTable: ['canned_beans', 'bandage', 'rifle_ammo'],
  },
  1: {
    tier: 1,
    name: 'Outer Suburbs (Tier 1)',
    riskLabel: 'Low Risk — Slow Walkers & Crawlers',
    maxActiveZombies: 16,
    levelRange: [5, 15],
    weaponsUnlocked: ['melee', 'pistol', 'shotgun'],
    spawnableEnemies: ['walker', 'runner', 'hound'],
    lootTable: ['canned_beans', 'bandage', 'rifle_ammo', 'shotgun_shells'],
  },
  2: {
    tier: 2,
    name: 'Commercial Sector (Tier 2)',
    riskLabel: 'Medium Risk — Fast Runners, Spitters & Brutes',
    maxActiveZombies: 28,
    levelRange: [15, 30],
    weaponsUnlocked: ['melee', 'pistol', 'shotgun', 'smg', 'rifle', 'sniper'],
    spawnableEnemies: ['runner', 'spitter', 'burning', 'brute', 'hound'],
    lootTable: ['rifle_ammo', 'shotgun_shells', 'medkit', 'armor_patch', 'antiviral'],
  },
  3: {
    tier: 3,
    name: 'Bio-Lab Core (Tier 3)',
    riskLabel: 'Extreme Risk — Titans, Leapers, Wraiths & Hounds',
    maxActiveZombies: 42,
    levelRange: [30, 50],
    weaponsUnlocked: ['melee', 'pistol', 'shotgun', 'smg', 'rifle', 'sniper', 'heavy'],
    spawnableEnemies: ['titan', 'leaper', 'wraith', 'hound', 'brute', 'spitter', 'burning'],
    lootTable: ['heavy_ammo', 'kevlar_plate', 'trauma_kit', 'antiviral', 'mre_ration'],
  },
};

export interface WeaponSkillGate {
  weaponId: WeaponId;
  tier: ThreatTier;
  proficiency: WeaponProficiencyId;
  minProficiency: number;
  minLevel: number;
}

export const WEAPON_SKILL_GATES: Record<WeaponId, WeaponSkillGate> = {
  melee: {
    weaponId: 'melee',
    tier: 0,
    proficiency: 'melee',
    minProficiency: 0,
    minLevel: 1,
  },
  pistol: {
    weaponId: 'pistol',
    tier: 0,
    proficiency: 'pistol',
    minProficiency: 0,
    minLevel: 1,
  },
  shotgun: {
    weaponId: 'shotgun',
    tier: 1,
    proficiency: 'shotgun',
    minProficiency: 10,
    minLevel: 3,
  },
  smg: {
    weaponId: 'smg',
    tier: 2,
    proficiency: 'smg',
    minProficiency: 20,
    minLevel: 5,
  },
  rifle: {
    weaponId: 'rifle',
    tier: 2,
    proficiency: 'assault',
    minProficiency: 25,
    minLevel: 6,
  },
  sniper: {
    weaponId: 'sniper',
    tier: 2,
    proficiency: 'rifle',
    minProficiency: 35,
    minLevel: 8,
  },
  heavy: {
    weaponId: 'heavy',
    tier: 3,
    proficiency: 'heavy',
    minProficiency: 50,
    minLevel: 12,
  },
};

/**
 * Calculates Threat Tier from meter-space coordinates relative to Outpost `(21, 21)`:
 *   `const distanceFromOutpost = Math.hypot(player.x - outpost.x, player.y - outpost.y);`
 *   `const effectiveDistance = Math.max(0, distanceFromOutpost - SAFE_ZONE_RADIUS);`
 *   `const threatTier = Math.min(3, Math.floor(effectiveDistance / 800));`
 */
export function calculateThreatTierFromOutpostMeters(
  playerMeters: Vec2,
  outpostMeters: Vec2 = SAFE_OUTPOST_ORIGIN,
): ThreatTier {
  const distanceFromOutpost = Math.hypot(
    playerMeters.x - outpostMeters.x,
    playerMeters.y - outpostMeters.y,
  );
  if (distanceFromOutpost <= SAFE_ZONE_RADIUS) {
    return 0;
  }
  const effectiveDistance = Math.max(0, distanceFromOutpost - SAFE_ZONE_RADIUS);
  const threatTier = Math.min(3, Math.floor(effectiveDistance / 800));
  return clamp(Math.max(1, threatTier), 0, 3) as ThreatTier;
}

/**
 * Returns true if the world-tile coordinate `(x, y)` lies inside the Tier 0 Safe Outpost sanctuary.
 * Zero zombie spawns, PvP, and enemy tracking are permitted when this returns true.
 */
export function isInSafeOutpostSanctuary(map: WorldMap, x: number, y: number): boolean {
  if (isInsideSafeZone(map, x, y)) return true;
  const distTiles = distance({ x, y }, map.safeCenter);
  return distTiles <= map.safeRadius;
}

/**
 * Computes progressive Threat Tier `0..3` for world coordinate `(x, y)` using the
 * Safe Outpost radius buffer + 800m effective distance bands.
 */
export function computeProgressiveThreatTier(
  map: WorldMap,
  x: number,
  y: number,
): ThreatTier {
  if (isInSafeOutpostSanctuary(map, x, y)) {
    return 0;
  }
  const distFromHoldout = distance({ x, y }, map.safeCenter);
  if (distFromHoldout <= THREAT_BAND_1) return 1;
  if (distFromHoldout <= THREAT_BAND_2) return 2;
  return 3;
}

/**
 * Returns whether zombie spawning is permitted at `(x, y)` on `map`.
 * Strictly blocks any spawn inside the Tier 0 Safe Zone sanctuary or within a 1.5-tile safety buffer.
 */
export function canSpawnZombieAt(map: WorldMap, x: number, y: number): boolean {
  if (isInSafeOutpostSanctuary(map, x, y)) return false;
  for (const outpost of map.outposts) {
    if (Math.hypot(x - outpost.x, y - outpost.y) <= outpost.radius + 1.5) {
      return false;
    }
  }
  return distance({ x, y }, map.safeCenter) > map.safeRadius + 1.5;
}

/**
 * Selects a zombie variant for the given Threat Tier and Aggro Index.
 * - Tier 0: Fallback to `'walker'` for deterministic callers, though `canSpawnZombieAt` blocks Tier 0 spawns.
 * - Tier 1 (Outer Suburbs): Slow Walkers, Crawlers, and occasional Hounds.
 * - Tier 2 (Commercial Sector): Fast Runners, Spitters, Burning Bloats, and Brutes.
 * - Tier 3 (Bio-Lab Core): Titans, Leapers, Wraiths, and Hounds.
 */
export function selectProgressiveZombieVariant(
  tier: ThreatTier,
  aggroIndex: number,
  rng: () => number = Math.random,
): ZombieVariant {
  const roll = clamp(rng() + (aggroIndex > 65 ? 0.06 : 0), 0, 0.999);
  if (tier === 0) {
    return 'walker';
  }
  if (tier === 1) {
    if (roll < 0.62) return 'walker';
    if (roll < 0.84) return 'runner';
    return 'hound';
  }
  if (tier === 2) {
    if (roll < 0.16) return 'walker';
    if (roll < 0.44) return 'runner';
    if (roll < 0.64) return 'spitter';
    if (roll < 0.8) return 'burning';
    return 'brute';
  }
  if (roll < 0.22) return 'leaper';
  if (roll < 0.44) return 'wraith';
  if (roll < 0.66) return 'hound';
  if (roll < 0.84) return 'brute';
  return 'titan';
}

export type ZoneEnemyThemeId =
  | 'sanctuary'
  | 'suburban_outskirts'
  | 'industrial_burn_zone'
  | 'commercial_plaza'
  | 'quarantine_slums'
  | 'deep_bio_core';

export interface ZoneEnemyTheme {
  id: ZoneEnemyThemeId;
  label: string;
  primaryVariants: ZombieVariant[];
  floorTint: [number, number];
}

export const ZONE_ENEMY_THEMES: Record<ZoneEnemyThemeId, ZoneEnemyTheme> = {
  sanctuary: {
    id: 'sanctuary',
    label: 'Safe Sanctuary Compound',
    primaryVariants: ['walker'],
    floorTint: [0x0f151b, 0x111820],
  },
  suburban_outskirts: {
    id: 'suburban_outskirts',
    label: 'Suburban Outskirts (Shamblers)',
    primaryVariants: ['walker', 'runner'],
    floorTint: [0x0d1117, 0x0f141b],
  },
  industrial_burn_zone: {
    id: 'industrial_burn_zone',
    label: 'Industrial Yard (Burned & Brutes)',
    primaryVariants: ['burning', 'walker', 'runner', 'brute'],
    floorTint: [0x0e1116, 0x11151b],
  },
  commercial_plaza: {
    id: 'commercial_plaza',
    label: 'Commercial Plaza (Spitters & Runners)',
    primaryVariants: ['spitter', 'runner', 'walker'],
    floorTint: [0x0d1218, 0x0f151c],
  },
  quarantine_slums: {
    id: 'quarantine_slums',
    label: 'Quarantine Slums (Hound Packs & Brutes)',
    primaryVariants: ['hound', 'runner', 'brute', 'spitter'],
    floorTint: [0x0c1015, 0x0e1319],
  },
  deep_bio_core: {
    id: 'deep_bio_core',
    label: 'Deep Bio-Core (Leapers, Wraiths & Titans)',
    primaryVariants: ['leaper', 'wraith', 'brute', 'spitter', 'hound', 'titan'],
    floorTint: [0x0b0e14, 0x0d1117],
  },
};

/**
 * Resolves the zone enemy theme for world coordinate `(x, y)`.
 * - Near the starting Safe Outpost (`<= 30` tiles from `safeCenter`): strictly `suburban_outskirts`
 *   (only `walker` and `runner`, never mid/late-game mutants).
 * - Mid-distance sectors (`30 .. 55` tiles): distinct sector themes (`industrial_burn_zone`,
 *   `commercial_plaza`, `quarantine_slums`) based on chunk coordinates.
 * - Far Deep Outlands (`> 55` tiles from `safeCenter`): `deep_bio_core` where Apex mutants
 *   (`leaper`, `wraith`, `titan`) spawn.
 */
export function getZoneThemeForCoord(map: WorldMap, x: number, y: number): ZoneEnemyTheme {
  if (isInSafeOutpostSanctuary(map, x, y)) {
    return ZONE_ENEMY_THEMES.sanctuary;
  }

  const distFromStart = distance({ x, y }, map.safeCenter);
  if (distFromStart <= map.safeRadius + 18) {
    return ZONE_ENEMY_THEMES.suburban_outskirts;
  }

  if (distFromStart > 55) {
    return ZONE_ENEMY_THEMES.deep_bio_core;
  }

  const cx = chunkCoordAt(x);
  const cy = chunkCoordAt(y);
  const region = regionNameForChunk(cx, cy).toLowerCase();

  if (region.includes('industrial') || region.includes('burned') || region.includes('tenement')) {
    return ZONE_ENEMY_THEMES.industrial_burn_zone;
  }
  if (
    region.includes('commercial') ||
    region.includes('mall') ||
    region.includes('hospital') ||
    region.includes('triage')
  ) {
    return ZONE_ENEMY_THEMES.commercial_plaza;
  }
  if (
    region.includes('slum') ||
    region.includes('rail') ||
    region.includes('highway') ||
    region.includes('westgate')
  ) {
    return ZONE_ENEMY_THEMES.quarantine_slums;
  }

  const hash = Math.abs((cx * 31 + cy * 17) % 3);
  if (hash === 0) return ZONE_ENEMY_THEMES.industrial_burn_zone;
  if (hash === 1) return ZONE_ENEMY_THEMES.commercial_plaza;
  return ZONE_ENEMY_THEMES.quarantine_slums;
}

/**
 * Selects a zone-themed enemy archetype based on the exact zone theme and distance from
 * the starting Safe Outpost, keeping dangerous apex enemies (`leaper`, `wraith`, `titan`)
 * strictly in far sectors off the beginning of the map.
 */
export function selectZoneThemedZombieVariant(
  map: WorldMap,
  x: number,
  y: number,
  aggroIndex: number,
  rng: () => number = Math.random,
): ZombieVariant {
  const theme = getZoneThemeForCoord(map, x, y);
  const roll = clamp(rng() + (aggroIndex > 70 ? 0.05 : 0), 0, 0.999);

  switch (theme.id) {
    case 'sanctuary':
      return 'walker';
    case 'suburban_outskirts':
      return roll < 0.8 ? 'walker' : 'runner';
    case 'industrial_burn_zone':
      if (roll < 0.36) return 'burning';
      if (roll < 0.66) return 'walker';
      if (roll < 0.88) return 'runner';
      return 'brute';
    case 'commercial_plaza':
      if (roll < 0.35) return 'spitter';
      if (roll < 0.68) return 'runner';
      if (roll < 0.9) return 'walker';
      return 'hound';
    case 'quarantine_slums':
      if (roll < 0.36) return 'hound';
      if (roll < 0.66) return 'runner';
      if (roll < 0.86) return 'brute';
      return 'spitter';
    case 'deep_bio_core': {
      const distFromStart = distance({ x, y }, map.safeCenter);
      if (roll < 0.24) return 'leaper';
      if (roll < 0.46) return 'wraith';
      if (roll < 0.64) return 'hound';
      if (roll < 0.8) return 'spitter';
      if (roll < 0.92 || distFromStart < 34) return 'brute';
      return 'titan';
    }
  }
}

/**
 * Picks a loot template ID from the progressive Zone Tier Matrix.
 */
export function selectProgressiveLootTemplate(
  tier: ThreatTier,
  rng: () => number = Math.random,
): string {
  const pool = ZONE_TIER_MATRIX[tier].lootTable;
  const idx = Math.min(pool.length - 1, Math.floor(clamp(rng(), 0, 0.999) * pool.length));
  return pool[idx];
}

/**
 * Checks whether a survivor meets the Weapon Proficiency & Level requirements to equip `weaponId`.
 */
export function canEquipWeapon(player: PlayerState, weaponId: WeaponId): boolean {
  const gate = WEAPON_SKILL_GATES[weaponId];
  const weaponState = player.weapons[weaponId];
  const currentProf = player.proficiencies[gate.proficiency] ?? 0;
  const meetsStats =
    currentProf >= gate.minProficiency && player.level >= gate.minLevel;

  if (meetsStats) return true;
  if (weaponState?.unlocked && weaponId !== 'heavy') return true;
  return false;
}
