import { createPlayer, createWorld, OUTPOSTS } from './world';
import { restartWorld } from './simulation';
import type { InputState, OutlandsRoomState, OutpostId, RoomPlayer, WorldState } from './types';

/** Shared-sector cap tuned for sim + snapshot cost (override via OUTLANDS_ROOM_CAPACITY on server). */
export const DEFAULT_ROOM_CAPACITY = 8;

export function createRoomState(seed: number): OutlandsRoomState {
  return {
    ...createWorld(seed),
    players: {},
    lostScrapByPlayer: {},
  };
}

export function joinRoom(
  room: OutlandsRoomState,
  playerId: string,
  nickname: string,
  capacity = DEFAULT_ROOM_CAPACITY,
  outpostId: OutpostId = 'nastya',
): RoomPlayer | null {
  const existing = room.players[playerId];
  if (existing) return existing;
  if (Object.keys(room.players).length >= capacity) return null;

  const player = createPlayer(0);
  const outpost = OUTPOSTS.find((candidate) => candidate.id === outpostId) ?? OUTPOSTS[0];
  const slot = Object.keys(room.players).length;
  const angle = slot * 2.399963229728653;
  const radius = 0.75 + (slot % 4) * 0.42;
  player.x = outpost.x + Math.cos(angle) * radius;
  player.y = outpost.y + Math.sin(angle) * radius;
  player.activeOutpostId = outpost.id;
  player.inSafeZone = true;
  player.threatTier = outpost.tier;
  const safeNickname = [...nickname]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim()
    .slice(0, 24) || 'Operative';
  const result: RoomPlayer = { playerId, nickname: safeNickname, state: player };
  room.players[playerId] = result;
  return result;
}

export function leaveRoom(room: OutlandsRoomState, playerId: string): void {
  delete room.players[playerId];
  delete room.lostScrapByPlayer[playerId];
}

export function redeployPlayer(room: OutlandsRoomState, playerId: string): boolean {
  const slot = room.players[playerId];
  if (!slot || slot.state.alive) return false;
  const next = restartWorld({ ...room, player: slot.state, phase: 'dead' }, room.map.seed);
  slot.state = next.player;
  room.lostScrapByPlayer[playerId] = 0;
  return true;
}

/** Per-connection view: self is `player`; other members are render-only peers. */
export function snapshotForPlayer(
  room: OutlandsRoomState,
  playerId: string,
  activePlayerIds?: ReadonlySet<string>,
): WorldState | null {
  const slot = room.players[playerId];
  if (!slot) return null;
  const remotePlayers = Object.values(room.players)
    .filter((other) => other.playerId !== playerId && (!activePlayerIds || activePlayerIds.has(other.playerId)))
    .map((other) => ({ id: other.playerId, nickname: other.nickname, player: other.state }));
  const { players: _players, lostScrapByPlayer: _lostScrap, ...sharedWorld } = room;
  return {
    ...sharedWorld,
    phase: slot.state.alive ? 'playing' : 'dead',
    player: slot.state,
    remotePlayers,
    lostScrap: room.lostScrapByPlayer[playerId] ?? 0,
  };
}

/** Reusable neutral intent for room simulations/tests. */
export function neutralInput(aim = { x: 1, y: 0 }): InputState {
  return {
    move: { x: 0, y: 0 },
    aim,
    firing: false,
    reload: false,
    sprint: false,
  };
}
