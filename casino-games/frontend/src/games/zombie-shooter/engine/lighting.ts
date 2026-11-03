import * as PIXI from 'pixi.js';
import { ISO_TILE_HEIGHT, ISO_TILE_WIDTH, clamp, worldToScreen } from './isometric';
import type { Obstacle, StreetProp, Vec2, WorldState } from './types';

/**
 * 2-Pass WebGL Dynamic Lighting Pipeline (`/engine/lighting.ts`).
 *
 * Pass 1 (Base World): Rendered at full visibility with subtle dark ambient tint (`#121622`).
 * Pass 2 (Darkness Overlay Mask): Separate `darknessTexture` (`PIXI.RenderTexture`) filled with
 *   dark blue-black (`#050811`, `0.88` opacity).
 * Pass 3 (Light Cutout Pass): Every active light source (60° directional flashlight cone,
 *   street lamps, fire barrels, muzzle flash) is drawn onto the darkness layer using
 *   `PIXI.BLEND_MODES.ERASE` (with smooth radial & conical Canvas2D/WebGL alpha gradients)
 *   so lit regions cleanly reveal the pixel art world underneath without drawing solid
 *   yellow/white circles over the stage.
 */
export const AMBIENT_BASE_HEX = '#121622';
export const AMBIENT_BASE_COLOR = 0x121622;

export const DARKNESS_MASK_HEX = '#050811';
export const DARKNESS_MASK_COLOR = 0x050811;
// Outdoor night stays readable (props and ground keep their silhouettes); interiors stay pitch-black.
export const DARKNESS_MASK_ALPHA = 0.64;
/** Keep indoor silhouettes and floor readable beneath the player's local light. */
export const INTERIOR_DARKNESS_MASK_ALPHA = 0.4;
export const INTERIOR_UNEXPLORED_FOG_ALPHA = 0.56;
export const INTERIOR_EXPLORED_FOG_ALPHA = 0.38;

export const PITCH_BLACK_MASK_HEX = DARKNESS_MASK_HEX;
export const PITCH_BLACK_MASK_COLOR = DARKNESS_MASK_COLOR;
export const PITCH_BLACK_MASK_ALPHA = 0.88;

export const FLASHLIGHT_ARC_DEG = 60;
export const FLASHLIGHT_ARC_RAD = (FLASHLIGHT_ARC_DEG * Math.PI) / 180;
export const FLASHLIGHT_RANGE_PX = 280;
export const MUZZLE_FLASH_DURATION_SEC = 2 / 60; // 2-frame transient pulse at 60fps

export interface PointLightSource {
  id: string;
  screenX: number;
  screenY: number;
  radiusX: number;
  radiusY: number;
  color: number;
  alpha: number;
  flicker: number;
}

export interface ShadowQuad {
  obstacleId: string;
  points: number[];
}

export interface ConeGradientSlice {
  points: number[];
  eraseAlpha: number;
}

export interface LightingFrame {
  ambientBaseColor: number;
  maskColor: number;
  maskAlpha: number;
  flashlightOn: boolean;
  playerOrigin: Vec2;
  muzzleOrigin: Vec2;
  aimAngleScreen: number;
  coneRadiusPx: number;
  conePolygon: number[];
  coneGradientSlices: ConeGradientSlice[];
  pointLights: PointLightSource[];
  shadowQuads: ShadowQuad[];
  muzzlePulseActive: boolean;
  muzzlePulseColor: number;
  muzzlePulseAlpha: number;
  muzzlePulseRadiusPx: number;
  playerHaloScale: number;
  visibilityMaskPolygon: number[] | null;
}

/**
 * Computes a deterministic subtle flicker multiplier in `[0.88, 1.12]`.
 */
export function computeLightFlicker(time: number, id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const phase = (hash & 0xff) * 0.04;
  return (
    1 +
    Math.sin(time * 11.5 + phase) * 0.07 +
    Math.cos(time * 19.3 + phase * 1.7) * 0.05
  );
}

/**
 * Builds the 60-degree flashlight cone polygon in screen space (20 radial arc steps).
 */
export function buildFlashlightConePolygon(
  originX: number,
  originY: number,
  aimAngleScreen: number,
  rangePx = FLASHLIGHT_RANGE_PX,
  halfConeRad = FLASHLIGHT_ARC_RAD * 0.5,
): number[] {
  const steps = 20;
  const points: number[] = [originX, originY];
  for (let i = 0; i <= steps; i += 1) {
    const a = aimAngleScreen - halfConeRad + (halfConeRad * 2 * i) / steps;
    points.push(
      originX + Math.cos(a) * rangePx,
      originY + Math.sin(a) * rangePx * 0.68,
    );
  }
  return points;
}

/**
 * Builds smooth concentric gradient wedges for the 60-degree flashlight cone
 * used as fallback geometry when offscreen Canvas2D gradients are unavailable.
 */
export function buildFlashlightGradientSlices(
  originX: number,
  originY: number,
  aimAngleScreen: number,
  rangePx = FLASHLIGHT_RANGE_PX,
  halfConeRad = FLASHLIGHT_ARC_RAD * 0.5,
): ConeGradientSlice[] {
  const bands = [
    { reach: 1.0, arcScale: 1.0, eraseAlpha: 0.22 },
    { reach: 0.84, arcScale: 0.92, eraseAlpha: 0.28 },
    { reach: 0.66, arcScale: 0.84, eraseAlpha: 0.36 },
    { reach: 0.46, arcScale: 0.74, eraseAlpha: 0.48 },
    { reach: 0.26, arcScale: 0.62, eraseAlpha: 0.65 },
  ];

  return bands.map((band) => ({
    points: buildFlashlightConePolygon(
      originX,
      originY,
      aimAngleScreen,
      rangePx * band.reach,
      halfConeRad * band.arcScale,
    ),
    eraseAlpha: band.eraseAlpha,
  }));
}

/**
 * Projects a dynamic shadow quad behind an obstacle relative to the light origin.
 */
export function projectObstacleShadow(
  originX: number,
  originY: number,
  obstacleScreenX: number,
  obstacleScreenY: number,
  footprintRadiusPx: number,
  shadowLengthPx = 180,
): number[] | null {
  const dx = obstacleScreenX - originX;
  const dy = obstacleScreenY - originY;
  const dist = Math.hypot(dx, dy);
  if (dist < 12 || dist > FLASHLIGHT_RANGE_PX * 1.35) return null;

  const ux = dx / dist;
  const uy = dy / dist;
  const px = -uy;
  const py = ux;

  const nearLeftX = obstacleScreenX + px * footprintRadiusPx;
  const nearLeftY = obstacleScreenY + py * footprintRadiusPx * 0.6;
  const nearRightX = obstacleScreenX - px * footprintRadiusPx;
  const nearRightY = obstacleScreenY - py * footprintRadiusPx * 0.6;

  const farSpread = footprintRadiusPx * 2.15;
  const farCenterX = obstacleScreenX + ux * shadowLengthPx;
  const farCenterY = obstacleScreenY + uy * shadowLengthPx * 0.65;

  const farLeftX = farCenterX + px * farSpread;
  const farLeftY = farCenterY + py * farSpread * 0.6;
  const farRightX = farCenterX - px * farSpread;
  const farRightY = farCenterY - py * farSpread * 0.6;

  return [
    nearLeftX,
    nearLeftY,
    nearRightX,
    nearRightY,
    farRightX,
    farRightY,
    farLeftX,
    farLeftY,
  ];
}

/** True when no other solid obstacle occludes the light-to-caster segment. */
export function hasUnoccludedLightPath(
  origin: Vec2,
  target: Vec2,
  obstacles: Obstacle[],
  targetObstacleId: string,
): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.01) return true;
  const steps = Math.ceil(distance / 0.2);
  for (let i = 1; i < steps; i += 1) {
    const x = origin.x + (dx * i) / steps;
    const y = origin.y + (dy * i) / steps;
    if (obstacles.some((obstacle) =>
      obstacle.id !== targetObstacleId &&
      x >= obstacle.x && x <= obstacle.x + obstacle.width &&
      y >= obstacle.y && y <= obstacle.y + obstacle.height,
    )) return false;
  }
  return true;
}

/**
 * Generates a smooth radial gradient `PIXI.Texture` (100% opaque white at center -> 0% alpha at edge)
 * for `PIXI.BLEND_MODES.ERASE` point-light cutouts.
 */
function createRadialCutoutTexture(size = 256): PIXI.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.28, 'rgba(255, 255, 255, 0.88)');
  grad.addColorStop(0.62, 'rgba(255, 255, 255, 0.38)');
  grad.addColorStop(0.86, 'rgba(255, 255, 255, 0.10)');
  grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return PIXI.Texture.from(canvas);
}

/**
 * Generates a smooth 60-degree directional flashlight cone `PIXI.Texture`
 * with both radial distance falloff and soft angular edge feathering.
 */
function createFlashlightConeTexture(width = 320, height = 260): PIXI.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const originX = 8;
  const originY = height * 0.5;
  const maxR = width - originX;
  const halfAngle = FLASHLIGHT_ARC_RAD * 0.5;

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y += 1) {
    const dy = y - originY;
    for (let x = 0; x < width; x += 1) {
      const dx = x - originX;
      const dist = Math.hypot(dx, dy);
      if (dist <= 0.001 || dist > maxR) continue;

      const angle = Math.abs(Math.atan2(dy, dx));
      if (angle > halfAngle) continue;

      const radialNorm = dist / maxR;
      const radialFalloff = Math.pow(clamp(1 - radialNorm, 0, 1), 1.35);

      const edgeRatio = angle / halfAngle;
      const angularFalloff =
        edgeRatio < 0.65
          ? 1.0
          : Math.pow(clamp((1 - edgeRatio) / 0.35, 0, 1), 1.6);

      const alpha = Math.round(clamp(radialFalloff * angularFalloff, 0, 1) * 255);
      if (alpha <= 0) continue;

      const idx = (y * width + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return PIXI.Texture.from(canvas);
}

/**
 * Computes the complete 2-pass lighting frame for the current viewport and world state.
 */
export function computeLightingFrame(
  state: WorldState,
  playerWorldScreen: Vec2,
  worldRootPosition: Vec2,
  aimScreen: Vec2,
  screenWidth: number,
  screenHeight: number,
  muzzleFlashTimer: number,
  cameraZoom = 1,
  visibilityPolygonWorld: Vec2[] | null = null,
): LightingFrame {
  const isInterior = Boolean(state.activeInterior);
  const maskAlpha = isInterior ? INTERIOR_DARKNESS_MASK_ALPHA : DARKNESS_MASK_ALPHA;

  const px = playerWorldScreen.x * cameraZoom + worldRootPosition.x;
  const py = (playerWorldScreen.y - 10) * cameraZoom + worldRootPosition.y;
  const shadowOriginY = playerWorldScreen.y * cameraZoom + worldRootPosition.y;
  const aimAngleScreen = Math.atan2(aimScreen.y - py, aimScreen.x - px);

  const muzzleDistancePx = 18 * cameraZoom;
  const muzzleOrigin: Vec2 = {
    x: px + Math.cos(aimAngleScreen) * muzzleDistancePx,
    y: py + Math.sin(aimAngleScreen) * muzzleDistancePx * 0.75,
  };

  const muzzlePulseActive = muzzleFlashTimer > 0;
  const coneRadiusPx =
    (FLASHLIGHT_RANGE_PX + (muzzlePulseActive ? 56 : 0)) *
    (cameraZoom > 1 ? 1.15 : 1);

  const conePolygon = state.player.flashlightOn
    ? buildFlashlightConePolygon(px, py, aimAngleScreen, coneRadiusPx)
    : [];

  const coneGradientSlices = state.player.flashlightOn
    ? buildFlashlightGradientSlices(px, py, aimAngleScreen, coneRadiusPx)
    : [];

  const pointLights: PointLightSource[] = [];

  if (!isInterior) {
    for (const outpost of state.map.outposts) {
      const opScreen = worldToScreen(outpost.x, outpost.y);
      const sx = opScreen.x * cameraZoom + worldRootPosition.x;
      const sy = opScreen.y * cameraZoom + worldRootPosition.y;
      if (
        sx < -320 ||
        sy < -320 ||
        sx > screenWidth + 320 ||
        sy > screenHeight + 320
      ) {
        continue;
      }
      const flicker = computeLightFlicker(state.time, `outpost_${outpost.id}`);
      pointLights.push({
        id: `outpost_${outpost.id}`,
        screenX: sx,
        screenY: sy,
        radiusX: 175 * flicker * cameraZoom,
        radiusY: 108 * flicker * cameraZoom,
        color: 0xffd28a,
        alpha: 0.92,
        flicker,
      });
    }

    const activeChunks = state.map.activeChunks ?? {};
    let lightCount = 0;
    for (const chunk of Object.values(activeChunks)) {
      for (const prop of chunk.props) {
        if (prop.kind !== 'barrel_fire' && prop.kind !== 'streetlight') continue;
        if (lightCount >= 8) continue;
        const pScreen = worldToScreen(prop.x, prop.y);
        const sx = pScreen.x * cameraZoom + worldRootPosition.x;
        const sy = (pScreen.y - 8) * cameraZoom + worldRootPosition.y;
        if (
          sx < -220 ||
          sy < -220 ||
          sx > screenWidth + 220 ||
          sy > screenHeight + 220
        ) {
          continue;
        }
        const flicker = computeLightFlicker(state.time, prop.id);
        const isBarrel = prop.kind === 'barrel_fire';
        pointLights.push({
          id: prop.id,
          screenX: sx,
          screenY: sy,
          radiusX: (isBarrel ? 102 : 136) * flicker * cameraZoom,
          radiusY: (isBarrel ? 64 : 84) * flicker * cameraZoom,
          color: isBarrel ? 0xff7b1a : 0xffe099,
          alpha: isBarrel ? 0.94 : 0.88,
          flicker,
        });
        lightCount += 1;
      }
    }
  } else if (state.activeInterior) {
    const exteriorDoor = state.map.doors?.find(({ id }) => id === state.activeInterior?.doorId);
    const doorwayOpen = exteriorDoor?.state === 'open' || exteriorDoor?.state === 'smashed';
    const exitScreen = worldToScreen(
      state.activeInterior.exitDoor.x,
      state.activeInterior.exitDoor.y,
    );
    const flicker = computeLightFlicker(state.time, state.activeInterior.id);
    pointLights.push({
      id: `exit_${state.activeInterior.id}`,
      screenX: exitScreen.x * cameraZoom + worldRootPosition.x,
      screenY: exitScreen.y * cameraZoom + worldRootPosition.y,
      radiusX: (doorwayOpen ? 104 : 52) * flicker * cameraZoom,
      radiusY: (doorwayOpen ? 66 : 34) * flicker * cameraZoom,
      color: state.activeInterior.exitLocked ? 0xff3b3b : 0xffd166,
      alpha: doorwayOpen ? 0.88 : 0.38,
      flicker,
    });
  }

  const shadowQuads: ShadowQuad[] = [];
  const activeObstacles: Obstacle[] = state.activeInterior
    ? state.activeInterior.obstacles
    : [...state.map.obstacles];
  if (!state.activeInterior && state.map.activeChunks) {
    for (const chunk of Object.values(state.map.activeChunks)) {
      for (const obs of chunk.obstacles) {
        activeObstacles.push(obs);
      }
    }
  }

  if (state.player.flashlightOn) {
    // Only geometry intersecting the flashlight's local radius can cast on a
    // nearby target. Restrict both casters and occluders before the per-target
    // ray tests; otherwise the whole streamed city was searched for each ray.
    const nearbyObstacles = activeObstacles.filter((obs) => {
      const nearestX = clamp(state.player.x, obs.x, obs.x + obs.width);
      const nearestY = clamp(state.player.y, obs.y, obs.y + obs.height);
      return Math.hypot(nearestX - state.player.x, nearestY - state.player.y) <= 9.5;
    });
    for (const obs of nearbyObstacles) {
      const cx = obs.x + obs.width * 0.5;
      const cy = obs.y + obs.height * 0.5;
      if (Math.hypot(cx - state.player.x, cy - state.player.y) > 9.5) continue;
      if (!hasUnoccludedLightPath(state.player, { x: cx, y: cy }, nearbyObstacles, obs.id)) continue;
      const obsScreen = worldToScreen(cx, cy);
      const sx = obsScreen.x * cameraZoom + worldRootPosition.x;
      const sy = (obsScreen.y - 10) * cameraZoom + worldRootPosition.y;
      const quad = projectObstacleShadow(
        px,
        shadowOriginY,
        sx,
        sy,
        16 * cameraZoom,
        150 * cameraZoom,
      );
      if (quad) {
        shadowQuads.push({ obstacleId: obs.id, points: quad });
      }
    }
  }

  return {
    ambientBaseColor: AMBIENT_BASE_COLOR,
    maskColor: DARKNESS_MASK_COLOR,
    maskAlpha,
    flashlightOn: state.player.flashlightOn,
    playerOrigin: { x: px, y: py },
    muzzleOrigin,
    aimAngleScreen,
    coneRadiusPx,
    conePolygon,
    coneGradientSlices,
    pointLights,
    shadowQuads,
    muzzlePulseActive,
    muzzlePulseColor: 0xffffff,
    muzzlePulseAlpha: 0.96,
    muzzlePulseRadiusPx: 148 * cameraZoom,
    playerHaloScale: isInterior ? 1.4 : 1,
    visibilityMaskPolygon: isInterior && visibilityPolygonWorld
      ? visibilityPolygonWorld.flatMap((point) => [
          point.x * (ISO_TILE_WIDTH / 2) * cameraZoom + worldRootPosition.x,
          (point.x + point.y) * (ISO_TILE_HEIGHT / 2) * cameraZoom + worldRootPosition.y,
        ])
      : null,
  };
}

/**
 * 2-Pass WebGL Darkness & Cutout Pipeline:
 * - Renders `#050811` (`0.88` alpha) darkness into `darknessTexture` (`PIXI.RenderTexture`).
 * - Carves smooth radial and 60° conical cutouts out of `darknessTexture` using
 *   `PIXI.BLEND_MODES.ERASE` gradient sprites (with zero opaque/translucent color circles
 *   drawn over the stage).
 */
export class TwoPassLightingPipeline {
  public readonly container = new PIXI.Container();
  private darknessTexture: PIXI.RenderTexture | null = null;
  private darknessSprite: PIXI.Sprite | null = null;
  private pass1Darkness = new PIXI.Graphics();
  private pass2CutoutContainer = new PIXI.Container();
  private fallbackCutoutGraphics = new PIXI.Graphics();
  private damageOverlay = new PIXI.Graphics();
  private visibilityMask = new PIXI.Graphics();

  private radialGradientTex: PIXI.Texture | null = null;
  private coneGradientTex: PIXI.Texture | null = null;
  private playerHaloSprite: PIXI.Sprite | null = null;
  private flashlightConeSprite: PIXI.Sprite | null = null;
  private muzzleFlashSprite: PIXI.Sprite | null = null;
  private pointLightPool: PIXI.Sprite[] = [];

  constructor() {
    this.fallbackCutoutGraphics.blendMode = PIXI.BLEND_MODES.ERASE;
    this.pass1Darkness.scale.set(0.5);
    this.pass2CutoutContainer.scale.set(0.5);
  }

  init(width: number, height: number): void {
    this.radialGradientTex = createRadialCutoutTexture(256);
    this.coneGradientTex = createFlashlightConeTexture(320, 260);

    if (this.radialGradientTex) {
      this.playerHaloSprite = new PIXI.Sprite(this.radialGradientTex);
      this.playerHaloSprite.anchor.set(0.5, 0.5);
      this.playerHaloSprite.blendMode = PIXI.BLEND_MODES.ERASE;

      this.muzzleFlashSprite = new PIXI.Sprite(this.radialGradientTex);
      this.muzzleFlashSprite.anchor.set(0.5, 0.5);
      this.muzzleFlashSprite.blendMode = PIXI.BLEND_MODES.ERASE;
    }

    if (this.coneGradientTex) {
      this.flashlightConeSprite = new PIXI.Sprite(this.coneGradientTex);
      this.flashlightConeSprite.anchor.set(8 / 320, 0.5);
      this.flashlightConeSprite.blendMode = PIXI.BLEND_MODES.ERASE;
    }

    this.resize(width, height);
    this.container.addChild(this.damageOverlay);
  }

  resize(width: number, height: number): void {
    const safeW = Math.max(160, Math.floor(width / 2));
    const safeH = Math.max(120, Math.floor(height / 2));
    if (this.darknessTexture) {
      this.darknessTexture.resize(safeW, safeH);
    } else {
      this.darknessTexture = PIXI.RenderTexture.create({
        width: safeW,
        height: safeH,
        scaleMode: PIXI.SCALE_MODES.NEAREST,
      });
      this.darknessSprite = new PIXI.Sprite(this.darknessTexture);
      this.darknessSprite.scale.set(2);
      this.container.addChildAt(this.darknessSprite, 0);
    }
  }

  private acquirePointLightSprite(index: number): PIXI.Sprite | null {
    if (!this.radialGradientTex) return null;
    while (this.pointLightPool.length <= index) {
      const sp = new PIXI.Sprite(this.radialGradientTex);
      sp.anchor.set(0.5, 0.5);
      sp.blendMode = PIXI.BLEND_MODES.ERASE;
      this.pointLightPool.push(sp);
    }
    return this.pointLightPool[index];
  }

  render(
    renderer: PIXI.IRenderer,
    frame: LightingFrame,
    screenWidth: number,
    screenHeight: number,
    damageFlash = 0,
  ): void {
    if (!this.darknessTexture) {
      this.resize(screenWidth, screenHeight);
    }
    if (!this.darknessTexture) return;

    // PASS 1: Global Darkness Overlay (#050811, 0.88 opacity)
    this.pass1Darkness.clear();
    this.pass1Darkness.lineStyle(0);
    this.pass1Darkness.beginFill(frame.maskColor, frame.maskAlpha);
    this.pass1Darkness.drawRect(0, 0, screenWidth, screenHeight);
    this.pass1Darkness.endFill();

    for (const shadow of frame.shadowQuads) {
      this.pass1Darkness.beginFill(0x020409, 0.35);
      this.pass1Darkness.drawPolygon(shadow.points);
      this.pass1Darkness.endFill();
    }

    renderer.render(this.pass1Darkness, {
      renderTexture: this.darknessTexture,
      clear: true,
    });

    // PASS 2: ERASE Cutout Pass on `darknessTexture` (reveals world underneath)
    this.pass2CutoutContainer.removeChildren();
    if (frame.visibilityMaskPolygon?.length) {
      this.visibilityMask.clear();
      this.visibilityMask.beginFill(0xffffff);
      this.visibilityMask.drawPolygon(frame.visibilityMaskPolygon);
      this.visibilityMask.endFill();
      this.visibilityMask.renderable = false;
      this.pass2CutoutContainer.addChild(this.visibilityMask);
      this.pass2CutoutContainer.mask = this.visibilityMask;
    } else {
      this.pass2CutoutContainer.mask = null;
    }

    if (this.radialGradientTex && this.coneGradientTex) {
      // 1. Soft close-range survivor visibility halo
      if (this.playerHaloSprite) {
        this.playerHaloSprite.position.set(frame.playerOrigin.x, frame.playerOrigin.y);
        this.playerHaloSprite.width = 150 * frame.playerHaloScale;
        this.playerHaloSprite.height = 104 * frame.playerHaloScale;
        this.playerHaloSprite.alpha = 0.92;
        this.pass2CutoutContainer.addChild(this.playerHaloSprite);
      }

      // 2. Directional 60-degree flashlight cone with soft gradient falloff
      if (frame.flashlightOn && this.flashlightConeSprite) {
        this.flashlightConeSprite.position.set(frame.playerOrigin.x, frame.playerOrigin.y);
        this.flashlightConeSprite.rotation = frame.aimAngleScreen;
        const scale = frame.coneRadiusPx / 312;
        this.flashlightConeSprite.scale.set(scale, scale * 0.88);
        this.flashlightConeSprite.alpha = 1.0;
        this.pass2CutoutContainer.addChild(this.flashlightConeSprite);
      }

      // 3. Street Lamps & Fire Barrels smooth radial cutouts
      frame.pointLights.forEach((light, idx) => {
        const sp = this.acquirePointLightSprite(idx);
        if (!sp) return;
        sp.position.set(light.screenX, light.screenY);
        sp.width = light.radiusX * 2.2;
        sp.height = light.radiusY * 2.2;
        sp.alpha = clamp(light.alpha, 0, 1);
        this.pass2CutoutContainer.addChild(sp);
      });

      // 4. Transient 2-Frame Muzzle Flash cutout
      if (frame.muzzlePulseActive && this.muzzleFlashSprite) {
        this.muzzleFlashSprite.position.set(frame.muzzleOrigin.x, frame.muzzleOrigin.y);
        this.muzzleFlashSprite.width = frame.muzzlePulseRadiusPx * 2.1;
        this.muzzleFlashSprite.height = frame.muzzlePulseRadiusPx * 1.45;
        this.muzzleFlashSprite.alpha = frame.muzzlePulseAlpha;
        this.pass2CutoutContainer.addChild(this.muzzleFlashSprite);
      }

      renderer.render(this.pass2CutoutContainer, {
        renderTexture: this.darknessTexture,
        clear: false,
      });
    } else {
      // Headless / non-DOM test fallback using ERASE Graphics slices
      this.fallbackCutoutGraphics.clear();
      for (const slice of frame.coneGradientSlices) {
        this.fallbackCutoutGraphics.beginFill(0xffffff, slice.eraseAlpha);
        this.fallbackCutoutGraphics.drawPolygon(slice.points);
        this.fallbackCutoutGraphics.endFill();
      }
      for (const light of frame.pointLights) {
        this.fallbackCutoutGraphics.beginFill(0xffffff, clamp(light.alpha, 0, 1));
        this.fallbackCutoutGraphics.drawEllipse(
          light.screenX,
          light.screenY,
          light.radiusX,
          light.radiusY,
        );
        this.fallbackCutoutGraphics.endFill();
      }
      renderer.render(this.fallbackCutoutGraphics, {
        renderTexture: this.darknessTexture,
        clear: false,
      });
    }

    // Subtle blood vignette only when taking hull damage
    this.damageOverlay.clear();
    if (damageFlash > 0.01) {
      this.damageOverlay.beginFill(0x7f1d1d, clamp(damageFlash * 0.45, 0, 0.35));
      this.damageOverlay.drawRect(0, 0, screenWidth, screenHeight);
      this.damageOverlay.endFill();
    }
  }

  destroy(): void {
    if (this.darknessTexture) {
      this.darknessTexture.destroy(true);
      this.darknessTexture = null;
    }
    this.radialGradientTex?.destroy(true);
    this.coneGradientTex?.destroy(true);
    this.container.destroy({ children: true });
  }
}

export type { StreetProp };
