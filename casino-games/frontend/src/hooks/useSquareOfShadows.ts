import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AI_PLAYER_ID,
  MONSTER_TEAM_ID,
  aiSquadFor,
  chooseAiCommand,
  createInitialState,
  applyCommand,
  deserializeGameState,
  legalAttackTargetsFor,
  legalHealTargetsFor,
  legalMovesFor,
} from '../games/squareofshadows/engine';
import type {
  GameCommand,
  GameEvent,
  GameState,
  SerializedGameState,
} from '../games/squareofshadows/engine';
import { ENEMY_STEP_MS } from '../games/squareofshadows/enemyPacing';
import type {
  ChallengeOutcome,
  ChallengePayload,
  GraceNotice,
  LobbyPlayer,
  LobbyResume,
  LobbyRoom,
} from '../games/squareofshadows/lobby';
import { secondsLeft } from '../games/squareofshadows/lobby';

export type SosMode = 'menu' | 'ai' | 'hotseat' | 'online';

/**
 * Where an unfinished duel is remembered between visits.
 *
 * The server already re-admits a returning player to a live match — a seat that
 * was not walked away from and has no forfeit recorded against it is refreshed in
 * place, the grace flag is cleared, and the opponent is handed a full turn. All
 * that was missing was the client knowing *which* room to come back to, because
 * the only way in was a `?room=` query string, and a player who closed the tab
 * mid-match does not have that link any more.
 */
const RESUME_ROOM_KEY = 'c888_sos_room';

const readResumeRoom = (): string | null => {
  try {
    return localStorage.getItem(RESUME_ROOM_KEY);
  } catch {
    // Private mode / storage disabled. No memory, no resume card — nothing
    // breaks, the player re-enters by invite link exactly as before.
    return null;
  }
};

const writeResumeRoom = (roomId: string | null): void => {
  try {
    if (roomId) localStorage.setItem(RESUME_ROOM_KEY, roomId);
    else localStorage.removeItem(RESUME_ROOM_KEY);
  } catch {
    /* nothing to do; resume is a convenience, never a requirement */
  }
};

/** Why an outgoing challenge ended, for the toast wording. */
export type ChallengeToast = { outcome: ChallengeOutcome; fromNickname: string } | null;

/** Wire projection the server sends in a `sos:state` message. */
export interface SosRoomView {
  roomId: string;
  phase: 'lobby' | 'playing' | 'ended';
  hostId: string | null;
  winnerId: string | null;
  /** Epoch ms when the active player's turn expires; null when not playing. */
  turnDeadline: number | null;
  revision: number;
  /** Set only when the duel ended because somebody's connection dropped. */
  forfeit: { winnerId: string | null; loserId: string; recordWin: boolean; recordLoss: boolean } | null;
  seats: Array<{ playerId: string; nickname: string; slot: number; graceUntil: number | null }>;
  state: SerializedGameState | null;
}

type SendRaw = (payload: unknown) => void;
type Subscribe = (listener: (message: unknown) => void) => () => void;

interface UseSquareOfShadowsOptions {
  userId?: string | null;
  nickname?: string;
  /** Lobby socket transport, required for `online` mode. */
  sendRaw?: SendRaw;
  subscribe?: Subscribe;
  /** Invite code from `?room=`; auto-joins once the socket is live. */
  initialRoom?: string | null;
  /** True when the lobby socket is actually open. */
  isOnline?: boolean;
}

/**
 * Drives a Square of Shadows match.
 *
 * `ai` / `hotseat` run entirely on the client through the pure engine.
 * `online` sends commands out over the lobby WebSocket and renders only what
 * the server sends back — the same `applyCommand` engine runs inside the
 * Lambda, so the two paths can never disagree about the rules.
 */
export function useSquareOfShadows({
  userId,
  nickname,
  sendRaw,
  subscribe,
  initialRoom = null,
  isOnline = false,
}: UseSquareOfShadowsOptions) {
  const [mode, setMode] = useState<SosMode>('menu');
  const [room, setRoom] = useState<SosRoomView | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  /** Room id of an unfinished duel this browser can return to, if any. */
  const [resumeRoomId, setResumeRoomId] = useState<string | null>(readResumeRoom);
  const [state, setState] = useState<GameState | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);

  // ── duel lobby ───────────────────────────────────────────────────────────
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  /** Open private rooms, kept separate from the challenge roster. */
  const [lobbyRooms, setLobbyRooms] = useState<LobbyRoom[]>([]);
  /**
   * The caller's own still-held room, when `lobby:list` confirms one. Only a
   * direct list reply carries this; broadcasts intentionally do not, because it
   * is per-player.
   */
  const [lobbyResume, setLobbyResume] = useState<LobbyResume | null>(null);
  /** True once a direct `lobby:list` reply has answered the resume question. */
  const [lobbyResumeLoaded, setLobbyResumeLoaded] = useState(false);
  /** An offer addressed to me, with its 15s answer window. */
  const [incomingChallenge, setIncomingChallenge] = useState<ChallengePayload | null>(null);
  /** My own unanswered offer, so the UI can show "waiting for X". */
  const [outgoingChallenge, setOutgoingChallenge] = useState<ChallengePayload | null>(null);
  const [challengeToast, setChallengeToast] = useState<ChallengeToast>(null);
  const [graceNotice, setGraceNotice] = useState<GraceNotice | null>(null);

  /**
   * Mirrors of the two values the socket subscription has to compare against.
   * The subscription is registered once, so reading state directly in the
   * callback would capture a stale closure and match no message ever.
   */
  const outgoingRef = useRef<ChallengePayload | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const resumeRoomIdRef = useRef<string | null>(resumeRoomId);
  useEffect(() => {
    outgoingRef.current = outgoingChallenge;
  }, [outgoingChallenge]);
  useEffect(() => {
    roomIdRef.current = room?.roomId ?? null;
  }, [room]);
  useEffect(() => {
    resumeRoomIdRef.current = resumeRoomId;
  }, [resumeRoomId]);

  const humanId = userId || 'P1';
  const playerLabels = useMemo<Record<string, string>>(
    () => ({
      [humanId]: nickname || 'Player 1',
      [AI_PLAYER_ID]: 'AI',
      [MONSTER_TEAM_ID]: 'The monsters',
      P2: 'Player 2',
    }),
    [humanId, nickname],
  );

  const startGame = useCallback(
    (kind: 'ai' | 'hotseat') => {
      const opponentId = kind === 'ai' ? AI_PLAYER_ID : 'P2';
      const next = createInitialState({
        gameId: `local-${Date.now()}`,
        // AI and hotseat matches are built here rather than by `buildMatch`, so
        // this is where the floor seed has to be drawn. Without it every local
        // match fell back to seed 0 and played the same board forever — online
        // duels varied because the server seeds those, which made it look like
        // generation worked while it silently did nothing locally.
        //
        // `Math.random` is the right source here: this match never leaves the
        // tab, so there is nothing to be authoritative about and no wire to
        // agree on. `gameId` already uses `Date.now()` on the same idea.
        mapSeed: Math.floor(Math.random() * 2 ** 31),
        playerIds: [humanId, opponentId],
      });
      setMode(kind);
      setSelectedUnitId(null);
      setError(null);
      setEvents([]);
      setRoom(null);
      setRoomError(null);
      setLobbyPlayers([]);
      setLobbyRooms([]);
      setLobbyResume(null);
      setLobbyResumeLoaded(false);
      setIncomingChallenge(null);
      setOutgoingChallenge(null);
      setChallengeToast(null);
      setGraceNotice(null);
      setState(next);
    },
    [humanId],
  );

  const backToMenu = useCallback(() => {
    setMode('menu');
    setState(null);
    setRoom(null);
    setSelectedUnitId(null);
    setError(null);
    setRoomError(null);
    setEvents([]);
    setGraceNotice(null);
    setLobbyPlayers([]);
    setLobbyRooms([]);
    setIncomingChallenge(null);
    setOutgoingChallenge(null);
    setChallengeToast(null);
    outgoingRef.current = null;
    roomIdRef.current = null;
    pendingRef.current = null;
  }, []);

  // ── online transport ─────────────────────────────────────────────────────
  /**
   * The socket is often still opening when the player clicks "Host a Duel" or
   * lands on an invite link, and `sendRaw` silently drops anything sent before
   * the connection is up. So the newest action is held and flushed the moment
   * the socket opens, instead of vanishing.
   */
  const pendingRef = useRef<unknown>(null);
  const sendOrQueue = useCallback(
    (payload: unknown) => {
      if (!sendRaw) return;
      if (!isOnline) {
        pendingRef.current = payload;
        return;
      }
      pendingRef.current = null;
      sendRaw(payload);
    },
    [sendRaw, isOnline],
  );

  useEffect(() => {
    if (!isOnline || !sendRaw) return;
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    sendRaw(pending);
  }, [isOnline, sendRaw]);

  // The server owns the match; each `sos:state` replaces local state wholesale
  // so a desynced client can never drift from the authoritative board. The same
  // subscription carries the lobby messages, since they share one socket.
  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((raw) => {
      const msg = raw as {
        type?: string;
        message?: string;
        room?: SosRoomView;
        events?: GameEvent[];
        players?: LobbyPlayer[];
        rooms?: LobbyRoom[];
        resume?: LobbyResume | null;
        challenge?: ChallengePayload;
        challengeId?: string;
        outcome?: ChallengeOutcome;
        gameId?: string;
        playerId?: string;
        nickname?: string;
        remainingTimeSeconds?: number;
      };
      if (msg.type === 'sos:error') {
        setRoomError(msg.message ?? 'The lobby rejected that action.');
        // A rejected rejoin means the room we remembered is gone or already
        // settled. Keeping it would put a "Return to your duel" card on the title
        // screen that could only ever fail.
        if (resumeRoomId && !room) {
          writeResumeRoom(null);
          setResumeRoomId(null);
          setLobbyResume(null);
          setLobbyResumeLoaded(false);
        }
        return;
      }

      if (msg.type === 'LOBBY_STATE') {
        setLobbyPlayers(msg.players ?? []);
        setLobbyRooms(msg.rooms ?? []);
        // Broadcasts omit `resume`; only a direct list reply may clear or replace
        // it. Treating an absent key as null would make the rejoin row flicker
        // every time somebody else challenged a player.
        if (Object.prototype.hasOwnProperty.call(msg, 'resume')) {
          const next = msg.resume ?? null;
          setLobbyResume(next);
          setLobbyResumeLoaded(true);
          // A definite "no held seat" is the server telling us the remembered
          // room is gone, forfeited, or expired. Drop the title-screen card too
          // so it cannot keep offering a rejoin that can only fail. A failed
          // lookup omits the key instead of sending null, so this never clears
          // on a transient DynamoDB error.
          if (!next && resumeRoomIdRef.current) {
            writeResumeRoom(null);
            setResumeRoomId(null);
          }
        }
        return;
      }
      if (msg.type === 'LOBBY_ERROR') {
        // A refused challenge would otherwise be silent: the roster says the
        // target is busy, the click does nothing, and the player is left
        // pressing a dead button. Drop the optimistic "waiting…" banner too,
        // or it outlives a challenge that never existed.
        setRoomError(msg.message ?? 'That did not go through.');
        setOutgoingChallenge(null);
        return;
      }
      if (msg.type === 'CHALLENGE_RECEIVED' && msg.challenge) {
        setIncomingChallenge(msg.challenge);
        return;
      }
      if (msg.type === 'CHALLENGE_SENT' && msg.challenge) {
        // Replace the provisional offer with the real one, id included.
        setOutgoingChallenge(msg.challenge);
        return;
      }
      if (msg.type === 'CHALLENGE_RESULT' && msg.challengeId) {
        // Either side can be told about a lapse; drop whichever prompt matches.
        setOutgoingChallenge((current) =>
          current && current.challengeId === msg.challengeId ? null : current,
        );
        setIncomingChallenge((current) =>
          current && current.challengeId === msg.challengeId ? null : current,
        );
        const loser = msg.challengeId === outgoingRef.current?.challengeId;
        if (loser && msg.outcome) {
          setChallengeToast({
            outcome: msg.outcome,
            fromNickname: outgoingRef.current?.toNickname ?? 'Your opponent',
          });
        }
        return;
      }
      if (msg.type === 'PLAYER_DISCONNECTED_GRACE' && msg.gameId === roomIdRef.current) {
        // The server sends the remaining seconds once; the local deadline keeps
        // the countdown smooth without waiting for another round trip.
        setGraceNotice({
          gameId: msg.gameId,
          playerId: msg.playerId ?? '',
          nickname: msg.nickname ?? 'Your opponent',
          remainingTimeSeconds: msg.remainingTimeSeconds ?? 0,
          graceUntil: Date.now() + (msg.remainingTimeSeconds ?? 0) * 1000,
        });
        return;
      }
      if (msg.type === 'OPPONENT_RECONNECTED' && msg.gameId === roomIdRef.current) {
        setGraceNotice(null);
        return;
      }
      if (msg.type === 'GAME_OVER_FORFEIT' && msg.gameId === roomIdRef.current) {
        setGraceNotice(null);
        return;
      }

      if (msg.type !== 'sos:state' || !msg.room) return;
      const next = msg.room;
      setRoom(next);
      setRoomError(null);
      setState(next.state ? deserializeGameState(next.state) : null);
      // The server ships the event batch with the state it belongs to (and only
      // on the command path), so the animation for a move plays off the same
      // board it was computed against. Tick messages carry no events, which is
      // what stops the countdown from replaying the fight every second.
      if (msg.events) setEvents(msg.events as GameEvent[]);
      if (next.phase === 'playing' || next.phase === 'ended') setMode('online');
    });
  }, [subscribe]);

  /** Open a fresh lobby and take the first seat; the server replies with a code. */
  const hostOnline = useCallback(() => {
    if (!userId) return;
    setRoomError(null);
    setMode('online');
    sendOrQueue({ action: 'sos:create' });
  }, [sendOrQueue, userId]);

  /** Join an existing lobby by invite code. */
  const joinOnline = useCallback(
    (code: string) => {
      if (!userId) return;
      setRoomError(null);
      setMode('online');
      sendOrQueue({ action: 'sos:join', gameId: code });
    },
    [sendOrQueue, userId],
  );

  /**
   * Come back to the duel this browser was last in.
   *
   * Optimistic about the id rather than clearing it up front: if the room is
   * still live the server sends `sos:state`, the card disappears because we are
   * no longer at the menu, and the id stays put for the NEXT accidental close. If
   * the room is gone or already settled the server answers `sos:error`, and the
   * handler below drops the memory so a dead room is never offered twice.
   */
  const resumeOnline = useCallback(() => {
    if (!userId || !resumeRoomId) return;
    setRoomError(null);
    setMode('online');
    sendOrQueue({ action: 'sos:join', gameId: resumeRoomId });
  }, [resumeRoomId, sendOrQueue, userId]);

  /**
   * Remember a live room, and forget one that is finished or abandoned.
   *
   * Driven off the room id rather than the whole view so a turn-clock update does
   * not re-run it, and keyed on the phase too because a duel that has been
   * decided must not keep offering itself on the title screen forever.
   */
  useEffect(() => {
    if (room?.phase === 'ended') {
      writeResumeRoom(null);
      setResumeRoomId(null);
      return;
    }
    if (!room?.roomId) return;
    writeResumeRoom(room.roomId);
    setResumeRoomId(room.roomId);
  }, [room?.roomId, room?.phase]);

  const leaveOnline = useCallback(() => {
    if (sendRaw && room) sendRaw({ action: 'sos:leave', gameId: room.roomId });
    /*
     * A live duel holds the seat for the grace window (the server makes that
     * call; a draft or an opponent who is already gone still ends the room), so
     * the browser has to keep the room id or the lobby and the title screen
     * would have nothing to offer a rejoin with. Finished and pre-match rooms
     * are still forgotten here — and if the server disagrees with the guess, its
     * next LOBBY_STATE says so and the id is dropped then.
     */
    const seatHeld = room?.phase === 'playing' && room.state?.phase !== 'deployment';
    if (!seatHeld) {
      writeResumeRoom(null);
      setResumeRoomId(null);
    }
    setMode('menu');
    setState(null);
    setRoom(null);
    setSelectedUnitId(null);
    setError(null);
    setRoomError(null);
    setEvents([]);
    setGraceNotice(null);
    setLobbyPlayers([]);
    setLobbyRooms([]);
    setLobbyResume(null);
    setLobbyResumeLoaded(false);
    setIncomingChallenge(null);
    setOutgoingChallenge(null);
    setChallengeToast(null);
    outgoingRef.current = null;
    roomIdRef.current = null;
    pendingRef.current = null;
  }, [sendRaw, room]);

  // ── duel lobby actions ───────────────────────────────────────────────────
  /** Register in the duel lobby and ask for a roster. */
  const enterLobby = useCallback(() => {
    // A new lobby visit has to ask the server about the held seat again; the
    // previous answer may describe a room that has since been forfeited.
    setLobbyResumeLoaded(false);
    sendOrQueue({ action: 'lobby:enter' });
  }, [sendOrQueue]);

  const leaveLobby = useCallback(() => {
    if (sendRaw) sendRaw({ action: 'lobby:leave' });
  }, [sendRaw]);

  /**
   * Pull a fresh roster snapshot.
   *
   * The server sends one back only to the caller, so this is cheap enough to run
   * while the lobby is open. That is what makes a friend's newly created private
   * room appear without needing a broadcast hook inside `sos.js`, and what
   * retires a room after its host closes the tab.
   */
  const refreshLobby = useCallback(() => {
    if (sendRaw && isOnline) {
      sendRaw({ action: 'lobby:list', resumeRoomId });
    }
  }, [sendRaw, isOnline, resumeRoomId]);

  /**
   * Offer a duel. The server re-checks availability — the roster on screen was
   * rendered seconds ago and the target may have walked into a match since.
   */
  const sendChallenge = useCallback(
    (target: LobbyPlayer) => {
      if (!target.challengeable) return;
      setChallengeToast(null);
      setOutgoingChallenge({
        challengeId: '',
        fromPlayerId: humanId,
        fromNickname: nickname || 'Player',
        toPlayerId: target.id,
        toNickname: target.username,
        // Provisional: replaced by the real id when the offer is answered.
        expiresAt: Date.now() + 15_000,
      });
      sendOrQueue({ action: 'lobby:challenge', targetPlayerId: target.id });
    },
    [humanId, nickname, sendOrQueue],
  );

  const respondChallenge = useCallback(
    (challengeId: string, accept: boolean) => {
      setIncomingChallenge(null);
      if (!accept) {
        sendOrQueue({ action: 'lobby:respond', challengeId, accept: false });
        return;
      }
      setMode('online');
      sendOrQueue({ action: 'lobby:respond', challengeId, accept: true });
    },
    [sendOrQueue],
  );

  const clearChallengeToast = useCallback(() => setChallengeToast(null), []);

  /**
   * While an offer is open, poll the roster every few seconds.
   *
   * This is what retires a lapsed challenge: there is no timer on the server, so
   * the deadline is checked whenever a client next speaks, and this guarantees
   * somebody does. The answer window is short, so a 3s poll is well inside it.
   */
  const challengePending = !!incomingChallenge || !!outgoingChallenge;
  useEffect(() => {
    if (!challengePending || !sendRaw || !isOnline) return undefined;
    const timer = setInterval(() => {
      sendRaw({ action: 'lobby:list', resumeRoomId });
    }, 3000);
    return () => clearInterval(timer);
  }, [challengePending, sendRaw, isOnline, resumeRoomId]);

  // A provisional offer has no server id yet. Do NOT clear it from the roster:
  // the roster snapshot on screen predates the click, so it still says
  // IN_LOBBY and would erase the just-clicked "waiting" banner before the
  // server's CHALLENGE_SENT arrives. That race made the banner blink open and
  // closed. Give the round trip a generous fallback, and otherwise let
  // CHALLENGE_SENT / LOBBY_ERROR / CHALLENGE_RESULT settle it.
  useEffect(() => {
    if (!outgoingChallenge || outgoingChallenge.challengeId) return undefined;
    const provisional = outgoingChallenge;
    const timer = setTimeout(() => {
      setOutgoingChallenge((current) => (current === provisional ? null : current));
    }, 8_000);
    return () => clearTimeout(timer);
  }, [outgoingChallenge]);

  /**
   * Drives every countdown on this screen from one interval, so the challenge
   * prompt and the grace banner stay in step instead of each running their own.
   */
  const [now, setNow] = useState(() => Date.now());
  const countdownRunning = !!incomingChallenge || !!graceNotice || !!lobbyResume?.graceUntil;
  useEffect(() => {
    if (!countdownRunning) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [countdownRunning]);

  /** Seconds left on the open prompt, for the countdown the user sees. */
  const challengeSecondsLeft = incomingChallenge ? secondsLeft(incomingChallenge.expiresAt, now) : 0;
  const graceSecondsLeft = graceNotice ? secondsLeft(graceNotice.graceUntil, now) : 0;
  /** Seconds left to walk back into the caller's held seat, or 0. */
  const rejoinSecondsLeft = lobbyResume?.graceUntil ? secondsLeft(lobbyResume.graceUntil, now) : 0;

  // An invite link carries `?room=`; join it once, as soon as we can send.
  const joinedInviteRef = useRef(false);
  useEffect(() => {
    if (joinedInviteRef.current) return;
    if (!initialRoom || !sendRaw || !isOnline) return;
    joinedInviteRef.current = true;
    joinOnline(initialRoom);
  }, [initialRoom, sendRaw, isOnline, joinOnline]);

  /** Online seats are named by the server; offline modes use fixed labels. */
  const onlineLabels = useMemo(() => {
    const map: Record<string, string> = { [humanId]: nickname || 'Player 1' };
    for (const seat of room?.seats ?? []) map[seat.playerId] = seat.nickname;
    return map;
  }, [humanId, nickname, room]);

  const labels = mode === 'online' ? onlineLabels : playerLabels;

  /**
   * Apply a command. Offline modes resolve locally; online sends the command
   * to the server and waits for the authoritative `sos:state` that follows.
   * Either way the shared engine decides what is legal.
   */
  const dispatch = useCallback(
    (command: GameCommand): boolean => {
      if (!state) return false;
      if (mode === 'online') {
        if (!sendRaw || !room) return false;
        sendOrQueue({ action: 'sos:command', gameId: room.roomId, command });
        setError(null);
        return true;
      }
      const result = applyCommand(state, state.activePlayerId, command);
      if (!result.ok || !result.state) {
        setError(result.error ?? 'That action is not allowed.');
        return false;
      }
      setError(null);
      setEvents(result.events ?? []);
      setState(result.state);
      return true;
    },
    [state, mode, sendRaw, room, sendOrQueue],
  );

  /**
   * The non-human seat this client is responsible for moving, if any.
   *
   * One: `AI`, the solo opponent. It plays through `chooseAiCommand` and is
   * driven by one effect below.
   *
   * Adventure's monsters are NOT here. They hold no turn, so they are never the
   * active seat; they act inside `END_TURN`, which runs in the shared engine and
   * therefore identically for the optimistic client and the authoritative
   * server. Nothing about them is client-driven, which is also why a client
   * cannot forge a monster move in an online room.
   */
  const autoSeatId =
    mode === 'online'
      ? null
      : mode === 'ai' && state?.activePlayerId === AI_PLAYER_ID
        ? AI_PLAYER_ID
        : null;

  // The AI is the automatic second drafter in solo mode. With two factions,
  // it receives the only faction left after the human chooses. (Monsters never
  // draft — Adventure puts them in the turn order without a faction slot.)
  useEffect(() => {
    if (mode !== 'ai' || !state || state.phase !== 'deployment') return undefined;
    if (state.activePlayerId !== AI_PLAYER_ID) return undefined;
    const available = (['INQUISITORS', 'PENITENT_COURT'] as const).filter(
      (faction) => !Object.values(state.factions).includes(faction),
    );
    if (!available.length) return undefined;
    const timer = setTimeout(() => {
      dispatch({ type: 'CHOOSE_FACTION', faction: available[0], squad: aiSquadFor(state.mapSeed ?? 0) });
    }, 300);
    return () => clearTimeout(timer);
  }, [mode, state, dispatch]);

  /**
   * Freshest committed state, readable from inside a timeout.
   *
   * The AI's turn resolves in a `setTimeout`, where a functional `setState`
   * updater would be the only way to see the latest state — but publishing the
   * resulting events needs a *separate* `setEvents`, and you cannot safely call
   * one state setter from inside another. The ref gives the same freshness
   * without that trap.
   */
  const stateRef = useRef<GameState | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Auto-play a computer seat's turn whenever it becomes the active player.
  useEffect(() => {
    if (!autoSeatId || !state) return undefined;
    if (state.phase !== 'playing' || state.activePlayerId !== autoSeatId) {
      return undefined;
    }
    // One decision per step, so the player can follow a walk and the swing it
    // sets up before the next unit moves. `ENEMY_STEP_MS` is the shared pace.
    const timer = setTimeout(() => {
      const current = stateRef.current;
      if (
        !current ||
        current.phase !== 'playing' ||
        current.activePlayerId !== autoSeatId
      ) {
        return;
      }
      let result = applyCommand(current, autoSeatId, chooseAiCommand(current, autoSeatId));
      if (!result.ok || !result.state) {
        // Fallback so the AI can never soft-lock the match.
        result = applyCommand(current, autoSeatId, { type: 'END_TURN' });
      }
      if (!result.state) return;
      // Every animation and sound in the UI is driven by the event batch, so the
      // AI has to publish it exactly like `dispatch` does. Omitting this is why
      // the AI attacked in silence: the board advanced, nothing played.
      setEvents(result.events ?? []);
      setState(result.state);
    }, ENEMY_STEP_MS);
    return () => clearTimeout(timer);
  }, [autoSeatId, state]);

  const selectedUnit = selectedUnitId
    ? state?.units.get(selectedUnitId) ?? null
    : null;

  const legalMoves = useMemo(
    () => (state && selectedUnitId ? legalMovesFor(state, selectedUnitId) : []),
    [state, selectedUnitId],
  );
  const legalAttackTargets = useMemo(
    () =>
      state && selectedUnitId
        ? legalAttackTargetsFor(state, selectedUnitId)
        : [],
    [state, selectedUnitId],
  );
  const legalHealTargets = useMemo(
    () =>
      state && selectedUnitId
        ? legalHealTargetsFor(state, selectedUnitId)
        : [],
    [state, selectedUnitId],
  );

  // Only the solo opponent is an AI turn now. The monsters act inside `END_TURN`,
// so the active seat is always a real player and there is no third case.
const isAiTurn = mode === 'ai' && state?.activePlayerId === AI_PLAYER_ID;
  const activePlayerIsHuman = !!state && state.activePlayerId === humanId;

  // Clean up all state on unmount to prevent stale data from leaking into
  // the next game session.
  useEffect(() => {
    return () => {
      setMode('menu');
      setState(null);
      setRoom(null);
      setSelectedUnitId(null);
      setError(null);
      setRoomError(null);
      setEvents([]);
      setGraceNotice(null);
      setLobbyPlayers([]);
      setLobbyRooms([]);
      setLobbyResume(null);
      setLobbyResumeLoaded(false);
      setIncomingChallenge(null);
      setOutgoingChallenge(null);
      setChallengeToast(null);
      outgoingRef.current = null;
      roomIdRef.current = null;
      pendingRef.current = null;
    };
  }, []);

  return {
    mode,
    state,
    events,
    error,
    clearError: () => setError(null),
    room,
    roomError,
    clearRoomError: () => setRoomError(null),
    canPlayOnline: !!userId && !!sendRaw,
    hostOnline,
    joinOnline,
    resumeOnline,
    /** A duel this browser can rejoin, or null. Drives the title screen's resume card. */
    resumeRoomId,
    leaveOnline,
    lobbyPlayers,
    lobbyRooms,
    lobbyResume,
    lobbyResumeLoaded,
    rejoinSecondsLeft,
    enterLobby,
    leaveLobby,
    refreshLobby,
    sendChallenge,
    incomingChallenge,
    outgoingChallenge,
    challengeSecondsLeft,
    respondChallenge,
    challengeToast,
    clearChallengeToast,
    graceNotice,
    graceSecondsLeft,
    turnDeadline: room?.turnDeadline ?? null,
    selectedUnitId,
    selectedUnit,
    selectUnit: setSelectedUnitId,
    legalMoves,
    legalAttackTargets,
    legalHealTargets,
    dispatch,
    startGame,
    backToMenu,
    humanId,
    playerLabels: labels,
    isAiTurn,
    activePlayerIsHuman,
  };
}
