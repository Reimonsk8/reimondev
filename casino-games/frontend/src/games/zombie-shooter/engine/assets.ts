import * as PIXI from 'pixi.js';
import type { WeaponId } from './types';
import { resolveSheetLayout, sheetRowForOctant } from './animation';

/**
 * Unified Modular Asset Injection & Master PixelLab Style Pipeline (`/engine/assets.ts`).
 *
 * Enforces:
 * 1. Master Style Seed & Palette Lock:
 *    - Grid: `32x32` or `64x64` true 45-degree isometric projection with hard pixel outlines.
 *    - Palette: Desaturated industrial grays (`#2D3748`), rusted browns (`#4A0404`),
 *      dark asphalt blues (`#121622`), and blood crimsons (`#7F1D1D`).
 * 2. Strict Nearest-Neighbor Filtering:
 *    - Forces `PIXI.BaseTexture.defaultOptions.scaleMode = PIXI.SCALE_MODES.NEAREST` and
 *      `PIXI.MIPMAP_MODES.OFF` on every loaded texture and base texture.
 * 3. Complete Sprite Coverage:
 *    - Terrain floor tiles (`asphalt_tile`, `safezone_tile`, `indoor_wood_tile`, `indoor_check_tile`, `bunker_floor_tile`)
 *    - Environment & indoor props (`crate`, `ruined_wall_door`, `burning_barrel`, `burned_car`, `kitchen_counter`, `filing_cabinet`, `vault_safe`)
 *    - Character & all 9 zombie variants (`survivor`, `walker`, `runner`, `brute`, `burning`, `spitter`, `leaper`, `titan`, `wraith`, `hound`)
 *    - All 7 weapons (`weapon_machete`, `weapon_pistol`, `weapon_shotgun`, `weapon_smg`, `weapon_rifle`, `weapon_sniper`, `weapon_heavy`)
 */

export type AssetLayerCategory = 'terrain' | 'prop' | 'paperdoll';

export const PIXELLAB_STYLE_CONSTRAINTS = {
  masterSeed: 8880404,
  resolutions: [32, 64] as const,
  projection: 'isometric-45deg' as const,
  outline: 'hard-pixel-1px' as const,
  palette: {
    rustedBrown: 0x4a0404,
    rustedBrownHex: '#4A0404',
    industrialGray: 0x2d3748,
    industrialGrayHex: '#2D3748',
    asphaltBlue: 0x121622,
    asphaltBlueHex: '#121622',
    bloodCrimson: 0x7f1d1d,
    bloodCrimsonHex: '#7F1D1D',
    steelHighlight: 0x4a5568,
    boneAsh: 0x94a3b8,
  },
} as const;

export const SPRITE_KEYS = [
  'survivor',
  'survivor_idle',
  'survivor_walk',
  'survivor_run',
  'survivor_reload',
  'survivor_shoot',
  'survivor_melee',
  'survivor_death',
  'helmet_basic',
  'vest_kevlar',
  'vest_riot',
  'ghillie',
  'backpack_tactical',
  'walker',
  'runner',
  'brute',
  'burning',
  'spitter',
  'leaper',
  'titan',
  'wraith',
  'hound',
  'crate',
  'corpse',
  'asphalt_tile',
  'safezone_tile',
  'indoor_wood_tile',
  'indoor_check_tile',
  'bunker_floor_tile',
  'ruined_wall_door',
  'burning_barrel',
  'burned_car',
  'kitchen_counter',
  'filing_cabinet',
  'vault_safe',
  'dumpster',
  'streetlamp',
  'rubble',
  'trash_bags',
  'weeds',
  'barricade',
  'door_closed',
  'door_open',
  'door_barricaded',
  'door_smashed',
  'weapon_machete',
  'weapon_pistol',
  'weapon_shotgun',
  'weapon_smg',
  'weapon_rifle',
  'weapon_sniper',
  'weapon_heavy',
] as const;

export type SpriteKey = (typeof SPRITE_KEYS)[number];

export interface ModularAssetSpec {
  key: SpriteKey;
  layer: AssetLayerCategory;
  gridSize: 32 | 64;
  url?: string;
  fallbackUrl?: string;
  anchor: { x: number; y: number };
  ySortOffset: number;
  placeholderColor: number;
  borderColor: number;
}

const PRIMARY_SPRITE_DIR = publicAsset('/sprites/outlands');
const LEGACY_SPRITE_DIR = publicAsset('/assets/zombie-shooter/sprites');

export const ASPHALT_BASE_HEX = '#0d1117';
export const ASPHALT_BASE_COLOR = 0x0d1117;

/**
 * Computes deterministic tile grit/crack noise index (`0..4`) from tile coordinates:
 * `const noise = (x * 37 + y * 17) % 5;`
 */
export function computeAsphaltTileNoise(x: number, y: number): number {
  const noise = (x * 37 + y * 17) % 5;
  return ((noise % 5) + 5) % 5;
}

export const MODULAR_ASSET_MANIFEST: Record<SpriteKey, ModularAssetSpec> = {
  // 1. Terrain Layer (procedural desaturated dark asphalt #0d1117 & indoor floor tiles)
  asphalt_tile: {
    key: 'asphalt_tile',
    layer: 'terrain',
    gridSize: 64,
    anchor: { x: 0.5, y: 0.5 },
    ySortOffset: 0,
    placeholderColor: ASPHALT_BASE_COLOR,
    borderColor: 0x161b22,
  },
  safezone_tile: {
    key: 'safezone_tile',
    layer: 'terrain',
    gridSize: 64,
    anchor: { x: 0.5, y: 0.5 },
    ySortOffset: 0,
    placeholderColor: 0x0f161c,
    borderColor: 0x1b2631,
  },
  indoor_wood_tile: {
    key: 'indoor_wood_tile',
    layer: 'terrain',
    gridSize: 64,
    anchor: { x: 0.5, y: 0.5 },
    ySortOffset: 0,
    placeholderColor: 0x1b1410,
    borderColor: 0x261c16,
  },
  indoor_check_tile: {
    key: 'indoor_check_tile',
    layer: 'terrain',
    gridSize: 64,
    anchor: { x: 0.5, y: 0.5 },
    ySortOffset: 0,
    placeholderColor: 0x121720,
    borderColor: 0x1c2330,
  },
  bunker_floor_tile: {
    key: 'bunker_floor_tile',
    layer: 'terrain',
    gridSize: 64,
    anchor: { x: 0.5, y: 0.5 },
    ySortOffset: 0,
    placeholderColor: 0x10141b,
    borderColor: 0x1f2733,
  },
  corpse: {
    key: 'corpse',
    layer: 'terrain',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/corpse.png`,
    fallbackUrl: `${LEGACY_SPRITE_DIR}/corpse.png`,
    anchor: { x: 0.5, y: 0.5 },
    ySortOffset: 1,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.bloodCrimson,
  },

  // 2. Environment & Indoor Prop Layer
  crate: {
    key: 'crate',
    layer: 'prop',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/crate.png`,
    fallbackUrl: `${LEGACY_SPRITE_DIR}/crate.png`,
    anchor: { x: 0.5, y: 0.97 },
    ySortOffset: 6,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray,
  },
  ruined_wall_door: {
    key: 'ruined_wall_door',
    layer: 'prop',
    gridSize: 64,
    anchor: { x: 0.5, y: 0.78 },
    ySortOffset: 8,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
  },
  burning_barrel: {
    key: 'burning_barrel',
    layer: 'prop',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/burning_barrel.png`,
    fallbackUrl: `${LEGACY_SPRITE_DIR}/burning_barrel.png`,
    anchor: { x: 0.5, y: 0.97 },
    ySortOffset: 4,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.bloodCrimson,
  },
  burned_car: {
    key: 'burned_car',
    layer: 'prop',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/burned_car.png`,
    anchor: { x: 0.49, y: 0.84 },
    ySortOffset: 7,
    placeholderColor: 0x3b231e,
    borderColor: 0x64748b,
  },
  kitchen_counter: {
    key: 'kitchen_counter',
    layer: 'prop',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/kitchen_counter.png`,
    anchor: { x: 0.51, y: 0.94 },
    ySortOffset: 5,
    placeholderColor: 0x334155,
    borderColor: 0x94a3b8,
  },
  filing_cabinet: {
    key: 'filing_cabinet',
    layer: 'prop',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/filing_cabinet.png`,
    anchor: { x: 0.48, y: 0.92 },
    ySortOffset: 6,
    placeholderColor: 0x2d3748,
    borderColor: 0x64748b,
  },
  vault_safe: {
    key: 'vault_safe',
    layer: 'prop',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/vault_safe.png`,
    anchor: { x: 0.45, y: 0.86 },
    ySortOffset: 6,
    placeholderColor: 0x1e293b,
    borderColor: 0xeab308,
  },

  dumpster: {
    key: 'dumpster',
    layer: 'prop',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/dumpster.png`,
    anchor: { x: 0.48, y: 0.97 },
    ySortOffset: 6,
    placeholderColor: 0x2f3d2c,
    borderColor: 0x111418,
  },
  streetlamp: {
    key: 'streetlamp',
    layer: 'prop',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/streetlamp.png`,
    anchor: { x: 0.36, y: 0.81 },
    ySortOffset: 6,
    placeholderColor: 0x3a3530,
    borderColor: 0x111418,
  },
  rubble: {
    key: 'rubble',
    layer: 'prop',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/rubble.png`,
    anchor: { x: 0.50, y: 0.58 },
    ySortOffset: 6,
    placeholderColor: 0x3a3d40,
    borderColor: 0x111418,
  },
  trash_bags: {
    key: 'trash_bags',
    layer: 'prop',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/trash_bags.png`,
    anchor: { x: 0.50, y: 0.81 },
    ySortOffset: 6,
    placeholderColor: 0x1c1f24,
    borderColor: 0x111418,
  },
  weeds: {
    key: 'weeds',
    layer: 'prop',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/weeds.png`,
    anchor: { x: 0.50, y: 0.56 },
    ySortOffset: 6,
    placeholderColor: 0x3b4a26,
    borderColor: 0x111418,
  },
  barricade: {
    key: 'barricade',
    layer: 'prop',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/barricade.png`,
    anchor: { x: 0.48, y: 0.77 },
    ySortOffset: 6,
    placeholderColor: 0x4a4a44,
    borderColor: 0x111418,
  },
  door_closed: {
    key: 'door_closed',
    layer: 'prop',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/door_closed.png`,
    anchor: { x: 0.5, y: 0.88 },
    ySortOffset: 8,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
  },
  door_open: {
    key: 'door_open',
    layer: 'prop',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/door_open.png`,
    anchor: { x: 0.5, y: 0.88 },
    ySortOffset: 8,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
  },
  door_barricaded: {
    key: 'door_barricaded',
    layer: 'prop',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/door_barricaded.png`,
    anchor: { x: 0.5, y: 0.88 },
    ySortOffset: 8,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray,
  },
  door_smashed: {
    key: 'door_smashed',
    layer: 'prop',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/door_smashed.png`,
    anchor: { x: 0.5, y: 0.88 },
    ySortOffset: 8,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray,
  },

  // 3. Character & Zombie Paperdoll Layer
  survivor: {
    key: 'survivor',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/survivor.png`,
    fallbackUrl: `${LEGACY_SPRITE_DIR}/survivor.png`,
    anchor: { x: 0.5, y: 0.95 },
    ySortOffset: 6,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.boneAsh,
  },
  survivor_idle: {
    key: 'survivor_idle',
    layer: 'paperdoll',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/survivor_idle.png`,
    anchor: { x: 0.5, y: 0.95 },
    ySortOffset: 6,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.boneAsh,
  },
  survivor_walk: {
    key: 'survivor_walk',
    layer: 'paperdoll',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/survivor_walk.png`,
    anchor: { x: 0.5, y: 0.95 },
    ySortOffset: 6,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.boneAsh,
  },
  survivor_run: { key: 'survivor_run', layer: 'paperdoll', gridSize: 64, url: `${PRIMARY_SPRITE_DIR}/survivor_run.png`, anchor: { x: 0.5, y: 0.95 }, ySortOffset: 6, placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray, borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.boneAsh },
  survivor_reload: { key: 'survivor_reload', layer: 'paperdoll', gridSize: 64, url: `${PRIMARY_SPRITE_DIR}/survivor_reload.png`, anchor: { x: 0.5, y: 0.95 }, ySortOffset: 6, placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray, borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.boneAsh },
  survivor_shoot: { key: 'survivor_shoot', layer: 'paperdoll', gridSize: 64, url: `${PRIMARY_SPRITE_DIR}/survivor_shoot.png`, anchor: { x: 0.5, y: 0.95 }, ySortOffset: 6, placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray, borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.boneAsh },
  survivor_melee: { key: 'survivor_melee', layer: 'paperdoll', gridSize: 64, url: `${PRIMARY_SPRITE_DIR}/survivor_melee.png`, anchor: { x: 0.5, y: 0.95 }, ySortOffset: 6, placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray, borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.boneAsh },
  survivor_death: { key: 'survivor_death', layer: 'paperdoll', gridSize: 64, url: `${PRIMARY_SPRITE_DIR}/survivor_death.png`, anchor: { x: 0.5, y: 0.95 }, ySortOffset: 6, placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray, borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.boneAsh },
  // Modular gear layers (headgear / torso armor / backpack) — placeholders until art ships.
  helmet_basic: {
    key: 'helmet_basic',
    layer: 'paperdoll',
    gridSize: 32,
    anchor: { x: 0.5, y: 0.32 },
    ySortOffset: 6,
    placeholderColor: 0x475569,
    borderColor: 0x94a3b8,
  },
  vest_kevlar: {
    key: 'vest_kevlar',
    layer: 'paperdoll',
    gridSize: 32,
    anchor: { x: 0.5, y: 0.7 },
    ySortOffset: 6,
    placeholderColor: 0x2c4238,
    borderColor: 0x5c7a6b,
  },
  vest_riot: {
    key: 'vest_riot',
    layer: 'paperdoll',
    gridSize: 32,
    anchor: { x: 0.5, y: 0.7 },
    ySortOffset: 6,
    placeholderColor: 0x1e3a5f,
    borderColor: 0x60a5fa,
  },
  ghillie: {
    key: 'ghillie',
    layer: 'paperdoll',
    gridSize: 32,
    anchor: { x: 0.5, y: 0.75 },
    ySortOffset: 6,
    placeholderColor: 0x3f4a35,
    borderColor: 0x84cc16,
  },
  backpack_tactical: {
    key: 'backpack_tactical',
    layer: 'paperdoll',
    gridSize: 32,
    anchor: { x: 0.5, y: 0.55 },
    ySortOffset: 6,
    placeholderColor: 0x3b2f26,
    borderColor: 0xa3855b,
  },
  walker: {
    key: 'walker',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/walker_8dir.png`,
    fallbackUrl: `${PRIMARY_SPRITE_DIR}/walker.png`,
    anchor: { x: 0.5, y: 0.98 },
    ySortOffset: 6,
    placeholderColor: 0x3b4d3b,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
  },
  runner: {
    key: 'runner',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/runner_8dir.png`,
    fallbackUrl: `${PRIMARY_SPRITE_DIR}/runner.png`,
    anchor: { x: 0.5, y: 0.95 },
    ySortOffset: 6,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.bloodCrimson,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
  },
  brute: {
    key: 'brute',
    layer: 'paperdoll',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/brute_8dir.png`,
    fallbackUrl: `${PRIMARY_SPRITE_DIR}/brute.png`,
    anchor: { x: 0.5, y: 0.94 },
    ySortOffset: 8,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray,
  },
  burning: {
    key: 'burning',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/burning_8dir.png`,
    fallbackUrl: `${PRIMARY_SPRITE_DIR}/burning.png`,
    anchor: { x: 0.5, y: 0.97 },
    ySortOffset: 6,
    placeholderColor: 0x9a3412,
    borderColor: 0xf97316,
  },
  spitter: {
    key: 'spitter',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/spitter_8dir.png`,
    fallbackUrl: `${PRIMARY_SPRITE_DIR}/spitter.png`,
    anchor: { x: 0.5, y: 0.98 },
    ySortOffset: 6,
    placeholderColor: 0x166534,
    borderColor: 0x4ade80,
  },
  leaper: {
    key: 'leaper',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/leaper_8dir.png`,
    fallbackUrl: `${PRIMARY_SPRITE_DIR}/leaper.png`,
    anchor: { x: 0.5, y: 0.95 },
    ySortOffset: 6,
    placeholderColor: 0x581c87,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.bloodCrimson,
  },
  titan: {
    key: 'titan',
    layer: 'paperdoll',
    gridSize: 64,
    url: `${PRIMARY_SPRITE_DIR}/titan_8dir.png`,
    fallbackUrl: `${PRIMARY_SPRITE_DIR}/titan.png`,
    anchor: { x: 0.5, y: 0.94 },
    ySortOffset: 10,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.bloodCrimson,
  },
  wraith: {
    key: 'wraith',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/wraith_8dir.png`,
    fallbackUrl: `${PRIMARY_SPRITE_DIR}/wraith.png`,
    anchor: { x: 0.5, y: 0.98 },
    ySortOffset: 6,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.asphaltBlue,
    borderColor: 0x38bdf8,
  },
  hound: {
    key: 'hound',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/hound_8dir.png`,
    fallbackUrl: `${PRIMARY_SPRITE_DIR}/hound.png`,
    anchor: { x: 0.5, y: 0.89 },
    ySortOffset: 5,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.bloodCrimson,
  },

  // 4. Complete 7-Weapon Arsenal Sprites (horizontal 0-radian grip-aligned for 360° hand tracking)
  weapon_machete: {
    key: 'weapon_machete',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/weapon_machete.png`,
    fallbackUrl: `${LEGACY_SPRITE_DIR}/weapon_machete.png`,
    anchor: { x: 0.25, y: 0.5 },
    ySortOffset: 7,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.steelHighlight,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
  },
  weapon_pistol: {
    key: 'weapon_pistol',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/weapon_pistol.png`,
    fallbackUrl: `${LEGACY_SPRITE_DIR}/weapon_pistol.png`,
    anchor: { x: 0.28, y: 0.5 },
    ySortOffset: 7,
    placeholderColor: 0x475569,
    borderColor: 0x94a3b8,
  },
  weapon_shotgun: {
    key: 'weapon_shotgun',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/weapon_shotgun.png`,
    fallbackUrl: `${LEGACY_SPRITE_DIR}/weapon_shotgun.png`,
    anchor: { x: 0.28, y: 0.5 },
    ySortOffset: 7,
    placeholderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.industrialGray,
    borderColor: PIXELLAB_STYLE_CONSTRAINTS.palette.rustedBrown,
  },
  weapon_smg: {
    key: 'weapon_smg',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/weapon_smg.png`,
    fallbackUrl: `${LEGACY_SPRITE_DIR}/weapon_smg.png`,
    anchor: { x: 0.28, y: 0.5 },
    ySortOffset: 7,
    placeholderColor: 0x334155,
    borderColor: 0x64748b,
  },
  weapon_rifle: {
    key: 'weapon_rifle',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/weapon_rifle.png`,
    fallbackUrl: `${LEGACY_SPRITE_DIR}/weapon_rifle.png`,
    anchor: { x: 0.28, y: 0.5 },
    ySortOffset: 7,
    placeholderColor: 0x2d3748,
    borderColor: 0x94a3b8,
  },
  weapon_sniper: {
    key: 'weapon_sniper',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/weapon_sniper.png`,
    fallbackUrl: `${LEGACY_SPRITE_DIR}/weapon_sniper.png`,
    anchor: { x: 0.24, y: 0.5 },
    ySortOffset: 7,
    placeholderColor: 0x1e293b,
    borderColor: 0x38bdf8,
  },
  weapon_heavy: {
    key: 'weapon_heavy',
    layer: 'paperdoll',
    gridSize: 32,
    url: `${PRIMARY_SPRITE_DIR}/weapon_heavy.png`,
    fallbackUrl: `${LEGACY_SPRITE_DIR}/weapon_heavy.png`,
    anchor: { x: 0.3, y: 0.55 },
    ySortOffset: 7,
    placeholderColor: 0x4a0404,
    borderColor: 0xf59e0b,
  },
};

export function enforceNearestNeighborFiltering(texture?: PIXI.Texture | null): void {
  PIXI.BaseTexture.defaultOptions.scaleMode = PIXI.SCALE_MODES.NEAREST;
  PIXI.BaseTexture.defaultOptions.mipmap = PIXI.MIPMAP_MODES.OFF;

  if (texture?.baseTexture) {
    texture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
    texture.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    texture.baseTexture.update();
  }
}

function colorNumToCssHex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * Generates crisp, detailed pixel-art textures (`32x32` or `64x64`) for floor tiles,
 * props, zombie archetypes, and weapons so NO entity ever lacks a pixel-art sprite.
 */
export function createFallbackPlaceholderTexture(spec: ModularAssetSpec): PIXI.Texture {
  if (typeof document === 'undefined') {
    enforceNearestNeighborFiltering(PIXI.Texture.EMPTY);
    return PIXI.Texture.EMPTY;
  }

  const size = spec.gridSize;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return PIXI.Texture.WHITE;
  }

  ctx.imageSmoothingEnabled = false;
  const fillHex = colorNumToCssHex(spec.placeholderColor);
  const borderHex = colorNumToCssHex(spec.borderColor);

  if (spec.layer === 'terrain') {
    // Seamless isometric diamond floor tile (#0d1117 desaturated dark asphalt base, zero harsh border)
    const halfW = size / 2;
    const halfH = size / 4;
    const centerY = size / 2;

    ctx.fillStyle = spec.key === 'asphalt_tile' ? ASPHALT_BASE_HEX : fillHex;
    ctx.beginPath();
    ctx.moveTo(halfW, centerY - halfH);
    ctx.lineTo(size, centerY);
    ctx.lineTo(halfW, centerY + halfH);
    ctx.lineTo(0, centerY);
    ctx.closePath();
    ctx.fill();

    // Procedural asphalt grit, oil stains & hairline concrete cracks hashed by coordinate formula
    for (let py = centerY - halfH + 2; py < centerY + halfH - 2; py += 2) {
      const span = Math.floor((1 - Math.abs(py - centerY) / halfH) * (halfW - 3));
      for (let px = halfW - span; px <= halfW + span; px += 3) {
        const noise = (px * 37 + py * 17) % 5;
        if (noise === 0) {
          ctx.fillStyle = '#090c10';
          ctx.fillRect(px, py, 2, 1);
        } else if (noise === 3) {
          ctx.fillStyle = '#141a23';
          ctx.fillRect(px, py, 1, 1);
        }
      }
    }

    // Oil stain patch & cracked concrete seam
    ctx.fillStyle = '#07090d';
    ctx.fillRect(halfW - 6, centerY - 2, 7, 3);
    ctx.fillStyle = '#161b22';
    if (spec.key === 'indoor_wood_tile') {
      ctx.fillRect(halfW - 10, centerY - 2, 20, 1);
      ctx.fillRect(halfW - 6, centerY + 3, 14, 1);
    } else if (spec.key === 'bunker_floor_tile') {
      for (let gx = -8; gx <= 8; gx += 4) {
        ctx.fillRect(halfW + gx, centerY - 3, 2, 1);
        ctx.fillRect(halfW + gx, centerY + 2, 2, 1);
      }
    } else {
      // Hairline asphalt crack
      ctx.fillRect(halfW - 8, centerY - 1, 5, 1);
      ctx.fillRect(halfW - 3, centerY, 4, 1);
      ctx.fillRect(halfW + 1, centerY + 1, 4, 1);
    }
  } else if (spec.key === 'ruined_wall_door') {
    // Crisp dark steel & masonry industrial doorway frame (no miniature building box)
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(18, 12, 28, 44);
    ctx.fillStyle = '#2d3748';
    ctx.fillRect(18, 12, 4, 44);
    ctx.fillRect(42, 12, 4, 44);
    ctx.fillRect(18, 12, 28, 5);
    ctx.fillStyle = '#4a1d1a';
    ctx.fillRect(22, 17, 20, 38);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(38, 35, 2, 3);
  } else if (spec.key.startsWith('weapon_')) {
    // Crisp 32x32 horizontal right-facing (+X = 0 rad) pixel-art weapon anchored at grip (8, 16)
    ctx.fillStyle = '#07090d';
    if (spec.key === 'weapon_machete') {
      ctx.fillRect(5, 14, 23, 5);
      ctx.fillStyle = '#5c4033';
      ctx.fillRect(6, 15, 6, 3);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(12, 15, 15, 2);
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(18, 16, 8, 1);
    } else {
      ctx.fillRect(3, 12, 26, 7);
      // Buttstock & pistol grip at anchor x=8..9
      ctx.fillStyle = '#3b2618';
      ctx.fillRect(3, 14, 6, 4);
      ctx.fillRect(7, 17, 3, 5);
      // Receiver & barrel extending right (+X)
      ctx.fillStyle = fillHex;
      ctx.fillRect(8, 13, 19, 4);
      ctx.fillStyle = borderHex;
      ctx.fillRect(9, 13, 16, 2);
      if (spec.key === 'weapon_sniper') {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(11, 10, 8, 2);
      } else if (spec.key === 'weapon_heavy') {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(14, 12, 13, 6);
      }
    }
  } else if (spec.layer === 'paperdoll') {
    // Crisp pixel-art humanoid / mutant silhouette with head, torso, arms, legs
    const cx = Math.floor(size / 2);
    const footY = size - 4;
    ctx.fillStyle = '#07090e';
    ctx.fillRect(cx - 6, footY - 22, 12, 22);
    // Legs
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(cx - 4, footY - 8, 3, 8);
    ctx.fillRect(cx + 1, footY - 8, 3, 8);
    // Torso
    ctx.fillStyle = fillHex;
    ctx.fillRect(cx - 5, footY - 17, 10, 10);
    // Head
    ctx.fillStyle = borderHex;
    ctx.fillRect(cx - 3, footY - 22, 6, 5);
    // Glowing eyes for infected
    if (spec.key !== 'survivor') {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(cx - 2, footY - 20, 1, 1);
      ctx.fillRect(cx + 1, footY - 20, 1, 1);
    }
  } else {
    // Crisp isometric prop block (car, cabinet, counter, safe)
    const pad = spec.gridSize === 64 ? 10 : 5;
    ctx.fillStyle = '#080a0f';
    ctx.fillRect(pad - 1, pad - 1, size - pad * 2 + 2, size - pad * 2 + 2);
    ctx.fillStyle = fillHex;
    ctx.fillRect(pad, pad, size - pad * 2, size - pad * 2);
    ctx.fillStyle = borderHex;
    ctx.fillRect(pad, pad, size - pad * 2, 3);
    ctx.fillRect(pad + 2, pad + 6, size - pad * 2 - 4, 2);
  }

  const tex = PIXI.Texture.from(canvas);
  enforceNearestNeighborFiltering(tex);
  return tex;
}

/**
 * Synchronously builds the initial nearest-neighbor texture dictionary so the very first
 * frame never renders untextured rectangles while async PNG files are still streaming.
 */
export function buildInitialSynchronousTextures(): Map<SpriteKey, PIXI.Texture> {
  enforceNearestNeighborFiltering();
  const dict = new Map<SpriteKey, PIXI.Texture>();
  for (const key of SPRITE_KEYS) {
    dict.set(key, createFallbackPlaceholderTexture(MODULAR_ASSET_MANIFEST[key]));
  }
  return dict;
}

export async function loadModularAsset(key: SpriteKey): Promise<PIXI.Texture> {
  enforceNearestNeighborFiltering();
  const spec = MODULAR_ASSET_MANIFEST[key];

  if (spec.url) {
    try {
      const primaryTex = await PIXI.Assets.load<PIXI.Texture>(spec.url);
      if (primaryTex?.baseTexture) {
        enforceNearestNeighborFiltering(primaryTex);
        return primaryTex;
      }
    } catch {
      if (spec.fallbackUrl) {
        try {
          const legacyTex = await PIXI.Assets.load<PIXI.Texture>(spec.fallbackUrl);
          if (legacyTex?.baseTexture) {
            enforceNearestNeighborFiltering(legacyTex);
            return legacyTex;
          }
        } catch {
          // Fall through to pixel-art canvas generator
        }
      }
    }
  }

  return createFallbackPlaceholderTexture(spec);
}

export async function loadAllModularAssets(): Promise<Map<SpriteKey, PIXI.Texture>> {
  enforceNearestNeighborFiltering();
  const dictionary = buildInitialSynchronousTextures();

  await Promise.all(
    SPRITE_KEYS.map(async (key) => {
      const tex = await loadModularAsset(key);
      dictionary.set(key, tex);
    }),
  );

  return dictionary;
}

const WEAPON_ICON_CACHE: Partial<Record<WeaponId, string>> = {};

/**
 * Returns a crisp nearest-neighbor pixel-art icon URL for any of the 7 weapons in the HUD hotbar.
 */
export function getWeaponHotbarIconUrl(weaponId: WeaponId): string {
  if (weaponId === 'shotgun') return publicAsset('/sprites/outlands/weapon_shotgun.png');
  if (weaponId === 'melee') return publicAsset('/sprites/outlands/weapon_machete.png');
  if (WEAPON_ICON_CACHE[weaponId]) return WEAPON_ICON_CACHE[weaponId]!;

  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = false;

  // Draw crisp 32x32 pixel-art weapon icon per weapon class
  ctx.fillStyle = '#090d14';
  ctx.fillRect(2, 11, 28, 10);

  if (weaponId === 'pistol') {
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(8, 11, 14, 5);
    ctx.fillStyle = '#475569';
    ctx.fillRect(9, 16, 5, 7);
  } else if (weaponId === 'smg') {
    ctx.fillStyle = '#64748b';
    ctx.fillRect(6, 11, 18, 5);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(15, 16, 3, 8);
    ctx.fillStyle = '#334155';
    ctx.fillRect(7, 16, 4, 6);
  } else if (weaponId === 'rifle') {
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(3, 12, 25, 4);
    ctx.fillStyle = '#78350f';
    ctx.fillRect(3, 15, 7, 5);
    ctx.fillStyle = '#475569';
    ctx.fillRect(15, 16, 4, 7);
  } else if (weaponId === 'sniper') {
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(2, 13, 28, 3);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(11, 9, 9, 3);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(3, 15, 8, 5);
  } else if (weaponId === 'heavy') {
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(4, 10, 24, 8);
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(8, 18, 12, 6);
  }

  const url = canvas.toDataURL('image/png');
  WEAPON_ICON_CACHE[weaponId] = url;
  return url;
}

const DIRECTIONAL_FRAME_CACHE = new WeakMap<PIXI.BaseTexture, Map<string, PIXI.Texture>>();

/**
 * Resolves the 8-way directional sprite sheet frame for any entity based on movement/aim angle:
 * `const octant = Math.floor((angle + Math.PI / 8) / (Math.PI / 4) + 8) % 8;`
 * If `texture` is an 8-row directional sprite sheet, slices the exact row
 * (`sheetRowForOctant(octant)`) and column (`frameIndex`).
 */
export function resolveDirectionalSpriteFrame(
  texture: PIXI.Texture,
  angle: number,
  frameIndex = 0,
): { texture: PIXI.Texture; octant: number; row: number } {
  const octant = ((Math.floor((angle + Math.PI / 8) / (Math.PI / 4) + 8) % 8) + 8) % 8;
  const base = texture.baseTexture;
  const layout = base ? resolveSheetLayout(base.width, base.height) : null;
  if (!base || !layout) {
    return { texture, octant, row: 0 };
  }

  // Frame edges must never sample the neighbouring cell, and pixel art must not
  // be smoothed: hard nearest + clamp, mipmaps off, on the sheet's base texture.
  base.scaleMode = PIXI.SCALE_MODES.NEAREST;
  base.wrapMode = PIXI.WRAP_MODES.CLAMP;
  base.mipmap = PIXI.MIPMAP_MODES.OFF;

  let cache = DIRECTIONAL_FRAME_CACHE.get(base);
  if (!cache) {
    cache = new Map<string, PIXI.Texture>();
    DIRECTIONAL_FRAME_CACHE.set(base, cache);
  }

  const col = Math.abs(frameIndex) % layout.cols;
  const row = sheetRowForOctant(octant);
  const cacheKey = `${row}:${col}`;

  let subTex = cache.get(cacheKey);
  if (!subTex) {
    // Integer bounds only: a fractional rect lands half a texel into the next
    // cell, which is the 1px "ghost tail" bleed the art was showing.
    subTex = new PIXI.Texture(
      base,
      new PIXI.Rectangle(
        Math.round(col * layout.frameW),
        Math.round(row * layout.frameH),
        Math.round(layout.frameW),
        Math.round(layout.frameH),
      ),
    );
    enforceNearestNeighborFiltering(subTex);
    cache.set(cacheKey, subTex);
  }
  return { texture: subTex, octant, row };
}
import { publicAsset } from '../../../utils/publicAsset';
