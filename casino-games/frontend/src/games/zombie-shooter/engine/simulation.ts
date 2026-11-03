import {
  SPRINT_STEP_NOISE_RADIUS,
  collectActiveObstacles,
  computeWeaponAcousticAggroSpike,
  emitSoundPulse,
  evaluateZombieAI,
  propagateAcousticPulse,
  stepDynamicAggroAccumulator,
} from './zombieAI';
import { applyDismemberment } from './gore';
import { MELEE_SWING_DURATION } from './animation';
import { InteriorManager } from './interiors';
import { clamp, distance, normalize, rotateToward } from './isometric';
import { applyKnockback, stepKnockback } from './physics';
import {
  canEquipWeapon,
  canSpawnZombieAt,
  selectProgressiveLootTemplate,
  selectZoneThemedZombieVariant,
} from './spawner';
import {
  ITEM_TEMPLATES,
  addItemToInventory,
  createWorld,
  createZombie,
  distanceOutsideSafeZone,
  findSpawnPoint,
  getActiveOutpost,
  isInsideSafeZone,
  moveWithCollision,
  safeZoneStopPoint,
  syncActiveChunks,
  threatTierAt,
  xpToNextLevel,
} from './world';
import type {
  GameEvent,
  GamePhase,
  InputState,
  LootPickup,
  OutlandsRoomState,
  PlayerAttributes,
  PlayerState,
  ThreatTier,
  Vec2,
  WeaponId,
  WeaponProficiencyId,
  WeaponState,
  WorldContainer,
  WorldState,
  ZombieState,
} from './types';

export const GLOBAL_SHAKE_MULTIPLIER = 0.3; // 70% reduction across all weapons
export const MAX_HEAVY_SHAKE_PX = 1.5; // Heavy weapon shake caps at 1.5px micro-shudder
export const RECOIL_SNAP_FRAMES = 4;
export const RECOIL_FRAME_DURATION = 1 / 60;
export const RECOIL_SNAP_DURATION = RECOIL_SNAP_FRAMES * RECOIL_FRAME_DURATION;
const MELEE_IMPACT_DELAY = MELEE_SWING_DURATION * 0.3;

/**
 * Baseline screen-shake table scaled down by 70% (`GLOBAL_SHAKE_MULTIPLIER = 0.3`)
 * with heavy/high-caliber weapons strictly capped at `1.5px` micro-shudder.
 */
export const WEAPON_SHAKE_PX: Record<WeaponId, number> = {
  melee: 0.25,
  smg: 0.57,
  pistol: 0.66,
  rifle: 0.84,
  heavy: 1.44,
  shotgun: 1.5,
  sniper: 1.5,
};

export const WEAPON_RECOIL_PX: Record<WeaponId, number> = {
  melee: 1.0,
  smg: 1.4,
  pistol: 1.8,
  rifle: 2.1,
  heavy: 2.4,
  shotgun: 3.2,
  sniper: 3.4,
};

export function computeWeaponShakePx(weapon: WeaponId, currentShake = 0): number {
  const impulse = Math.min(MAX_HEAVY_SHAKE_PX, WEAPON_SHAKE_PX[weapon] ?? 0.72);
  return Math.min(MAX_HEAVY_SHAKE_PX, currentShake + impulse);
}

/**
 * Computes the initial isometric screen-space recoil displacement vector
 * opposing the weapon firing angle.
 */
export function computeRecoilVector(angle: number, weapon: WeaponId): Vec2 {
  const magnitude = WEAPON_RECOIL_PX[weapon] ?? 1.8;
  const isoX = Math.cos(angle) - Math.sin(angle);
  const isoY = (Math.cos(angle) + Math.sin(angle)) * 0.5;
  const len = Math.hypot(isoX, isoY) || 1;
  return {
    x: -(isoX / len) * magnitude,
    y: -(isoY / len) * magnitude,
  };
}

/**
 * Linearly snaps a recoil displacement vector back to baseline `(0, 0)` over
 * exactly `RECOIL_SNAP_FRAMES` (4 frames at 60Hz = 66.7ms) without exaggerated
 * scale pops or spring overshoot.
 */
export function stepLinearRecoil(
  recoil: Vec2,
  dt: number,
  maxMagnitude = 3.4,
  snapFrames: number = RECOIL_SNAP_FRAMES,
): Vec2 {
  const len = Math.hypot(recoil.x, recoil.y);
  if (len <= 1e-4) return { x: 0, y: 0 };
  const snapSeconds = Math.max(1, snapFrames) * RECOIL_FRAME_DURATION;
  const step = (Math.max(len, maxMagnitude) / snapSeconds) * Math.max(0, dt);
  const nextLen = len - step;
  if (nextLen <= 1e-4) return { x: 0, y: 0 };
  const scale = nextLen / len;
  return {
    x: recoil.x * scale,
    y: recoil.y * scale,
  };
}

const MAX_EVENTS = 140;
const MAX_ZOMBIES = 42;
const LOCAL_CAP_RADIUS = 18;

// Risk/reward by threat tier: quiet and lean near the Outpost, swarming and rich deep out.
const SPAWN_INTERVAL: Record<ThreatTier, number> = { 0: 10, 1: 5, 2: 2.6, 3: 1.2 };
const LOCAL_ZOMBIE_CAP: Record<ThreatTier, number> = { 0: 3, 1: 8, 2: 18, 3: 32 };
const KILL_DROP_CHANCE: Record<ThreatTier, number> = { 0: 0.2, 1: 0.4, 2: 0.65, 3: 0.9 };

export function spawnIntervalFor(tier: ThreatTier): number {
  return SPAWN_INTERVAL[tier];
}

export function localZombieCapFor(tier: ThreatTier): number {
  return LOCAL_ZOMBIE_CAP[tier];
}

export function killDropChanceFor(tier: ThreatTier): number {
  return KILL_DROP_CHANCE[tier];
}

export function threatColor(tier: ThreatTier): string {
  if (tier === 0) return '#6fe7b7';
  if (tier === 1) return '#d8c46b';
  if (tier === 2) return '#e89a54';
  return '#e05252';
}

function pushEvent(state: WorldState, event: GameEvent): void {
  state.events.push(event);
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }
}

export function awardPlayerXp(state: WorldState, amount: number, bankImmediately = false): void {
  if (amount <= 0) return;
  const { player } = state;
  if (player.inSafeZone || bankImmediately) {
    player.xp += amount;
    checkLevelUp(state);
  } else {
    player.unbankedXp += amount;
  }
}

function checkLevelUp(state: WorldState): void {
  const { player } = state;
  let needed = xpToNextLevel(player.level);
  while (player.xp >= needed) {
    player.xp -= needed;
    player.level += 1;
    player.statPoints += 5;
    player.proficiencyPoints += 10;
    player.maxHealth = 100 + Math.max(0, player.attributes.endurance - 25) * 2 + (player.level - 1) * 5;
    player.health = player.maxHealth;
    pushEvent(state, { type: 'level_up', level: player.level });
    needed = xpToNextLevel(player.level);
  }
}

export function allocateAttributePoint(
  player: PlayerState,
  attr: keyof PlayerAttributes,
): boolean {
  if (player.statPoints <= 0 || player.attributes[attr] >= 100) return false;
  player.statPoints -= 1;
  player.attributes[attr] += 1;
  if (attr === 'endurance') {
    player.maxHealth = 100 + Math.max(0, player.attributes.endurance - 25) * 2 + (player.level - 1) * 5;
    player.maxStamina = 100 + Math.max(0, player.attributes.endurance - 25) * 1.5;
    player.health = Math.min(player.maxHealth, player.health + 2);
    player.stamina = Math.min(player.maxStamina, player.stamina + 1.5);
  }
  return true;
}

export function allocateProficiencyPoint(
  player: PlayerState,
  profId: WeaponProficiencyId,
  amount = 5,
): boolean {
  if (player.proficiencyPoints <= 0 || player.proficiencies[profId] >= 120) return false;
  const spend = Math.min(amount, player.proficiencyPoints, 120 - player.proficiencies[profId]);
  if (spend <= 0) return false;
  player.proficiencyPoints -= spend;
  player.proficiencies[profId] += spend;
  return true;
}

export function useInventoryItem(state: WorldState, itemId: string): boolean {
  const { player } = state;
  const idx = player.inventory.findIndex((entry) => entry.id === itemId);
  if (idx === -1) return false;
  const item = player.inventory[idx];

  const doctorMult = player.profession === 'Doctor' ? 1.35 : 1;
  const chefMult = player.profession === 'Chef' ? 1.4 : 1;
  const engineerMult = player.profession === 'Engineer' ? 1.4 : 1;

  let used = false;
  if (item.healAmount && (player.health < player.maxHealth || item.curesInfection)) {
    player.health = clamp(
      player.health + Math.round(item.healAmount * doctorMult),
      0,
      player.maxHealth,
    );
    used = true;
  }
  if (item.curesInfection && (player.infected || player.infectionSeverity > 0)) {
    player.infected = false;
    player.infectionSeverity = 0;
    used = true;
  }
  if (item.hungerAmount && player.hunger < player.maxHunger) {
    player.hunger = clamp(
      player.hunger + Math.round(item.hungerAmount * chefMult),
      0,
      player.maxHunger,
    );
    if (player.profession === 'Chef') {
      player.stamina = clamp(player.stamina + 25, 0, player.maxStamina);
    }
    used = true;
  }
  if (item.armorRepair && player.armorDurability < player.armorMaxDurability) {
    if (item.templateId === 'kevlar_plate') {
      player.armorMaxDurability = Math.max(player.armorMaxDurability, 120);
      player.armorAbsorption = Math.max(player.armorAbsorption, 0.58);
      player.armorName = 'Exo-Ceramic Tactical Plate';
    }
    player.armorDurability = clamp(
      player.armorDurability + Math.round(item.armorRepair * engineerMult),
      0,
      player.armorMaxDurability,
    );
    used = true;
  }
  if (item.ammoType && item.ammoCount) {
    const target = player.weapons[item.ammoType];
    if (target) {
      target.reserve += item.ammoCount;
      used = true;
    }
  }

  if (!used) return false;

  if (item.quantity > 1) {
    item.quantity -= 1;
  } else {
    player.inventory.splice(idx, 1);
  }
  return true;
}

export function buyMarketplaceItem(
  state: WorldState,
  templateId: string,
): boolean {
  const { player } = state;
  const tpl = ITEM_TEMPLATES[templateId];
  if (!tpl) return false;
  const totalCash = player.bankCash + player.carriedCash;
  if (totalCash < tpl.valueUsd) return false;

  const added = addItemToInventory(
    player,
    templateId,
    `mkt-${state.nextEntityId++}`,
    1,
  );
  if (!added) return false;

  let remainingCost = tpl.valueUsd;
  const fromBank = Math.min(player.bankCash, remainingCost);
  player.bankCash -= fromBank;
  remainingCost -= fromBank;
  player.carriedCash = Math.max(0, player.carriedCash - remainingCost);
  return true;
}

export function sellInventoryItem(state: WorldState, itemId: string): boolean {
  const { player } = state;
  const idx = player.inventory.findIndex((entry) => entry.id === itemId);
  if (idx === -1) return false;
  const [removed] = player.inventory.splice(idx, 1);
  const salePrice = Math.max(10, Math.round(removed.valueUsd * 0.65));
  if (player.inSafeZone) {
    player.bankCash += salePrice;
  } else {
    player.carriedCash += salePrice;
  }
  return true;
}

export function outpostHealService(player: PlayerState): boolean {
  const cost = player.profession === 'Doctor' ? 25 : 45;
  const totalCash = player.bankCash + player.carriedCash;
  if (totalCash < cost) return false;
  if (player.health >= player.maxHealth && !player.infected) return false;
  const fromBank = Math.min(player.bankCash, cost);
  player.bankCash -= fromBank;
  player.carriedCash = Math.max(0, player.carriedCash - (cost - fromBank));
  player.health = player.maxHealth;
  player.infected = false;
  player.infectionSeverity = 0;
  return true;
}

export function outpostRepairService(player: PlayerState): boolean {
  const cost = player.profession === 'Engineer' ? 20 : 40;
  const totalCash = player.bankCash + player.carriedCash;
  if (totalCash < cost || player.armorDurability >= player.armorMaxDurability) return false;
  const fromBank = Math.min(player.bankCash, cost);
  player.bankCash -= fromBank;
  player.carriedCash = Math.max(0, player.carriedCash - (cost - fromBank));
  player.armorDurability = player.armorMaxDurability;
  return true;
}

export function outpostChefService(player: PlayerState): boolean {
  const cost = player.profession === 'Chef' ? 15 : 30;
  const totalCash = player.bankCash + player.carriedCash;
  if (totalCash < cost || player.hunger >= player.maxHunger) return false;
  const fromBank = Math.min(player.bankCash, cost);
  player.bankCash -= fromBank;
  player.carriedCash = Math.max(0, player.carriedCash - (cost - fromBank));
  player.hunger = player.maxHunger;
  player.stamina = player.maxStamina;
  return true;
}

export function claimQuestReward(state: WorldState, questId: string): boolean {
  const quest = state.player.quests.find((q) => q.id === questId);
  if (!quest || !quest.completed || quest.claimed) return false;
  quest.claimed = true;
  state.player.bankCash += quest.rewardCash;
  state.player.stash += quest.rewardScrap;
  awardPlayerXp(state, quest.rewardXp, true);
  return true;
}

function effectiveReloadDuration(player: PlayerState, weapon: WeaponState): number {
  const reloadBonus = Math.min(0.55, Math.max(0, player.attributes.reloading - 25) * 0.008);
  return Math.max(0.2, weapon.reloadSeconds * (1 - reloadBonus));
}

function startReload(state: WorldState, weapon: WeaponState): void {
  if (weapon.isMelee) return;
  if (state.player.reloadTimer > 0) return;
  if (weapon.ammo >= weapon.magSize || weapon.reserve <= 0) return;
  state.player.reloadTimer = effectiveReloadDuration(state.player, weapon);
  pushEvent(state, { type: 'reload_start', weapon: weapon.id });
}

function finishReload(state: WorldState, weapon: WeaponState): void {
  const needed = weapon.magSize - weapon.ammo;
  const loaded = Math.min(needed, weapon.reserve);
  weapon.ammo += loaded;
  weapon.reserve -= loaded;
  pushEvent(state, { type: 'reload_complete', weapon: weapon.id });
}

function activeCollisionMap(state: WorldState) {
  if (!state.activeInterior) {
    return {
      ...state.map,
      obstacles: [
        ...state.map.obstacles,
        ...InteriorManager.getBlockingBuildingDoorObstacles(state.map),
      ],
    };
  }
  return {
    ...state.map,
    width: state.activeInterior.width,
    height: state.activeInterior.height,
    infinite: false,
    activeChunks: {},
    obstacles: [
      ...state.activeInterior.obstacles,
      ...InteriorManager.getBlockingPortalObstacles(state.activeInterior.id),
    ],
  };
}

function updatePlayer(state: WorldState, input: InputState, dt: number): void {
  const { player, map } = state;

  if (input.toggleFlashlight) {
    player.flashlightOn = !player.flashlightOn;
  }

  if (input.loadoutSlot !== undefined && input.loadoutWeapon) {
    assignLoadoutSlot(state, input.loadoutSlot, input.loadoutWeapon);
  }

  const requestedWeapon = input.weaponSwitch ?? input.weapon;
  if (
    requestedWeapon &&
    requestedWeapon !== player.activeWeapon &&
    player.weapons[requestedWeapon] &&
    isInLoadout(player, requestedWeapon) &&
    canEquipWeapon(player, requestedWeapon)
  ) {
    player.activeWeapon = requestedWeapon;
    player.reloadTimer = 0;
    pushEvent(state, { type: 'weapon_switched', weapon: requestedWeapon });
  }

  const weapon = player.weapons[player.activeWeapon];
  player.interactionCooldown = Math.max(0, player.interactionCooldown - dt);
  player.fireCooldown = Math.max(0, player.fireCooldown - dt);
  if (player.meleeImpactPending) {
    player.meleeImpactTimer = Math.max(0, player.meleeImpactTimer - dt);
  }
  player.invulnerableTimer = Math.max(0, player.invulnerableTimer - dt);

  if (player.reloadTimer > 0) {
    const totalReload = effectiveReloadDuration(player, weapon);
    const prevProgress = 1 - player.reloadTimer / totalReload;
    player.reloadTimer = Math.max(0, player.reloadTimer - dt);
    const nextProgress = 1 - player.reloadTimer / totalReload;
    if (prevProgress < 0.55 && nextProgress >= 0.55) {
      pushEvent(state, { type: 'reload_clip_insert', weapon: weapon.id });
    }
    if (prevProgress < 0.85 && nextProgress >= 0.85) {
      pushEvent(state, { type: 'reload_rack', weapon: weapon.id });
    }
    if (player.reloadTimer === 0) {
      finishReload(state, weapon);
    }
  } else if (input.reload) {
    startReload(state, weapon);
  }

  const moveDir = normalize({ x: input.move.x, y: input.move.y });
  const moving = Math.hypot(moveDir.x, moveDir.y) > 0.01;
  const sprinting = Boolean(input.sprint && moving && player.stamina > 4);

  const agilityFactor = 1 + Math.max(0, player.attributes.agility - 25) * 0.008;
  const armorSpeedFactor = Math.max(0.75, 1 - player.armorWeightPenalty);
  const hungerSpeedFactor = player.hunger <= 0 ? 0.78 : 1;
  const baseSpeed = 4.5 * agilityFactor * armorSpeedFactor * hungerSpeedFactor;
  const speed = baseSpeed * (sprinting ? 1.36 : 1);

  const enduranceRegenBonus = 1 + Math.max(0, player.attributes.endurance - 25) * 0.012;
  const wellFedBonus = player.hunger >= 75 ? 1.08 : 1;

  if (sprinting) {
    player.stamina = clamp(player.stamina - 28 * dt, 0, player.maxStamina);
    if (!player.inSafeZone && state.soundPulses.every((p) => distance(p, player) > 1.8)) {
      emitSoundPulse(state, { x: player.x, y: player.y }, SPRINT_STEP_NOISE_RADIUS, false, 0.32);
    }
  } else {
    player.stamina = clamp(
      player.stamina + (moving ? 12 : 22) * enduranceRegenBonus * wellFedBonus * dt,
      0,
      player.maxStamina,
    );
  }

  // Rigid-body knockback impulse decays over time and overrides normal input while staggered.
  stepKnockback(
    player,
    dt,
    (x, y, dx, dy, r) => moveWithCollision(activeCollisionMap(state), x, y, dx, dy, r),
    (x, y, r) => safeZoneStopPoint(map, x, y, r),
  );
  const staggered = player.knockbackTimer > 0;
  const moveScale = staggered ? 0.25 : 1;
  const collisionMap = activeCollisionMap(state);
  const next = moveWithCollision(
    collisionMap,
    player.x,
    player.y,
    moveDir.x * speed * dt * moveScale,
    moveDir.y * speed * dt * moveScale,
    player.radius,
  );
  player.vx = ((next.x - player.x) / Math.max(dt, 1e-4)) + player.knockbackVx;
  player.vy = ((next.y - player.y) / Math.max(dt, 1e-4)) + player.knockbackVy;
  player.x = next.x;
  player.y = next.y;
  if (!state.activeInterior) {
    syncActiveChunks(map, player.x, player.y);
  }

  if (Math.hypot(input.aim.x, input.aim.y) > 0.001) {
    player.angle = Math.atan2(input.aim.y, input.aim.x);
  } else if (moving) {
    player.angle = Math.atan2(moveDir.y, moveDir.x);
  }

  // Dynamic Reticle Bloom (shrinks when standing still / aiming, expands on movement/sprint)
  const accuracyTightening =
    1 +
    Math.max(0, player.attributes.accuracy - 25) * 0.015 +
    player.proficiencies[weapon.proficiencyId] * 0.004;
  const targetBloom = sprinting ? 0.78 : moving ? 0.36 : 0.08;
  const bloomRate = (targetBloom < player.reticleBloom ? 1.8 * accuracyTightening : 2.6) * dt;
  player.reticleBloom = clamp(
    player.reticleBloom + clamp(targetBloom - player.reticleBloom, -bloomRate, bloomRate),
    0.06,
    1,
  );
  player.focusFactor = clamp(1 - player.reticleBloom, 0, 1);

  if (state.activeInterior) {
    player.inSafeZone = false;
    player.threatTier = state.activeInterior.tier;
  } else {
    player.inSafeZone = isInsideSafeZone(map, player.x, player.y);
    player.threatTier = threatTierAt(map, player.x, player.y);
    const activeOutpost = getActiveOutpost(map, player.x, player.y);
    if (activeOutpost) {
      player.activeOutpostId = activeOutpost.id;
    }
  }

  // Survival decay outside the safe zone
  if (!player.inSafeZone) {
    player.hunger = clamp(player.hunger - (sprinting ? 0.85 : 0.48) * dt, 0, player.maxHunger);
    if (player.hunger <= 0) {
      player.health = Math.max(1, player.health - 0.55 * dt);
    }
    if (player.infected) {
      player.infectionSeverity = clamp(player.infectionSeverity + 2.2 * dt, 0, 100);
      player.health = Math.max(0, player.health - (1.1 + player.infectionSeverity * 0.015) * dt);
      if (player.health <= 0) {
        killPlayer(state);
        return;
      }
    }
  }

  // Banking scrap, cash, and unbanked XP upon entering Safe Zone
  if (
    player.inSafeZone &&
    (player.carriedScrap > 0 || player.carriedCash > 0 || player.unbankedXp > 0)
  ) {
    const bankedScrap = player.carriedScrap;
    const bankedCash = player.carriedCash;
    const bankedXp = player.unbankedXp;
    player.stash += bankedScrap;
    player.carriedScrap = 0;
    player.bankCash += bankedCash;
    player.carriedCash = 0;
    player.unbankedXp = 0;
    if (bankedXp > 0) {
      player.xp += bankedXp;
      checkLevelUp(state);
    }
    pushEvent(state, {
      type: 'stash_banked',
      amount: bankedScrap,
      cashBanked: bankedCash,
      xpBanked: bankedXp,
    });
  }

  // Update dynamic Aggro Index (0 to 100%)
  state.aggroIndex = stepDynamicAggroAccumulator(
    state.aggroIndex,
    player,
    sprinting,
    moving,
    dt,
  );
}

/**
 * Ray-vs-circle distance along a unit ray `(cos(angle), sin(angle))`.
 * Returns `null` when the ray misses or the circle is behind the origin.
 */
export function raycastDistanceToZombie(
  origin: Vec2,
  angle: number,
  maxRange: number,
  zombie: Pick<ZombieState, 'x' | 'y' | 'radius'>,
): number | null {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const toX = zombie.x - origin.x;
  const toY = zombie.y - origin.y;
  const proj = toX * dx + toY * dy;
  if (proj < 0 || proj > maxRange + zombie.radius) return null;
  const perpSq = toX * toX + toY * toY - proj * proj;
  const hitRadius = zombie.radius + 0.14;
  if (perpSq > hitRadius * hitRadius) return null;
  const offset = Math.sqrt(Math.max(0, hitRadius * hitRadius - perpSq));
  return Math.max(0, proj - offset);
}

function raycastWallDistance(state: WorldState, origin: Vec2, angle: number, maxRange: number): number {
  const step = 0.28;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const obstacles = state.activeInterior
    ? [...state.activeInterior.obstacles, ...InteriorManager.getBlockingPortalObstacles(state.activeInterior.id)]
    : [...collectActiveObstacles(state), ...InteriorManager.getBlockingBuildingDoorObstacles(state.map)];
  for (let d = step; d <= maxRange; d += step) {
    const x = origin.x + dx * d;
    const y = origin.y + dy * d;
    for (const obs of obstacles) {
      if (x >= obs.x && x <= obs.x + obs.width && y >= obs.y && y <= obs.y + obs.height) {
        return d;
      }
    }
  }
  return maxRange;
}

function dropLootForZombie(
  state: WorldState,
  zombie: ZombieState,
  rng: () => number,
): void {
  const roll = rng();
  const tier = threatTierAt(state.map, zombie.x, zombie.y);

  if (zombie.isBoss || zombie.variant === 'titan') {
    state.pickups.push({
      id: `loot-${state.nextEntityId++}`,
      kind: 'scrap',
      x: zombie.x,
      y: zombie.y,
      amount: 35,
      cashAmount: 180,
      ttl: 60,
    });
    return;
  }
  if (rng() >= KILL_DROP_CHANCE[tier]) return;

  let kind: LootPickup['kind'] = 'scrap';
  let amount = 5 + tier * 4 + (zombie.variant === 'brute' ? 8 : 0);
  if (roll > 0.88) {
    kind = 'antiviral';
    amount = 1;
  } else if (roll > 0.74) {
    kind = 'medkit';
    amount = 28;
  } else if (roll > 0.52) {
    kind = 'ammo';
    amount = 18;
  }
  state.pickups.push({
    id: `loot-${state.nextEntityId++}`,
    kind,
    x: zombie.x,
    y: zombie.y,
    amount,
    cashAmount: 12 + tier * 10,
    ttl: 45,
  });
}

function updateQuestProgressOnKill(state: WorldState, variant: ZombieState['variant']): void {
  for (const quest of state.player.quests) {
    if (quest.completed) continue;
    const matches =
      !quest.targetVariant ||
      quest.targetVariant === variant ||
      (quest.targetVariant === 'spitter' && (variant === 'spitter' || variant === 'leaper'));
    if (matches) {
      quest.progressKills = Math.min(quest.targetKills, quest.progressKills + 1);
      if (quest.progressKills >= quest.targetKills) {
        quest.completed = true;
      }
    }
  }
}

function fireWeapon(state: WorldState, rng: () => number, meleeImpact = false): void {
  const { player } = state;
  const weapon = player.weapons[player.activeWeapon];
  if (!meleeImpact && (player.reloadTimer > 0 || player.fireCooldown > 0)) return;
  if (!meleeImpact && weapon.isMelee) {
    player.fireCooldown = weapon.fireInterval;
    player.meleeImpactTimer = MELEE_IMPACT_DELAY;
    player.meleeImpactPending = true;
    const swingOrigin = {
      x: player.x + Math.cos(player.angle) * 0.42,
      y: player.y + Math.sin(player.angle) * 0.42,
    };
    pushEvent(state, {
      type: 'shot',
      weapon: weapon.id,
      x: swingOrigin.x,
      y: swingOrigin.y,
      angle: player.angle,
      traces: [],
      silent: true,
      noiseRadius: weapon.noiseRadius,
      shakePx: computeWeaponShakePx(weapon.id),
      recoilVector: computeRecoilVector(player.angle, weapon.id),
    });
    return;
  }
  if (!weapon.isMelee && weapon.ammo <= 0) {
    startReload(state, weapon);
    return;
  }

  if (!weapon.isMelee) {
    weapon.ammo -= 1;
  }
  if (!meleeImpact) player.fireCooldown = weapon.fireInterval;

  const muzzle: Vec2 = {
    x: player.x + Math.cos(player.angle) * 0.42,
    y: player.y + Math.sin(player.angle) * 0.42,
  };

  const profPoints = player.proficiencies[weapon.proficiencyId] ?? 0;
  const profDamageMult = 1 + profPoints * 0.004;
  const strengthMult =
    weapon.isMelee || weapon.id === 'heavy'
      ? 1 + Math.max(0, player.attributes.strength - 25) * 0.015
      : 1;
  const hungerDamageMult = player.hunger <= 0 ? 0.8 : 1;
  const accuracyFactor = Math.max(
    0.35,
    1 - Math.max(0, player.attributes.accuracy - 25) * 0.008 - profPoints * 0.002,
  );
  const effectiveSpread = weapon.spread * (0.55 + player.reticleBloom * 0.85) * accuracyFactor;
  const critBonus =
    Math.max(0, player.attributes.criticalHit - 25) * 0.005 +
    profPoints * 0.002 +
    (player.reticleBloom < 0.26 ? 0.14 : 0);

  // Add a visible/audible sound pulse ring
  state.soundPulses.push({
    id: `snd-${state.nextEntityId++}`,
    x: player.x,
    y: player.y,
    radius: 0.5,
    maxRadius: weapon.noiseRadius,
    ttl: 0.45,
    maxTtl: 0.45,
    silent: weapon.isSilent,
  });

  const aggroSpike = computeWeaponAcousticAggroSpike(weapon);
  if (aggroSpike > 0) {
    state.aggroIndex = clamp(state.aggroIndex + aggroSpike, 0, 100);
  }

  const traces = [];
  for (let p = 0; p < weapon.pellets; p += 1) {
    const jitter = weapon.isMelee ? 0 : (rng() - 0.5) * effectiveSpread * 2;
    const angle = player.angle + jitter;
    const wallDist = raycastWallDistance(state, muzzle, angle, weapon.range);

    let hitZombie: ZombieState | null = null;
    let bestDist = wallDist;
    if (weapon.isMelee) {
      // A machete connects across a short frontal arc, not an infinitely thin
      // bullet ray. Let nearby targets cleave only when they are unobstructed.
      let nearestCenter = Number.POSITIVE_INFINITY;
      for (const zombie of state.zombies) {
        if (zombie.health <= 0) continue;
        const centerDistance = distance(player, zombie);
        if (centerDistance > weapon.range + zombie.radius || centerDistance < 1e-4) continue;
        const toZombieAngle = Math.atan2(zombie.y - player.y, zombie.x - player.x);
        const angleDelta = Math.atan2(
          Math.sin(toZombieAngle - player.angle),
          Math.cos(toZombieAngle - player.angle),
        );
        const targetAllowance = Math.asin(clamp(zombie.radius / centerDistance, 0, 1));
        if (Math.abs(angleDelta) > 0.48 + targetAllowance) continue;
        const sightDistance = raycastWallDistance(
          state,
          { x: player.x, y: player.y },
          toZombieAngle,
          centerDistance,
        );
        if (sightDistance < centerDistance - zombie.radius * 0.5) continue;
        if (centerDistance < nearestCenter) {
          nearestCenter = centerDistance;
          bestDist = Math.max(0, centerDistance - zombie.radius);
          hitZombie = zombie;
        }
      }
    } else {
      for (const zombie of state.zombies) {
        if (zombie.health <= 0) continue;
        const d = raycastDistanceToZombie(muzzle, angle, wallDist, zombie);
        if (d !== null && d < bestDist) {
          bestDist = d;
          hitZombie = zombie;
        }
      }
    }

    const endX = muzzle.x + Math.cos(angle) * bestDist;
    const endY = muzzle.y + Math.sin(angle) * bestDist;
    let headshot = false;
    let crit = false;

    if (hitZombie) {
      headshot = rng() < clamp(weapon.headshotChance + critBonus * 0.5, 0.05, 0.78);
      crit = headshot || rng() < clamp(weapon.critChance + critBonus, 0.05, 0.85);
      const meleeDistanceFactor = weapon.isMelee
        ? clamp(1 - Math.max(0, distance(player, hitZombie) - 0.65) * 0.12, 0.7, 1)
        : 1;
      const rawDamage =
        weapon.damage *
        meleeDistanceFactor *
        profDamageMult *
        strengthMult *
        hungerDamageMult *
        (headshot ? 1.75 : crit ? weapon.critMultiplier : 1);
      const damage = Math.max(1, Math.round(rawDamage * (1 - (hitZombie.armorReduction ?? 0))));

      hitZombie.health -= damage;
      hitZombie.hitFlash = 0.14;
      hitZombie.staggerTimer = Math.max(hitZombie.staggerTimer ?? 0, weapon.staggerDuration);
      hitZombie.alerted = true;
      if (hitZombie.variant === 'wraith') {
        hitZombie.cloakAlpha = 0.95;
      }

      // Rigid-body impulse: push the zombie away from the shooter instead of teleporting it.
      applyKnockback(
        hitZombie,
        player.x,
        player.y,
        weapon.knockback *
          (1 + Math.max(0, player.attributes.strength - 25) * 0.01) *
          (headshot ? 1.25 : 1),
        { staggerDuration: weapon.staggerDuration, maxImpulse: weapon.isMelee ? 9 : 14 },
      );

      if (!hitZombie.limbs) {
        hitZombie.limbs = { head: true, torso: true, leftArm: true, rightArm: true, legs: true };
      }
      const lethal = hitZombie.health <= 0;
      const severedPart = applyDismemberment(
        hitZombie.limbs,
        weapon.dismemberType,
        headshot,
        lethal,
        crit,
        rng,
      );

      pushEvent(state, {
        type: 'zombie_hit',
        zombieId: hitZombie.id,
        variant: hitZombie.variant,
        x: hitZombie.x,
        y: hitZombie.y,
        angle,
        force: weapon.knockback * (headshot ? 1.5 : 1),
        headshot,
        crit,
        severedPart,
        dismemberType: weapon.dismemberType,
        lethal,
        weapon: weapon.id,
      });

      if (lethal) {
        player.kills += 1;
        const xpReward =
          hitZombie.variant === 'titan'
            ? 140
            : hitZombie.variant === 'brute' || hitZombie.variant === 'leaper' || hitZombie.variant === 'wraith'
              ? 48
              : 24;
        awardPlayerXp(state, xpReward);
        updateQuestProgressOnKill(state, hitZombie.variant);

        pushEvent(state, {
          type: 'zombie_killed',
          zombieId: hitZombie.id,
          variant: hitZombie.variant,
          x: hitZombie.x,
          y: hitZombie.y,
          angle,
          headshot,
          dismemberType: weapon.dismemberType,
          weapon: weapon.id,
          xpEarned: xpReward,
        });
        dropLootForZombie(state, hitZombie, rng);
      }
    }

    traces.push({
      x1: muzzle.x,
      y1: muzzle.y,
      x2: endX,
      y2: endY,
      hit: Boolean(hitZombie),
      headshot,
      crit,
    });
  }

  state.zombies = state.zombies.filter((z) => z.health > 0);
  const shakePx = weapon.isSilent ? 0 : computeWeaponShakePx(weapon.id);
  const recoilVector = computeRecoilVector(player.angle, weapon.id);
  if (!meleeImpact) {
    pushEvent(state, {
      type: 'shot',
      weapon: weapon.id,
      x: muzzle.x,
      y: muzzle.y,
      angle: player.angle,
      traces: weapon.isMelee ? [] : traces,
      silent: weapon.isSilent,
      noiseRadius: weapon.noiseRadius,
      shakePx,
      recoilVector,
    });
  }

  // Acoustic pulse alerts nearby zombies within weapon's noiseRadius (0 spike for silenced weapons)
  propagateAcousticPulse(state, player, weapon.noiseRadius, weapon.isSilent);

  // Recoil bloom expansion
  player.reticleBloom = clamp(
    player.reticleBloom + (weapon.id === 'shotgun' || weapon.id === 'sniper' ? 0.22 : 0.09),
    0.06,
    1,
  );

  if (!weapon.isMelee && weapon.ammo === 0 && weapon.reserve > 0) {
    startReload(state, weapon);
  }
}

function applyDamageToPlayer(
  state: WorldState,
  rawDamage: number,
  inflictsInfection: boolean,
  rng: () => number,
): void {
  const { player } = state;
  if (player.invulnerableTimer > 0 || player.inSafeZone) return;

  let absorbed = 0;
  let healthDamage = rawDamage;
  if (player.armorDurability > 0 && player.armorAbsorption > 0) {
    absorbed = Math.round(rawDamage * player.armorAbsorption);
    healthDamage = Math.max(1, rawDamage - absorbed);
    player.armorDurability = Math.max(0, player.armorDurability - Math.ceil(absorbed * 0.85));
  }

  let newlyInfected = false;
  if (inflictsInfection && !player.infected && rng() < 0.45) {
    player.infected = true;
    player.infectionSeverity = Math.max(8, player.infectionSeverity);
    newlyInfected = true;
  }

  player.health = Math.max(0, player.health - healthDamage);
  player.invulnerableTimer = 0.35;
  pushEvent(state, {
    type: 'player_hit',
    x: player.x,
    y: player.y,
    damage: healthDamage,
    absorbed,
    infected: newlyInfected,
  });

  if (player.health <= 0) {
    killPlayer(state);
  }
}

function killPlayer(state: WorldState): void {
  const { player } = state;
  player.health = 0;
  player.alive = false;
  player.deaths += 1;
  state.phase = 'dead';

  const droppedScrap = player.carriedScrap;
  const droppedCash = player.carriedCash;
  const droppedXp = player.unbankedXp;
  const droppedItems = [...player.inventory];

  player.carriedScrap = 0;
  player.carriedCash = 0;
  player.unbankedXp = 0;
  player.inventory = [];

  if (droppedScrap > 0 || droppedCash > 0 || droppedXp > 0 || droppedItems.length > 0) {
    state.pickups.push({
      id: `corpse-${state.nextEntityId++}`,
      kind: 'corpse',
      x: player.x,
      y: player.y,
      amount: droppedScrap,
      cashAmount: droppedCash,
      xpAmount: droppedXp,
      items: droppedItems,
      ttl: 300,
    });
  }
  pushEvent(state, {
    type: 'player_died',
    x: player.x,
    y: player.y,
    droppedScrap,
    droppedCash,
    droppedXp,
  });
}

function stepZombies(state: WorldState, dt: number, rng: () => number): void {
  const { player, map } = state;
  const activeObstacles = state.activeInterior
    ? [...collectActiveObstacles(state), ...InteriorManager.getBlockingPortalObstacles(state.activeInterior.id)]
    : [...collectActiveObstacles(state), ...InteriorManager.getBlockingBuildingDoorObstacles(state.map)];
  // Collision geometry is shared for every infected in this fixed step. Building
  // this map inside the loop copied all static obstacles once per zombie, causing
  // avoidable allocation/GC spikes during longer fights.
  const collisionMap = activeCollisionMap(state);

  for (const zombie of state.zombies) {
    if (!zombie.limbs) {
      zombie.limbs = { head: true, torso: true, leftArm: true, rightArm: true, legs: true };
    }
    zombie.hitFlash = Math.max(0, (zombie.hitFlash ?? 0) - dt);
    zombie.attackCooldown = Math.max(0, (zombie.attackCooldown ?? 0) - dt);
    zombie.staggerTimer = Math.max(0, (zombie.staggerTimer ?? 0) - dt);
    zombie.spitCooldown = Math.max(0, (zombie.spitCooldown ?? 0) - dt);
    zombie.leapCooldown = Math.max(0, (zombie.leapCooldown ?? 0) - dt);
    zombie.leapingTimer = Math.max(0, (zombie.leapingTimer ?? 0) - dt);

    const toPlayerX = player.x - zombie.x;
    const toPlayerY = player.y - zombie.y;
    const dist = Math.hypot(toPlayerX, toPlayerY);

    if (zombie.variant === 'wraith') {
      zombie.cloakAlpha = dist < 4.5 || zombie.hitFlash > 0 ? 0.92 : 0.28;
    }

    const aiDecision = evaluateZombieAI(
      zombie,
      player,
      map,
      activeObstacles,
      state.soundPulses,
      state.aggroIndex,
      dt,
    );

    const isChasingOrAttacking =
      aiDecision.state === 'CHASE' ||
      aiDecision.state === 'CHARGING' ||
      aiDecision.state === 'ATTACK';

    // Spitter ranged acid attack (only when actively chasing/attacking with LOS)
    if (
      zombie.variant === 'spitter' &&
      isChasingOrAttacking &&
      !player.inSafeZone &&
      zombie.staggerTimer <= 0 &&
      dist >= 3.2 &&
      dist <= 11.5 &&
      zombie.spitCooldown <= 0
    ) {
      zombie.spitCooldown = 2.8;
      const aimAngle = Math.atan2(toPlayerY, toPlayerX);
      const speed = 7.4;
      state.projectiles.push({
        id: `acid-${state.nextEntityId++}`,
        x: zombie.x,
        y: zombie.y,
        vx: Math.cos(aimAngle) * speed,
        vy: Math.sin(aimAngle) * speed,
        radius: 0.24,
        damage: 13,
        ttl: 2.2,
        inflictsInfection: true,
      });
      pushEvent(state, { type: 'acid_spit', x: zombie.x, y: zombie.y, angle: aimAngle });
    }

    // Leaper pounce burst
    if (
      zombie.variant === 'leaper' &&
      isChasingOrAttacking &&
      !player.inSafeZone &&
      zombie.staggerTimer <= 0 &&
      zombie.limbs.legs &&
      dist >= 2.4 &&
      dist <= 6.8 &&
      zombie.leapCooldown <= 0
    ) {
      zombie.leapCooldown = 4.2;
      zombie.leapingTimer = 0.36;
    }

    // Apply decaying knockback impulse first, so a hit visibly staggers the zombie backward.
    stepKnockback(
      zombie,
      dt,
      (x, y, dx, dy, r) => moveWithCollision(collisionMap, x, y, dx, dy, r),
      (x, y, r) => safeZoneStopPoint(map, x, y, r),
    );

    const targetX = aiDecision.target.x;
    const targetY = aiDecision.target.y;

    const dir = normalize({ x: targetX - zombie.x, y: targetY - zombie.y });
    const desiredAngle = Math.atan2(dir.y, dir.x);
    zombie.angle = rotateToward(zombie.angle, desiredAngle, 6.5 * dt);

    const legMultiplier = zombie.limbs.legs ? 1 : 0.42;
    const staggerMultiplier = zombie.knockbackTimer > 0 ? 0 : zombie.staggerTimer > 0 ? 0.22 : 1;
    const leapMultiplier = zombie.leapingTimer > 0 ? 2.45 : 1;
    const pace =
      zombie.speed *
      aiDecision.speedMultiplier *
      legMultiplier *
      staggerMultiplier *
      leapMultiplier;

    const moved = moveWithCollision(
      collisionMap,
      zombie.x,
      zombie.y,
      dir.x * pace * dt,
      dir.y * pace * dt,
      zombie.radius,
    );
    const stopped = state.activeInterior
      ? moved
      : safeZoneStopPoint(map, moved.x, moved.y, zombie.radius);
    zombie.vx = (stopped.x - zombie.x) / Math.max(dt, 1e-4);
    zombie.vy = (stopped.y - zombie.y) / Math.max(dt, 1e-4);
    zombie.x = stopped.x;
    zombie.y = stopped.y;

    const reach = zombie.radius + player.radius + 0.18;
    if (
      !player.inSafeZone &&
      (zombie.staggerTimer ?? 0) <= 0 &&
      (aiDecision.biteHitboxActive || distance(zombie, player) <= reach) &&
      zombie.attackCooldown === 0
    ) {
      zombie.attackCooldown = zombie.variant === 'runner' || zombie.variant === 'hound' ? 0.65 : 0.95;
      const missingArms = (!zombie.limbs.leftArm ? 1 : 0) + (!zombie.limbs.rightArm ? 1 : 0);
      const armFactor = Math.max(0.4, 1 - missingArms * 0.3);
      const rawDamage = Math.max(
        4,
        Math.round(zombie.damage * armFactor + (zombie.burningAura ? 4 : 0)),
      );
      applyDamageToPlayer(state, rawDamage, zombie.inflictsInfection, rng);
      applyKnockback(player, zombie.x, zombie.y, (zombie.damage ?? 8) * 0.2 + 1.8, { staggerDuration: 0.3 });
      if (state.phase === 'dead') return;
    }
  }
}

/** Keeps the outdoor horde moving toward the building entrance while the interior is active. */
function stepExteriorZombiesAtBuilding(state: WorldState, dt: number): void {
  const interior = state.activeInterior;
  if (!interior || interior.outdoorZombiesBackup.length === 0) return;

  const door = state.map.doors?.find(({ id }) => id === interior.doorId);
  const targetPos = door ?? interior.outdoorReturnPos;
  const target = {
    ...state.player,
    x: targetPos.x,
    y: targetPos.y,
    inSafeZone: false,
    threatTier: interior.tier,
    flashlightOn: false,
  };
  const exteriorMap = {
    ...state.map,
    obstacles: [
      ...state.map.obstacles,
      ...InteriorManager.getBlockingBuildingDoorObstacles(state.map),
    ],
  };
  const obstacles = [
    ...collectActiveObstacles({ ...state, activeInterior: null }),
    ...InteriorManager.getBlockingBuildingDoorObstacles(state.map),
  ];
  const soundAtEntrance = state.soundPulses
    .filter((pulse) => !pulse.silent && pulse.maxRadius > 1.6)
    .map((pulse) => ({ ...pulse, x: targetPos.x, y: targetPos.y }));

  for (const zombie of interior.outdoorZombiesBackup) {
    zombie.attackCooldown = Math.max(0, (zombie.attackCooldown ?? 0) - dt);
    zombie.staggerTimer = Math.max(0, (zombie.staggerTimer ?? 0) - dt);
    zombie.spitCooldown = Math.max(0, (zombie.spitCooldown ?? 0) - dt);
    zombie.leapCooldown = Math.max(0, (zombie.leapCooldown ?? 0) - dt);
    zombie.leapingTimer = Math.max(0, (zombie.leapingTimer ?? 0) - dt);
    InteriorManager.damageBarricadeByZombie(state, zombie, dt);
    const decision = evaluateZombieAI(
      zombie,
      target,
      exteriorMap,
      obstacles,
      soundAtEntrance,
      state.aggroIndex,
      dt,
    );
    const direction = normalize({ x: decision.target.x - zombie.x, y: decision.target.y - zombie.y });
    zombie.angle = rotateToward(zombie.angle, Math.atan2(direction.y, direction.x), 6.5 * dt);
    const pace = zombie.speed * decision.speedMultiplier * (zombie.limbs?.legs ? 1 : 0.42);
    const moved = moveWithCollision(
      exteriorMap,
      zombie.x,
      zombie.y,
      direction.x * pace * dt,
      direction.y * pace * dt,
      zombie.radius,
    );
    const stopped = safeZoneStopPoint(state.map, moved.x, moved.y, zombie.radius);
    zombie.vx = (stopped.x - zombie.x) / Math.max(dt, 1e-4);
    zombie.vy = (stopped.y - zombie.y) / Math.max(dt, 1e-4);
    zombie.x = stopped.x;
    zombie.y = stopped.y;

    if (door?.state === 'barricaded' && zombie.alerted && distance(zombie, door) <= zombie.radius + 0.75) {
      door.barricadeHp = Math.max(0, door.barricadeHp - dt * 12);
      if (door.barricadeHp === 0) {
        door.state = 'smashed';
        emitSoundPulse(state, door, 14, false, 0.55);
      }
    }
  }
}

function stepProjectilesAndPulses(state: WorldState, dt: number, rng: () => number): void {
  const { player, map } = state;

  for (const pulse of state.soundPulses) {
    pulse.ttl -= dt;
    const progress = 1 - Math.max(0, pulse.ttl) / Math.max(0.01, pulse.maxTtl);
    pulse.radius = pulse.maxRadius * clamp(progress, 0, 1);
  }
  state.soundPulses = state.soundPulses.filter((p) => p.ttl > 0);

  const remainingProjectiles = [];
  for (const proj of state.projectiles) {
    proj.ttl -= dt;
    if (proj.ttl <= 0) continue;
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;

    if (isInsideSafeZone(map, proj.x, proj.y)) continue;

    if (distance(proj, player) <= proj.radius + player.radius) {
      applyDamageToPlayer(state, proj.damage, proj.inflictsInfection, rng);
      if (state.phase === 'dead') return;
      continue;
    }
    remainingProjectiles.push(proj);
  }
  state.projectiles = remainingProjectiles;
}

function getAllContainers(state: WorldState): WorldContainer[] {
  if (state.activeInterior) {
    return state.activeInterior.containers;
  }
  if (!state.map.activeChunks) return state.map.containers;
  const list = [...state.map.containers];
  for (const chunk of Object.values(state.map.activeChunks)) {
    for (const c of chunk.containers) {
      list.push(c);
    }
  }
  return list;
}

export function getNearestSearchableContainer(
  state: WorldState,
  maxDistance = 1.9,
): WorldContainer | null {
  let best: WorldContainer | null = null;
  let bestDist = maxDistance;
  for (const c of getAllContainers(state)) {
    if (c.searched) continue;
    const d = distance(c, state.player);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function completeContainerSearch(
  state: WorldState,
  container: WorldContainer,
  rng: () => number,
): void {
  container.searched = true;
  container.searchProgress = container.searchDuration;
  const { player } = state;
  const tier = container.threatTier;

  const cashFound = 25 + tier * 22 + Math.floor(rng() * 30);
  player.carriedCash += cashFound;
  player.carriedScrap += 6 + tier * 4;
  awardPlayerXp(state, 35 + tier * 15);

  const chosenTemplate = selectProgressiveLootTemplate(tier, rng);
  const added = addItemToInventory(
    player,
    chosenTemplate,
    `loot-item-${state.nextEntityId++}`,
    1,
  );
  const itemNames = added ? [added.name] : [];

  pushEvent(state, {
    type: 'container_searched',
    containerId: container.id,
    label: container.label,
    itemNames,
    cashFound,
  });

  if (state.activeInterior && container.kind === 'military_cabinet') {
    InteriorManager.triggerHordeBreach(state, rng);
    return;
  }

  // Searching makes noise and can trigger Loot Aggro ambush spawns
  state.aggroIndex = clamp(state.aggroIndex + 12 + tier * 4, 0, 100);
  if (!state.activeInterior && rng() < 0.35 + tier * 0.12 && state.zombies.length < MAX_ZOMBIES) {
    const ambushCount = tier >= 2 ? 2 : 1;
    let spawned = 0;
    for (let i = 0; i < ambushCount; i += 1) {
      const pos = findSpawnPoint(state.map, player, 4.5, 9.5, rng);
      if (!pos) continue;
      const variant =
        i === 0
          ? 'runner'
          : selectZoneThemedZombieVariant(state.map, pos.x, pos.y, state.aggroIndex, rng);
      const z = createZombie(`z-${state.nextEntityId++}`, variant, pos);
      z.alerted = true;
      state.zombies.push(z);
      spawned += 1;
    }
    if (spawned > 0) {
      pushEvent(state, { type: 'loot_aggro', x: container.x, y: container.y, count: spawned });
    }
  }
}

function stepContainers(
  state: WorldState,
  input: InputState,
  dt: number,
  rng: () => number,
): void {
  const nearest = getNearestSearchableContainer(state);
  if (input.interact && state.player.interactionCooldown <= 0) {
    if (state.activeInterior) {
      const exitDistance = distance(state.player, state.activeInterior.exitDoor);
      const containerDistance = nearest ? distance(state.player, nearest) : Infinity;
      if (InteriorManager.isNearInteriorExit(state) && exitDistance <= containerDistance) {
        InteriorManager.tryExitBuilding(state);
        state.player.interactionCooldown = 0.35;
        return;
      }
      const portal = InteriorManager.findNearestPortal(state);
      if (portal && distance(state.player, portal) <= containerDistance) {
        const action =
          portal.kind === 'window' && portal.state === 'closed'
            ? 'smash'
            : portal.state === 'closed'
              ? 'open'
              : 'close';
        InteriorManager.interactWithPortal(state, portal.id, action);
        state.player.interactionCooldown = 0.35;
        return;
      }
    } else {
      const door = InteriorManager.findNearestDoor(state);
      if (door && (!nearest || distance(state.player, door) <= distance(state.player, nearest))) {
        const atThreshold = distance(state.player, door) <= state.player.radius + 0.42;
        if (door.state === 'open' && atThreshold) {
          InteriorManager.enterBuilding(state, door);
        } else if (door.state === 'open') {
          InteriorManager.interactWithBuildingDoor(state, door, 'close');
        } else if (door.state === 'smashed' && atThreshold) {
          InteriorManager.enterBuilding(state, door);
        } else if (door.state === 'closed') {
          InteriorManager.interactWithBuildingDoor(state, door, 'open');
        } else if (door.state === 'barricaded') {
          // The player can force a barricade using the existing smash interaction.
        } else {
          // Locked doors remain closed until forced; opening/closing animations are not interruptible.
        }
        state.player.interactionCooldown = 0.35;
        return;
      }
    }
  }

  for (const c of getAllContainers(state)) {
    if (c.searched) continue;
    if (nearest && c.id === nearest.id && input.interact) {
      c.searchProgress = Math.min(c.searchDuration, c.searchProgress + dt);
      if (c.searchProgress >= c.searchDuration) {
        completeContainerSearch(state, c, rng);
      }
    } else if (c.searchProgress > 0) {
      c.searchProgress = Math.max(0, c.searchProgress - dt * 0.5);
    }
  }
}

function stepPickups(state: WorldState, dt: number): void {
  const { player } = state;
  const remaining: LootPickup[] = [];
  for (const pickup of state.pickups) {
    pickup.ttl -= dt;
    if (pickup.ttl <= 0) continue;

    if (distance(pickup, player) <= player.radius + 0.55) {
      if (pickup.kind === 'scrap' || pickup.kind === 'corpse') {
        player.carriedScrap += pickup.amount;
        if (pickup.cashAmount) {
          player.carriedCash += pickup.cashAmount;
        }
        if (pickup.xpAmount) {
          player.unbankedXp += pickup.xpAmount;
        }
        if (pickup.items && pickup.items.length > 0) {
          for (const item of pickup.items) {
            addItemToInventory(player, item.templateId, item.id, item.quantity);
          }
        }
        if (player.inSafeZone) {
          const banked = player.carriedScrap;
          const bankedCash = player.carriedCash;
          const bankedXp = player.unbankedXp;
          player.stash += banked;
          player.carriedScrap = 0;
          player.bankCash += bankedCash;
          player.carriedCash = 0;
          player.unbankedXp = 0;
          if (bankedXp > 0) {
            player.xp += bankedXp;
            checkLevelUp(state);
          }
          pushEvent(state, {
            type: 'stash_banked',
            amount: banked,
            cashBanked: bankedCash,
            xpBanked: bankedXp,
          });
        }
      } else if (pickup.kind === 'ammo') {
        player.weapons.rifle.reserve += pickup.amount;
        player.weapons.shotgun.reserve += Math.max(4, Math.round(pickup.amount / 3));
        player.weapons.pistol.reserve += Math.max(6, Math.round(pickup.amount / 2));
        player.weapons.smg.reserve += pickup.amount;
      } else if (pickup.kind === 'medkit') {
        player.health = clamp(player.health + pickup.amount, 0, player.maxHealth);
      } else if (pickup.kind === 'antiviral') {
        player.infected = false;
        player.infectionSeverity = 0;
        addItemToInventory(player, 'antiviral', `pk-av-${state.nextEntityId++}`, 1);
      } else if (pickup.kind === 'food') {
        player.hunger = clamp(player.hunger + pickup.amount, 0, player.maxHunger);
      } else if (pickup.kind === 'cash') {
        player.carriedCash += pickup.amount;
      }
      pushEvent(state, {
        type: 'pickup',
        kind: pickup.kind,
        x: pickup.x,
        y: pickup.y,
        amount: pickup.amount,
      });
      continue;
    }

    remaining.push(pickup);
  }
  state.pickups = remaining;
}

function stepSpawner(state: WorldState, dt: number, rng: () => number): void {
  if (state.activeInterior) {
    if (state.activeInterior.exitLocked && state.zombies.length === 0) {
      state.activeInterior.exitLocked = false;
    }
    return;
  }

  state.spawnTimer -= dt * (1 + state.aggroIndex * 0.008);
  if (state.spawnTimer > 0) return;

  const tier = state.player.threatTier;
  state.spawnTimer = spawnIntervalFor(tier);
  // Cap counts only zombies near this player: zombies never despawn and the world is shared online.
  const nearby = state.zombies.filter((z) => distance(z, state.player) < LOCAL_CAP_RADIUS).length;
  if (state.zombies.length >= MAX_ZOMBIES || nearby >= localZombieCapFor(tier)) return;

  const anchor = state.player.inSafeZone ? state.map.safeCenter : state.player;
  const minDist = state.player.inSafeZone ? state.map.safeRadius + 3 : 8.5;
  const maxDist = state.player.inSafeZone ? state.map.safeRadius + 10 : 15;
  const pos = findSpawnPoint(state.map, anchor, minDist, maxDist, rng);
  if (!pos || !canSpawnZombieAt(state.map, pos.x, pos.y)) return;

  const variant = selectZoneThemedZombieVariant(
    state.map,
    pos.x,
    pos.y,
    state.aggroIndex,
    rng,
  );
  const dir = normalize({ x: state.player.x - pos.x, y: state.player.y - pos.y });
  state.zombies.push(
    createZombie(`z-${state.nextEntityId++}`, variant, pos, Math.atan2(dir.y, dir.x)),
  );
}

/**
 * Advances the authoritative world by `dt` seconds.
 *
 * `rng` is injectable so tests can drive deterministic headshots, spawns, and
 * loot drops without monkey-patching `Math.random`.
 */
export function stepWorld(
  state: WorldState,
  input: InputState,
  dt: number,
  rng: () => number = Math.random,
): WorldState {
  const clampedDt = clamp(dt, 0, 0.1);
  if (clampedDt <= 0 || state.phase === 'dead') return state;

  state.tick += 1;
  state.time += clampedDt;
  InteriorManager.stepPortalTransitions(state, clampedDt);

  updatePlayer(state, input, clampedDt);
  if ((state.phase as GamePhase) === 'dead') return state;

  if (state.player.meleeImpactPending && state.player.meleeImpactTimer <= 0) {
    state.player.meleeImpactPending = false;
    if (state.player.activeWeapon === 'melee') fireWeapon(state, rng, true);
  }

  const activeWeapon = state.player.weapons[state.player.activeWeapon];
  if (activeWeapon.isMelee) {
    if (!input.firing) {
      state.player.meleeInputHeld = false;
    } else if (!state.player.meleeInputHeld) {
      state.player.meleeInputHeld = true;
      fireWeapon(state, rng);
    }
  } else if (input.firing) {
    fireWeapon(state, rng);
  }
  stepContainers(state, input, clampedDt, rng);
  stepZombies(state, clampedDt, rng);
  if ((state.phase as GamePhase) === 'dead') return state;
  if (state.activeInterior) stepExteriorZombiesAtBuilding(state, clampedDt);

  stepProjectilesAndPulses(state, clampedDt, rng);
  if ((state.phase as GamePhase) === 'dead') return state;

  stepPickups(state, clampedDt);
  stepSpawner(state, clampedDt, rng);
  state.zombies = state.zombies.filter((z) => z.health > 0);
  return state;
}

/** Advance shared world entities while giving every connected avatar one fair substep. */
export function stepRoomWorld(
  state: OutlandsRoomState,
  inputs: Record<string, InputState>,
  dt: number,
  rng: () => number = Math.random,
  activePlayerIds?: ReadonlySet<string>,
): OutlandsRoomState {
  const activePlayers = Object.values(state.players).filter(({ playerId, state: player }) =>
    player.alive && (!activePlayerIds || activePlayerIds.has(playerId)));
  if (activePlayers.length === 0) {
    state.phase = 'dead';
    return state;
  }

  const substep = clamp(dt, 0, 0.1) / activePlayers.length;
  for (const slot of activePlayers) {
    state.player = slot.state;
    state.phase = 'playing';
    const input = inputs[slot.playerId] ?? {
      move: { x: 0, y: 0 },
      aim: { x: Math.cos(slot.state.angle), y: Math.sin(slot.state.angle) },
      firing: false,
      reload: false,
      sprint: false,
    };
    const eventStart = state.events.length;
    stepWorld(state, input, substep, rng);
    slot.state = state.player;
    if (!slot.state.alive) {
      const death = state.events.slice(eventStart).find((event) => event.type === 'player_died');
      state.lostScrapByPlayer[slot.playerId] = death?.type === 'player_died' ? death.droppedScrap : 0;
    }
  }

  const firstPlayer = Object.values(state.players)[0];
  if (firstPlayer) state.player = firstPlayer.state;
  state.phase = Object.values(state.players).some(({ state: player }) => player.alive)
    ? 'playing'
    : 'dead';
  return state;
}

/** Melee is always carried; firearms must sit in one of the two loadout slots. */
export function isInLoadout(player: PlayerState, weaponId: WeaponId): boolean {
  return weaponId === 'melee' || player.loadout.includes(weaponId);
}

/**
 * Moves `weaponId` into a loadout slot. Assigning a weapon that already sits in
 * the other slot swaps the two, so one gun can never fill both.
 */
export function assignLoadoutSlot(
  state: WorldState,
  slot: 0 | 1,
  weaponId: WeaponId,
): boolean {
  const { player } = state;
  if (weaponId === 'melee' || !player.weapons[weaponId]) return false;
  if (!canEquipWeapon(player, weaponId)) return false;
  if (player.loadout[slot] === weaponId) return false;
  const other: 0 | 1 = slot === 0 ? 1 : 0;
  if (player.loadout[other] === weaponId) player.loadout[other] = player.loadout[slot];
  player.loadout[slot] = weaponId;
  if (!isInLoadout(player, player.activeWeapon)) {
    player.activeWeapon = weaponId;
    player.reloadTimer = 0;
  }
  return true;
}

/** Respawns at the nearest Outpost while keeping stash, progression, loadout, and dropped corpses. */
export function restartWorld(state: WorldState, seed: number = state.map.seed, outpostId?: string): WorldState {
  const preservedPickups = state.pickups.filter((p) => p.kind === 'corpse');
  const prevPlayer = state.player;
  const fresh = createWorld(seed, prevPlayer.stash, outpostId);
  fresh.player.loadout = [...prevPlayer.loadout];
  fresh.player.deaths = prevPlayer.deaths;
  fresh.player.kills = prevPlayer.kills;
  fresh.player.bankCash = prevPlayer.bankCash;
  fresh.player.level = prevPlayer.level;
  fresh.player.xp = prevPlayer.xp;
  fresh.player.statPoints = prevPlayer.statPoints;
  fresh.player.proficiencyPoints = prevPlayer.proficiencyPoints;
  fresh.player.attributes = { ...prevPlayer.attributes };
  fresh.player.proficiencies = { ...prevPlayer.proficiencies };
  fresh.player.profession = prevPlayer.profession;
  fresh.player.stashedItems = [...prevPlayer.stashedItems];
  fresh.player.quests = prevPlayer.quests.map((q) => ({ ...q }));
  fresh.pickups.push(...preservedPickups);
  fresh.nextEntityId = Math.max(fresh.nextEntityId, state.nextEntityId);
  return fresh;
}

export function threatReadout(state: WorldState): {
  tier: ThreatTier;
  distanceFromSafe: number;
  label: string;
} {
  const distanceFromSafe = distanceOutsideSafeZone(
    state.map,
    state.player.x,
    state.player.y,
  );
  const tier = state.player.threatTier;
  const labels: Record<ThreatTier, string> = {
    0: "S-ZONE · NASTYA'S HOLDOUT",
    1: 'TIER I · INNER SUBURBS',
    2: 'TIER II · COMMERCIAL RUINS',
    3: 'TIER III · SECRONOM BIO-CORE',
  };
  return { tier, distanceFromSafe, label: labels[tier] };
}
