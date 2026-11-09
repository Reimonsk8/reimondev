import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Award,
  Backpack,
  HeartPulse,
  Map as MapIcon,
  Maximize,
  Minimize,
  RotateCw,
  PackageSearch,
  RefreshCw,
  ShoppingBag,
  Skull,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { LocalGameServer } from './engine/localServer';
import { loadKeybinds, saveKeybinds, DEFAULT_KEYBINDS, KEYBIND_LABELS, type KeybindAction } from './engine/keybinds';
import { SocketGameClient } from './engine/SocketGameClient';
import {
  fetchSectorStatus,
  outlandsWsUrl,
  type SectorStatus,
} from './engine/sectorStatus';
import { InteriorManager, PORTAL_BARRICADE_SCRAP_COST } from './engine/interiors';
import { SAFEZONE_DIRECTORY, type SafezoneEntry } from './ui/SafezoneMapModal';
import { TouchJoystick, clientToLocal, useTouchUi } from './ui/TouchControls';
import { distance, normalize, screenDirectionToWorld } from './engine/isometric';
import { SpatialNetcodeSync } from './engine/netcode';
import { canEquipWeapon } from './engine/spawner';
import { mountSpriteDebug } from './ui/spriteDebug';
import {
  allocateAttributePoint,
  allocateProficiencyPoint,
  assignLoadoutSlot,
  buyMarketplaceItem,
  claimQuestReward,
  getNearestSearchableContainer,
  outpostChefService,
  outpostHealService,
  outpostRepairService,
  restartWorld,
  sellInventoryItem,
  threatColor,
  threatReadout,
  useInventoryItem,
} from './engine/simulation';
import {
  ITEM_TEMPLATES,
  OUTPOSTS,
  SHARED_OUTLANDS_SEED,
  WEAPON_PROFICIENCY_LABELS,
  buildSectorGrid,
  chunkCoordAt,
  getSectorAt,
  masteryRankLabel,
  xpToNextLevel,
} from './engine/world';
import type {
  InputState,
  InventoryItem,
  OutpostId,
  OutpostQuest,
  PlayerAttributes,
  ProfessionId,
  RemoteOutlandsPlayer,
  SectorCell,
  ThreatTier,
  WeaponId,
  WeaponProficiencyId,
  WeaponState,
  WorldState,
} from './engine/types';
import { OutlandsRenderer } from './render/OutlandsRenderer';
import { HUD } from './ui/HUD';
import { Minimap } from './ui/Minimap';
import { OutlandsAudio, playEventSounds } from './audio';
import './zombieShooter.css';

const STASH_KEY = 'c888_outlands_stash';
const MUTE_KEY = 'c888_outlands_muted';
const FIXED_STEP = 1 / 60;

interface LobbyPlayerEntry {
  playerId: string;
  nickname?: string;
  avatarImage?: string | null;
  position?: {
    x?: number;
    y?: number;
    ox?: number;
    oy?: number;
    angle?: number;
    weapon?: WeaponId;
    health?: number;
    maxHealth?: number;
    firing?: boolean;
    shotSeq?: number;
    game?: string;
  };
}

interface OutlandsProps {
  userId?: string | null;
  nickname?: string;
  avatarImage?: string | null;
  onRequestLogin?: () => void;
  lobby?: {
    status?: string;
    players?: Record<string, LobbyPlayerEntry>;
    sendMove?: (
      pos: Record<string, unknown>,
      overrideNick?: string | null,
      overrideAvatar?: string | null,
    ) => void;
  };
}

type Phase = 'briefing' | 'playing' | 'dead';
type DrawerTab = 'none' | 'inventory' | 'character' | 'outpost' | 'map' | 'controls';

interface HudSnapshot {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  hunger: number;
  maxHunger: number;
  armorName: string;
  armorAbsorption: number;
  armorDurability: number;
  armorMaxDurability: number;
  infected: boolean;
  infectionSeverity: number;
  flashlightOn: boolean;
  reticleBloom: number;
  focusFactor: number;
  ammo: number;
  reserve: number;
  magSize: number;
  weapon: WeaponId;
  weaponName: string;
  weapons: Record<WeaponId, WeaponState>;
  loadout: [WeaponId, WeaponId];
  reloading: boolean;
  carriedScrap: number;
  stash: number;
  carriedCash: number;
  bankCash: number;
  level: number;
  xp: number;
  xpNext: number;
  unbankedXp: number;
  statPoints: number;
  proficiencyPoints: number;
  attributes: PlayerAttributes;
  proficiencies: Record<WeaponProficiencyId, number>;
  profession: ProfessionId;
  inventoryCols: number;
  inventoryRows: number;
  inventory: InventoryItem[];
  quests: OutpostQuest[];
  activeOutpostId: OutpostId;
  kills: number;
  deaths: number;
  inSafeZone: boolean;
  threatTier: ThreatTier;
  threatLabel: string;
  distanceFromSafe: number;
  zombiesAlive: number;
  corpseDropped: boolean;
  aggroIndex: number;
  nearbyContainerLabel: string | null;
  nearbyContainerProgress: number;
  nearbyDoorLabel: string | null;
  activeInteriorName: string | null;
  playerX: number;
  playerY: number;
  mapWidth: number;
  mapHeight: number;
  sectorCode: string;
  sectorName: string;
  sectors: SectorCell[];
}

function readStoredStash(): number {
  try {
    const raw = Number(localStorage.getItem(STASH_KEY));
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
  } catch {
    return 0;
  }
}

function writeStoredStash(value: number): void {
  try {
    localStorage.setItem(STASH_KEY, String(Math.max(0, Math.floor(value))));
  } catch {
    // Private browsing or quota full; session stash still works.
  }
}

function snapshotFrom(state: WorldState): HudSnapshot {
  const { player } = state;
  const active = player.weapons[player.activeWeapon];
  const threat = threatReadout(state);
  const nearestContainer = getNearestSearchableContainer(state);
  const nearestDoor = InteriorManager.findNearestDoor(state);
  const nearestPortal = InteriorManager.findNearestPortal(state);
  const nearExit = InteriorManager.isNearInteriorExit(state);
  const nearbyDoorLabel = state.activeInterior
    ? nearExit
      ? state.activeInterior.exitLocked
        ? `Exit Locked (${state.zombies.length} Breach Hostiles Remaining)`
        : `Exit ${state.activeInterior.label} to Street`
      : nearestPortal
        ? nearestPortal.kind === 'window'
          ? nearestPortal.state === 'smashed'
            ? 'Smashed Window'
            : 'Smash Window [E]'
          : nearestPortal.state === 'opening'
            ? 'Opening Interior Door…'
            : nearestPortal.state === 'closing'
              ? 'Closing Interior Door…'
              : nearestPortal.state === 'barricaded'
                ? 'Barricaded Door'
                : nearestPortal.state === 'open'
            ? 'Close Interior Door [E]'
            : 'Open Interior Door [E]'
        : null
    : nearestDoor
      ? nearestDoor.locked
        ? `Locked entrance · Press X to force`
        : nearestDoor.state === 'barricaded'
          ? 'Barricaded entrance · Press X to force'
          : nearestDoor.state === 'opening'
            ? 'Opening entrance…'
            : nearestDoor.state === 'closing'
              ? 'Closing entrance…'
              : nearestDoor.state === 'closed'
                ? `Open ${nearestDoor.label} [E]`
                : distance(player, nearestDoor) <= player.radius + 0.42
                  ? `Enter ${nearestDoor.label} [E]`
                  : `Close entrance [E]`
      : null;
  return {
    health: Math.ceil(player.health),
    maxHealth: player.maxHealth,
    stamina: Math.round(player.stamina),
    maxStamina: player.maxStamina,
    hunger: Math.round(player.hunger),
    maxHunger: player.maxHunger,
    armorName: player.armorName,
    armorAbsorption: Math.round(player.armorAbsorption * 100),
    armorDurability: Math.round(player.armorDurability),
    armorMaxDurability: player.armorMaxDurability,
    infected: player.infected,
    infectionSeverity: Math.round(player.infectionSeverity),
    flashlightOn: player.flashlightOn,
    reticleBloom: player.reticleBloom,
    focusFactor: Math.round(player.focusFactor * 100),
    ammo: active.ammo,
    reserve: active.reserve,
    magSize: active.magSize,
    weapon: player.activeWeapon,
    weaponName: active.name,
    weapons: { ...player.weapons },
    loadout: [...player.loadout] as [WeaponId, WeaponId],
    reloading: player.reloadTimer > 0,
    carriedScrap: player.carriedScrap,
    stash: player.stash,
    carriedCash: player.carriedCash,
    bankCash: player.bankCash,
    level: player.level,
    xp: player.xp,
    xpNext: xpToNextLevel(player.level),
    unbankedXp: player.unbankedXp,
    statPoints: player.statPoints,
    proficiencyPoints: player.proficiencyPoints,
    attributes: { ...player.attributes },
    proficiencies: { ...player.proficiencies },
    profession: player.profession,
    inventoryCols: player.inventoryCols,
    inventoryRows: player.inventoryRows,
    inventory: player.inventory.map((item) => ({ ...item })),
    quests: player.quests.map((q) => ({ ...q })),
    activeOutpostId: player.activeOutpostId,
    kills: player.kills,
    deaths: player.deaths,
    inSafeZone: player.inSafeZone,
    threatTier: threat.tier,
    threatLabel: threat.label,
    distanceFromSafe: Math.round(threat.distanceFromSafe),
    zombiesAlive: state.zombies.length,
    corpseDropped: state.pickups.some((p) => p.kind === 'corpse'),
    aggroIndex: Math.round(state.aggroIndex),
    nearbyContainerLabel: nearestContainer ? nearestContainer.label : null,
    nearbyContainerProgress: nearestContainer
      ? Math.round((nearestContainer.searchProgress / nearestContainer.searchDuration) * 100)
      : 0,
    nearbyDoorLabel,
    activeInteriorName: state.activeInterior ? state.activeInterior.label : null,
    playerX: player.x,
    playerY: player.y,
    mapWidth: state.map.width,
    mapHeight: state.map.height,
    sectorCode: getSectorAt(state.map, player.x, player.y).code,
    sectorName: getSectorAt(state.map, player.x, player.y).name,
    sectors: state.map.sectors && state.map.sectors.length > 0 ? state.map.sectors : buildSectorGrid(),
  };
}

export default function ZombieShooter({
  userId,
  nickname = 'Survivor',
  avatarImage = null,
  lobby,
  onRequestLogin,
}: OutlandsProps = {}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const serverRef = useRef<LocalGameServer | SocketGameClient | null>(null);
  const rendererRef = useRef<OutlandsRenderer | null>(null);
  const audioRef = useRef<OutlandsAudio | null>(null);
  const tabIdRef = useRef<string>(
    `outlands-${Math.random().toString(36).slice(2, 9)}`,
  );
  const remoteMapRef = useRef<Map<string, RemoteOutlandsPlayer>>(new Map());
  const shotSeqRef = useRef(0);
  const lobbyRef = useRef(lobby);
  const identityRef = useRef({ userId, nickname, avatarImage });

  useEffect(() => {
    lobbyRef.current = lobby;
    identityRef.current = { userId, nickname, avatarImage };
  }, [lobby, userId, nickname, avatarImage]);

  if (!serverRef.current) {
    serverRef.current = new LocalGameServer(SHARED_OUTLANDS_SEED, readStoredStash());
  }
  if (!audioRef.current) {
    audioRef.current = new OutlandsAudio();
  }

  const keysRef = useRef<Set<string>>(new Set());
  const keybindsRef = useRef(loadKeybinds());
  const [keybinds, setKeybinds] = useState(loadKeybinds());
  const [rebinding, setRebinding] = useState<KeybindAction | null>(null);
  const pointerDownRef = useRef(false);
  const interactHeldRef = useRef(false);
  const aimWorldDeltaRef = useRef({ x: 1, y: 0 });
  const pendingReloadRef = useRef(false);
  const pendingWeaponRef = useRef<WeaponId | undefined>(undefined);
  const pendingLoadoutRef = useRef<[0 | 1, WeaponId] | undefined>(undefined);
  const pendingFlashlightRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('briefing');
  const phaseRef = useRef<Phase>('briefing');
  const touchMoveRef = useRef({ x: 0, y: 0 });
  const aimPointerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const touchUi = useTouchUi();
  const [fullscreen, setFullscreen] = useState(false);

  const [showMinimap, setShowMinimap] = useState(false);

  // Lock mobile browsers to landscape so the isometric canvas never renders sideways.
  useEffect(() => {
    const so = (screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
    if (so && typeof so.lock === 'function') {
      void so.lock('landscape').catch(() => { /* unsupported / not fullscreen — CSS fallback handles it */ });
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => { /* already exited */ });
      return;
    }
    void root
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => {
        // Android only honours the lock inside fullscreen; iOS Safari has neither.
        const so = (screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
        void so?.lock?.('landscape').catch(() => { /* unsupported */ });
      })
      .catch(() => { /* fullscreen unsupported */ });
  }, []);
  const toggleLandscape = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const so = (screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
    void so?.lock?.('landscape').catch(() => { /* unsupported */ });
    root.classList.toggle('force-landscape');
  }, []);
  const [drawer, setDrawer] = useState<DrawerTab>('none');
  const [pendingSellItem, setPendingSellItem] = useState<InventoryItem | null>(null);
  const [marketSearch, setMarketSearch] = useState('');
  const [hud, setHud] = useState<HudSnapshot>(() =>
    snapshotFrom(serverRef.current!.state),
  );
  const [banner, setBanner] = useState<string | null>(null);
  const [sectorStatus, setSectorStatus] = useState<SectorStatus | null>(null);
  const [joiningSector, setJoiningSector] = useState(false);
  const sharedSectorUrl = outlandsWsUrl();
  const [muted, setMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const syncHud = useCallback(() => {
    if (!serverRef.current) return;
    setHud(snapshotFrom(serverRef.current.state));
  }, []);

  const confirmSellItem = useCallback(() => {
    const item = pendingSellItem;
    const server = serverRef.current;
    if (item && server && sellInventoryItem(server.state, item.id)) {
      setBanner(`Sold ${item.name}`);
      syncHud();
    }
    setPendingSellItem(null);
  }, [pendingSellItem, syncHud]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!banner) return undefined;
    const timeout = window.setTimeout(() => setBanner(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [banner]);

  useEffect(() => {
    if (phase !== 'briefing' || !sharedSectorUrl) {
      setSectorStatus(null);
      return undefined;
    }
    let cancelled = false;
    const refresh = async () => {
      const next = await fetchSectorStatus();
      if (!cancelled) setSectorStatus(next);
    };
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [phase, sharedSectorUrl]);

  useEffect(() => {
    audioRef.current?.setEnabled(!muted);
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Ignore storage failures.
    }
  }, [muted]);

  // Ingest remote Outlands players from the shared AWS WebSocket lobby
  useEffect(() => {
    const players = lobby?.players;
    if (!players) return;
    const now = Date.now();
    for (const entry of Object.values(players)) {
      if (!entry || entry.playerId === userId) continue;
      const pos = entry.position;
      if (!pos) continue;
      const ox = typeof pos.ox === 'number' ? pos.ox : undefined;
      const oy = typeof pos.oy === 'number' ? pos.oy : undefined;
      if (ox === undefined || oy === undefined) continue;
      const prev = remoteMapRef.current.get(entry.playerId);
      const nextShotSeq = pos.shotSeq ?? 0;
      if (
        prev &&
        nextShotSeq > (prev.shotSeq ?? 0) &&
        serverRef.current &&
        audioRef.current
      ) {
        audioRef.current.playShot(
          pos.weapon ?? 'rifle',
          serverRef.current.state.player,
          { x: ox, y: oy },
        );
      }
      remoteMapRef.current.set(entry.playerId, {
        playerId: entry.playerId,
        nickname: entry.nickname || 'Survivor',
        avatarColor: entry.avatarImage ?? null,
        x: ox,
        y: oy,
        angle: typeof pos.angle === 'number' ? pos.angle : 0,
        weapon: pos.weapon ?? 'rifle',
        health: typeof pos.health === 'number' ? pos.health : 100,
        maxHealth: typeof pos.maxHealth === 'number' ? pos.maxHealth : 100,
        firing: Boolean(pos.firing),
        shotSeq: nextShotSeq,
        lastSeen: now,
      });
    }
  }, [lobby?.players, userId]);

  const updateAimFromClientPoint = useCallback((clientX: number, clientY: number) => {
    const host = stageRef.current;
    const renderer = rendererRef.current;
    const server = serverRef.current;
    if (!host || !renderer || !server) return;
    const local = clientToLocal(host, clientX, clientY);
    renderer.setPointerScreen(local.x, local.y);

    const worldPoint = renderer.screenToWorld(local.x, local.y);
    const dx = worldPoint.x - server.state.player.x;
    const dy = worldPoint.y - server.state.player.y;
    if (Math.hypot(dx, dy) > 0.01) {
      aimWorldDeltaRef.current = normalize({ x: dx, y: dy });
    }
  }, []);

  const quickUseCategory = useCallback(
    (category: 'med' | 'food' | 'antiviral' | 'armor') => {
      const server = serverRef.current;
      if (!server) return;
      const candidate = server.state.player.inventory.find(
        (item) =>
          item.category === category ||
          (category === 'antiviral' && item.curesInfection),
      );
      if (!candidate) {
        setBanner(`No ${category.toUpperCase()} item in grid inventory`);
        return;
      }
      if (useInventoryItem(server.state, candidate.id)) {
        audioRef.current?.playPickup();
        setBanner(`Used ${candidate.name}`);
        syncHud();
      }
    },
    [syncHud],
  );

  useEffect(() => {
    const host = stageRef.current;
    if (!host || !serverRef.current) return undefined;
    let stopSpriteDebug: (() => void) | null = null;

    const renderer = new OutlandsRenderer(host);
    rendererRef.current = renderer;
    const debugWindow = window as unknown as {
      __outlands?: {
        server: LocalGameServer | SocketGameClient;
        renderer: OutlandsRenderer;
        /** Dev-only UI QA hook; core simulation death remains covered by unit tests. */
        forceDeath: () => void;
      };
    };
    if (
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ) {
      debugWindow.__outlands = {
        server: serverRef.current,
        renderer,
        forceDeath: () => {
          const state = serverRef.current?.state;
          if (!state) return;
          state.player.health = 0;
          state.player.alive = false;
          state.phase = 'dead';
        },
      };
      stopSpriteDebug =
        new URLSearchParams(window.location.search).has('debug') && import.meta.env.DEV
          ? mountSpriteDebug(() => rendererRef.current?.getSpriteDebug() ?? null)
          : null;
    }

    let raf = 0;
    let accumulator = 0;
    let lastTime = performance.now();
    let hudTimer = 0;
    let bannerTimer = 0;

    const netSync = new SpatialNetcodeSync(
      identityRef.current.userId || tabIdRef.current,
      identityRef.current.nickname || 'Survivor',
      {
        sendMove: (payload) => {
          const currentLobby = lobbyRef.current;
          const idInfo = identityRef.current;
          if (currentLobby?.status === 'connected' && currentLobby.sendMove) {
            currentLobby.sendMove(payload, idInfo.nickname, idInfo.avatarImage);
          }
        },
        onRemoteShot: (shotPacket) => {
          if (audioRef.current) {
            audioRef.current.playShot(
              shotPacket.weapon,
              serverRef.current?.state.player,
              shotPacket.origin,
            );
          }
        },
      },
    );

    void renderer.init(serverRef.current.state);

    const readMoveVector = () => {
      const touch = touchMoveRef.current;
      if (touch.x !== 0 || touch.y !== 0) return screenDirectionToWorld(touch.x, touch.y);
      const keys = keysRef.current;
      const kb = keybindsRef.current;
      const sx =
        (keys.has(kb.moveRight) ? 1 : 0) -
        (keys.has(kb.moveLeft) ? 1 : 0);
      const sy =
        (keys.has(kb.moveDown) ? 1 : 0) -
        (keys.has(kb.moveUp) ? 1 : 0);
      if (sx === 0 && sy === 0) return { x: 0, y: 0 };
      return screenDirectionToWorld(sx, sy);
    };

    const frame = (now: number) => {
      const server = serverRef.current;
      if (!server) {
        raf = window.requestAnimationFrame(frame);
        return;
      }

      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      if (phaseRef.current === 'playing') {
        accumulator += dt;
        while (accumulator >= FIXED_STEP) {
          const keys = keysRef.current;
          const input: InputState = {
            move: readMoveVector(),
            aim: aimWorldDeltaRef.current,
            firing: pointerDownRef.current || keys.has('Space'),
            reload: pendingReloadRef.current,
            sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
            weaponSwitch: pendingWeaponRef.current,
            loadoutSlot: pendingLoadoutRef.current?.[0],
            loadoutWeapon: pendingLoadoutRef.current?.[1],
            interact: interactHeldRef.current || keys.has('KeyE'),
            toggleFlashlight: pendingFlashlightRef.current,
          };
          pendingReloadRef.current = false;
          pendingWeaponRef.current = undefined;
          pendingLoadoutRef.current = undefined;
          pendingFlashlightRef.current = false;

          const switchedWeapon = Boolean(input.weaponSwitch);
          server.step(FIXED_STEP, input);
          audioRef.current?.stepSpatialWorld(server.state, FIXED_STEP);
          if (switchedWeapon) {
            setHud(snapshotFrom(server.state));
          }
          if (server.state.phase === 'dead' && phaseRef.current !== 'dead') {
            pointerDownRef.current = false;
            phaseRef.current = 'dead';
            setPhase('dead');
            setHud(snapshotFrom(server.state));
          }
          const events = server.drainEvents();
          if (events.length > 0) {
            renderer.ingestEvents(events);
            if (audioRef.current) {
              playEventSounds(audioRef.current, events, server.state.player);
            }
            for (const event of events) {
              if (event.type === 'shot') {
                shotSeqRef.current += 1;
                netSync.broadcastShootVector(
                  { x: event.x, y: event.y },
                  event.angle,
                  event.weapon,
                  shotSeqRef.current,
                );
              } else if (event.type === 'zombie_hit') {
                netSync.broadcastZombieHit({
                  zombieId: event.zombieId,
                  x: event.x,
                  y: event.y,
                  angle: event.angle,
                  damage: event.force,
                  headshot: Boolean(event.headshot),
                  lethal: event.lethal,
                  weapon: event.weapon ?? server.state.player.activeWeapon,
                });
              }
              if (event.type === 'stash_banked') {
                writeStoredStash(server.state.player.stash);
                const parts: string[] = [];
                if (event.amount > 0) parts.push(`+${event.amount} scrap`);
                if (event.cashBanked && event.cashBanked > 0) parts.push(`+$${event.cashBanked}`);
                if (event.xpBanked && event.xpBanked > 0) parts.push(`+${event.xpBanked} XP`);
                setBanner(`Banked at Outpost: ${parts.join(' · ')}`);
                bannerTimer = 3.2;
              } else if (event.type === 'container_searched') {
                const lootStr =
                  event.itemNames.length > 0 ? event.itemNames.join(', ') : 'Supplies';
                setBanner(`Searched ${event.label}: ${lootStr} + $${event.cashFound}`);
                bannerTimer = 3.2;
              } else if (event.type === 'loot_aggro') {
                setBanner(`LOOT AGGRO! Search noise attracted ${event.count} infected!`);
                bannerTimer = 3.5;
              } else if (event.type === 'level_up') {
                setBanner(
                  `LEVEL ${event.level} REACHED! +5 Attribute Points & +10 Proficiency Points`,
                );
                bannerTimer = 4.0;
              } else if (event.type === 'pickup' && event.kind === 'corpse') {
                setBanner(`Recovered fallen pack (+${event.amount} scrap & gear)`);
                bannerTimer = 3.2;
              } else if (event.type === 'interior_entered') {
                setBanner(`Entered ${event.label} · Pitch-black interior`);
                bannerTimer = 3.5;
              } else if (event.type === 'interior_exited') {
                setBanner(`Exited ${event.label} back to quarantine street`);
                bannerTimer = 2.8;
              } else if (event.type === 'horde_breach') {
                setBanner(`HORDE BREACH! ${event.waveCount} infected locked the exit — clear the room!`);
                bannerTimer = 4.5;
              } else if (event.type === 'player_died') {
                pointerDownRef.current = false;
                setPhase('dead');
                setHud(snapshotFrom(server.state));
              }
            }
          }
          accumulator -= FIXED_STEP;
        }
      }

      const authoritativeRemotes: RemoteOutlandsPlayer[] = (server.state.remotePlayers ?? []).map(
        (entry) => ({
          playerId: entry.id,
          nickname: entry.nickname,
          avatarColor: null,
          x: entry.player.x,
          y: entry.player.y,
          angle: entry.player.angle,
          weapon: entry.player.activeWeapon,
          health: entry.player.health,
          maxHealth: entry.player.maxHealth,
          firing: false,
          shotSeq: 0,
          lastSeen: Date.now(),
        }),
      );
      if (authoritativeRemotes.length > 0) {
        renderer.setRemotePlayers(authoritativeRemotes);
      } else {
        const interpolatedPeers = netSync.stepInterpolatedPeers(
          server.state.player,
          Array.from(remoteMapRef.current.values()),
          dt,
        );
        renderer.setRemotePlayers(interpolatedPeers);
      }

      const isSprinting =
        keysRef.current.has('ShiftLeft') || keysRef.current.has('ShiftRight');
      netSync.syncPlayerState(
        server.state,
        pointerDownRef.current,
        shotSeqRef.current,
        isSprinting,
      );

      renderer.render(server.state, dt);

      hudTimer += dt;
      if (hudTimer >= 0.08) {
        hudTimer = 0;
        setHud(snapshotFrom(server.state));
      }

      if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0) {
          setBanner(null);
        }
      }

      raf = window.requestAnimationFrame(frame);
    };

    const onResize = () => renderer.resize();
    const onKeyDown = (event: KeyboardEvent) => {
      if (rebinding) {
        event.preventDefault();
        const kb = { ...keybindsRef.current, [rebinding]: event.code };
        keybindsRef.current = kb;
        setKeybinds(kb);
        saveKeybinds(kb);
        setRebinding(null);
        return;
      }
      const activeServer = serverRef.current;
      if (
        event.code === 'Space' ||
        event.code.startsWith('Arrow') ||
        event.code === 'Tab'
      ) {
        event.preventDefault();
      }
      keysRef.current.add(event.code);
      const switchTo = (w: WeaponId) => {
        if (!activeServer || !canEquipWeapon(activeServer.state.player, w)) return;
        pendingWeaponRef.current = w;
        if (activeServer.state.player.weapons[w]) {
          activeServer.state.player.activeWeapon = w;
          activeServer.state.player.reloadTimer = 0;
          setHud(snapshotFrom(activeServer.state));
        }
      };
      const kb = keybindsRef.current;
      if (event.code === kb.reload) pendingReloadRef.current = true;
      if (event.code === kb.flashlight) pendingFlashlightRef.current = true;
      if (event.code === kb.weapon1) switchTo('melee');
      if (event.code === kb.weapon2 && activeServer) switchTo(activeServer.state.player.loadout[0]);
      if (event.code === kb.weapon3 && activeServer) switchTo(activeServer.state.player.loadout[1]);
      if (event.code === kb.inventory || event.code === 'Tab') {
        setDrawer((prev) => (prev === 'inventory' ? 'none' : 'inventory'));
      }
      if (event.code === kb.character) {
        setDrawer((prev) => (prev === 'character' ? 'none' : 'character'));
      }
      if (event.code === kb.outpost) {
        setDrawer((prev) => (prev === 'outpost' ? 'none' : 'outpost'));
      }
      if (event.code === 'KeyM') setShowMinimap((v) => !v);
      if (event.code === kb.map) {
        setDrawer((prev) => (prev === 'map' ? 'none' : 'map'));
      }
      if (event.code === kb.heal) quickUseCategory('med');
      if (event.code === kb.food) quickUseCategory('food');
      if (event.code === kb.antiviral) quickUseCategory('antiviral');
      if (event.code === kb.armor) quickUseCategory('armor');
      if (activeServer && event.code === 'KeyB') {
        if (activeServer.state.activeInterior) {
          const portal = InteriorManager.findNearestPortal(activeServer.state);
          if (portal) {
            const previousScrap = activeServer.state.player.carriedScrap;
            const previousState = portal.state;
            const nextState = InteriorManager.interactWithPortal(activeServer.state, portal.id, 'barricade');
            setBanner(
              nextState === 'barricaded' && previousState !== 'barricaded'
                ? `Door barricaded · ${PORTAL_BARRICADE_SCRAP_COST} scrap used`
                : previousScrap < PORTAL_BARRICADE_SCRAP_COST
                  ? `Need ${PORTAL_BARRICADE_SCRAP_COST} carried scrap to barricade a closed door`
                  : portal.kind !== 'door'
                    ? 'Only closed doors can be barricaded'
                    : 'Door must be closed before barricading',
            );
            setHud(snapshotFrom(activeServer.state));
          }
        } else {
          const door = InteriorManager.findNearestDoor(activeServer.state);
          if (door) {
            const before = door.state;
            const next = InteriorManager.interactWithBuildingDoor(activeServer.state, door, 'barricade');
            setBanner(
              next === 'barricaded' && before !== 'barricaded'
                ? `Entrance barricaded · ${PORTAL_BARRICADE_SCRAP_COST} scrap used`
                : activeServer.state.player.carriedScrap < PORTAL_BARRICADE_SCRAP_COST
                  ? `Need ${PORTAL_BARRICADE_SCRAP_COST} carried scrap to barricade a closed door`
                  : 'Entrance must be closed before barricading',
            );
            setHud(snapshotFrom(activeServer.state));
          }
        }
      }
      if (activeServer && event.code === 'KeyX') {
        if (activeServer.state.activeInterior) {
          const portal = InteriorManager.findNearestPortal(activeServer.state);
          if (portal) {
            InteriorManager.interactWithPortal(activeServer.state, portal.id, 'smash');
            setBanner('Smashed portal — acoustic pulse emitted!');
            setHud(snapshotFrom(activeServer.state));
          }
        } else {
          const door = InteriorManager.findNearestDoor(activeServer.state);
          if (door) {
            InteriorManager.interactWithBuildingDoor(activeServer.state, door, 'smash');
            setBanner('Forced entrance — the noise will draw nearby infected');
          }
          setHud(snapshotFrom(activeServer.state));
        }
      }
      if (event.code === 'Escape') setDrawer('none');
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keysRef.current.delete(event.code);
    };
    const onBlur = () => {
      keysRef.current.clear();
      pointerDownRef.current = false;
      interactHeldRef.current = false;
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    raf = window.requestAnimationFrame(frame);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      stopSpriteDebug?.();
      netSync.destroy();
      renderer.destroy();
      rendererRef.current = null;
      if (serverRef.current instanceof SocketGameClient) {
        serverRef.current.destroy();
      }
    };
  }, [quickUseCategory]);

  const handleSoloDeploy = useCallback(() => {
    audioRef.current?.ensure();
    setPhase('playing');
    setBanner('Deployed to local quarantine sector');
  }, []);

  const handleRespawn = useCallback(() => {
    const server = serverRef.current;
    if (!server) return;
    audioRef.current?.ensure();
    const next = restartWorld(server.state, server.state.map.seed);
    server.state = next;
    setHud(snapshotFrom(next));
    setPhase('playing');
    setBanner('Respawned at Safe Outpost · Retrieve your dropped corpse pack in the field');
  }, []);

  const handleSelectSafezone = useCallback(async (entry: SafezoneEntry) => {
    if (joiningSector) return;
    const wsUrl = outlandsWsUrl();
    if (wsUrl) {
      if (!userId) {
        setBanner('Sign in to join the shared Outlands sector.');
        onRequestLogin?.();
        return;
      }
      let token = '';
      try { token = localStorage.getItem('c888_id_token') ?? ''; } catch { /* storage unavailable */ }
      if (!token) {
        setBanner('Your session needs to be restored before joining the shared sector.');
        onRequestLogin?.();
        return;
      }
      setJoiningSector(true);
      try {
        const client = await SocketGameClient.connect(wsUrl, token, entry.id as 'nastya' | 'pastor' | 'secronom' | 'sector09');
        if (serverRef.current instanceof SocketGameClient) serverRef.current.destroy();
        serverRef.current = client;
        rendererRef.current?.resetDecals(client.state.map);
        setHud(snapshotFrom(client.state));
        setPhase('playing');
        setBanner(`Connected to shared sector · ${entry.name}`);
      } catch (error) {
        setBanner(error instanceof Error ? `Shared sector unavailable: ${error.message}` : 'Shared sector unavailable');
      } finally {
        setJoiningSector(false);
      }
      return;
    }
    const server = serverRef.current;
    if (!server) return;
    const next = restartWorld(server.state, server.state.map.seed, entry.id);
    server.state = next;
    rendererRef.current?.resetDecals(next.map);
    setHud(snapshotFrom(next));
    setPhase('playing');
    setBanner(`Deployed to ${entry.name} · ${entry.sectorCode} · Local simulation`);
  }, [joiningSector, onRequestLogin, userId]);

  const handleSwitchWeapon = useCallback((weapon: WeaponId) => {
    if (!serverRef.current || !canEquipWeapon(serverRef.current.state.player, weapon)) {
      return;
    }
    pendingWeaponRef.current = weapon;
    if (serverRef.current.state.player.weapons[weapon]) {
      serverRef.current.state.player.activeWeapon = weapon;
      serverRef.current.state.player.reloadTimer = 0;
      setHud(snapshotFrom(serverRef.current.state));
    }
  }, []);

  const assignWeaponSlot = useCallback((slot: 0 | 1, weaponId: WeaponId) => {
    const server = serverRef.current;
    if (!server) return;
    if (assignLoadoutSlot(server.state, slot, weaponId)) {
      // Mirror the pick to the room server; it owns the authoritative loadout.
      pendingLoadoutRef.current = [slot, weaponId];
      setHud(snapshotFrom(server.state));
    }
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Ignore a second finger: the stick owns its own pointer, the stage owns the aim one.
      if (aimPointerRef.current !== null && aimPointerRef.current !== event.pointerId) return;
      updateAimFromClientPoint(event.clientX, event.clientY);
    },
    [updateAimFromClientPoint],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      audioRef.current?.ensure();
      aimPointerRef.current = event.pointerId;
      // Capture so aiming keeps working when the thumb leaves the canvas.
      event.currentTarget.setPointerCapture(event.pointerId);
      updateAimFromClientPoint(event.clientX, event.clientY);
      if (phaseRef.current === 'playing' && drawer === 'none') {
        pointerDownRef.current = true;
      }
    },
    [drawer, updateAimFromClientPoint],
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (aimPointerRef.current !== null && aimPointerRef.current !== event.pointerId) return;
    aimPointerRef.current = null;
    pointerDownRef.current = false;
  }, []);

  const tierAccent = threatColor(hud.threatTier);

  return (
    <div
      ref={rootRef}
      className={`outlands-root ${touchUi ? 'is-touch' : ''}`}
      style={{ '--outlands-tier': tierAccent } as CSSProperties}
    >
      <div
        ref={stageRef}
        className="outlands-stage"
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />

      {touchUi && phase === 'playing' && drawer === 'none' && (
        <TouchJoystick moveRef={touchMoveRef} />
      )}

      {touchUi && phase === 'playing' && (
        <div className="outlands-touch-actions">
          <button
            type="button"
            className="outlands-touch-action"
            aria-label="Reload"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              pendingReloadRef.current = true;
            }}
          >
            <RefreshCw size={20} />
          </button>
          <button
            type="button"
            className="outlands-touch-action"
            aria-label="Use bandage"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              quickUseCategory('med');
            }}
          >
            <HeartPulse size={20} />
          </button>
        </div>
      )}

      <div className="outlands-vignette" aria-hidden="true" />

      <header className="outlands-topbar">
        <div className="outlands-header-stats" aria-label="Carried loot and banked stash">
          <span className="outlands-header-stat" title="Unbanked scrap">SCR <strong>{hud.carriedScrap}</strong></span>
          <span className="outlands-header-stat" title="Banked scrap stash">ST <strong>{hud.stash}</strong></span>
          <span className="outlands-header-stat" title="Carried cash">$ <strong>{hud.carriedCash}</strong></span>
          <span className="outlands-header-stat" title="Banked cash">B <strong>${hud.bankCash}</strong></span>
        </div>

        <div className="outlands-top-actions">
          <button
            type="button"
            className={`outlands-nav-btn ${drawer === 'map' ? 'is-active' : ''}`}
            aria-pressed={drawer === 'map'}
            onClick={() => setDrawer((d) => (d === 'map' ? 'none' : 'map'))}
            aria-label={`Sector map ${hud.sectorCode} [M]`}
            title={`Sector map ${hud.sectorCode} [M]`}
          >
            <MapIcon size={14} />
            <span>Sector Map ({hud.sectorCode})</span>
            <kbd>M</kbd>
          </button>
          <button
            type="button"
            className={`outlands-nav-btn ${drawer === 'inventory' ? 'is-active' : ''}`}
            aria-pressed={drawer === 'inventory'}
            onClick={() => setDrawer((d) => (d === 'inventory' ? 'none' : 'inventory'))}
            aria-label={`Grid pack, ${hud.inventory.length} items [I]`}
            title={`Grid pack, ${hud.inventory.length} items [I]`}
          >
            <Backpack size={14} />
            <span>Grid Pack ({hud.inventory.length})</span>
            <kbd>I</kbd>
          </button>

          <button
            type="button"
            className={`outlands-nav-btn ${drawer === 'character' ? 'is-active' : ''}`}
            aria-pressed={drawer === 'character'}
            onClick={() => setDrawer((d) => (d === 'character' ? 'none' : 'character'))}
            aria-label={`Character, level ${hud.level} [C]`}
            title={`Character, level ${hud.level} [C]`}
          >
            <Award size={14} />
            <span>
              Lv.{hud.level} Survivor
              {hud.statPoints + hud.proficiencyPoints > 0
                ? ` (+${hud.statPoints + hud.proficiencyPoints})`
                : ''}
            </span>
            <kbd>C</kbd>
          </button>

          <button
            type="button"
            className={`outlands-nav-btn ${drawer === 'outpost' ? 'is-active' : ''}`}
            aria-pressed={drawer === 'outpost'}
            onClick={() => setDrawer((d) => (d === 'outpost' ? 'none' : 'outpost'))}
            aria-label={`Outpost and market [O]`}
            title={`Outpost and market, $${hud.bankCash + hud.carriedCash} [O]`}
          >
            <ShoppingBag size={14} />
            <span>Outpost & Market (${hud.bankCash + hud.carriedCash})</span>
            <kbd>O</kbd>
          </button>

          <button
            type="button"
            className="outlands-icon-btn"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            title={muted ? 'Unmute audio' : 'Mute audio'}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>

          <button
            type="button"
            className="outlands-icon-btn"
            onClick={toggleLandscape}
            aria-label="Rotate to landscape"
            title="Rotate to landscape"
          >
            <RotateCw size={16} />
          </button>

          {Boolean(document.documentElement.requestFullscreen) && (
            <button
              type="button"
              className="outlands-icon-btn"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          )}
        </div>
      </header>

      {(banner || ((hud.nearbyContainerLabel || hud.nearbyDoorLabel) && phase === 'playing')) && (
        <div className="outlands-feedback-dock">
          {banner && (
            <div className="outlands-banner" role="status" aria-live="polite">
              {banner}
            </div>
          )}

          {(hud.nearbyContainerLabel || hud.nearbyDoorLabel) && phase === 'playing' && (
            <div className="outlands-container-prompt">
              <PackageSearch className="outlands-prompt-icon" size={16} aria-hidden="true" />
              <div className="outlands-prompt-copy">
                <strong className="outlands-prompt-title" title={hud.nearbyContainerLabel ?? hud.nearbyDoorLabel ?? undefined}>
                  {hud.nearbyContainerLabel ?? hud.nearbyDoorLabel}
                </strong>
                <span className="outlands-prompt-progress">
                  {hud.nearbyContainerLabel
                    ? `Hold E · Scavenge ${hud.nearbyContainerProgress}%`
                    : 'Press E · Use door'}
                </span>
              </div>
              <button
                type="button"
                className="outlands-btn outlands-btn-compact outlands-prompt-action"
                aria-label={hud.nearbyContainerLabel ? 'Hold E to search container' : 'Use nearby door'}
                onPointerDown={() => {
                  interactHeldRef.current = true;
                }}
                onPointerUp={() => {
                  interactHeldRef.current = false;
                }}
                onPointerLeave={() => {
                  interactHeldRef.current = false;
                }}
                onPointerCancel={() => {
                  interactHeldRef.current = false;
                }}
              >
                {hud.nearbyContainerLabel ? '[ Hold E ]' : '[ Use ]'}
              </button>
              {hud.activeInteriorName && !hud.nearbyContainerLabel && (
                <>
                  <button
                    type="button"
                    className="outlands-btn outlands-btn-compact"
                    onClick={() => {
                      const s = serverRef.current?.state;
                      const portal = s ? InteriorManager.findNearestPortal(s) : null;
                      if (s && portal) {
                        const before = portal.state;
                        const next = InteriorManager.interactWithPortal(s, portal.id, 'barricade');
                        setBanner(
                          next === 'barricaded' && before !== 'barricaded'
                            ? 'Door barricaded · 4 scrap used'
                            : s.player.carriedScrap < PORTAL_BARRICADE_SCRAP_COST
                              ? 'Need 4 carried scrap to barricade a closed door'
                              : portal.kind !== 'door'
                                ? 'Only closed doors can be barricaded'
                                : 'Door must be closed before barricading',
                        );
                        syncHud();
                      }
                    }}
                  >
                    Barricade · 4 scrap [B]
                  </button>
                  <button
                    type="button"
                    className="outlands-btn outlands-btn-compact"
                    onClick={() => {
                      const s = serverRef.current?.state;
                      const portal = s ? InteriorManager.findNearestPortal(s) : null;
                      if (s && portal) {
                        InteriorManager.interactWithPortal(s, portal.id, 'smash');
                        setBanner('Smashed portal — acoustic pulse emitted!');
                        syncHud();
                      }
                    }}
                  >
                    Smash [X]
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dead Frontier-style Rectangular 3x3 City Block Minimap */}
      {phase === 'playing' && drawer === 'none' && showMinimap && (
        <Minimap
          playerX={hud.playerX}
          playerY={hud.playerY}
          sectorCode={hud.sectorCode}
          sectorName={hud.sectorName}
          threatTier={hud.threatTier}
          inSafeZone={hud.inSafeZone}
          sectors={hud.sectors}
          onOpenFullMap={() => setDrawer('map')}
        />
      )}

      {/* Tactical Drawer: Grid Inventory / Character Progression / Outpost Hub / Sector Map */}
      {drawer !== 'none' && (
        <aside className="outlands-drawer" onPointerDown={(e) => e.stopPropagation()}>
          <div className="outlands-drawer-header">
            <div className="outlands-drawer-tabs">
              <button
                type="button"
                className={drawer === 'map' ? 'is-active' : ''}
                aria-pressed={drawer === 'map'}
                onClick={() => setDrawer('map')}
              >
                <MapIcon size={14} /> Map
              </button>
              <button
                type="button"
                className={drawer === 'inventory' ? 'is-active' : ''}
                aria-pressed={drawer === 'inventory'}
                onClick={() => setDrawer('inventory')}
              >
                <Backpack size={14} /> Pack
              </button>
              <button
                type="button"
                className={drawer === 'character' ? 'is-active' : ''}
                aria-pressed={drawer === 'character'}
                onClick={() => setDrawer('character')}
              >
                <Award size={14} /> Skills
              </button>
              <button
                type="button"
                className={drawer === 'outpost' ? 'is-active' : ''}
                aria-pressed={drawer === 'outpost'}
                onClick={() => setDrawer('outpost')}
              >
                <ShoppingBag size={14} /> Outpost
              </button>
              <button
                type="button"
                aria-pressed={drawer === 'controls'}
                className={drawer === 'controls' ? 'is-active' : ''}
                onClick={() => setDrawer('controls')}
              >
                ⌨ Controls
              </button>
            </div>
            <button
              type="button"
              className="outlands-drawer-close"
              onClick={() => setDrawer('none')}
            >
              Close
            </button>
          </div>

          {drawer === 'map' && (
            <div className="outlands-drawer-body">
              <div className="outlands-section-note">
                <strong>Dead Frontier Expedition Map (5×5 Sector Blocks)</strong> — Each
                rectangular city block is a 14×14-tile screen area separated by quarantine
                boulevards. The atlas tracks two sectors in every direction, including known
                outposts and the longer routes into Threat Tiers II–III.
              </div>
              <div className="outlands-sector-atlas">
                {buildSectorGrid(chunkCoordAt(hud.playerX), chunkCoordAt(hud.playerY), 2).map((cell) => {
                  const isCurrent = cell.code === hud.sectorCode;
                  return (
                    <div
                      key={cell.code}
                      className={`outlands-atlas-cell tier-${cell.tier} ${cell.isSafeZone ? 'is-safe' : ''} ${isCurrent ? 'is-current' : ''}`}
                    >
                      <div className="outlands-atlas-head">
                        <strong>
                          Block {cell.code} · {cell.name}
                        </strong>
                        <span className="outlands-badge">
                          {cell.isSafeZone ? 'S-ZONE OUTPOST' : `THREAT TIER ${cell.tier}`}
                        </span>
                      </div>
                      <p>
                        {cell.isSafeZone
                          ? 'Fortified rectangular sanctuary compound. Zero zombie entry; auto-banks carried Scrap, $USD, and XP.'
                          : cell.tier === 1
                            ? 'Inner Suburbs block. Walkers, Fast Runners, and residential supply crates.'
                            : cell.tier === 2
                              ? 'Commercial & Slum district. Spitters, Burning Infected, Leapers, and military lockers.'
                              : 'Secronom Bio-Core block. High mutation density, Wraiths, and Flesh Pounder Titans.'}
                      </p>
                      <div className="outlands-atlas-foot">
                        <span>
                          Bounds: ({cell.x},{cell.y}) → ({cell.x + cell.width},
                          {cell.y + cell.height})
                        </span>
                        {isCurrent && (
                          <strong className="outlands-atlas-here">
                            ● YOU ARE HERE ({Math.round(hud.playerX)}, {Math.round(hud.playerY)})
                          </strong>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {drawer === 'inventory' && (
            <div className="outlands-drawer-body">
              <div className="outlands-section-note">
                {hud.inventory.length} items · {hud.inventoryCols}×{hud.inventoryRows} slots · Use or sell supplies.
              </div>
              <div className="outlands-section-note">
                <strong>Loadout</strong> — melee is always carried; assign two firearms to the
                hotbar (keys 2 and 3).
              </div>
              <div className="outlands-loadout-grid">
                {(Object.keys(hud.weapons) as WeaponId[])
                  .filter((id) => id !== 'melee')
                  .map((id) => {
                    const weapon = hud.weapons[id];
                    const slot = hud.loadout.indexOf(id);
                    const locked = !canEquipWeapon(serverRef.current!.state.player, id);
                    return (
                      <div
                        key={id}
                        className={`outlands-loadout-row ${slot >= 0 ? 'is-slotted' : ''}`}
                      >
                        <div>
                          <strong>{weapon.name}</strong>
                          <small>
                            {weapon.ammo}/{weapon.reserve}
                            {locked ? ' · Locked by proficiency' : ''}
                          </small>
                        </div>
                        <div className="outlands-loadout-actions">
                          {([0, 1] as const).map((index) => (
                            <button
                              key={index}
                              type="button"
                              disabled={locked}
                              className={slot === index ? 'is-active' : ''}
                              onClick={() => assignWeaponSlot(index, id)}
                              title={`Assign to hotbar slot ${index + 2}`}
                            >
                              {index + 2}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
              <div
                className="outlands-mobile-inventory-list"
              >
                {hud.inventory.map((item) => (
                  <article key={`mobile-${item.id}`} className={`outlands-mobile-inventory-item rarity-${item.rarity}`}>
                    <div className="outlands-mobile-inventory-copy">
                      <strong>{item.name}</strong>
                      <span>{item.width}×{item.height} slots · {item.description}</span>
                    </div>
                    <div className="outlands-grid-item-actions">
                      <button type="button" onClick={() => {
                        if (serverRef.current && useInventoryItem(serverRef.current.state, item.id)) {
                          audioRef.current?.playPickup();
                          setBanner(`Used ${item.name}`);
                          syncHud();
                        }
                      }}>Use</button>
                      <button type="button" aria-label={`Review sale for ${item.name}`} onClick={() => setPendingSellItem(item)}>
                        Sell ${Math.max(10, Math.round(item.valueUsd * 0.65))}
                      </button>
                    </div>
                  </article>
                ))}
                {hud.inventory.length === 0 && <p className="outlands-empty-state">Your pack is empty.</p>}
              </div>
              <div
                className="outlands-grid-board outlands-desktop-inventory-grid"
                style={
                  {
                    '--grid-cols': hud.inventoryCols,
                    '--grid-rows': hud.inventoryRows,
                  } as CSSProperties
                }
              >
                {Array.from({ length: hud.inventoryCols * hud.inventoryRows }).map((_, idx) => (
                  <div key={idx} className="outlands-grid-cell" />
                ))}
                {hud.inventory.map((item) => (
                  <div
                    key={item.id}
                    className={`outlands-grid-item rarity-${item.rarity}`}
                    style={{
                      gridColumn: `${item.gridX + 1} / span ${item.width}`,
                      gridRow: `${item.gridY + 1} / span ${item.height}`,
                    }}
                    title={item.description}
                  >
                    <div className="outlands-grid-item-head">
                      <strong>{item.name}</strong>
                      <span>
                        {item.width}×{item.height}
                      </span>
                    </div>
                    <p>{item.description}</p>
                    <div className="outlands-grid-item-actions">
                      <button
                        type="button"
                        onClick={() => {
                          if (!serverRef.current) return;
                          if (useInventoryItem(serverRef.current.state, item.id)) {
                            audioRef.current?.playPickup();
                            setBanner(`Used ${item.name}`);
                            syncHud();
                          }
                        }}
                      >
                        Use
                      </button>
                      <button
                        type="button"
                        aria-label={`Review sale for ${item.name}`}
                        onClick={() => setPendingSellItem(item)}
                      >
                        Sell (${Math.max(10, Math.round(item.valueUsd * 0.65))})
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {drawer === 'character' && (
            <div className="outlands-drawer-body outlands-cols-2">
              <div className="outlands-character-summary" aria-label="Character summary">
                <span><small>Level</small><strong>{hud.level} · {hud.profession}</strong></span>
                <span><small>Health</small><strong>{hud.health}/{hud.maxHealth}</strong></span>
                <span><small>XP</small><strong>{hud.xp}/{hud.xpNext}</strong></span>
                <span><small>Points</small><strong>{hud.statPoints} stat · {hud.proficiencyPoints} skill</strong></span>
              </div>
              <div className="outlands-subpanel">
                <div className="outlands-subpanel-head">
                  <h3>Primary Attributes</h3>
                  <span className="outlands-badge">
                    {hud.statPoints} Stat Pts Available
                  </span>
                </div>
                <div className="outlands-profession-row">
                  <span>Service Profession:</span>
                  {(['Doctor', 'Chef', 'Engineer'] as ProfessionId[]).map((prof) => (
                    <button
                      key={prof}
                      type="button"
                      className={`outlands-chip ${hud.profession === prof ? 'is-active' : ''}`}
                      onClick={() => {
                        if (!serverRef.current) return;
                        serverRef.current.state.player.profession = prof;
                        syncHud();
                      }}
                    >
                      {prof}
                    </button>
                  ))}
                </div>
                <div className="outlands-stat-list">
                  {(
                    [
                      ['strength', 'Strength', 'Melee dmg, knockback & heavy handling'],
                      ['agility', 'Agility', 'Movement & sprint speed scaling'],
                      ['endurance', 'Endurance', 'Max Hull HP & Stamina regeneration'],
                      ['criticalHit', 'Critical Hit', 'Boosts headshot & critical hit probability'],
                      ['accuracy', 'Accuracy', 'Tightens firearm spread & reticle focus speed'],
                      ['reloading', 'Reloading', 'Reduces weapon reload duration'],
                    ] as const
                  ).map(([key, label, desc]) => (
                    <div key={key} className="outlands-stat-row">
                      <div>
                        <strong>
                          {label}: {hud.attributes[key]}
                        </strong>
                        <small>{desc}</small>
                      </div>
                      <button
                        type="button"
                        disabled={hud.statPoints <= 0 || hud.attributes[key] >= 100}
                        onClick={() => {
                          if (!serverRef.current) return;
                          if (allocateAttributePoint(serverRef.current.state.player, key)) {
                            syncHud();
                          }
                        }}
                      >
                        +1
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="outlands-subpanel">
                <div className="outlands-subpanel-head">
                  <h3>Weapon Proficiencies (0 → 120)</h3>
                  <span className="outlands-badge">
                    {hud.proficiencyPoints} Skill Pts Available
                  </span>
                </div>
                <div className="outlands-stat-list">
                  {(Object.keys(WEAPON_PROFICIENCY_LABELS) as WeaponProficiencyId[]).map(
                    (profId) => {
                      const info = WEAPON_PROFICIENCY_LABELS[profId];
                      const pts = hud.proficiencies[profId];
                      return (
                        <div key={profId} className="outlands-stat-row">
                          <div>
                            <strong>
                              {info.name} — {pts}/120
                            </strong>
                            <small>
                              {masteryRankLabel(pts)} · {info.archetype}
                            </small>
                          </div>
                          <button
                            type="button"
                            disabled={hud.proficiencyPoints <= 0 || pts >= 120}
                            onClick={() => {
                              if (!serverRef.current) return;
                              if (
                                allocateProficiencyPoint(
                                  serverRef.current.state.player,
                                  profId,
                                  5,
                                )
                              ) {
                                syncHud();
                              }
                            }}
                          >
                            +5
                          </button>
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
            </div>
          )}

          {drawer === 'outpost' && (
            <div className="outlands-drawer-body outlands-cols-2">
              <div className="outlands-subpanel">
                <div className="outlands-subpanel-head">
                  <h3>Safe Outposts &amp; Specialist Services</h3>
                  <span className="outlands-badge">
                    Bank: ${hud.bankCash} · Carried: ${hud.carriedCash}
                  </span>
                </div>
                <div className="outlands-outpost-cards">
                  {OUTPOSTS.map((op) => (
                    <div
                      key={op.id}
                      className={`outlands-outpost-card ${hud.activeOutpostId === op.id ? 'is-active' : ''}`}
                    >
                      <strong>{op.name}</strong>
                      <span>{op.subtitle}</span>
                    </div>
                  ))}
                </div>

                <div className="outlands-service-buttons">
                  <button
                    type="button"
                    onClick={() => {
                      if (!serverRef.current) return;
                      if (outpostHealService(serverRef.current.state.player)) {
                        audioRef.current?.playPickup();
                        setBanner('Outpost Doctor restored 100% HP & purged bio-infection');
                        syncHud();
                      }
                    }}
                  >
                    Doctor: Full Heal &amp; Antiviral Purge ($
                    {hud.profession === 'Doctor' ? 25 : 45})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!serverRef.current) return;
                      if (outpostRepairService(serverRef.current.state.player)) {
                        audioRef.current?.playPickup();
                        setBanner('Outpost Engineer restored Kevlar Armor to 100% durability');
                        syncHud();
                      }
                    }}
                  >
                    Engineer: Full Armor Overhaul ($
                    {hud.profession === 'Engineer' ? 20 : 40})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!serverRef.current) return;
                      if (outpostChefService(serverRef.current.state.player)) {
                        audioRef.current?.playPickup();
                        setBanner('Outpost Chef served hot rations (100% Hunger & Stamina)');
                        syncHud();
                      }
                    }}
                  >
                    Chef: Hot Mess Hall Meal (${hud.profession === 'Chef' ? 15 : 30})
                  </button>
                </div>

                <h4 className="outlands-subhead">Outpost Bounties &amp; Quests</h4>
                <div className="outlands-quest-list">
                  {hud.quests.map((q) => (
                    <div key={q.id} className="outlands-quest-row">
                      <div>
                        <strong>
                          {q.title} ({q.progressKills}/{q.targetKills})
                        </strong>
                        <small>
                          {q.description} · Reward: ${q.rewardCash}, {q.rewardXp} XP,{' '}
                          {q.rewardScrap} Scrap
                        </small>
                      </div>
                      <button
                        type="button"
                        disabled={!q.completed || q.claimed}
                        onClick={() => {
                          if (!serverRef.current) return;
                          if (claimQuestReward(serverRef.current.state, q.id)) {
                            audioRef.current?.playPickup();
                            setBanner(`Claimed bounty: ${q.title}`);
                            syncHud();
                          }
                        }}
                      >
                        {q.claimed ? 'Claimed' : q.completed ? 'Claim Reward' : 'Active'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="outlands-subpanel">
                <div className="outlands-subpanel-head">
                  <h3>Global Survivor Marketplace ($USD)</h3>
                  <span className="outlands-badge">Delivers to Grid Pack</span>
                </div>
                <label className="outlands-menu-search">
                  <span>Find supplies</span>
                  <input
                    type="search"
                    value={marketSearch}
                    onChange={(event) => setMarketSearch(event.target.value)}
                    placeholder="Search items"
                    aria-label="Search marketplace items"
                  />
                </label>
                <div className="outlands-market-list">
                  {Object.values(ITEM_TEMPLATES)
                    .filter((tpl) => `${tpl.name} ${tpl.description}`.toLowerCase().includes(marketSearch.trim().toLowerCase()))
                    .map((tpl) => (
                    <div key={tpl.templateId} className="outlands-market-row">
                      <div>
                        <strong>
                          {tpl.name} ({tpl.width}×{tpl.height})
                        </strong>
                        <small>{tpl.description}</small>
                      </div>
                      <button
                        type="button"
                        disabled={hud.bankCash + hud.carriedCash < tpl.valueUsd}
                        onClick={() => {
                          if (!serverRef.current) return;
                          if (buyMarketplaceItem(serverRef.current.state, tpl.templateId)) {
                            audioRef.current?.playPickup();
                            setBanner(`Purchased ${tpl.name}`);
                            syncHud();
                          } else {
                            setBanner('Grid Inventory full or insufficient $USD');
                          }
                        }}
                      >
                        Buy ${tpl.valueUsd}
                      </button>
                    </div>
                  ))}
                  {Object.values(ITEM_TEMPLATES).every((tpl) =>
                    !`${tpl.name} ${tpl.description}`.toLowerCase().includes(marketSearch.trim().toLowerCase()),
                  ) && <p className="outlands-empty-state">No matching supplies.</p>}
                </div>
              </div>
            </div>
          )}
          {drawer === 'controls' && (
            <div className="outlands-drawer-body">
              <div className="outlands-subpanel">
                <div className="outlands-subpanel-head">
                  <h3>Key Bindings</h3>
                  <span className="outlands-badge">
                    {rebinding ? `Press a key for ${KEYBIND_LABELS[rebinding]}…` : 'Click a binding then press a key'}
                  </span>
                </div>
                <div className="outlands-keybind-grid">
                  {(Object.keys(KEYBIND_LABELS) as KeybindAction[]).map((action) => (
                    <div key={action} className="outlands-keybind-row">
                      <span>{KEYBIND_LABELS[action]}</span>
                      <button
                        type="button"
                        onClick={() => setRebinding(action)}
                        className={rebinding === action ? 'is-rebinding' : ''}
                      >
                        {keybinds[action]}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="outlands-keybind-actions">
                  <button
                    type="button"
                    onClick={() => {
                      keybindsRef.current = { ...DEFAULT_KEYBINDS };
                      setKeybinds({ ...DEFAULT_KEYBINDS });
                      saveKeybinds(DEFAULT_KEYBINDS);
                    }}
                  >
                    Reset to Defaults
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>
      )}

      {pendingSellItem && (
        <div className="outlands-modal-backdrop outlands-sell-confirm-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="outlands-sell-confirm-title">
          <div className="outlands-modal outlands-sell-confirm">
            <div className="outlands-modal-eyebrow">Confirm sale</div>
            <h2 id="outlands-sell-confirm-title">Sell {pendingSellItem.name}?</h2>
            <p>This item will be removed from your pack for ${Math.max(10, Math.round(pendingSellItem.valueUsd * 0.65))}. This can’t be undone.</p>
            <div className="outlands-modal-actions">
              <button type="button" className="outlands-btn" onClick={() => setPendingSellItem(null)}>Keep item</button>
              <button type="button" className="outlands-btn outlands-btn-primary" onClick={confirmSellItem}>Confirm sale</button>
            </div>
          </div>
        </div>
      )}

      <HUD
        health={hud.health}
        maxHealth={hud.maxHealth}
        stamina={hud.stamina}
        maxStamina={hud.maxStamina}
        hunger={hud.hunger}
        maxHunger={hud.maxHunger}
        armorName={hud.armorName}
        armorAbsorption={hud.armorAbsorption}
        armorDurability={hud.armorDurability}
        armorMaxDurability={hud.armorMaxDurability}
        infected={hud.infected}
        infectionSeverity={hud.infectionSeverity}
        flashlightOn={hud.flashlightOn}
        focusFactor={hud.focusFactor}
        reloading={hud.reloading}
        activeWeapon={hud.weapon}
        weaponName={hud.weaponName}
        weapons={hud.weapons}
        onSwitchWeapon={handleSwitchWeapon}
        onQuickUse={quickUseCategory}
        loadout={hud.loadout}
      />

      {phase === 'briefing' && (
        <div className="outlands-modal-backdrop" role="dialog" aria-modal="true">
          <div className="outlands-modal outlands-briefing">
            <div className="outlands-modal-eyebrow">
              <Skull size={14} />
              <span>Sector 09 · Isometric Survival Action RPG</span>
            </div>
            <h1>Outlands</h1>
            <p className="outlands-briefing-stats">
              Banked Outpost Stash: <strong>{hud.stash} Scrap</strong> ·{' '}
              <strong>${hud.bankCash}</strong> · Lv.{hud.level} ({hud.profession})
            </p>
            {sharedSectorUrl && (
              <p className="outlands-briefing-stats">
                Shared sector{' '}
                {sectorStatus ? (
                  <>
                    <strong>
                      {sectorStatus.players}/{sectorStatus.capacity}
                    </strong>{' '}
                    survivors
                    {sectorStatus.full ? (
                      <>
                        {' '}
                        · <strong>Sector full</strong> — deploy locked
                      </>
                    ) : (
                      <> · one public instance</>
                    )}
                  </>
                ) : (
                  <>· checking occupancy…</>
                )}
              </p>
            )}
            {!sharedSectorUrl && import.meta.env.PROD && (
              <p className="outlands-briefing-stats">
                <strong>Shared world offline:</strong> the persistent Outlands server is not configured.
              </p>
            )}
            {sharedSectorUrl && !userId && (
              <p className="outlands-briefing-stats">
                Local play is open to everyone. Sign in with ReimonDev to join the shared world.
              </p>
            )}
            <p>
              Step out of <strong>Nastya&apos;s Holdout</strong> into a pitch-black
              isometric quarantine zone inspired by <em>Dead Frontier</em> and{' '}
              <em>Dead Nation</em>. Stand still to shrink your reticle bloom for lethal
              headshots and dismemberment, scavenge searchable containers with{' '}
              <kbd>E</kbd>, manage Hunger, Armor durability, and Bio-Infection, and
              return to a Safe Outpost to bank your Scrap, $USD, and XP before you die.
            </p>
            <div className="outlands-modal-actions outlands-briefing-actions">
              <button
                type="button"
                className="outlands-btn outlands-btn-primary outlands-deploy"
                onClick={handleSoloDeploy}
              >
                <Sparkles size={15} /> Play Solo (Local Simulation)
              </button>
            </div>
            <div className="outlands-safezone-grid">
              {SAFEZONE_DIRECTORY.map((entry) => (
                <div key={entry.id} className="outlands-safezone-card">
                  <div className="outlands-safezone-head">
                    <strong>{entry.name}</strong>
                    <span className="outlands-safezone-code">{entry.sectorCode}</span>
                  </div>
                  <div className="outlands-safezone-tier">{entry.tierLabel}</div>
                  <div className="outlands-safezone-players">
                    <Users size={12} />{' '}
                    <span>
                      {entry.id === 'nastya'
                        ? `${sectorStatus?.players ?? 0}/${sectorStatus?.capacity ?? 8}`
                        : '—'}{' '}
                      Survivors Online
                    </span>
                  </div>
                  <p className="outlands-safezone-desc">{entry.description}</p>
                  <button
                    type="button"
                    className="outlands-btn outlands-btn-primary outlands-deploy"
                    onClick={() => handleSelectSafezone(entry)}
                    disabled={joiningSector || (import.meta.env.PROD && !sharedSectorUrl) || (Boolean(sharedSectorUrl) && sectorStatus?.full === true)}
                  >
                    {joiningSector
                      ? 'Joining…'
                      : import.meta.env.PROD && !sharedSectorUrl
                        ? 'World Offline'
                        : sharedSectorUrl && !userId
                          ? 'Sign in to Deploy Online'
                          : 'Deploy Here'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {phase === 'dead' && (
        <div className="outlands-modal-backdrop" role="dialog" aria-modal="true">
          <div className="outlands-modal outlands-modal-dead outlands-death">
            <div className="outlands-modal-eyebrow">
              <Skull size={14} />
              <span>Signal Lost · Hardcore Full-Loot Penalty</span>
            </div>
            <h2>Run terminated</h2>
            <p>
              All unbanked field scrap, carried $USD, unbanked XP, and grid inventory
              items were dropped on your corpse container. Your banked Outpost Stash (
              <strong>{hud.stash} scrap</strong>, <strong>${hud.bankCash}</strong>) and
              Character Level (<strong>Lv.{hud.level}</strong>) remain safe.
              {hud.corpseDropped
                ? ' Respawn at the nearest Outpost and fight back to your corpse beacon to reclaim your gear.'
                : ''}
            </p>
            <div className="outlands-modal-actions">
              <button
                type="button"
                className="outlands-btn outlands-btn-primary outlands-deploy"
                onClick={handleRespawn}
              >
                Respawn at Nearest Outpost
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
