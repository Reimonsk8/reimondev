const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { createRoomState, joinRoom, redeployPlayer, snapshotForPlayer, neutralInput } = require('../../frontend/src/games/zombie-shooter/engine/room.ts');
const { stepRoomWorld } = require('../../frontend/src/games/zombie-shooter/engine/simulation.ts');
const { createCognitoVerifier } = require('./auth');
const { parseClientMessage } = require('./protocol');

const SECTOR_NAME = 'sector-07';
const PRIMARY_ROOM_ID = SECTOR_NAME;

function safeNickname(value) {
  if (typeof value !== 'string') return 'Operative';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Operative';
}

function createOutlandsService(options = {}) {
  const port = options.port ?? Number(process.env.OUTLANDS_PORT || process.env.PORT || 3020);
  const host = options.host ?? process.env.OUTLANDS_HOST ?? '127.0.0.1';
  const tickHz = options.tickHz ?? 20;
  const snapshotHz = Math.min(tickHz, options.snapshotHz ?? 10);
  const roomCapacity = options.roomCapacity
    ?? Number(process.env.OUTLANDS_ROOM_CAPACITY || 8);
  const resumeGraceMs = options.resumeGraceMs ?? 30_000;
  const stateFile = options.stateFile === undefined
    ? (process.env.OUTLANDS_STATE_FILE || path.resolve(process.cwd(), 'data/outlands-sector-07.json'))
    : options.stateFile;
  const persistEveryTicks = Math.max(1, options.persistEveryTicks ?? tickHz * 5);
  const authTimeoutMs = options.authTimeoutMs ?? 5_000;
  const minimumInputIntervalMs = options.minimumInputIntervalMs ?? 25;
  const verifyToken = options.verifyToken ?? createCognitoVerifier();
  const rng = options.rng ?? (() => randomInt(0, 0x100000000) / 0x100000000);
  const now = options.now ?? Date.now;
  const allowOrigin = options.allowOrigin ?? ((origin) => {
    if (!origin) return true;
    const configured = (process.env.OUTLANDS_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return configured.includes(origin);
  });

  const rooms = new Map();
  const sessions = new Map();
  const playerRooms = new Map();
  const graceTimers = new Map();
  let tickTimer = null;
  let httpServer = null;
  let listening = false;
  let shuttingDown = false;
  let persistenceQueue = Promise.resolve();
  const snapshotEvery = Math.max(1, Math.round(tickHz / snapshotHz));
  const stepSeconds = 1 / tickHz;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: false,
  });

  const send = (socket, payload) => {
    if (socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > 256_000) return false;
    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  };

  function ensurePrimaryRoom() {
    let room = rooms.get(PRIMARY_ROOM_ID);
    if (!room) {
      room = {
        id: PRIMARY_ROOM_ID,
        state: createRoomState(randomInt(0, 0x100000000)),
        connections: new Map(),
        inputs: {},
        ticks: 0,
      };
      rooms.set(PRIMARY_ROOM_ID, room);
    }
    return room;
  }

  async function restoreWorld() {
    if (!stateFile) return;
    try {
      const stored = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      if (stored?.version !== 1 || !stored.state?.map || !stored.state?.players) {
        throw new Error('Unsupported Outlands state snapshot');
      }
      rooms.set(PRIMARY_ROOM_ID, {
        id: PRIMARY_ROOM_ID,
        state: stored.state,
        connections: new Map(),
        inputs: {},
        ticks: Number.isSafeInteger(stored.ticks) ? stored.ticks : 0,
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Could not restore persistent Outlands world: ${error.message}`);
    }
  }

  function persistWorld() {
    if (!stateFile) return persistenceQueue;
    const room = rooms.get(PRIMARY_ROOM_ID);
    if (!room) return persistenceQueue;
    const snapshot = JSON.stringify({ version: 1, ticks: room.ticks, state: room.state });
    persistenceQueue = persistenceQueue.catch(() => undefined).then(async () => {
      const directory = path.dirname(stateFile);
      await fs.mkdir(directory, { recursive: true });
      const temporaryFile = `${stateFile}.${process.pid}.tmp`;
      await fs.writeFile(temporaryFile, snapshot, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporaryFile, stateFile);
    });
    return persistenceQueue;
  }

  /** One public sector only — no auto-sharding when full. */
  function findRoomFor(playerId) {
    const previousId = playerRooms.get(playerId);
    const previous = previousId ? rooms.get(previousId) : null;
    if (previous?.state.players[playerId]) return previous;
    return ensurePrimaryRoom();
  }

  function primaryRoomOccupancy() {
    const room = rooms.get(PRIMARY_ROOM_ID);
    if (!room) return 0;
    return room.connections.size;
  }

  function removePlayerAfterGrace(playerId, roomId) {
    graceTimers.delete(playerId);
    const room = rooms.get(roomId);
    if (!room || room.connections.has(playerId)) return;
    delete room.inputs[playerId];
    void persistWorld().catch((error) => console.error('Outlands persistence failed:', error.message));
  }

  function detach(connection) {
    clearTimeout(connection.authTimer);
    if (!connection.playerId || !connection.roomId) return;
    const room = rooms.get(connection.roomId);
    if (!room || room.connections.get(connection.playerId) !== connection) return;

    room.connections.delete(connection.playerId);
    room.inputs[connection.playerId] = neutralInput(room.state.players[connection.playerId]?.state.aim);
    sessions.delete(connection.playerId);
    if (shuttingDown) {
      delete room.inputs[connection.playerId];
      void persistWorld().catch((error) => console.error('Outlands persistence failed:', error.message));
      return;
    }
    const timer = setTimeout(
      () => removePlayerAfterGrace(connection.playerId, connection.roomId),
      resumeGraceMs,
    );
    timer.unref?.();
    graceTimers.set(connection.playerId, timer);
  }

  async function authenticate(connection, token, outpostId = 'nastya') {
    let claims;
    try {
      claims = await verifyToken(token);
    } catch {
      send(connection.socket, { type: 'error', code: 'AUTH_REJECTED' });
      connection.socket.close(4001, 'Authentication rejected');
      return;
    }
    if (!claims || typeof claims.sub !== 'string' || claims.sub.length < 1 || claims.sub.length > 128) {
      send(connection.socket, { type: 'error', code: 'AUTH_REJECTED' });
      connection.socket.close(4001, 'Authentication rejected');
      return;
    }

    const playerId = claims.sub;
    const priorTimer = graceTimers.get(playerId);
    if (priorTimer) clearTimeout(priorTimer);
    graceTimers.delete(playerId);

    const priorConnection = sessions.get(playerId);
    if (priorConnection && priorConnection !== connection) {
      priorConnection.socket.close(4002, 'Session replaced');
      detach(priorConnection);
      const replacementGraceTimer = graceTimers.get(playerId);
      if (replacementGraceTimer) clearTimeout(replacementGraceTimer);
      graceTimers.delete(playerId);
    }

    const room = findRoomFor(playerId);
    const existingSlot = room.state.players[playerId];
    const activeCount = room.connections.size;
    if (!existingSlot && activeCount >= roomCapacity) {
      send(connection.socket, { type: 'error', code: 'SECTOR_FULL' });
      connection.socket.close(4003, 'Sector full');
      return;
    }
    const slot = joinRoom(
      room.state,
      playerId,
      safeNickname(claims.nickname || claims.name || claims['cognito:username']),
      Math.max(roomCapacity, Object.keys(room.state.players).length + 1),
      outpostId,
    );
    if (!slot) {
      send(connection.socket, { type: 'error', code: 'SECTOR_FULL' });
      connection.socket.close(4003, 'Sector full');
      return;
    }

    connection.playerId = playerId;
    connection.roomId = room.id;
    connection.lastInputSeq = -1;
    connection.lastInputAt = 0;
    room.connections.set(playerId, connection);
    room.inputs[playerId] = neutralInput(slot.state.aim);
    sessions.set(playerId, connection);
    playerRooms.set(playerId, room.id);
    send(connection.socket, {
      type: 'welcome',
      playerId,
      nickname: slot.nickname,
      roomId: room.id,
      tickHz,
      snapshotHz,
       state: snapshotForPlayer(room.state, playerId, new Set(room.connections.keys())),
    });
    for (const [otherId, other] of room.connections) {
      if (otherId !== playerId) {
        send(other.socket, {
          type: 'snapshot',
          seq: room.ticks,
          serverTime: room.state.time,
           state: snapshotForPlayer(room.state, otherId, new Set(room.connections.keys())),
        });
      }
    }
  }

  async function handleMessage(connection, raw) {
    const message = parseClientMessage(raw);
    if (!message) {
      send(connection.socket, { type: 'error', code: 'INVALID_MESSAGE' });
      return;
    }

    if (!connection.playerId) {
      if (message.type !== 'authenticate') {
        send(connection.socket, { type: 'error', code: 'AUTH_REQUIRED' });
        connection.socket.close(4001, 'Authentication required');
        return;
      }
      await authenticate(connection, message.token, message.outpostId);
      return;
    }

    const room = rooms.get(connection.roomId);
    if (!room) {
      connection.socket.close(1011, 'Sector unavailable');
      return;
    }

    if (message.type === 'ping') {
      send(connection.socket, { type: 'pong', id: message.id, serverTime: now() });
    } else if (message.type === 'input') {
      if (message.seq <= connection.lastInputSeq) return;
      const timestamp = now();
      if (timestamp - connection.lastInputAt < minimumInputIntervalMs) return;
      connection.lastInputAt = timestamp;
      connection.lastInputSeq = message.seq;
      room.inputs[connection.playerId] = message.input;
    } else if (message.type === 'redeploy') {
      if (!redeployPlayer(room.state, connection.playerId)) {
        send(connection.socket, { type: 'error', code: 'REDEPLOY_NOT_ALLOWED' });
        return;
      }
      room.inputs[connection.playerId] = neutralInput(room.state.players[connection.playerId].state.aim);
      send(connection.socket, {
        type: 'snapshot',
        seq: room.ticks,
        serverTime: room.state.time,
        state: snapshotForPlayer(room.state, connection.playerId),
      });
    }
  }

  function tick() {
    for (const room of rooms.values()) {
      if (room.connections.size === 0) continue;
      for (const [playerId, connection] of room.connections) {
        if (now() - connection.lastInputAt > 250) {
          room.inputs[playerId] = neutralInput(room.state.players[playerId]?.state.aim);
        }
      }
      stepRoomWorld(room.state, room.inputs, stepSeconds, rng, new Set(room.connections.keys()));
      room.ticks += 1;
      if (room.ticks % persistEveryTicks === 0) {
        void persistWorld().catch((error) => console.error('Outlands persistence failed:', error.message));
      }
      if (room.ticks % snapshotEvery !== 0) continue;

      for (const [playerId, connection] of room.connections) {
        const state = snapshotForPlayer(room.state, playerId, new Set(room.connections.keys()));
        if (state) send(connection.socket, {
          type: 'snapshot',
          seq: room.ticks,
          serverTime: room.state.time,
          state,
        });
      }
      room.state.events = [];
    }
  }

  httpServer = http.createServer((request, response) => {
    if (request.url === '/health') {
      const connections = [...rooms.values()].reduce((sum, room) => sum + room.connections.size, 0);
      const players = primaryRoomOccupancy();
      const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
      const origin = request.headers.origin;
      if (origin && allowOrigin(origin)) {
        headers['access-control-allow-origin'] = origin;
        headers.vary = 'Origin';
      }
      response.writeHead(200, headers);
      response.end(JSON.stringify({
        ok: true,
        roomId: PRIMARY_ROOM_ID,
        rooms: rooms.size,
        connections,
        players,
        capacity: roomCapacity,
        full: players >= roomCapacity,
      }));
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('Not found');
  });

  httpServer.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/outlands' || !allowOrigin(request.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (websocket) => wss.emit('connection', websocket, request));
  });

  wss.on('connection', (socket) => {
    const connection = {
      socket,
      playerId: null,
      roomId: null,
      lastInputSeq: -1,
      lastInputAt: 0,
      queue: Promise.resolve(),
      authTimer: setTimeout(() => socket.close(4001, 'Authentication timeout'), authTimeoutMs),
    };
    connection.authTimer.unref?.();
    socket.on('message', (raw) => {
      connection.queue = connection.queue
        .then(() => handleMessage(connection, raw))
        .catch(() => socket.close(1011, 'Message handling failed'));
    });
    socket.on('close', () => detach(connection));
    socket.on('error', () => detach(connection));
  });

  return {
    rooms,
    httpServer,
    async listen(listenPort = port, listenHost = host) {
      if (listening) return httpServer.address();
      await restoreWorld();
      await new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        httpServer.once('error', onError);
        httpServer.listen(listenPort, listenHost, () => {
          httpServer.removeListener('error', onError);
          resolve();
        });
      });
      listening = true;
      tickTimer = setInterval(tick, 1000 / tickHz);
      tickTimer.unref?.();
      return httpServer.address();
    },
    async close() {
      if (tickTimer) clearInterval(tickTimer);
      for (const timer of graceTimers.values()) clearTimeout(timer);
      graceTimers.clear();
      try {
        await persistWorld();
      } catch (error) {
        console.error('Could not persist Outlands world during shutdown:', error.message);
      }
      shuttingDown = true;
      for (const socket of wss.clients) socket.terminate();
      await new Promise((resolve) => wss.close(() => resolve()));
      if (listening) await new Promise((resolve) => httpServer.close(() => resolve()));
      listening = false;
    },
  };
}

if (require.main === module) {
  const service = createOutlandsService();
  service.listen().then((address) => {
    console.log(`Outlands authoritative server listening on ${address.address}:${address.port}`);
  }).catch((error) => {
    console.error('Outlands server failed to start:', error.message);
    process.exitCode = 1;
  });
  const shutdown = () => service.close().finally(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

module.exports = { createOutlandsService };
