import { describe, expect, it } from 'vitest';
import { createZombie } from './world';
import { joinRoom, createRoomState, redeployPlayer, snapshotForPlayer } from './room';
import { stepRoomWorld } from './simulation';
import { neutralInput } from './room';

const fixedRng = () => 0.5;

describe('authoritative Outlands rooms', () => {
  it('keeps a shared sector and exposes other players in each snapshot', () => {
    const room = createRoomState(404);
    const one = joinRoom(room, 'player-1', 'One')!;
    const two = joinRoom(room, 'player-2', 'Two')!;
    expect(one).toBeTruthy();
    expect(two).toBeTruthy();
    expect(one.state.x).not.toBe(two.state.x);

    const snapshot = snapshotForPlayer(room, 'player-1');
    expect(snapshot?.remotePlayers).toHaveLength(1);
    expect(snapshot?.remotePlayers?.[0]).toMatchObject({ id: 'player-2', nickname: 'Two' });
    expect(snapshot?.player).toBe(one.state);
  });

  it('applies each player input while advancing shared zombies once', () => {
    const room = createRoomState(405);
    const one = joinRoom(room, 'player-1', 'One')!;
    const two = joinRoom(room, 'player-2', 'Two')!;
    room.map.obstacles = [];
    room.spawnTimer = 999;
    const beforeOne = one.state.x;
    const beforeTwo = two.state.x;

    for (let i = 0; i < 10; i += 1) {
      stepRoomWorld(room, {
        'player-1': { ...neutralInput(), move: { x: 1, y: 0 } },
        'player-2': { ...neutralInput(), move: { x: 0, y: 1 } },
      }, 0.05, fixedRng);
    }

    expect(one.state.x).toBeGreaterThan(beforeOne);
    expect(two.state.y).toBeGreaterThan(beforeTwo);
    expect(room.time).toBeCloseTo(0.5, 8);
  });

  it('lets one player kill a shared zombie and awards the kill to the shooter', () => {
    const room = createRoomState(406);
    const one = joinRoom(room, 'player-1', 'One')!;
    const two = joinRoom(room, 'player-2', 'Two')!;
    room.map.obstacles = [];
    room.spawnTimer = 999;
    one.state.x = 13;
    one.state.y = 21;
    one.state.inSafeZone = false;
    one.state.threatTier = 1;
    two.state.x = 34;
    two.state.y = 34;
    const target = createZombie('z-shared', 'walker', { x: 17, y: 21 }, 0);
    target.health = 1;
    room.zombies = [target];

    stepRoomWorld(room, {
      'player-1': { ...neutralInput(), aim: { x: 1, y: 0 }, firing: true },
      'player-2': neutralInput(),
    }, 0.05, fixedRng);

    expect(room.zombies).toHaveLength(0);
    expect(one.state.kills).toBe(1);
    expect(two.state.kills).toBe(0);
    expect(room.events.some((event) => event.type === 'zombie_killed')).toBe(true);
  });

  it('keeps private damage events out of other players’ snapshots', () => {
    const room = createRoomState(407);
    joinRoom(room, 'player-1', 'One');
    joinRoom(room, 'player-2', 'Two');
    room.events.push({ type: 'player_hit', x: 1, y: 2, damage: 5 });
    room.events.push({ type: 'shot', x: 1, y: 2, angle: 0, traces: [], weapon: 'rifle' });

    expect(snapshotForPlayer(room, 'player-1')?.events).toHaveLength(2);
    expect(snapshotForPlayer(room, 'player-2')?.events.map((event) => event.type)).toEqual(['player_hit', 'shot']);
  });

  it('redeploys a dead player without changing their server-owned stash', () => {
    const room = createRoomState(408);
    const slot = joinRoom(room, 'player-1', 'One')!;
    slot.state.stash = 350;
    slot.state.alive = false;
    slot.state.carriedScrap = 0;

    expect(redeployPlayer(room, 'player-1')).toBe(true);
    expect(slot.state.alive).toBe(true);
    expect(slot.state.stash).toBe(350);
    expect(snapshotForPlayer(room, 'player-1')?.phase).toBe('playing');
  });

  it('sanitizes nicknames and rejects capacity overflow', () => {
    const room = createRoomState(409);
    expect(joinRoom(room, 'one', '  <Operative>\n', 1)?.nickname).toBe('<Operative>');
    expect(joinRoom(room, 'two', 'Two', 1)).toBeNull();
  });
});
