import * as PIXI from 'pixi.js';
import {
  MODULAR_ASSET_MANIFEST,
  type SpriteKey,
  buildInitialSynchronousTextures,
  enforceNearestNeighborFiltering,
  loadAllModularAssets,
  resolveDirectionalSpriteFrame,
} from './assets';
import {
  CAMERA_ZOOM,
  computeCameraTransform,
  screenToWorldWithCamera,
  zoomForViewport,
} from './camera';
import { decalRadiusFor, goreBurstFor, type GoreParticleSeed } from './gore';
import { BUILDING_DOOR_HEIGHT_WORLD, BUILDING_DOOR_WIDTH_WORLD } from './doorGeometry';
import {
  NORTH_WEST_WALL_CUTAWAY_ALPHA,
  PITCH_BLACK_ROOM_FOG_COLOR,
  evaluateStrictIndoorFog,
  getInteriorPortals,
  getInteriorRooms,
  isNorthOrWestInteriorWall,
} from './interiors';
import {
  ISO_TILE_HEIGHT,
  ISO_TILE_WIDTH,
  clamp,
  worldToScreen,
} from './isometric';
import {
  AMBIENT_BASE_COLOR,
  MUZZLE_FLASH_DURATION_SEC,
  TwoPassLightingPipeline,
  computeLightingFrame,
} from './lighting';
import {
  type BuildingFootprint,
  computeObstacleOcclusionAlpha,
  createBuildingFootprintFromObstacle,
  stepBuildingOcclusion,
} from './occlusion';
import { PaperdollActor, type PaperdollDebugInfo } from './paperdoll';
import { paintProceduralAsphaltTile } from './ground';
import { createObstacleNode, createPropNode, createRoofNode, propSprite } from './propFactory';
import {
  MAX_HEAVY_SHAKE_PX,
  computeRecoilVector,
  computeWeaponShakePx,
  stepLinearRecoil,
} from './simulation';
import type {
  GameEvent,
  LootPickup,
  Obstacle,
  RemoteOutlandsPlayer,
  Vec2,
  WorldChunk,
  WorldContainer,
  WorldMap,
  WorldState,
  ZombieState,
} from './types';
import { threatTierAt } from './world';

// Directive 1: Enforce strict Nearest-Neighbor Texture Filtering globally on module load
enforceNearestNeighborFiltering();

const PROP_WIDTH_PX: Partial<Record<SpriteKey, number>> = {
  crate: 26, // ~0.95m
  burning_barrel: 34, // drum + flames ~1.4m
  burned_car: 100, // ~1.5m tall, ~2 tiles long
  corpse: 40,
  kitchen_counter: 36, // ~0.9m
  filing_cabinet: 38, // ~1.3m
  vault_safe: 50, // ~1.5m locker
  dumpster: 42, // ~1.4m
  streetlamp: 53, // compressed to ~2x survivor height
  rubble: 64, // one-tile ground plate
  weeds: 64, // one-tile ground plate
  trash_bags: 40, // ~1m heap
  barricade: 56, // jersey barrier + sandbags across a lane
};

interface ActiveParticle extends GoreParticleSeed {
  x: number;
  y: number;
  z: number;
  age: number;
  colorNum: number;
}

interface ActiveTrace {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  headshot: boolean;
  crit?: boolean;
  ttl: number;
}

interface FloatingCallout {
  x: number;
  y: number;
  z: number;
  ttl: number;
  color: number;
  radius: number;
}

interface ChunkRenderEntry {
  ground: PIXI.Container;
  props: PIXI.Container[];
  obstacles: Array<{ node: PIXI.Container; obstacle: Obstacle }>;
}

const DECAL_TEX_SIZE = 2048;
const MAX_PARTICLES = 180;
const MAX_TRACES = 40;
const DECAL_ORIGIN_X = DECAL_TEX_SIZE / 2;
const DECAL_ORIGIN_Y = 220;

function hexStringToColorNum(hex: string): number {
  const cleaned = hex.replace('#', '');
  const parsed = Number.parseInt(cleaned, 16);
  return Number.isFinite(parsed) ? parsed : 0x5a0505;
}

export class OutlandsRenderer {
  private host: HTMLElement;
  private app: PIXI.Application;
  private worldRoot = new PIXI.Container();
  private groundLayer = new PIXI.Container();
  private decalLayer = new PIXI.Container();
  private entityLayer = new PIXI.Container();
  private fxLayer = new PIXI.Graphics();
  private indoorFogLayer = new PIXI.Graphics();
  private interiorPortalLayer = new PIXI.Container();
  private exteriorDoorLayer = new PIXI.Graphics();
  private lightingPipeline = new TwoPassLightingPipeline();
  private screenFlash = new PIXI.Graphics();
  private crosshairLayer = new PIXI.Graphics();

  private decalRenderTexture: PIXI.RenderTexture | null = null;
  private decalSprite: PIXI.Sprite | null = null;
  private decalStamp = new PIXI.Graphics();
  private fallbackDecalGraphics = new PIXI.Graphics();

  private textures = new Map<SpriteKey, PIXI.Texture>();
  private zombieSprites = new Map<string, PIXI.Container>();
  private zombieLastHp = new Map<string, number>();
  private remoteActors = new Map<
    string,
    { actor: PaperdollActor; hp: PIXI.Graphics; lastShotSeq: number }
  >();
  private pickupSprites = new Map<string, PIXI.Container>();
  private containerSprites = new Map<string, PIXI.Container>();
  private interiorPortalSprites = new Map<string, { sprite: PIXI.Sprite; key: SpriteKey }>();
  private renderedChunks = new Map<string, ChunkRenderEntry>();
  private baseObstacles: Array<{
    node: PIXI.Container;
    roofNode?: PIXI.Graphics;
    footprint?: BuildingFootprint;
    obstacle: Obstacle;
  }> = [];

  private playerPaperdoll: PaperdollActor | null = null;
  private particles: ActiveParticle[] = [];
  private ambientParticles: Array<{ x: number; y: number; vx: number; vy: number; size: number; phase: number }> = [];
  private traces: ActiveTrace[] = [];
  private callouts: FloatingCallout[] = [];
  private activeInteriorId: string | null = null;
  private exteriorDoorSignature = '';
  private lightingMaskAlpha = 0.64;

  private cameraShake = 0;
  private recoilVector: Vec2 = { x: 0, y: 0 };
  private damageFlash = 0;
  private muzzleFlashTimer = 0;
  private localShotSequence = 0;
  private lastScreenAim: Vec2 = { x: 0, y: 0 };
  private storedRemotePlayers: RemoteOutlandsPlayer[] = [];
  // Viewport world bounds (with margin) for culling off-screen entities each frame.
  private vpMinX = -1e9;
  private vpMinY = -1e9;
  private vpMaxX = 1e9;
  private vpMaxY = 1e9;
  private lightingFrameCounter = 0;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;

  constructor(host: HTMLElement, map?: WorldMap) {
    this.host = host;
    enforceNearestNeighborFiltering();
    this.textures = buildInitialSynchronousTextures();
    const width = Math.max(1, Math.round(host.clientWidth || window.innerWidth || 960));
    const height = Math.max(1, Math.round(host.clientHeight || window.innerHeight || 620));

    this.app = new PIXI.Application({
      width,
      height,
      backgroundColor: AMBIENT_BASE_COLOR,
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });

    const view = this.app.view as HTMLCanvasElement;
    view.style.width = '100%';
    view.style.height = '100%';
    view.style.display = 'block';
    view.style.imageRendering = 'pixelated';
    host.innerHTML = '';
    host.appendChild(view);

    this.entityLayer.sortableChildren = true;
    this.worldRoot.addChild(this.groundLayer);
    this.worldRoot.addChild(this.decalLayer);
    // Indoor room fog belongs behind actors, props, and effects so it never
    // paints opaque rectangles over the survivor or infected sprites.
    this.worldRoot.addChild(this.indoorFogLayer);
    this.interiorPortalLayer.sortableChildren = true;
    this.worldRoot.addChild(this.interiorPortalLayer);
    this.worldRoot.addChild(this.entityLayer);
    this.worldRoot.addChild(this.exteriorDoorLayer);
    this.worldRoot.addChild(this.fxLayer);

    this.app.stage.addChild(this.worldRoot);
    this.lightingPipeline.init(width, height);
    this.app.stage.addChild(this.lightingPipeline.container);
    this.app.stage.addChild(this.screenFlash);
    this.app.stage.addChild(this.crosshairLayer);

    this.initDecalRenderTexture();
    if (map) {
      this.buildGround(map);
      this.buildStaticObstacles(map);
      void this.loadSprites(map);
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.destroyed) return;
        this.resize();
      });
      this.resizeObserver.observe(host);
    }
    // Re-centre immediately on orientation / viewport changes (mobile rotation).
    const onOrient = () => { if (!this.destroyed) this.resize(); };
    window.addEventListener('orientationchange', onOrient);
    window.addEventListener('resize', onOrient);
  }

  public async init(state: WorldState): Promise<void> {
    this.buildGround(state.map);
    this.buildStaticObstacles(state.map);
    await this.loadSprites(state.map);
  }

  public resize(): void {
    if (this.destroyed) return;
    this.syncRendererSize();
  }

  /** Keep Pixi's logical screen, lighting buffers, and CSS host in one coordinate space. */
  private syncRendererSize(): void {
    const screen = this.app.renderer.screen;
    const width = Math.max(1, Math.round(
      this.host.clientWidth || screen.width || window.innerWidth || 960,
    ));
    const height = Math.max(1, Math.round(
      this.host.clientHeight || screen.height || window.innerHeight || 620,
    ));
    if (screen.width === width && screen.height === height) return;
    this.app.renderer.resize(width, height);
    this.lightingPipeline.resize(width, height);
  }


  public setPointerScreen(sx: number, sy: number): void {
    this.lastScreenAim = { x: sx, y: sy };
  }

  public screenToWorld(sx: number, sy: number): Vec2 {
    return screenToWorldWithCamera(
      sx,
      sy,
      { x: this.worldRoot.position.x, y: this.worldRoot.position.y },
      this.worldRoot.scale.x || CAMERA_ZOOM,
    );
  }

  public screenToWorldPoint(clientX: number, clientY: number): Vec2 {
    const view = this.app.view as HTMLCanvasElement;
    const rect = view.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    this.lastScreenAim = { x: sx, y: sy };
    return this.screenToWorld(sx, sy);
  }

  public setRemotePlayers(players: RemoteOutlandsPlayer[]): void {
    this.storedRemotePlayers = players;
  }

  public ingestEvents(events: GameEvent[]): void {
    this.consumeEvents(events);
  }

  public resetDecals(map: WorldMap): void {
    if (this.decalRenderTexture) {
      this.decalStamp.clear();
      this.app.renderer.render(this.decalStamp, {
        renderTexture: this.decalRenderTexture,
        clear: true,
      });
    }
    this.fallbackDecalGraphics.clear();
    this.buildGround(map);
    this.buildStaticObstacles(map);
  }

  private initDecalRenderTexture(): void {
    try {
      this.decalRenderTexture = PIXI.RenderTexture.create({
        width: DECAL_TEX_SIZE,
        height: DECAL_TEX_SIZE,
        scaleMode: PIXI.SCALE_MODES.NEAREST,
      });
      enforceNearestNeighborFiltering(this.decalRenderTexture);
      this.decalSprite = new PIXI.Sprite(this.decalRenderTexture);
      this.decalSprite.position.set(-DECAL_ORIGIN_X, -DECAL_ORIGIN_Y);
      this.decalSprite.alpha = 0.92;
      this.decalLayer.addChild(this.decalSprite);
    } catch {
      this.decalLayer.addChild(this.fallbackDecalGraphics);
    }
  }

  private async loadSprites(map: WorldMap): Promise<void> {
    const loaded = await loadAllModularAssets();
    for (const [key, tex] of loaded.entries()) {
      enforceNearestNeighborFiltering(tex);
      this.textures.set(key, tex);
    }
    if (this.destroyed) return;
    for (const entry of this.renderedChunks.values()) {
      entry.ground.destroy({ children: true });
      for (const p of entry.props) p.destroy({ children: true });
      for (const o of entry.obstacles) o.node.destroy({ children: true });
    }
    this.renderedChunks.clear();
    for (const zNode of this.zombieSprites.values()) zNode.destroy({ children: true });
    this.zombieSprites.clear();
    for (const cNode of this.containerSprites.values()) cNode.destroy({ children: true });
    this.containerSprites.clear();
    for (const pNode of this.pickupSprites.values()) pNode.destroy({ children: true });
    this.pickupSprites.clear();
    this.buildGround(map);
    this.buildStaticObstacles(map);
    if (this.playerPaperdoll) {
      this.playerPaperdoll.destroy();
      this.playerPaperdoll = null;
    }
  }

  private buildGround(map: WorldMap): void {
    this.groundLayer.removeChildren();
    const g = new PIXI.Graphics();
    const halfW = ISO_TILE_WIDTH / 2;
    const halfH = ISO_TILE_HEIGHT / 2;

    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const tier = threatTierAt(map, x + 0.5, y + 0.5);
        const center = worldToScreen(x + 0.5, y + 0.5);
        paintProceduralAsphaltTile(g, x, y, center, halfW, halfH, tier === 0);
      }
    }

    // Subtle Safe Outpost perimeter chalk ring
    const safeSteps = 56;
    g.lineStyle(1.5, 0x6ea896, 0.42);
    for (let i = 0; i <= safeSteps; i += 1) {
      const a = (i / safeSteps) * Math.PI * 2;
      const pt = worldToScreen(
        map.safeCenter.x + Math.cos(a) * map.safeRadius,
        map.safeCenter.y + Math.sin(a) * map.safeRadius,
      );
      if (i === 0) g.moveTo(pt.x, pt.y);
      else g.lineTo(pt.x, pt.y);
    }

    this.groundLayer.addChild(g);
    g.cacheAsBitmap = true;
  }

  /** Sprite standing on its measured foot line, sized to `widthPx` on screen. */
  private propSprite(key: SpriteKey, widthPx = PROP_WIDTH_PX[key] ?? 32): PIXI.Sprite {
    const tex = this.textures.get(key) ?? PIXI.Texture.EMPTY;
    const sp = new PIXI.Sprite(tex);
    const { anchor } = MODULAR_ASSET_MANIFEST[key];
    sp.anchor.set(anchor.x, anchor.y);
    sp.scale.set(widthPx / Math.max(1, tex.width));
    return sp;
  }



  private buildStaticObstacles(map: WorldMap): void {
    for (const item of this.baseObstacles) {
      item.node.destroy({ children: true });
    }
    this.baseObstacles = [];
    const doorsByBuilding = new Map(
      (map.doors ?? []).map((door) => [door.buildingId, door]),
    );
    for (const obs of map.obstacles) {
      const node = createObstacleNode(this.textures, obs, doorsByBuilding.get(obs.id)?.state);
      let roofNode: PIXI.Graphics | undefined;
      let footprint: BuildingFootprint | undefined;
      if (obs.kind === 'ruin') {
        roofNode = createRoofNode(obs);
        node.addChild(roofNode);
        footprint = createBuildingFootprintFromObstacle(
          obs,
          doorsByBuilding.get(obs.id),
        );
      }
      this.entityLayer.addChild(node);
      if (obs.kind === 'ruin') node.cacheAsBitmap = true;
      this.baseObstacles.push({ node, roofNode, footprint, obstacle: obs });
    }
    this.exteriorDoorSignature = this.getExteriorDoorSignature(map);
  }

  private getExteriorDoorSignature(map: WorldMap): string {
    return (map.doors ?? []).map(({ id, state, locked }) => `${id}:${state}:${locked ? 1 : 0}`).join('|');
  }


  private syncInfiniteChunks(map: WorldMap): void {
    if (!map.activeChunks) return;
    const activeKeys = new Set(Object.keys(map.activeChunks));

    for (const [key, entry] of this.renderedChunks.entries()) {
      if (!activeKeys.has(key)) {
        entry.ground.destroy({ children: true });
        for (const p of entry.props) p.destroy({ children: true });
        for (const o of entry.obstacles) o.node.destroy({ children: true });
        this.renderedChunks.delete(key);
      }
    }

    // Spread chunk creation across frames (max 2/frame) to avoid GC spikes when crossing boundaries.
    let created = 0;
    for (const [key, chunk] of Object.entries(map.activeChunks)) {
      if (this.renderedChunks.has(key)) continue;
      if (created >= 2) break;
      this.renderedChunks.set(key, this.buildChunkEntry(map, chunk));
      created += 1;
    }
  }

  private buildChunkEntry(map: WorldMap, chunk: WorldChunk): ChunkRenderEntry {
    const size = map.chunkSize ?? 16;
    const startX = chunk.cx * size;
    const startY = chunk.cy * size;
    const halfW = ISO_TILE_WIDTH / 2;
    const halfH = ISO_TILE_HEIGHT / 2;
    const ground = new PIXI.Container();
    const poly = new PIXI.Graphics();
    ground.addChild(poly);

    for (let y = startY; y < startY + size; y += 1) {
      for (let x = startX; x < startX + size; x += 1) {
        if (x >= 0 && x < map.width && y >= 0 && y < map.height) continue;
        const tier = threatTierAt(map, x + 0.5, y + 0.5);
        const center = worldToScreen(x + 0.5, y + 0.5);
        paintProceduralAsphaltTile(poly, x, y, center, halfW, halfH, tier === 0);
      }
    }
    this.groundLayer.addChild(ground);
    ground.cacheAsBitmap = true;

    const props: PIXI.Container[] = [];
    const chunkTier = threatTierAt(map, startX + size / 2, startY + size / 2);
    for (const prop of chunk.props) {
      const node = createPropNode(this.textures, prop, chunkTier);
      this.entityLayer.addChild(node);
      props.push(node);
    }

    const obstacles: Array<{ node: PIXI.Container; obstacle: Obstacle }> = [];
    for (const obs of chunk.obstacles) {
      const node = createObstacleNode(this.textures, obs);
      if (obs.kind === 'ruin') {
        node.addChild(createRoofNode(obs));
      }
      this.entityLayer.addChild(node);
      obstacles.push({ node, obstacle: obs });
    }

    return { ground, props, obstacles };
  }

  private rebuildForInterior(state: WorldState): void {
    const interiorId = state.activeInterior?.id ?? null;
    if (interiorId === this.activeInteriorId) return;
    this.activeInteriorId = interiorId;

    for (const entry of this.renderedChunks.values()) {
      entry.ground.destroy({ children: true });
      for (const p of entry.props) p.destroy({ children: true });
      for (const o of entry.obstacles) o.node.destroy({ children: true });
    }
    this.renderedChunks.clear();

    for (const c of this.containerSprites.values()) c.destroy({ children: true });
    this.containerSprites.clear();
    for (const { sprite } of this.interiorPortalSprites.values()) {
      this.interiorPortalLayer.removeChild(sprite);
      sprite.destroy();
    }
    this.interiorPortalSprites.clear();

    if (state.activeInterior) {
      const interior = state.activeInterior;
      this.groundLayer.removeChildren();
      const g = new PIXI.Graphics();
      const tileLayer = new PIXI.Container();
      const halfW = ISO_TILE_WIDTH / 2;
      const halfH = ISO_TILE_HEIGHT / 2;
      const indoorTileKey: SpriteKey =
        interior.kind === 'bunker'
          ? 'bunker_floor_tile'
          : interior.kind === 'commercial'
            ? 'indoor_check_tile'
            : 'indoor_wood_tile';
      const indoorTex = this.textures.get(indoorTileKey) ?? this.textures.get('asphalt_tile');

      for (let y = 0; y < interior.height; y += 1) {
        for (let x = 0; x < interior.width; x += 1) {
          const center = worldToScreen(x + 0.5, y + 0.5);
          const isEdge =
            x === 0 || y === 0 || x === interior.width - 1 || y === interior.height - 1;
          const noise = (x * 37 + y * 17) % 5;
          const fill = isEdge ? 0x22262b : [0x16191e, 0x171a1f, 0x15181d, 0x181c21, 0x191d22][noise];
          g.lineStyle(0);
          g.beginFill(fill, 1);
          g.drawPolygon([
            center.x,
            center.y - halfH,
            center.x + halfW,
            center.y,
            center.x,
            center.y + halfH,
            center.x - halfW,
            center.y,
          ]);
          g.endFill();

          if (indoorTex) {
            const sp = new PIXI.Sprite(indoorTex);
            sp.anchor.set(0.5, 0.5);
            sp.position.set(center.x, center.y);
            sp.width = ISO_TILE_WIDTH;
            sp.height = ISO_TILE_HEIGHT;
            sp.tint = isEdge ? 0x94a3b8 : [0xffffff, 0xf1f5f9, 0xe2e8f0, 0xf8fafc, 0xe9eef3][noise];
            sp.alpha = 0.9;
            tileLayer.addChild(sp);
          }
        }
      }

      const exitScreen = worldToScreen(interior.exitDoor.x, interior.exitDoor.y);
      g.lineStyle(1.5, interior.exitLocked ? 0xe05252 : 0x67d49c, 0.85);
      g.beginFill(interior.exitLocked ? 0x3b1218 : 0x133326, 0.65);
      g.drawCircle(exitScreen.x, exitScreen.y, 13);
      g.endFill();

      this.groundLayer.addChild(g);
      this.groundLayer.addChild(tileLayer);

      for (const item of this.baseObstacles) item.node.destroy({ children: true });
      this.baseObstacles = [];
      for (const obs of interior.obstacles) {
        const node = createObstacleNode(this.textures, obs);
        this.entityLayer.addChild(node);
        this.baseObstacles.push({ node, obstacle: obs });
      }
    } else {
      this.buildGround(state.map);
      this.buildStaticObstacles(state.map);
    }
  }

  private bakeBloodDecal(worldPos: Vec2, radius: number, rng: () => number): void {
    const screen = worldToScreen(worldPos.x, worldPos.y);
    if (this.decalRenderTexture) {
      this.decalStamp.clear();
      this.decalStamp.beginFill(0x4a070d, 0.86);
      this.decalStamp.drawEllipse(
        screen.x + DECAL_ORIGIN_X,
        screen.y + DECAL_ORIGIN_Y,
        radius,
        radius * 0.55,
      );
      this.decalStamp.endFill();
      for (let i = 0; i < 4; i += 1) {
        const a = rng() * Math.PI * 2;
        const d = radius * (0.4 + rng() * 0.8);
        this.decalStamp.beginFill(0x2f0408, 0.78);
        this.decalStamp.drawEllipse(
          screen.x + DECAL_ORIGIN_X + Math.cos(a) * d,
          screen.y + DECAL_ORIGIN_Y + Math.sin(a) * d * 0.55,
          2 + rng() * 4,
          1.5 + rng() * 2.5,
        );
        this.decalStamp.endFill();
      }
      this.app.renderer.render(this.decalStamp, {
        renderTexture: this.decalRenderTexture,
        clear: false,
      });
    } else {
      this.fallbackDecalGraphics.beginFill(0x4a070d, 0.82);
      this.fallbackDecalGraphics.drawEllipse(screen.x, screen.y, radius, radius * 0.55);
      this.fallbackDecalGraphics.endFill();
    }
  }

  private bakeCorpseIntoDecal(worldPos: Vec2, variant: ZombieState['variant']): void {
    const screen = worldToScreen(worldPos.x, worldPos.y);
    const corpseTex = this.textures.get('corpse');
    if (this.decalRenderTexture && corpseTex) {
      const sp = new PIXI.Sprite(corpseTex);
      sp.anchor.set(0.5, 0.5);
      sp.position.set(screen.x + DECAL_ORIGIN_X, screen.y + DECAL_ORIGIN_Y);
      sp.scale.set(variant === 'titan' ? 1.05 : variant === 'brute' ? 0.88 : 0.72);
      sp.alpha = 0.85;
      this.app.renderer.render(sp, {
        renderTexture: this.decalRenderTexture,
        clear: false,
      });
      sp.destroy();
    }
  }

  public consumeEvents(events: GameEvent[], rng: () => number = Math.random): void {
    for (const ev of events) {
      if (ev.type === 'shot') {
        if (ev.weapon !== 'melee') this.localShotSequence += 1;
        const weaponShake = ev.shakePx ?? computeWeaponShakePx(ev.weapon);
        this.cameraShake =
          ev.weapon === 'heavy'
            ? Math.min(MAX_HEAVY_SHAKE_PX, Math.max(this.cameraShake, weaponShake))
            : Math.min(20, this.cameraShake + weaponShake);

        const kick = ev.recoilVector ?? computeRecoilVector(ev.angle, ev.weapon);
        this.recoilVector.x = clamp(this.recoilVector.x + kick.x, -16, 16);
        this.recoilVector.y = clamp(this.recoilVector.y + kick.y, -16, 16);

        if (ev.weapon !== 'melee') {
          this.muzzleFlashTimer = MUZZLE_FLASH_DURATION_SEC;
        }

        for (const t of ev.weapon === 'melee' ? [] : ev.traces) {
          if (this.traces.length >= MAX_TRACES) break;
          const from = worldToScreen(t.x1, t.y1);
          const to = worldToScreen(t.x2, t.y2);
          this.traces.push({
            x1: from.x,
            y1: from.y - 12,
            x2: to.x,
            y2: to.y - 10,
            headshot: t.headshot,
            crit: t.crit,
            ttl: t.headshot ? 0.14 : 0.08,
          });
        }
      } else if (ev.type === 'zombie_hit') {
        const seeds = goreBurstFor(
          {
            angle: ev.angle,
            force: ev.force,
            headshot: ev.headshot,
            lethal: ev.lethal,
            variant: ev.variant,
            weapon: ev.weapon,
            dismemberType: ev.dismemberType,
            severedPart: ev.severedPart,
          },
          rng,
        );
        const screen = worldToScreen(ev.x, ev.y);
        for (const s of seeds) {
          if (this.particles.length >= MAX_PARTICLES) break;
          this.particles.push({
            ...s,
            x: screen.x,
            y: screen.y,
            z: 10,
            age: 0,
            colorNum: hexStringToColorNum(s.color),
          });
        }
        // Only bake decals on lethal/headshot hits to avoid a render-texture stamp on every shot.
        if (ev.lethal || ev.headshot) {
          this.bakeBloodDecal(
            { x: ev.x, y: ev.y },
            decalRadiusFor(ev.force, ev.lethal ? 'organ' : 'blood'),
            rng,
          );
        }
        if (ev.lethal) {
          this.bakeCorpseIntoDecal({ x: ev.x, y: ev.y }, ev.variant);
        }
      } else if (ev.type === 'zombie_killed' && ev.dismemberType === 'EXPLOSIVE_GIB') {
        this.cameraShake = Math.min(24, this.cameraShake + 14);
        const screen = worldToScreen(ev.x, ev.y);
        this.callouts.push({
          x: screen.x,
          y: screen.y,
          z: 4,
          ttl: 0.35,
          color: 0xff6b35,
          radius: 48,
        });
        this.bakeBloodDecal({ x: ev.x, y: ev.y }, 24, rng);
      } else if (ev.type === 'player_hit') {
        this.damageFlash = Math.min(0.65, this.damageFlash + 0.35);
        this.cameraShake = Math.min(18, this.cameraShake + 6.5);
      }
    }
  }

  public render(
    state: WorldState,
    dt: number,
    remotePlayers: RemoteOutlandsPlayer[] = this.storedRemotePlayers,
  ): void {
    if (this.destroyed) return;
    // Re-sync the logical canvas dimensions every frame. ResizeObserver and
    // orientation events provide the fast path; this closes mobile browser
    // toolbar/rotation races before the camera transform is calculated.
    this.syncRendererSize();
    if (this.exteriorDoorSignature !== this.getExteriorDoorSignature(state.map)) {
      this.buildStaticObstacles(state.map);
    }
    this.rebuildForInterior(state);
    this.renderExteriorDoors(state);
    if (!state.activeInterior) {
      this.syncInfiniteChunks(state.map);
    }

    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);

    // 1. Project Zomboid Roof Culling (instant hide on entrance) & North/West Wall Cutaway
    const inInterior = Boolean(state.activeInterior);
    for (const item of this.baseObstacles) {
      if (item.footprint && item.roofNode) {
        stepBuildingOcclusion(item.footprint, state.player, dt, inInterior);
        if (inInterior || item.footprint.playerInside) {
          item.footprint.roofAlpha = 0;
        }
        item.roofNode.alpha = item.footprint.roofAlpha;
        item.roofNode.visible = item.footprint.roofAlpha > 0.01;
      }
      const isNorthWestCutaway =
        inInterior && isNorthOrWestInteriorWall(item.obstacle, state.activeInterior ?? undefined);
      const wallCutaway = isNorthWestCutaway
        ? NORTH_WEST_WALL_CUTAWAY_ALPHA
        : item.footprint?.playerInside
          ? item.footprint.frontWallAlpha
          : computeObstacleOcclusionAlpha(item.obstacle, state.player, inInterior);
      item.node.alpha = wallCutaway;
    }
    // Chunk obstacles keep a static alpha (recomputing per frame for every streamed obstacle is costly).

    // 2. Strict Raycast Room-by-Room Fog-of-War (unexplored rooms pitch black #000000)
    let visibleZombieIds: Set<string> | null = null;
    let indoorVisibilityPolygon: Vec2[] | null = null;
    this.indoorFogLayer.clear();
    this.syncInteriorPortalSprites(state);
    if (state.activeInterior) {
      const interior = state.activeInterior;
      const rooms = getInteriorRooms(interior.id);
      const portals = getInteriorPortals(interior.id);
      const vision = evaluateStrictIndoorFog(state.player, interior, state.zombies);
      visibleZombieIds = vision.visibleZombieIds;
      indoorVisibilityPolygon = vision.visibilityPolygonWorld;

      for (const portal of portals) {
        if (portal.kind === 'door') continue;
        const portalColor =
          portal.state === 'barricaded'
            ? 0xb45309
            : portal.state === 'open' || portal.state === 'smashed'
              ? 0x34d399
              : portal.kind === 'window'
                ? 0x38bdf8
                : 0x94a3b8;
        this.indoorFogLayer.lineStyle(1.5, portalColor, 0.85);
        this.indoorFogLayer.beginFill(
          portalColor,
          portal.state === 'open' || portal.state === 'smashed' ? 0.18 : 0.42,
        );
        const corners = [
          worldToScreen(portal.x - portal.width / 2, portal.y - portal.height / 2),
          worldToScreen(portal.x + portal.width / 2, portal.y - portal.height / 2),
          worldToScreen(portal.x + portal.width / 2, portal.y + portal.height / 2),
          worldToScreen(portal.x - portal.width / 2, portal.y + portal.height / 2),
        ];
        this.indoorFogLayer.drawPolygon(corners.flatMap(({ x, y }) => [Math.round(x), Math.round(y)]));
        this.indoorFogLayer.endFill();
      }

      for (const room of rooms) {
        const shadowAlpha = vision.roomFogAlpha.get(room.id) ?? 0;
        if (shadowAlpha <= 0.01) continue;
        const c1 = worldToScreen(room.x, room.y);
        const c2 = worldToScreen(room.x + room.width, room.y);
        const c3 = worldToScreen(room.x + room.width, room.y + room.height);
        const c4 = worldToScreen(room.x, room.y + room.height);
        this.indoorFogLayer.lineStyle(0);
        this.indoorFogLayer.beginFill(PITCH_BLACK_ROOM_FOG_COLOR, shadowAlpha);
        this.indoorFogLayer.drawPolygon([c1.x, c1.y, c2.x, c2.y, c3.x, c3.y, c4.x, c4.y]);
        this.indoorFogLayer.endFill();
      }
    }

    // 3. Player Paperdoll & 360-degree weapon tracking
    this.renderPlayerPaperdoll(state, dt);
    this.renderRemotePlayers(remotePlayers, dt);
    this.renderContainers(state);
    this.renderPickups(state.pickups);
    this.renderZombies(state.zombies, visibleZombieIds);
    this.stepFx(dt);

    // 4. Camera follow + linear recoil + shake
    this.cameraShake = Math.max(0, this.cameraShake - 28 * dt);
    this.recoilVector = stepLinearRecoil(this.recoilVector, dt);
    const shakeX = (Math.random() - 0.5) * this.cameraShake + this.recoilVector.x;
    const shakeY = (Math.random() - 0.5) * this.cameraShake + this.recoilVector.y;

    const viewport = this.app.renderer.screen;
    const cam = computeCameraTransform(
      state.player,
      viewport.width,
      viewport.height,
      { x: shakeX, y: shakeY },
      zoomForViewport(viewport.width, viewport.height),
    );
    this.worldRoot.scale.set(cam.zoom);
    this.worldRoot.position.set(cam.rootPosition.x, cam.rootPosition.y);
    const margin = 96;
    this.vpMinX = cam.worldMin.x - margin;
    this.vpMinY = cam.worldMin.y - margin;
    this.vpMaxX = cam.worldMax.x + margin;
    this.vpMaxY = cam.worldMax.y + margin;

    // 5. 2-Pass WebGL Darkness & ERASE Cutout Lighting Pipeline
    const playerScreen = cam.focusScreen;
    const aimScreen =
      this.lastScreenAim.x > 0 || this.lastScreenAim.y > 0
        ? this.lastScreenAim
        : {
            x:
              (playerScreen.x +
                (Math.cos(state.player.angle) - Math.sin(state.player.angle)) * 60) *
                cam.zoom +
              cam.rootPosition.x,
            y:
              (playerScreen.y +
                (Math.cos(state.player.angle) + Math.sin(state.player.angle)) * 30) *
                cam.zoom +
              cam.rootPosition.y,
          };

    const lightingFrame = computeLightingFrame(
      state,
      playerScreen,
      cam.rootPosition,
      aimScreen,
      this.app.renderer.width,
      this.app.renderer.height,
      this.muzzleFlashTimer,
      cam.zoom,
      indoorVisibilityPolygon,
    );
    const blend = Math.min(1, dt * 3.5);
    this.lightingMaskAlpha += (lightingFrame.maskAlpha - this.lightingMaskAlpha) * blend;
    lightingFrame.maskAlpha = this.lightingMaskAlpha;
    // Throttle the 2-pass lighting render to ~30fps to halve its GPU cost.
    this.lightingFrameCounter += 1;
    if (this.lightingFrameCounter % 2 === 0) {
      this.lightingPipeline.render(
        this.app.renderer,
        lightingFrame,
        this.app.renderer.width,
        this.app.renderer.height,
        this.damageFlash,
      );
    }

    this.renderScreenOverlays(state, dt);
  }

  private renderExteriorDoors(state: WorldState): void {
    this.exteriorDoorLayer.clear();
    if (state.activeInterior) return;
    for (const door of state.map.doors ?? []) {
      const color = door.state === 'barricaded'
        ? 0xb45309
        : door.state === 'open' || door.state === 'smashed'
          ? 0x34d399
          : door.locked
            ? 0xef4444
            : 0xcbd5e1;
      const corners = [
        worldToScreen(door.x - BUILDING_DOOR_WIDTH_WORLD / 2, door.y - BUILDING_DOOR_HEIGHT_WORLD / 2),
        worldToScreen(door.x + BUILDING_DOOR_WIDTH_WORLD / 2, door.y - BUILDING_DOOR_HEIGHT_WORLD / 2),
        worldToScreen(door.x + BUILDING_DOOR_WIDTH_WORLD / 2, door.y + BUILDING_DOOR_HEIGHT_WORLD / 2),
        worldToScreen(door.x - BUILDING_DOOR_WIDTH_WORLD / 2, door.y + BUILDING_DOOR_HEIGHT_WORLD / 2),
      ];
      this.exteriorDoorLayer.lineStyle(1.5, color, 0.9);
      this.exteriorDoorLayer.beginFill(color, door.state === 'open' || door.state === 'smashed' ? 0.12 : 0.32);
      this.exteriorDoorLayer.drawPolygon(corners.flatMap(({ x, y }) => [Math.round(x), Math.round(y)]));
      this.exteriorDoorLayer.endFill();
      this.exteriorDoorLayer.zIndex = worldToScreen(door.x, door.y).y + 20;
    }
  }

  private syncInteriorPortalSprites(state: WorldState): void {
    const portals = state.activeInterior
      ? getInteriorPortals(state.activeInterior.id).filter((portal) => portal.kind === 'door')
      : [];
    const activeIds = new Set(portals.map((portal) => portal.id));
    for (const [id, entry] of this.interiorPortalSprites) {
      if (activeIds.has(id)) continue;
      this.interiorPortalLayer.removeChild(entry.sprite);
      entry.sprite.destroy();
      this.interiorPortalSprites.delete(id);
    }

    for (const portal of portals) {
      const key: SpriteKey = portal.state === 'barricaded'
        ? 'door_barricaded'
        : portal.state === 'smashed'
          ? 'door_smashed'
          : portal.state === 'open' || portal.state === 'opening'
            ? 'door_open'
            : 'door_closed';
      let entry = this.interiorPortalSprites.get(portal.id);
      if (!entry || entry.key !== key) {
        if (entry) {
          this.interiorPortalLayer.removeChild(entry.sprite);
          entry.sprite.destroy();
        }
        const sprite = new PIXI.Sprite(this.textures.get(key) ?? PIXI.Texture.EMPTY);
        const anchor = MODULAR_ASSET_MANIFEST[key].anchor;
        sprite.anchor.set(anchor.x, anchor.y);
        sprite.width = 38;
        sprite.height = 40;
        sprite.zIndex = worldToScreen(portal.x, portal.y).y + 10;
        this.interiorPortalLayer.addChild(sprite);
        entry = { sprite, key };
        this.interiorPortalSprites.set(portal.id, entry);
      }
      const screen = worldToScreen(portal.x, portal.y);
      const texture = this.textures.get(key);
      if (texture && entry.sprite.texture !== texture) entry.sprite.texture = texture;
      entry.sprite.position.set(screen.x, screen.y);
      entry.sprite.zIndex = screen.y + 10;
    }
  }

  private renderPlayerPaperdoll(state: WorldState, dt: number): void {
    if (!this.playerPaperdoll) {
      this.playerPaperdoll = new PaperdollActor(this.textures as Map<string, PIXI.Texture>);
      this.entityLayer.addChild(this.playerPaperdoll.root);
    }
    const p = state.player;
    const reloadDuration = Math.max(
      0.2,
      p.weapons[p.activeWeapon].reloadSeconds
        * (1 - Math.min(0.55, Math.max(0, p.attributes.reloading - 25) * 0.008)),
    );
    const reloadProgress = p.reloadTimer > 0
      ? clamp(1 - p.reloadTimer / reloadDuration, 0, 1)
      : 0;
    const screen = worldToScreen(p.x, p.y);
    this.playerPaperdoll.root.position.set(screen.x, screen.y);
    this.playerPaperdoll.root.zIndex = screen.y + 5;

    this.playerPaperdoll.update(
      {
        aimAngleWorld: p.angle,
        velocity: { x: p.vx, y: p.vy },
        equippedWeaponId: p.activeWeapon,
        armorDurability: p.armorDurability,
        armorMaxDurability: p.armorMaxDurability || 100,
        armorName: p.armorName,
        alive: p.alive,
        sprinting: Math.hypot(p.vx, p.vy) > 5.0,
        firing: this.muzzleFlashTimer > 0,
        melee: p.activeWeapon === 'melee' && p.fireCooldown > 0,
        reloading: p.reloadTimer > 0,
        muzzleFlashTimer: this.muzzleFlashTimer,
        reloadTimer: p.reloadTimer,
        reloadProgress,
        shotSequence: this.localShotSequence,
        invulnerableTimer: p.invulnerableTimer,
        infected: p.infected,
      },
      dt,
    );
  }

  private renderRemotePlayers(remotePlayers: RemoteOutlandsPlayer[], dt: number): void {
    const activeIds = new Set(remotePlayers.map((rp) => rp.playerId));
    for (const [id, entry] of this.remoteActors.entries()) {
      if (!activeIds.has(id)) {
        entry.actor.destroy();
        entry.hp.destroy();
        this.remoteActors.delete(id);
      }
    }

    for (const rp of remotePlayers) {
      let entry = this.remoteActors.get(rp.playerId);
      if (!entry) {
        const actor = new PaperdollActor(this.textures as Map<string, PIXI.Texture>);
        const hp = new PIXI.Graphics();
        actor.root.addChild(hp);
        this.entityLayer.addChild(actor.root);
        entry = { actor, hp, lastShotSeq: rp.shotSeq ?? 0 };
        this.remoteActors.set(rp.playerId, entry);
      }

      const screen = worldToScreen(rp.x, rp.y);
      entry.actor.root.position.set(screen.x, screen.y);
      entry.actor.root.zIndex = screen.y + 5;

      const currentSeq = rp.shotSeq ?? 0;
      const isNewShot = currentSeq !== entry.lastShotSeq;
      if (isNewShot) {
        entry.lastShotSeq = currentSeq;
      }

      const peerWithMotion = rp as RemoteOutlandsPlayer & {
        vx?: number;
        vy?: number;
        reloading?: boolean;
      };
      const vx = peerWithMotion.vx ?? 0;
      const vy = peerWithMotion.vy ?? 0;
      const reloading = Boolean(peerWithMotion.reloading);

      entry.actor.update(
        {
          aimAngleWorld: rp.angle,
          velocity: { x: vx, y: vy },
          equippedWeaponId: rp.weapon ?? 'rifle',
          armorDurability: 50,
          armorMaxDurability: 100,
          alive: rp.health > 0,
          sprinting: Math.hypot(vx, vy) > 5.0,
          firing: Boolean(rp.firing || isNewShot),
          reloading,
          muzzleFlashTimer: rp.firing || isNewShot ? 0.03 : 0,
          reloadTimer: reloading ? 0.5 : 0,
          shotSequence: currentSeq,
          isRemotePeer: true,
        },
        dt,
      );

      entry.hp.clear();
      const ratio = clamp(rp.health / Math.max(1, rp.maxHealth), 0, 1);
      entry.hp.beginFill(0x090d12, 0.85);
      entry.hp.drawRect(-13, -34, 26, 3.5);
      entry.hp.endFill();
      entry.hp.beginFill(0x38bdf8, 0.95);
      entry.hp.drawRect(-12, -33, 24 * ratio, 2);
      entry.hp.endFill();
    }
  }

  private renderContainers(state: WorldState): void {
    const allContainers: WorldContainer[] = state.activeInterior
      ? state.activeInterior.containers
      : [
          ...state.map.containers,
          ...Object.values(state.map.activeChunks ?? {}).flatMap((ch) => ch.containers),
        ];
    const activeIds = new Set(allContainers.map((c) => c.id));

    for (const [id, node] of this.containerSprites.entries()) {
      if (!activeIds.has(id)) {
        node.destroy({ children: true });
        this.containerSprites.delete(id);
      }
    }

    for (const c of allContainers) {
      if (c.x < this.vpMinX || c.x > this.vpMaxX || c.y < this.vpMinY || c.y > this.vpMaxY) {
        const n = this.containerSprites.get(c.id);
        if (n) n.visible = false;
        continue;
      }
      let node = this.containerSprites.get(c.id);
      if (!node) {
        node = new PIXI.Container();
        const containerKey: SpriteKey =
          c.kind === 'military_cabinet'
            ? 'vault_safe'
            : c.kind === 'car_trunk'
              ? 'burned_car'
              : c.kind === 'dead_body'
                ? 'corpse'
                : c.label.toLowerCase().includes('counter')
                  ? 'kitchen_counter'
                  : c.label.toLowerCase().includes('cabinet')
                    ? 'filing_cabinet'
                    : c.kind === 'trash_bin'
                      ? 'dumpster'
                      : 'crate';
        node.addChild(propSprite(this.textures, containerKey));
        this.entityLayer.addChild(node);
        this.containerSprites.set(c.id, node);
      }
      const pos = worldToScreen(c.x, c.y);
      node.position.set(pos.x, pos.y);
      node.zIndex = pos.y + 3;
      node.visible = true;
      node.alpha = c.searched ? 0.42 : 1;
    }
  }

  private renderPickups(pickups: LootPickup[]): void {
    const activeIds = new Set(pickups.map((p) => p.id));
    for (const [id, node] of this.pickupSprites.entries()) {
      if (!activeIds.has(id)) {
        node.destroy({ children: true });
        this.pickupSprites.delete(id);
      }
    }

    for (const p of pickups) {
      if (p.x < this.vpMinX || p.x > this.vpMaxX || p.y < this.vpMinY || p.y > this.vpMaxY) {
        const n = this.pickupSprites.get(p.id);
        if (n) n.visible = false;
        continue;
      }
      let node = this.pickupSprites.get(p.id);
      if (!node) {
        node = new PIXI.Container();
        const g = new PIXI.Graphics();
        const color =
          p.kind === 'antiviral'
            ? 0xef4444
            : p.kind === 'food'
              ? 0xf59e0b
              : p.kind === 'armor_plate'
                ? 0x38bdf8
                : 0xa3e635;
        g.beginFill(0x000000, 0.45);
        g.drawEllipse(0, 2, 7, 3.5);
        g.endFill();
        g.lineStyle(1, 0x11161b, 0.9);
        g.beginFill(color, 0.92);
        g.drawRoundedRect(-5, -8, 10, 8, 2);
        g.endFill();
        node.addChild(g);
        this.entityLayer.addChild(node);
        this.pickupSprites.set(p.id, node);
      }
      const pos = worldToScreen(p.x, p.y);
      node.position.set(pos.x, pos.y);
      node.visible = true;
      node.zIndex = pos.y + 2;
    }
  }

  private renderZombies(
    zombies: ZombieState[],
    visibleZombieIds: Set<string> | null,
  ): void {
    const activeIds = new Set(zombies.map((z) => z.id));
    for (const [id, node] of this.zombieSprites.entries()) {
      if (!activeIds.has(id)) {
        node.destroy({ children: true });
        this.zombieSprites.delete(id);
      this.zombieLastHp.delete(id);
      }
    }

    for (const z of zombies) {
      // Viewport cull: skip off-screen zombies (keep their node for later).
      if (z.x < this.vpMinX || z.x > this.vpMaxX || z.y < this.vpMinY || z.y > this.vpMaxY) {
        const n = this.zombieSprites.get(z.id);
        if (n) n.visible = false;
        continue;
      }
      let node = this.zombieSprites.get(z.id);
      if (!node) {
        node = new PIXI.Container();
        const shadow = new PIXI.Graphics();
        shadow.beginFill(0x000000, 0.5);
        shadow.drawEllipse(0, 3, z.radius * 26, z.radius * 13);
        shadow.endFill();
        node.addChild(shadow);

        const sp = new PIXI.Sprite(PIXI.Texture.EMPTY);
        sp.name = 'sprite';
        const { anchor } = MODULAR_ASSET_MANIFEST[z.variant];
        sp.anchor.set(anchor.x, anchor.y);
        const baseScale =
          z.variant === 'titan'
            ? 1.05
            : z.variant === 'brute'
              ? 0.9
              : z.variant === 'hound'
                ? 0.68
                : 0.76;
        sp.scale.set(baseScale);
        node.addChild(sp);

        const hpBar = new PIXI.Graphics();
        hpBar.name = 'hp';
        // Feet sit on the node origin now, so lift the bar just above the head (64px art x scale).
        hpBar.y = 30 - Math.round(64 * baseScale * anchor.y);
        node.addChild(hpBar);

        this.entityLayer.addChild(node);
        this.zombieSprites.set(z.id, node);
      }

      const pos = worldToScreen(z.x, z.y);
      node.position.set(pos.x, pos.y);
      node.zIndex = pos.y + 5;
      node.visible = visibleZombieIds ? visibleZombieIds.has(z.id) : true;
      node.alpha = z.variant === 'wraith' ? (z.cloakAlpha ?? 0.35) : 1;

      const sp = node.getChildByName('sprite') as PIXI.Sprite | null;
      if (sp) {
        const sheet = this.textures.get(z.variant) ?? this.textures.get('walker');
        if (sheet) {
          const frame = resolveDirectionalSpriteFrame(sheet, z.angle, Math.floor(performance.now() / 140));
          sp.texture = frame.texture;
          const absScale = Math.abs(sp.scale.x);
          // 8-row sheets already face the octant; single-frame art mirrors instead.
          const mirror = frame.texture === sheet && Math.cos(z.angle) - Math.sin(z.angle) < -0.1;
          sp.scale.x = mirror ? -absScale : absScale;
        }
        sp.tint = z.hitFlash > 0 ? 0xffaaaa : 0xffffff;
      }

      const hpBar = node.getChildByName('hp') as PIXI.Graphics | null;
      if (hpBar && this.zombieLastHp.get(z.id) !== z.health) {
        this.zombieLastHp.set(z.id, z.health);
        hpBar.clear();
        if (z.health < z.maxHealth) {
          const ratio = clamp(z.health / Math.max(1, z.maxHealth), 0, 1);
          hpBar.beginFill(0x0b0e12, 0.85);
          hpBar.drawRect(-12, -32, 24, 3);
          hpBar.endFill();
          hpBar.beginFill(0xdc2626, 0.95);
          hpBar.drawRect(-11, -31, 22 * ratio, 1.8);
          hpBar.endFill();
        }
      }
    }
  }

  private stepFx(dt: number): void {
    this.fxLayer.clear();

    const nextTraces: ActiveTrace[] = [];
    for (const tr of this.traces) {
      tr.ttl -= dt;
      if (tr.ttl <= 0) continue;
      this.fxLayer.lineStyle(
        tr.headshot ? 2.2 : 1.4,
        tr.headshot ? 0xffe066 : 0xfde68a,
        clamp(tr.ttl * 9, 0.15, 0.92),
      );
      this.fxLayer.moveTo(tr.x1, tr.y1);
      this.fxLayer.lineTo(tr.x2, tr.y2);
      nextTraces.push(tr);
    }
    this.traces = nextTraces;

    const nextParticles: ActiveParticle[] = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.ttl) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
      p.vz -= p.gravity * dt;
      this.fxLayer.lineStyle(0);
      this.fxLayer.beginFill(p.colorNum, clamp(1 - p.age / p.ttl, 0.15, 0.95));
      this.fxLayer.drawCircle(p.x, p.y - p.z, p.size);
      this.fxLayer.endFill();
      nextParticles.push(p);
    }
    this.particles = nextParticles;

    const nextCallouts: FloatingCallout[] = [];
    for (const c of this.callouts) {
      c.ttl -= dt;
      if (c.ttl <= 0) continue;
      this.fxLayer.lineStyle(2, c.color, clamp(c.ttl * 2.5, 0.1, 0.85));
      this.fxLayer.drawCircle(c.x, c.y - c.z, c.radius * (1.1 - c.ttl));
      nextCallouts.push(c);
    }
    this.callouts = nextCallouts;

    // Ambient dust motes: cheap drift, wrapped to the viewport. Spawned lazily once.
    if (this.ambientParticles.length === 0 && this.vpMaxX > this.vpMinX) {
      const count = 48;
      for (let i = 0; i < count; i += 1) {
        this.ambientParticles.push({
          x: this.vpMinX + Math.random() * (this.vpMaxX - this.vpMinX),
          y: this.vpMinY + Math.random() * (this.vpMaxY - this.vpMinY),
          vx: (Math.random() - 0.5) * 1.6,
          vy: (Math.random() - 0.5) * 0.8,
          size: 0.6 + Math.random() * 1.2,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
    const w = this.vpMaxX - this.vpMinX;
    const h = this.vpMaxY - this.vpMinY;
    for (const p of this.ambientParticles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.phase += dt * 1.2;
      if (p.x < this.vpMinX) p.x += w;
      if (p.x > this.vpMaxX) p.x -= w;
      if (p.y < this.vpMinY) p.y += h;
      if (p.y > this.vpMaxY) p.y -= h;
      const a = 0.12 + 0.1 * Math.sin(p.phase);
      this.fxLayer.lineStyle(0);
      this.fxLayer.beginFill(0xd8e6f0, a);
      this.fxLayer.drawCircle(p.x, p.y, p.size);
      this.fxLayer.endFill();
    }
  }

  private renderScreenOverlays(state: WorldState, dt: number): void {
    this.damageFlash = Math.max(0, this.damageFlash - 1.6 * dt);
    this.screenFlash.clear();
    if (this.damageFlash > 0.01) {
      this.screenFlash.beginFill(0x880814, this.damageFlash * 0.42);
      this.screenFlash.drawRect(0, 0, this.app.renderer.width, this.app.renderer.height);
      this.screenFlash.endFill();
    }

    // Tactical Reticle Crosshair
    this.crosshairLayer.clear();
    if (this.lastScreenAim.x > 0 || this.lastScreenAim.y > 0) {
      const cx = this.lastScreenAim.x;
      const cy = this.lastScreenAim.y;
      const gap = 5 + state.player.reticleBloom * 85;
      this.crosshairLayer.lineStyle(1.5, 0xe2e8f0, 0.82);
      this.crosshairLayer.moveTo(cx - gap - 5, cy);
      this.crosshairLayer.lineTo(cx - gap, cy);
      this.crosshairLayer.moveTo(cx + gap, cy);
      this.crosshairLayer.lineTo(cx + gap + 5, cy);
      this.crosshairLayer.moveTo(cx, cy - gap - 5);
      this.crosshairLayer.lineTo(cx, cy - gap);
      this.crosshairLayer.moveTo(cx, cy + gap);
      this.crosshairLayer.lineTo(cx, cy + gap + 5);
    }
  }

  public getSpriteDebug(): PaperdollDebugInfo | null {
    return this.playerPaperdoll?.describe() ?? null;
  }

  public getZombieDebug(): Array<{ id: string; variant: string; visible: boolean; alpha: number; frame: string; texW: number; texH: number }> {
    const out: Array<{ id: string; variant: string; visible: boolean; alpha: number; frame: string; texW: number; texH: number }> = [];
    for (const [id, node] of this.zombieSprites.entries()) {
      const sp = node.getChildByName('sprite') as PIXI.Sprite | null;
      const tex = sp?.texture;
      out.push({
        id,
        variant: id,
        visible: node.visible,
        alpha: node.alpha,
        frame: tex ? `${tex.frame.x},${tex.frame.y} ${tex.frame.width}x${tex.frame.height}` : 'none',
        texW: tex?.baseTexture?.width ?? 0,
        texH: tex?.baseTexture?.height ?? 0,
      });
    }
    return out;
  }

  public destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.playerPaperdoll?.destroy();
    for (const entry of this.remoteActors.values()) {
      entry.actor.destroy();
    }
    this.lightingPipeline.destroy();
    this.decalRenderTexture?.destroy(true);
    this.app.destroy(true, { children: true });
  }
}
