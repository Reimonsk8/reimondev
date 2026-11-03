import { describe, expect, it } from 'vitest';
import {
  SPRITE_KEYS,
  buildInitialSynchronousTextures,
  enforceNearestNeighborFiltering,
} from './assets';
import {
  InteriorManager,
  PORTAL_BARRICADE_SCRAP_COST,
  PORTAL_TRANSITION_SECONDS,
  evaluateStrictIndoorFog,
} from './interiors';
import { distance } from './isometric';
import { computeSectorMapSnapshot } from './map';
import { evaluateZombieAI } from './zombieAI';
import {
  DARKNESS_MASK_ALPHA,
  FLASHLIGHT_ARC_DEG,
  FLASHLIGHT_RANGE_PX,
  PITCH_BLACK_MASK_ALPHA,
  computeLightingFrame,
  hasUnoccludedLightPath,
} from './lighting';
import {
  CUTAWAY_WALL_ALPHA,
  isPlayerInsideFootprint,
  stepBuildingOcclusion,
} from './occlusion';
import { calculateRoomVision } from './vision';
import {
  computeWeaponAcousticAggroSpike,
  evaluateZombieAggroDecision,
  hasLineOfSight,
} from './aggro';
import { resolveCharacterAnimState } from './animation';
import {
  canEquipWeapon,
  computeProgressiveThreatTier,
  getZoneThemeForCoord,
  selectProgressiveLootTemplate,
  selectProgressiveZombieVariant,
  selectZoneThemedZombieVariant,
} from './spawner';
import {
  OUTPOSTS,
  SAFE_CENTER,
  SAFE_RADIUS,
  THREAT_BAND_1,
  THREAT_BAND_2,
  addItemToInventory,
  buildSpatialNetPacket,
  canPlaceInGrid,
  chooseExtendedZombieVariant,
  chooseZombieVariant,
  buildSectorGrid,
  createMap,
  createWorld,
  createZombie,
  distanceOutsideSafeZone,
  findSpawnPoint,
  generateChunk,
  isBlocked,
  isInsideSafeZone,
  moveInventoryItem,
  moveWithCollision,
  safeZoneStopPoint,
  surfaceAt,
  syncActiveChunks,
  threatTierAt,
} from './world';

describe('sector generation', () => {
  it('rebuilds the exact same sector from a seed', () => {
    const first = createMap(4242);
    const second = createMap(4242);
    expect(second).toEqual(first);
    expect(createMap(4243)).not.toEqual(first);
  });

  it('keeps every structure out of the safe-zone interior', () => {
    const map = createMap(7);
    for (const obstacle of map.obstacles) {
      const center = {
        x: obstacle.x + obstacle.width / 2,
        y: obstacle.y + obstacle.height / 2,
      };
      expect(distance(center, map.safeCenter)).toBeGreaterThan(map.safeRadius + 1);
    }
  });

  it('treats structures and world borders as solid', () => {
    const map = createMap(12);
    expect(isBlocked(map, 0.2, 0.2, 0.4)).toBe(true);
    expect(isBlocked(map, SAFE_CENTER.x, SAFE_CENTER.y, 0.36)).toBe(false);
    const first = map.obstacles[0];
    expect(
      isBlocked(map, first.x + first.width / 2, first.y + first.height / 2, 0.36),
    ).toBe(true);
  });

  it('slides along an obstacle when only one axis is blocked', () => {
    const map = createMap(99);
    map.obstacles = [{ id: 'wall', x: 10, y: 10, width: 2, height: 2, kind: 'ruin' }];
    const slid = moveWithCollision(map, 9.5, 11, 0.4, 0.5, 0.36);
    expect(slid.x).toBeCloseTo(9.5, 6);
    expect(slid.y).toBeCloseTo(11.5, 6);
  });

  it('populates named safe outposts and searchable world containers outside S-Zone', () => {
    const map = createMap(108);
    expect(map.outposts.map((o) => o.name)).toEqual(
      expect.arrayContaining(["Nastya's Holdout", 'Fort Pastor', 'Secronom Bunker']),
    );
    expect(OUTPOSTS.length).toBe(4);
    expect(map.containers.length).toBeGreaterThan(5);
    for (const c of map.containers) {
      expect(isInsideSafeZone(map, c.x, c.y)).toBe(false);
    }
  });
});

describe('threat gradient and safe zone', () => {
  const map = createMap(1);

  it('escalates threat tier purely with distance from the S-Zone', () => {
    expect(threatTierAt(map, SAFE_CENTER.x, SAFE_CENTER.y)).toBe(0);
    expect(threatTierAt(map, SAFE_CENTER.x + SAFE_RADIUS + 2, SAFE_CENTER.y)).toBe(1);
    expect(threatTierAt(map, SAFE_CENTER.x + THREAT_BAND_1 + 1, SAFE_CENTER.y)).toBe(2);
    expect(threatTierAt(map, SAFE_CENTER.x + THREAT_BAND_2 + 1, SAFE_CENTER.y)).toBe(3);
    expect(distanceOutsideSafeZone(map, SAFE_CENTER.x, SAFE_CENTER.y)).toBe(0);
  });

  it('pushes any zombie position inside the perimeter back outside', () => {
    const stopped = safeZoneStopPoint(map, SAFE_CENTER.x + 1, SAFE_CENTER.y, 0.36);
    expect(isInsideSafeZone(map, stopped.x, stopped.y)).toBe(false);
  });

  it('biases zombie variants toward runners and brutes at higher tiers', () => {
    expect(chooseZombieVariant(0, () => 0.99)).toBe('walker');
    expect(chooseZombieVariant(1, () => 0.5)).toBe('walker');
    expect(chooseZombieVariant(1, () => 0.9)).toBe('runner');
    expect(chooseZombieVariant(2, () => 0.1)).toBe('walker');
    expect(chooseZombieVariant(2, () => 0.6)).toBe('runner');
    expect(chooseZombieVariant(2, () => 0.95)).toBe('brute');
    expect(createZombie('z', 'brute', { x: 4, y: 4 }).maxHealth).toBeGreaterThan(
      createZombie('z', 'runner', { x: 4, y: 4 }).maxHealth,
    );
  });

  it('spawns extended Dead Frontier variants including spitters, leapers, wraiths, hounds, and titans', () => {
    expect(chooseExtendedZombieVariant(2, 40, () => 0.5)).toBe('burning');
    expect(chooseExtendedZombieVariant(2, 40, () => 0.65)).toBe('spitter');
    expect(chooseExtendedZombieVariant(3, 80, () => 0.6)).toBe('leaper');
    expect(chooseExtendedZombieVariant(3, 80, () => 0.72)).toBe('wraith');
    expect(chooseExtendedZombieVariant(3, 80, () => 0.82)).toBe('hound');
    expect(chooseExtendedZombieVariant(3, 80, () => 0.98)).toBe('titan');
  });

  it('never picks a spawn point inside the safe zone or inside an obstacle', () => {
    let s = 1;
    const rng = () => {
      s = (s * 48271) % 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let i = 0; i < 20; i += 1) {
      const p = findSpawnPoint(map, SAFE_CENTER, SAFE_RADIUS + 2, 18, rng);
      expect(p).not.toBeNull();
      expect(isInsideSafeZone(map, p!.x, p!.y)).toBe(false);
      expect(isBlocked(map, p!.x, p!.y, 0.5)).toBe(false);
    }
  });

  it('starts a fresh world with the survivor inside the S-Zone, 7 weapons, and grid inventory', () => {
    const world = createWorld(77, 45);
    expect(world.player.inSafeZone).toBe(true);
    expect(world.player.stash).toBe(45);
    expect(world.zombies.length).toBeGreaterThan(0);
    expect(Object.keys(world.player.weapons)).toEqual(
      expect.arrayContaining(['melee', 'pistol', 'rifle', 'shotgun', 'smg', 'sniper', 'heavy']),
    );
    expect(world.player.inventory.length).toBeGreaterThan(0);
    const added = addItemToInventory(world.player, 'trauma_kit', 'test-tk');
    expect(added).not.toBeNull();
    expect(
      canPlaceInGrid(
        world.player.inventoryCols,
        world.player.inventoryRows,
        world.player.inventory,
        2,
        2,
        added!.gridX,
        added!.gridY,
      ),
    ).toBe(false);
    expect(moveInventoryItem(world.player, added!.id, 4, 2)).toBe(true);
  });

  it('streams infinite chunks dynamically around the survivor and culls distant chunks', () => {
    const world = createWorld(101, 0);
    expect(world.map.infinite).toBe(true);
    expect(isBlocked(world.map, -25, -25, 0.36)).toBe(false);

    const streamed = syncActiveChunks(world.map, 75, -40, 1);
    expect(streamed.length).toBeGreaterThanOrEqual(9);
    const farChunk = generateChunk(world.map.seed, 5, -3);
    expect(farChunk.props.length).toBeGreaterThan(0);
    expect(farChunk.obstacles.length).toBeGreaterThan(0);
  });

  it('lays props out on the street grid: lamps on sidewalks, cars in the street, buildings in lots', () => {
    const map = createMap(31);
    const chunks = [];
    for (let cx = -4; cx <= 6; cx += 1) for (let cy = -4; cy <= 6; cy += 1) chunks.push(generateChunk(31, cx, cy));
    const props = chunks.flatMap((c) => c.props);
    const ruins = [...map.obstacles, ...chunks.flatMap((c) => c.obstacles)].filter((o) => o.kind === 'ruin');
    const wrecks = [...map.obstacles, ...chunks.flatMap((c) => c.obstacles)].filter((o) => o.kind === 'wreck');

    expect(props.some((p) => p.kind === 'streetlight')).toBe(true);
    for (const p of props.filter((q) => q.kind === 'streetlight')) expect(surfaceAt(p.x, p.y)).toBe('sidewalk');
    for (const p of props.filter((q) => q.kind === 'burned_car' || q.kind === 'barricade')) {
      expect(surfaceAt(p.x, p.y)).toBe('road');
    }
    for (const w of wrecks) expect(surfaceAt(w.x + w.width / 2, w.y + w.height / 2)).toBe('road');
    expect(ruins.length).toBeGreaterThan(10);
    for (const r of ruins) {
      for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        expect(surfaceAt(r.x + fx * (r.width - 0.01), r.y + fy * (r.height - 0.01))).toBe('lot');
      }
    }
  });

  it('builds spatial AoI multiplayer packets filtered by vision radius', () => {
    const world = createWorld(202, 0);
    world.zombies = [
      createZombie('near-z', 'walker', { x: 22, y: 22 }),
      createZombie('far-z', 'brute', { x: 120, y: 120 }),
    ];
    const packet = buildSpatialNetPacket(world, { x: 21, y: 21 }, 12);
    expect(packet.zombies.map((z) => z.id)).toEqual(['near-z']);
    expect(packet.players.length).toBe(1);
  });

  it('scales progressive threat tier, enemy variants, loot, and weapon skill gates', () => {
    const world = createWorld(303, 0);
    expect(computeProgressiveThreatTier(world.map, SAFE_CENTER.x, SAFE_CENTER.y)).toBe(0);
    expect(selectProgressiveZombieVariant(0, 50, () => 0.99)).toBe('walker');
    expect(selectProgressiveZombieVariant(1, 20, () => 0.9)).toBe('hound');
    expect(selectProgressiveZombieVariant(3, 80, () => 0.97)).toBe('titan');
    expect(selectProgressiveLootTemplate(0, () => 0.1)).toBe('canned_beans');
    expect(canEquipWeapon(world.player, 'rifle')).toBe(true);
    world.player.weapons.heavy.unlocked = false;
    expect(canEquipWeapon(world.player, 'heavy')).toBe(false);
    world.player.level = 12;
    world.player.proficiencies.heavy = 55;
    expect(canEquipWeapon(world.player, 'heavy')).toBe(true);
  });

  it('transitions into building interiors, triggers horde breach exit lock, and resumes outdoor position', () => {
    const world = createWorld(404, 0);
    const door = world.map.doors![0];
    expect(door).toBeDefined();
    world.player.x = door.x;
    world.player.y = door.y;
    door.state = 'open';
    const interior = InteriorManager.enterBuilding(world, door);
    expect(world.activeInterior?.id).toBe(interior.id);
    expect(world.player.x).toBeCloseTo(interior.entrySpawn.x, 2);

    const breachAdded = InteriorManager.triggerHordeBreach(world, () => 0.5);
    expect(breachAdded).toBeGreaterThan(0);
    expect(world.activeInterior?.exitLocked).toBe(true);
    expect(InteriorManager.tryExitBuilding(world)).toBe(false);

    world.zombies = [];
    expect(InteriorManager.tryExitBuilding(world)).toBe(true);
    expect(world.activeInterior).toBeNull();
    expect(world.player.x).toBeCloseTo(door.x, 2);
    expect(world.player.y).toBeCloseTo(door.y + 0.9, 2);
  });

  it('computes readable indoor lighting and blocks shadows through intervening walls', () => {
    const world = createWorld(505, 0);
    world.player.threatTier = 3;
    const frame = computeLightingFrame(
      world,
      { x: 400, y: 300 },
      { x: 0, y: 0 },
      { x: 550, y: 300 },
      1280,
      720,
      0,
    );
    expect(FLASHLIGHT_ARC_DEG).toBe(60);
    expect(FLASHLIGHT_RANGE_PX).toBe(280);
    expect(frame.maskAlpha).toBeCloseTo(DARKNESS_MASK_ALPHA, 2);
    expect(frame.maskAlpha).toBeLessThan(PITCH_BLACK_MASK_ALPHA);
    expect(frame.conePolygon.length).toBeGreaterThanOrEqual(16);

    const door = world.map.doors![0]!;
    world.player.x = door.x;
    world.player.y = door.y;
    door.state = 'open';
    InteriorManager.enterBuilding(world, door);
    const interiorLighting = computeLightingFrame(
      world,
      { x: 400, y: 300 },
      { x: 0, y: 0 },
      { x: 550, y: 300 },
      1280,
      720,
      0,
    );
    expect(interiorLighting.maskAlpha).toBeLessThan(DARKNESS_MASK_ALPHA);
    expect(interiorLighting.pointLights.find(({ id }) => id.startsWith('exit_'))?.alpha).toBe(0.88);
    door.state = 'closed';
    expect(computeLightingFrame(
      world,
      { x: 400, y: 300 },
      { x: 0, y: 0 },
      { x: 550, y: 300 },
      1280,
      720,
      0,
    ).pointLights.find(({ id }) => id.startsWith('exit_'))?.alpha).toBe(0.38);
    const caster = { x: 4, y: 0.5 };
    const wall = { id: 'wall', x: 1.5, y: -0.5, width: 0.5, height: 2, kind: 'ruin' as const };
    const target = { id: 'target', x: 3.5, y: 0, width: 1, height: 1, kind: 'wreck' as const };
    expect(hasUnoccludedLightPath({ x: 0, y: 0 }, caster, [wall, target], target.id)).toBe(false);
    expect(hasUnoccludedLightPath({ x: 0, y: 0 }, caster, [target], target.id)).toBe(true);
  });

  it('keeps higher threat bands farther from the starting holdout and aligns progressive threat', () => {
    expect(threatTierAt(map, SAFE_CENTER.x + 29, SAFE_CENTER.y)).toBe(1);
    expect(computeProgressiveThreatTier(map, SAFE_CENTER.x + 29, SAFE_CENTER.y)).toBe(1);
    expect(threatTierAt(map, SAFE_CENTER.x + 31, SAFE_CENTER.y)).toBe(2);
    expect(computeProgressiveThreatTier(map, SAFE_CENTER.x + 31, SAFE_CENTER.y)).toBe(2);
    expect(threatTierAt(map, SAFE_CENTER.x + 46, SAFE_CENTER.y)).toBe(3);
    expect(computeProgressiveThreatTier(map, SAFE_CENTER.x + 46, SAFE_CENTER.y)).toBe(3);
  });

  it('builds a 5x5 expedition atlas with the Sector 09 outpost represented', () => {
    const sectors = buildSectorGrid(1, 1, 2);
    expect(sectors).toHaveLength(25);
    expect(sectors.find((sector) => sector.outpostId === 'sector09')?.code).toBe('A1');
  });

  it('keeps far streamed geometry from changing local flashlight shadows', () => {
    const world = createWorld(606, 0);
    const args = [
      { x: 400, y: 300 },
      { x: 0, y: 0 },
      { x: 550, y: 300 },
      1280,
      720,
      0,
    ] as const;
    const expected = computeLightingFrame(world, ...args).shadowQuads;
    world.map.obstacles.push(...Array.from({ length: 300 }, (_, index) => ({
      id: `distant-lighting-obstacle-${index}`,
      x: 500 + index * 3,
      y: 500,
      width: 1,
      height: 1,
      kind: 'ruin' as const,
    })));
    expect(computeLightingFrame(world, ...args).shadowQuads).toEqual(expected);
  });

  it('fades building roof to 0 inside footprint, punctures room vision through open doors, and emits acoustic pulse on smash', () => {
    const footprint = {
      id: 'bldg-1',
      x: 10,
      y: 10,
      width: 6,
      height: 6,
      roofAlpha: 1,
      frontWallAlpha: 1,
      playerInside: false,
    };
    expect(isPlayerInsideFootprint({ x: 12, y: 12 }, footprint)).toBe(true);
    stepBuildingOcclusion(footprint, { x: 12, y: 12 }, 0.5);
    expect(footprint.roofAlpha).toBe(0);
    expect(footprint.frontWallAlpha).toBeCloseTo(CUTAWAY_WALL_ALPHA, 2);
    stepBuildingOcclusion(footprint, { x: 2, y: 2 }, 0.1);
    expect(footprint.roofAlpha).toBe(1);

    const world = createWorld(808, 0);
    const door = world.map.doors![0];
    world.player.x = door.x;
    world.player.y = door.y;
    door.state = 'open';
    const interior = InteriorManager.enterBuilding(world, door);
    const portal = InteriorManager.findNearestPortal(
      { ...world, player: { ...world.player, x: interior.width * 0.25, y: interior.height * 0.52 } },
      5,
    );
    expect(portal).not.toBeNull();
    const prevAggro = world.aggroIndex;
    const nextState = InteriorManager.interactWithPortal(world, portal!.id, 'smash');
    expect(nextState).toBe('smashed');
    expect(world.aggroIndex).toBeGreaterThan(prevAggro);

    const vision = calculateRoomVision(
      world.player,
      interior.obstacles,
      [],
      [],
      interior.zombies,
      11.5,
      36,
      { width: interior.width, height: interior.height },
    );
    expect(vision.visibilityPolygonWorld.length).toBe(36);
  });

  it('uses one portal state for movement, sight, timed opening, and scrap-funded barricades', () => {
    const world = createWorld(829, 0);
    const door = world.map.doors![0]!;
    world.player.x = door.x;
    world.player.y = door.y;
    door.state = 'open';
    const interior = InteriorManager.enterBuilding(world, door);
    const portal = InteriorManager.findNearestPortal(
      { ...world, player: { ...world.player, x: interior.width * 0.25, y: interior.height * 0.52 } },
      5,
    )!;
    const blocker = () => InteriorManager.getBlockingPortalObstacles(interior.id)
      .find((obstacle) => obstacle.id === `portal-collision-${portal.id}`);
    const distantGeometry = Array.from({ length: 300 }, (_, index) => ({
      id: `far-ray-obstacle-${index}`,
      x: 500 + index * 3,
      y: 500,
      width: 1,
      height: 1,
      kind: 'ruin' as const,
    }));

    expect(blocker()).toBeDefined();
    expect(hasLineOfSight(
      { x: portal.x - 1, y: portal.y },
      { x: portal.x + 1, y: portal.y },
      [...distantGeometry, blocker()!],
    )).toBe(false);

    expect(InteriorManager.interactWithPortal(world, portal.id, 'open')).toBe('opening');
    expect(blocker()).toBeDefined(); // Clearance only changes after the door finishes opening.
    InteriorManager.stepPortalTransitions(world, PORTAL_TRANSITION_SECONDS);
    expect(portal.state).toBe('open');
    expect(blocker()).toBeUndefined();
    expect(hasLineOfSight(
      { x: portal.x - 1, y: portal.y },
      { x: portal.x + 1, y: portal.y },
      [...distantGeometry, ...(blocker() ? [blocker()!] : [])],
    )).toBe(true);

    world.player.x = portal.x;
    world.player.y = portal.y;
    expect(InteriorManager.interactWithPortal(world, portal.id, 'close')).toBe('open');
    world.player.x = portal.x - 2;
    world.player.y = portal.y;
    const doorwayZombie = createZombie('portal-blocker', 'walker', { x: portal.x, y: portal.y });
    world.zombies.push(doorwayZombie);
    expect(InteriorManager.interactWithPortal(world, portal.id, 'close')).toBe('open');
    world.zombies = world.zombies.filter(({ id }) => id !== doorwayZombie.id);
    expect(InteriorManager.interactWithPortal(world, portal.id, 'close')).toBe('closing');
    InteriorManager.stepPortalTransitions(world, PORTAL_TRANSITION_SECONDS);
    expect(portal.state).toBe('closed');

    world.player.carriedScrap = PORTAL_BARRICADE_SCRAP_COST - 1;
    InteriorManager.interactWithPortal(world, portal.id, 'barricade');
    expect(portal.state).toBe('closed');
    world.player.carriedScrap = PORTAL_BARRICADE_SCRAP_COST;
    InteriorManager.interactWithPortal(world, portal.id, 'barricade');
    expect(world.player.carriedScrap).toBe(0);
    expect(portal.state).toBe('barricaded');
    expect(blocker()).toBeDefined();
    InteriorManager.interactWithPortal(world, portal.id, 'smash');
    expect(portal.state).toBe('smashed');
    expect(blocker()).toBeUndefined();
  });

  it('applies the exterior entrance state to collision and enforces occupied-threshold rules', () => {
    const world = createWorld(830, 0);
    const door = world.map.doors![0]!;
    const blockers = () => InteriorManager.getBlockingBuildingDoorObstacles(world.map);
    expect(door.state).toBe('closed');
    expect(blockers().some(({ id }) => id === `door-collision-${door.id}`)).toBe(true);

    world.player.x = door.x;
    world.player.y = door.y;
    expect(InteriorManager.interactWithBuildingDoor(world, door, 'open')).toBe('opening');
    expect(blockers().some(({ id }) => id === `door-collision-${door.id}`)).toBe(true);
    InteriorManager.stepPortalTransitions(world, PORTAL_TRANSITION_SECONDS);
    expect(door.state).toBe('open');
    expect(blockers().some(({ id }) => id === `door-collision-${door.id}`)).toBe(false);

    expect(InteriorManager.interactWithBuildingDoor(world, door, 'close')).toBe('open');
    world.player.x = door.x;
    world.player.y = door.y + 1;
    const zombie = createZombie('threshold-occupant', 'walker', { x: door.x, y: door.y });
    world.zombies.push(zombie);
    expect(InteriorManager.interactWithBuildingDoor(world, door, 'close')).toBe('open');
    world.zombies = [];
    expect(InteriorManager.interactWithBuildingDoor(world, door, 'close')).toBe('closing');
    expect(blockers().some(({ id }) => id === `door-collision-${door.id}`)).toBe(true);
    InteriorManager.stepPortalTransitions(world, PORTAL_TRANSITION_SECONDS);
    expect(door.state).toBe('closed');

    world.player.carriedScrap = PORTAL_BARRICADE_SCRAP_COST;
    expect(InteriorManager.interactWithBuildingDoor(world, door, 'barricade')).toBe('barricaded');
    expect(world.player.carriedScrap).toBe(0);
    expect(InteriorManager.interactWithBuildingDoor(world, door, 'open')).toBe('barricaded');
    expect(InteriorManager.interactWithBuildingDoor(world, door, 'smash')).toBe('smashed');
    expect(blockers().some(({ id }) => id === `door-collision-${door.id}`)).toBe(false);
  });

  it('enforces 3-state acoustic/visual aggro AI and character animation state resolution', () => {
    const world = createWorld(909, 0);
    expect(computeWeaponAcousticAggroSpike(world.player.weapons.melee)).toBe(0);
    expect(computeWeaponAcousticAggroSpike(world.player.weapons.shotgun)).toBeGreaterThan(0);

    world.player.inSafeZone = false;
    world.player.x = 34;
    world.player.y = 34;
    const z = world.zombies[0];
    z.x = 35;
    z.y = 35;
    expect(hasLineOfSight(z, world.player, [])).toBe(true);
    const decision = evaluateZombieAggroDecision(z, world.player, world.map, [], [], 25, 0.016);
    expect(decision.state).toBe('CHARGING');

    expect(
      resolveCharacterAnimState({
        velocity: { x: 6, y: 0 },
        aimAngle: 0,
        alive: true,
        sprinting: true,
        firing: false,
        reloading: false,
        muzzleFlashTimer: 0,
        reloadTimer: 0,
      }),
    ).toBe('RUN');
  });

  it('computes 3x3 sector minimap snapshot, 4-state sound-driven AI, and strict indoor fog', () => {
    enforceNearestNeighborFiltering();
    const snap = computeSectorMapSnapshot({ x: SAFE_CENTER.x, y: SAFE_CENTER.y });
    expect(snap.currentCode).toBe('B2');
    expect(snap.formattedHeader).toContain("Block B2: Nastya's Holdout");
    expect(snap.cells).toHaveLength(9);

    const world = createWorld(42);
    world.player.x = 2;
    world.player.y = 2;
    world.player.inSafeZone = false;
    const z = createZombie('z-fsm', 'walker', { x: 2.3, y: 2 });
    const attackDec = evaluateZombieAI(z, world.player, world.map, [], [], 25, 0.1);
    expect(attackDec.state).toBe('ATTACK');
    expect(attackDec.inAttackRange).toBe(true);

    const door = world.map.doors![0]!;
    world.player.x = door.x;
    world.player.y = door.y;
    door.state = 'open';
    const interior = InteriorManager.enterBuilding(world, door);
    const fog = evaluateStrictIndoorFog(world.player, interior, world.zombies);
    expect(fog.roomFogAlpha.get(`${interior.id}-foyer`)).toBe(0);
    expect(fog.roomFogAlpha.get(`${interior.id}-west`)).toBeCloseTo(0.56);
  });

  it('builds synchronous textures for all sprites and restricts dangerous enemies to far zones', () => {
    const texMap = buildInitialSynchronousTextures();
    for (const key of SPRITE_KEYS) {
      expect(texMap.has(key)).toBe(true);
    }

    const map = createMap(77);
    const ruins = map.obstacles.filter((o) => o.kind === 'ruin');
    expect(ruins.length).toBeGreaterThan(0);
    for (const r of ruins) {
      expect(r.width).toBeGreaterThanOrEqual(2.5);
      expect(r.height).toBeGreaterThanOrEqual(2.5);
    }

    // Near Safe Outpost -> suburban_outskirts (only walker or runner)
    const nearX = SAFE_CENTER.x + SAFE_RADIUS + 2;
    const nearY = SAFE_CENTER.y;
    expect(getZoneThemeForCoord(map, nearX, nearY).id).toBe('suburban_outskirts');
    expect(selectZoneThemedZombieVariant(map, nearX, nearY, 20, () => 0.99)).toBe('runner');
    expect(selectZoneThemedZombieVariant(map, nearX, nearY, 20, () => 0.2)).toBe('walker');

    // Far sectors (> 55 tiles away) -> deep_bio_core (leaper / wraith / titan)
    const farX = SAFE_CENTER.x + 60;
    const farY = SAFE_CENTER.y + 20;
    expect(getZoneThemeForCoord(map, farX, farY).id).toBe('deep_bio_core');
    expect(selectZoneThemedZombieVariant(map, farX, farY, 80, () => 0.96)).toBe('titan');
  });
});
