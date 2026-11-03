import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as engineModule from '../../frontend/src/games/squareofshadows/engine/index';

/**
 * Transport-level tests for the Square of Shadows rooms table.
 *
 * These exist because of a bug the pure-logic suite structurally could not
 * catch: `saveRoom` always passed `:expected` in `ExpressionAttributeValues`,
 * but the create path's condition (`attribute_not_exists(#revision)`) never
 * references it. Real DynamoDB rejects that request outright with
 * `ValidationException: Value provided in ExpressionAttributeValues unused in
 * expressions`, so every `sos:create` failed and the `sos-rooms` table stayed
 * permanently empty — online duels never opened a lobby at all.
 *
 * The old tests could not see this: they stubbed `docClient.put` with a no-op
 * that accepted any arguments, so the request shape was never exercised. The
 * fake below is deliberately strict — it validates unused expression
 * attributes and evaluates conditions, exactly like the service does.
 */

const h = vi.hoisted(() => ({
  tables: new Map(),
  sent: [],
  players: new Map(),
}));

/** Keys per table, mirroring the real key schemas. */
const TABLE_KEYS = { 'sos-rooms': 'roomId', 'casino-connections': 'connectionId' };

const tableFor = (name) => {
  if (!h.tables.has(name)) h.tables.set(name, new Map());
  return h.tables.get(name);
};

/** DynamoDB ValidationException: unused expression attribute keys are fatal. */
const validationError = (msg) => {
  const err = new Error(msg);
  err.name = 'ValidationException';
  return err;
};

const conditionalError = () => {
  const err = new Error('The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
};

/** Every `:value` / `#name` token actually referenced by the expression. */
const referenced = (expression = '') => ({
  values: new Set([...expression.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => `:${m[1]}`)),
  names: new Set([...expression.matchAll(/#([A-Za-z0-9_]+)/g)].map((m) => `#${m[1]}`)),
});

/** Reject exactly what DynamoDB rejects, so the fake cannot be more forgiving. */
const assertNoUnusedAttributes = (ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues) => {
  const expr = ConditionExpression || '';
  if (!expr) return;
  const used = referenced(expr);
  for (const key of Object.keys(ExpressionAttributeValues || {})) {
    if (!used.values.has(key)) {
      throw validationError(`Value provided in ExpressionAttributeValues unused in expressions: keys: {${key}}`);
    }
  }
  for (const key of Object.keys(ExpressionAttributeNames || {})) {
    if (!used.names.has(key)) {
      throw validationError(`Name provided in ExpressionAttributeNames unused in expressions: keys: {${key}}`);
    }
  }
};

/** Evaluate the two condition shapes the room writer uses. */
const assertConditionHolds = (existing, ConditionExpression, ExpressionAttributeNames = {}, ExpressionAttributeValues = {}) => {
  if (!ConditionExpression) return;
  const resolve = (token) => {
    if (token.startsWith('#')) return existing?.[ExpressionAttributeNames[token]];
    return ExpressionAttributeValues[token];
  };
  const notExists = ConditionExpression.match(/attribute_not_exists\(#([A-Za-z0-9_]+)\)/);
  if (notExists) {
    const name = `#${notExists[1]}`;
    if (existing && existing[ExpressionAttributeNames[name]] !== undefined) throw conditionalError();
    return;
  }
  const eq = ConditionExpression.match(/^#([A-Za-z0-9_]+)\s*=\s*:([A-Za-z0-9_]+)$/);
  if (eq) {
    const want = ExpressionAttributeValues[`:${eq[2]}`];
    const have = existing?.[ExpressionAttributeNames[`#${eq[1]}`]];
    if (have !== want) throw conditionalError();
    return;
  }
  throw validationError(`Unsupported condition in test fake: ${ConditionExpression}`);
};

const docClient = {
  async get({ TableName, Key }) {
    const keyName = TABLE_KEYS[TableName];
    const table = tableFor(TableName);
    const item = table.get(Key[keyName]);
    return { Item: item ? structuredClone(item) : undefined };
  },
  async put({ TableName, Item, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues }) {
    assertNoUnusedAttributes(ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues);
    const table = tableFor(TableName);
    const keyName = TABLE_KEYS[TableName];
    const key = Item[keyName];
    assertConditionHolds(table.get(key), ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues);
    table.set(key, structuredClone(Item));
    return {};
  },
  async update({ TableName, Key, UpdateExpression, ExpressionAttributeNames = {}, ExpressionAttributeValues = {} }) {
    const table = tableFor(TableName);
    const keyName = TABLE_KEYS[TableName];
    const existing = table.get(Key[keyName]) || { [keyName]: Key[keyName] };
    const next = structuredClone(existing);
    const setMatch = UpdateExpression.match(/^SET\s+(.+)$/);
    if (setMatch) {
      for (const pair of setMatch[1].split(',')) {
        const [rawKey, rawValue] = pair.split('=').map((s) => s.trim());
        const key = rawKey.startsWith('#') ? ExpressionAttributeNames[rawKey] : rawKey;
        const value = rawValue.startsWith(':') ? ExpressionAttributeValues[rawValue] : rawValue;
        next[key] = value;
      }
    }
    table.set(Key[keyName], next);
    return {};
  },
  async delete({ TableName, Key }) {
    tableFor(TableName).delete(Key[TABLE_KEYS[TableName]]);
    return {};
  },
};

const fakeSend = async (connectionId, payload) => {
  h.sent.push({ connectionId, payload });
};

const fakeGetPlayer = async (connectionId) => {
  const player = h.players.get(connectionId);
  if (!player) throw new Error('Unknown connection');
  return player;
};

const { default: sos } = await import('./sos.js');

sos.__setEngine(engineModule);

const ROOMS_TABLE = 'sos-rooms';

// The room table name comes from the Lambda's environment; point it at the fake.
process.env.SOS_ROOMS_TABLE_NAME = ROOMS_TABLE;
process.env.CONNECTIONS_TABLE_NAME = 'casino-connections';

const connectionFor = (connectionId, playerId, nickname) => {
  h.players.set(connectionId, { playerId, userId: playerId, nickname });
  h.tables.set('casino-connections', h.tables.get('casino-connections') || new Map());
  h.tables.get('casino-connections').set(connectionId, { connectionId, playerId });
  return { requestContext: { connectionId } };
};

const sentTo = (connectionId) =>
  h.sent.filter((m) => m.connectionId === connectionId).map((m) => m.payload);

const errorsTo = (connectionId) =>
  sentTo(connectionId).filter((p) => p.type === 'sos:error').map((p) => p.message);

const roomRows = () => [...h.tables.get(ROOMS_TABLE).values()];

const finishDraft = async (gameId) => {
  const byPlayer = {
    'user-host': 'conn-host',
    'user-guest': 'conn-guest',
  };
  for (let turn = 0; turn < 2; turn += 1) {
    const state = engineModule.deserializeGameState(roomRows()[0].state);
    if (state.phase !== 'deployment') return;
    const connectionId = byPlayer[state.activePlayerId];
    const faction = Object.values(state.factions).includes('INQUISITORS')
      ? 'PENITENT_COURT'
      : 'INQUISITORS';
    // Reuse the existing connection row; recreating it would erase sosRoomId.
    const event = { requestContext: { connectionId } };
    const result = await sos.handleMessage(event, {
      action: 'sos:command',
      gameId,
      command: { type: 'CHOOSE_FACTION', faction },
    });
    if (result.statusCode !== 200) throw new Error(`faction draft failed: ${result.body}`);
  }
};

describe('online adventure: the server moves the monsters', () => {
  beforeEach(() => {
    h.tables.clear();
    h.sent.length = 0;
    h.players.clear();
    // Same fake transport the persistence suite uses. The engine is already
    // injected at module scope.
    sos.__setTransport({ docClient, send: fakeSend, getPlayer: fakeGetPlayer });
  });

  afterAll(() => {
    sos.__setTransport(null);
  });

  const startAdventure = async () => {
    const hostEvent = connectionFor('conn-host', 'user-host', 'Ada');
    const code = (await sos.handleMessage(hostEvent, { action: 'sos:create' })).body;
    connectionFor('conn-guest', 'user-guest', 'Bo');
    await sos.handleMessage(
      { requestContext: { connectionId: 'conn-guest' } },
      { action: 'sos:join', gameId: code },
    );
    // Adventure is a floor picked during the draft, exactly as a player picks it.
    await sos.handleMessage(hostEvent, {
      action: 'sos:command',
      gameId: code,
      command: { type: 'SET_MAP_MODE', mapMode: 'RANDOM' },
    });
    await finishDraft(code);
    return { hostEvent, code };
  };

  /**
   * End both players' turns. Turn order is shuffled server-side, so this asks
   * the state who is actually active instead of assuming a fixed order — a fixed
   * order silently drops one END_TURN and the monsters never get the turn.
   */
  const endPlayerTurns = async (code, times = 4) => {
    const byPlayer = { 'user-host': 'conn-host', 'user-guest': 'conn-guest' };
    for (let guard = 0; guard < times; guard += 1) {
      const activePlayerId = roomRows()[0].state.activePlayerId;
      const result = await sos.handleMessage(
        { requestContext: { connectionId: byPlayer[activePlayerId] } },
        { action: 'sos:command', gameId: code, command: { type: 'END_TURN' } },
      );
      if (result.statusCode !== 200) throw new Error(`end turn failed: ${result.body}`);
    }
  };

  it('never hands the monsters a turn; they move inside END_TURN instead', async () => {
    const { code } = await startAdventure();
    const row = roomRows()[0];
    // No phantom third seat: a team the player cannot play would stall the loop.
    expect(row.state.turnOrder).not.toContain('MONSTERS');
    expect(row.state.boardSize).toEqual({ width: 20, height: 20 });
    expect(row.state.units.filter((u) => u.ownerId === 'MONSTERS')).toHaveLength(4);

    await endPlayerTurns(code, 2);
    // Two hand-overs, and the turn is still a PLAYER's — never the monsters'.
    expect(roomRows()[0].state.activePlayerId).not.toBe('MONSTERS');
    expect(['user-host', 'user-guest']).toContain(roomRows()[0].state.activePlayerId);
    // The room is still a live match, not a forfeit.
    expect(roomRows()[0].phase).toBe('playing');
  });

  it('moves the monsters server-side as part of the player ending their turn', async () => {
    const { code } = await startAdventure();
    // Fingerprint both position and health: a monster may cast or strike instead
    // of stepping, and "did anything happen" is the contract, not "did it walk".
    const monsters = () =>
      roomRows()[0].state.units
        .filter((u) => u.ownerId === 'MONSTERS')
        .map((u) => `${u.id}@${u.position.x},${u.position.y}/${u.stats.currentHp}`)
        .join('|');
    const before = monsters();
    const partyBefore = roomRows()[0].state.units
      .filter((u) => u.ownerId !== 'MONSTERS')
      .map((u) => u.stats.currentHp)
      .join('|');
    const revisionBefore = roomRows()[0].state.revision;

    await endPlayerTurns(code, 1);

    // The floor keeps moving even though the player only handed the turn on, and
    // it happened in the same commit rather than needing a client to ask for it.
    expect(monsters()).not.toBe(before);
    expect(roomRows()[0].state.revision).toBeGreaterThan(revisionBefore);
    // And no client could have forged a monster move: it rides along with END_TURN.
    expect(roomRows()[0].state.activePlayerId).not.toBe('MONSTERS');
    void partyBefore;
  });
});

describe('sos room persistence (real DynamoDB semantics)', () => {
  beforeEach(() => {
    h.tables.clear();
    h.sent.length = 0;
    h.players.clear();
    sos.__setTransport({ docClient, send: fakeSend, getPlayer: fakeGetPlayer });
  });

  afterAll(() => {
    sos.__setTransport(null);
  });

  describe('buildRoomPut', () => {
    it('omits ExpressionAttributeValues when creating, because the condition cannot reference it', () => {
      const params = sos.buildRoomPut({ roomId: 'ABC234', revision: 0 }, null);

      expect(params.ConditionExpression).toBe('attribute_not_exists(#revision)');
      // DynamoDB hard-fails on any value the condition does not reference.
      expect(params.ExpressionAttributeValues).toBeUndefined();
    });

    it('updates revision 0 rather than treating it as "not created yet"', () => {
      // A room waiting in the lobby has revision 0. Treating that as the create
      // branch made the guest's join fail its condition every single time.
      const params = sos.buildRoomPut({ roomId: 'ABC234', revision: 0 }, 0);

      expect(params.ConditionExpression).toBe('#revision = :expected');
      expect(params.ExpressionAttributeValues).toEqual({ ':expected': 0 });
    });

    it('includes ExpressionAttributeValues when updating an existing revision', () => {
      const params = sos.buildRoomPut({ roomId: 'ABC234', revision: 7 }, 7);

      expect(params.ConditionExpression).toBe('#revision = :expected');
      expect(params.ExpressionAttributeValues).toEqual({ ':expected': 7 });
    });
  });

  it('persists a room on sos:create — the bug that kept the table empty', async () => {
    const event = connectionFor('conn-host', 'user-host', 'Ada');

    const result = await sos.handleMessage(event, { action: 'sos:create' });

    expect(result.statusCode).toBe(200);
    expect(errorsTo('conn-host')).toEqual([]);

    const rows = roomRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe('lobby');
    expect(rows[0].hostId).toBe('user-host');
    expect(rows[0].seats).toHaveLength(1);
    expect(result.body).toBe(rows[0].roomId);
  });

  it('starts the duel when the invited player joins, and tells both seats', async () => {
    const hostEvent = connectionFor('conn-host', 'user-host', 'Ada');
    const created = await sos.handleMessage(hostEvent, { action: 'sos:create' });
    const code = created.body;

    h.sent.length = 0;
    const guestEvent = connectionFor('conn-guest', 'user-guest', 'Bo');
    const joined = await sos.handleMessage(guestEvent, { action: 'sos:join', gameId: code });

    expect(joined.statusCode).toBe(200);
    expect(errorsTo('conn-guest')).toEqual([]);

    const row = roomRows()[0];
    expect(row.phase).toBe('playing');
    expect(row.seats.map((s) => s.playerId)).toEqual(['user-host', 'user-guest']);

    // Both players must receive the new authoritative board.
    expect(sentTo('conn-host').some((p) => p.type === 'sos:state' && p.room.phase === 'playing')).toBe(true);
    expect(sentTo('conn-guest').some((p) => p.type === 'sos:state' && p.room.phase === 'playing')).toBe(true);
  });

  it('rejects an invite code that does not exist', async () => {
    const event = connectionFor('conn-guest', 'user-guest', 'Bo');
    const result = await sos.handleMessage(event, { action: 'sos:join', gameId: 'ZZZZZZ' });

    expect(result.statusCode).toBe(400);
    expect(errorsTo('conn-guest')).toContain('That lobby no longer exists.');
  });

  it('applies a command from the active player and persists the result', async () => {
    const hostEvent = connectionFor('conn-host', 'user-host', 'Ada');
    const code = (await sos.handleMessage(hostEvent, { action: 'sos:create' })).body;
    connectionFor('conn-guest', 'user-guest', 'Bo');
    await sos.handleMessage(
      { requestContext: { connectionId: 'conn-guest' } },
      { action: 'sos:join', gameId: code },
    );
    await finishDraft(code);

    const before = roomRows()[0].state.revision;
    const beforeState = engineModule.deserializeGameState(roomRows()[0].state);
    const activeConnection = beforeState.activePlayerId === 'user-host' ? 'conn-host' : 'conn-guest';
    h.sent.length = 0;

    const result = await sos.handleMessage(
      { requestContext: { connectionId: activeConnection } },
      { action: 'sos:command', gameId: code, command: { type: 'END_TURN' } },
    );

    expect(result.statusCode).toBe(200);
    const after = roomRows()[0].state;
    expect(after.revision).toBeGreaterThan(before);
    expect(engineModule.deserializeGameState(after).activePlayerId).toBe(beforeState.turnOrder[1]);
  });

  it('ends a disconnected faction draft without awarding a win or forfeit', async () => {
    const hostEvent = connectionFor('conn-host', 'user-host', 'Ada');
    const code = (await sos.handleMessage(hostEvent, { action: 'sos:create' })).body;
    connectionFor('conn-guest', 'user-guest', 'Bo');
    await sos.handleMessage(
      { requestContext: { connectionId: 'conn-guest' } },
      { action: 'sos:join', gameId: code },
    );

    await sos.handleDisconnect('conn-guest');
    const room = roomRows()[0];
    expect(room.phase).toBe('ended');
    expect(room.winnerId).toBeNull();
    expect(room.forfeit).toBeNull();
    expect(room.state.phase).toBe('ended');
  });

  it('refuses a command from somebody who is not seated', async () => {
    const hostEvent = connectionFor('conn-host', 'user-host', 'Ada');
    const code = (await sos.handleMessage(hostEvent, { action: 'sos:create' })).body;
    connectionFor('conn-guest', 'user-guest', 'Bo');
    await sos.handleMessage({ requestContext: { connectionId: 'conn-guest' } }, { action: 'sos:join', gameId: code });

    const strangerEvent = connectionFor('conn-x', 'user-x', 'Mallory');
    const result = await sos.handleMessage(strangerEvent, {
      action: 'sos:command',
      gameId: code,
      command: { type: 'END_TURN' },
    });

    expect(result.statusCode).toBe(400);
    expect(errorsTo('conn-x')).toContain('You are not in that lobby.');
  });

  describe('a dropped player cannot rejoin the duel they lost', () => {
    const startDuel = async () => {
      const hostEvent = connectionFor('conn-host', 'user-host', 'Ada');
      const code = (await sos.handleMessage(hostEvent, { action: 'sos:create' })).body;
      connectionFor('conn-guest', 'user-guest', 'Bo');
      await sos.handleMessage(
        { requestContext: { connectionId: 'conn-guest' } },
        { action: 'sos:join', gameId: code },
      );
      await finishDraft(code);
      return { hostEvent, code };
    };

    it('refuses the original player once the duel has been decided by forfeit', async () => {
      const { hostEvent, code } = await startDuel();

      // Bo's socket drops, the grace window runs out, and Bo forfeits.
      await sos.handleDisconnect('conn-guest');
      const row = roomRows()[0];
      row.seats[1].graceUntil = Date.now() - 1;
      await sos.handleMessage(hostEvent, { action: 'sos:tick', gameId: code });

      expect(roomRows()[0].forfeit.loserId).toBe('user-guest');

      // Bo tries the old invite code again. The seat row still exists, so
      // without an explicit forfeit check this would resume a decided duel.
      const comeback = connectionFor('conn-guest-2', 'user-guest', 'Bo');
      const result = await sos.handleMessage(comeback, { action: 'sos:join', gameId: code });

      expect(result.statusCode).toBe(400);
      expect(errorsTo('conn-guest-2')[0]).toMatch(/lost it on forfeit/);
    });

    it('still lets the same player back inside the grace window', async () => {
      const { code } = await startDuel();

      await sos.handleDisconnect('conn-guest');
      expect(roomRows()[0].phase).toBe('playing');

      // Bo comes straight back, before the duel is decided. This is the whole
      // point of the grace period and must not be blocked by the forfeit rule.
      const comeback = connectionFor('conn-guest-2', 'user-guest', 'Bo');
      const result = await sos.handleMessage(comeback, { action: 'sos:join', gameId: code });

      expect(result.statusCode).toBe(200);
      expect(errorsTo('conn-guest-2')).toEqual([]);
      expect(roomRows()[0].phase).toBe('playing');
      expect(roomRows()[0].seats[1].graceUntil).toBeNull();
    });

    it('holds the seat when a player backs out of a live duel, and lets them back in', async () => {
      const { hostEvent, code } = await startDuel();
      const guestEvent = connectionFor('conn-guest', 'user-guest', 'Bo');
      h.sent.length = 0;

      const result = await sos.handleMessage(guestEvent, { action: 'sos:leave', gameId: code });

      expect(result.statusCode).toBe(200);
      const room = roomRows()[0];
      // Backing out is not a forfeit: the opponent gets a countdown and the
      // lobby keeps offering Rejoin, exactly as after a dropped socket.
      expect(room.phase).toBe('playing');
      expect(room.seats[1].status).toBe('grace');
      expect(room.seats[1].graceUntil).toBeGreaterThan(Date.now());
      expect(room.turnDeadline).toBeNull();
      expect(sentTo('conn-host').some((p) => p.type === 'PLAYER_DISCONNECTED_GRACE')).toBe(true);

      const comeback = connectionFor('conn-guest-2', 'user-guest', 'Bo');
      const rejoin = await sos.handleMessage(comeback, { action: 'sos:join', gameId: code });

      expect(rejoin.statusCode).toBe(200);
      expect(roomRows()[0].seats[1].status).toBe('seated');
      expect(roomRows()[0].seats[1].graceUntil).toBeNull();
      expect(roomRows()[0].turnDeadline).toBeGreaterThan(Date.now());
      expect(hostEvent).toBeDefined();
    });

    it('still drops a room that is left before anybody dealt', async () => {
      const hostEvent = connectionFor('conn-host', 'user-host', 'Ada');
      const code = (await sos.handleMessage(hostEvent, { action: 'sos:create' })).body;

      await sos.handleMessage(hostEvent, { action: 'sos:leave', gameId: code });

      expect(roomRows()[0].seats[0].status).toBe('left');
    });

    it('ends an abandoned faction draft, because there is nothing to return to', async () => {
      const hostEvent = connectionFor('conn-host', 'user-host', 'Ada');
      const code = (await sos.handleMessage(hostEvent, { action: 'sos:create' })).body;
      connectionFor('conn-guest', 'user-guest', 'Bo');
      await sos.handleMessage(
        { requestContext: { connectionId: 'conn-guest' } },
        { action: 'sos:join', gameId: code },
      );

      await sos.handleMessage(
        { requestContext: { connectionId: 'conn-guest' } },
        { action: 'sos:leave', gameId: code },
      );

      const room = roomRows()[0];
      expect(room.phase).toBe('ended');
      expect(room.winnerId).toBeNull();
      expect(room.seats[1].status).toBe('left');
      expect(room.state.phase).toBe('ended');
      expect(hostEvent).toBeDefined();
    });
  });
});
