import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { atlasFrames, loadSpriteAtlas, type SpriteAtlas } from '../assets/sprites/AtlasLoader';
import { publicAsset } from '../utils/publicAsset';

// Feature flag: render map game tables/props from sprite-gen atlases
// (frontend/public/sprites/<name>/): the roulette/lucky-wheel sprites plus the
// blackjack / slots / cardgame / dice / coinflip / reception / smoking / piano
// table art. OFF (default) keeps the current procedural rendering exactly
// as-is. Flips with VITE_USE_SPRITE_ATLAS=1.
// Player avatars always render the user's picture — the generated player
// atlas is never used for avatars.
const USE_SPRITE_ATLAS = typeof import.meta !== 'undefined' && import.meta.env?.VITE_USE_SPRITE_ATLAS === '1';
const ATLAS_NAMES = [
  'roulette',
  'luckywheel',
  'blackjack',
  'slots',
  'cardgame',
  'dice',
  'coinflip',
  'reception',
  'smoking',
  'piano',
  'palm',
  'deco',
] as const;
const ATLAS_STATE: Record<string, string> = {
  roulette: 'idle',
  luckywheel: 'idle',
  blackjack: 'idle',
  slots: 'idle',
  cardgame: 'idle',
  dice: 'idle',
  coinflip: 'idle',
  reception: 'idle',
  smoking: 'idle',
  piano: 'idle',
  palm: 'idle',
  deco: 'idle',
};

interface GameTable {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  color: number;
  width?: number;  // For rectangular areas
  height?: number; // For rectangular areas
}

interface Player {
  userId: string;
  x: number;
  y: number;
  nickname?: string;
  isLocal?: boolean;
  direction?: number; // Angle in radians
  isMoving?: boolean;
  targetX?: number; // For interpolation
  targetY?: number; // For interpolation
avatarColor?: string;
avatarSize?: number;
isSmoking?: boolean;
avatarImage?: string | null;
smokeStart?: number | null;
currentGame?: string | null;
seated?: boolean;
}

interface CasinoMapProps {
userId: string;
nickname?: string;
onTableInteraction?: (tableId: string) => void;
onPlayerInteraction?: (player: Player) => void;
remotePlayers?: Player[];
avatarColor?: string;
avatarSize?: number;
avatarImage?: string | null;
sendMove?: (position: { x: number; y: number; direction?: number; isSmoking?: boolean; smokeStart?: number | null; seated?: boolean }) => void;
chatMessages?: Record<string, { message: string; timestamp: number }>;
sendChat?: (message: string) => void;
onToggleChat?: () => void;
emotes?: Array<{ id: string; playerId: string; nickname: string; emote: string; ts: number }>;
sendEmote?: (emote: string) => void;
  localCurrentGame?: string | null;
  paused?: boolean;
  highscores?: Record<string, { username: string; amount: number }>;
  level?: number;
}

// Game table definitions - Hexagonal spread layout
// Radii were reduced ~15-17% (65→55 / 46→38 / 50→43) and ring tables pushed
// outward/spread so every adjacent pair keeps a clear empty walking path
// (center distances ≥ ~380 internal = 532 world px with 76px of node width).
const GAME_TABLES: GameTable[] = [
  // Top row - 2 tables
  {
    id: 'roulette-1',
    name: 'Roulette',
    x: 960,
    y: 520,
    radius: 55,
    color: 0xef4444, // Red - grand centerpiece
  },
  // Elegant ring of tables around the centerpiece (symmetric about x=960)
  {
    id: 'blackjack-1',
    name: 'Blackjack',
    x: 640,
    y: 265,
    radius: 38,
    color: 0x22c55e, // Green
  },
  {
    id: 'cardgame-1',
    name: 'Card Duel',
    x: 1280,
    y: 265,
    radius: 38,
    color: 0xff6b6b, // Red
  },
  {
    id: 'luckywheel-1',
    name: 'Lucky Wheel',
    x: 405,
    y: 565,
    radius: 38,
    color: 0x4ecdc4, // Teal
  },
  {
    id: 'dice-1',
    name: 'Dice',
    x: 1515,
    y: 565,
    radius: 38,
    color: 0x3b82f6, // Blue
  },
  {
    id: 'coinflip-1',
    name: 'Coin Flip',
    x: 640,
    y: 815,
    radius: 38,
    color: 0xffd700, // Gold
  },
  {
    id: 'slots-1',
    name: 'Slot Machine',
    x: 1280,
    y: 815,
    radius: 38,
    color: 0x8b5cf6, // Purple
  },
  // Reception podium beside the entrance (right of the corridor, clear of it)
  {
    id: 'info-desk',
    name: 'Reception',
    x: 1110,
    y: 975,
    radius: 43,
    color: 0xf59e0b, // Amber/Orange
  },
  // Smoking lounge — a walled annex OUTSIDE the main salon rectangle. Drawn as
  // its own enclosed room on the right-hand exterior (see the smoking-annex
  // render block) with slate walls + gold doorway; no cage/mullion lines.
  {
    id: 'smoking-area',
    name: 'Smoking Room',
    x: 2120,
    y: 900,
    radius: 80, // Used for interaction detection fallback
    color: 0x4a4a4a, // Darker gray
    width: 520,
    height: 330,
  },
  // VIP bar — drink interaction (interactable "take a drink" target). The bar
  // counter lives in the High-Limit Bar (the walnut slab in the VIP lounge);
  // this entry is the interactable anchor so E/click target it like the piano.
  {
    id: 'vip-bar',
    name: 'VIP Bar',
    x: 1655,
    y: 260,
    radius: 72, // Used for interaction detection fallback
    color: 0xd4b05f, // Gold
    width: 210,
    height: 70,
  },
  // Grand piano - playable instrument in the VIP lounge (top right corner,
  // inside the partitioned VIP parquet platform)
  {
    id: 'piano',
    name: 'Grand Piano',
    x: 2100,
    y: 500,
    radius: 32,
    color: 0x111111, // Piano black
    width: 130,
    height: 80,
  },
];

// Map dimensions
const MAP_SCALE = 1.75; // Global spacing multiplier: bigger floor, roomier layout
// Internal drawing space for the map container (scaled visually by MAP_SCALE)
const MAP_W = 2900; // widened to make room for the exterior smoking annex on the right
const MAP_H = 1360;
// World-space bounds for gameplay (player movement, table layout, interaction)
const MAP_WIDTH = Math.round(MAP_W * MAP_SCALE);
const MAP_HEIGHT = Math.round(MAP_H * MAP_SCALE);
// Converts an internal-space table coordinate into world space.
// GAME_TABLES live in internal space (matching the drawn map), gameplay
// math runs in world space.
const toWorld = (n: number) => n * MAP_SCALE;

// True for tables that launch a game (vs. scenery like reception/piano/smoking)
const GAME_TABLE_IDS = new Set([
  'roulette-1',
  'blackjack-1',
  'cardgame-1',
  'luckywheel-1',
  'dice-1',
  'coinflip-1',
  'slots-1',
]);

// Interaction geometry (world units). Everything below shares these
// definitions so the E key, mouse clicks, hover, and the hint bar can't
// drift apart.
const INTERACT_BUFFER = 50;      // Walk-up range before a desk/table activates
const PLAYER_INTERACTION_RADIUS = 100; // Range for the "near a player" prompt/E
const PLAYER_CLICK_RADIUS = 50;  // Clicking this close to an avatar targets it

// Distance from a point to a table's visual edge (0 = on the body edge).
const tableInteractDistance = (table: GameTable, x: number, y: number): number => {
  const tx = toWorld(table.x);
  const ty = toWorld(table.y);
  if (table.width && table.height) {
    const dx = Math.max(Math.abs(x - tx) - toWorld(table.width) / 2, 0);
    const dy = Math.max(Math.abs(y - ty) - toWorld(table.height) / 2, 0);
    return Math.sqrt(dx * dx + dy * dy);
  }
  return Math.hypot(x - tx, y - ty) - toWorld(table.radius);
};

// Strict hit test against the drawn table body (no interaction buffer).
// Clicks only act on a table when they land on this; clicks beside it walk.
const tableBodyContains = (table: GameTable, x: number, y: number): boolean => {
  const tx = toWorld(table.x);
  const ty = toWorld(table.y);
  if (table.width && table.height) {
    return (
      Math.abs(x - tx) <= toWorld(table.width) / 2 &&
      Math.abs(y - ty) <= toWorld(table.height) / 2
    );
  }
  return Math.hypot(x - tx, y - ty) <= toWorld(table.radius);
};

// The result of resolving what is interactable at a point — a click, the E key,
// and the hint bubble all act on one of these, so every input path targets the
// exact same object with the exact same geometry.
type InteractableTarget =
  | { kind: 'table'; table: GameTable }
  | { kind: 'player'; player: Player };

// Position payload sent by sendMove (referenced by the handler bag below).
type MovePayload = {
  x: number;
  y: number;
  direction?: number;
  isSmoking?: boolean;
  smokeStart?: number | null;
  seated?: boolean;
};

// Latest interaction callbacks shared with the physics/keyboard effect so it
// stays subscribed once while always seeing fresh callback identities.
interface HandlerBag {
  toggleSmoke: () => void;
  onTableInteraction?: (tableId: string) => void;
  onPlayerInteraction?: (player: Player) => void;
  sendMove?: (position: MovePayload) => void;
  onToggleChat?: () => void;
}
// Player enters through the grand doors and steps onto the entrance carpet
const SPAWN_X = Math.round(960 * MAP_SCALE);
const SPAWN_Y = Math.round(700 * MAP_SCALE);
const FIXED_AVATAR_SIZE = 80; // Force same size for all avatars

// ---------------------------------------------------------------------------
// Luxury lighting helpers: procedurally-built gradient textures (cached once)
// so glow pools/shadows are cheap sprites instead of per-frame redraws.
// ---------------------------------------------------------------------------
let _radialTex: PIXI.Texture | null = null;
const radialWhiteTexture = () => {
  if (_radialTex) return _radialTex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _radialTex = PIXI.Texture.from(c);
  return _radialTex;
};

let _vignetteTex: PIXI.Texture | null = null;
const vignetteTexture = () => {
  if (_vignetteTex) return _vignetteTex;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.42, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _vignetteTex = PIXI.Texture.from(c);
  return _vignetteTex;
};

const addGlow = (parent: PIXI.Container, x: number, y: number, width: number, height: number, alpha: number, mode: number = PIXI.BLEND_MODES.ADD, tint: number = 0xffffff) => {
  const s = new PIXI.Sprite(radialWhiteTexture());
  s.anchor.set(0.5);
  s.position.set(x, y);
  s.width = width;
  s.height = height;
  s.alpha = alpha;
  s.tint = tint;
  s.blendMode = mode;
  parent.addChild(s);
  return s;
};

// Living lights: macro lights that get a slow, subtle brightness pulse.
// A ticker registered on the shared app ticker drives them, so they pause
// automatically when a game modal is open (render loop pauses there).
const REDUCED_MOTION = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const _liveGlows: { sprite: PIXI.Sprite; base: number; speed: number; phase: number }[] = [];

const addLiveGlow = (parent: PIXI.Container, x: number, y: number, width: number, height: number, baseAlpha: number, tint: number, phase: number) => {
  const s = addGlow(parent, x, y, width, height, baseAlpha, PIXI.BLEND_MODES.ADD, tint);
  _liveGlows.push({ sprite: s, base: baseAlpha, speed: 0.8 + (phase % 1) * 0.6, phase });
  return s;
};

// Roulette wheels drawn on the map (mini canvas-drawn wheels that spin).
const ROULETTE_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const ROULETTE_REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

let _mapWheelTex: PIXI.Texture | null = null;
const mapWheelTexture = () => {
  if (_mapWheelTex) return _mapWheelTex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;
  const seg = (Math.PI * 2) / ROULETTE_ORDER.length;

  // Outer gold + inner dark wood
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#b7791f';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2);
  ctx.fillStyle = '#3b1a06';
  ctx.fill();

  // 37 colored segments (0 green, others red/black)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 2);
  ROULETTE_ORDER.forEach((num, i) => {
    const a0 = i * seg;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 0.82, a0, a0 + seg);
    ctx.fillStyle = num === 0 ? '#166534' : ROULETTE_REDS.has(num) ? '#b91c1c' : '#18181b';
    ctx.fill();
  });
  ctx.restore();

  // Gold hub
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.3);
  grad.addColorStop(0, '#fcd34d');
  grad.addColorStop(1, '#92400e');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  _mapWheelTex = PIXI.Texture.from(c);
  return _mapWheelTex;
};

// Generated casino-floor seamless tile (sprite-gen `floor` + background-tile).
// Loaded once from the published sprites tree; used as a repeating
// TilingSprite under the tables when USE_SPRITE_ATLAS is on. Procedural
// Graphics stay the fallback until the texture arrives.
let _floorTilePromise: Promise<PIXI.Texture> | null = null;
const loadFloorTile = (): Promise<PIXI.Texture> => {
  if (!_floorTilePromise) {
    _floorTilePromise = PIXI.Assets.load(publicAsset('/sprites/floor/tile.png')) as Promise<PIXI.Texture>;
    _floorTilePromise.catch(() => { _floorTilePromise = null; });
  }
  return _floorTilePromise;
};

// Rich velvet-felt overlay tile (procedural "sprite", drawn once on a canvas
// and cached). A soft embossed diamond lattice (gold highlight / walnut
// shadow edges) plus fine fabric grain gives the emerald carpet real texture
// depth instead of a flat color — and it layers over BOTH the procedural
// floor and the sprite-gen tile in atlas mode, so the floor never looks like
// a uniform fill.
let _velvetTex: PIXI.Texture | null = null;
const velvetFloorTexture = () => {
  if (_velvetTex) return _velvetTex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  // Embossed diamond lattice (~3.4 diamonds across the tile): top-left edges
  // catch a warm gold light, bottom-right edges fall into shadow.
  const d = size / 3.4;
  ctx.lineWidth = 1;
  for (let row = -1; row * d < size + d; row++) {
    for (let col = -1; col * d < size + d; col++) {
      const x = col * d;
      const y = row * d;
      ctx.strokeStyle = 'rgba(255, 226, 158, 0.10)';
      ctx.beginPath();
      ctx.moveTo(x - d / 2, y);
      ctx.lineTo(x, y - d / 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(4, 18, 10, 0.22)';
      ctx.beginPath();
      ctx.moveTo(x, y - d / 2);
      ctx.lineTo(x + d / 2, y);
      ctx.stroke();
    }
  }
  // Fine velvet grain: thousands of tiny light/dark flecks so the felt reads
  // as woven fabric rather than painted color.
  for (let i = 0; i < 1500; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.020)' : 'rgba(0,0,0,0.028)';
    ctx.fillRect(x, y, 1 + Math.random() * 1.2, 1 + Math.random() * 1.2);
  }
  _velvetTex = PIXI.Texture.from(c);
  return _velvetTex;
};

const _liveWheels: PIXI.Sprite[] = [];

// Maps each map table/prop to its sprite-gen atlas name (single idle frame).
// roulette/luckywheel are excluded here — their wheels already swap textures
// via the _liveWheels path; these atlases draw the standing table art.
const TABLE_ATLAS: Record<string, string> = {
  'blackjack-1': 'blackjack',
  'slots-1': 'slots',
  'cardgame-1': 'cardgame',
  'dice-1': 'dice',
  'coinflip-1': 'coinflip',
  'info-desk': 'reception',
  'smoking-area': 'smoking',
  'piano': 'piano',
};

// Table/prop sprites awaiting their atlas frame (filled during map build).
const _atlasTableSprites: PIXI.Sprite[] = [];

const REEL_SYMBOLS = ['💎', '🍀', '🍒', '🍋', '🍊', '🍇', '🍉', '⭐'];
const _liveReels: PIXI.Text[] = [];
let _reelAcc = 0;

let _liveTicker: PIXI.Text | null = null;
let _tickerEntries: string[] = [];
let _tickerOffset = 0;
let _tickerCenterX = 0;

let _luckyWheelTex: PIXI.Texture | null = null;
const luckyWheelTexture = () => {
  if (_luckyWheelTex) return _luckyWheelTex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;
  const seg = (Math.PI * 2) / 8;
  const colors = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#eab308'];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 2);
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, i * seg, (i + 1) * seg);
    ctx.fillStyle = colors[i];
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
  // Center hub with arrow
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.16);
  ctx.lineTo(cx - r * 0.07, cy + r * 0.1);
  ctx.lineTo(cx + r * 0.07, cy + r * 0.1);
  ctx.closePath();
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  _luckyWheelTex = PIXI.Texture.from(c);
  return _luckyWheelTex;
};

// Gold crystal chandelier sprite (drawn once on a canvas, reused at the
// three chandelier spots). Front-view fixture: hanging chain, scroll arms,
// glowing candles and teardrop crystals.
let _chandelierTex: PIXI.Texture | null = null;
const chandelierTexture = () => {
  if (_chandelierTex) return _chandelierTex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2;

  // Soft warm halo behind the whole fixture
  const halo = ctx.createRadialGradient(cx, 66, 6, cx, 66, 60);
  halo.addColorStop(0, 'rgba(255, 217, 138, 0.5)');
  halo.addColorStop(1, 'rgba(255, 217, 138, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  // Ceiling mount plate + hanging chain
  ctx.fillStyle = '#8a6a2a';
  ctx.beginPath();
  ctx.ellipse(cx, 8, 16, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#b7953f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, 12);
  ctx.lineTo(cx, 46);
  ctx.stroke();

  // Crown / main body
  const crown = ctx.createLinearGradient(cx - 20, 46, cx + 20, 46);
  crown.addColorStop(0, '#8a6a2a');
  crown.addColorStop(0.5, '#f3d98a');
  crown.addColorStop(1, '#8a6a2a');
  ctx.fillStyle = crown;
  ctx.beginPath();
  ctx.moveTo(cx - 20, 48);
  ctx.quadraticCurveTo(cx, 34, cx + 20, 48);
  ctx.lineTo(cx + 16, 60);
  ctx.quadraticCurveTo(cx, 52, cx - 16, 60);
  ctx.closePath();
  ctx.fill();

  // Six scroll arms (quadratic curves sweeping out + down)
  const armColor = '#d4b05f';
  ctx.strokeStyle = armColor;
  ctx.lineWidth = 3.5;
  const armTips: Array<[number, number]> = [];
  for (let a = -3; a <= 3; a++) {
    if (a === 0) continue;
    const side = a < 0 ? -1 : 1;
    const spread = Math.abs(a) * 14 + 10;
    const topY = 58 - Math.abs(a) * 4;
    const tipX = cx + side * (spread + 14);
    const tipY = 78 + Math.abs(a) * 6;
    ctx.beginPath();
    ctx.moveTo(cx + side * 8, topY);
    ctx.quadraticCurveTo(cx + side * spread, topY - 6, tipX, tipY);
    ctx.stroke();
    armTips.push([tipX, tipY]);
  }

  // Candle cups + glowing flames at each arm tip
  for (const [tipX, tipY] of armTips) {
    // small cup
    ctx.fillStyle = '#e9c877';
    ctx.beginPath();
    ctx.ellipse(tipX, tipY, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // warm flame + glow
    const flame = ctx.createRadialGradient(tipX, tipY - 8, 0.5, tipX, tipY - 8, 9);
    flame.addColorStop(0, 'rgba(255, 245, 200, 1)');
    flame.addColorStop(0.35, 'rgba(255, 205, 90, 0.9)');
    flame.addColorStop(1, 'rgba(255, 180, 60, 0)');
    ctx.fillStyle = flame;
    ctx.fillRect(tipX - 9, tipY - 17, 18, 18);
    ctx.fillStyle = '#fff7d6';
    ctx.beginPath();
    ctx.ellipse(tipX, tipY - 8, 2.6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Central candle
  ctx.fillStyle = '#fff7d6';
  ctx.beginPath();
  ctx.ellipse(cx, 70, 3, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  const centerFlame = ctx.createRadialGradient(cx, 60, 0.5, cx, 60, 9);
  centerFlame.addColorStop(0, 'rgba(255, 245, 200, 1)');
  centerFlame.addColorStop(1, 'rgba(255, 180, 60, 0)');
  ctx.fillStyle = centerFlame;
  ctx.fillRect(cx - 9, 51, 18, 18);

  // Crystal teardrops hanging below the crown
  for (let i = -2; i <= 2; i++) {
    const dx = cx + i * 9;
    const dy = 78 + Math.abs(i) * 5;
    ctx.strokeStyle = 'rgba(220, 240, 255, 0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.lineTo(dx, dy + 10);
    ctx.stroke();
    ctx.fillStyle = 'rgba(190, 225, 255, 0.8)';
    ctx.beginPath();
    ctx.moveTo(dx, dy + 9);
    ctx.lineTo(dx - 3, dy + 16);
    ctx.lineTo(dx + 3, dy + 16);
    ctx.closePath();
    ctx.fill();
  }

  _chandelierTex = PIXI.Texture.from(c);
  return _chandelierTex;
};

// Gold wall sconce sprite (bracket + candle with warm flame), drawn once.
let _sconceTex: PIXI.Texture | null = null;
const sconceTexture = () => {
  if (_sconceTex) return _sconceTex;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2;

  // Warm halo
  const halo = ctx.createRadialGradient(cx, 28, 3, cx, 28, 30);
  halo.addColorStop(0, 'rgba(255, 217, 138, 0.55)');
  halo.addColorStop(1, 'rgba(255, 217, 138, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  // Backplate (fluted gold)
  ctx.fillStyle = '#8a6a2a';
  ctx.beginPath();
  ctx.ellipse(cx, 20, 10, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e9c877';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, 2);
  ctx.lineTo(cx, 38);
  ctx.moveTo(cx - 6, 10);
  ctx.lineTo(cx + 6, 10);
  ctx.moveTo(cx - 7, 20);
  ctx.lineTo(cx + 7, 20);
  ctx.stroke();

  // Bracket arm to the cradle
  ctx.strokeStyle = '#d4b05f';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, 22);
  ctx.quadraticCurveTo(cx + 6, 42, cx - 12, 44);
  ctx.stroke();

  // Cradle + candle
  ctx.fillStyle = '#e9c877';
  ctx.beginPath();
  ctx.ellipse(cx - 12, 46, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff7d6';
  ctx.beginPath();
  ctx.ellipse(cx - 12, 38, 3.4, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Flame
  const flame = ctx.createRadialGradient(cx - 12, 26, 0.5, cx - 12, 26, 9);
  flame.addColorStop(0, 'rgba(255, 245, 200, 1)');
  flame.addColorStop(0.4, 'rgba(255, 205, 90, 0.9)');
  flame.addColorStop(1, 'rgba(255, 180, 60, 0)');
  ctx.fillStyle = flame;
  ctx.fillRect(cx - 21, 17, 18, 18);

  _sconceTex = PIXI.Texture.from(c);
  return _sconceTex;
};

export default function CasinoMap({
  userId,
  nickname,
  onTableInteraction,
  onPlayerInteraction,
  remotePlayers = [],
  avatarColor = '#4a90e2',
  avatarSize = 80,
  avatarImage = null,
sendMove,
chatMessages = {},
sendChat,
onToggleChat,
emotes = [],
sendEmote,
  localCurrentGame = null,
  paused = false,
  highscores = {},
  level = 1,
}: CasinoMapProps) {
  // Reception result ticker: marquee scrolls the top winners across the desk
  useEffect(() => {
    const tickerScroll = setInterval(() => {
      if (!_liveTicker || REDUCED_MOTION) return;
      _tickerOffset -= 1.5;
      const half = _liveTicker.width / 2;
      if (_tickerOffset < -half - 60) _tickerOffset = half + 60;
      _liveTicker.x = _tickerCenterX + _tickerOffset;
    }, 40);
    return () => clearInterval(tickerScroll);
  }, []);

  // Refresh the ticker contents whenever the leaderboard updates
  useEffect(() => {
    const entries = Object.entries(highscores || {})
      .filter(([, h]) => h && h.username && (h.amount || 0) > 0)
      .map(([, h]) => `🏆 ${h.username} won $${h.amount.toFixed(0)}`);
    _tickerEntries = entries.length ? entries : ['🎰 Casino 888 — play-money demo'];
    if (_liveTicker) {
      _liveTicker.text = _tickerEntries.join('   ·   ');
      _tickerOffset = _liveTicker.width / 2 + 60;
      _liveTicker.x = _tickerCenterX + _tickerOffset;
    }
  }, [highscores]);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const cameraRef = useRef<PIXI.Container | null>(null);
  const mapContainerRef = useRef<PIXI.Container | null>(null);
  const playersContainerRef = useRef<PIXI.Container | null>(null);

  const [localPlayer, setLocalPlayer] = useState<Player>({
    userId,
    x: SPAWN_X,
    y: SPAWN_Y,
    nickname: nickname || 'Player',
    isLocal: true,
    direction: 0,
    isMoving: false,
    avatarImage: avatarImage || null,
    avatarColor: avatarColor || '#4a90e2',
    smokeStart: null,
  });

  const [nearTable, setNearTable] = useState<GameTable | null>(null);
  const [nearPlayer, setNearPlayer] = useState<Player | null>(null);
  const [isSmoking, setIsSmoking] = useState(false);
  const isSmokingRef = useRef(false);
  const smokeStartRef = useRef<number | null>(null);
  const roomSmokingRef = useRef(false);
  const smokeHazeRef = useRef<{ container: PIXI.Container; parts: { sprite: PIXI.Graphics; baseX: number; baseY: number; phase: number }[] } | null>(null);
  const smokeAudioCtxRef = useRef<AudioContext | null>(null);
  const smokeAudioGainRef = useRef<GainNode | null>(null);
  const touchVectorRef = useRef<{ dx: number; dy: number; active: boolean }>({ dx: 0, dy: 0, active: false });
  const pointerActiveRef = useRef(false);
  const [showMobileHint, setShowMobileHint] = useState(true);
  const localPlayerRef = useRef(localPlayer);
  const localSpriteRef = useRef<PIXI.Container | null>(null);

  // Sprite-gen atlas support (feature-flagged). When enabled, the loaded
  // atlas is used to render map wheels; player avatars stay the picture
  // avatar. Procedural rendering remains the fallback the whole time.
  const spriteAtlasRef = useRef<{ roulette?: SpriteAtlas; luckywheel?: SpriteAtlas }>({});

  useEffect(() => {
    if (!USE_SPRITE_ATLAS) return;
    const disposed = { current: false };
    for (const name of ATLAS_NAMES) {
      loadSpriteAtlas(name)
        .then((atlas) => {
          if (disposed.current) return;
          spriteAtlasRef.current = { ...spriteAtlasRef.current, [name]: atlas };
          const firstFrame = atlasFrames(atlas, ATLAS_STATE[name])[0];
          if (!firstFrame) return;
          // Wheels keep the existing live-swap path (roulette/luckywheel):
          // swap the procedural wheel for the atlas art and hide the center
          // emoji that sat on top of it.
          for (const w of _liveWheels) {
            // Skip sprites destroyed by a remount (pixi v7 nulls `transform` on destroy).
            if (!w || !(w as any).transform) continue;
            if ((w as any).userData?.atlasKind !== name) continue;
            w.texture = firstFrame;
            const emoji = (w as any).userData?.emoji;
            if (emoji) emoji.visible = false;
          }
          // Table/prop bodies swap to the atlas idle frame.
          for (const t of _atlasTableSprites) {
            if (!t || !(t as any).transform) continue;
            if ((t as any).userData?.atlasKind !== name) continue;
            t.texture = firstFrame;
            t.visible = true;
            const emoji = (t as any).userData?.emoji;
            if (emoji) emoji.visible = false;
          }
        })
        .catch((err: unknown) => {
          // Fallback stays procedural; log quietly so the flag never blinds.
          if (!disposed.current) console.warn(`sprite atlas "${name}" failed to load — using procedural art.`, err);
        });
    }
    return () => {
      disposed.current = true;
    };
  }, []);

  // Physics & Input Refs (Persistent across renders)
  const velocityRef = useRef({ x: 0, y: 0 });
  const keysRef = useRef<{ [key: string]: boolean }>({});
  // Click-to-move target: while set, the physics loop walks to it and
  // keyboard movement is ignored; cleared on arrival (keyboard returns).
  const moveTargetRef = useRef<{ x: number; y: number } | null>(null);
  // Client-side click-to-move feedback: route line + expanding ping drawn in
  // world space; cleared on arrival or when a new click repaints it.
  const moveGuideRef = useRef<PIXI.Graphics | null>(null);
  const pingStartRef = useRef(0);
  const flashPingRef = useRef<{ x: number; y: number; start: number } | null>(null);
  const pingAudioRef = useRef<AudioContext | null>(null);
  const nearTableRef = useRef<GameTable | null>(null);
  const nearPlayerRef = useRef<Player | null>(null);
  const remotePlayersRef = useRef<Player[]>(remotePlayers);
  // Table the player clicked from afar; auto-enter once walk completes.
  const pendingTableIdRef = useRef<string | null>(null);
  const hoveredTableRef = useRef<GameTable | null>(null);
  const tableVisualsRef = useRef<Record<string, { emoji: PIXI.Text; glow: PIXI.Sprite; badge: PIXI.Text }>>({});
  const pointerMoveToRef = useRef<(x: number, y: number) => void>(() => {});
  const desktopClickRef = useRef<(x: number, y: number) => void>(() => {});
  const lastTimeRef = useRef(performance.now());
  const movementRef = useRef({ lastSend: 0, dx: 0, dy: 0, isMoving: false });
  // Coarse React-state sync: the physics loop owns the real position in
  // localPlayerRef; React state is only refreshed on a ~64px grid step or a
  // moving-flag flip so interaction hints stay live without 30fps re-renders.
  const lastStatePosRef = useRef({ x: SPAWN_X, y: SPAWN_Y });
  const lastStateMovingRef = useRef(false);

  // Latest-props bag so the physics/keyboard effect stays subscribed once and
  // still sees fresh callbacks (interaction + movement + chat).
  // Initial value only matters pre-first-render assignment; use a stub so it
  // never references callbacks still in their TDZ during this render pass.
  const handlerRefs = useRef<HandlerBag>({
    toggleSmoke: () => {},
  });
  // Refresh the fresh callbacks after every render. Lives in an effect so
  // this object never names callbacks still in their TDZ during the render
  // pass (toggleSmoke is declared further down the component).
  useEffect(() => {
    handlerRefs.current = {
      toggleSmoke,
      onTableInteraction,
      onPlayerInteraction,
      sendMove,
      onToggleChat,
    };
  });

  // Resolve the single nearest interactable from a live world position. The E key,
  // hints, and clicks all route through this so keyboard and pointer can never
  // disagree about what is "in range".
  const resolveInteractableFromPosition = useCallback(
    (x: number, y: number): InteractableTarget | null => {
      let bestTable: GameTable | null = null;
      let bestTableDist = Infinity;
      for (const t of GAME_TABLES) {
        const d = tableInteractDistance(t, x, y);
        if (d <= INTERACT_BUFFER && d < bestTableDist) {
          bestTableDist = d;
          bestTable = t;
        }
      }
      if (bestTable) return { kind: 'table', table: bestTable };

      let bestPlayer: Player | null = null;
      let bestPlayerDist = Infinity;
      for (const pl of remotePlayersRef.current) {
        const d = Math.hypot(x - pl.x, y - pl.y);
        if (d < PLAYER_INTERACTION_RADIUS && d < bestPlayerDist) {
          bestPlayerDist = d;
          bestPlayer = pl;
        }
      }
      if (bestPlayer) return { kind: 'player', player: bestPlayer };
      return null;
    },
    []
  );

  // Act on a resolved target. Reads the latest callbacks from handlerRefs, so
  // this stays referentially stable and the keyboard/physics effect never
  // needs to re-subscribe when interaction callbacks change.
  const activateInteractable = useCallback((target: InteractableTarget | null) => {
    if (!target) return;
    const h = handlerRefs.current;
    if (target.kind === 'table') {
      if (target.table.id === 'smoking-area') {
        h.toggleSmoke();
        return;
      }
      if (h.onTableInteraction) h.onTableInteraction(target.table.id);
    } else if (h.onPlayerInteraction) {
      h.onPlayerInteraction(target.player);
    }
  }, []);

  const clientToWorld = (clientX: number, clientY: number) => {
    const app = appRef.current;
    const camera = cameraRef.current;
    if (!app || !camera) return null;
    const rect = (app.view as HTMLCanvasElement).getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (app.renderer.screen.width / (rect.width || 1)) - camera.position.x,
      y: (clientY - rect.top) * (app.renderer.screen.height / (rect.height || 1)) - camera.position.y,
    };
  };

  // Highscore state - passed from parent DashboardView
  const [isMobile, setIsMobile] = useState(false);
  const isMobileRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => {
    localPlayerRef.current = localPlayer;
  }, [localPlayer]);

  // Sync nickname from props
  useEffect(() => {
    setLocalPlayer((prev) => ({
      ...prev,
      nickname: nickname || 'Player',
    }));
  }, [nickname]);

  // Sync userId from props
  useEffect(() => {
    if (userId && userId !== localPlayer.userId) {
      setLocalPlayer((prev) => ({
        ...prev,
        userId: userId,
      }));
    }
  }, [userId]);

  // Keep local player smoking flag in sync with state (so renderer picks it up)
  useEffect(() => {
    setLocalPlayer((prev) => ({ ...prev, isSmoking }));
  }, [isSmoking]);

  // Ambient smoke-lounge audio — procedural lofi jazz when smoking
  useEffect(() => {
    if (isSmoking) {
      if (smokeAudioCtxRef.current) return; // already running
      const ctx = new AudioContext();
      smokeAudioCtxRef.current = ctx;
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      smokeAudioGainRef.current = master;

      // Master lofi filter — warm, muffled
      const lofiFilter = ctx.createBiquadFilter();
      lofiFilter.type = 'lowpass';
      lofiFilter.frequency.value = 1800;
      lofiFilter.Q.value = 0.5;
      lofiFilter.connect(master);

      // ── Chord pad: Cmaj7 → Fmaj7 → Am7 → G7 ──
      const BPM = 72;
      const beatLen = 60 / BPM;
      const barLen = beatLen * 4;
      const cycleLen = barLen * 4;
      // Notes as MIDI-like semitones from C3
      const chords = [
        [0, 4, 7, 11],   // Cmaj7: C E G B
        [5, 9, 0+12, 4+12], // Fmaj7: F A C' E' (up an octave for spread)
        [9, 0+12, 4+12, 7+12], // Am7: A C' E' G'
        [7, 11, 2+12, 5+12],   // G7: G B D' F'
      ];
      const semitone = (n: number) => 130.81 * Math.pow(2, n / 12); // C3 base

      const now = ctx.currentTime;
      const loops = 8; // play for ~43 seconds then let it fade
      for (let loop = 0; loop < loops; loop++) {
        const t0 = now + loop * cycleLen;
        chords.forEach((chord, ci) => {
          const ct = t0 + ci * barLen;
          chord.forEach((note) => {
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.value = semitone(note);
            // Slight detune for warmth
            osc.detune.value = (Math.random() - 0.5) * 12;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0, ct);
            g.gain.linearRampToValueAtTime(0.018, ct + 0.4);
            g.gain.setValueAtTime(0.018, ct + barLen - 0.5);
            g.gain.linearRampToValueAtTime(0, ct + barLen);
            osc.connect(g).connect(lofiFilter);
            osc.start(ct);
            osc.stop(ct + barLen + 0.1);
          });
        });
      }

      // ── Bass line: root notes, deep sine ──
      const bassNotes = [0, 5, 9, 7]; // C, F, A, G
      for (let loop = 0; loop < loops; loop++) {
        const t0 = now + loop * cycleLen;
        bassNotes.forEach((note, ci) => {
          const bt = t0 + ci * barLen;
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = semitone(note - 12); // octave below
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, bt);
          g.gain.linearRampToValueAtTime(0.04, bt + 0.1);
          g.gain.setValueAtTime(0.04, bt + beatLen * 1.5);
          g.gain.linearRampToValueAtTime(0, bt + beatLen * 2);
          osc.connect(g).connect(master);
          osc.start(bt);
          osc.stop(bt + barLen);
        });
      }

      // ── Hi-hat: noise bursts on beats 2 & 4 ──
      const hatBuf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
      const hatData = hatBuf.getChannelData(0);
      for (let i = 0; i < hatData.length; i++) hatData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (hatData.length * 0.2));
      for (let loop = 0; loop < loops; loop++) {
        const t0 = now + loop * cycleLen;
        for (let bar = 0; bar < 4; bar++) {
          for (const beat of [1, 3]) { // beats 2 and 4 (0-indexed)
            const ht = t0 + bar * barLen + beat * beatLen;
            const src = ctx.createBufferSource();
            src.buffer = hatBuf;
            const hpf = ctx.createBiquadFilter();
            hpf.type = 'highpass';
            hpf.frequency.value = 6000;
            const hg = ctx.createGain();
            hg.gain.value = 0.035;
            src.connect(hpf).connect(hg).connect(lofiFilter);
            src.start(ht);
          }
        }
      }

      // ── Melody: simple pentatonic phrase, triangle wave ──
      const melodyNotes = [
        [12, 0.5], [14, 0.5], [16, 1], [14, 0.5], [12, 0.5], [11, 1], [0, 1],
        [4, 0.5], [5, 0.5], [7, 1], [5, 0.5], [4, 0.5], [2, 1], [0, 1],
      ];
      for (let loop = 0; loop < loops; loop++) {
        const t0 = now + loop * cycleLen;
        let mt = t0 + barLen * 2; // start melody halfway through cycle
        for (const [note, dur] of melodyNotes) {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = semitone(note + 12); // C4+ range
          osc.detune.value = (Math.random() - 0.5) * 15;
          const g = ctx.createGain();
          const noteLen = dur * beatLen;
          g.gain.setValueAtTime(0, mt);
          g.gain.linearRampToValueAtTime(0.022, mt + 0.05);
          g.gain.setValueAtTime(0.022, mt + noteLen * 0.6);
          g.gain.linearRampToValueAtTime(0, mt + noteLen);
          osc.connect(g).connect(lofiFilter);
          osc.start(mt);
          osc.stop(mt + noteLen + 0.1);
          mt += noteLen;
          if (mt > t0 + cycleLen) break;
        }
      }

      // ── Vinyl crackle: very quiet random clicks ──
      const crackleInterval = setInterval(() => {
        if (ctx.state === 'closed') { clearInterval(crackleInterval); return; }
        const src = ctx.createBufferSource();
        const cBuf = ctx.createBuffer(1, ctx.sampleRate * 0.003, ctx.sampleRate);
        const cData = cBuf.getChannelData(0);
        for (let i = 0; i < cData.length; i++) cData[i] = (Math.random() > 0.7 ? (Math.random() * 2 - 1) : 0) * 0.5;
        src.buffer = cBuf;
        const cg = ctx.createGain();
        cg.gain.value = 0.015;
        src.connect(cg).connect(master);
        src.start();
      }, 150 + Math.random() * 200);

      // Fade in
      master.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5);

      // Schedule stop after all loops finish
      const totalDur = loops * cycleLen + 1;
      setTimeout(() => {
        if (smokeAudioCtxRef.current === ctx) {
          master.gain.linearRampToValueAtTime(0, ctx.currentTime + 2);
          setTimeout(() => { ctx.close().catch(() => {}); }, 2500);
          smokeAudioCtxRef.current = null;
          smokeAudioGainRef.current = null;
        }
      }, totalDur * 1000);
    } else {
      // Fade out and clean up
      const ctx = smokeAudioCtxRef.current;
      const gain = smokeAudioGainRef.current;
      if (ctx && gain) {
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
        setTimeout(() => {
          ctx.close().catch(() => {});
        }, 2000);
        smokeAudioCtxRef.current = null;
        smokeAudioGainRef.current = null;
      }
    }
    return () => {
      const c = smokeAudioCtxRef.current;
      if (c) { c.close().catch(() => {}); smokeAudioCtxRef.current = null; smokeAudioGainRef.current = null; }
    };
  }, [isSmoking]);

  // Sync avatar image changes from props into local player state for rendering
  useEffect(() => {
    setLocalPlayer((prev) => ({
      ...prev,
      avatarImage: avatarImage || null,
      avatarSize: FIXED_AVATAR_SIZE,
    }));
  }, [avatarImage]);

  // Propagate avatar changes to the lobby so other clients update without waiting for movement
  useEffect(() => {
    if (!sendMove || pausedRef.current) return;
    const player = localPlayerRef.current;
    sendMove({
      x: player.x,
      y: player.y,
      direction: player.direction,
      isSmoking: isSmokingRef.current,
      smokeStart: smokeStartRef.current,
      seated: false,
    });
  }, [avatarImage, avatarColor, avatarSize, sendMove]);

  useEffect(() => {
    const updateIsMobile = () => {
      const coarse = typeof window !== 'undefined' && 'matchMedia' in window
        ? window.matchMedia('(pointer: coarse)').matches
        : false;
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
      const phoneLike = /iphone|ipad|android|mobile|ipod/.test(ua);
      const next = window.innerWidth <= 900 || coarse || phoneLike;
      if (isMobileRef.current && !next) stopTouchInput();
      isMobileRef.current = next;
      setIsMobile(next);
    };
    updateIsMobile();
    window.addEventListener('resize', updateIsMobile);
    window.addEventListener('orientationchange', updateIsMobile);
    return () => {
      window.removeEventListener('resize', updateIsMobile);
      window.removeEventListener('orientationchange', updateIsMobile);
    };
  }, []);

  const setTouchInput = (dx: number, dy: number) => {
    if (pausedRef.current) return;
    moveTargetRef.current = null;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      touchVectorRef.current = { dx: 0, dy: 0, active: false };
      return;
    }
    touchVectorRef.current = {
      dx: dx / length,
      dy: dy / length,
      active: true,
    };
  };

  const stopTouchInput = () => {
    touchVectorRef.current = { dx: 0, dy: 0, active: false };
  };

  useEffect(() => {
    if (!paused) return;
    for (const key of Object.keys(keysRef.current)) delete keysRef.current[key];
    moveTargetRef.current = null;
    velocityRef.current.x = 0;
    velocityRef.current.y = 0;
    stopTouchInput();
    pointerActiveRef.current = false;
    moveGuideRef.current?.clear();
    localPlayerRef.current = { ...localPlayerRef.current, isMoving: false };
    setLocalPlayer(localPlayerRef.current);
  }, [paused]);

  // Tap-to-move for touch devices. Use the same walking target as desktop;
  // never teleport or emit a full-distance movement from one tap.
  const handlePointerMoveTo = (clientX: number, clientY: number) => {
    if (pausedRef.current) return;
    const world = clientToWorld(clientX, clientY);
    if (!world) return;
    if (isMobileRef.current && showMobileHint) {
      setShowMobileHint(false);
    }
    const clampedX = Math.max(50, Math.min(MAP_WIDTH - 50, world.x));
    const clampedY = Math.max(50, Math.min(MAP_HEIGHT - 50, world.y));

    moveTargetRef.current = { x: clampedX, y: clampedY };
    pingStartRef.current = performance.now();
    playMovePing();
  };
  pointerMoveToRef.current = handlePointerMoveTo;

  // Mobile helper to center camera if lost
  const handleRecenter = () => {
    if (!appRef.current || pausedRef.current) return;
    moveTargetRef.current = null;
    flashPingRef.current = { x: SPAWN_X, y: SPAWN_Y, start: performance.now() };
    if (moveGuideRef.current) moveGuideRef.current.clear();
    setLocalPlayer((prev) => ({
      ...prev,
      x: SPAWN_X,
      y: SPAWN_Y,
      direction: 0,
      isMoving: false,
    }));
    if (sendMove) {
      sendMove({ x: SPAWN_X, y: SPAWN_Y, direction: 0, isSmoking: isSmokingRef.current, smokeStart: smokeStartRef.current, seated: false });
    }
  };

  const mulberry32 = (seed: number) => {
    return () => {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  };

  // --- GLOBAL ANIMATION HELPERS (No Tickers) ---
  const ensureSmokeState = (sprite: any, isSmoking: boolean, smokeStart?: number | null, playerKey?: string) => {
    if (!sprite) return;
    const scale = sprite.userData?.scaleFactor || 1;

    // Cleanup if stopping
    if (!isSmoking) {
      if (sprite.userData?.smokeContainer) {
        sprite.removeChild(sprite.userData.smokeContainer);
        sprite.userData.smokeContainer.destroy({ children: true });
        delete sprite.userData.smokeContainer;
      }
      if (sprite.userData?.ember) {
        sprite.removeChild(sprite.userData.ember);
        sprite.userData.ember.destroy({ children: true });
        delete sprite.userData.ember;
      }
      if (sprite.userData?.cigarette) {
        sprite.removeChild(sprite.userData.cigarette);
        sprite.userData.cigarette.destroy();
        delete sprite.userData.cigarette;
      }
      return;
    }

    // If already exists, just update timestamp
    if (sprite.userData?.smokeContainer) {
      sprite.userData.smokeStartTime = smokeStart || Date.now();
      return;
    }

    // Pulsing ember glow at the tip (animated by the global loop)
    const ember = new PIXI.Container();
    ember.zIndex = 5;
    const emberCore = new PIXI.Graphics();
    emberCore.beginFill(0xff6600);
    emberCore.drawCircle(20 * scale, -18.5 * scale, 2.2 * scale);
    emberCore.endFill();
    ember.addChild(emberCore);
    addGlow(ember, 20 * scale, -18.5 * scale, 16 * scale, 16 * scale, 0.4, PIXI.BLEND_MODES.ADD, 0xff7733);
    sprite.addChild(ember);
    sprite.userData.ember = ember;

    // Create Smoke Container
    const smokeContainer = new PIXI.Container();
    smokeContainer.zIndex = 5;
    smokeContainer.position.set(22 * scale, -22 * scale);
    sprite.addChild(smokeContainer);
    sprite.userData.smokeContainer = smokeContainer;
    sprite.userData.smokeStartTime = smokeStart || Date.now();

    // Create Static Particles (animated by global loop)
    const seedSource = (smokeStart || Date.now()) + (playerKey ? playerKey.length * 31 : 0);
    const rand = mulberry32(seedSource);

    for (let i = 0; i < 12; i++) {
      const smoke = new PIXI.Graphics();
      // Mix warm and cool smoke tones
      const tone = i < 6 ? 0xe8e0d8 : 0xc8c4be;
      smoke.beginFill(tone, 0.20 + (i % 3) * 0.05);
      const size = (4 + rand() * 6) * scale;
      smoke.drawCircle(0, 0, size);
      smoke.endFill();
      smokeContainer.addChild(smoke);

      // Store anim data on the particle itself
      (smoke as any).userData = {
        baseSize: size,
        driftX: (rand() - 0.5) * 10 * scale,
        driftY: - (8 + rand() * 14) * scale,
        alpha: 0.30 + rand() * 0.30,
        offset: rand() * Math.PI * 2,
        swirl: (rand() - 0.5) * 3,
      };
    }
  };

const ensureChatBubble = (sprite: any, chat?: { message: string; timestamp: number }) => {
if (!sprite) return;
const scale = sprite.userData?.scaleFactor || 1;

// Remove existing bubble if different or expired
if (!chat) {
if (sprite.userData?.chatBubble) {
sprite.removeChild(sprite.userData.chatBubble);
sprite.userData.chatBubble.destroy({ children: true });
delete sprite.userData.chatBubble;
}
return;
}

// If matches current, ignore
if (sprite.userData?.chatBubble?.userData?.timestamp === chat.timestamp) return;

// Clean old
if (sprite.userData?.chatBubble) {
sprite.removeChild(sprite.userData.chatBubble);
sprite.userData.chatBubble.destroy({ children: true });
}

const bubble = new PIXI.Container();
const bg = new PIXI.Graphics();
const padding = 8 * scale;
const text = new PIXI.Text(chat.message.slice(0, 80), {
fill: '#ffffff', fontSize: 14 * scale, fontWeight: 'bold',
wordWrap: true, wordWrapWidth: 180 * scale, align: 'center'
});
text.position.set(padding, padding);

bg.beginFill(0x000000, 0.85);
bg.drawRoundedRect(0, 0, text.width + padding * 2, text.height + padding * 2, 12);
bg.endFill();

bubble.addChild(bg);
bubble.addChild(text);
bubble.position.set(-((text.width + padding * 2) / 2), -(sprite.userData?.baseRadius || 40) - text.height - padding * 2);
bubble.zIndex = 10;

// Store metadata for global loop
(bubble as any).userData = { timestamp: chat.timestamp };

sprite.addChild(bubble);
sprite.userData.chatBubble = bubble;
};

const ensureEmoteBubble = (sprite: any, emote?: { emote: string; ts: number }) => {
if (!sprite) return;
const scale = sprite.userData?.scaleFactor || 1;
if (!emote) {
if (sprite.userData?.emoteBubble) {
sprite.removeChild(sprite.userData.emoteBubble);
sprite.userData.emoteBubble.destroy({ children: true });
delete sprite.userData.emoteBubble;
}
return;
}
if (sprite.userData?.emoteBubble?.userData?.ts === emote.ts) return;
if (sprite.userData?.emoteBubble) {
sprite.removeChild(sprite.userData.emoteBubble);
sprite.userData.emoteBubble.destroy({ children: true });
}
const bubble = new PIXI.Text(emote.emote, {
fontSize: 30 * scale, fontWeight: 'bold',
});
bubble.anchor.set(0.5);
bubble.position.set(0, -(sprite.userData?.baseRadius || 40) - 62 * scale);
bubble.zIndex = 11;
(bubble as any).userData = { ts: emote.ts };
sprite.addChild(bubble);
sprite.userData.emoteBubble = bubble;
};

const ensureGameBadge = (sprite: any, game?: string | null) => {
if (!sprite) return;
const scale = sprite.userData?.scaleFactor || 1;
if (!game) {
if (sprite.userData?.gameBadgeHolder) {
sprite.removeChild(sprite.userData.gameBadgeHolder);
sprite.userData.gameBadgeHolder.destroy({ children: true });
delete sprite.userData.gameBadgeHolder;
delete sprite.userData.gameBadge;
}
return;
}
if (sprite.userData?.gameBadgeHolder) {
sprite.userData.gameBadge.text = game;
const bg = sprite.userData.gameBadgeHolder.children[0];
if (bg && bg.clear && bg.drawRoundedRect) {
bg.clear();
bg.beginFill(0x000000, 0.7);
bg.drawRoundedRect(-sprite.userData.gameBadge.width / 2 - 4 * scale, 0, sprite.userData.gameBadge.width + 8 * scale, 16 * scale, 8 * scale);
bg.endFill();
}
return;
}
const badge = new PIXI.Text(game, {
fontSize: 12 * scale, fontWeight: 'bold', fill: '#f7c948',
});
badge.anchor.set(0.5);
badge.position.set(0, 8 * scale);
const bg = new PIXI.Graphics();
bg.beginFill(0x000000, 0.7);
bg.drawRoundedRect(-badge.width / 2 - 4 * scale, 0, badge.width + 8 * scale, 16 * scale, 8 * scale);
bg.endFill();
const holder = new PIXI.Container();
holder.addChild(bg);
holder.addChild(badge);
holder.position.set(0, (sprite.userData?.baseRadius || 40) + 18 * scale);
holder.zIndex = 12;
holder.interactiveChildren = false;
sprite.addChild(holder);
sprite.userData.gameBadgeHolder = holder;
sprite.userData.gameBadge = badge;
};

// Keep smoking ref in sync and broadcast to other players
  useEffect(() => {
    isSmokingRef.current = isSmoking;
    if (isSmoking && !smokeStartRef.current) {
      smokeStartRef.current = Date.now();
      setLocalPlayer((prev) => ({ ...prev, smokeStart: smokeStartRef.current }));
    }
    if (!isSmoking) {
      smokeStartRef.current = null;
      setLocalPlayer((prev) => ({ ...prev, smokeStart: null }));
    }
    // Broadcast smoking state change to other players
    if (sendMove && !pausedRef.current) {
      const player = localPlayerRef.current;
      sendMove({ x: player.x, y: player.y, direction: player.direction, isSmoking, smokeStart: smokeStartRef.current, seated: false });
    }
  }, [isSmoking, sendMove]);

  // Toggle smoking on/off when interacting with the smoking room
  const toggleSmoke = useCallback(() => {
    if (pausedRef.current) return;
    if (isSmokingRef.current) {
      smokeStartRef.current = null;
      setIsSmoking(false);
      if (sendMove) {
        const player = localPlayerRef.current;
        sendMove({ x: player.x, y: player.y, direction: player.direction, isSmoking: false, smokeStart: null, seated: false });
      }
    } else {
      smokeStartRef.current = Date.now();
      setIsSmoking(true);
      if (sendMove) {
        const player = localPlayerRef.current;
        sendMove({ x: player.x, y: player.y, direction: player.direction, isSmoking: true, smokeStart: smokeStartRef.current, seated: false });
      }
    }
  }, [sendMove]);




  // Initialize PixiJS application
  useEffect(() => {
    if (!canvasRef.current) return;

    const containerWidth = canvasRef.current.clientWidth || window.innerWidth;
    const containerHeight = canvasRef.current.clientHeight || window.innerHeight;

    const app = new PIXI.Application({
      width: containerWidth,
      height: containerHeight,
      backgroundColor: 0x1a1a2e, // Dark blue casino background
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      resizeTo: canvasRef.current, // Auto-resize to container
    });
    (app.view as HTMLCanvasElement).style.position = "absolute";
    (app.view as HTMLCanvasElement).style.display = "block";

    // HARD CAP FPS to 30
    // Stop the default ticker and drive it manually
    app.ticker.stop();
    app.ticker.autoStart = false;

    const view = app.view as HTMLCanvasElement;
    view.style.width = '100%';
    view.style.height = '100%';
    view.style.touchAction = 'none';
    view.style.position = 'absolute';
    view.style.inset = '0';
    view.style.userSelect = 'none';
    canvasRef.current.style.position = 'relative';
    canvasRef.current.appendChild(view);
    appRef.current = app;

    // Custom Render Loop
    const TARGET_FPS = 30;
    const FRAME_DELAY = 1000 / TARGET_FPS;
    let lastFrameTime = performance.now();
    let renderReqId: number;

    const renderLoop = (time: number) => {
      renderReqId = requestAnimationFrame(renderLoop);
      // Freeze the lobby render while a game modal is open (frees GPU for the game)
      if (pausedRef.current) { lastFrameTime = time; return; }
      const delta = time - lastFrameTime;

      if (delta >= FRAME_DELAY) {
        // Update Pixi Logic & Render
        app.ticker.update(time);
        app.renderer.render(app.stage); // Explicitly trigger render

        // Adjust time to target FPS interval
        lastFrameTime = time - (delta % FRAME_DELAY);
      }
    };

    renderReqId = requestAnimationFrame(renderLoop);

    // Camera container (follows player)
    const camera = new PIXI.Container();
    app.stage.addChild(camera);
    cameraRef.current = camera;
    // Snap camera onto the player once; the physics loop LERPs it from there.
    camera.position.set(
      -localPlayerRef.current.x + app.renderer.screen.width / 2,
      -localPlayerRef.current.y + app.renderer.screen.height / 2
    );

    // Map container (static world). Scaled so the whole floor (floor, walls,
    // decorations, vignette) grows with MAP_SCALE while player avatars stay
    // their fixed size and game positions stay in world coordinates.
    const mapContainer = new PIXI.Container();
    mapContainer.scale.set(MAP_SCALE);
    camera.addChild(mapContainer);
    mapContainerRef.current = mapContainer;

    // Table-name plaque HUD layer: plaques/labels are drawn in map-internal
    // space (same MAP_SCALE) but land in their OWN camera child that is added
    // ABOVE players below, so player avatars + floating name tags never cover
    // table titles (Fix 2: labels always readable).
    const plaqueLayer = new PIXI.Container();
    plaqueLayer.scale.set(MAP_SCALE);

    // Render the casino map first (so it's behind players)
    renderCasinoMap(mapContainer, plaqueLayer);

    // Generated seamless floor (plan step 4): swap the procedural floor for a
    // repeating TilingSprite behind the tables once the tile texture loads.
    // Pure visual layering — hit-testing/layout never changes.
    if (USE_SPRITE_ATLAS) {
      loadFloorTile()
        .then((tex) => {
          if (mapContainer.destroyed) return;
          const floorLayers = mapContainer.children.filter(
            (kid) => kid.name === 'casinoFloor' || kid.name === 'casinoChecker'
          );
          for (const kid of floorLayers) mapContainer.removeChild(kid);
          const tile = new PIXI.TilingSprite(tex, MAP_W, MAP_H);
          tile.name = 'casinoFloorTile';
          // Repeat more: each tile renders at ~72% of the 512px source so the
          // emerald/gold texture fills the floor with finer, denser repeats.
          tile.tileScale.set(0.72);
          tile.position.set(0, 0);
          mapContainer.addChildAt(tile, 0);
        })
        .catch((err: unknown) => {
          if (!mapContainer.destroyed) console.warn('casino floor tile failed to load — keeping procedural floor.', err);
        });
    }
    // Living lights: gentle brightness pulse on the macro glows
    if (!REDUCED_MOTION && _liveGlows.length > 0) {
      const liveTicker = () => {
        const t = performance.now() / 1000;
        for (const g of _liveGlows) {
          g.sprite.alpha = g.base * (0.75 + 0.25 * (0.5 + 0.5 * Math.sin(t * g.speed + g.phase)));
        }
      };
      app.ticker.add(liveTicker);
    }

    // Spinning roulette wheels on the map
    if (!REDUCED_MOTION && _liveWheels.length > 0) {
      const wheelTicker = () => {
        for (const w of _liveWheels) w.rotation += 0.012;
      };
      app.ticker.add(wheelTicker);
    }

    // Idle slot reels on the map (cycle symbols, pause on the payoff line)
    if (!REDUCED_MOTION && _liveReels.length > 0) {
      const reelTicker = () => {
        _reelAcc = (_reelAcc + 1) % 18;
        if (_reelAcc !== 0) return;
        for (const t of _liveReels) {
          t.text = REEL_SYMBOLS[Math.floor(Math.random() * REEL_SYMBOLS.length)];
        }
      };
      app.ticker.add(reelTicker);
    }

    // Hover feedback: ease emoji/glow/badge toward the hovered table; spin the
    // coin-flip icon while hovered. Interpolated so enter/leave is smooth.
    const hoverTicker = () => {
      const target = hoveredTableRef.current;
      for (const [id, v] of Object.entries(tableVisualsRef.current)) {
        const isTarget = target?.id === id;
        const to = isTarget ? 1 : 0;
        const cur = v.badge.alpha + (to - v.badge.alpha) * 0.2;
        v.badge.alpha = cur;
        v.emoji.scale.set(1 + cur * 0.08);
        v.glow.alpha = 0.12 + cur * 0.25;
        if (isTarget && id === 'coinflip-1' && !REDUCED_MOTION) {
          v.emoji.rotation += 0.06; // coin spin keyframe
        } else {
          v.emoji.rotation *= 0.9; // ease back when unhovered
        }
      }
    };
    app.ticker.add(hoverTicker);

    // Players container (for all player sprites) - added after map so it renders on top
    const playersContainer = new PIXI.Container();
    playersContainer.zIndex = 1000;
    camera.addChild(playersContainer); // Add to camera, not mapContainer, so it's always on top
    playersContainerRef.current = playersContainer;

    // Plaque HUD layer above players/below the move guide: title plaques keep
    // rendering order regardless of how many avatars stand near the table.
    camera.addChild(plaqueLayer);

    // Click-to-move guide layer: route line + ping (client-side only). Drawn on
    // top of players so the user always sees where they clicked.
    const moveGuide = new PIXI.Graphics();
    camera.addChild(moveGuide);
    moveGuideRef.current = moveGuide;

    // Handle container resize
    const resizeObserver = new ResizeObserver(() => {
      if (appRef.current && canvasRef.current) {
        const width = canvasRef.current.clientWidth;
        const height = canvasRef.current.clientHeight;
        if (width > 0 && height > 0) {
          appRef.current.renderer.resize(width, height);
          // Re-center camera on the player or the world stays off-center after a layout change
          if (cameraRef.current && localPlayerRef.current) {
            cameraRef.current.position.set(
              -localPlayerRef.current.x + appRef.current.renderer.screen.width / 2,
              -localPlayerRef.current.y + appRef.current.renderer.screen.height / 2
            );
          }
        }
      }
    });

    if (canvasRef.current) {
      resizeObserver.observe(canvasRef.current);
    }

    const pointerDownHandler = (e: PointerEvent) => {
      if (pausedRef.current) return;
      // Clicking the scene returns keyboard focus to it — otherwise the focus
      // sits on the last clicked UI button and WASD goes dead.
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && ae !== view && !ae.closest('input, textarea, select, [contenteditable]')) {
        ae.blur();
      }
      if (!isMobileRef.current) {
        // Desktop: click-to-interact on the target, or click-to-move
        e.preventDefault();
        desktopClickRef.current(e.clientX, e.clientY);
        return;
      }
      pointerActiveRef.current = true;
      e.preventDefault();
      pointerMoveToRef.current(e.clientX, e.clientY);
    };
    const pointerMoveHandler = (e: PointerEvent) => {
      if (!isMobileRef.current) {
        // Desktop hover: highlight the table under the cursor
        const world = clientToWorld(e.clientX, e.clientY);
        if (world) {
          const next = GAME_TABLES.find((t) => t.id !== 'smoking-area' && tableBodyContains(t, world.x, world.y)) || null;
          if (next !== hoveredTableRef.current) {
            hoveredTableRef.current = next;
            view.style.cursor = next ? 'pointer' : 'default';
          }
        }
        return;
      }
      return;
    };
    const pointerUpHandler = (e: PointerEvent) => {
      if (!isMobileRef.current) return;
      e.preventDefault();
      pointerActiveRef.current = false;
    };
    const pointerLeaveHandler = () => {
      if (isMobileRef.current) return;
      hoveredTableRef.current = null;
      view.style.cursor = 'default';
    };

    view.addEventListener('pointerdown', pointerDownHandler, { passive: false });
    view.addEventListener('pointermove', pointerMoveHandler, { passive: false });
    view.addEventListener('pointerleave', pointerLeaveHandler);
    window.addEventListener('pointerup', pointerUpHandler, { passive: false });
    window.addEventListener('pointercancel', pointerUpHandler, { passive: false });

    return () => {
      cancelAnimationFrame(renderReqId);
      view.removeEventListener('pointerdown', pointerDownHandler);
      view.removeEventListener('pointermove', pointerMoveHandler);
      view.removeEventListener('pointerleave', pointerLeaveHandler);
      window.removeEventListener('pointerup', pointerUpHandler);
      window.removeEventListener('pointercancel', pointerUpHandler);
      resizeObserver.disconnect();
      app.destroy(true, { children: true });
      _liveTicker = null;
    };
  }, []);

  // Render casino map with tables and background.
  // `plaqueLayer` (optional) is a camera-level container with the same
  // MAP_SCALE applied; table name plaques/labels are drawn there so they render
  // ABOVE player avatars and floating tags → table titles are never occluded.
  const renderCasinoMap = (container: PIXI.Container, plaqueLayer: PIXI.Container | null = null) => {
    _liveGlows.length = 0;
    _liveWheels.length = 0;
    _liveReels.length = 0;
    _atlasTableSprites.length = 0;
    _reelAcc = 0;
    smokeHazeRef.current = null;
    // Casino floor (deep emerald felt)
    const floor = new PIXI.Graphics();
    floor.beginFill(0x0b3a21); // Deep emerald
    floor.drawRect(0, 0, MAP_W, MAP_H);
    floor.endFill();
    floor.name = 'casinoFloor';
    container.addChild(floor);

    // Velvet-felt overlay: embossed diamond lattice + fabric grain for texture
    // depth (keeps the floor from reading as a flat uniform fill). Layered over
    // the procedural floor AND, in atlas mode, the generated floor tile — its
    // name is NOT 'casinoFloor'/'casinoChecker' so the tile swap leaves it in
    // place and the felt pattern stays above the tile.
    const velvet = new PIXI.TilingSprite(velvetFloorTexture(), MAP_W, MAP_H);
    velvet.name = 'casinoVelvet';
    velvet.tileScale.set(0.9);
    velvet.position.set(0, 0);
    container.addChild(velvet);

    // Grand soft rug that anchors the whole game ring (subtle emerald wash +
    // gold hairlines) so the six game tables feel connected to the arena.
    const arenaRug = new PIXI.Graphics();
    arenaRug.beginFill(0x0d4a2a, 0.55);
    arenaRug.drawEllipse(960, 520, 720, 470);
    arenaRug.endFill();
    arenaRug.lineStyle(2, 0xd4b05f, 0.22);
    arenaRug.drawEllipse(960, 520, 720, 470);
    arenaRug.lineStyle(1, 0xffdf8a, 0.12);
    arenaRug.drawEllipse(960, 520, 680, 445);
    arenaRug.lineStyle(1, 0xd4b05f, 0.14);
    arenaRug.drawEllipse(960, 520, 620, 400);
    container.addChild(arenaRug);

    // Inlaid gold floor trim connecting the medallion to each game node —
    // faint rays out to the ring so the tables sit on a deliberate design, not
    // floating on an empty field.
    const goldWeb = new PIXI.Graphics();
    goldWeb.lineStyle(1.5, 0xd4b05f, 0.16);
    for (const t of GAME_TABLES) {
      if (t.id === 'roulette-1') continue;
      goldWeb.moveTo(960, 520);
      goldWeb.lineTo(t.x, t.y);
    }
    goldWeb.lineStyle(1, 0xffdf8a, 0.10);
    goldWeb.drawCircle(960, 520, 240);
    goldWeb.drawCircle(960, 520, 300);
    goldWeb.drawCircle(960, 520, 360);
    container.addChild(goldWeb);

    // Grand centerpiece floor medallion under the roulette
    const medallion = new PIXI.Graphics();
    medallion.beginFill(0x0e3b22, 0.85);
    medallion.drawCircle(960, 520, 168);
    medallion.endFill();
    medallion.lineStyle(3, 0xd4b05f, 0.30);
    medallion.drawCircle(960, 520, 168);
    medallion.lineStyle(6, 0xd4b05f, 0.16);
    medallion.drawCircle(960, 520, 182);
    medallion.lineStyle(1, 0xffdf8a, 0.16);
    medallion.drawCircle(960, 520, 196);
    container.addChild(medallion);

    // --- Partitioned floor zones (Fix 3) -----------------------------------
    // VIP zone: raised walnut parquet platform in the top-right corner. Plank
    // seams + gold trim make the High-Limit Bar + piano read as a real room
    // with its own floor instead of furniture pasted on the carpet.
    const vipSlab = new PIXI.Graphics();
    const vx0 = 1365;
    const vx1 = MAP_W - 32; // flush with the right wall interior
    const vTop = 60;
    const vBot = 340;
    vipSlab.beginFill(0x2a1a0c, 0.97);
    vipSlab.drawRoundedRect(vx0, vTop, vx1 - vx0, vBot - vTop, 12);
    vipSlab.endFill();
    // Parquet plank seams (running boards)
    vipSlab.lineStyle(1, 0x000000, 0.35);
    for (let py = vTop + 26; py < vBot; py += 26) {
      vipSlab.moveTo(vx0 + 6, py);
      vipSlab.lineTo(vx1 - 6, py);
    }
    // Gold trim border + inner bevel
    vipSlab.lineStyle(2, 0xd4b05f, 0.9);
    vipSlab.drawRoundedRect(vx0, vTop, vx1 - vx0, vBot - vTop, 12);
    vipSlab.lineStyle(1, 0xffdf8a, 0.3);
    vipSlab.drawRoundedRect(vx0 + 7, vTop + 7, vx1 - vx0 - 14, vBot - vTop - 14, 9);
    container.addChild(vipSlab);

    // Smoking Room: distinct dark slate tile slab underneath the glass alcove
    // so the lounge reads as an enclosed floor zone (not a floating UI block).
    const smTable = GAME_TABLES.find((t) => t.id === 'smoking-area');
    if (smTable && smTable.width && smTable.height) {
      const smL = smTable.x - smTable.width / 2;
      const smT = smTable.y - smTable.height / 2;
      const smSlab = new PIXI.Graphics();
      smSlab.beginFill(0x171b22, 0.96);
      smSlab.drawRoundedRect(smL - 14, smT - 14, smTable.width + 28, smTable.height + 28, 10);
      smSlab.endFill();
      // Slate tile grid
      smSlab.lineStyle(1, 0x000000, 0.35);
      for (let tx = smL - 4; tx < smL + smTable.width + 4; tx += 46) {
        smSlab.moveTo(tx, smT - 8);
        smSlab.lineTo(tx, smT + smTable.height + 8);
      }
      for (let ty = smT - 4; ty < smT + smTable.height + 4; ty += 46) {
        smSlab.moveTo(smL - 8, ty);
        smSlab.lineTo(smL + smTable.width + 8, ty);
      }
      // Steel frame trim + gold accent
      smSlab.lineStyle(2, 0x8a94a0, 0.85);
      smSlab.drawRoundedRect(smL - 14, smT - 14, smTable.width + 28, smTable.height + 28, 10);
      smSlab.lineStyle(1, 0xd4b05f, 0.4);
      smSlab.drawRoundedRect(smL - 10, smT - 10, smTable.width + 20, smTable.height + 20, 8);
      container.addChild(smSlab);

      // Low partition rail along the room's open (left) edge — a steel barrier
      // with gold cap posts that encloses the lounge without blocking entry.
      const smRail = new PIXI.Graphics();
      smRail.lineStyle(3, 0x8a94a0, 0.9);
      smRail.moveTo(smL - 12, smT - 8);
      smRail.lineTo(smL - 12, smT + smTable.height + 8);
      smRail.lineStyle(2, 0xc9a348, 0.9);
      smRail.beginFill(0xc9a348);
      smRail.drawCircle(smL - 12, smT - 8, 5);
      smRail.drawCircle(smL - 12, smT + 40, 5);
      smRail.endFill();
      container.addChild(smRail);
    }

    // Decorative floor props in the dead zones (potted palms + planter bar).
    // The sprite-gen `palm` atlas idle frame replaces each procedural palm
    // once it loads (USE_SPRITE_ATLAS only); procedural art stays as fallback
    // and hit-testing/layout are unchanged.
    const addPalm = (px: number, py: number, size: number) => {
      const palmGroup = new PIXI.Container();
      const pot = new PIXI.Graphics();
      pot.beginFill(0x5a2e12);
      pot.drawRoundedRect(px - size * 0.6, py - size * 0.25, size * 1.2, size * 0.7, size * 0.15);
      pot.endFill();
      pot.lineStyle(1, 0xd4b05f, 0.25);
      pot.drawRoundedRect(px - size * 0.6, py - size * 0.25, size * 1.2, size * 0.7, size * 0.15);
      palmGroup.addChild(pot);
      const foliage = new PIXI.Graphics();
      foliage.beginFill(0x1f7a3d, 0.9);
      foliage.drawCircle(px, py - size * 0.5, size * 0.65);
      foliage.endFill();
      foliage.beginFill(0x2d9d4f, 0.75);
      foliage.drawCircle(px - size * 0.4, py - size * 0.65, size * 0.35);
      foliage.drawCircle(px + size * 0.4, py - size * 0.65, size * 0.35);
      foliage.endFill();
      palmGroup.addChild(foliage);
      container.addChild(palmGroup);
      if (USE_SPRITE_ATLAS) {
        const atlasSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        atlasSprite.anchor.set(0.5);
        atlasSprite.position.set(px, py);
        const fit = size * 1.7;
        atlasSprite.width = fit;
        atlasSprite.height = fit;
        atlasSprite.visible = false;
        (atlasSprite as any).userData = { atlasKind: 'palm', emoji: palmGroup };
        container.addChild(atlasSprite);
        _atlasTableSprites.push(atlasSprite);
      }
    };
    addPalm(280, 420, 46);
    addPalm(1640, 420, 46);
    addPalm(280, 640, 40);
    addPalm(1640, 640, 40);
    addPalm(470, 995, 50);
    addPalm(1450, 995, 50);

    // Warm ambient light pool over the center of the room
    addLiveGlow(container, 960, 540, 1600, 1100, 0.10, 0xfff2cc, 0);

    // Game table emoji mapping
    const tableEmojis: Record<string, string> = {
      'coinflip-1': '💰',
      'cardgame-1': '🃏',
      'luckywheel-1': '🎡',
      'roulette-1': '🎯',
      'slots-1': '🎰',
      'blackjack-1': '♠️',
      'dice-1': '🎲',
      'info-desk': '📋',
      'smoking-area': '🌫️',
      'piano': '🎹',
    };

    // Render game tables
    GAME_TABLES.forEach((table) => {
      const isRect = table.width && table.height;
      const tableW = isRect && table.width ? table.width : table.radius * 2;
      const tableH = isRect && table.height ? table.height : table.radius * 2;
      // Atlas mode: circular table/props get a clean single gold ring so the
      // generated sprite art (drawn over the circle) reads clearly instead of
      // fighting double glow rings, cushion layers and rim dots.
      const premiumCircle = USE_SPRITE_ATLAS && !isRect;

      // Soft floor shadow under the table
      addGlow(container, table.x, table.y, tableW * 2.4, tableH * 2.4, 0.35, PIXI.BLEND_MODES.NORMAL, 0x000000);

      // Warm spotlight pool tinted by the table color
      const glowSprite = addGlow(container, table.x, table.y, tableW * 3, tableH * 3, 0.12, PIXI.BLEND_MODES.ADD, table.color);

      // Raised gold dais under the centerpiece roulette
      if (table.id === 'roulette-1') {
        const dais = new PIXI.Graphics();
        dais.beginFill(0x231208);
        dais.drawCircle(table.x, table.y, table.radius + 22);
        dais.endFill();
        dais.lineStyle(4, 0xd4b05f, 0.65);
        dais.drawCircle(table.x, table.y, table.radius + 22);
        dais.lineStyle(1, 0xffdf8a, 0.35);
        dais.drawCircle(table.x, table.y, table.radius + 33);
        container.addChild(dais);
      }

      // Outer glow ring — a single standardized gold bezel for EVERY node so
      // no table reads as heavier or lighter than its neighbors. Colored
      // character stays in the inner rim/dots below.
      const outerGlow = new PIXI.Graphics();
      outerGlow.lineStyle(3, 0xd4b05f, 0.5);
      if (isRect && table.width && table.height) {
        outerGlow.drawRoundedRect(table.x - table.width / 2 - 15, table.y - table.height / 2 - 15, table.width + 30, table.height + 30, 20);
      } else {
        outerGlow.drawCircle(table.x, table.y, table.radius + 15);
      }
      container.addChild(outerGlow);

      // Second glow ring
      if (!premiumCircle) {
        const outerGlow2 = new PIXI.Graphics();
        outerGlow2.lineStyle(2, table.color, 0.15);
        if (isRect && table.width && table.height) {
          outerGlow2.drawRoundedRect(table.x - table.width / 2 - 25, table.y - table.height / 2 - 25, table.width + 50, table.height + 50, 25);
        } else {
          outerGlow2.drawCircle(table.x, table.y, table.radius + 25);
        }
        container.addChild(outerGlow2);
      }

      // Atlas mode: a single gold-bordered dais replaces the layered gray
      // base/rim/cushion/felt stack — the sprite art covers the center and the
      // dais reads as a clean pedestal through the sprite's transparent margin.
      // (Roulette already draws its own grand dais above.)
      if (premiumCircle && table.id !== 'roulette-1') {
        const dais = new PIXI.Graphics();
        dais.beginFill(0x1d1209);
        dais.drawCircle(table.x, table.y, table.radius + 8);
        dais.endFill();
        dais.lineStyle(3, 0xd4b05f, 0.85);
        dais.drawCircle(table.x, table.y, table.radius + 8);
        dais.lineStyle(1, 0xffdf8a, 0.4);
        dais.drawCircle(table.x, table.y, table.radius + 17);
        container.addChild(dais);
      } else {
      // Table base (darker for depth)
      const tableBase = new PIXI.Graphics();
      tableBase.beginFill(0x1a1a1a);
      if (isRect && table.width && table.height) {
        tableBase.drawRoundedRect(table.x - table.width / 2 - 5, table.y - table.height / 2 - 5, table.width + 10, table.height + 10, 15);
      } else {
        tableBase.drawCircle(table.x, table.y, table.radius + 5);
      }
      tableBase.endFill();
      container.addChild(tableBase);

      // Main table body
      const tableBody = new PIXI.Graphics();
      tableBody.beginFill(0x2c2c2c);
      if (isRect && table.width && table.height) {
        tableBody.drawRoundedRect(table.x - table.width / 2, table.y - table.height / 2, table.width, table.height, 10);
      } else {
        tableBody.drawCircle(table.x, table.y, table.radius);
      }
      tableBody.endFill();
      container.addChild(tableBody);

      // Table rim (colored border)
      const tableRim = new PIXI.Graphics();
      tableRim.lineStyle(6, table.color, 0.9);
      if (isRect && table.width && table.height) {
        tableRim.drawRoundedRect(table.x - table.width / 2, table.y - table.height / 2, table.width, table.height, 10);
      } else {
        tableRim.drawCircle(table.x, table.y, table.radius);
      }
      container.addChild(tableRim);

      // Inner rim accent
      const innerRim = new PIXI.Graphics();
      innerRim.lineStyle(2, 0xffffff, 0.15);
      if (isRect && table.width && table.height) {
        innerRim.drawRoundedRect(table.x - table.width / 2 + 5, table.y - table.height / 2 + 5, table.width - 10, table.height - 10, 8);
      } else {
        innerRim.drawCircle(table.x, table.y, table.radius - 5);
      }
      container.addChild(innerRim);

      // Leather cushion rail (dark padded ring under the colored rim)
      const cushion = new PIXI.Graphics();
      cushion.beginFill(0x141414, 0.9);
      if (isRect && table.width && table.height) {
        cushion.drawRoundedRect(table.x - table.width / 2 + 7, table.y - table.height / 2 + 7, table.width - 14, table.height - 14, 8);
      } else {
        cushion.drawCircle(table.x, table.y, table.radius - 7);
      }
      cushion.endFill();
      container.addChild(cushion);

      // Table surface (felt)
      const tableSurface = new PIXI.Graphics();
      const isReception = table.id === 'info-desk';
      const isPiano = table.id === 'piano';
      const isSmokeRoom = table.id === 'smoking-area';
      tableSurface.beginFill(isReception ? 0x3d2314 : isPiano ? 0x0d0d0d : isSmokeRoom ? 0x26140c : 0x1a4d2e); // Brown for reception, black for piano, dark walnut for the smoking lounge, green for games
      if (isRect && table.width && table.height) {
        tableSurface.drawRoundedRect(table.x - table.width / 2 + 12, table.y - table.height / 2 + 12, table.width - 24, table.height - 24, 6);
      } else {
        tableSurface.drawCircle(table.x, table.y, table.radius - 12);
      }
      tableSurface.endFill();
      container.addChild(tableSurface);
      }

      if (!isRect) {
        // Inner decorative pattern (cross lines) - only for circles
        const innerPattern = new PIXI.Graphics();
        innerPattern.lineStyle(1, 0xffffff, 0.08);
        const patternRadius = table.radius - 20;
        // Diamond pattern
        innerPattern.moveTo(table.x, table.y - patternRadius);
        innerPattern.lineTo(table.x, table.y + patternRadius);
        innerPattern.moveTo(table.x - patternRadius, table.y);
        innerPattern.lineTo(table.x + patternRadius, table.y);
        container.addChild(innerPattern);

        // Center decorative circle
        const centerCircle = new PIXI.Graphics();
        centerCircle.lineStyle(2, table.color, 0.4);
        centerCircle.drawCircle(table.x, table.y, table.radius * 0.4);
        container.addChild(centerCircle);

        // Game-specific crafted felt decals
        const decal = new PIXI.Graphics();
        const r = table.radius;
        if (table.id === 'roulette-1') {
          // Real spinning wheel sprite (animated by the wheel ticker)
          const wheelSprite = new PIXI.Sprite(mapWheelTexture());
          wheelSprite.anchor.set(0.5);
          wheelSprite.position.set(table.x, table.y);
          wheelSprite.width = r * 1.55;
          wheelSprite.height = r * 1.55;
          (wheelSprite as any).userData = { ...((wheelSprite as any).userData || {}), atlasKind: 'roulette' };
          container.addChild(wheelSprite);
          _liveWheels.push(wheelSprite);
        } else if (table.id === 'luckywheel-1') {
          // Real spinning prize wheel (animated by the wheel ticker)
          const lwSprite = new PIXI.Sprite(luckyWheelTexture());
          lwSprite.anchor.set(0.5);
          lwSprite.position.set(table.x, table.y);
          lwSprite.width = r * 1.7;
          lwSprite.height = r * 1.7;
          (lwSprite as any).userData = { ...((lwSprite as any).userData || {}), atlasKind: 'luckywheel' };
          container.addChild(lwSprite);
          _liveWheels.push(lwSprite);
        } else if (table.id === 'slots-1') {
          // Three vertical reel strips with a payoff line, each with an
          // animated symbol that cycles on the reel ticker
          const reelW = r * 0.18;
          for (let i = -1; i <= 1; i++) {
            const rx = table.x + i * reelW * 1.4 - reelW / 2;
            decal.beginFill(0x0d2f1e);
            decal.drawRoundedRect(rx, table.y - r * 0.6, reelW, r * 1.2, 3);
            decal.endFill();
            decal.beginFill(table.color, 0.4);
            decal.drawRoundedRect(rx, table.y - 8, reelW, 16, 3);
            decal.endFill();
            const sym = new PIXI.Text(REEL_SYMBOLS[i + 4], {
              fontSize: Math.floor(reelW * 0.55),
            });
            sym.anchor.set(0.5);
            sym.position.set(table.x + i * reelW * 1.4, table.y);
            container.addChild(sym);
            _liveReels.push(sym);
          }
        } else if (table.id === 'blackjack-1') {
          // White bet-spot guides
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
            const sx = table.x + Math.cos(a) * r * 0.55 - r * 0.11;
            const sy = table.y + Math.sin(a) * r * 0.55 - r * 0.11;
            decal.lineStyle(1.5, 0xffffff, 0.4);
            decal.drawRoundedRect(sx, sy, r * 0.22, r * 0.22, 3);
          }
        } else {
          // Precision tick marks on the fabric ring
          const ticks = 12;
          for (let i = 0; i < ticks; i++) {
            const a = (i / ticks) * Math.PI * 2;
            decal.lineStyle(1.5, 0xffffff, 0.18);
            decal.moveTo(table.x + Math.cos(a) * (r - 18), table.y + Math.sin(a) * (r - 18));
            decal.lineTo(table.x + Math.cos(a) * (r - 11), table.y + Math.sin(a) * (r - 11));
          }
        }
        container.addChild(decal);
      }

      // Top-sheen bevel on the felt (soft highlight arc)
      if (!isRect && table.radius) {
        const bevel = new PIXI.Graphics();
        bevel.lineStyle(3, 0xffffff, 0.10);
        bevel.moveTo(table.x + (table.radius - 20) * Math.cos(Math.PI * 1.1), table.y + (table.radius - 20) * Math.sin(Math.PI * 1.1));
        bevel.arc(table.x, table.y, table.radius - 20, Math.PI * 1.1, Math.PI * 1.9);
        container.addChild(bevel);

        // Leather stools around the table
        const isDesk = table.id === 'info-desk' || table.id === 'smoking-area';
        if (!isDesk) {
          for (let i = 0; i < 4; i++) {
            const a = (i * 90 + 45) * Math.PI / 180;
            const cx = table.x + Math.cos(a) * (table.radius + 24);
            const cy = table.y + Math.sin(a) * (table.radius + 24);
            const chair = new PIXI.Graphics();
            chair.beginFill(0x241d14);
            chair.drawRoundedRect(cx - 13, cy - 13, 26, 26, 7);
            chair.endFill();
            chair.lineStyle(2, 0xd4b05f, 0.4);
            chair.drawRoundedRect(cx - 13, cy - 13, 26, 26, 7);
            container.addChild(chair);
          }
        }
      }

      // Center emoji
      const emoji = tableEmojis[table.id] || '🎮';
      const emojiText = new PIXI.Text(emoji, {
        fontSize: Math.floor(table.radius * 0.5),
      });
      emojiText.anchor.set(0.5);
      emojiText.position.set(table.x, table.y);
      container.addChild(emojiText);

      // Roulette/luckywheel wheels swap to the atlas art via the _liveWheels
      // path (they're not in TABLE_ATLAS); hand the center emoji to that wheel
      // so the atlas loader can hide it the moment the sprite swaps in.
      if (table.id === 'roulette-1' || table.id === 'luckywheel-1') {
        const wheelKind = table.id === 'roulette-1' ? 'roulette' : 'luckywheel';
        const w = _liveWheels.find((x) => (x as any).userData?.atlasKind === wheelKind);
        if (w) (w as any).userData.emoji = emojiText;
      }

      // Generated table art (sprite-gen atlas): overlay the atlas idle frame
      // on the table/prop body when USE_SPRITE_ATLAS is on. The procedural
      // drawing stays until the atlas arrives (and forever if it fails), so
      // hit-testing and layout never change.
      if (USE_SPRITE_ATLAS) {
        const atlasName = TABLE_ATLAS[table.id];
        if (atlasName) {
          const atlasSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
          atlasSprite.anchor.set(0.5);
          atlasSprite.position.set(table.x, table.y);
          // The generated art sits inside a 256px cell with a 24px safe margin,
          // so scale up a touch in atlas mode — the art then fills the whole
          // table circle instead of shrinking inside it.
          const fit = Math.min(tableW, tableH) * (premiumCircle ? 1.22 : 1);
          atlasSprite.width = fit;
          atlasSprite.height = fit;
          atlasSprite.visible = false;
          (atlasSprite as any).userData = { atlasKind: atlasName, emoji: emojiText };
          container.addChild(atlasSprite);
          _atlasTableSprites.push(atlasSprite);
        }
      }

      // Gold name plaque above the table. Standardized to one size/scale for
      // every node (no bigger plaques on larger tables) so the table labels
      // read as uniform casino station signage.
      const s = Math.max(1, table.radius / 80);
      const plaque = new PIXI.Graphics();
      plaque.beginFill(0xc9a348);
      plaque.drawRoundedRect(table.x - 75 * s, table.y - table.radius - 46 * s, 150 * s, 30 * s, 4);
      plaque.lineStyle(2, 0xffdf8a, 0.9);
      plaque.drawRoundedRect(table.x - 75 * s, table.y - table.radius - 46 * s, 150 * s, 30 * s, 4);
      plaque.endFill();
      (plaqueLayer ?? container).addChild(plaque);

      const label = new PIXI.Text(table.name, {
        fill: '#241505',
        fontSize: 19 * s,
        fontWeight: 'bold',
        align: 'center',
        letterSpacing: 2, // 0.1em at 19px
      });
      label.anchor.set(0.5);
      label.position.set(table.x, table.y - table.radius - 31 * s);
      (plaqueLayer ?? container).addChild(label);

      // Small colored indicator dots around rim (decorative). Skipped in atlas
      // mode so the generated art keeps the circle clean.
      if (!premiumCircle) {
        const numDots = 8;
        for (let i = 0; i < numDots; i++) {
          const angle = (i / numDots) * Math.PI * 2;
          const dotX = table.x + Math.cos(angle) * (table.radius - 3);
          const dotY = table.y + Math.sin(angle) * (table.radius - 3);
          const dot = new PIXI.Graphics();
          dot.beginFill(table.color, 0.6);
          dot.drawCircle(dotX, dotY, 3);
          dot.endFill();
          container.addChild(dot);
        }
      }

      // Highscore display (top winner) - using real data from backend
      const highscore = highscores[table.id];
      if (highscore) {
        // Highscore background (trophy icon + text)
        const highscoreBg = new PIXI.Graphics();
        highscoreBg.beginFill(0x000000, 0.7);
        highscoreBg.drawRoundedRect(table.x - 60 * s, table.y + table.radius + 10, 120 * s, 35 * s, 5);
        highscoreBg.lineStyle(1, 0xd4b05f, 0.6);
        highscoreBg.drawRoundedRect(table.x - 60 * s, table.y + table.radius + 10, 120 * s, 35 * s, 5);
        highscoreBg.endFill();
        container.addChild(highscoreBg);

        // Trophy icon (simple star)
        const trophy = new PIXI.Text('🏆', {
          fontSize: 16 * s,
        });
        trophy.anchor.set(0.5);
        trophy.position.set(table.x - 40 * s, table.y + table.radius + 27 * s);
        container.addChild(trophy);

        // Winner name
        const winnerName = new PIXI.Text(highscore.username, {
          fill: '#ffd700',
          fontSize: 14 * s,
          fontWeight: 'bold',
        });
        winnerName.anchor.set(0, 0.5);
        winnerName.position.set(table.x - 25 * s, table.y + table.radius + 20 * s);
        container.addChild(winnerName);

        // Win amount
        const winAmount = new PIXI.Text(`$${highscore.amount.toFixed(2)}`, {
          fill: '#4ecdc4',
          fontSize: 12 * s,
          fontWeight: 'normal',
        });
        winAmount.anchor.set(0, 0.5);
        winAmount.position.set(table.x - 25 * s, table.y + table.radius + 35 * s);
        container.addChild(winAmount);
      }

      // Reception and lounge dressing
      if (table.id === 'info-desk') {
        // Warm desk lamps + brass front rail
        addLiveGlow(container, table.x - 110, table.y, 60, 60, 0.28, 0xffe9a8, 1.7);
        addLiveGlow(container, table.x + 110, table.y, 60, 60, 0.28, 0xffe9a8, 2.4);
        const brass = new PIXI.Graphics();
        brass.lineStyle(3, 0xffdf8a, 0.7);
        brass.moveTo(table.x - 70, table.y + table.radius - 6);
        brass.lineTo(table.x + 70, table.y + table.radius - 6);
        container.addChild(brass);

        // Result ticker: cycles top winners under the desk plaque
        const ticker = new PIXI.Text('', {
          fill: '#ffd700',
          fontSize: 15 * s,
          fontWeight: 'bold',
          stroke: '#000000',
          strokeThickness: 3,
        });
        ticker.anchor.set(0.5);
        ticker.position.set(table.x, table.y + table.radius + 14);
        container.addChild(ticker);
        _liveTicker = ticker;
        _tickerCenterX = table.x;
        _tickerOffset = 0;
      } else if (table.id === 'smoking-area' && table.width && table.height) {
        // Wall sconces on the room corners
        addLiveGlow(container, table.x - table.width / 2 + 18, table.y - table.height / 2 + 18, 50, 50, 0.22, 0xffb347, 1.2);
        addLiveGlow(container, table.x + table.width / 2 - 18, table.y - table.height / 2 + 18, 50, 50, 0.22, 0xffb347, 1.9);

        // Solid exterior annex walls — a real attached room OUTSIDE the main
        // salon rectangle. Dark walnut walls with a gold cap trim wrap the top,
        // right and bottom edges of the slab; the LEFT edge stays open as a lit
        // gold doorway back into the casino floor. No mullions / cage lines.
        const smL = table.x - table.width / 2;
        const smT = table.y - table.height / 2;
        const smW = table.width;
        const smH = table.height;

        const annex = new PIXI.Graphics();
        // Left gold doorway frame (the opening back into the salon)
        annex.lineStyle(3, 0xd4b05f, 0.9);
        annex.moveTo(smL - 18, smT + 6);
        annex.lineTo(smL - 18, smT + smH - 6);
        annex.lineStyle(1.5, 0xffdf8a, 0.35);
        annex.moveTo(smL - 26, smT + 2);
        annex.lineTo(smL - 26, smT + smH - 2);
        // Roof wall
        annex.lineStyle(4, 0xd4b05f, 0.95);
        annex.moveTo(smL - 22, smT);
        annex.lineTo(smL + smW + 22, smT);
        // Bottom wall
        annex.moveTo(smL - 22, smT + smH);
        annex.lineTo(smL + smW + 22, smT + smH);
        // Right wall
        annex.moveTo(smL + smW, smT + 2);
        annex.lineTo(smL + smW, smT + smH - 2);
        // Gold cap trim along wall tops
        annex.lineStyle(2, 0xffdf8a, 0.5);
        annex.moveTo(smL - 22, smT - 7);
        annex.lineTo(smL + smW + 22, smT - 7);
        annex.moveTo(smL - 22, smT + smH + 7);
        annex.lineTo(smL + smW + 22, smT + smH + 7);
        annex.moveTo(smL + smW + 6, smT + 2);
        annex.lineTo(smL + smW + 6, smT + smH - 2);
        container.addChild(annex);

        // Integrated header sign on the roof of the alcove (replaces the old
        // floating wall plaque that used to overlap the room's top edge).
        const header = new PIXI.Graphics();
        header.beginFill(0x170d06);
        header.drawRoundedRect(table.x - 130, smT - 38, 260, 24, 5);
        header.lineStyle(2, 0xd4b05f, 0.85);
        header.drawRoundedRect(table.x - 130, smT - 38, 260, 24, 5);
        header.endFill();
        container.addChild(header);
        const headerText = new PIXI.Text('🚬 SMOKING LOUNGE', {
          fill: '#41f2e8',
          fontSize: 13,
          fontWeight: 'bold',
          letterSpacing: 3,
          dropShadow: true,
          dropShadowColor: '#41f2e8',
          dropShadowBlur: 8,
          dropShadowDistance: 0,
        });
        headerText.anchor.set(0.5);
        headerText.position.set(table.x, smT - 26);
        container.addChild(headerText);
        addLiveGlow(container, table.x, smT - 26, 240, 60, 0.16, 0x41f2e8, 0.6);

        // Ambient haze layer — drifts when anyone smokes (synced via player states)
        const haze = new PIXI.Container();
        haze.position.set(table.x, table.y);
        haze.alpha = 0;
        const hazeParts: { sprite: PIXI.Graphics; baseX: number; baseY: number; phase: number }[] = [];
        for (let i = 0; i < 20; i++) {
          const part = new PIXI.Graphics();
          // Mix cool gray with warm amber tones
          const colors = [0x9aa3ad, 0xb0a898, 0x8a8d94, 0xa89880];
          part.beginFill(colors[i % colors.length], 0.08 + (i % 3) * 0.02);
          part.drawCircle(0, 0, 30 + ((i * 37) % 40));
          part.endFill();
          const bx = ((i * 53) % table.width) - table.width / 2;
          const by = ((i * 41) % table.height) - table.height / 2;
          part.position.set(bx, by);
          haze.addChild(part);
          hazeParts.push({ sprite: part, baseX: bx, baseY: by, phase: i * 0.9 });
        }
        container.addChild(haze);
        smokeHazeRef.current = { container: haze, parts: hazeParts };

        addLiveGlow(container, table.x, table.y - table.height / 2, 160, 160, 0.15, 0x8b7d3a, 3.1);
      }

      // Interactive zone indicator (subtle glow)
      const zoneGlow = new PIXI.Graphics();
      zoneGlow.lineStyle(3, table.color, 0.3);
      zoneGlow.drawCircle(table.x, table.y, table.radius + 20);
      container.addChild(zoneGlow);

      // Hover visuals (games only): PLAY badge faded in on hover
      if (GAME_TABLE_IDS.has(table.id)) {
        const badge = new PIXI.Text('PLAY', {
          fill: '#ffd700',
          fontSize: 20,
          fontWeight: 'bold',
          letterSpacing: 3,
          stroke: '#000000',
          strokeThickness: 4,
        });
        badge.anchor.set(0.5);
        badge.position.set(table.x, table.y);
        badge.alpha = 0;
        container.addChild(badge);
        tableVisualsRef.current[table.id] = { emoji: emojiText, glow: glowSprite, badge };      }
    });

    // Add luxury walls/boundaries (walnut panels with gold trim)
    const w = 32; // wall thickness
    const walls = new PIXI.Graphics();
    walls.beginFill(0x2a1607); // Rich walnut
    walls.drawRect(0, 0, MAP_W, w);
    walls.drawRect(0, MAP_H - w, MAP_W, w);
    walls.drawRect(0, 0, w, MAP_H);
    walls.drawRect(MAP_W - w, 0, w, MAP_H);
    walls.endFill();
    // Inner gold trim border
    walls.lineStyle(2, 0xd4b05f, 0.7);
    walls.drawRect(w, w, MAP_W - w * 2, MAP_H - w * 2);
    // Wainscot panel seams
    walls.lineStyle(1, 0x000000, 0.35);
    for (let x = w; x < MAP_W; x += 150) {
      walls.moveTo(x, 0);
      walls.lineTo(x, w);
      walls.moveTo(x, MAP_H - w);
      walls.lineTo(x, MAP_H);
    }
    const seamGap = 150;
    for (let y = w; y < MAP_H; y += seamGap) {
      walls.moveTo(0, y);
      walls.lineTo(w, y);
      walls.moveTo(MAP_W - w, y);
      walls.lineTo(MAP_W, y);
    }
    container.addChild(walls);

    // Inset golden rug border framing the room
    const rail = new PIXI.Graphics();
    rail.lineStyle(1, 0xd4b05f, 0.5);
    rail.drawRect(48, 48, MAP_W - 96, MAP_H - 96);
    rail.lineStyle(2, 0xd4b05f, 0.15);
    rail.drawRect(56, 56, MAP_W - 112, MAP_H - 112);
    container.addChild(rail);

    // Corner pillars (gold-capped columns)
    const pillars = new PIXI.Graphics();
    const ps = 58;
    const pillarCorners: Array<[number, number]> = [[0, 0], [MAP_W - ps, 0], [0, MAP_H - ps], [MAP_W - ps, MAP_H - ps]];
    for (const [px, py] of pillarCorners) {
      pillars.beginFill(0x3a2010);
      pillars.drawRect(px, py, ps, ps);
      pillars.endFill();
      pillars.lineStyle(2, 0xd4b05f, 0.75);
      pillars.drawRect(px + 4, py + 4, ps - 8, ps - 8);
      pillars.lineStyle(1, 0xfff3c9, 0.25);
      pillars.moveTo(px + 4, py + 4);
      pillars.lineTo(px + ps - 4, py + 4);
    }
    container.addChild(pillars);

    // Ambient-occlusion shadow along the base of the walls
    const ao = new PIXI.Graphics();
    ao.lineStyle(6, 0x000000, 0.3);
    ao.drawRect(w + 3, w + 3, MAP_W - (w + 3) * 2, MAP_H - (w + 3) * 2);
    container.addChild(ao);

    // Wall sconces (gold bracket lights) — crystal-bulb sprite + live glow.
    // Positioned symmetrically about the room center (y = 340/740, x = both
    // walls) so the perimeter lighting reads as a balanced grid.
    const sconceSpots: Array<[number, number]> = [[w, 340], [w, 740], [MAP_W - w, 340], [MAP_W - w, 740]];
    for (let si = 0; si < sconceSpots.length; si++) {
      const [sx, sy] = sconceSpots[si];
      addLiveGlow(container, sx, sy, 130, 130, 0.18, 0xffd98a, si * 0.3);
      const scSprite = new PIXI.Sprite(sconceTexture());
      scSprite.anchor.set(0.5, 1);
      scSprite.position.set(sx, sy + 10);
      scSprite.width = 64;
      scSprite.height = 64;
      container.addChild(scSprite);
    }

    // Lobby wall clock (top wall, right of the marquee — clear of the VIP slab)
    const clock = new PIXI.Graphics();
    clock.lineStyle(3, 0xd4b05f, 0.9);
    clock.drawCircle(1120, 62, 20);
    clock.lineStyle(2, 0xffdf8a, 0.8);
    clock.moveTo(1120, 62);
    clock.lineTo(1120, 50);
    clock.moveTo(1120, 62);
    clock.lineTo(1129, 67);
    container.addChild(clock);

    // Chandeliers (gold crystal sprite + warm glow). Symmetric mirror positions
    // (x = 960 ± 760) pulled clear of the dark-brown edge frame and of the
    // game-table ring so the fixtures sit in the open walking paths.
    const chandelierSpots: Array<[number, number]> = [[960, 160], [200, 520], [1720, 520]];
    for (let ci = 0; ci < chandelierSpots.length; ci++) {
      const [cx, cy] = chandelierSpots[ci];
      // Warm elliptical floor pool beneath the fixture (louder under the
      // center one, softer at the sides so it reads as ambient light pools)
      const poolW = ci === 0 ? 430 : 300;
      addGlow(container, cx, cy + 14, poolW, poolW * 0.55, ci === 0 ? 0.16 : 0.12, PIXI.BLEND_MODES.ADD, 0xffd98a);
      addLiveGlow(container, cx, cy, 340, 340, 0.14, 0xffd98a, ci * 0.5);
      const chSprite = new PIXI.Sprite(chandelierTexture());
      chSprite.anchor.set(0.5);
      chSprite.position.set(cx, cy);
      chSprite.width = 110;
      chSprite.height = 110;
      container.addChild(chSprite);
      // Ceiling chain for the top-wall fixture (drawn over, from the ceiling)
      if (cy < 200) {
        const chain = new PIXI.Graphics();
        chain.lineStyle(3, 0xb7953f, 0.9);
        chain.moveTo(cx, 4);
        chain.lineTo(cx, cy - 48);
        container.addChild(chain);
      }
    }

    // Potted palms for warmth near the walls — swappable to the sprite-gen
    // `deco` (ornamental vase) atlas idle frame when the flag is on. Mirrored
    // pairs (x = 960 ± 820, y = 540 ± 190) so side décor is perfectly
    // symmetric and clear of the VIP/Smoking zones.
    const palmSpots: Array<[number, number]> = [[140, 380], [1780, 380], [140, 730], [1780, 730]];
    for (const [px, py] of palmSpots) {
      const palm = new PIXI.Text('🌴', { fontSize: 42 });
      palm.anchor.set(0.5);
      palm.position.set(px, py);
      container.addChild(palm);
      if (USE_SPRITE_ATLAS) {
        const atlasSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        atlasSprite.anchor.set(0.5);
        atlasSprite.position.set(px, py);
        const fit = 68;
        atlasSprite.width = fit;
        atlasSprite.height = fit;
        atlasSprite.visible = false;
        (atlasSprite as any).userData = { atlasKind: 'deco', emoji: palm };
        container.addChild(atlasSprite);
        _atlasTableSprites.push(atlasSprite);
      }
    }

    // VIP lounge → "High-Limit Bar": polished walnut counter with a gold lip,
    // brass foot rail, back-bar liquor shelf with bottle silhouettes and
    // matching stools. Replaces the old flat red sofa blocks so the top-right
    // corner reads as a real architectural structure, not placeholder rects.
    const vip = new PIXI.Graphics();
    const barTop = 128;
    const barX0 = 1408;
    const barX1 = 1792;

    // Back-bar shelf above the counter (liquor shelf, gold-trimmed)
    vip.beginFill(0x1a0f05);
    vip.drawRoundedRect(barX0 + 20, barTop - 44, barX1 - barX0 - 40, 22, 5);
    vip.endFill();
    vip.lineStyle(1, 0xd4b05f, 0.5);
    vip.drawRoundedRect(barX0 + 20, barTop - 44, barX1 - barX0 - 40, 22, 5);
    // Bottles on the shelf (small colored silhouettes with gold tips)
    const bottleColors = [0x9b1c1c, 0x1d6e3a, 0x3b82f6, 0x8b5cf6, 0xf59e0b, 0x4ecdc4];
    for (let bi = 0; bi < 6; bi++) {
      const bx = barX0 + 48 + bi * ((barX1 - barX0 - 96) / 5);
      vip.beginFill(bottleColors[bi % bottleColors.length], 0.9);
      vip.drawRoundedRect(bx - 5, barTop - 40, 10, 18, 3);
      vip.endFill();
      vip.lineStyle(1, 0xffdf8a, 0.8);
      vip.moveTo(bx - 2.5, barTop - 42);
      vip.lineTo(bx + 2.5, barTop - 46);
      vip.lineTo(bx, barTop - 42);
    }
    // Counter body (walnut panel with a gold top lip)
    vip.beginFill(0x2a1a0c);
    vip.drawRoundedRect(barX0, barTop, barX1 - barX0, 40, 8);
    vip.endFill();
    vip.lineStyle(2, 0xd4b05f, 0.85);
    vip.drawRoundedRect(barX0, barTop, barX1 - barX0, 40, 8);
    vip.lineStyle(1, 0x000000, 0.4);
    vip.drawRoundedRect(barX0 + 6, barTop + 6, barX1 - barX0 - 12, 28, 6);
    // Brass foot rail along the front of the counter
    vip.lineStyle(2, 0xb7953f, 0.8);
    vip.moveTo(barX0 + 12, barTop + 52);
    vip.lineTo(barX1 - 12, barTop + 52);
    // Matching bar stools facing the counter
    vip.beginFill(0x3a2010);
    for (let si = 0; si < 4; si++) {
      const sx = barX0 + 40 + si * ((barX1 - barX0 - 80) / 3);
      vip.drawCircle(sx, barTop + 70, 11);
    }
    vip.endFill();
    vip.lineStyle(2, 0xd4b05f, 0.6);
    for (let si = 0; si < 4; si++) {
      const sx = barX0 + 40 + si * ((barX1 - barX0 - 80) / 3);
      vip.drawCircle(sx, barTop + 70, 11);
    }
    // Gold rope posts partitioning the VIP parquet platform (left + bottom
    // edges) so the High-Limit corner reads as a cordoned-off room.
    const postSpots: Array<[number, number]> = [
      [1365, 90], [1365, 330],                      // left divider posts
      [1440, 340], [1560, 340], [1680, 340], [1800, 340], // bottom divider
    ];
    for (const [px, py] of postSpots) {
      vip.beginFill(0xc9a348);
      vip.drawCircle(px, py, 6);
      vip.endFill();
      vip.beginFill(0x222222);
      vip.drawCircle(px, py, 3);
      vip.endFill();
    }
    vip.lineStyle(2, 0x9b1c1c, 0.9); // red velvet rope
    // left divider (down the slab's open edge)
    vip.moveTo(1365, 90);
    vip.lineTo(1365, 330);
    // bottom divider (across the slab's floor-side edge)
    vip.moveTo(1440, 340);
    vip.lineTo(1800, 340);
    container.addChild(vip);

    // Warm bar-back lighting glow behind the counter
    addLiveGlow(container, (barX0 + barX1) / 2, barTop - 6, 320, 120, 0.12, 0xffe9a8, 1.4);

    const vipSign = new PIXI.Text('VIP', { fill: '#ffdf8a', fontSize: 18, fontWeight: 'bold', letterSpacing: 3 });
    vipSign.anchor.set(0.5);
    vipSign.position.set(1550, 42);
    container.addChild(vipSign);

    // Grand entrance foyer — a gold-framed walnut corridor leading to the double
    // doors, replacing the old tall red carpet strip that jutted into the
    // floor. Same wood as the perimeter border so the entry reads as a
    // recessed architectural frame instead of a floating red block.
    const foyer = new PIXI.Graphics();
    const corrX = 892;    // corridor walls, aligned with the front door width
    const corrW = 136;
    const corrTop = 950;  // shallow vestibule flush against the bottom wall
    const corrBot = MAP_H;
    // Walnut corridor walls (same tone as the room border → merges smoothly)
    foyer.beginFill(0x2a1607);
    foyer.drawRect(corrX, corrTop, corrW, corrBot - corrTop);
    foyer.endFill();
    foyer.lineStyle(2, 0xd4b05f, 0.9);
    foyer.drawRect(corrX, corrTop, corrW, corrBot - corrTop);
    foyer.lineStyle(1, 0xffdf8a, 0.3);
    foyer.drawRect(corrX + 5, corrTop + 5, corrW - 10, corrBot - corrTop - 10);
    // Red runner carpet inset (narrower than the walls, gold-trimmed edges)
    foyer.beginFill(0x5c1a1a);
    foyer.drawRect(corrX + 15, corrTop + 6, corrW - 30, corrBot - corrTop - 14);
    foyer.endFill();
    foyer.lineStyle(1, 0xc9a348, 0.8);
    foyer.moveTo(corrX + 17, corrTop + 6);
    foyer.lineTo(corrX + 17, corrBot - 8);
    foyer.moveTo(corrX + corrW - 17, corrTop + 6);
    foyer.lineTo(corrX + corrW - 17, corrBot - 8);
    // Carpet cross-bands styled as runner steps with gold edging — a short
    // threshold run right inside the doors (flush vestibule).
    for (let bandY = corrTop + 36; bandY < corrBot - 26; bandY += 48) {
      foyer.beginFill(0x7f1d1d);
      foyer.drawRect(corrX + 17, bandY, corrW - 34, 12);
      foyer.endFill();
      foyer.lineStyle(1, 0xd4b05f, 0.5);
      foyer.drawRect(corrX + 17, bandY, corrW - 34, 12);
    }
    // Gold center runner stripe down the middle
    foyer.beginFill(0xc9a348, 0.85);
    foyer.drawRect(960 - 6, corrTop + 6, 12, corrBot - corrTop - 14);
    foyer.endFill();
    // Entry columns flanking the corridor where it meets the main floor
    for (const colX of [corrX - 12, corrX + corrW]) {
      foyer.beginFill(0x3a2010);
      foyer.drawRect(colX, corrTop, 16, 92);
      foyer.endFill();
      foyer.lineStyle(2, 0xd4b05f, 0.85);
      foyer.drawRect(colX, corrTop, 16, 92);
      foyer.beginFill(0xc9a348); // gold column cap
      foyer.drawRect(colX, corrTop - 8, 16, 10);
      foyer.endFill();
    }
    container.addChild(foyer);

    // Casino marquee (gold script on the top wall)
    const marquee = new PIXI.Text('✦  C A S I N O    8 8 8  ✦', {
      fill: '#ffdf8a',
      fontSize: 28,
      fontWeight: 'bold',
      letterSpacing: 5,
      dropShadow: true,
      dropShadowColor: '#000000',
      dropShadowBlur: 6,
      dropShadowDistance: 1,
    });
    marquee.anchor.set(0.5);
    marquee.position.set(MAP_W / 2, 13);
    container.addChild(marquee);

    // Grand entrance double doors on the bottom wall
    const doors = new PIXI.Graphics();
    doors.beginFill(0x0a0703);
    doors.drawRect(893, MAP_H - w, 134, w);
    doors.endFill();
    doors.lineStyle(2, 0xd4b05f, 0.9);
    doors.moveTo(893, MAP_H - w);
    doors.lineTo(893, MAP_H);
    doors.moveTo(1027, MAP_H - w);
    doors.lineTo(1027, MAP_H);
    doors.moveTo(960, MAP_H - w);
    doors.lineTo(960, MAP_H);
    doors.lineStyle(3, 0xc9a348, 0.85); // gold lintel above the doors
    doors.drawRect(883, MAP_H - w - 4, 154, 8);
    doors.lineStyle(2, 0xffdf8a, 0.9); // brass handles
    doors.drawCircle(952, MAP_H - w / 2, 3);
    doors.drawCircle(968, MAP_H - w / 2, 3);
    container.addChild(doors);

    // Cinematic warm grade (subtle center heat)
    addGlow(container, 960, 540, MAP_W + 300, MAP_H + 300, 0.05, PIXI.BLEND_MODES.ADD, 0xffb347);

    // Polished marble sheen (subtle diagonal reflection)
    const sheen = new PIXI.Graphics();
    sheen.beginFill(0xffffff, 0.035);
    sheen.drawEllipse(0, 0, 920, 270);
    sheen.endFill();
    sheen.position.set(1000, 470);
    sheen.rotation = -0.08;
    container.addChild(sheen);

    // Vignette: moody dark edges over the whole scene (topmost)
    const vig = new PIXI.Sprite(vignetteTexture());
    vig.anchor.set(0.5);
    vig.position.set(960, 540);
    vig.width = MAP_W + 80;
    vig.height = MAP_H + 80;
    container.addChild(vig);
  };

  // Check if player is near a table
  useEffect(() => {
    let nearestTable: GameTable | null = null;
    let minDistance = Infinity;

    GAME_TABLES.forEach((table) => {
      // Same geometry the E key and clicks use (edge distance + INTERACT_BUFFER)
      // so the hint bubble can not disagree with what actually happens.
      const distance = tableInteractDistance(table, localPlayer.x, localPlayer.y);
      if (distance <= INTERACT_BUFFER && distance < minDistance) {
        minDistance = distance;
        nearestTable = table;
      }
    });

    setNearTable(nearestTable);
    nearTableRef.current = nearestTable;

    // Auto-stop smoking if leaving the smoking room (start is manual via E/click only)
    if (isSmokingRef.current && (!nearestTable || (nearestTable as any).id !== 'smoking-area')) {
      smokeStartRef.current = null;
      setIsSmoking(false);
      if (sendMove && !pausedRef.current) {
        const p = localPlayerRef.current;
        sendMove({ x: p.x, y: p.y, direction: p.direction, isSmoking: false, smokeStart: null, seated: false });
      }
    }
  }, [localPlayer.x, localPlayer.y, isSmoking, sendMove]);

// Latest emote per player (for floating bubbles above avatars)
const emotesByPlayer = useMemo(() => {
const map: Record<string, { emote: string; ts: number }> = {};
emotes.forEach((e) => {
if (e?.playerId && e?.emote) {
const prev = map[e.playerId];
if (!prev || e.ts >= prev.ts) map[e.playerId] = { emote: e.emote, ts: e.ts };
}
});
return map;
}, [emotes]);

  // Keep a live ref of remote players so E-key and click resolution reads the
  // freshest positions every frame without re-running the keyboard effect.
  useEffect(() => {
    remotePlayersRef.current = remotePlayers;
  }, [remotePlayers]);

// Check if player is near another player
useEffect(() => {
if (nearTable) {
// If near a table, prioritize table interaction
setNearPlayer(null);
return;
}

    let nearestPlayer: Player | null = null;
    let minDistance = Infinity;

    remotePlayers.forEach((player) => {
      const dx = localPlayer.x - player.x;
      const dy = localPlayer.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < PLAYER_INTERACTION_RADIUS && distance < minDistance) {
        minDistance = distance;
        nearestPlayer = player;
      }
    });

    setNearPlayer(nearestPlayer);
    nearPlayerRef.current = nearestPlayer;
  }, [localPlayer.x, localPlayer.y, remotePlayers, nearTable]);

  // Handle keyboard input and "Buttery Smooth" Physics Movement
  useEffect(() => {
    // Physics constants
    const MAX_SPEED = 280;          // Max pixels/sec
    const ACCELERATION = 1800;      // Pixels/sec²
    const FRICTION = 0.90;          // Velocity decay per frame (0-1) - Lower = slippery
    const STOP_THRESHOLD = 5;       // Velocity below this snaps to 0
    const CAMERA_LERP = 0.08;       // Camera smoothing (0-1) - Lower = smoother/laggy

    const keys = keysRef.current;
    let animationFrameId: number;
    const TARGET_FPS = 30;
    const FRAME_INTERVAL = 1000 / TARGET_FPS;
    let lastFrameCheck = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (pausedRef.current) return;
      const target = e.target as HTMLElement | null;
      // Only real text-entry fields swallow keys — buttons/links must NOT
      // (otherwise WASD stops working the moment any UI button has focus).
      if (target?.closest('input, textarea, select, [contenteditable]')) return;
      const key = e.key.toLowerCase();

      // A focused button/link owns Enter/Space — don't pirate the action.
      // Chat (C) and interact (E/Enter) fire only when the scene has focus.
      const onControl = !!target?.closest('button, a, [role="button"], [role="link"]');

      // Toggle Chat with C
      if (key === 'c' && !onControl) {
        if (handlerRefs.current.onToggleChat) {
          handlerRefs.current.onToggleChat();
        }
      }

      // E or Enter → interact with whatever is in range. Same live resolution as
      // clicks (resolveInteractableFromPosition), so keyboard and mouse can never
      // disagree; the repeat guard stops a held Enter from firing twice.
      if ((key === 'e' || key === 'enter') && !e.repeat && !onControl) {
        const lp = localPlayerRef.current;
        if (lp) activateInteractable(resolveInteractableFromPosition(lp.x, lp.y));
      }

      // Prevent scrolling (page scroll would otherwise swallow arrow keys)
      const movementKey = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key);
      if (movementKey) {
        moveTargetRef.current = null;
        pendingTableIdRef.current = null; // Steering cancels any pending auto-enter table walk
      }
      if (movementKey || e.key === ' ') {
        e.preventDefault();
      }
      keys[key] = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keys[e.key.toLowerCase()] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Clear held keys when the window loses focus so movement can't stick.
    const handleBlur = () => {
      for (const key of Object.keys(keys)) delete keys[key];
      moveTargetRef.current = null;
      pendingTableIdRef.current = null; // Blur cancels a pending table auto-enter
      velocityRef.current.x = 0;
      velocityRef.current.y = 0;
      stopTouchInput();
      pointerActiveRef.current = false;
      moveGuideRef.current?.clear();
    };
    window.addEventListener('blur', handleBlur);

    // --- MAIN PHYSICS LOOP ---
    const updatePhysics = (currentTime: number) => {
      // 1. Cap physics loop to ~30 FPS
      if (currentTime - lastFrameCheck < FRAME_INTERVAL) {
        animationFrameId = requestAnimationFrame(updatePhysics);
        return;
      }
      lastFrameCheck = currentTime - ((currentTime - lastFrameCheck) % FRAME_INTERVAL);

      if (pausedRef.current) {
        lastTimeRef.current = currentTime;
        animationFrameId = requestAnimationFrame(updatePhysics);
        return;
      }

      const deltaTime = Math.min((currentTime - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = currentTime;

      const keys = keysRef.current;
      const velocity = velocityRef.current;

      // 2. Calculate Input Vector
      let inputDx = 0;
      let inputDy = 0;
      const moveTarget = moveTargetRef.current;
      if (moveTarget) {
        // Click-to-move: keyboard input stays disabled until we reach the point
        const tx = moveTarget.x - localPlayerRef.current.x;
        const ty = moveTarget.y - localPlayerRef.current.y;
        const tdist = Math.hypot(tx, ty);
        if (tdist > 10) {
          inputDx = tx / tdist;
          inputDy = ty / tdist;
        } else {
          // Arrived — trajectory done, re-enable keyboard movement
          moveTargetRef.current = null;
          velocity.x = 0;
          velocity.y = 0;
        }
      } else {
        if (keys['w'] || keys['arrowup']) inputDy -= 1;
        if (keys['s'] || keys['arrowdown']) inputDy += 1;
        if (keys['a'] || keys['arrowleft']) inputDx -= 1;
        if (keys['d'] || keys['arrowright']) inputDx += 1;
      }

      // Override with touch joystick if active (mobile support)
      if (touchVectorRef.current.active) {
        inputDx = touchVectorRef.current.dx;
        inputDy = touchVectorRef.current.dy;
      }

      // Normalize diagonal
      if (inputDx !== 0 && inputDy !== 0) {
        inputDx *= 0.7071;
        inputDy *= 0.7071;
      }

      // 3. Apply Acceleration & Friction
      if (inputDx !== 0 || inputDy !== 0) {
        velocity.x += inputDx * ACCELERATION * deltaTime;
        velocity.y += inputDy * ACCELERATION * deltaTime;

        const currentSpeed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
        if (currentSpeed > MAX_SPEED) {
          const ratio = MAX_SPEED / currentSpeed;
          velocity.x *= ratio;
          velocity.y *= ratio;
        }
      } else {
        velocity.x *= FRICTION;
        velocity.y *= FRICTION;
        if (Math.abs(velocity.x) < STOP_THRESHOLD) velocity.x = 0;
        if (Math.abs(velocity.y) < STOP_THRESHOLD) velocity.y = 0;
      }

      const isMoving = velocity.x !== 0 || velocity.y !== 0;
      movementRef.current = { ...movementRef.current, dx: velocity.x, dy: velocity.y, isMoving };

      if (isMoving || localPlayerRef.current.isMoving) {
        // 4. Update Position
        const currentX = localPlayerRef.current.x;
        const currentY = localPlayerRef.current.y;

        let newX = currentX + velocity.x * deltaTime;
        let newY = currentY + velocity.y * deltaTime;

        newX = Math.max(50, Math.min(MAP_WIDTH - 50, newX));
        newY = Math.max(50, Math.min(MAP_HEIGHT - 50, newY));

        const direction = isMoving ? Math.atan2(velocity.y, velocity.x) : localPlayerRef.current.direction;

        // Update the ref every frame (camera, sprite, and sendMove read it
        // directly). React state is only refreshed on the coarse grid below,
        // ending the 30fps re-render storm that tanked frame rate.
        localPlayerRef.current = {
          ...localPlayerRef.current,
          x: newX,
          y: newY,
          direction,
          isMoving,
        };

        // Direct Sprite Update (Faster than waiting for state -> effect)
        if (localSpriteRef.current && !localSpriteRef.current.destroyed) {
          localSpriteRef.current.position.set(newX, newY);
        }

        // 5. Network Sync (Throttled)
        if (sendMove) {
          const now = performance.now();
          if (now - movementRef.current.lastSend > 50) {
            sendMove({
              x: newX,
              y: newY,
              direction,
              isSmoking: isSmokingRef.current,
              smokeStart: smokeStartRef.current,
              seated: false
            });
            movementRef.current.lastSend = now;
          }
        }
      }

      // Coarse React-state sync: re-render only when crossing ~64px or the
      // moving flag flips. Interaction zones are 50-150px, so the lag is
      // invisible while dropping re-renders from ~30/s to ~1/s.
      {
        const lp = localPlayerRef.current;
        if (
          isMoving !== lastStateMovingRef.current ||
          Math.abs(lp.x - lastStatePosRef.current.x) >= 64 ||
          Math.abs(lp.y - lastStatePosRef.current.y) >= 64
        ) {
          lastStatePosRef.current = { x: lp.x, y: lp.y };
          lastStateMovingRef.current = isMoving;
          setLocalPlayer(lp);
        }
      }

      // Click-to-enter from afar: once the player walks within interaction range
      // of the table they clicked, open it — the exact target the E key would
      // have resolved at that spot, so pointer and keyboard stay unified.
      {
        const pendingId = pendingTableIdRef.current;
        if (pendingId) {
          const pendingTable = GAME_TABLES.find((g) => g.id === pendingId) || null;
          if (pendingTable) {
            const lp = localPlayerRef.current;
            if (tableInteractDistance(pendingTable, lp.x, lp.y) <= INTERACT_BUFFER) {
              pendingTableIdRef.current = null;
              moveTargetRef.current = null;
              moveGuideRef.current?.clear();
              activateInteractable({ kind: 'table', table: pendingTable });
            }
          }
        }
      }

      // 6. Update Camera (LERP)
      if (cameraRef.current && appRef.current) {
        const camera = cameraRef.current;
        const app = appRef.current;
        const targetCamX = -localPlayerRef.current.x + app.renderer.screen.width / 2;
        const targetCamY = -localPlayerRef.current.y + app.renderer.screen.height / 2;
        camera.position.x += (targetCamX - camera.position.x) * CAMERA_LERP;
        camera.position.y += (targetCamY - camera.position.y) * CAMERA_LERP;
      }

      // 7. Draw click-to-move guide (route line + ping) — client-side only.
      // Shown while walking to a target; cleared on arrival or a new click.
      const guide = moveGuideRef.current;
      if (guide) {
        const now = currentTime;
        if (moveTarget) {
          const lp = localPlayerRef.current;
          guide.clear();
          // Route line from player to the clicked point
          guide.lineStyle(3, 0xffd700, 0.5);
          guide.moveTo(lp.x, lp.y);
          guide.lineTo(moveTarget.x, moveTarget.y);
          // Expanding ping ring at the destination
          const phase = ((now - pingStartRef.current) / 700) % 1;
          const radius = 14 + phase * 30;
          guide.lineStyle(2.5, 0xffd700, 1 - phase);
          guide.drawCircle(moveTarget.x, moveTarget.y, radius);
          guide.lineStyle(0);
          guide.beginFill(0xffd700, 0.9);
          guide.drawCircle(moveTarget.x, moveTarget.y, 4);
          guide.endFill();
        } else {
          const flash = flashPingRef.current;
          if (flash && now - flash.start < 800) {
            // Transient ping for instant teleports (mobile tap / recenter)
            const t = (now - flash.start) / 800;
            guide.clear();
            guide.lineStyle(2.5, 0xffd700, 1 - t);
            guide.drawCircle(flash.x, flash.y, 14 + t * 34);
          } else if (flash) {
            flashPingRef.current = null;
            guide.clear();
          } else {
            guide.clear();
          }
        }
      }

      animationFrameId = requestAnimationFrame(updatePhysics);
    };

    animationFrameId = requestAnimationFrame(updatePhysics);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [activateInteractable, resolveInteractableFromPosition, sendMove]);

  // Helper function to convert hex color to PIXI color number
  const hexToPixiColor = (hex: string | undefined): number => {
    if (!hex) return 0xFFFFFF;
    try {
      const cleanHex = hex.replace('#', '');
      return parseInt(cleanHex, 16);
    } catch {
      return 0xFFFFFF;
    }
  };

  // Get initials from nickname
  const getInitials = (name?: string): string => {
    if (!name) return 'P';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const formatDisplayName = (name?: string): string => {
    const base = (name || 'Player').toString().trim();
    if (base.length <= 14) return base;
    return `${base.slice(0, 13)}…`;
  };

  // Desktop click: interact with the highlighted target, else click-to-move.
  // Walk direction lives in moveTargetRef; the physics loop walks there with
  // keyboard movement disabled until the trajectory completes.
  const playMovePing = () => {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!pingAudioRef.current) pingAudioRef.current = new Ctx();
      const ctx = pingAudioRef.current!;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch {
      // Audio is a nice-to-have; ignore failures silently
    }
  };

  const handleDesktopClick = (clientX: number, clientY: number) => {
    if (pausedRef.current) return;
    const world = clientToWorld(clientX, clientY);
    if (!world) return;
    const cx = Math.max(50, Math.min(MAP_WIDTH - 50, world.x));
    const cy = Math.max(50, Math.min(MAP_HEIGHT - 50, world.y));
    const lp = localPlayerRef.current;

    // 1) Click on a game table's visible body. Scenery rooms (smoking lounge)
    //    are treated as floor — the click walks, and lighting up stays on the
    //    E key / hint bubble. A far-table click walks there and auto-enters
    //    when the physics loop sees the player within interaction range.
    const bodyTable =
      GAME_TABLES.find((t) => t.id !== 'smoking-area' && tableBodyContains(t, cx, cy)) || null;
    if (bodyTable) {
      if (lp && tableInteractDistance(bodyTable, lp.x, lp.y) <= INTERACT_BUFFER) {
        // Already in range → act now, exactly like pressing E.
        moveTargetRef.current = null;
        if (moveGuideRef.current) moveGuideRef.current.clear();
        pendingTableIdRef.current = null;
        activateInteractable({ kind: 'table', table: bodyTable });
        return;
      }
      // Walk to the clicked spot; auto-enter fires on arrival.
      pendingTableIdRef.current = bodyTable.id;
      moveTargetRef.current = { x: cx, y: cy };
      pingStartRef.current = performance.now();
      playMovePing();
      return;
    }

    // 2) Click on a nearby player's avatar → open their profile.
    const np =
      remotePlayers.find(
        (pl) =>
          Math.hypot(cx - pl.x, cy - pl.y) <= PLAYER_CLICK_RADIUS &&
          (!lp || Math.hypot(lp.x - pl.x, lp.y - pl.y) <= PLAYER_INTERACTION_RADIUS)
      ) || null;
    if (np) {
      moveTargetRef.current = null;
      if (moveGuideRef.current) moveGuideRef.current.clear();
      pendingTableIdRef.current = null;
      if (onPlayerInteraction) {
        onPlayerInteraction(np);
        return;
      }
    }

    // 3) Otherwise walk to the clicked point (inside the smoking room too).
    pendingTableIdRef.current = null;
    moveTargetRef.current = { x: cx, y: cy };
    pingStartRef.current = performance.now();
    playMovePing();
  };
  desktopClickRef.current = handleDesktopClick;

  const handleMobileInteract = () => {
    // Hint bubble and the mobile action button funnel through the same live
    // resolution the E key uses, so they can never disagree on the target.
    const lp = localPlayerRef.current;
    if (!lp) return;
    activateInteractable(resolveInteractableFromPosition(lp.x, lp.y));
  };

  const handleMobileChat = () => {
    if (!sendChat) return;
    const text = prompt('Say something to the room (max 80 chars):', '') || '';
    const trimmed = text.trim().slice(0, 80);
    if (trimmed) {
      sendChat(trimmed);
    }
  };

  // Create enhanced player avatar sprite
  const createPlayerAvatar = (player: Player, isLocal: boolean) => {
    const playerContainer = new PIXI.Container();
    playerContainer.name = isLocal ? 'localPlayer' : `remotePlayer_${player.userId}`;

    // Use customized avatar - for local player use props, for remote use player data
    const avatarImageData = isLocal ? avatarImage : player.avatarImage;
    const hasImage = !!avatarImageData;
    const customColor = isLocal
      ? hexToPixiColor(avatarColor)
      : hexToPixiColor(player.avatarColor || '#ff6b6b');
    const customSize = FIXED_AVATAR_SIZE;
    const baseRadius = customSize / 2;
    const scale = customSize / 80; // Scale factor based on size
    (playerContainer as any).userData = (playerContainer as any).userData || {};
    (playerContainer as any).userData.scaleFactor = scale;
    (playerContainer as any).userData.baseRadius = baseRadius;

    // Outer glow (pulsing for local player, static for remote)
    const glow = new PIXI.Graphics();
    if (isLocal) {
      glow.beginFill(0x00ff00, 0.4);
    } else {
      glow.beginFill(0xff6b6b, 0.2);
    }
    glow.drawCircle(0, 0, baseRadius + 8);
    glow.endFill();
    playerContainer.addChild(glow);

    // Shadow
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x000000, 0.3);
    shadow.drawEllipse(0, baseRadius + 5, baseRadius * 0.6, baseRadius * 0.3);
    shadow.endFill();
    playerContainer.addChild(shadow);

    // Customized avatar: the user's picture when available, otherwise color +
    // initials. The generated player atlas is NOT used here — players want to
    // see their own picture, exactly like the pre-atlas code.
    {
      // Image if available, otherwise color + initials
      const avatarCircle = new PIXI.Graphics();
      avatarCircle.beginFill(customColor);
      avatarCircle.drawCircle(0, 0, baseRadius);
      avatarCircle.endFill();

      // Border
      avatarCircle.lineStyle(3, 0xffffff, 0.2);
      avatarCircle.drawCircle(0, 0, baseRadius);
      playerContainer.addChild(avatarCircle);

      if (hasImage && avatarImageData) {
        const texture = PIXI.Texture.from(avatarImageData);
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.width = baseRadius * 2;
        sprite.height = baseRadius * 2;

        const mask = new PIXI.Graphics();
        mask.beginFill(0xffffff);
        mask.drawCircle(0, 0, baseRadius);
        mask.endFill();
        sprite.mask = mask;

        playerContainer.addChild(sprite);
        playerContainer.addChild(mask);
      } else {
        const initials = getInitials(player.nickname);
        const initialsText = new PIXI.Text(initials, {
          fill: '#ffffff',
          fontSize: baseRadius * 0.4,
          fontWeight: 'bold',
          align: 'center',
        });
        initialsText.anchor.set(0.5);
        initialsText.position.set(0, 0);
        playerContainer.addChild(initialsText);
      }

      // Border overlay so it stays visible on top of sprite/initials
      const borderOverlay = new PIXI.Graphics();
      borderOverlay.lineStyle(3, 0xffffff, 0.2);
      borderOverlay.drawCircle(0, 0, baseRadius);
      playerContainer.addChild(borderOverlay);
    }

    // Player name label with background (wider for local LV badge)
    const nameWidth = isLocal ? 110 : 60;
    const nameBg = new PIXI.Graphics();
    nameBg.beginFill(0x000000, 0.7);
    nameBg.drawRoundedRect((-nameWidth / 2) * scale, -(baseRadius + 20) * scale, nameWidth * scale, 18 * scale, 4 * scale);
    nameBg.endFill();
    playerContainer.addChild(nameBg);

    const nameLabel = new PIXI.Text(
      isLocal ? `${formatDisplayName(player.nickname || 'You')} (LV ${level})` : formatDisplayName(player.nickname || 'Player'),
      {
        fill: '#ffffff',
        fontSize: 12 * scale,
        fontWeight: isLocal ? 'bold' : 'normal',
      },
    );
    nameLabel.name = 'nicknameLabel';
    nameLabel.anchor.set(0.5);
    nameLabel.position.set(0, -(baseRadius + 11) * scale);
    playerContainer.addChild(nameLabel);

    // Add pulsing animation for local player
    // NO LOCAL TICKERS HERE
    // Callers like the persistent rendering effect will handle local animations

    // Initial smoke state
    ensureSmokeState(playerContainer, !!player.isSmoking, player.smokeStart, player.userId);

    return playerContainer;
  };

  // --- UNIFIED PLAYER RENDERING EFFECT ---
  // This effect handles both local and remote players to ensure perfect sync and no ghosting.
  useEffect(() => {
    const container = playersContainerRef.current;
    if (!container || !appRef.current) return;
    const app = appRef.current;

    // Ambient smoking-room haze react to who's smoking (any client — synced)
    roomSmokingRef.current = isSmoking || remotePlayers.some((p) => p.isSmoking);

    // 1. Collect all active IDs (Local + Remote)
    const activeIds = new Set<string>();
    activeIds.add('localPlayer');
    remotePlayers.forEach(p => { if (p.userId) activeIds.add(String(p.userId)); });

    // 2. Identify existing sprites
    const existingSprites = new Map(
      container.children
        .filter(c => c.name)
        .map(c => [c.name!, c])
    );

    // 3. Render / Update Local Player
    let localSprite = existingSprites.get('localPlayer') as any;
    const needsLocalRecon = !localSprite || localSprite.destroyed ||
      localSprite.userData?.avatarImage !== avatarImage ||
      localSprite.userData?.avatarColor !== avatarColor ||
      localSprite.userData?.nickname !== nickname;

    if (needsLocalRecon) {
      if (localSprite && !localSprite.destroyed) {
        if (localSprite.userData?.pulseTicker) app.ticker.remove(localSprite.userData.pulseTicker);
        if (localSprite.userData?.walkTicker) app.ticker.remove(localSprite.userData.walkTicker);
        container.removeChild(localSprite);
        localSprite.destroy({ children: true });
      }

      localSprite = createPlayerAvatar({ ...localPlayerRef.current, avatarImage, avatarColor, nickname }, true) as any;
      localSprite.name = 'localPlayer';
      localSprite.zIndex = 10000;
      localSprite.userData = localSprite.userData || {};
      localSprite.userData.avatarImage = avatarImage;
      localSprite.userData.avatarColor = avatarColor;
      localSprite.userData.nickname = nickname;

      container.addChild(localSprite);
      localSpriteRef.current = localSprite;

      // Pulse animation
      let pulseTime = 0;
      const glow = localSprite.children[0] as PIXI.Graphics;
      const pulseTicker = () => {
        pulseTime += 0.05;
        if (glow && !glow.destroyed) glow.alpha = 0.3 + Math.sin(pulseTime) * 0.1;
      };
      if (app.ticker) app.ticker.add(pulseTicker);
      localSprite.userData.pulseTicker = pulseTicker;
    }

if (localSprite && !localSprite.destroyed) {
localSprite.position.set(localPlayerRef.current.x, localPlayerRef.current.y);
ensureSmokeState(localSprite, isSmoking, smokeStartRef.current, userId);
ensureChatBubble(localSprite, chatMessages[userId]);
ensureEmoteBubble(localSprite, emotesByPlayer[userId]);
ensureGameBadge(localSprite, localCurrentGame || null);

      // Walking bounce toggle
      const amMoving = localPlayerRef.current.isMoving;
      if (amMoving && !localSprite.userData.walkTicker && app.ticker) {
        let walkOffset = 0;
        const walkTicker = () => {
          if (localPlayerRef.current.isMoving && localSprite && !localSprite.destroyed) {
            walkOffset += 0.3;
            localSprite.scale.y = 1 + Math.sin(walkOffset) * 0.05;
          } else if (localSprite && !localSprite.destroyed) {
            localSprite.scale.y = 1;
          }
        };
        app.ticker.add(walkTicker);
        localSprite.userData.walkTicker = walkTicker;
      } else if (!amMoving && localSprite.userData.walkTicker && app.ticker) {
        app.ticker.remove(localSprite.userData.walkTicker);
        delete localSprite.userData.walkTicker;
        if (!localSprite.destroyed) localSprite.scale.y = 1;
      }
    }

    // 4. Render / Update Remote Players
    remotePlayers.forEach(p => {
      if (!p.userId) return;
      const pId = String(p.userId);
      const spriteName = `remotePlayer_${pId}`;
      let rSprite = existingSprites.get(spriteName) as any;

      const needsRemoteRecon = !rSprite || rSprite.destroyed ||
        rSprite.userData?.avatarImage !== p.avatarImage ||
        rSprite.userData?.nickname !== p.nickname;

      if (needsRemoteRecon) {
        if (rSprite && !rSprite.destroyed) {
          container.removeChild(rSprite);
          rSprite.destroy({ children: true });
        }
        rSprite = createPlayerAvatar(p, false) as any;
        rSprite.name = spriteName;
        rSprite.zIndex = 500;
        rSprite.userData = {
          isRemotePlayer: true,
          targetX: p.x,
          targetY: p.y,
          avatarImage: p.avatarImage,
          nickname: p.nickname,
        };
        rSprite.position.set(p.x, p.y);
        container.addChild(rSprite);
      } else {
        rSprite.userData.targetX = p.targetX ?? p.x;
        rSprite.userData.targetY = p.targetY ?? p.y;
      }

        ensureSmokeState(rSprite, !!p.isSmoking, p.smokeStart, p.userId);
        ensureChatBubble(rSprite, chatMessages[pId]);
        ensureEmoteBubble(rSprite, emotesByPlayer[pId]);
        ensureGameBadge(rSprite, p.currentGame || null);
    });

    // 5. Cleanup Inactive Sprites
    existingSprites.forEach((sprite, name) => {
      const isRemote = name.startsWith('remotePlayer_');
      const pId = isRemote ? name.replace('remotePlayer_', '') : 'localPlayer';
      if (!activeIds.has(pId)) {
        container.removeChild(sprite);
        if (!sprite.destroyed) sprite.destroy({ children: true });
      }
    });

    }, [remotePlayers, avatarImage, avatarColor, nickname, isSmoking, chatMessages, emotesByPlayer, userId]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      const app = appRef.current;
      const sprite = localSpriteRef.current as any;
      if (app && app.ticker && sprite) {
        if (sprite.userData?.pulseTicker) app.ticker.remove(sprite.userData.pulseTicker);
        if (sprite.userData?.walkTicker) app.ticker.remove(sprite.userData.walkTicker);
      }
    };
  }, []);




  // --- OPTIMIZED GLOBAL GAME LOOP ---
  useEffect(() => {
    if (!appRef.current || !playersContainerRef.current) return;
    const app = appRef.current;
    const container = playersContainerRef.current;

    const updateLoop = () => {
      const now = Date.now();

      // Iterate backwards so we can safely remove children
      for (let i = container.children.length - 1; i >= 0; i--) {
        const child = container.children[i] as any;
        if (!child) continue;

        // 1. Movement Interpolation
        if (child.userData?.isRemotePlayer && child.userData?.targetX !== undefined) {
          const lerp = 0.2;
          child.position.x += (child.userData.targetX - child.position.x) * lerp;
          child.position.y += (child.userData.targetY - child.position.y) * lerp;
        }

        // 3. Smoke Animation — looping puffs so the stream never drifts away
        if (child.userData?.smokeContainer && child.userData?.smokeStartTime) {
          const elapsed = (now - child.userData.smokeStartTime) / 1000;
          child.userData.smokeContainer.children.forEach((smoke: any, idx: number) => {
            const p = smoke.userData;
            if (p) {
              const life = (elapsed * 0.7 + idx * 0.22) % 3.2;
              const wave = Math.sin(life * 3.2 + p.offset);
              const swirl = (p.swirl || 0) * Math.sin(life * 1.8 + p.offset * 2);
              smoke.position.set(
                p.driftX * (1 + wave * 0.15) + life * 3.5 * Math.sin(life * 2 + p.offset) + swirl,
                p.driftY * life
              );
              smoke.alpha = p.alpha * Math.sin((life / 3.2) * Math.PI) * (1 + wave * 0.08);
              smoke.scale.set((p.baseSize / 8) * (1 + Math.sin(life * 4 + p.offset) * 0.20));
            }
          });
        }

        // 3a. Cigarette ember glow pulse
        const ember = child.userData?.ember;
        if (ember && !ember.destroyed) {
          ember.alpha = 0.55 + 0.45 * Math.abs(Math.sin(now / 150));
        }

// 4. Chat Bubble Fade
if (child.userData?.chatBubble) {
const bubble = child.userData.chatBubble;
const age = now - bubble.userData.timestamp;
if (age > 6000) {
// Fade out
bubble.alpha = Math.max(0, 1 - (age - 6000) / 500);
if (age > 6500) {
child.removeChild(bubble);
bubble.destroy({ children: true });
delete child.userData.chatBubble;
}
}
}
// 4b. Emote Bubble Fade (short-lived)
if (child.userData?.emoteBubble) {
const eb = child.userData.emoteBubble;
const eAge = now - eb.userData.ts;
if (eAge > 2500) {
eb.alpha = Math.max(0, 1 - (eAge - 2500) / 400);
if (eAge > 2900) {
child.removeChild(eb);
eb.destroy({ children: true });
delete child.userData.emoteBubble;
}
}
}
      }

      // 5. Smoking-room ambient haze — fades in when anyone smokes (synced state)
      const haze = smokeHazeRef.current;
      if (haze && haze.container && !haze.container.destroyed) {
        const target = roomSmokingRef.current ? 0.55 : 0;
        haze.container.alpha += (target - haze.container.alpha) * 0.04;
        if (haze.container.alpha > 0.01) {
          const t = now / 1000;
          for (const pt of haze.parts) {
            pt.sprite.position.set(
              pt.baseX + Math.sin(t * 0.25 + pt.phase) * 24 + Math.cos(t * 0.13 + pt.phase * 2.1) * 10,
              pt.baseY + Math.cos(t * 0.18 + pt.phase * 1.7) * 16 + Math.sin(t * 0.11 + pt.phase) * 8
            );
            pt.sprite.alpha = 0.07 + 0.06 * Math.sin(t * 0.6 + pt.phase * 3);
          }
        }
      }
    };

    if (app.ticker) app.ticker.add(updateLoop);
    return () => {
      // Safety check: App might be destroyed before this cleanup runs
      if (app && app.ticker) {
        app.ticker.remove(updateLoop);
      }
    };
  }, []);


  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <HardwareAccelTip />
      {/* PixiJS Canvas */}
      <div
        ref={canvasRef}
        className="casino-map-canvas"
        style={{
          width: '100%',
          height: '100%',
          flex: 1,
          minHeight: 0,
          maxWidth: '100%',
          maxHeight: '100%',
          touchAction: 'none',
          WebkitTapHighlightColor: 'transparent'
        }}
      />

      {/* Interaction Prompt - Table */}
      {nearTable && (
        <div style={{
          position: 'absolute',
          bottom: '100px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0, 0, 0, 0.85)',
          border: `2px solid #${nearTable.color.toString(16).padStart(6, '0')}`,
          borderRadius: '12px',
          padding: '12px 24px',
          color: '#fff',
          fontSize: '16px',
          fontWeight: 'bold',
          textAlign: 'center',
          backdropFilter: 'blur(8px)',
          animation: 'fadeInUp 0.2s ease-out',
          zIndex: 100,
          cursor: 'pointer',
          userSelect: 'none',
        }} onClick={handleMobileInteract} role="button" tabIndex={0}>
          <span style={{ marginRight: '10px' }}>
            {nearTable.id === 'info-desk' ? '📋' : nearTable.id === 'smoking-area' ? '🌫️' : nearTable.id === 'piano' ? '🎹' : '🎮'}
          </span>
          Press <span style={{
            background: '#4ecdc4',
            padding: '2px 8px',
            borderRadius: '4px',
            color: '#000',
            margin: '0 4px'
          }}>E</span> or click here {nearTable.id === 'info-desk' ? 'to read Casino Rules' : nearTable.id === 'smoking-area' ? 'to light up' : nearTable.id === 'piano' ? 'to play the piano' : `to play ${nearTable.name}`}
        </div>
      )}

      {/* Interaction Prompt - Player */}
      {nearPlayer && !nearTable && (
        <div style={{
          position: 'absolute',
          bottom: '100px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0, 0, 0, 0.85)',
          border: `2px solid ${nearPlayer.avatarColor || '#ff6b6b'}`,
          borderRadius: '12px',
          padding: '12px 24px',
          color: '#fff',
          fontSize: '16px',
          fontWeight: 'bold',
          textAlign: 'center',
          backdropFilter: 'blur(8px)',
          animation: 'fadeInUp 0.2s ease-out',
          zIndex: 100,
          cursor: 'pointer',
          userSelect: 'none',
        }} onClick={handleMobileInteract} role="button" tabIndex={0}>
          <span style={{ marginRight: '10px' }}>👤</span>
          Press <span style={{
            background: '#4ecdc4',
            padding: '2px 8px',
            borderRadius: '4px',
            color: '#000',
            margin: '0 4px'
          }}>E</span> or click here to view <span style={{ color: nearPlayer.avatarColor || '#ff6b6b' }}>{nearPlayer.nickname || 'Player'}'s</span> profile
        </div>
      )}

      {/* Smoking Indicator */}
      {isSmoking && (
        <div style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0, 0, 0, 0.8)',
          border: '2px solid #6b7280',
          borderRadius: '12px',
          padding: '10px 20px',
          color: '#fff',
          fontSize: '14px',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          backdropFilter: 'blur(8px)',
          zIndex: 100,
        }}>
          <span className="smoke-emoji">🌫️</span>
          <span>Smoking...</span>
          <span style={{ color: '#888', fontSize: '12px' }}>(Press E to stop)</span>
        </div>
      )}

      {isMobile && showMobileHint && (
        <div style={{
          position: 'absolute',
          top: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.6)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '12px',
          padding: '10px 14px',
          color: '#fff',
          fontSize: '13px',
          textAlign: 'center',
          zIndex: 120
        }}>
          <div style={{ fontWeight: 700 }}>Modo móvil</div>
          <div style={{ opacity: 0.85 }}>Toca el mapa para moverte • Usa Interact/Center abajo</div>
        </div>
      )}

      {/* Mobile controls */}
      {isMobile && (
        <div className="mobile-controls">
          <div className="mobile-dpad">
            <button
              aria-label="Move up"
              onMouseDown={() => setTouchInput(0, -1)}
              onMouseUp={stopTouchInput}
              onMouseLeave={stopTouchInput}
              onTouchStart={(e) => { e.preventDefault(); setTouchInput(0, -1); }}
              onTouchEnd={stopTouchInput}
              onTouchCancel={stopTouchInput}
            >▲</button>
            <div className="mobile-dpad-row">
              <button
                aria-label="Move left"
                onMouseDown={() => setTouchInput(-1, 0)}
                onMouseUp={stopTouchInput}
                onMouseLeave={stopTouchInput}
                onTouchStart={(e) => { e.preventDefault(); setTouchInput(-1, 0); }}
                onTouchEnd={stopTouchInput}
                onTouchCancel={stopTouchInput}
              >◀</button>
              <button
                aria-label="Move down"
                onMouseDown={() => setTouchInput(0, 1)}
                onMouseUp={stopTouchInput}
                onMouseLeave={stopTouchInput}
                onTouchStart={(e) => { e.preventDefault(); setTouchInput(0, 1); }}
                onTouchEnd={stopTouchInput}
                onTouchCancel={stopTouchInput}
              >▼</button>
              <button
                aria-label="Move right"
                onMouseDown={() => setTouchInput(1, 0)}
                onMouseUp={stopTouchInput}
                onMouseLeave={stopTouchInput}
                onTouchStart={(e) => { e.preventDefault(); setTouchInput(1, 0); }}
                onTouchEnd={stopTouchInput}
                onTouchCancel={stopTouchInput}
              >▶</button>
            </div>
          </div>
          <div className="mobile-actions">
            <button className="mobile-action primary" onClick={handleMobileInteract}>
              Interact
            </button>
            <button className="mobile-action ghost" onClick={handleRecenter}>
              Center
            </button>
            {sendChat && (
              <button className="mobile-action ghost" onClick={handleMobileChat}>
                Chat
              </button>
            )}
          </div>
        </div>
      )}

      {/* Animation styles */}
      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }
        
        .smoke-emoji {
          animation: smokePulse 1s ease-in-out infinite;
        }
        
        @keyframes smokePulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.2); }
        }
      `}</style>

      {/* Discrete FPS Counter */}

        {sendEmote && !isMobile && (
          <div
            style={{
              position: 'absolute',
              bottom: '14px',
              right: '14px',
              display: 'flex',
              gap: '6px',
              background: 'rgba(0, 0, 0, 0.65)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '999px',
              padding: '6px 10px',
              zIndex: 200,
              backdropFilter: 'blur(8px)',
            }}
          >
            {['👋', '🎉', '🤝', '💪', '🔥', '😎', '🙌'].map((e) => (
              <button
                key={e}
                aria-label={`Emote ${e}`}
                onClick={() => sendEmote(e)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  lineHeight: 1,
                  padding: '4px',
                  transition: 'transform 0.15s',
                }}
                onMouseEnter={(ev) => { ev.currentTarget.style.transform = 'scale(1.25)'; }}
                onMouseLeave={(ev) => { ev.currentTarget.style.transform = 'scale(1)'; }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
      );
      }

// Hardware-acceleration recommendation tip. Dismissible; stays dismissed via
// localStorage so it shows once per browser. The "?" tooltip lists where the
// toggle lives in each browser's menu.
function HardwareAccelTip() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('c888_hw_accel_tip_dismissed') === '1';
    } catch {
      return false;
    }
  });
  const [showTooltip, setShowTooltip] = useState(false);
  if (dismissed) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: '16px',
        left: '16px',
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: 'rgba(0,0,0,0.65)',
        border: '1px solid rgba(255,215,0,0.4)',
        borderRadius: '10px',
        padding: '8px 12px',
        color: '#fff',
        fontSize: '12.5px',
        backdropFilter: 'blur(8px)',
      }}
    >
      <span style={{ fontSize: '16px' }}>⚡</span>
      <span>
        Enable <strong>hardware acceleration</strong> in your browser for the
        smoothest experience
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            height: '16px',
            marginLeft: '6px',
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.5)',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'help',
            position: 'relative',
          }}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          onClick={() => setShowTooltip((v) => !v)}
          aria-label="Where to find hardware acceleration in your browser"
        >
          ?
          {showTooltip && (
            <span
              style={{
                position: 'absolute',
                top: '100%',
                left: '0',
                marginTop: '8px',
                width: '260px',
                background: 'rgba(15,15,25,0.97)',
                border: '1px solid rgba(255,215,0,0.35)',
                borderRadius: '10px',
                padding: '10px 12px',
                fontSize: '11.5px',
                lineHeight: 1.5,
                textAlign: 'left',
                fontWeight: 400,
                zIndex: 400,
                whiteSpace: 'normal',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '6px', color: '#ffd700' }}>
                Where to enable it:
              </div>
              <div>• <strong>Chrome</strong>: Settings → System → “Use hardware acceleration when available”</div>
              <div>• <strong>Edge</strong>: Settings → System and performance → “Use graphics acceleration when available”</div>
              <div>• <strong>Firefox</strong>: Settings → General → Performance → uncheck “Use recommended performance settings”, tick “Use hardware acceleration when available”</div>
              <div>• <strong>Safari</strong>: Settings → Advanced → “Show features for web developers” (acceleration is always on)</div>
              <div style={{ marginTop: '6px', opacity: 0.8 }}>Restart your browser after changing it.</div>
            </span>
          )}
        </span>
      </span>
      <button
        onClick={() => {
          try {
            localStorage.setItem('c888_hw_accel_tip_dismissed', '1');
          } catch {
            /* ignore */
          }
          setDismissed(true);
        }}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'rgba(255,255,255,0.6)',
          fontSize: '14px',
          cursor: 'pointer',
          padding: '0 2px',
          lineHeight: 1,
        }}
        aria-label="Dismiss tip"
      >
        ✕
      </button>
    </div>
  );
}
