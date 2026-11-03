import { clamp, distance } from './isometric';
import type {
  GameEvent,
  PlayerState,
  Vec2,
  WeaponId,
  WorldState,
  ZombieVariant,
} from './types';

export type FootstepSurface = 'asphalt' | 'metal' | 'dirt' | 'indoors';

export const SPATIAL_MAX_DISTANCE = 18;
export const SPATIAL_REF_DISTANCE = 1.5;

export const SURFACE_STEP_INTERVALS: Record<FootstepSurface, number> = {
  asphalt: 0.42,
  metal: 0.36,
  dirt: 0.46,
  indoors: 0.38,
};

export interface SpatialAudioReading {
  distance: number;
  gain: number;
  pan: number;
}

/**
 * Computes 3D/isometric spatial attenuation and stereo panning relative to the
 * player camera listener coordinates.
 */
export function computeSpatialAttenuation(
  listener: Vec2,
  source: Vec2,
  maxDistance: number = SPATIAL_MAX_DISTANCE,
): SpatialAudioReading {
  const dist = distance(listener, source);
  if (dist >= maxDistance) {
    return { distance: dist, gain: 0, pan: 0 };
  }
  const normalized = clamp(
    (dist - SPATIAL_REF_DISTANCE) / Math.max(0.001, maxDistance - SPATIAL_REF_DISTANCE),
    0,
    1,
  );
  const gain = Math.pow(1 - normalized, 1.85);
  const isoDx = source.x - listener.x - (source.y - listener.y);
  const pan = clamp(isoDx / (maxDistance * 0.65), -1, 1);
  return { distance: dist, gain, pan };
}

/**
 * Spatial Audio Controller for Outlands (`/engine/audio.ts`).
 *
 * Provides distance-attenuated 3D/stereo positioning, surface-dependent
 * footsteps, weapon switching, 3-stage reloads (`playReloadStart`,
 * `playReloadClipInsert`, `playReloadRack`), item looting (`playItemLoot`),
 * ambient loops (crackling fire barrels, wind howl), and positional zombie moans.
 */
export class OutlandsAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private footstepTimer = 0;
  private stepParity = 0;
  private windTimer = 0;
  private barrelTimer = 0;
  private moanTimer = 1.2;
  enabled = true;

  ensure(): void {
    if (typeof window === 'undefined') return;
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = this.enabled ? 0.32 : 0;
    this.master.connect(this.context.destination);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(enabled ? 0.32 : 0, this.context.currentTime, 0.02);
    }
  }

  private getNoise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.35), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private connectSpatialChain(
    ctx: AudioContext,
    sourceNode: AudioNode,
    volume: number,
    pan = 0,
    duration = 0.12,
  ): GainNode | null {
    if (!this.master) return null;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.0001, volume), now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + duration);

    sourceNode.connect(gain);
    if (typeof ctx.createStereoPanner === 'function' && Math.abs(pan) > 0.01) {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(clamp(pan, -1, 1), now);
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      gain.connect(this.master);
    }
    return gain;
  }

  playShot(weapon: WeaponId, listener?: Vec2, source?: Vec2): void {
    try {
      this.ensure();
      if (!this.context || !this.master || !this.enabled) return;
      const ctx = this.context;
      const now = ctx.currentTime;
      const spatial =
        listener && source
          ? computeSpatialAttenuation(listener, source, SPATIAL_MAX_DISTANCE * 1.4)
          : { gain: 1, pan: 0, distance: 0 };
      if (spatial.gain <= 0.01) return;

      if (weapon === 'melee') {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(340, now);
        osc.frequency.exponentialRampToValueAtTime(95, now + 0.09);
        this.connectSpatialChain(ctx, osc, 0.3 * spatial.gain, spatial.pan, 0.1);
        osc.start(now);
        osc.stop(now + 0.11);
        return;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoise(ctx);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      const freqMap: Record<WeaponId, number> = {
        melee: 600,
        pistol: 1250,
        shotgun: 680,
        smg: 1450,
        sniper: 820,
        rifle: 1120,
        heavy: 760,
      };
      filter.frequency.setValueAtTime(freqMap[weapon] ?? 1100, now);
      filter.Q.value = weapon === 'shotgun' || weapon === 'heavy' ? 1.1 : 1.9;

      const duration =
        weapon === 'shotgun' || weapon === 'sniper'
          ? 0.18
          : weapon === 'smg' || weapon === 'heavy'
            ? 0.08
            : 0.11;
      const baseVol = (weapon === 'shotgun' || weapon === 'sniper' ? 0.62 : 0.4) * spatial.gain;

      noise.connect(filter);
      this.connectSpatialChain(ctx, filter, baseVol, spatial.pan, duration);
      noise.start(now);
      noise.stop(now + duration + 0.01);

      const osc = ctx.createOscillator();
      osc.type = weapon === 'sniper' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(
        weapon === 'shotgun' ? 140 : weapon === 'sniper' ? 160 : 210,
        now,
      );
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.09);
      this.connectSpatialChain(ctx, osc, 0.34 * spatial.gain, spatial.pan, 0.09);
      osc.start(now);
      osc.stop(now + 0.1);
    } catch {
      // Audio is non-critical.
    }
  }

  playHit(headshot: boolean, lethal: boolean, listener?: Vec2, source?: Vec2): void {
    try {
      this.ensure();
      if (!this.context || !this.master || !this.enabled) return;
      const ctx = this.context;
      const now = ctx.currentTime;
      const spatial =
        listener && source
          ? computeSpatialAttenuation(listener, source)
          : { gain: 1, pan: 0, distance: 0 };
      if (spatial.gain <= 0.01) return;

      const osc = ctx.createOscillator();
      osc.type = headshot ? 'sawtooth' : 'sine';
      osc.frequency.setValueAtTime(headshot ? 520 : 240, now);
      osc.frequency.exponentialRampToValueAtTime(lethal ? 75 : 120, now + 0.08);
      this.connectSpatialChain(
        ctx,
        osc,
        (headshot ? 0.28 : 0.18) * spatial.gain,
        spatial.pan,
        0.09,
      );
      osc.start(now);
      osc.stop(now + 0.1);
    } catch {
      // Ignore audio errors.
    }
  }

  /**
   * Plays a surface-dependent footstep click/thud.
   */
  playFootstep(surface: FootstepSurface = 'asphalt', sprinting = false): void {
    try {
      this.ensure();
      if (!this.context || !this.master || !this.enabled) return;
      const ctx = this.context;
      const now = ctx.currentTime;
      this.stepParity = (this.stepParity + 1) % 2;

      const freqBySurface: Record<FootstepSurface, number> = {
        asphalt: 185,
        metal: 420,
        dirt: 135,
        indoors: 245,
      };
      const baseFreq = freqBySurface[surface] + (this.stepParity === 0 ? -12 : 14);
      const vol = sprinting ? 0.13 : 0.075;

      const osc = ctx.createOscillator();
      osc.type = surface === 'metal' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(52, now + 0.055);
      this.connectSpatialChain(ctx, osc, vol, this.stepParity === 0 ? -0.08 : 0.08, 0.06);
      osc.start(now);
      osc.stop(now + 0.065);
    } catch {
      // Ignore audio errors.
    }
  }

  /**
   * Advances surface-dependent footstep cadence while the survivor is moving.
   */
  stepFootsteps(
    player: Pick<PlayerState, 'vx' | 'vy' | 'alive' | 'inSafeZone'>,
    dt: number,
    surface: FootstepSurface = 'asphalt',
  ): boolean {
    if (!player.alive) return false;
    const speed = Math.hypot(player.vx, player.vy);
    if (speed < 0.35) {
      this.footstepTimer = Math.min(this.footstepTimer, 0.08);
      return false;
    }
    const sprinting = speed > 5.1;
    const baseInterval = SURFACE_STEP_INTERVALS[surface] ?? 0.42;
    const interval = sprinting ? baseInterval * 0.68 : baseInterval;
    this.footstepTimer -= dt;
    if (this.footstepTimer <= 0) {
      this.footstepTimer = interval;
      this.playFootstep(surface, sprinting);
      return true;
    }
    return false;
  }

  /**
   * Metallic selector click when switching weapons (`1`–`7`).
   */
  playWeaponSwitch(weapon?: WeaponId): void {
    const startHz = weapon === 'heavy' || weapon === 'shotgun' ? 280 : 520;
    const endHz = weapon === 'melee' ? 680 : 390;
    this.playTone(startHz, endHz, 0.065, 0.15);
  }

  /**
   * Stage 1 reload: magazine release / shell latch open.
   */
  playReloadStart(weapon?: WeaponId): void {
    const startHz = weapon === 'shotgun' ? 310 : 420;
    this.playTone(startHz, 260, 0.075, 0.16);
  }

  /**
   * Stage 2 reload: fresh clip / magazine insertion lock.
   */
  playReloadClipInsert(weapon?: WeaponId): void {
    const endHz = weapon === 'heavy' ? 440 : 580;
    this.playTone(320, endHz, 0.07, 0.17);
  }

  /**
   * Stage 3 reload: bolt / pump slide rack forward.
   */
  playReloadRack(weapon?: WeaponId): void {
    const peakHz = weapon === 'shotgun' ? 660 : 740;
    this.playTone(460, peakHz, 0.085, 0.19);
  }

  playReload(): void {
    this.playReloadStart();
  }

  /**
   * Crisp tactical chime when looting items, scrap, or containers.
   */
  playItemLoot(): void {
    this.playTone(480, 820, 0.11, 0.2);
  }

  playPickup(): void {
    this.playItemLoot();
  }

  playPlayerHit(): void {
    this.playTone(150, 58, 0.18, 0.35);
  }

  playSiren(): void {
    this.playTone(320, 640, 0.28, 0.25);
  }

  /**
   * Spatial fire-barrel crackle attenuated by distance from the player camera.
   */
  playBarrelCrackle(listener: Vec2, barrelPos: Vec2): void {
    try {
      this.ensure();
      if (!this.context || !this.master || !this.enabled) return;
      const spatial = computeSpatialAttenuation(listener, barrelPos, 13);
      if (spatial.gain <= 0.02) return;
      const ctx = this.context;
      const now = ctx.currentTime;

      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1650 + Math.random() * 900, now);
      filter.Q.value = 3.2;
      noise.connect(filter);
      this.connectSpatialChain(ctx, filter, 0.09 * spatial.gain, spatial.pan, 0.06);
      noise.start(now);
      noise.stop(now + 0.07);
    } catch {
      // Ignore audio errors.
    }
  }

  /**
   * Low desolate quarantine wind howl.
   */
  playWindHowl(intensity = 0.5): void {
    try {
      this.ensure();
      if (!this.context || !this.master || !this.enabled) return;
      const ctx = this.context;
      const now = ctx.currentTime;
      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(240 + intensity * 140, now);
      noise.connect(filter);
      this.connectSpatialChain(
        ctx,
        filter,
        clamp(0.045 * intensity, 0.01, 0.09),
        (Math.random() - 0.5) * 0.4,
        0.32,
      );
      noise.start(now);
      noise.stop(now + 0.34);
    } catch {
      // Ignore audio errors.
    }
  }

  /**
   * Positional 3D zombie moan attenuated and panned by world coordinates.
   */
  playZombieMoan(listener: Vec2, zombiePos: Vec2, variant: ZombieVariant = 'walker'): void {
    try {
      this.ensure();
      if (!this.context || !this.master || !this.enabled) return;
      const spatial = computeSpatialAttenuation(listener, zombiePos, 16);
      if (spatial.gain <= 0.02) return;
      const ctx = this.context;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      osc.type = variant === 'titan' || variant === 'brute' ? 'sawtooth' : 'triangle';
      const baseHz =
        variant === 'titan'
          ? 68
          : variant === 'brute'
            ? 84
            : variant === 'runner' || variant === 'leaper'
              ? 165
              : 112;
      osc.frequency.setValueAtTime(baseHz, now);
      osc.frequency.exponentialRampToValueAtTime(baseHz * 0.74, now + 0.24);
      this.connectSpatialChain(ctx, osc, 0.14 * spatial.gain, spatial.pan, 0.25);
      osc.start(now);
      osc.stop(now + 0.26);
    } catch {
      // Ignore audio errors.
    }
  }

  /**
   * Steps footsteps, ambient barrel crackles, wind gusts, and positional zombie moans.
   */
  stepSpatialWorld(state: WorldState, dt: number): void {
    const { player } = state;
    const surface: FootstepSurface = state.activeInterior
      ? 'indoors'
      : player.inSafeZone
        ? 'metal'
        : 'asphalt';
    this.stepFootsteps(player, dt, surface);

    this.windTimer -= dt;
    if (this.windTimer <= 0 && !state.activeInterior) {
      this.windTimer = 3.2 + Math.random() * 2.4;
      this.playWindHowl(0.35 + player.threatTier * 0.2);
    }

    this.barrelTimer -= dt;
    if (this.barrelTimer <= 0 && !state.activeInterior && state.map.activeChunks) {
      this.barrelTimer = 0.45 + Math.random() * 0.35;
      for (const chunk of Object.values(state.map.activeChunks)) {
        for (const prop of chunk.props) {
          if (prop.kind === 'barrel_fire' && distance(player, prop) <= 12) {
            this.playBarrelCrackle(player, prop);
            break;
          }
        }
      }
    }

    this.moanTimer -= dt;
    if (this.moanTimer <= 0 && state.zombies.length > 0) {
      this.moanTimer = 2.4 + Math.random() * 2.2;
      const nearby = state.zombies.find((z) => distance(player, z) <= 15);
      if (nearby) {
        this.playZombieMoan(player, nearby, nearby.variant);
      }
    }
  }

  private playTone(
    startHz: number,
    endHz: number,
    duration: number,
    volume: number,
    pan = 0,
  ): void {
    try {
      this.ensure();
      if (!this.context || !this.master || !this.enabled) return;
      const ctx = this.context;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(startHz, now);
      osc.frequency.exponentialRampToValueAtTime(endHz, now + duration);
      this.connectSpatialChain(ctx, osc, volume, pan, duration);
      osc.start(now);
      osc.stop(now + duration + 0.01);
    } catch {
      // Ignore audio errors.
    }
  }
}

export { OutlandsAudio as SpatialAudioManager };

export function playEventSounds(
  audio: OutlandsAudio,
  events: GameEvent[],
  listener?: Vec2,
): void {
  for (const event of events) {
    if (event.type === 'shot') {
      audio.playShot(event.weapon, listener, { x: event.x, y: event.y });
    } else if (event.type === 'zombie_hit') {
      audio.playHit(event.headshot, event.lethal, listener, { x: event.x, y: event.y });
    } else if (event.type === 'weapon_switched') {
      audio.playWeaponSwitch(event.weapon);
    } else if (event.type === 'reload_start') {
      audio.playReloadStart(event.weapon);
    } else if (event.type === 'reload_clip_insert') {
      audio.playReloadClipInsert(event.weapon);
    } else if (event.type === 'reload_rack') {
      audio.playReloadRack(event.weapon);
    } else if (event.type === 'reload_complete') {
      audio.playReloadRack(event.weapon);
    } else if (
      event.type === 'pickup' ||
      event.type === 'stash_banked' ||
      event.type === 'container_searched' ||
      event.type === 'level_up'
    ) {
      audio.playItemLoot();
    } else if (event.type === 'player_hit' || event.type === 'player_died') {
      audio.playPlayerHit();
    } else if (event.type === 'loot_aggro' || event.type === 'horde_breach') {
      audio.playSiren();
    }
  }
}
