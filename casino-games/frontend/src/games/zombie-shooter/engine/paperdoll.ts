import * as PIXI from 'pixi.js';
import {
  CharacterAnimationStateMachine,
  survivorSheetForState,
  type CharacterAnimState,
  type CharacterAnimationPose,
  type DirectionOctant,
} from './animation';
import {
  MODULAR_ASSET_MANIFEST,
  createFallbackPlaceholderTexture,
  resolveDirectionalSpriteFrame,
  type SpriteKey,
} from './assets';
import type { Vec2, WeaponId } from './types';

/**
 * Modular Paperdoll & Equipped Gear Renderer (`/engine/paperdoll.ts`).
 *
 * Composites each survivor (local player or remote multiplayer peer) from 3 synchronized layers:
 * 1. Base Body Layer: 8-directional idle/walk/run sprite frames (`survivor.png`).
 * 2. Armor Overlay Layer: Chestplate / Kevlar / Exo-Ceramic vest overlay corresponding to equipped armor.
 * 3. Equipped Weapon Layer: Dynamically attaches & renders the equipped weapon (`M4 Carbine`, `Shotgun`,
 *    `Machete`, `Revolver`, `SMG`, `Sniper`, `Minigun`) locked to the character's 8-directional hand offset
 *    and rotated smoothly to match the 360-degree mouse aiming angle.
 */
export interface WeaponVisualProfile {
  weaponId: WeaponId;
  displayName: string;
  spriteKey:
    | 'weapon_machete'
    | 'weapon_pistol'
    | 'weapon_shotgun'
    | 'weapon_smg'
    | 'weapon_rifle'
    | 'weapon_sniper'
    | 'weapon_heavy'
    | null;
  barrelLengthPx: number;
  stockLengthPx: number;
  thicknessPx: number;
  bodyColor: number;
  accentColor: number;
  muzzleOffsetPx: number;
  /** Static art tilt correction. The shotgun/machete pixels are drawn at -45°. */
  restRotationRad?: number;
}

export const WEAPON_VISUAL_PROFILES: Record<WeaponId, WeaponVisualProfile> = {
  melee: {
    weaponId: 'melee',
    displayName: 'Tactical Machete',
    spriteKey: 'weapon_machete',
    barrelLengthPx: 14,
    stockLengthPx: 3,
    thicknessPx: 2.5,
    bodyColor: 0xd6e1e8,
    accentColor: 0x5c4033,
    muzzleOffsetPx: 14,
    restRotationRad: Math.PI / 4,
  },
  pistol: {
    weaponId: 'pistol',
    displayName: '.38 Service Revolver',
    spriteKey: 'weapon_pistol',
    barrelLengthPx: 12,
    stockLengthPx: 3,
    thicknessPx: 2.6,
    bodyColor: 0x8d99a6,
    accentColor: 0x3b2f26,
    muzzleOffsetPx: 14,
  },
  shotgun: {
    weaponId: 'shotgun',
    displayName: '12G Pump Shotgun',
    spriteKey: 'weapon_shotgun',
    barrelLengthPx: 18,
    stockLengthPx: 6,
    thicknessPx: 3.4,
    bodyColor: 0x4b5259,
    accentColor: 0x8f5b34,
    muzzleOffsetPx: 20,
    restRotationRad: Math.PI / 4,
  },
  smg: {
    weaponId: 'smg',
    displayName: 'Tactical SMG',
    spriteKey: 'weapon_smg',
    barrelLengthPx: 14,
    stockLengthPx: 5,
    thicknessPx: 3.0,
    bodyColor: 0x343d46,
    accentColor: 0x65737e,
    muzzleOffsetPx: 16,
  },
  rifle: {
    weaponId: 'rifle',
    displayName: 'M4 Carbine',
    spriteKey: 'weapon_rifle',
    barrelLengthPx: 19,
    stockLengthPx: 6,
    thicknessPx: 3.2,
    bodyColor: 0x2f3840,
    accentColor: 0x6f7f8c,
    muzzleOffsetPx: 21,
  },
  sniper: {
    weaponId: 'sniper',
    displayName: '.308 Bolt Marksman',
    spriteKey: 'weapon_sniper',
    barrelLengthPx: 24,
    stockLengthPx: 7,
    thicknessPx: 3.0,
    bodyColor: 0x3b483e,
    accentColor: 0x8b6b43,
    muzzleOffsetPx: 25,
  },
  heavy: {
    weaponId: 'heavy',
    displayName: 'Vulcan Rotary Minigun',
    spriteKey: 'weapon_heavy',
    barrelLengthPx: 22,
    stockLengthPx: 8,
    thicknessPx: 5.2,
    bodyColor: 0x283038,
    accentColor: 0xd4a349,
    muzzleOffsetPx: 24,
  },
};

/**
 * 8-directional hand anchor offsets in screen pixels relative to the character origin `(0, 0)`.
 */
export const OCTANT_HAND_OFFSETS: Record<DirectionOctant, Vec2> = {
  0: { x: 5, y: -18 },  // East / Down-Right
  1: { x: 2, y: -16 },  // South
  2: { x: -4, y: -17 }, // South-West
  3: { x: -6, y: -19 }, // West / Up-Left
  4: { x: -4, y: -21 }, // North-West
  5: { x: 0, y: -22 },  // North
  6: { x: 4, y: -21 },  // North-East
  7: { x: 6, y: -19 },  // South-East
};

export interface PaperdollRenderInput {
  aimAngleWorld: number;
  velocity: Vec2;
  equippedWeaponId: WeaponId;
  armorDurability: number;
  armorMaxDurability: number;
  armorName?: string;
  headgear?: string | null;
  backpack?: string | null;
  alive: boolean;
  sprinting: boolean;
  firing: boolean;
  reloading: boolean;
  melee?: boolean;
  muzzleFlashTimer: number;
  reloadTimer: number;
  reloadProgress?: number;
  shotSequence?: number;
  invulnerableTimer?: number;
  infected?: boolean;
  isRemotePeer?: boolean;
  ForcedAnimState?: CharacterAnimState;
}

export interface PaperdollDebugInfo {
  state: CharacterAnimState;
  octant: DirectionOctant;
  row: number;
  frameIndex: number;
  animKey: string;
  frame: { x: number; y: number; width: number; height: number };
  sheetUrl: string;
  weaponKey: string | null;
  pos: { x: number; y: number };
}

export class PaperdollActor {
  public readonly root = new PIXI.Container();
  public readonly shadowLayer = new PIXI.Graphics();
  public readonly baseBodyContainer = new PIXI.Container();
  public readonly baseBodySprite: PIXI.Sprite;
  public readonly armorOverlayLayer = new PIXI.Graphics();
  // Modular gear layers (headgear / backpack) drawn above the body, below the weapon.
  public readonly headgearSprite: PIXI.Sprite;
  public readonly backpackSprite: PIXI.Sprite;
  public readonly weaponLayer = new PIXI.Container();
  public readonly weaponSprite: PIXI.Sprite;
  public readonly weaponGraphic = new PIXI.Graphics();
  public readonly animator = new CharacterAnimationStateMachine();

  private currentWeaponSpriteKey: SpriteKey | null = null;
  private textures: Map<string, PIXI.Texture>;
  private lastPose: CharacterAnimationPose | null = null;
  private lastAnimKey = 'survivor_idle';
  private lastSheetRow = 0;
  private lastShotSequence: number | null = null;

  constructor(textures: Map<string, PIXI.Texture>) {
    this.textures = textures;
    this.root.addChild(this.shadowLayer);
    this.root.addChild(this.baseBodyContainer);

    const survivorTex =
      textures.get('survivor') ??
      createFallbackPlaceholderTexture(MODULAR_ASSET_MANIFEST.survivor);
    const sp = new PIXI.Sprite(survivorTex);
    sp.anchor.set(
      MODULAR_ASSET_MANIFEST.survivor.anchor.x,
      MODULAR_ASSET_MANIFEST.survivor.anchor.y,
    );
    sp.scale.set(0.76);
    this.baseBodyContainer.addChild(sp);
    this.baseBodySprite = sp;

    this.baseBodyContainer.addChild(this.armorOverlayLayer);

    const emptyTex = PIXI.Texture.EMPTY;
    const headSp = new PIXI.Sprite(emptyTex);
    headSp.anchor.set(0.5, 0.5);
    headSp.scale.set(0.82);
    this.headgearSprite = headSp;
    this.baseBodyContainer.addChild(this.headgearSprite);

    const backSp = new PIXI.Sprite(emptyTex);
    backSp.anchor.set(0.5, 0.5);
    backSp.scale.set(0.82);
    this.backpackSprite = backSp;
    // Backpack draws behind the body but above the ground shadow.
    this.root.addChildAt(this.backpackSprite, 1);
    this.backpackSprite.position.set(0, -4);

    const defaultWepTex =
      textures.get('weapon_rifle') ??
      createFallbackPlaceholderTexture(MODULAR_ASSET_MANIFEST.weapon_rifle);
    const wepSp = new PIXI.Sprite(defaultWepTex);
    wepSp.anchor.set(
      MODULAR_ASSET_MANIFEST.weapon_rifle.anchor.x,
      MODULAR_ASSET_MANIFEST.weapon_rifle.anchor.y,
    );
    wepSp.scale.set(0.82);
    this.weaponSprite = wepSp;
    this.weaponLayer.addChild(this.weaponSprite);
    this.weaponLayer.addChild(this.weaponGraphic);
    this.root.addChild(this.weaponLayer);
  }

  /** Swap headgear texture; pass null to clear. Falls back to EMPTY (invisible) if missing. */
  setHeadgear(key: string | null): void {
    const tex = key ? this.textures.get(key) ?? PIXI.Texture.EMPTY : PIXI.Texture.EMPTY;
    this.headgearSprite.texture = tex;
    this.headgearSprite.visible = tex !== PIXI.Texture.EMPTY;
  }

  /** Swap backpack texture; pass null to clear. */
  setBackpack(key: string | null): void {
    const tex = key ? this.textures.get(key) ?? PIXI.Texture.EMPTY : PIXI.Texture.EMPTY;
    this.backpackSprite.texture = tex;
    this.backpackSprite.visible = tex !== PIXI.Texture.EMPTY;
  }

  update(input: PaperdollRenderInput, dt: number): {
    pose: CharacterAnimationPose;
    muzzleScreenOffset: Vec2;
  } {
    if (input.shotSequence !== undefined) {
      if (this.lastShotSequence !== null && input.shotSequence !== this.lastShotSequence) {
        this.animator.triggerShot();
      }
      this.lastShotSequence = input.shotSequence;
    }
    const pose = this.animator.step(
      {
        velocity: input.velocity,
        aimAngle: input.aimAngleWorld,
        alive: input.alive,
        sprinting: input.sprinting,
        firing: input.firing,
        reloading: input.reloading,
        melee: input.melee,
        muzzleFlashTimer: input.muzzleFlashTimer,
        reloadTimer: input.reloadTimer,
        reloadProgress: input.reloadProgress,
        weaponId: input.equippedWeaponId,
      },
      dt,
    );

    const angle = input.aimAngleWorld;
    const octant = ((Math.floor((angle + Math.PI / 8) / (Math.PI / 4) + 8) % 8) + 8) % 8 as DirectionOctant;
    const handOffset = OCTANT_HAND_OFFSETS[octant];

    const screenAim = {
      x: Math.cos(angle) - Math.sin(angle),
      y: (Math.cos(angle) + Math.sin(angle)) * 0.5,
    };
    const aimLen = Math.hypot(screenAim.x, screenAim.y) || 1;
    const ux = screenAim.x / aimLen;
    const uy = screenAim.y / aimLen;
    const screenAngle = Math.atan2(uy, ux);

    // 1. Ground shadow
    this.shadowLayer.clear();
    this.shadowLayer.lineStyle(0);
    this.shadowLayer.beginFill(0x000000, 0.52);
    this.shadowLayer.drawEllipse(0, 3, 12, 6);
    this.shadowLayer.endFill();

    // 2. Base Body Layer with 8-way directional frame lookup
    const baseScale = 0.76;
    // Pick the animation sheet that matches the current state; fall back to idle/walk for un-animated states.
    const animKey = survivorSheetForState(pose.state);
    const survivorBaseTex =
      this.textures.get(animKey) ??
      this.textures.get('survivor') ??
      createFallbackPlaceholderTexture(MODULAR_ASSET_MANIFEST.survivor);
    const dirFrame = resolveDirectionalSpriteFrame(survivorBaseTex, angle, pose.frameIndex);
    this.lastPose = pose;
    this.lastAnimKey = animKey;
    this.lastSheetRow = dirFrame.row;
    this.baseBodySprite.texture = dirFrame.texture;
    this.baseBodyContainer.position.set(
      -ux * pose.recoilKickPx * 0.22,
      pose.bobOffsetY - uy * pose.recoilKickPx * 0.22,
    );
    this.baseBodyContainer.rotation = pose.proneRotationRad;
    this.baseBodyContainer.skew.x = pose.strideSkewX;

    // Directional sheets already contain left- and right-facing views. Mirroring
    // those rows again made half the octants face backwards and swapped gear hands.
    this.baseBodySprite.scale.set(baseScale, baseScale * pose.proneScaleY);
    this.baseBodySprite.tint =
      (input.invulnerableTimer ?? 0) > 0
        ? 0xff9a9a
        : input.infected
          ? 0xb8ff9e
          : input.isRemotePeer
            ? 0xdceeff
            : 0xffffff;

    // 3. Armor Overlay Layer (Kevlar / Exo-Ceramic vest plate)
    this.armorOverlayLayer.clear();

    // Modular gear layers (headgear / backpack) swap instantly from the texture registry.
    this.setHeadgear(input.headgear ?? null);
    this.setBackpack(input.backpack ?? null);

    // 4. Equipped Weapon Layer locked directly to hand coordinate offset + 360-degree aim angle
    const weaponProfile =
      WEAPON_VISUAL_PROFILES[input.equippedWeaponId] ?? WEAPON_VISUAL_PROFILES.rifle;
    const spriteKey = weaponProfile.spriteKey ?? 'weapon_rifle';
    if (this.currentWeaponSpriteKey !== spriteKey) {
      this.currentWeaponSpriteKey = spriteKey;
      const spec = MODULAR_ASSET_MANIFEST[spriteKey];
      const wepTex = this.textures.get(spriteKey) ?? createFallbackPlaceholderTexture(spec);
      this.weaponSprite.texture = wepTex;
      this.weaponSprite.anchor.set(spec.anchor.x, spec.anchor.y);
    }

    const kickX = -ux * pose.recoilKickPx;
    const kickY = -uy * pose.recoilKickPx;
    const flipWeaponY = ux < -0.01 ? -1 : 1;

    const meleeSwinging = input.equippedWeaponId === 'melee' && pose.state === 'MELEE';
    this.weaponLayer.visible = input.alive;
    this.weaponLayer.position.set(
      Math.round((handOffset.x + kickX + (meleeSwinging ? ux * (pose.meleeReachPx ?? 0) : 0)) * 2) / 2,
      Math.round((handOffset.y + pose.bobOffsetY + pose.reloadDropPx + kickY + (meleeSwinging ? uy * (pose.meleeReachPx ?? 0) : 0)) * 2) / 2,
    );
    this.weaponLayer.rotation =
      screenAngle +
      ((weaponProfile.restRotationRad ?? 0) +
        (meleeSwinging ? pose.meleeSwingRad ?? 0 : pose.reloadTiltRad)) *
        flipWeaponY;
    this.weaponSprite.scale.set(0.84, 0.84 * flipWeaponY);

    this.weaponGraphic.clear();
    // Muzzle flash glow at barrel tip
    if (input.muzzleFlashTimer > 0 && input.equippedWeaponId !== 'melee') {
      this.weaponGraphic.lineStyle(0);
      this.weaponGraphic.beginFill(0xffffff, 0.96);
      this.weaponGraphic.drawCircle(weaponProfile.muzzleOffsetPx + 2, 0, 5.2);
      this.weaponGraphic.endFill();
      this.weaponGraphic.beginFill(0xffd166, 0.72);
      this.weaponGraphic.drawCircle(weaponProfile.muzzleOffsetPx + 3, 0, 8.5);
      this.weaponGraphic.endFill();
    }

    // Layer order: when aiming North (octants 4, 5, 6), tuck weapon slightly behind head/shoulders
    if (octant === 4 || octant === 5 || octant === 6) {
      this.root.setChildIndex(this.weaponLayer, 1);
    } else {
      this.root.setChildIndex(this.weaponLayer, this.root.children.length - 1);
    }

    return {
      pose,
      muzzleScreenOffset: {
        x: handOffset.x + ux * weaponProfile.muzzleOffsetPx,
        y: handOffset.y + uy * weaponProfile.muzzleOffsetPx,
      },
    };
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  /** Live snapshot of what is being drawn right now — used by the dev sprite debug overlay. */
  describe(): PaperdollDebugInfo | null {
    if (!this.lastPose) return null;
    const tex = this.baseBodySprite.texture;
    const res = tex.baseTexture.resource as { url?: string; src?: string; source?: unknown } | undefined;
    const url = res?.url ?? res?.src ?? (res?.source as { src?: string } | undefined)?.src ?? '';
    return {
      state: this.lastPose.state,
      octant: this.lastPose.octant,
      row: this.lastSheetRow,
      frameIndex: this.lastPose.frameIndex,
      animKey: this.lastAnimKey,
      frame: { x: tex.frame.x, y: tex.frame.y, width: tex.frame.width, height: tex.frame.height },
      sheetUrl: url,
      weaponKey: this.currentWeaponSpriteKey,
      pos: { x: this.root.position.x, y: this.root.position.y },
    };
  }
}
