import * as PIXI from 'pixi.js';

/**
 * Runtime contract of sprite-gen `manifest.json` (docs/run-contract.md §8):
 * frame_layout.rows.<state>[i] -> absolute atlas rects; animation.rows.<state>
 * carries frames/fps/loop and an optional durations_ms per frame.
 */
export interface SpriteFrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteAnimationMeta {
  row?: number;
  frames: number;
  fps: number;
  loop: boolean;
  durations_ms?: number[];
}

export interface SpriteAtlasManifest {
  game_input: string;
  degraded_static_fallback?: boolean;
  animation: {
    rows: Record<string, SpriteAnimationMeta>;
  };
  frame_layout: {
    rows: Record<string, SpriteFrameRect[]>;
    sheetWidth: number;
    sheetHeight: number;
    cellWidth: number;
    cellHeight: number;
  };
  curation_applied?: boolean;
  frame_variant?: string;
}

export interface SpriteAtlas {
  /** PIXI.Texture for every rect in the sheet (created once, cached). */
  textures: PIXI.Texture[];
  /** Maps state name -> frame texture list, built only when accessed. */
  stateFrames: Map<string, PIXI.Texture[]>;
  manifest: SpriteAtlasManifest;
}

const cache = new Map<string, Promise<SpriteAtlas>>();

/** Clear the in-memory atlas cache (tests / HMR). */
export function clearSpriteAtlasCache(): void {
  cache.clear();
}

/**
 * Load one generated atlas from /sprites/<name>/ manifest + sheet.
 * The sheet is awaited via PIXI.Assets so sub-textures are cut from a
 * fully-loaded base texture instead of an empty placeholder.
 */
export function loadSpriteAtlas(name: string, baseUrl = ''): Promise<SpriteAtlas> {
  const key = `${baseUrl}/${name}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const manifestUrl = `${baseUrl}/sprites/${name}/manifest.json`;
  const sheetUrl = `${baseUrl}/sprites/${name}/sprite-sheet-alpha.png`;

  const promise = (async (): Promise<SpriteAtlas> => {
    const res = await fetch(manifestUrl);
    if (!res.ok) throw new Error(`sprite manifest ${manifestUrl} -> ${res.status}`);
    const manifest = (await res.json()) as SpriteAtlasManifest;
    if (!manifest?.frame_layout?.rows) throw new Error(`sprite manifest ${manifestUrl} missing frame_layout.rows`);
    // PIXI.Assets.load caches by URL internally; awaiting guarantees the
    // base texture has dimensions before sub-rects are cut.
    const base = (await PIXI.Assets.load(sheetUrl)) as PIXI.Texture;
    const baseTexture = (base.baseTexture ?? base) as PIXI.BaseTexture;
    const stateFrames = new Map<string, PIXI.Texture[]>();
    for (const state of Object.keys(manifest.frame_layout.rows)) {
      const rects = manifest.frame_layout.rows[state] ?? [];
      stateFrames.set(
        state,
        rects.map((r) => new PIXI.Texture(baseTexture, new PIXI.Rectangle(r.x, r.y, r.w, r.h)))
      );
    }
    return {
      textures: Array.from(stateFrames.values()).flat(),
      stateFrames,
      manifest,
    } satisfies SpriteAtlas;
  })();

  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}

/** Frame textures for a state; falls back to the first state when missing. */
export function atlasFrames(atlas: SpriteAtlas, state: string): PIXI.Texture[] {
  const frames = atlas.stateFrames.get(state);
  if (frames && frames.length) return frames;
  const first = atlas.stateFrames.values().next().value as PIXI.Texture[] | undefined;
  return first && first.length ? first : [];
}

/**
 * An AnimatedSprite factory bound to one atlas + state, with sensible
 * defaults for a top-down casino character. Returns null when the state has
 * no frames so callers can fall back to procedural rendering.
 */
export function createAnimatedSprite(atlas: SpriteAtlas, state: string): PIXI.AnimatedSprite | null {
  const frames = atlasFrames(atlas, state);
  if (!frames.length) return null;
  const meta = atlas.manifest.animation?.rows?.[state];
  const sprite = new PIXI.AnimatedSprite(frames);
  sprite.animationSpeed = (meta?.fps || 8) / 30; // pixi ticks at ~30fps in CasinoMap
  sprite.loop = meta?.loop ?? true;
  sprite.anchor.set(0.5, 1); // feet at anchor
  sprite.play();
  return sprite;
}