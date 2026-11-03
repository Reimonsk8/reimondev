import * as PIXI from 'pixi.js';
import {
  ISO_TILE_HEIGHT,
  ISO_TILE_WIDTH,
  worldToScreen,
} from './isometric';
import { FACADE_MATERIALS, facadeNoise, hashId, paintBrickFace, paintRuinFace, shade } from './facade';
import { MODULAR_ASSET_MANIFEST, type SpriteKey } from './assets';
import type { BuildingDoor, Obstacle, StreetProp } from './types';
import { CHUNK_SIZE } from './world';
import { clamp } from './isometric';

const PROP_WIDTH_PX: Partial<Record<SpriteKey, number>> = {
  crate: 26,
  burning_barrel: 34,
  burned_car: 100,
  corpse: 40,
  kitchen_counter: 36,
  filing_cabinet: 38,
  vault_safe: 50,
  dumpster: 42,
  streetlamp: 53,
  rubble: 64,
  weeds: 64,
  trash_bags: 40,
  barricade: 56,
};

export function propSprite(
  textures: Map<string, PIXI.Texture>,
  key: SpriteKey,
  widthPx = PROP_WIDTH_PX[key] ?? 32,
): PIXI.Sprite {
  const tex = textures.get(key) ?? PIXI.Texture.EMPTY;
  const sp = new PIXI.Sprite(tex);
  const { anchor } = MODULAR_ASSET_MANIFEST[key];
  sp.anchor.set(anchor.x, anchor.y);
  sp.scale.set(widthPx / Math.max(1, tex.width));
  return sp;
}

export function createObstacleNode(
  textures: Map<string, PIXI.Texture>,
  obs: Obstacle,
  doorState?: BuildingDoor['state'],
): PIXI.Container {
  const c = new PIXI.Container();
  const center = worldToScreen(obs.x + obs.width * 0.5, obs.y + obs.height * 0.5);
  c.position.set(center.x, center.y);
  c.zIndex = center.y + 8;

  if (obs.kind === 'ruin') {
    const rel = (wx: number, wy: number) => {
      const p = worldToScreen(wx, wy);
      return { x: p.x - center.x, y: p.y - center.y };
    };
    const top = rel(obs.x, obs.y);
    const right = rel(obs.x + obs.width, obs.y);
    const bottom = rel(obs.x + obs.width, obs.y + obs.height);
    const left = rel(obs.x, obs.y + obs.height);
    const wallH = Math.round(28 + Math.max(obs.width, obs.height) * 5);

    const seed = hashId(obs.id);
    const material = FACADE_MATERIALS[seed % FACADE_MATERIALS.length];
    const bldg = new PIXI.Graphics();

    const o = { x: wallH * 0.55, y: wallH * 0.28 };
    bldg.beginFill(0x000000, 0.45);
    bldg.drawPolygon([top.x, top.y, right.x, right.y, right.x + o.x, right.y + o.y, bottom.x + o.x, bottom.y + o.y, left.x + o.x, left.y + o.y, left.x, left.y]);
    bldg.endFill();

    bldg.beginFill(0x181e29, 0.96);
    bldg.drawPolygon([top.x, top.y, right.x, right.y, bottom.x, bottom.y, left.x, left.y]);
    bldg.endFill();

    paintBrickFace(bldg, left, top, wallH, shade(material[0], 0.55), material[1], seed + 1);
    paintBrickFace(bldg, top, right, wallH, shade(material[0], 0.68), material[1], seed + 2);
    paintRuinFace(
      bldg,
      left,
      bottom,
      wallH,
      material,
      1.12,
      seed + 3,
      doorState ? 0.5 : null,
      doorState === 'open' || doorState === 'smashed',
      doorState === 'barricaded',
    );
    paintRuinFace(bldg, bottom, right, wallH, material, 0.78, seed + 4, null, false);

    c.addChild(bldg);
    return c;
  }

  const shadow = new PIXI.Graphics();
  shadow.beginFill(0x000000, 0.48);
  shadow.drawEllipse(0, 6, Math.max(18, obs.width * 16), Math.max(9, obs.height * 9));
  shadow.endFill();
  c.addChild(shadow);

  if (obs.kind === 'container') {
    const iso = (wx: number, wy: number) => ({ x: (wx - wy) * (ISO_TILE_WIDTH / 2), y: (wx + wy) * (ISO_TILE_HEIGHT / 2) });
    const slots = [iso(-0.3, -0.3), { ...iso(-0.3, -0.3), y: iso(-0.3, -0.3).y - 20 }, iso(-0.3, 0.3), iso(0.3, -0.3)];
    for (const slot of slots) {
      const sp = propSprite(textures, 'crate');
      sp.position.set(slot.x, slot.y);
      c.addChild(sp);
    }
    return c;
  }

  if (obs.kind === 'wreck') {
    c.addChild(propSprite(textures, 'burned_car'));
    return c;
  }

  const g = new PIXI.Graphics();
  g.lineStyle(1, 0x181a1b, 0.9);
  g.beginFill(0x3a3d38, 1);
  g.drawRoundedRect(-20, -22, 40, 24, 3);
  g.endFill();
  g.beginFill(0x282a27, 1);
  g.drawRect(-18, -12, 36, 12);
  g.endFill();
  c.addChild(g);
  return c;
}

export function createRoofNode(obs: Obstacle): PIXI.Graphics {
  const roof = new PIXI.Graphics();
  const center = worldToScreen(obs.x + obs.width * 0.5, obs.y + obs.height * 0.5);
  const rel = (wx: number, wy: number) => {
    const p = worldToScreen(wx, wy);
    return { x: p.x - center.x, y: p.y - center.y };
  };
  const top = rel(obs.x, obs.y);
  const right = rel(obs.x + obs.width, obs.y);
  const bottom = rel(obs.x + obs.width, obs.y + obs.height);
  const left = rel(obs.x, obs.y + obs.height);
  const wallH = Math.round(28 + Math.max(obs.width, obs.height) * 5);

  roof.lineStyle(1.5, 0x0b0e14, 0.96);
  roof.beginFill(0x1c2330, 0.98);
  roof.drawPolygon([top.x, top.y - wallH, right.x, right.y - wallH, bottom.x, bottom.y - wallH, left.x, left.y - wallH]);
  roof.endFill();

  roof.lineStyle(1, 0x334155, 0.65);
  roof.drawPolygon([top.x * 0.82, top.y * 0.82 - wallH, right.x * 0.82, right.y * 0.82 - wallH, bottom.x * 0.82, bottom.y * 0.82 - wallH, left.x * 0.82, left.y * 0.82 - wallH]);

  const seed = hashId(obs.id);
  const R = (u: number, v: number) => ({
    x: top.x + (right.x - top.x) * u + (left.x - top.x) * v,
    y: top.y + (right.y - top.y) * u + (left.y - top.y) * v - wallH,
  });
  roof.lineStyle(0);
  for (let i = 0; i < 40; i += 1) {
    const p = R(0.08 + facadeNoise(seed, i) * 0.84, 0.08 + facadeNoise(seed, i + 50) * 0.84);
    roof.beginFill(facadeNoise(seed, i + 100) < 0.5 ? 0x2a3240 : 0x10141a, 0.8);
    roof.drawRect(p.x, p.y, 1.5, 1.5);
    roof.endFill();
  }
  const vent = R(0.3 + facadeNoise(seed, 200) * 0.4, 0.3 + facadeNoise(seed, 201) * 0.4);
  roof.beginFill(0x3a3f45, 1);
  roof.drawRect(vent.x - 4, vent.y - 6, 8, 6);
  roof.endFill();
  roof.beginFill(0x4a3428, 1);
  roof.drawRect(vent.x - 4, vent.y - 6, 8, 2);
  roof.endFill();
  if (facadeNoise(seed, 300) < 0.4) {
    const hole = R(0.25 + facadeNoise(seed, 301) * 0.5, 0.25 + facadeNoise(seed, 302) * 0.5);
    roof.beginFill(0x050608, 0.92);
    roof.drawEllipse(hole.x, hole.y, 8, 4);
    roof.endFill();
    roof.lineStyle(1, 0x3b4452, 0.8);
    roof.drawEllipse(hole.x, hole.y, 8, 4);
    roof.lineStyle(0);
  }
  return roof;
}

export function createPropNode(
  textures: Map<string, PIXI.Texture>,
  prop: StreetProp,
  tier = 0,
): PIXI.Container {
  const c = new PIXI.Container();
  const pos = worldToScreen(prop.x, prop.y);
  c.position.set(pos.x, pos.y);
  c.zIndex = pos.y + 4;

  const spriteFor: Partial<Record<StreetProp['kind'], SpriteKey>> = {
    barrel_fire: 'burning_barrel',
    barricade: 'barricade',
    streetlight: 'streetlamp',
    burned_car: 'burned_car',
    rubble: 'rubble',
    trash_mound: 'trash_bags',
    foliage: 'weeds',
  };
  const key = spriteFor[prop.kind];
  if (key) {
    const sp = propSprite(textures, key);
    if (!prop.castsLight) sp.scale.set(sp.scale.x * clamp(prop.scale, 0.8, 1.15));
    if (prop.kind === 'streetlight') {
      const lx = ((prop.x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const ly = ((prop.y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      if (lx < 2 || ly > CHUNK_SIZE - 2) sp.scale.x *= -1;
    }
    c.addChild(sp);
    if (prop.kind === 'foliage') {
      const palettes = tier >= 2 ? [0xffffff, 0xb8c9a0, 0xa0b888, 0xc8d8b0] : tier >= 1 ? [0xffffff, 0xcfe8c9, 0xb7d9a8, 0xe6f0d8] : [0xffffff, 0xd8f0d0, 0xc0e8b8, 0xeaf5e0];
      sp.tint = palettes[hashId(prop.id) % palettes.length];
    } else if (prop.kind === 'trash_mound' || prop.kind === 'rubble') {
      const palettes = tier >= 2 ? [0xffffff, 0xb8a890, 0xa89880, 0xc8b8a0] : [0xffffff, 0xd6d0c4, 0xc4beb2, 0xe2ddd3];
      sp.tint = palettes[hashId(prop.id) % palettes.length];
    }
    if (!prop.castsLight) c.cacheAsBitmap = true;
    return c;
  }

  c.zIndex = -1e6;
  const g = new PIXI.Graphics();
  g.rotation = prop.rotation;
  const s = prop.scale;
  if (prop.kind === 'blood_stain') {
    g.beginFill(0x3b0707, 0x78);
    g.drawEllipse(0, 0, 11 * s, 5 * s);
    g.drawEllipse(9 * s, 2 * s, 4 * s, 2 * s);
    g.drawEllipse(-8 * s, -2 * s, 3 * s, 1.5 * s);
    g.endFill();
  } else {
    g.lineStyle(1, 0x05070a, 0.85);
    g.moveTo(-14 * s, -2 * s);
    g.lineTo(-5 * s, 1 * s);
    g.lineTo(2 * s, -1 * s);
    g.lineTo(12 * s, 3 * s);
    g.moveTo(-5 * s, 1 * s);
    g.lineTo(-7 * s, 5 * s);
  }
  c.addChild(g);
  c.cacheAsBitmap = true;
  return c;
}
