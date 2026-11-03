/**
 * Square of Shadows — duel lobby wire contract.
 *
 * Types only: the shapes below are the contract between `lambdas/websocket/lobby.js`
 * and the Online Duel screen. Keeping them in one file means a change to the
 * server message is a compile error here rather than a `msg.foo` that silently
 * reads `undefined` at runtime.
 *
 * ## Why there is no in-memory LobbyManager
 *
 * The natural design — a long-lived process holding a `Map` of players and a
 * `setTimeout` per challenge — cannot work on this backend. Every Lambda is a
 * fresh short-lived container behind API Gateway WebSocket, so a `Map` would be
 * per-container and two players would see two different lobbies, and nothing is
 * alive at T+15s to fire an expiry. The server therefore keeps presence in
 * DynamoDB and enforces every deadline lazily, as an absolute timestamp checked
 * when the still-connected client next speaks. See `lobby.js` for the long
 * version; the observable behaviour is identical and it costs nothing to run.
 */

/** Where a player is in the duel lifecycle. */
export type PlayerStatus = 'IN_LOBBY' | 'PENDING_CHALLENGE' | 'IN_GAME' | 'DISCONNECTED';

/**
 * One row of the duel lobby.
 *
 * `DISCONNECTED` never actually reaches the client — a dropped socket deletes
 * the player's row, so they vanish from the roster rather than lingering as a
 * ghost. It stays in the union because the server assigns it internally.
 */
export interface LobbyPlayer {
  id: string;
  username: string;
  /**
   * Avatar as a 128px JPEG data URL, or null when the player never set one.
   *
   * Server-authoritative: `connect` reads it from the users table (falling back to
   * the Google `picture` claim) and `move` refuses to let a client overwrite it,
   * so a roster entry cannot be spoofed from the browser.
   */
  avatarImage: string | null;
  status: PlayerStatus;
  /** Server-computed so the client cannot offer a duel to a busy player. */
  challengeable: boolean;
  /**
   * Currently seated in a duel. This is the split the lobby renders on: the
   * "waiting for a duel" column and the "in a duel" column, so a busy player is
   * visible rather than hidden.
   */
  inGame: boolean;
  /**
   * False when their socket dropped. They stay on the roster (greyed out) so
   * "never here" and "here, then left" are distinguishable — filtering them out
   * made the roster silently shrink when somebody dropped.
   */
  connected: boolean;
}

/**
 * An open private room waiting for a second player.
 *
 * The host is deliberately not on the normal roster: creating a room means
 * "stop offering me random challenges". These rows are the replacement, so a
 * friend can still see and join the room with one click.
 */
export interface LobbyRoom {
  roomId: string;
  hostId: string;
  hostNickname: string;
  /** Epoch ms, used only for stable ordering. */
  createdAt: number;
}

/**
 * The caller's own room that is still holding a seat.
 *
 * Unlike `LobbyRoom` this is not broadcast: it is projected only into the
 * caller's `LOBBY_STATE`, which is how the "In a duel" row can show a real
 * rejoin countdown without exposing anybody's room code to the roster.
 */
export interface LobbyResume {
  roomId: string;
  phase: 'lobby' | 'playing';
  /** Epoch ms when the held seat is forfeited; null outside the grace window. */
  graceUntil: number | null;
}

/** An outstanding duel offer, with a 15 second answer window. */
export interface ChallengePayload {
  challengeId: string;
  fromPlayerId: string;
  fromNickname: string;
  toPlayerId: string;
  toNickname: string;
  /** Epoch ms. Compared as an absolute deadline, never a countdown timer. */
  expiresAt: number;
}

/** Why an outgoing challenge ended without a duel. */
export type ChallengeOutcome = 'declined' | 'expired' | 'unavailable';

/** A disconnect that is holding a seat open, not yet a forfeit. */
export interface GraceNotice {
  gameId: string;
  /** Who dropped. */
  playerId: string;
  nickname: string;
  remainingTimeSeconds: number;
  /** Local deadline so the countdown does not need another round trip. */
  graceUntil: number;
}

/**
 * Messages the client sends.
 *
 * The socket already carries the verified Cognito identity, so nothing here
 * names the sender — `lobby:challenge` only names the target, and the server
 * takes "who is this from" from the connection.
 */
export type ClientLobbyMessage =
  /** Open the duel lobby. Makes the player appear in everyone else's roster. */
  | { action: 'lobby:enter' }
  /**
   * Read the roster. Doubles as the poll that retires lapsed challenges, which
   * is why it is safe (and intended) to call this every few seconds while a
   * challenge prompt is open. `resumeRoomId` asks the server to include the
   * caller's still-held room so the lobby can show an accurate rejoin timer.
   */
  | { action: 'lobby:list'; resumeRoomId?: string | null }
  | { action: 'lobby:challenge'; targetPlayerId: string }
  | { action: 'lobby:respond'; challengeId: string; accept: boolean }
  | { action: 'lobby:leave' };

/**
 * Messages the server sends.
 *
 * `MATCH_START` is deliberately absent: the opening board arrives as the
 * existing `sos:state` message, which already carries the authoritative match
 * view (`room.state`). Emitting a second copy under a new name would be exactly
 * the client/server drift this codebase is built to avoid — two payloads
 * describing one board is two things that can disagree.
 */
export type ServerLobbyMessage =
  /** Full roster plus private rooms that are waiting for an opponent. */
  | {
      type: 'LOBBY_STATE';
      players: LobbyPlayer[];
      rooms?: LobbyRoom[];
      /** Present only on a direct `lobby:list` reply, never on a broadcast. */
      resume?: LobbyResume | null;
    }
  /** An incoming duel offer; render the prompt and start the countdown. */
  | { type: 'CHALLENGE_RECEIVED'; challenge: ChallengePayload }
  /**
   * Your own offer was accepted onto the roster, carrying the real id.
   *
   * The client shows "waiting…" before it knows the id, so without this echo a
   * decline could not be matched back to the offer that produced it.
   */
  | { type: 'CHALLENGE_SENT'; challenge: ChallengePayload }
  /** Your own outgoing challenge ended. Drives the gentle toast. */
  | { type: 'CHALLENGE_RESULT'; challengeId: string; outcome: ChallengeOutcome }
  /**
   * A lobby action was refused.
   *
   * A WebSocket handler's `{ statusCode }` goes to API Gateway and never reaches
   * the browser, so refusals are pushed explicitly — otherwise "that player is
   * busy" is indistinguishable from a button that does nothing.
   */
  | { type: 'LOBBY_ERROR'; message: string }
  /** Opponent dropped mid-match; their seat is held for 60 seconds. */
  | { type: 'PLAYER_DISCONNECTED_GRACE'; gameId: string; playerId: string; nickname: string; remainingTimeSeconds: number }
  /** Opponent came back inside the window; the duel resumes. */
  | { type: 'OPPONENT_RECONNECTED'; gameId: string; playerId: string }
  /**
   * The 60 second window closed and the duel was forfeited.
   *
   * `recordWin`/`recordLoss` say how the result counts: a dropout still wins the
   * duel it was winning, but does not take a ranked loss for a dropped socket
   * (PROJECT_DESIGN.md — no loss chasing).
   */
  | { type: 'GAME_OVER_FORFEIT'; gameId: string; winnerId: string | null; loserId: string; recordWin: boolean; recordLoss: boolean };

/** Seconds left on a challenge or grace window, floored at 0. */
export function secondsLeft(deadline: number | null | undefined, now = Date.now()): number {
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** Narrow an unknown socket message to a lobby message. */
export function isLobbyMessage(msg: unknown): msg is ServerLobbyMessage {
  const type = (msg as { type?: string } | null)?.type;
  return (
    type === 'LOBBY_STATE' ||
    type === 'CHALLENGE_RECEIVED' ||
    type === 'CHALLENGE_SENT' ||
    type === 'CHALLENGE_RESULT' ||
    type === 'LOBBY_ERROR' ||
    type === 'PLAYER_DISCONNECTED_GRACE' ||
    type === 'OPPONENT_RECONNECTED' ||
    type === 'GAME_OVER_FORFEIT'
  );
}
