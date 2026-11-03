import { clamp, distance } from './isometric';
import { selectProgressiveZombieVariant } from './spawner';
import type {
  BuildingDoor,
  InteriorInstance,
  InteriorKind,
  Obstacle,
  ThreatTier,
  Vec2,
  WorldContainer,
  WorldMap,
  WorldState,
  ZombieState,
} from './types';
import {
  UNEXPLORED_ROOM_FOG_ALPHA,
  UNEXPLORED_ROOM_FOG_COLOR,
  calculateRoomVision,
  type InteriorPortal,
  type InteriorRoomBounds,
  type PortalState,
  doesPortalBlockMovement,
  type RoomVisionResult,
} from './vision';
import { createZombie, rngFromSeed, threatTierAt } from './world';
import { emitSoundPulse } from './zombieAI';
import { BUILDING_DOOR_HEIGHT_WORLD, BUILDING_DOOR_WIDTH_WORLD } from './doorGeometry';
import { INTERIOR_EXPLORED_FOG_ALPHA, INTERIOR_UNEXPLORED_FOG_ALPHA } from './lighting';

/**
 * Scaled Project Zomboid Indoor Exploration Engine (`/engine/interiors.ts`).
 *
 * Directive 4:
 * - Scales indoor rooms and interior partitions strictly to integer 32x32 isometric grid
 *   coordinates (`INDOOR_ISO_GRID_PX = 32`).
 * - When crossing a building entrance:
 *   - Instantly hides roof layers (`roofAlpha = 0.0`) for that building footprint.
 *   - Makes North/West interior walls semi-transparent (`NORTH_WEST_WALL_CUTAWAY_ALPHA = 0.28`).
 *   - Enforces strict raycast room-by-room fog-of-war: unexplored interior rooms remain
 *     pitch black (`#000000`, `1.0` alpha) until the player opens a door or looks through a window.
 */
export const INDOOR_ISO_GRID_PX = 32;
export const NORTH_WEST_WALL_CUTAWAY_ALPHA = 0.28;
export const PITCH_BLACK_ROOM_FOG_COLOR = UNEXPLORED_ROOM_FOG_COLOR; // 0x000000
export const PITCH_BLACK_ROOM_FOG_ALPHA = UNEXPLORED_ROOM_FOG_ALPHA; // canonical opaque value for tests/tools

export interface InteriorSpec {
  kind: InteriorKind;
  titlePrefix: string;
  width: number;
  height: number;
  baseZombies: number;
  containerCount: number;
  breachChance: number;
  containerLabels: string[];
}

export const INTERIOR_SPECS: Record<InteriorKind, InteriorSpec> = {
  residential: {
    kind: 'residential',
    titlePrefix: 'Residential Flat',
    width: 12,
    height: 12,
    baseZombies: 3,
    containerCount: 4,
    breachChance: 0.25,
    containerLabels: [
      'Kitchen Counter',
      'Bedroom Dresser',
      'Rusted Oven',
      'Medicine Cabinet',
    ],
  },
  commercial: {
    kind: 'commercial',
    titlePrefix: 'Commercial Storefront',
    width: 16,
    height: 14,
    baseZombies: 5,
    containerCount: 5,
    breachChance: 0.5,
    containerLabels: [
      'Steel Filing Cabinet',
      'Pharmacy Counter',
      'Backroom Storage Rack',
      'Cashier Drawer',
      'Breakroom Fridge',
    ],
  },
  bunker: {
    kind: 'bunker',
    titlePrefix: 'Underground Bio-Bunker',
    width: 16,
    height: 16,
    baseZombies: 7,
    containerCount: 5,
    breachChance: 0.85,
    containerLabels: [
      'Secronom Vault Safe',
      'Classified Filing Cabinet',
      'Armory Ordnance Locker',
      'Cryo Specimen Counter',
      'Bio-Lab Centrifuge Chest',
    ],
  },
};

export type PortalInteractionAction = 'open' | 'close' | 'smash' | 'barricade';
export const PORTAL_TRANSITION_SECONDS = 0.22;
export const PORTAL_BARRICADE_SCRAP_COST = 4;

const interiorRoomsByInstance = new Map<string, InteriorRoomBounds[]>();
const interiorPortalsByInstance = new Map<string, InteriorPortal[]>();

/**
 * Snaps a coordinate to the 32x32 isometric grid (0.5-tile subgrid precision = 16px steps).
 */
export function snapToIsoGrid(value: number, step = 0.5): number {
  return Math.round(value / step) * step;
}

export function getInteriorRooms(interiorId: string): InteriorRoomBounds[] {
  return interiorRoomsByInstance.get(interiorId) ?? [];
}

export function getInteriorPortals(interiorId: string): InteriorPortal[] {
  return interiorPortalsByInstance.get(interiorId) ?? [];
}

/**
 * Returns whether an indoor obstacle is a North or West boundary/partition wall
 * that should be rendered semi-transparent (`0.28` alpha) so it never obscures the room floor.
 */
export function isNorthOrWestInteriorWall(
  obs: Obstacle,
  interiorBounds?: { width: number; height: number },
): boolean {
  if (obs.x <= 1.2 || obs.y <= 1.2) return true;
  if (!interiorBounds) return false;
  return (
    obs.y <= interiorBounds.height * 0.55 &&
    (obs.width > obs.height || obs.x <= interiorBounds.width * 0.52)
  );
}

/**
 * Evaluates strict room-by-room raycast fog-of-war:
 * - Currently visible rooms (player inside or raycast through open door / window): `0.0` alpha.
 * - Previously explored rooms behind closed doors: `0.78` alpha.
 * - Unexplored rooms behind closed doors: `1.0` pitch-black (`#000000`) alpha.
 */
export function evaluateStrictIndoorFog(
  playerPos: Vec2,
  interior: Pick<InteriorInstance, 'id' | 'width' | 'height' | 'obstacles'>,
  zombies: ZombieState[],
): RoomVisionResult & { roomFogAlpha: Map<string, number> } {
  const rooms = getInteriorRooms(interior.id);
  const portals = getInteriorPortals(interior.id);
  const vision = calculateRoomVision(
    playerPos,
    interior.obstacles,
    rooms,
    portals,
    zombies,
    11.5,
    72,
    { width: interior.width, height: interior.height },
  );

  const roomFogAlpha = new Map<string, number>();
  for (const room of rooms) {
    if (room.currentlyVisible) {
      roomFogAlpha.set(room.id, 0.0);
    } else if (room.explored) {
      roomFogAlpha.set(room.id, INTERIOR_EXPLORED_FOG_ALPHA);
    } else {
      roomFogAlpha.set(room.id, INTERIOR_UNEXPLORED_FOG_ALPHA);
    }
  }

  return { ...vision, roomFogAlpha };
}

export function createDoorsForMap(map: WorldMap): BuildingDoor[] {
  const doors: BuildingDoor[] = [];
  const ruins = map.obstacles.filter((o) => o.kind === 'ruin');

  ruins.slice(0, 12).forEach((ruin, idx) => {
    const doorX = snapToIsoGrid(ruin.x + ruin.width * 0.5, 0.5);
    const doorY = snapToIsoGrid(ruin.y + ruin.height + 0.5, 0.5);
    const tier = threatTierAt(map, doorX, doorY);
    const kind: InteriorKind =
      tier >= 3 ? 'bunker' : tier === 2 ? 'commercial' : 'residential';
    const spec = INTERIOR_SPECS[kind];
    doors.push({
      id: `door-${idx + 1}`,
      buildingId: ruin.id,
      kind,
      label: `${spec.titlePrefix} #${idx + 1}`,
      x: doorX,
      y: doorY,
      tier,
      state: 'closed',
      transitionTimer: 0,
      barricadeHp: 0,
      locked: false,
    });
  });

  return doors;
}

export class InteriorManager {
  static getBlockingBuildingDoorObstacles(map: WorldMap): Obstacle[] {
    return (map.doors ?? [])
      .filter((door) => door.state !== 'open' && door.state !== 'smashed')
      .map((door) => ({
        id: `door-collision-${door.id}`,
        x: door.x - BUILDING_DOOR_WIDTH_WORLD / 2,
        y: door.y - BUILDING_DOOR_HEIGHT_WORLD / 2,
        width: BUILDING_DOOR_WIDTH_WORLD,
        height: BUILDING_DOOR_HEIGHT_WORLD,
        kind: 'ruin' as const,
      }));
  }

  static interactWithBuildingDoor(
    state: WorldState,
    door: BuildingDoor,
    action: PortalInteractionAction = 'open',
  ): BuildingDoor['state'] {
    if (action === 'barricade') {
      if (door.state !== 'closed' || door.locked || state.player.carriedScrap < PORTAL_BARRICADE_SCRAP_COST) {
        return door.state;
      }
      state.player.carriedScrap -= PORTAL_BARRICADE_SCRAP_COST;
      door.state = 'barricaded';
      door.barricadeHp = 100;
      return door.state;
    }
    if (action === 'smash') {
      door.state = 'smashed';
      door.locked = false;
      door.barricadeHp = 0;
      state.aggroIndex = clamp(state.aggroIndex + 18, 0, 100);
      emitSoundPulse(state, door, 14, false, 0.55);
      return door.state;
    }
    if (door.locked || door.state === 'barricaded') return door.state;
    if (door.state === 'closed') {
      door.state = 'opening';
      door.transitionTimer = PORTAL_TRANSITION_SECONDS;
    } else if (door.state === 'open' || door.state === 'smashed') {
      if (
        distance(state.player, door) <= state.player.radius + 0.42 ||
        state.zombies.some((zombie) => distance(zombie, door) <= zombie.radius + 0.42)
      ) return door.state;
      door.state = 'closing';
      door.transitionTimer = PORTAL_TRANSITION_SECONDS;
    }
    return door.state;
  }

  static findNearestDoor(
    state: WorldState,
    maxDistance = 1.85,
  ): BuildingDoor | null {
    if (state.activeInterior) return null;
    const doors = state.map.doors ?? [];
    let best: BuildingDoor | null = null;
    let bestDist = maxDistance;
    for (const door of doors) {
      const d = distance(door, state.player);
      if (d <= bestDist) {
        bestDist = d;
        best = door;
      }
    }
    return best;
  }

  static isNearInteriorExit(
    state: WorldState,
    maxDistance = 1.85,
  ): boolean {
    const interior = state.activeInterior;
    if (!interior) return false;
    return distance(state.player, interior.exitDoor) <= maxDistance;
  }

  static findNearestPortal(
    state: WorldState,
    maxDistance = 1.75,
  ): InteriorPortal | null {
    const interior = state.activeInterior;
    if (!interior) return null;
    const portals = getInteriorPortals(interior.id);
    let best: InteriorPortal | null = null;
    let bestDist = maxDistance;
    for (const portal of portals) {
      const d = distance(portal, state.player);
      if (d <= bestDist) {
        bestDist = d;
        best = portal;
      }
    }
    return best;
  }

  /**
   * Interacts with an indoor door or window (`open`, `close`, `smash`, `barricade`).
   * Smashing glass or forcing a jammed/barricaded portal emits a loud `SoundPulse`
   * (`noiseRadius = 14`) that alerts nearby zombies into `INVESTIGATING`.
   */
  static interactWithPortal(
    state: WorldState,
    portalId: string,
    action: PortalInteractionAction = 'open',
  ): PortalState | null {
    const interior = state.activeInterior;
    if (!interior) return null;
    const portals = getInteriorPortals(interior.id);
    const portal = portals.find((p) => p.id === portalId);
    if (!portal) return null;
    const thresholdOccupied = () =>
      distance(state.player, portal) <= state.player.radius + 0.42 ||
      state.zombies.some((zombie) => distance(zombie, portal) <= zombie.radius + 0.42);

    if (action === 'barricade') {
      if (portal.kind !== 'door' || portal.state !== 'closed' || state.player.carriedScrap < PORTAL_BARRICADE_SCRAP_COST) {
        return portal.state;
      }
      state.player.carriedScrap -= PORTAL_BARRICADE_SCRAP_COST;
      portal.state = 'barricaded';
      portal.barricadeHp = 100;
      return portal.state;
    }

    if (action === 'smash') {
      portal.state = 'smashed';
      portal.barricadeHp = 0;
      state.aggroIndex = clamp(state.aggroIndex + 18, 0, 100);
      emitSoundPulse(state, { x: portal.x, y: portal.y }, 14, false, 0.55);
      return portal.state;
    }

    if (action === 'close' && (portal.state === 'open' || portal.state === 'smashed')) {
      if (thresholdOccupied()) return portal.state;
      portal.state = 'closing';
      portal.transitionTimer = PORTAL_TRANSITION_SECONDS;
      return portal.state;
    }

    if (portal.state === 'closed') {
      portal.state = 'opening';
      portal.transitionTimer = PORTAL_TRANSITION_SECONDS;
    } else if (portal.state === 'open' || portal.state === 'smashed') {
      if (thresholdOccupied()) return portal.state;
      portal.state = 'closing';
      portal.transitionTimer = PORTAL_TRANSITION_SECONDS;
    }
    return portal.state;
  }

  static stepPortalTransitions(state: WorldState, dt: number): void {
    for (const door of state.map.doors ?? []) {
      if (door.state !== 'opening' && door.state !== 'closing') continue;
      door.transitionTimer = Math.max(0, door.transitionTimer - dt);
      if (door.transitionTimer === 0) {
        door.state = door.state === 'opening' ? 'open' : 'closed';
      }
    }
    const interior = state.activeInterior;
    if (!interior) return;
    for (const portal of getInteriorPortals(interior.id)) {
      if (portal.state !== 'opening' && portal.state !== 'closing') continue;
      portal.transitionTimer = Math.max(0, portal.transitionTimer - dt);
      if (portal.transitionTimer === 0) {
        portal.state = portal.state === 'opening' ? 'open' : 'closed';
      }
    }
  }

  static getBlockingPortalObstacles(interiorId: string): Obstacle[] {
    return getInteriorPortals(interiorId)
      .filter(doesPortalBlockMovement)
      .map((portal) => ({
        id: `portal-collision-${portal.id}`,
        x: portal.x - portal.width * 0.5,
        y: portal.y - portal.height * 0.5,
        width: portal.width,
        height: portal.height,
        kind: 'ruin' as const,
      }));
  }

  static damageBarricadeByZombie(state: WorldState, zombie: ZombieState, dt: number): void {
    const interior = state.activeInterior;
    if (!interior || !zombie.alerted) return;
    for (const portal of getInteriorPortals(interior.id)) {
      if (portal.state !== 'barricaded' || distance(zombie, portal) > zombie.radius + 0.75) continue;
      portal.barricadeHp = Math.max(0, portal.barricadeHp - dt * 12);
      if (portal.barricadeHp === 0) {
        portal.state = 'smashed';
        emitSoundPulse(state, portal, 14, false, 0.55);
      }
    }
  }

  static generateInterior(
    door: BuildingDoor,
    seed: number,
    outdoorReturnPos: Vec2,
    outdoorZombiesBackup: ZombieState[],
    nextEntityIdStart = 1000,
  ): InteriorInstance {
    const spec = INTERIOR_SPECS[door.kind];
    const hash =
      (seed ^
        Math.imul(door.id.length + 17, 0x9e3779b9) ^
        Math.round(door.x * 97 + door.y * 193)) >>>
      0;
    const rng = rngFromSeed(hash);

    // Strictly integer 32x32 isometric grid dimensions
    const width = Math.round(spec.width);
    const height = Math.round(spec.height);
    const exitDoor: Vec2 = { x: Math.floor(width / 2), y: height - 1 };
    const entrySpawn: Vec2 = { x: Math.floor(width / 2), y: height - 2 };
    const instanceId = `interior-${door.id}`;

    // Multi-room layout aligned strictly to integer 32x32 tile coordinates
    const midY = Math.floor(height * 0.5);
    const midX = Math.floor(width * 0.5);
    const rooms: InteriorRoomBounds[] = [
      {
        id: `${instanceId}-foyer`,
        name: 'Entry Foyer',
        x: 1,
        y: midY,
        width: width - 2,
        height: height - midY - 1,
        explored: true,
        currentlyVisible: true,
      },
      {
        id: `${instanceId}-west`,
        name: door.kind === 'residential' ? 'Kitchen & Pantry' : 'West Wing',
        x: 1,
        y: 1,
        width: midX - 1,
        height: midY - 1,
        explored: false,
        currentlyVisible: false,
      },
      {
        id: `${instanceId}-east`,
        name: door.kind === 'residential' ? 'Master Bedroom' : 'Vault Wing',
        x: midX,
        y: 1,
        width: width - midX - 1,
        height: midY - 1,
        explored: false,
        currentlyVisible: false,
      },
    ];
    interiorRoomsByInstance.set(instanceId, rooms);

    const westPortalX = Math.floor(midX * 0.5);
    const eastPortalX = Math.floor(midX + (width - midX) * 0.5);

    const portals: InteriorPortal[] = [
      {
        id: `${instanceId}-door-west`,
        kind: 'door',
        state: 'closed',
        x: westPortalX,
        y: midY,
        width: 1.5,
        height: 0.5,
        roomA: rooms[0].id,
        roomB: rooms[1].id,
        barricadeHp: 0,
        transitionTimer: 0,
      },
      {
        id: `${instanceId}-window-east`,
        kind: 'window',
        state: 'closed',
        x: eastPortalX,
        y: midY,
        width: 1.5,
        height: 0.5,
        roomA: rooms[0].id,
        roomB: rooms[2].id,
        barricadeHp: 0,
        transitionTimer: 0,
      },
    ];
    interiorPortalsByInstance.set(instanceId, portals);

    const obstacles: Obstacle[] = [
      // Horizontal partition wall separating Entry Foyer from West/East rooms (broken by portals)
      {
        id: `int-wall-w1-${door.id}`,
        x: 0,
        y: midY - 0.3,
        width: Math.max(0.5, westPortalX - 0.75),
        height: 0.6,
        kind: 'ruin',
      },
      {
        id: `int-wall-mid-${door.id}`,
        x: westPortalX + 0.75,
        y: midY - 0.3,
        width: Math.max(0.5, eastPortalX - 0.75 - (westPortalX + 0.75)),
        height: 0.6,
        kind: 'ruin',
      },
      {
        id: `int-wall-e2-${door.id}`,
        x: eastPortalX + 0.75,
        y: midY - 0.3,
        width: Math.max(0.5, width - (eastPortalX + 0.75)),
        height: 0.6,
        kind: 'ruin',
      },
      // Vertical partition wall separating West Wing and East Wing
      {
        id: `int-wall-vert-${door.id}`,
        x: midX - 0.3,
        y: 0,
        width: 0.6,
        height: midY,
        kind: 'ruin',
      },
    ];
    const pillarCount = door.kind === 'residential' ? 3 : door.kind === 'commercial' ? 5 : 6;
    for (let i = 0; i < pillarCount; i += 1) {
      const w = 1;
      const h = 1;
      const ox = snapToIsoGrid(2 + rng() * (width - 4 - w), 1);
      const oy = snapToIsoGrid(2 + rng() * (height - 5 - h), 1);
      if (distance({ x: ox + w * 0.5, y: oy + h * 0.5 }, entrySpawn) < 2.5) continue;
      if (Math.abs(oy - midY) <= 1) continue;
      obstacles.push({
        id: `int-obs-${door.id}-${i}`,
        x: ox,
        y: oy,
        width: w,
        height: h,
        kind: door.kind === 'bunker' ? 'container' : door.kind === 'commercial' ? 'wreck' : 'ruin',
      });
    }

    const containers: WorldContainer[] = [];
    for (let i = 0; i < spec.containerCount; i += 1) {
      const isMainSafe = i === 0;
      const cx = isMainSafe
        ? snapToIsoGrid(width * 0.5, 0.5)
        : snapToIsoGrid(2 + rng() * (width - 4), 0.5);
      const cy = isMainSafe
        ? 2
        : snapToIsoGrid(2 + rng() * (height - 5), 0.5);
      const customLabel =
        spec.containerLabels[i % spec.containerLabels.length] ??
        `${spec.titlePrefix} Supply Bin`;
      containers.push({
        id: `int-cnt-${door.id}-${i}`,
        kind: isMainSafe
          ? 'military_cabinet'
          : door.kind === 'residential'
            ? 'wooden_crate'
            : 'car_trunk',
        label: isMainSafe ? `${door.label} · ${customLabel}` : customLabel,
        x: cx,
        y: cy,
        searched: false,
        searchProgress: 0,
        searchDuration: isMainSafe ? 1.35 : 0.95,
        threatTier: Math.max(1, door.tier) as ThreatTier,
      });
    }

    const zombies: ZombieState[] = [];
    const totalZombies = spec.baseZombies + door.tier;
    for (let i = 0; i < totalZombies; i += 1) {
      const zx = snapToIsoGrid(clamp(2 + rng() * (width - 4), 1.5, width - 1.5), 0.5);
      const zy = snapToIsoGrid(clamp(1.5 + rng() * (midY - 2), 1.5, midY - 0.8), 0.5);
      const variant = selectProgressiveZombieVariant(
        Math.max(1, door.tier) as ThreatTier,
        35 + door.tier * 15,
        rng,
      );
      const z = createZombie(
        `int-z-${nextEntityIdStart + i}`,
        variant,
        { x: zx, y: zy },
        Math.PI * 0.5,
      );
      z.alerted = false;
      zombies.push(z);
    }

    return {
      id: instanceId,
      doorId: door.id,
      kind: door.kind,
      label: door.label,
      tier: door.tier,
      width,
      height,
      entrySpawn,
      exitDoor,
      outdoorReturnPos: { ...outdoorReturnPos },
      obstacles,
      containers,
      zombies,
      outdoorZombiesBackup,
      hordeBreachTriggered: false,
      exitLocked: false,
    };
  }

  static enterBuilding(state: WorldState, door: BuildingDoor): InteriorInstance {
    if (distance(state.player, door) > 1.85) {
      throw new Error('Player must be at the building entrance before entering.');
    }
    if (door.locked || (door.state !== 'open' && door.state !== 'smashed')) {
      throw new Error('The building entrance is not accessible.');
    }
    const outdoorReturnPos: Vec2 = { x: state.player.x, y: state.player.y };
    const outdoorZombiesBackup = [...state.zombies];
    const instance = InteriorManager.generateInterior(
      door,
      state.map.seed,
      outdoorReturnPos,
      outdoorZombiesBackup,
      state.nextEntityId,
    );
    state.nextEntityId += instance.zombies.length + 10;
    state.activeInterior = instance;
    state.zombies = instance.zombies;
    state.projectiles = [];
    state.player.x = instance.entrySpawn.x;
    state.player.y = instance.entrySpawn.y;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.inSafeZone = false;
    state.events.push({
      type: 'interior_entered',
      label: instance.label,
      kind: instance.kind,
      tier: instance.tier,
    });
    return instance;
  }

  static tryExitBuilding(state: WorldState): boolean {
    const interior = state.activeInterior;
    if (!interior) return false;
    if (!InteriorManager.isNearInteriorExit(state)) return false;
    if (interior.exitLocked && state.zombies.length > 0) {
      return false;
    }
    const label = interior.label;
    const exitDoor = state.map.doors?.find(({ id }) => id === interior.doorId);
    state.player.x = exitDoor?.x ?? interior.outdoorReturnPos.x;
    state.player.y = exitDoor ? exitDoor.y + 0.9 : interior.outdoorReturnPos.y;
    state.player.vx = 0;
    state.player.vy = 0;
    state.zombies = interior.outdoorZombiesBackup;
    state.projectiles = [];
    state.activeInterior = null;
    state.events.push({ type: 'interior_exited', label });
    return true;
  }

  static triggerHordeBreach(
    state: WorldState,
    rng: () => number = Math.random,
  ): number {
    const interior = state.activeInterior;
    if (!interior || interior.hordeBreachTriggered) return 0;
    interior.hordeBreachTriggered = true;
    interior.exitLocked = true;

    const waveCount = 3 + interior.tier;
    for (let i = 0; i < waveCount; i += 1) {
      const zx = snapToIsoGrid(
        clamp(1.5 + rng() * (interior.width - 3), 1.5, interior.width - 1.5),
        0.5,
      );
      const zy = snapToIsoGrid(clamp(1.5 + rng() * 2.5, 1.5, interior.height - 2.5), 0.5);
      const variant = selectProgressiveZombieVariant(
        Math.max(1, interior.tier) as ThreatTier,
        75,
        rng,
      );
      const z = createZombie(
        `breach-z-${state.nextEntityId++}`,
        variant,
        { x: zx, y: zy },
        Math.PI * 0.5,
        true,
      );
      z.alerted = true;
      state.zombies.push(z);
    }

    state.events.push({
      type: 'horde_breach',
      label: interior.label,
      waveCount,
    });
    return waveCount;
  }
}
