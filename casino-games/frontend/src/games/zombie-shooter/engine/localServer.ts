import { createWorld } from './world';
import { stepWorld } from './simulation';
import type { GameEvent, InputState, SteppableGameServer, WorldState } from './types';

/**
 * Browser-side stand-in for the future authoritative game server.
 *
 * The component only knows this interface: step(input), read state, drain FX.
 * Swapping in a WebSocket adapter later should not touch the renderer or HUD.
 */
export class LocalGameServer implements SteppableGameServer {
  state: WorldState;

  constructor(seed?: number, stash = 0) {
    this.state = createWorld(seed, stash);
  }

  step(dt: number, input: InputState): WorldState {
    stepWorld(this.state, input, dt);
    return this.state;
  }

  reset(seed?: number, stash = this.state.player.stash): WorldState {
    this.state = createWorld(seed, stash);
    return this.state;
  }

  drainEvents(): GameEvent[] {
    const events = this.state.events;
    this.state.events = [];
    return events;
  }
}
