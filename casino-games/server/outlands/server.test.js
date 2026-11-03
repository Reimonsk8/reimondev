import { describe, expect, it } from 'vitest';
const WebSocket = require('ws');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

process.env.TS_NODE_COMPILER_OPTIONS ||= JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
  target: 'ES2022',
  esModuleInterop: true,
});
require('ts-node/register/transpile-only');
const { createOutlandsService } = require('./index');
const { SocketGameClient } = require('../../frontend/src/games/zombie-shooter/engine/SocketGameClient.ts');

function makePeer(url) {
  const socket = new WebSocket(url, { origin: 'http://localhost:3000' });
  const messages = [];
  const waiters = [];
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      messages.push(message);
    }
  });
  return {
    socket,
    opened: new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    }),
    next(predicate, timeout = 3000) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          const waiterIndex = waiters.indexOf(waiter);
          if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
          reject(new Error(`Timed out waiting for server message; buffered=${JSON.stringify(messages)}`));
        }, timeout);
        waiters.push(waiter);
      });
    },
    send(message) {
      socket.send(JSON.stringify(message));
    },
  };
}

describe('Outlands dedicated WebSocket service', () => {
  it('connects the actual browser adapter, updates authoritative movement, and renders a peer snapshot', async () => {
    const previousWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = WebSocket;
    const service = createOutlandsService({
      stateFile: null,
      port: 0,
      host: '127.0.0.1',
      verifyToken: async (token) => ({ sub: token, nickname: `Survivor ${token}` }),
      allowOrigin: () => true,
      rng: () => 0.5,
    });
    let client;
    const peers = [];
    try {
      const address = await service.listen();
      client = await SocketGameClient.connect(`ws://127.0.0.1:${address.port}/outlands`, 'browser-adapter-player-1234567890');
      const startX = client.state.player.x;
      client.step(1 / 20, {
        move: { x: 1, y: 0 },
        aim: { x: 1, y: 0 },
        firing: false,
        reload: false,
        sprint: false,
      });
      await new Promise((resolve, reject) => {
        const deadline = Date.now() + 3000;
        const check = () => {
          if (client.state.player.x > startX + 0.05) return resolve();
          if (Date.now() > deadline) return reject(new Error('Adapter did not receive authoritative movement snapshot'));
          setTimeout(check, 20);
        };
        check();
      });

      const peer = makePeer(`ws://127.0.0.1:${address.port}/outlands`);
      peers.push(peer);
      await peer.opened;
      peer.send({ type: 'authenticate', token: 'other-adapter-player' });
      await peer.next((message) => message.type === 'welcome');
      await new Promise((resolve, reject) => {
        const deadline = Date.now() + 3000;
        const check = () => {
          if (client.state.remotePlayers?.some((remote) => remote.id === 'other-adapter-player')) return resolve();
          if (Date.now() > deadline) return reject(new Error('Adapter did not receive peer snapshot'));
          setTimeout(check, 20);
        };
        check();
      });
      expect(client.roomId).toBe('sector-07');
      expect(client.state.remotePlayers?.[0]).toMatchObject({
        id: 'other-adapter-player',
        nickname: 'Survivor other-adapter-p',
      });
    } finally {
      client?.destroy();
      for (const peer of peers) peer.socket.terminate();
      await service.close();
      if (previousWebSocket === undefined) delete globalThis.WebSocket;
      else globalThis.WebSocket = previousWebSocket;
    }
  });

  it('rejects bad tokens and resumes the same authoritative player during reconnect grace', async () => {
    const service = createOutlandsService({
      stateFile: null,
      port: 0,
      host: '127.0.0.1',
      resumeGraceMs: 500,
      verifyToken: async (token) => {
        if (token === 'bad-token-1234567890') throw new Error('invalid signature');
        return { sub: 'stable-cognito-sub', nickname: 'Verified Survivor' };
      },
      allowOrigin: () => true,
      rng: () => 0.5,
    });
    const address = await service.listen();
    const url = `ws://127.0.0.1:${address.port}/outlands`;
    const peers = [];
    try {
      const rejected = makePeer(url);
      peers.push(rejected);
      await rejected.opened;
      rejected.send({ type: 'authenticate', token: 'bad-token-1234567890' });
      await rejected.next((message) => message.type === 'error' && message.code === 'AUTH_REJECTED');
      await new Promise((resolve) => rejected.socket.once('close', resolve));
      expect(service.rooms.size).toBe(0);

      const first = makePeer(url);
      peers.push(first);
      await first.opened;
      first.send({ type: 'authenticate', token: 'good-token-1234567890' });
      const initial = await first.next((message) => message.type === 'welcome');
      expect(initial.nickname).toBe('Verified Survivor');
      const playerPosition = { x: initial.state.player.x, y: initial.state.player.y };
      first.socket.close(1000, 'simulate brief disconnect');
      await new Promise((resolve) => first.socket.once('close', resolve));

      const resumed = makePeer(url);
      peers.push(resumed);
      await resumed.opened;
      resumed.send({ type: 'authenticate', token: 'good-token-1234567890' });
      const resumedWelcome = await resumed.next((message) => message.type === 'welcome');
      expect(resumedWelcome.playerId).toBe(initial.playerId);
      expect(resumedWelcome.state.player.x).toBe(playerPosition.x);
      expect(resumedWelcome.state.player.y).toBe(playerPosition.y);
      expect(Object.keys(service.rooms.get(initial.roomId).state.players)).toEqual([initial.playerId]);
    } finally {
      for (const peer of peers) peer.socket.terminate();
      await service.close();
    }
  });

  it('authenticates into one shared sector, simulates input, and rejects joins when full', async () => {
    const service = createOutlandsService({
      stateFile: null,
      port: 0,
      host: '127.0.0.1',
      roomCapacity: 2,
      tickHz: 20,
      snapshotHz: 10,
      verifyToken: async (token) => ({ sub: token, name: `Operative ${token}` }),
      allowOrigin: () => true,
      rng: () => 0.5,
    });
    const address = await service.listen();
    const url = `ws://127.0.0.1:${address.port}/outlands`;
    const peers = [];
    try {
      const one = makePeer(url);
      peers.push(one);
      await one.opened;
      one.send({ type: 'authenticate', token: 'jwt-token-player-one-1234567890' });
      const welcomeOne = await one.next((message) => message.type === 'welcome');
      expect(welcomeOne.playerId).toBe('jwt-token-player-one-1234567890');

      const two = makePeer(url);
      peers.push(two);
      await two.opened;
      two.send({ type: 'authenticate', token: 'jwt-token-player-two-1234567890' });
      const welcomeTwo = await two.next((message) => message.type === 'welcome');
      expect(welcomeTwo.roomId).toBe(welcomeOne.roomId);
      const peerSnapshot = await one.next((message) => message.type === 'snapshot');
      expect(peerSnapshot.state.remotePlayers.map((player) => player.id)).toContain('jwt-token-player-two-1234567890');

      const initialX = welcomeOne.state.player.x;
      one.send({
        type: 'input',
        seq: 0,
        input: {
          move: { x: 1, y: 0 }, aim: { x: 1, y: 0 },
          firing: false, reload: false, sprint: false,
        },
      });
      const moved = await one.next((message) => message.type === 'snapshot' && message.state.player.x > initialX + 0.05);
      expect(moved.seq).toBeGreaterThan(0);

      const three = makePeer(url);
      peers.push(three);
      await three.opened;
      three.send({ type: 'authenticate', token: 'jwt-token-player-three-1234567890' });
      await three.next((message) => message.type === 'error' && message.code === 'SECTOR_FULL');
      await new Promise((resolve) => three.socket.once('close', resolve));
      expect(service.rooms.size).toBe(1);
    } finally {
      for (const peer of peers) peer.socket.terminate();
      await service.close();
    }
  });

  it('restores the same single world and offline character after a server restart', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'outlands-world-'));
    const stateFile = path.join(directory, 'sector.json');
    const options = {
      stateFile,
      host: '127.0.0.1',
      verifyToken: async () => ({ sub: 'persistent-player-id', nickname: 'Persistent Survivor' }),
      allowOrigin: () => true,
      rng: () => 0.5,
    };
    let service = createOutlandsService({ ...options, port: 0 });
    let peer;
    let savedPosition;
    try {
      const firstAddress = await service.listen();
      peer = makePeer(`ws://127.0.0.1:${firstAddress.port}/outlands`);
      await peer.opened;
      peer.send({ type: 'authenticate', token: 'persistent-player-token-1234567890', outpostId: 'pastor' });
      const welcome = await peer.next((message) => message.type === 'welcome');
      peer.send({
        type: 'input', seq: 0,
        input: { move: { x: 1, y: 0 }, aim: { x: 1, y: 0 }, firing: false, reload: false, sprint: false },
      });
      const moved = await peer.next((message) => message.type === 'snapshot' && message.state.player.x > welcome.state.player.x + 0.05);
      savedPosition = { x: moved.state.player.x, y: moved.state.player.y };
      peer.socket.terminate();
      await new Promise((resolve) => setTimeout(resolve, 30));
      await service.close();

      service = createOutlandsService({ ...options, port: 0 });
      const secondAddress = await service.listen();
      const resumed = makePeer(`ws://127.0.0.1:${secondAddress.port}/outlands`);
      peer = resumed;
      await resumed.opened;
      resumed.send({ type: 'authenticate', token: 'persistent-player-token-1234567890' });
      const restored = await resumed.next((message) => message.type === 'welcome');
      expect(restored.roomId).toBe('sector-07');
      expect(restored.state.player.x).toBe(savedPosition.x);
      expect(restored.state.player.y).toBe(savedPosition.y);
      expect(restored.state.player.activeOutpostId).toBe('pastor');
      expect(service.rooms.size).toBe(1);
    } finally {
      peer?.socket.terminate();
      await service.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects unauthenticated commands before they can join a room', async () => {
    const service = createOutlandsService({
      stateFile: null,
      port: 0,
      host: '127.0.0.1',
      verifyToken: async () => ({ sub: 'unused' }),
      allowOrigin: () => true,
    });
    const address = await service.listen();
    const peer = makePeer(`ws://127.0.0.1:${address.port}/outlands`);
    try {
      await peer.opened;
      peer.send({ type: 'ping', id: 1 });
      await peer.next((message) => message.type === 'error' && message.code === 'AUTH_REQUIRED');
      await new Promise((resolve) => peer.socket.once('close', resolve));
      expect(service.rooms.size).toBe(0);
    } finally {
      peer.socket.terminate();
      await service.close();
    }
  });
});
