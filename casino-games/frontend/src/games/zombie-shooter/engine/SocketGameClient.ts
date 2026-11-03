import { createWorld } from './world';
import type { GameEvent, InputState, SteppableGameServer, WorldState } from './types';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface SocketEnvelope {
  type?: string;
  code?: string;
  seq?: number;
  state?: WorldState;
  token?: string;
  outpostId?: 'nastya' | 'pastor' | 'secronom' | 'sector09';
  playerId?: string;
  roomId?: string;
}

/** Client adapter for the dedicated authoritative Outlands room service. */
export class SocketGameClient implements SteppableGameServer {
  static connect(
    url: string,
    token: string,
    outpostId: SocketEnvelope['outpostId'] = 'nastya',
    timeoutMs = 10_000,
  ): Promise<SocketGameClient> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const client = new SocketGameClient(url, token, outpostId, (status, detail) => {
        if (settled) return;
        if (status === 'connected') {
          settled = true;
          clearTimeout(timer);
          resolve(client);
          return;
        }
        if (status === 'error') {
          settled = true;
          clearTimeout(timer);
          client.destroy();
          reject(new Error(detail ?? 'CONNECT_FAILED'));
        }
      });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.destroy();
        reject(new Error('CONNECT_TIMEOUT'));
      }, timeoutMs);
    });
  }
  state: WorldState;
  playerId: string | null = null;
  roomId: string | null = null;
  private readonly socket: WebSocket;
  private readonly onStatus: (status: SocketStatus, detail?: string) => void;
  private inputAccumulator = 0;
  private sequence = 0;
  private latestInput: InputState = {
    move: { x: 0, y: 0 },
    aim: { x: 1, y: 0 },
    firing: false,
    reload: false,
    sprint: false,
  };
  private lastSnapshotSequence = -1;
  private pendingEvents: GameEvent[] = [];
  private destroyed = false;

  constructor(
    url: string,
    token: string,
    outpostId: SocketEnvelope['outpostId'] = 'nastya',
    onStatus: (status: SocketStatus, detail?: string) => void = () => undefined,
  ) {
    this.state = createWorld();
    this.onStatus = onStatus;
    this.socket = new WebSocket(url);
    this.onStatus('connecting');

    this.socket.addEventListener('open', () => {
      if (!token) {
        this.onStatus('error', 'No Cognito token is available.');
        this.socket.close(4001, 'Authentication token missing');
        return;
      }
      this.send({ type: 'authenticate', token, outpostId });
    });
    this.socket.addEventListener('message', (event) => this.handleMessage(event.data));
    this.socket.addEventListener('close', (event) => {
      if (this.destroyed) return;
      if (!this.playerId) {
        const reason = event.reason || '';
        if (event.code === 4003 || reason.toLowerCase().includes('full')) {
          this.onStatus('error', 'SECTOR_FULL');
          return;
        }
        this.onStatus('error', 'AUTH_REJECTED');
        return;
      }
      this.onStatus('disconnected', event.reason || 'Connection closed.');
    });
    this.socket.addEventListener('error', () => {
      if (!this.destroyed) this.onStatus('error', 'Unable to reach the Outlands server.');
    });
  }

  step(dt: number, input: InputState): WorldState {
    this.latestInput = input;
    if (!this.playerId || this.socket.readyState !== WebSocket.OPEN) return this.state;
    this.inputAccumulator += Math.max(0, dt);
    if (this.inputAccumulator >= 1 / 20) {
      this.inputAccumulator %= 1 / 20;
      this.send({ type: 'input', seq: this.sequence++, input: this.latestInput });
    }
    return this.state;
  }

  reset(_seed?: number, _stash?: number): WorldState {
    this.send({ type: 'redeploy' });
    return this.state;
  }

  drainEvents(): GameEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close(1000, 'Leaving Outlands');
    }
  }

  private send(payload: object): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private handleMessage(data: unknown): void {
    let message: SocketEnvelope;
    try {
      message = JSON.parse(String(data)) as SocketEnvelope;
    } catch {
      this.onStatus('error', 'The server sent an unreadable message.');
      return;
    }

    if (message.type === 'welcome' && message.state) {
      this.playerId = message.playerId ?? null;
      this.roomId = message.roomId ?? null;
      this.state = message.state;
      this.lastSnapshotSequence = -1;
      this.onStatus('connected', this.roomId ?? undefined);
      return;
    }
    if (message.type === 'snapshot' && message.state) {
      if (typeof message.seq === 'number' && message.seq <= this.lastSnapshotSequence) return;
      if (typeof message.seq === 'number') this.lastSnapshotSequence = message.seq;
      this.state = message.state;
      this.pendingEvents.push(...(message.state.events ?? []));
      return;
    }
    if (message.type === 'error') {
      this.onStatus('error', message.code ?? 'Server rejected a command.');
    }
  }
}
