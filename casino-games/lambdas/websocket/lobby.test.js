import { beforeEach, describe, expect, it, vi } from 'vitest';
import lobby from './lobby.js';
import sos from './sos.js';
import * as engineModule from '../../frontend/src/games/squareofshadows/engine/index';

/**
 * Covers the pure state machines: the challenge lifecycle, the roster
 * projection's busy filter, and the reconnection grace period in `sos.js`.
 *
 * No AWS calls happen here — the DynamoDB transport is exercised in the deployed
 * environment. That is why every rule worth protecting lives in a pure function
 * (`isExpired`, `expireChallenge`, `publicRoster`, `enforceGraceDeadline`)
 * rather than inline in the handler.
 *
 * The engine is injected because plain Node cannot require() a .ts file; in the
 * deployed Lambda CDK's esbuild resolves and inlines it instead.
 */
sos.__setEngine(engineModule);

const T0 = new Date('2026-01-01T00:00:00Z');

const player = (id, nickname, lobbyStatus) => ({
  playerId: id,
  nickname,
  lobbyStatus,
});

const playingRoom = ({ gracePlayerId = null, graceUntil = null } = {}) => {
  const room = sos.freshRoom('ABC234');
  let state = sos.buildMatch('ABC234', 'p1', 'p2');
  for (const playerId of state.pickOrder) {
    const faction = Object.values(state.factions).includes('INQUISITORS')
      ? 'PENITENT_COURT'
      : 'INQUISITORS';
    state = engineModule.applyCommand(state, playerId, { type: 'CHOOSE_FACTION', faction }).state;
  }
  room.state = engineModule.serializeGameState(state);
  room.revision = room.state.revision;
  room.phase = 'playing';
  room.turnDeadline = Date.now() + sos.TURN_MS;
  room.seats = [
    { playerId: 'p1', connectionId: 'c1', nickname: 'Ada', slot: 0, status: 'seated', graceUntil: null },
    { playerId: 'p2', connectionId: 'c2', nickname: 'Bo', slot: 1, status: 'seated', graceUntil: null },
  ];
  if (gracePlayerId) {
    const seat = room.seats.find((s) => s.playerId === gracePlayerId);
    seat.graceUntil = graceUntil;
    if (gracePlayerId === 'p2') seat.connectionId = null;
    room.turnDeadline = null;
  }
  return room;
};

describe('duel lobby', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  describe('freshChallenge', () => {
    it('starts pending, addressed both ways, expiring in 15s', () => {
      const c = lobby.freshChallenge(
        'ABC234',
        { playerId: 'p1', nickname: 'Ada' },
        { playerId: 'p2', nickname: 'Bo' },
        Date.now() + lobby.CHALLENGE_MS,
      );

      expect(lobby.CHALLENGE_MS).toBe(15_000);
      expect(c.kind).toBe('challenge');
      expect(c.status).toBe('pending');
      expect(c.challengeId).toBe('ABC234');
      expect(c.fromPlayerId).toBe('p1');
      expect(c.toPlayerId).toBe('p2');
      expect(c.expiresAt).toBe(T0.getTime() + 15_000);
      expect(c.revision).toBe(0);
      expect(c.ttl).toBeGreaterThan(T0.getTime() / 1000);
    });
  });

  describe('isExpired', () => {
    it('is false right up to the deadline and true after it', () => {
      const c = lobby.freshChallenge(
        'ABC234',
        { playerId: 'p1', nickname: 'Ada' },
        { playerId: 'p2', nickname: 'Bo' },
        T0.getTime() + lobby.CHALLENGE_MS,
      );

      expect(lobby.isExpired(c, T0.getTime())).toBe(false);
      expect(lobby.isExpired(c, T0.getTime() + 14_999)).toBe(false);
      expect(lobby.isExpired(c, T0.getTime() + 15_000)).toBe(true);
      expect(lobby.isExpired(c, T0.getTime() + 60_000)).toBe(true);
    });

    it('never re-expires a challenge that was already answered', () => {
      const c = lobby.freshChallenge(
        'ABC234',
        { playerId: 'p1', nickname: 'Ada' },
        { playerId: 'p2', nickname: 'Bo' },
        T0.getTime() + lobby.CHALLENGE_MS,
      );
      c.status = 'accepted';
      // The whole point: an accept racing past the deadline must not be undone
      // by a later sweep.
      expect(lobby.isExpired(c, T0.getTime() + 999_999)).toBe(false);
    });
  });

  describe('expireChallenge', () => {
    it('closes it and leaves the addressing intact for the toast', () => {
      const c = lobby.freshChallenge(
        'ABC234',
        { playerId: 'p1', nickname: 'Ada' },
        { playerId: 'p2', nickname: 'Bo' },
        T0.getTime() + lobby.CHALLENGE_MS,
      );
      lobby.expireChallenge(c);
      expect(c.status).toBe('expired');
      expect(c.fromPlayerId).toBe('p1');
    });
  });

  describe('publicChallenge', () => {
    it('carries nicknames and drops the storage-only fields', () => {
      const c = lobby.freshChallenge(
        'ABC234',
        { playerId: 'p1', nickname: 'Ada' },
        { playerId: 'p2', nickname: 'Bo' },
        T0.getTime() + lobby.CHALLENGE_MS,
      );
      const wire = lobby.publicChallenge(c);

      expect(wire.fromNickname).toBe('Ada');
      expect(wire.toNickname).toBe('Bo');
      expect(wire).not.toHaveProperty('revision');
      expect(wire).not.toHaveProperty('ttl');
      expect(wire).not.toHaveProperty('kind');
    });

    it('falls back to a generic name rather than rendering undefined', () => {
      const c = lobby.freshChallenge(
        'ABC234',
        { playerId: 'p1' },
        { playerId: 'p2' },
        T0.getTime(),
      );
      expect(lobby.publicChallenge(c).fromNickname).toBe('Player');
    });
  });

  describe('publicRoster', () => {
    const roster = lobby.publicRoster([
      player('p1', 'Ada', 'IN_LOBBY'),
      player('p2', 'Bo', 'PENDING_CHALLENGE'),
      player('p3', 'Cy', 'IN_GAME'),
      player('p4', 'Dee', 'DISCONNECTED'),
      player('p5', 'Eve', undefined),
      { nickname: 'Nameless', lobbyStatus: 'IN_LOBBY' },
    ]);

    it('lists every player who registered, including the disconnected', () => {
      // p5 never registered, so it is out. p4 disconnected but is kept: the
      // lobby shows departed players greyed out rather than silently shrinking
      // the roster, which is what made "never here" and "here then left"
      // indistinguishable.
      expect(roster.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    });

    it('marks busy players unchallengeable and free players challengeable', () => {
      const byId = Object.fromEntries(roster.map((p) => [p.id, p]));
      expect(byId.p1.challengeable).toBe(true);
      expect(byId.p2.challengeable).toBe(false);
      expect(byId.p3.challengeable).toBe(false);
      // A dropped socket cannot answer a challenge, so it is not challengeable.
      expect(byId.p4.challengeable).toBe(false);
    });

    it('splits the roster into the two lobby columns', () => {
      const byId = Object.fromEntries(roster.map((p) => [p.id, p]));
      expect(byId.p1.inGame).toBe(false);
      expect(byId.p3.inGame).toBe(true);
      expect(byId.p1.connected).toBe(true);
      expect(byId.p4.connected).toBe(false);
    });

    it('exposes the fields the client contract promises', () => {
      expect(roster[0]).toEqual({
        id: 'p1',
        username: 'Ada',
        avatarImage: null,
        status: 'IN_LOBBY',
        challengeable: true,
        inGame: false,
        connected: true,
      });
    });

    it('publishes the avatar so the lobby can show faces, not just names', () => {
      // The roster is the one screen where players pick each other by face, so
      // the avatar has to travel with the entry. `connect` makes it
      // server-authoritative, so this is not client-supplied data.
      const [withAvatar] = lobby.publicRoster([
        { playerId: 'p1', nickname: 'Ada', lobbyStatus: 'IN_LOBBY', avatarImage: 'data:image/jpeg;base64,AAA' },
      ]);
      expect(withAvatar.avatarImage).toBe('data:image/jpeg;base64,AAA');
    });

    it('sends null rather than leaving the field out when there is no avatar', () => {
      // The client types this as `string | null`, not optional, so an absent key
      // would be `undefined` and render a broken <img src>.
      expect(lobby.publicRoster([{ playerId: 'p1', lobbyStatus: 'IN_LOBBY' }])[0].avatarImage).toBeNull();
      expect(lobby.publicRoster([{ playerId: 'p1', lobbyStatus: 'IN_LOBBY', avatarImage: '' }])[0].avatarImage).toBeNull();
    });

    it('falls back to a generic username', () => {
      expect(lobby.publicRoster([{ playerId: 'p9', lobbyStatus: 'IN_LOBBY' }])[0].username).toBe('Player');
    });
  });

  describe('publicOpenRooms', () => {
    const players = [
      { playerId: 'p1', nickname: 'Ada', connectionId: 'c1' },
      { playerId: 'p2', nickname: 'Bo', connectionId: 'c2' },
    ];
    const waitingRoom = (overrides = {}) => ({
      roomId: 'ABC234',
      phase: 'lobby',
      createdAt: 100,
      seats: [
        { playerId: 'p1', connectionId: 'c1', nickname: 'Ada', status: 'seated', slot: 0 },
      ],
      ...overrides,
    });

    it('lists a private room whose host is still connected', () => {
      expect(lobby.publicOpenRooms(players, [waitingRoom()])).toEqual([
        { roomId: 'ABC234', hostId: 'p1', hostNickname: 'Ada', createdAt: 100 },
      ]);
    });

    it('hides rooms that already started, are full, or were abandoned', () => {
      expect(lobby.publicOpenRooms(players, [waitingRoom({ phase: 'playing' })])).toEqual([]);
      expect(lobby.publicOpenRooms(players, [waitingRoom({
        seats: [
          { playerId: 'p1', connectionId: 'c1', nickname: 'Ada', status: 'seated', slot: 0 },
          { playerId: 'p2', connectionId: 'c2', nickname: 'Bo', status: 'seated', slot: 1 },
        ],
      })])).toEqual([]);
      expect(lobby.publicOpenRooms(players, [waitingRoom({
        seats: [{ playerId: 'p1', connectionId: 'c1', nickname: 'Ada', status: 'left', slot: 0 }],
      })])).toEqual([]);
    });

    it('hides a room whose host socket is gone, even if the row is still seated', () => {
      // The room item survives for its TTL; a closed tab must not leave a
      // joinable-looking room that sends a friend into an empty lobby.
      expect(lobby.publicOpenRooms([], [waitingRoom()])).toEqual([]);
    });

    it('orders rooms by creation so the list does not jump around', () => {
      const rooms = [
        waitingRoom({ roomId: 'ZZZ234', createdAt: 300 }),
        waitingRoom({ roomId: 'ABC234', createdAt: 100 }),
      ];
      expect(lobby.publicOpenRooms(players, rooms).map((r) => r.roomId)).toEqual(['ABC234', 'ZZZ234']);
    });
  });

  describe('publicResume', () => {
    const roomWithGrace = (graceUntil) => {
      const room = playingRoom({ gracePlayerId: 'p2', graceUntil });
      return room;
    };

    it('projects only a live seat owned by the caller', () => {
      const until = Date.now() + 60_000;
      const room = roomWithGrace(until);
      expect(lobby.publicResume(room, 'p2')).toEqual({
        roomId: 'ABC234',
        phase: 'playing',
        graceUntil: until,
      });
      expect(lobby.publicResume(room, 'p1').graceUntil).toBeNull();
    });

    it('stops offering a seat once the grace window has closed', () => {
      // The row survives until the opponent next speaks, but the timer must be
      // authoritative: a closed window is not a rejoin offer.
      expect(lobby.publicResume(roomWithGrace(Date.now() - 1), 'p2')).toBeNull();
    });

    it('refuses a room that is over, abandoned, or not a room at all', () => {
      expect(lobby.publicResume(null, 'p2')).toBeNull();
      expect(lobby.publicResume({ ...playingRoom(), phase: 'ended' }, 'p2')).toBeNull();
      expect(lobby.publicResume({ ...playingRoom(), kind: 'challenge' }, 'p2')).toBeNull();
      const left = playingRoom();
      left.seats = left.seats.map((seat) =>
        seat.playerId === 'p2' ? { ...seat, status: 'left' } : seat,
      );
      expect(lobby.publicResume(left, 'p2')).toBeNull();
      expect(lobby.publicResume(playingRoom(), 'p9')).toBeNull();
    });

    it('allows a waiting room to be resumed, but not a challenge item', () => {
      const waiting = sos.freshRoom('WAIT24');
      waiting.seats = [
        { playerId: 'p1', connectionId: 'c1', nickname: 'Ada', slot: 0, status: 'seated', graceUntil: null },
      ];
      expect(lobby.publicResume(waiting, 'p1')).toEqual({
        roomId: 'WAIT24',
        phase: 'lobby',
        graceUntil: null,
      });
    });
  });
});

describe('sos reconnection grace', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  it('is a 60 second window', () => {
    expect(sos.GRACE_MS).toBe(60_000);
  });

  describe('enforceGraceDeadline', () => {
    it('leaves a live match alone', () => {
      const room = playingRoom();
      const before = room.revision;
      expect(sos.enforceGraceDeadline(room)).toBe(false);
      expect(room.phase).toBe('playing');
      expect(room.revision).toBe(before);
    });

    it('does nothing while the window is still open', () => {
      const room = playingRoom({ gracePlayerId: 'p2', graceUntil: Date.now() + sos.GRACE_MS });
      expect(sos.enforceGraceDeadline(room)).toBe(false);
      expect(room.phase).toBe('playing');
      expect(room.winnerId).toBeNull();
    });

    it('forfeits to the connected player once the window closes', () => {
      const room = playingRoom({ gracePlayerId: 'p2', graceUntil: Date.now() + sos.GRACE_MS });
      vi.advanceTimersByTime(sos.GRACE_MS + 1);

      expect(sos.enforceGraceDeadline(room)).toBe(true);
      expect(room.phase).toBe('ended');
      expect(room.winnerId).toBe('p1');
      expect(room.turnDeadline).toBeNull();
    });

    it('records the winner but not a loss for whoever dropped', () => {
      const room = playingRoom({ gracePlayerId: 'p2', graceUntil: Date.now() + sos.GRACE_MS });
      vi.advanceTimersByTime(sos.GRACE_MS + 1);
      sos.enforceGraceDeadline(room);

      // A browser crash must not cost standing (PROJECT_DESIGN.md).
      expect(room.forfeit).toEqual({
        winnerId: 'p1',
        loserId: 'p2',
        recordWin: true,
        recordLoss: false,
      });
    });

    it('clears every grace stamp so the room cannot forfeit twice', () => {
      const room = playingRoom({ gracePlayerId: 'p2', graceUntil: Date.now() + sos.GRACE_MS });
      vi.advanceTimersByTime(sos.GRACE_MS + 1);
      expect(sos.enforceGraceDeadline(room)).toBe(true);
      expect(sos.enforceGraceDeadline(room)).toBe(false);
      expect(room.winnerId).toBe('p1');
    });

    it('does nothing outside a live match', () => {
      const room = sos.freshRoom('ABC234');
      room.seats = [{ playerId: 'p1', graceUntil: Date.now() - 1 }];
      room.phase = 'lobby';
      expect(sos.enforceGraceDeadline(room)).toBe(false);
    });
  });

  describe('graceSecondsLeft', () => {
    it('counts down in whole seconds and floors at zero', () => {
      const seat = { graceUntil: Date.now() + 30_000 };
      expect(sos.graceSecondsLeft(seat)).toBe(30);
      expect(sos.graceSecondsLeft({ graceUntil: Date.now() + 1_001 })).toBe(2);
      expect(sos.graceSecondsLeft({ graceUntil: Date.now() - 5_000 })).toBe(0);
      expect(sos.graceSecondsLeft({})).toBe(0);
      expect(sos.graceSecondsLeft(null)).toBe(0);
    });
  });

  /**
   * Guards the create-vs-update confusion that shipped twice in this file: a
   * room is written either to *create* the row or to *update* a known revision,
   * and `null` is the create signal. A challenge occupies the row before it is
   * promoted, so its write must never ask for the row to be absent.
   */
  describe('accepted-challenge promotion', () => {
    const seats = () => ({
      roomId: 'ABC234',
      host: { playerId: 'p1', nickname: 'Ada', connectionId: 'c1' },
      guest: { playerId: 'p2', nickname: 'Bo', connectionId: 'c2' },
    });

    it('refuses to run without a numeric revision', async () => {
      const { room, error } = await sos.startAcceptedChallenge({ ...seats(), expectedRevision: null });
      expect(room).toBeNull();
      expect(error).toMatch(/retry/i);
    });

    it('refuses an undefined revision rather than defaulting it to 0', async () => {
      const { room, error } = await sos.startAcceptedChallenge(seats());
      expect(room).toBeNull();
      expect(error).toMatch(/retry/i);
    });

    it('builds the same conditional-update shape as any other revision', () => {
      // A fresh challenge sits at revision 0, so promotion is an update at 0 —
      // never the create branch that demands the row be absent.
      expect(sos.buildRoomPut({ roomId: 'ABC234', revision: 7 }, 0).ConditionExpression)
        .toBe('#revision = :expected');
      expect(sos.buildRoomPut({ roomId: 'ABC234', revision: 7 }, null).ConditionExpression)
        .toBe('attribute_not_exists(#revision)');
    });
  });

  describe('publicRoom', () => {
    it('reports the grace deadline per seat so each client knows who is away', () => {
      const until = Date.now() + sos.GRACE_MS;
      const room = playingRoom({ gracePlayerId: 'p2', graceUntil: until });
      const wire = sos.publicRoom(room);

      expect(wire.seats[0].graceUntil).toBeNull();
      expect(wire.seats[1].graceUntil).toBe(until);
      expect(wire.turnDeadline).toBeNull(); // clock suspended
    });

    it('still never leaks connection ids or internal seat status', () => {
      const room = playingRoom({ gracePlayerId: 'p2', graceUntil: Date.now() + sos.GRACE_MS });
      const wire = JSON.stringify(sos.publicRoom(room));
      expect(wire).not.toContain('c1');
      expect(wire).not.toContain('"status":"seated"');
      expect(wire).not.toContain('"status":"grace"');
    });

    it('surfaces the forfeit reason', () => {
      const room = playingRoom({ gracePlayerId: 'p2', graceUntil: Date.now() });
      vi.advanceTimersByTime(1);
      sos.enforceGraceDeadline(room);
      expect(sos.publicRoom(room).forfeit.loserId).toBe('p2');
    });
  });
});
