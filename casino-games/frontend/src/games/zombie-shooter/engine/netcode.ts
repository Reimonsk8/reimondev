import {
  resolveCharacterAnimState,
  type CharacterAnimState,
} from './animation';
import { clamp, rotateToward } from './isometric';
import type {
  RemoteOutlandsPlayer,
  SpatialNetPacket,
  Vec2,
  WeaponId,
  WorldState,
} from './types';
import { buildSpatialNetPacket } from './world';

/**
 * Spatial Area-of-Interest (AoI) & Character Animation/Gear Replication (`/engine/netcode.ts`).
 *
 * Transmits in real time across WebSocket + BroadcastChannel:
 * - `playerId`, `x`, `y`, `facingAngle`, `state` (`IDLE` | `WALK` | `RUN` | `SHOOT` | `RELOAD` | `DEAD`),
 *   and `equippedWeaponId`.
 * - Smoothly interpolates remote peer positions via linear interpolation (`lerp`) so remote
 *   survivors animate and aim fluidly without static sliding.
 */
export const AOI_VISION_RADIUS_TILES = 28;
export const NET_SYNC_INTERVAL_MS = 90;
export const REMOTE_LERP_RATE = 12;

export interface ReplicatedPeerState extends RemoteOutlandsPlayer {
  targetX: number;
  targetY: number;
  targetAngle: number;
  vx: number;
  vy: number;
  animState: CharacterAnimState;
  equippedWeaponId: WeaponId;
  reloading?: boolean;
}

export interface DirectionalShootVectorPacket {
  type: 'outlands_shoot';
  playerId: string;
  nickname: string;
  origin: Vec2;
  direction: Vec2;
  angle: number;
  weapon: WeaponId;
  shotSeq: number;
  timestamp: number;
}

export interface ZombieHitNetPacket {
  type: 'outlands_zombie_hit';
  playerId: string;
  zombieId: string;
  x: number;
  y: number;
  angle: number;
  damage: number;
  headshot: boolean;
  lethal: boolean;
  weapon: WeaponId;
  timestamp: number;
}

export interface PlayerStateNetPacket {
  type: 'outlands_state';
  playerId: string;
  nickname: string;
  x: number;
  y: number;
  ox: number;
  oy: number;
  facingAngle: number;
  angle: number;
  state: CharacterAnimState;
  equippedWeaponId: WeaponId;
  weapon: WeaponId;
  aimVector: Vec2;
  health: number;
  maxHealth: number;
  firing: boolean;
  reloading: boolean;
  shotSeq: number;
  game: 'outlands';
  timestamp: number;
}

export type OutlandsNetMessage =
  | PlayerStateNetPacket
  | DirectionalShootVectorPacket
  | ZombieHitNetPacket;

export interface NetcodeTransportCallbacks {
  sendMove?: (
    position: Record<string, unknown>,
    direction: number,
    extra?: Record<string, unknown>,
  ) => void;
  onRemoteShot?: (packet: DirectionalShootVectorPacket) => void;
  onRemoteZombieHit?: (packet: ZombieHitNetPacket) => void;
}

export function lerpNumber(current: number, target: number, alpha: number): number {
  return current + (target - current) * clamp(alpha, 0, 1);
}

export class SpatialNetcodeSync {
  private readonly selfId: string;
  private readonly selfNickname: string;
  private readonly aoiRadius: number;
  private readonly callbacks: NetcodeTransportCallbacks;
  private channel: BroadcastChannel | null = null;
  private remotePeers = new Map<string, ReplicatedPeerState>();
  private lastBroadcastAt = 0;

  constructor(
    selfId: string,
    selfNickname: string,
    callbacks: NetcodeTransportCallbacks = {},
    aoiRadius = AOI_VISION_RADIUS_TILES,
  ) {
    this.selfId = selfId;
    this.selfNickname = selfNickname;
    this.callbacks = callbacks;
    this.aoiRadius = aoiRadius;

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel('c888_outlands_multiplayer');
        this.channel.onmessage = (ev: MessageEvent<OutlandsNetMessage>) => {
          this.ingestNetMessage(ev.data);
        };
      } catch {
        this.channel = null;
      }
    }
  }

  /**
   * Advances linear interpolation (`lerp`) on all replicated peers and returns
   * those inside the viewer's Area of Interest (`AOI_VISION_RADIUS_TILES`).
   */
  stepInterpolatedPeers(
    viewerPos: Vec2,
    lobbyCandidates: RemoteOutlandsPlayer[],
    dt: number,
  ): ReplicatedPeerState[] {
    const now = Date.now();
    const alpha = clamp(dt * REMOTE_LERP_RATE, 0.05, 1);

    for (const candidate of lobbyCandidates) {
      if (candidate.playerId === this.selfId) continue;
      const existing = this.remotePeers.get(candidate.playerId);
      if (!existing) {
        this.remotePeers.set(candidate.playerId, {
          ...candidate,
          targetX: candidate.x,
          targetY: candidate.y,
          targetAngle: candidate.angle,
          vx: 0,
          vy: 0,
          animState: candidate.firing ? 'SHOOT' : 'IDLE',
          equippedWeaponId: candidate.weapon ?? 'rifle',
        });
      } else {
        existing.vx = (candidate.x - existing.x) / Math.max(dt, 0.05);
        existing.vy = (candidate.y - existing.y) / Math.max(dt, 0.05);
        existing.targetX = candidate.x;
        existing.targetY = candidate.y;
        existing.targetAngle = candidate.angle;
        existing.weapon = candidate.weapon;
        existing.equippedWeaponId = candidate.weapon;
        existing.health = candidate.health;
        existing.maxHealth = candidate.maxHealth;
        existing.firing = candidate.firing;
        existing.shotSeq = candidate.shotSeq;
        existing.lastSeen = Math.max(existing.lastSeen, candidate.lastSeen);
      }
    }

    const activeInAoI: ReplicatedPeerState[] = [];
    for (const [id, peer] of this.remotePeers.entries()) {
      if (now - peer.lastSeen > 15000) {
        this.remotePeers.delete(id);
        continue;
      }

      const prevX = peer.x;
      const prevY = peer.y;
      peer.x = lerpNumber(peer.x, peer.targetX, alpha);
      peer.y = lerpNumber(peer.y, peer.targetY, alpha);
      peer.angle = rotateToward(peer.angle, peer.targetAngle, 14 * dt);
      peer.vx = (peer.x - prevX) / Math.max(dt, 1e-3);
      peer.vy = (peer.y - prevY) / Math.max(dt, 1e-3);

      peer.animState = resolveCharacterAnimState({
        velocity: { x: peer.vx, y: peer.vy },
        aimAngle: peer.angle,
        alive: peer.health > 0,
        sprinting: Math.hypot(peer.vx, peer.vy) > 5.0,
        firing: Boolean(peer.firing),
        reloading: Boolean(peer.reloading),
        muzzleFlashTimer: peer.firing ? 0.03 : 0,
        reloadTimer: peer.reloading ? 0.5 : 0,
      });

      const dist = Math.hypot(peer.x - viewerPos.x, peer.y - viewerPos.y);
      if (dist <= this.aoiRadius) {
        activeInAoI.push(peer);
      }
    }

    return activeInAoI;
  }

  /**
   * Builds an authoritative Spatial AoI packet from the local simulation state.
   */
  createAoISnapshot(state: WorldState): SpatialNetPacket {
    return buildSpatialNetPacket(
      state,
      { x: state.player.x, y: state.player.y },
      this.aoiRadius,
    );
  }

  /**
   * Serializes and broadcasts `playerId`, `x`, `y`, `facingAngle`, `state`, and `equippedWeaponId`
   * across WebSocket + BroadcastChannel.
   */
  syncPlayerState(
    state: WorldState,
    firing: boolean,
    shotSeq: number,
    sprinting = false,
    force = false,
  ): void {
    const now = Date.now();
    if (!force && now - this.lastBroadcastAt < NET_SYNC_INTERVAL_MS) return;
    this.lastBroadcastAt = now;

    const p = state.player;
    const animState = resolveCharacterAnimState({
      velocity: { x: p.vx, y: p.vy },
      aimAngle: p.angle,
      alive: p.alive,
      sprinting,
      firing,
      reloading: p.reloadTimer > 0,
      muzzleFlashTimer: firing ? 0.03 : 0,
      reloadTimer: p.reloadTimer,
    });

    const aimVector: Vec2 = {
      x: Number(Math.cos(p.angle).toFixed(3)),
      y: Number(Math.sin(p.angle).toFixed(3)),
    };

    const ox = Number(p.x.toFixed(2));
    const oy = Number(p.y.toFixed(2));
    const facingAngle = Number(p.angle.toFixed(2));

    const wsPayload = {
      x: Math.max(0, Math.min(2680, Math.round(1344 + (p.x - 21) * 4))),
      y: Math.max(0, Math.min(1500, Math.round(980 + (p.y - 21) * 4))),
      ox,
      oy,
      facingAngle,
      angle: facingAngle,
      state: animState,
      equippedWeaponId: p.activeWeapon,
      weapon: p.activeWeapon,
      aimVector,
      health: Math.ceil(p.health),
      maxHealth: p.maxHealth,
      firing,
      reloading: p.reloadTimer > 0,
      shotSeq,
      game: 'outlands' as const,
    };

    this.callbacks.sendMove?.(wsPayload, p.angle);

    const packet: PlayerStateNetPacket = {
      type: 'outlands_state',
      playerId: this.selfId,
      nickname: this.selfNickname,
      x: ox,
      y: oy,
      ox,
      oy,
      facingAngle,
      angle: facingAngle,
      state: animState,
      equippedWeaponId: p.activeWeapon,
      weapon: p.activeWeapon,
      aimVector,
      health: wsPayload.health,
      maxHealth: wsPayload.maxHealth,
      firing,
      reloading: p.reloadTimer > 0,
      shotSeq,
      game: 'outlands',
      timestamp: now,
    };

    try {
      this.channel?.postMessage(packet);
    } catch {
      // Ignore broadcast channel errors
    }
  }

  broadcastShootVector(
    origin: Vec2,
    angle: number,
    weapon: WeaponId,
    shotSeq: number,
  ): void {
    const packet: DirectionalShootVectorPacket = {
      type: 'outlands_shoot',
      playerId: this.selfId,
      nickname: this.selfNickname,
      origin: { x: Number(origin.x.toFixed(2)), y: Number(origin.y.toFixed(2)) },
      direction: {
        x: Number(Math.cos(angle).toFixed(3)),
        y: Number(Math.sin(angle).toFixed(3)),
      },
      angle: Number(angle.toFixed(3)),
      weapon,
      shotSeq,
      timestamp: Date.now(),
    };
    try {
      this.channel?.postMessage(packet);
    } catch {
      // Ignore channel errors
    }
  }

  broadcastZombieHit(
    hit: Omit<ZombieHitNetPacket, 'type' | 'playerId' | 'timestamp'>,
  ): void {
    const packet: ZombieHitNetPacket = {
      ...hit,
      type: 'outlands_zombie_hit',
      playerId: this.selfId,
      timestamp: Date.now(),
    };
    try {
      this.channel?.postMessage(packet);
    } catch {
      // Ignore channel errors
    }
  }

  ingestNetMessage(msg: OutlandsNetMessage | null | undefined): void {
    if (!msg || typeof msg !== 'object' || msg.playerId === this.selfId) return;

    if (msg.type === 'outlands_state') {
      const existing = this.remotePeers.get(msg.playerId);
      const targetX = Number.isFinite(msg.ox) ? msg.ox : msg.x;
      const targetY = Number.isFinite(msg.oy) ? msg.oy : msg.y;
      const targetAngle = Number.isFinite(msg.facingAngle)
        ? msg.facingAngle
        : msg.angle;
      const equipped = msg.equippedWeaponId ?? msg.weapon ?? 'rifle';

      if (!existing) {
        this.remotePeers.set(msg.playerId, {
          playerId: msg.playerId,
          nickname: msg.nickname || 'Survivor',
          x: targetX,
          y: targetY,
          targetX,
          targetY,
          angle: targetAngle,
          targetAngle,
          vx: 0,
          vy: 0,
          animState: msg.state ?? 'IDLE',
          equippedWeaponId: equipped,
          weapon: equipped,
          health: msg.health ?? 100,
          maxHealth: msg.maxHealth ?? 100,
          firing: Boolean(msg.firing),
          reloading: Boolean(msg.reloading),
          shotSeq: msg.shotSeq ?? 0,
          lastSeen: Date.now(),
        });
      } else {
        existing.nickname = msg.nickname || existing.nickname;
        existing.targetX = targetX;
        existing.targetY = targetY;
        existing.targetAngle = targetAngle;
        existing.animState = msg.state ?? existing.animState;
        existing.equippedWeaponId = equipped;
        existing.weapon = equipped;
        existing.health = msg.health ?? existing.health;
        existing.maxHealth = msg.maxHealth ?? existing.maxHealth;
        existing.firing = Boolean(msg.firing);
        existing.reloading = Boolean(msg.reloading);
        existing.shotSeq = msg.shotSeq ?? existing.shotSeq;
        existing.lastSeen = Date.now();
      }
    } else if (msg.type === 'outlands_shoot') {
      const existing = this.remotePeers.get(msg.playerId);
      if (existing) {
        existing.targetX = msg.origin.x;
        existing.targetY = msg.origin.y;
        existing.targetAngle = msg.angle;
        existing.equippedWeaponId = msg.weapon;
        existing.weapon = msg.weapon;
        existing.firing = true;
        existing.animState = 'SHOOT';
        existing.shotSeq = msg.shotSeq;
        existing.lastSeen = Date.now();
      }
      this.callbacks.onRemoteShot?.(msg);
    } else if (msg.type === 'outlands_zombie_hit') {
      this.callbacks.onRemoteZombieHit?.(msg);
    }
  }

  destroy(): void {
    try {
      this.channel?.close();
    } catch {
      // Ignore close error
    }
    this.channel = null;
    this.remotePeers.clear();
  }
}
