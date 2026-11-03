import { describe, expect, it } from 'vitest';
import { computeSpatialAttenuation } from './audio';
import {
  CAMERA_ZOOM,
  computeCameraTransform,
  getChunkStreamingBounds,
  screenToWorldWithCamera,
  worldToViewportScreen,
  zoomForViewport,
} from './camera';
import { distance } from './isometric';
import { InteriorManager, getInteriorPortals } from './interiors';
import {
  MAX_HEAVY_SHAKE_PX,
  allocateAttributePoint,
  allocateProficiencyPoint,
  assignLoadoutSlot,
  buyMarketplaceItem,
  computeRecoilVector,
  computeWeaponShakePx,
  killDropChanceFor,
  localZombieCapFor,
  outpostHealService,
  raycastDistanceToZombie,
  restartWorld,
  spawnIntervalFor,
  stepLinearRecoil,
  stepWorld,
  threatReadout,
  useInventoryItem,
} from './simulation';
import type { InputState, ThreatTier, WorldState } from './types';
import {
  addItemToInventory,
  createWorld,
  createZombie,
  threatTierAt,
} from './world';

const fixedRng = () => 0.5;

function idle(): InputState {
  return {
    move: { x: 0, y: 0 },
    aim: { x: 1, y: 0 },
    firing: false,
    reload: false,
    sprint: false,
  };
}

function fresh(): WorldState {
  const state = createWorld(77, 0);
  state.map.obstacles = [];
  state.map.containers = [];
  state.player.x = 8;
  state.player.y = 21;
  state.player.inSafeZone = false;
  state.player.threatTier = threatTierAt(state.map, 8, 21);
  state.player.stash = 0;
  state.player.carriedScrap = 0;
  state.player.carriedCash = 0;
  state.player.unbankedXp = 0;
  state.player.inventory = [];
  state.zombies = [];
  state.pickups = [];
  state.events = [];
  state.spawnTimer = 999;
  return state;
}

function stepFor(state: WorldState, input: InputState, seconds: number, rng = fixedRng): void {
  const steps = Math.round(seconds / 0.05);
  for (let i = 0; i < steps; i += 1) {
    stepWorld(state, input, 0.05, rng);
  }
}

describe('Outlands authoritative simulation', () => {
  it('supports input-driven building entry, animated portal transitions, and exit', () => {
    const state = createWorld(702, 0);
    state.map.obstacles = [];
    state.map.containers = [];
    state.zombies = [];
    const exteriorDoor = state.map.doors![0]!;
    state.player.x = exteriorDoor.x;
    state.player.y = exteriorDoor.y;

    stepWorld(state, { ...idle(), interact: true }, 0.05, fixedRng);
    expect(state.activeInterior ?? null).toBeNull();
    expect(exteriorDoor.state).toBe('opening');
    stepWorld(state, idle(), 0.1, fixedRng);
    stepWorld(state, idle(), 0.1, fixedRng);
    stepWorld(state, idle(), 0.1, fixedRng);
    stepWorld(state, idle(), 0.1, fixedRng);
    stepWorld(state, { ...idle(), interact: true }, 0.05, fixedRng);
    expect(state.activeInterior).not.toBeNull();
    expect(state.player.x).toBe(state.activeInterior!.entrySpawn.x);
    expect(state.player.y).toBe(state.activeInterior!.entrySpawn.y);

    const interior = state.activeInterior!;
    interior.containers = [];
    const portal = getInteriorPortals(interior.id).find(({ kind }) => kind === 'door')!;
    state.player.x = portal.x;
    state.player.y = portal.y - 1;
    state.player.interactionCooldown = 0;
    stepWorld(state, { ...idle(), interact: true }, 0.05, fixedRng);
    expect(portal.state).toBe('opening');
    stepWorld(state, idle(), 0.1, fixedRng);
    stepWorld(state, idle(), 0.1, fixedRng);
    stepWorld(state, idle(), 0.05, fixedRng);
    expect(portal.state).toBe('open');

    state.player.x = portal.x;
    state.player.y = portal.y;
    state.player.interactionCooldown = 0;
    stepWorld(state, { ...idle(), interact: true }, 0.05, fixedRng);
    expect(portal.state).toBe('open');
    state.player.x = portal.x;
    state.player.y = portal.y + 1;
    state.player.interactionCooldown = 0;
    stepWorld(state, { ...idle(), interact: true }, 0.05, fixedRng);
    expect(portal.state).toBe('closing');

    state.player.x = interior.exitDoor.x;
    state.player.y = interior.exitDoor.y;
    state.player.interactionCooldown = 0;
    stepWorld(state, { ...idle(), interact: true }, 0.05, fixedRng);
    expect(state.activeInterior ?? null).toBeNull();
    expect(state.player.x).toBe(exteriorDoor.x);
    expect(state.player.y).toBeCloseTo(exteriorDoor.y + 0.9);
    expect(state.projectiles).toEqual([]);
    expect(state.player.alive).toBe(true);
  });

  it('keeps outdoor infected active at the entrance and lets them wear down barricades while indoors', () => {
    const state = createWorld(703, 0);
    state.map.obstacles = [];
    state.map.containers = [];
    const door = state.map.doors![0]!;
    state.player.x = door.x;
    state.player.y = door.y;
    door.state = 'open';
    const interior = InteriorManager.enterBuilding(state, door);
    state.zombies = [];
    door.state = 'barricaded';
    door.barricadeHp = 100;
    const outsideZombie = createZombie('outside-door-zombie', 'walker', {
      x: door.x,
      y: door.y + 3.2,
    });
    outsideZombie.alerted = true;
    outsideZombie.siegeWave = true;
    interior.outdoorZombiesBackup = [outsideZombie];
    const startY = outsideZombie.y;

    for (let frame = 0; frame < 40; frame += 1) stepWorld(state, idle(), 0.1, fixedRng);

    expect(state.activeInterior).toBe(interior);
    expect(interior.outdoorZombiesBackup[0]!.y).toBeLessThan(startY);
    expect(door.barricadeHp).toBeLessThan(100);
    expect(door.state).toBe('barricaded');
  });

  it('moves the survivor along the input vector and spends stamina while sprinting', () => {
    const walkState = fresh();
    const sprintState = fresh();
    stepFor(walkState, { ...idle(), move: { x: 1, y: 0 } }, 0.3);
    stepFor(sprintState, { ...idle(), move: { x: 1, y: 0 }, sprint: true }, 0.3);

    expect(walkState.player.x).toBeGreaterThan(8);
    expect(sprintState.player.x).toBeGreaterThan(walkState.player.x);
    expect(sprintState.player.stamina).toBeLessThan(walkState.player.stamina);
  });

  it('tightens reticle bloom when stationary and expands it when sprinting', () => {
    const state = fresh();
    state.player.reticleBloom = 0.6;
    stepFor(state, idle(), 0.4);
    expect(state.player.reticleBloom).toBeLessThan(0.3);

    stepFor(state, { ...idle(), move: { x: 1, y: 0 }, sprint: true }, 0.4);
    expect(state.player.reticleBloom).toBeGreaterThan(0.5);
  });

  it('hits and kills a zombie in front of the muzzle and drops loot', () => {
    const state = fresh();
    const zombie = createZombie('z-1', 'walker', { x: 11, y: 21 });
    state.zombies.push(zombie);

    expect(raycastDistanceToZombie({ x: 8, y: 21 }, 0, 16, zombie)).not.toBeNull();

    stepFor(state, { ...idle(), firing: true }, 0.4, () => 0.1);
    expect(state.zombies.length).toBe(0);
    expect(state.player.kills).toBe(1);
    expect(state.pickups.length).toBe(1);
    expect(state.events.some((e) => e.type === 'zombie_hit' && e.headshot)).toBe(true);
    expect(state.events.some((e) => e.type === 'zombie_killed')).toBe(true);
  });

  it('keeps zombies outside the S-Zone perimeter even when chasing the player inside', () => {
    const state = createWorld(77, 0);
    state.map.obstacles = [];
    const zombie = createZombie('z-chase', 'runner', {
      x: state.map.safeCenter.x + state.map.safeRadius + 0.4,
      y: state.map.safeCenter.y,
    });
    zombie.alerted = true;
    state.zombies = [zombie];
    state.spawnTimer = 999;

    stepFor(state, idle(), 1.2);
    expect(distance(zombie, state.map.safeCenter)).toBeGreaterThanOrEqual(
      state.map.safeRadius + zombie.radius,
    );
  });

  it('banks carried scrap, cash, and unbanked XP automatically on entering the safe zone', () => {
    const state = fresh();
    state.player.x = state.map.safeCenter.x;
    state.player.y = state.map.safeCenter.y;
    state.player.carriedScrap = 19;
    state.player.carriedCash = 85;
    state.player.unbankedXp = 120;

    stepWorld(state, idle(), 0.05, fixedRng);
    expect(state.player.inSafeZone).toBe(true);
    expect(state.player.carriedScrap).toBe(0);
    expect(state.player.stash).toBe(19);
    expect(state.player.bankCash).toBe(235);
    expect(state.player.level).toBeGreaterThanOrEqual(2);
    expect(state.events.some((e) => e.type === 'stash_banked')).toBe(true);
  });

  it('absorbs incoming zombie damage with Kevlar armor durability before reducing HP', () => {
    const state = fresh();
    state.player.armorAbsorption = 0.5;
    state.player.armorDurability = 50;
    const zombie = createZombie('z-hit', 'walker', {
      x: state.player.x + 0.4,
      y: state.player.y,
    });
    zombie.alerted = true;
    state.zombies.push(zombie);

    stepWorld(state, idle(), 0.05, () => 0.9);
    expect(state.player.health).toBeLessThan(100);
    expect(state.player.health).toBeGreaterThan(86); // 14 raw damage -> ~7 absorbed
    expect(state.player.armorDurability).toBeLessThan(50);
  });

  it('applies infection from mutated zombies and cures it with an Antiviral Injector', () => {
    const state = fresh();
    state.player.infected = true;
    state.player.infectionSeverity = 25;
    const item = addItemToInventory(state.player, 'antiviral', 'av-1');
    expect(item).not.toBeNull();

    const used = useInventoryItem(state, item!.id);
    expect(used).toBe(true);
    expect(state.player.infected).toBe(false);
    expect(state.player.infectionSeverity).toBe(0);
  });

  it('searches a world container and awards items, cash, and XP', () => {
    const state = fresh();
    state.map.containers.push({
      id: 'cnt-test',
      kind: 'military_cabinet',
      label: 'Secronom Locker',
      x: state.player.x + 0.5,
      y: state.player.y,
      searched: false,
      searchProgress: 0,
      searchDuration: 0.2,
      threatTier: 2,
    });

    stepFor(state, { ...idle(), interact: true }, 0.3, () => 0.99);
    expect(state.map.containers[0].searched).toBe(true);
    expect(state.player.carriedCash).toBeGreaterThan(0);
    expect(state.player.inventory.length).toBeGreaterThan(0);
    expect(state.events.some((e) => e.type === 'container_searched')).toBe(true);
  });

  it('fires ranged acid projectiles from Spitter zombies', () => {
    const state = fresh();
    state.player.x = 2;
    state.player.y = 21;
    state.player.inSafeZone = false;
    state.player.threatTier = threatTierAt(state.map, 2, 21);
    const spitter = createZombie('z-spit', 'spitter', {
      x: state.player.x + 5,
      y: state.player.y,
    });
    spitter.alerted = true;
    spitter.spitCooldown = 0;
    state.zombies.push(spitter);

    stepWorld(state, idle(), 0.05, fixedRng);
    expect(state.projectiles.length).toBe(1);
    expect(state.events.some((e) => e.type === 'acid_spit')).toBe(true);
  });

  it('scales monsters and loot with risk: quiet near the Outpost, dense and rich deep out', () => {
    for (const t of [0, 1, 2] as ThreatTier[]) {
      const next = (t + 1) as ThreatTier;
      expect(spawnIntervalFor(next)).toBeLessThan(spawnIntervalFor(t));
      expect(localZombieCapFor(next)).toBeGreaterThan(localZombieCapFor(t));
      expect(killDropChanceFor(next)).toBeGreaterThan(killDropChanceFor(t));
    }

    const spawnTickInSafeZone = (preexisting: number) => {
      const state = fresh();
      state.player.x = 21;
      state.player.y = 21;
      for (let i = 0; i < preexisting; i += 1) {
        state.zombies.push(createZombie(`z-cap-${i}`, 'walker', { x: 21 + 11, y: 17 + i * 2 }));
      }
      state.spawnTimer = 0;
      stepWorld(state, idle(), 0.05, fixedRng);
      return state.zombies.length;
    };
    const cap = localZombieCapFor(0);
    expect(spawnTickInSafeZone(cap - 1)).toBe(cap);
    expect(spawnTickInSafeZone(cap)).toBe(cap);

    const world = createWorld(77, 0);
    const nearOutpost = world.zombies.filter((z) => threatTierAt(world.map, z.x, z.y) <= 1).length;
    expect(nearOutpost).toBe(world.zombies.length);
    expect(nearOutpost).toBeGreaterThan(0);
  });

  it('allocates attributes and weapon proficiencies and supports Marketplace purchases', () => {
    const state = fresh();
    state.player.statPoints = 2;
    state.player.proficiencyPoints = 10;
    state.player.bankCash = 500;

    expect(allocateAttributePoint(state.player, 'endurance')).toBe(true);
    expect(state.player.maxHealth).toBeGreaterThan(100);
    expect(allocateProficiencyPoint(state.player, 'shotgun', 5)).toBe(true);
    expect(state.player.proficiencies.shotgun).toBe(25);
    expect(buyMarketplaceItem(state, 'medkit')).toBe(true);

    state.player.health = 40;
    expect(outpostHealService(state.player)).toBe(true);
    expect(state.player.health).toBe(state.player.maxHealth);
  });

  it('drops unbanked scrap on a corpse when killed, preserves banked stash, and lets a respawned run recover it', () => {
    const state = fresh();
    state.player.stash = 25;
    state.player.carriedScrap = 14;
    state.player.health = 10;
    state.player.armorDurability = 0;
    const zombie = createZombie('z-kill', 'brute', {
      x: state.player.x + 0.4,
      y: state.player.y,
    });
    zombie.alerted = true;
    state.zombies.push(zombie);

    stepWorld(state, idle(), 0.05, fixedRng);
    expect(state.phase).toBe('dead');
    expect(state.player.alive).toBe(false);
    expect(state.player.deaths).toBe(1);
    expect(state.player.carriedScrap).toBe(0);
    expect(state.player.stash).toBe(25);

    const corpse = state.pickups.find((p) => p.kind === 'corpse');
    expect(corpse).toBeDefined();
    expect(corpse!.amount).toBe(14);

    const respawned = restartWorld(state, 99);
    expect(respawned.phase).toBe('playing');
    expect(respawned.player.alive).toBe(true);
    expect(respawned.player.stash).toBe(25);
    expect(respawned.pickups.some((p) => p.kind === 'corpse')).toBe(true);
  });

  it('Tightens spawn intervals and updates readout labels as the survivor pushes into higher threat bands', () => {
    expect(spawnIntervalFor(3)).toBeLessThan(spawnIntervalFor(1));
    const state = fresh();
    expect(threatReadout(state).tier).toBe(1);
    state.player.x = 21 + 46;
    state.player.y = 21;
    state.player.threatTier = threatTierAt(state.map, state.player.x, state.player.y);
    expect(threatReadout(state).tier).toBe(3);
  });

  it('enforces 2.0x player-centered camera transform, <=1.5px shake cap, 4-frame linear recoil, and spatial audio attenuation', () => {
    const cam = computeCameraTransform({ x: 21, y: 21 }, 1280, 720);
    expect(cam.zoom).toBe(CAMERA_ZOOM);
    const centerWorld = screenToWorldWithCamera(640, 360, cam.rootPosition, cam.zoom);
    expect(centerWorld.x).toBeCloseTo(21, 3);
    expect(centerWorld.y).toBeCloseTo(21, 3);

    const bounds = getChunkStreamingBounds(21, 21, 1920, 1080);
    expect(bounds.streamRadius).toBeGreaterThanOrEqual(2);
    expect(bounds.unloadRadius).toBeGreaterThan(bounds.streamRadius);

    expect(computeWeaponShakePx('shotgun', 1.2)).toBeLessThanOrEqual(MAX_HEAVY_SHAKE_PX);
    expect(computeWeaponShakePx('sniper', 1.5)).toBe(1.5);

    let recoil = computeRecoilVector(0, 'shotgun');
    const startMag = Math.hypot(recoil.x, recoil.y);
    expect(startMag).toBeGreaterThan(0);
    for (let i = 0; i < 4; i += 1) {
      recoil = stepLinearRecoil(recoil, 1 / 60, startMag, 4);
    }
    expect(recoil.x).toBe(0);
    expect(recoil.y).toBe(0);

    const near = computeSpatialAttenuation({ x: 21, y: 21 }, { x: 22, y: 21 });
    const far = computeSpatialAttenuation({ x: 21, y: 21 }, { x: 45, y: 21 });
    expect(near.gain).toBeGreaterThan(0.8);
    expect(far.gain).toBe(0);
  });

  it('lands a close directional machete swing and physically knocks the zombie away', () => {
    const state = fresh();
    state.player.activeWeapon = 'melee';
    state.player.x = 4;
    state.player.angle = 0;
    const zombie = createZombie('z-melee', 'walker', { x: 6, y: 21 });
    zombie.alerted = true;
    state.zombies.push(zombie);
    const startHealth = zombie.health;

    stepWorld(state, { ...idle(), firing: true }, 0.05, fixedRng);
    expect(zombie.health).toBe(startHealth); // Wind-up has not reached the slash impact yet.
    for (let frame = 0; frame < 3; frame += 1) {
      stepWorld(state, { ...idle(), firing: true }, 0.05, fixedRng);
    }
    const preImpactX = zombie.x;
    stepWorld(state, { ...idle(), firing: true }, 0.05, fixedRng);

    expect(state.events.some((event) => event.type === 'zombie_hit' && event.weapon === 'melee')).toBe(true);
    expect(zombie.health).toBeLessThan(startHealth);
    expect(zombie.knockbackVx).toBeGreaterThan(2);
    expect(zombie.knockbackTimer).toBeGreaterThan(0.4);
    expect(zombie.x).toBeGreaterThan(preImpactX);
    const swingEvent = state.events.find((event) => event.type === 'shot' && event.weapon === 'melee');
    expect(swingEvent?.type === 'shot' ? swingEvent.traces : null).toEqual([]);
  });

  it('does not hit a zombie outside the forward swing arc', () => {
    const state = fresh();
    state.player.activeWeapon = 'melee';
    state.player.x = 4;
    state.player.angle = 0;
    const behind = createZombie('z-behind', 'walker', { x: 2, y: 21 });
    const startHealth = behind.health;
    state.zombies.push(behind);

    stepWorld(state, { ...idle(), firing: true }, 0.05, fixedRng);

    expect(behind.health).toBe(startHealth);
    expect(state.events.some((event) => event.type === 'zombie_hit' && event.weapon === 'melee')).toBe(false);
  });

  it('does not repeat machete attacks while the swing input stays held', () => {
    const state = fresh();
    state.player.activeWeapon = 'melee';

    for (let frame = 0; frame < 24; frame += 1) {
      stepWorld(state, { ...idle(), firing: true }, 0.05, fixedRng);
    }
    expect(state.events.filter((event) => event.type === 'shot' && event.weapon === 'melee')).toHaveLength(1);

    stepWorld(state, idle(), 0.05, fixedRng);
    for (let frame = 0; frame < 14; frame += 1) stepWorld(state, idle(), 0.05, fixedRng);
    stepWorld(state, { ...idle(), firing: true }, 0.05, fixedRng);
    expect(state.events.filter((event) => event.type === 'shot' && event.weapon === 'melee')).toHaveLength(2);
  });

  it('centres the player consistently in portrait, landscape, and desktop logical viewports', () => {
    const player = { x: 38.25, y: 17.75 };
    const shake = { x: 1.25, y: -0.75 };

    for (const [width, height] of [[375, 812], [812, 375], [1440, 900]]) {
      const zoom = zoomForViewport(width, height);
      const camera = computeCameraTransform(player, width, height, shake, zoom);
      const projectedPlayer = worldToViewportScreen(
        player.x,
        player.y,
        camera.rootPosition,
        camera.zoom,
      );

      expect(projectedPlayer.x).toBeCloseTo(width / 2 + shake.x, 0);
      expect(projectedPlayer.y).toBeCloseTo(height / 2 + shake.y, 0);
    }
  });
});

describe('weapon loadout', () => {
  it('only swaps to melee or the two slotted firearms', () => {
    const state = fresh();
    expect(state.player.loadout).toEqual(['rifle', 'shotgun']);

    stepWorld(state, { ...idle(), weapon: 'pistol' }, 1 / 60);
    expect(state.player.activeWeapon).toBe('rifle');

    stepWorld(state, { ...idle(), weapon: 'shotgun' }, 1 / 60);
    expect(state.player.activeWeapon).toBe('shotgun');

    stepWorld(state, { ...idle(), weapon: 'melee' }, 1 / 60);
    expect(state.player.activeWeapon).toBe('melee');
  });

  it('assigns a firearm to a slot and swaps it out of the other one', () => {
    const state = fresh();
    expect(assignLoadoutSlot(state, 1, 'pistol')).toBe(true);
    expect(state.player.loadout).toEqual(['rifle', 'pistol']);

    // Assigning the pistol to slot 0 must vacate slot 1, never fill both.
    expect(assignLoadoutSlot(state, 0, 'pistol')).toBe(true);
    expect(state.player.loadout).toEqual(['pistol', 'rifle']);

    expect(assignLoadoutSlot(state, 0, 'melee')).toBe(false);
    expect(assignLoadoutSlot(state, 0, 'pistol')).toBe(false);
  });

  it('applies a loadout assignment that arrives through the input stream', () => {
    const state = fresh();
    stepWorld(state, { ...idle(), loadoutSlot: 1, loadoutWeapon: 'sniper' }, 1 / 60);
    expect(state.player.loadout).toEqual(['rifle', 'sniper']);
  });

  it('keeps the loadout across a respawn', () => {
    const state = fresh();
    assignLoadoutSlot(state, 0, 'smg');
    expect(restartWorld(state, 99).player.loadout).toEqual(['smg', 'shotgun']);
  });
});
