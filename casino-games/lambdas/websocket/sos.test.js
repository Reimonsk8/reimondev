import { beforeEach, describe, expect, it, vi } from 'vitest';
import sos from './sos.js';
import * as engineModule from '../../frontend/src/games/squareofshadows/engine/index';

/**
 * Covers the pure room logic (no AWS calls): lobby shape, wire projection,
 * code generation, match construction and the server-authoritative turn clock.
 * The DynamoDB transport is exercised in the deployed environment, not here.
 *
 * The engine is injected because plain Node cannot require() a .ts file; in the
 * deployed Lambda CDK's esbuild resolves and inlines it instead.
 */
sos.__setEngine(engineModule);

const T0 = new Date('2026-01-01T00:00:00Z');

const finishDraft = (state) => {
  for (const playerId of state.pickOrder) {
    const faction = ['INQUISITORS', 'PENITENT_COURT'].find(
      (candidate) => !Object.values(state.factions).includes(candidate),
    );
    state = engineModule.applyCommand(state, playerId, { type: 'CHOOSE_FACTION', faction }).state;
  }
  return state;
};

const playingRoom = () => {
  const room = sos.freshRoom('ABC234');
  const state = finishDraft(sos.buildMatch('ABC234', 'p1', 'p2'));
  room.state = engineModule.serializeGameState(state);
  room.revision = room.state.revision;
  room.phase = 'playing';
  room.turnDeadline = Date.now() + sos.TURN_MS;
  return room;
};

describe('sos rooms', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  describe('room codes', () => {
    it('are 6 chars from an alphabet that excludes 0/1/I/O', () => {
      for (let i = 0; i < 300; i += 1) {
        const code = sos.makeRoomCode();
        expect(code).toHaveLength(sos.CODE_LENGTH);
        expect(code).not.toMatch(/[01IO]/);
      }
    });
  });

  describe('freshRoom', () => {
    it('starts empty, in lobby, with a TTL in the future', () => {
      const room = sos.freshRoom('ABC234');
      expect(room.roomId).toBe('ABC234');
      expect(room.phase).toBe('lobby');
      expect(room.seats).toEqual([]);
      expect(room.state).toBeNull();
      expect(room.revision).toBe(0);
      expect(room.ttl).toBeGreaterThan(T0.getTime() / 1000);
    });
  });

  describe('publicRoom', () => {
    it('never leaks connection ids or seat internals to the client', () => {
      const room = {
        ...sos.freshRoom('ABC234'),
        seats: [
          { playerId: 'p1', connectionId: 'conn-secret-1', nickname: 'Ada', slot: 0, status: 'seated' },
          { playerId: 'p2', connectionId: 'conn-secret-2', nickname: 'Bo', slot: 1, status: 'seated' },
        ],
      };

      const wire = JSON.stringify(sos.publicRoom(room));
      expect(wire).not.toContain('conn-secret-1');
      expect(wire).not.toContain('conn-secret-2');
      expect(wire).not.toContain('status');
      expect(sos.publicRoom(room).seats.map((s) => s.nickname)).toEqual(['Ada', 'Bo']);
    });
  });

describe('buildMatch', () => {
    it('randomizes turn and pick order independently before faction selection', () => {
      const state = sos.buildMatch('ABC234', 'p1', 'p2');

      expect(state.phase).toBe('deployment');
      expect([...state.turnOrder].sort()).toEqual(['p1', 'p2']);
      expect([...state.pickOrder].sort()).toEqual(['p1', 'p2']);
      expect(state.activePlayerId).toBe(state.pickOrder[0]);
      expect(state.units.size).toBe(0);
      expect(state.winnerId).toBeNull();
    });

    it('deploys both squads after picks without wall or spawn overlap', () => {
      const state = finishDraft(sos.buildMatch('ABC234', 'p1', 'p2'));
      expect(state.phase).toBe('playing');
      expect(state.units.size).toBe(8);
      const a = [...state.units.values()].filter((u) => u.ownerId === 'p1');
      const b = [...state.units.values()].filter((u) => u.ownerId === 'p2');

      for (const unit of state.units.values()) {
        expect(state.terrain.get(`${unit.position.x},${unit.position.y}`)).not.toBe('WALL');
      }
      const keys = (units) => units.map((u) => `${u.position.x},${u.position.y}`);
      expect(keys(a).filter((k) => keys(b).includes(k))).toHaveLength(0);
    });
  });

  describe('turn deadline', () => {
    it('is three minutes by default', () => {
      expect(sos.TURN_MS).toBe(180_000);
    });

    it('auto-picks the only remaining faction if a player stalls during draft', () => {
      const room = sos.freshRoom('ABC234');
      const draft = sos.buildMatch('ABC234', 'p1', 'p2');
      room.state = engineModule.serializeGameState(draft);
      room.revision = room.state.revision;
      room.phase = 'playing';
      room.turnDeadline = Date.now() + sos.TURN_MS;

      vi.advanceTimersByTime(sos.TURN_MS + 1);
      expect(sos.enforceTurnDeadline(room)).toBe(true);
      expect(room.state.phase).toBe('deployment');
      expect(Object.keys(room.state.factions)).toHaveLength(1);

      vi.advanceTimersByTime(sos.TURN_MS + 1);
      expect(sos.enforceTurnDeadline(room)).toBe(true);
      expect(room.state.phase).toBe('playing');
      expect(room.state.units).toHaveLength(8);
    });

    it('leaves a live turn untouched', () => {
      const room = playingRoom();
      const before = room.revision;

      expect(sos.enforceTurnDeadline(room)).toBe(false);
      expect(room.revision).toBe(before);
      expect(room.state.activePlayerId).toBe(room.state.turnOrder[0]);
    });

    it('skips the stalled player and hands initiative over', () => {
      const room = playingRoom();
      vi.advanceTimersByTime(sos.TURN_MS + 1_000);

      expect(sos.enforceTurnDeadline(room)).toBe(true);
      expect(room.state.activePlayerId).toBe(room.state.turnOrder[1]);
      // turnNumber counts full rounds, so handing over to p2 leaves it at 1.
      expect(room.state.turnNumber).toBe(1);
      expect(room.revision).toBe(room.state.revision);
    });

    it('completes the round once the second player also stalls', () => {
      const room = playingRoom();
      vi.advanceTimersByTime(sos.TURN_MS + 1_000);
      sos.enforceTurnDeadline(room);

      vi.advanceTimersByTime(sos.TURN_MS + 1_000);
      expect(sos.enforceTurnDeadline(room)).toBe(true);
      expect(room.state.activePlayerId).toBe(room.state.turnOrder[0]);
      expect(room.state.turnNumber).toBe(2);
    });

    it('gives the incoming player a fresh budget, not the expired one', () => {
      const room = playingRoom();
      vi.advanceTimersByTime(sos.TURN_MS + 1_000);
      sos.enforceTurnDeadline(room);

      expect(room.turnDeadline).toBe(Date.now() + sos.TURN_MS);
    });

    it('does nothing outside a live match', () => {
      const room = sos.freshRoom('ABC234');
      room.phase = 'lobby';
      expect(sos.enforceTurnDeadline(room)).toBe(false);

      const noClock = playingRoom();
      noClock.turnDeadline = null;
      expect(sos.enforceTurnDeadline(noClock)).toBe(false);
    });

    it('does not fire a second time within the same turn', () => {
      const room = playingRoom();
      vi.advanceTimersByTime(sos.TURN_MS + 1_000);

      expect(sos.enforceTurnDeadline(room)).toBe(true);
      const revision = room.revision;
      expect(sos.enforceTurnDeadline(room)).toBe(false);
      expect(room.revision).toBe(revision);
    });
  });

  /**
   * The event batch is what drives animation online, so the server has to ship
   * it — but it must not become a side channel for the opponent's hidden traps.
   */
  describe('eventsFor', () => {
    const batch = () => [
      { type: 'UNIT_ATTACKED', attackerId: 'p2', targetId: 'p1', damage: 8, defeated: [] },
      { type: 'TRAP_PLACED', trapId: 'trap-p2-3', ownerId: 'p2', x: 4, y: 4 },
      { type: 'SPELL_CAST', unitId: 'p2', ability: 'TRAP', x: 4, y: 4 },
      { type: 'SPELL_CAST', unitId: 'p1:RANGER', ability: 'TRAP', x: 1, y: 1 },
      { type: 'TRAP_PLACED', trapId: 'trap-p1-3', ownerId: 'p1', x: 1, y: 1 },
      { type: 'UNIT_DEFEATED', unitId: 'e1' },
    ];

    it('keeps everything that is public to both players', () => {
      const kept = sos.eventsFor(batch(), 'p1').map((e) => e.type);
      expect(kept).toContain('UNIT_ATTACKED');
      expect(kept).toContain('UNIT_DEFEATED');
    });

    it("never reveals an opponent's hidden trap, by placement or by cast", () => {
      const forP1 = JSON.stringify(sos.eventsFor(batch(), 'p1'));
      expect(forP1).not.toContain('trap-p2-3');
      // The SPELL_CAST for the trap would give the tile away just as surely.
      expect(forP1).not.toContain('"ability":"TRAP","x":4');

      const forP2 = JSON.stringify(sos.eventsFor(batch(), 'p2'));
      expect(forP2).not.toContain('trap-p1-3');
    });

    it('still shows you your own trap', () => {
      const mine = sos.eventsFor(batch(), 'p1').filter((e) => e.type === 'TRAP_PLACED');
      expect(mine).toHaveLength(1);
      expect(mine[0].ownerId).toBe('p1');
    });

    it('tolerates a missing batch', () => {
      expect(sos.eventsFor(null, 'p1')).toEqual([]);
      expect(sos.eventsFor(undefined, 'p1')).toEqual([]);
    });
  });

  describe('seatOf', () => {
    it('finds a seat by player id and tolerates absence', () => {
      const room = {
        ...sos.freshRoom('ABC234'),
        seats: [{ playerId: 'p1', nickname: 'Ada', slot: 0 }],
      };
      expect(sos.seatOf(room, 'p1').nickname).toBe('Ada');
      expect(sos.seatOf(room, 'nobody')).toBeNull();
    });
  });
});
