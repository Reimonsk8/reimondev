/**
 * Square of Shadows — server-authoritative online rooms.
 *
 * Mirrors the multiplayer blackjack room module (`./blackjack.js`): a DynamoDB
 * item per invite code holding the authoritative match state, written with an
 * optimistic-lock `revision` so two simultaneous commands cannot interleave.
 *
 * Rules authority is the *frontend* engine, imported directly:
 *   frontend/src/games/squareofshadows/engine
 * CDK bundles each Lambda with esbuild (`bundling: { externalModules: [] }`), so
 * the TypeScript engine is transpiled and inlined into this bundle at synth
 * time. That is deliberate — client and server must never drift, and a second
 * JS copy of the rules would guarantee drift.
 *
 * Identity is never taken from the client: the seat's playerId always comes
 * from the verified Cognito token via the connections/players tables.
 */
const realDeps = require('./utils');

/**
 * Transport is resolved through a seam rather than destructured at load time.
 *
 * Destructuring (`const { docClient, send, getPlayer } = require('./utils')`)
 * captures those functions permanently, so a test can never substitute them —
 * and vitest's `vi.mock` cannot reach a CJS `require` from an ESM test anyway.
 * That is precisely why the persistence bug fixed in `saveRoom` below shipped
 * with a fully green suite: the only tests stubbed `docClient.put` with a no-op
 * that accepted any arguments, so the real request shape was never exercised.
 *
 * Routing every call through `deps()` lets `__setTransport` install a fake that
 * validates like DynamoDB does, which is what finally catches the bug.
 */
let injectedTransport = null;

const deps = () => injectedTransport || realDeps;

const send = (...args) => deps().send(...args);
const getPlayer = (...args) => deps().getPlayer(...args);
const docClient = {
  get: (...args) => deps().docClient.get(...args),
  put: (...args) => deps().docClient.put(...args),
  update: (...args) => deps().docClient.update(...args),
  delete: (...args) => deps().docClient.delete(...args),
};

/** Test seam: install a fake transport. Pass null to restore the real one. */
const __setTransport = (transport) => {
  injectedTransport = transport;
};

/**
 * Shared identity helper, pointed at this module's seam-aware `getPlayer` so a
 * stubbed transport is honoured here too instead of the real players table.
 */
const identityOf = async (connectionId) => realDeps.identityOf(connectionId, getPlayer);

/**
 * The rules authority is the *frontend* engine, imported directly:
 *   frontend/src/games/squareofshadows/engine
 *
 * CDK bundles this Lambda with esbuild (`bundling: { externalModules: [] }`), so
 * the TypeScript is transpiled and inlined at synth time. Plain Node cannot
 * `require()` a `.ts` file, so the module is resolved lazily and tests inject it
 * through `__setEngine` instead of relying on the bundler.
 *
 * Sharing one engine is deliberate — a second JS copy of the rules in the
 * Lambda would guarantee client/server drift.
 */
const ENGINE_PATH = '../../frontend/src/games/squareofshadows/engine/index.ts';

let engineModule = null;

/**
 * Resolve the shared engine on first use.
 *
 * The `require` argument MUST stay a string literal: esbuild only inlines a
 * require whose specifier it can see, so routing it through a variable makes it
 * survive into the bundle as a runtime `require` of a `.ts` file, which Node
 * cannot load. Keeping the literal here is what actually ships the engine.
 * The call stays inside the function so tests can inject first.
 */
const engine = () => {
  if (!engineModule) {
    engineModule = require('../../frontend/src/games/squareofshadows/engine/index.ts');
  }
  return engineModule;
};

/** Test seam: inject an already-resolved engine module. */
const __setEngine = (mod) => {
  engineModule = mod;
};

/** Two seats per room — it is a duel. */
const MAX_SEATS = 2;

/** Inactivity budget for a single turn. Expiry skips the player's turn. */
const TURN_MS = 180_000;

/**
 * How long a dropped opponent's seat is held before the duel is forfeited.
 *
 * Absolute timestamps, never a `setTimeout`: nothing runs between client
 * messages, so the clock lives on the room item and is checked lazily by
 * `enforceGraceDeadline` whenever the player who *is* still connected next acts
 * or ticks. Same trick as `turnDeadline`.
 */
const GRACE_MS = 60_000;

/** Abandoned rooms are reaped by the table's TTL attribute. */
const ROOM_TTL_SECONDS = 60 * 60 * 24;

/** Writes are optimistic-locked; retry a few times under genuine contention. */
const MAX_WRITE_ATTEMPTS = 4;

const ROOMS = () => process.env.SOS_ROOMS_TABLE_NAME;
const CONNECTIONS = () => process.env.CONNECTIONS_TABLE_NAME;

// Room codes are read aloud and retyped, so keep them short and unambiguous.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

const makeRoomCode = () => {
  const bytes = require('crypto').randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
};

const nowMs = () => Date.now();
const ttlAt = (seconds) => Math.floor(nowMs() / 1000) + seconds;
const secureGameRng = () => require('crypto').randomInt(1_000_000) / 1_000_000;

/** A room with nobody in it yet. */
const freshRoom = (roomId) => ({
  roomId,
  phase: 'lobby',
  hostId: null,
  seats: [],
  state: null,
  revision: 0,
  turnDeadline: null,
  /** Set when a duel ended by forfeit, so the UI can say why. */
  forfeit: null,
  winnerId: null,
  createdAt: nowMs(),
  updatedAt: nowMs(),
  ttl: ttlAt(ROOM_TTL_SECONDS),
});

const loadRoom = async (roomId) => {
  const res = await docClient.get({ TableName: ROOMS(), Key: { roomId } });
  return res.Item || null;
};

/**
 * Build the conditional-put parameters for a room write.
 *
 * Pure so it can be asserted directly — this exact shape was wrong in
 * production and no test could see it, because the previous suite stubbed
 * `docClient.put` with a no-op that accepted any arguments, and real DynamoDB
 * rejects a request whose `ExpressionAttributeValues` are not referenced by the
 * condition.
 *
 * Two separate defects lived here:
 *
 *  1. The create path (`attribute_not_exists(#revision)`) still sent
 *     `:expected`, so *every* `sos:create` failed with
 *     `ValidationException: Value provided in ExpressionAttributeValues unused`.
 *     The rooms table stayed permanently empty.
 *
 *  2. "Does not exist yet" was encoded as `expected === 0`. But a room that is
 *     sitting in the lobby legitimately has `revision: 0`, so the guest's join
 *     took the create branch and its condition always failed against the
 *     existing row. `expected` is now an explicit signal: `null` means create,
 *     a number means update-that-revision.
 *
 * @param {object} room      room to write, with ttl/updatedAt already stamped
 * @param {number|null} expected  revision the caller read, or null to create
 */
const buildRoomPut = (room, expected) => {
  const creating = expected === null;
  const params = {
    TableName: ROOMS(),
    Item: room,
    ConditionExpression: creating ? 'attribute_not_exists(#revision)' : '#revision = :expected',
    ExpressionAttributeNames: { '#revision': 'revision' },
  };
  // Only the update path references `:expected`. DynamoDB rejects unused keys,
  // so the create path must omit ExpressionAttributeValues entirely.
  if (!creating) params.ExpressionAttributeValues = { ':expected': expected };
  return params;
};

/**
 * Persist with an optimistic lock. `expected` is the revision the caller read;
 * a mismatch means someone else mutated the room and the caller must re-read.
 * Pass `null` to require that the room does not exist yet.
 */
const saveRoom = async (room, expected) => {
  room.updatedAt = nowMs();
  room.ttl = ttlAt(ROOM_TTL_SECONDS);
  await docClient.put(buildRoomPut(room, expected));
};

/**
 * Run `mutate(room)` and persist under the optimistic lock, re-reading and
 * retrying on contention. `mutate` returns the next room, or null to skip.
 */
const withRoom = async (roomId, mutate) => {
  let expected = null;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const room = await loadRoom(roomId);
    if (!room) return { room: null, error: 'That lobby no longer exists.' };
    expected = room.revision;
    const next = mutate(room);
    if (!next) return { room, error: null };
    try {
      await saveRoom(next, expected);
      return { room: next, error: null };
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    }
  }
  return { room: null, error: 'The lobby is busy — please try again.' };
};

const seatOf = (room, playerId) => (room.seats || []).find((s) => s.playerId === playerId) || null;

/**
 * Wire-safe projection. The raw room carries connection ids and internal
 * counters; the client only needs the match view plus who is seated.
 *
 * `graceUntil` is per seat (not room-level) because each client has to know
 * whether *it* is the one away or the opponent is — and seat `status` stays
 * internal for the same reason `connectionId` does.
 */
const publicRoom = (room) => ({
  roomId: room.roomId,
  phase: room.phase,
  hostId: room.hostId,
  winnerId: room.winnerId ?? null,
  turnDeadline: room.turnDeadline ?? null,
  revision: room.revision,
  forfeit: room.forfeit ?? null,
  seats: (room.seats || []).map((seat) => ({
    playerId: seat.playerId,
    nickname: seat.nickname || 'Player',
    slot: seat.slot,
    graceUntil: seat.graceUntil ?? null,
  })),
  state: room.state || null,
});

const recipients = (room) =>
  (room.seats || [])
    .filter((s) => s.connectionId && s.status !== 'left')
    .map((s) => s.connectionId);

/**
 * The state each seat is allowed to see.
 *
 * Traps are hidden from the opponent, and that has to be enforced here rather
 * than in the client: `sos:state` is the whole board, so shipping every trap to
 * both seats would make "hidden" cosmetic and trivially bypassable.
 */
const viewFor = (room, viewerId) => {
  if (!room.state) return null;
  const { serializeGameState, deserializeGameState, redactTrapsFor } = engine();
  const state = deserializeGameState(room.state);
  return serializeGameState(redactTrapsFor(state, viewerId));
};

/**
 * Events one seat is allowed to see.
 *
 * Animation is driven by the same event batch the client renders from, so the
 * server has to ship it or online duels play out silently. But events leak the
 * same hidden information the board does: an opponent's trap must not be
 * announced by name before it springs. `redactTrapsFor` hides the trap itself;
 * this hides the events that would give it away.
 *
 * Everything else is public by design — a hit, a heal and a defeat are all
 * things both players saw happen.
 */
const eventsFor = (events, viewerId) =>
  (events || []).filter((ev) => {
    if (ev.type === 'TRAP_PLACED') return ev.ownerId === viewerId;
    // Unit ids are `${ownerId}:${type}` (see `unitId` in the engine), so the
    // prefix is the reliable way to ask "was this my unit?".
    if (ev.type === 'SPELL_CAST' && ev.ability === 'TRAP') {
      return ev.unitId.startsWith(`${viewerId}:`);
    }
    return true;
  });

const sendState = async (room, events = null) => {
  const base = publicRoom(room);
  await Promise.all(
    (room.seats || [])
      .filter((s) => s.connectionId && s.status !== 'left')
      .map((seat) =>
        send(seat.connectionId, {
          type: 'sos:state',
          gameId: room.roomId,
          room: { ...base, state: viewFor(room, seat.playerId) },
          // Only on the command path. A tick re-sends state with no events, or
          // every countdown tick would replay the whole fight's animations.
          ...(events ? { events: eventsFor(events, seat.playerId) } : {}),
        }),
      ),
  );
};

const sendError = async (connectionId, message) => {
  await send(connectionId, { type: 'sos:error', message });
};

/** Send to every connected seat except `exceptPlayerId`. */
const notifyOpponents = async (room, payload, exceptPlayerId = null) =>
  Promise.all(
    (room.seats || [])
      .filter((s) => s.connectionId && s.status !== 'left' && s.playerId !== exceptPlayerId)
      .map((seat) => send(seat.connectionId, payload)),
  );

const shuffled = (items) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = require('crypto').randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

/** Build the faction-draft state once both seats are present. */
const buildMatch = (roomId, hostId, guestId) => {
  const { createInitialState } = engine();
  const players = [hostId, guestId];
  // Drawn here, server-side, once per match. `createInitialState` turns it into
  // a floor, so both players receive the same geometry through the serialized
  // state rather than each rolling their own — and the seed rides along in the
  // state so the match can be reproduced from a bug report.
  const mapSeed = require('crypto').randomInt(0, 2 ** 31);
  const state = createInitialState({
    gameId: roomId,
    mapSeed,
    playerIds: shuffled(players), // first turn is not host-biased
    pickOrder: shuffled(players), // faction first-pick is independent
  });
  state.revision = 1; // room transition into the faction draft is a mutation
  return state;
};

/**
 * Persist a command result onto the room and refresh its clock.
 * Shared by the turn-deadline skip and the monster step below.
 */
const commit = (room, serialized) => {
  room.state = serialized;
  room.revision = serialized.revision;
  room.winnerId = serialized.winnerId ?? null;
  room.phase = serialized.phase === 'ended' ? 'ended' : room.phase;
  room.turnDeadline = room.phase === 'ended' ? null : nowMs() + TURN_MS;
};

/**
 * If the active player blew through TURN_MS, skip their turn. Server-authoritative
 * so a client cannot sit on the clock; the winner of the race loses the turn.
 * Returns true when the room changed.
 */
const enforceTurnDeadline = (room) => {
  if (room.phase !== 'playing') return false;
  if (!room.state) return false;

  const { applyCommand, deserializeGameState, serializeGameState } = engine();
  const state = deserializeGameState(room.state);

  // The monsters move inside `END_TURN`, not here: they hold no turn, so there is
  // nothing for a tick to drive and no clock to guard on their behalf.

  if (!room.turnDeadline) return false;
  if (nowMs() < room.turnDeadline) return false;

  let result;
  if (state.phase === 'deployment') {
    const available = ['INQUISITORS', 'PENITENT_COURT'].filter(
      (faction) => !Object.values(state.factions).includes(faction),
    );
    if (available.length === 0) return false;
    const faction = available[require('crypto').randomInt(available.length)];
    result = applyCommand(state, state.activePlayerId, { type: 'CHOOSE_FACTION', faction });
  } else {
    result = applyCommand(state, state.activePlayerId, { type: 'END_TURN' });
  }
  if (!result.ok || !result.state) return false;

  commit(room, serializeGameState(result.state));
  return true;
};

const endDraftWithoutWinner = (room) => {
  room.phase = 'ended';
  room.winnerId = null;
  room.turnDeadline = null;
  if (room.state && room.state.phase === 'deployment') {
    room.state.phase = 'ended';
    room.state.winnerId = null;
    room.state.revision = (room.state.revision || 0) + 1;
    room.revision = room.state.revision;
  }
};

/**
 * Forfeit the duel if a dropped opponent's grace window has run out.
 *
 * Server-authoritative: the connected player never decides the outcome, they
 * only trigger the check. The turn clock is already suspended (see
 * `handleDisconnect`), so this is the only thing that can end the room while
 * somebody is waiting.
 *
 * The loser's forfeit is deliberately flagged `recordLoss: false` — a browser
 * crash should not cost a player their standing (PROJECT_DESIGN.md, no loss
 * chasing), while the winner's win still counts.
 */
const enforceGraceDeadline = (room) => {
  if (room.phase !== 'playing') return false;
  const waiting = (room.seats || []).find((s) => s.graceUntil && nowMs() >= s.graceUntil);
  if (!waiting) return false;

  // A dropped player during the faction draft never entered combat; this ends
  // the room without awarding a win or recording a forfeit.
  if (room.state && room.state.phase === 'deployment') {
    endDraftWithoutWinner(room);
    room.seats = (room.seats || []).map((s) => ({ ...s, graceUntil: null }));
    return true;
  }

  const winner = (room.seats || []).find((s) => s.playerId !== waiting.playerId);
  room.phase = 'ended';
  room.winnerId = winner ? winner.playerId : null;
  room.forfeit = {
    winnerId: winner ? winner.playerId : null,
    loserId: waiting.playerId,
    recordWin: !!winner,
    recordLoss: false,
  };
  room.turnDeadline = null;
  room.seats = (room.seats || []).map((s) => ({ ...s, graceUntil: null }));
  return true;
};

/** Seconds left on a seat's grace window, for the countdown the UI shows. */
const graceSecondsLeft = (seat, at = nowMs()) =>
  seat && seat.graceUntil ? Math.max(0, Math.ceil((seat.graceUntil - at) / 1000)) : 0;

/**
 * Start a duel from an accepted lobby challenge.
 *
 * The challenge item already occupies `roomId`, so this writes the room over it
 * and the optimistic lock still rejects a command that raced the promotion.
 *
 * `expectedRevision` MUST be the challenge's own revision (a number) and never
 * `null`. `null` is `saveRoom`'s "the row must not exist" signal, so passing it
 * here would demand the row we are overwriting be absent and always fail. This
 * is the same create-vs-update confusion that kept `sos:create` broken, so it is
 * validated rather than defaulted.
 */
const startAcceptedChallenge = async ({ roomId, host, guest, expectedRevision }) => {
  if (typeof expectedRevision !== 'number') {
    return { room: null, error: 'Could not start the duel — please retry.' };
  }

  const room = {
    ...freshRoom(roomId),
    kind: 'room',
    hostId: host.playerId,
    seats: [
      { playerId: host.playerId, connectionId: host.connectionId, nickname: host.nickname, slot: 0, status: 'seated', graceUntil: null },
      { playerId: guest.playerId, connectionId: guest.connectionId, nickname: guest.nickname, slot: 1, status: 'seated', graceUntil: null },
    ],
    revision: expectedRevision,
  };

  const { serializeGameState } = engine();
  const state = serializeGameState(buildMatch(room.roomId, host.playerId, guest.playerId));
  room.state = state;
  room.revision = state.revision;
  room.phase = 'playing';
  room.turnDeadline = nowMs() + TURN_MS;

  try {
    await saveRoom(room, expectedRevision);
  } catch (err) {
    console.error('sos challenge promotion failed:', err);
    return { room: null, error: 'Could not start the duel — please retry.' };
  }

  await sendState(room);
  await Promise.all(
    [host.connectionId, guest.connectionId]
      .filter(Boolean)
      .map((connectionId) => setConnRoom(connectionId, room.roomId)),
  );
  return { room, error: null };
};

// ── actions ────────────────────────────────────────────────────────────────

/** Create a lobby and take the first seat. Returns the new room code. */
const create = async (connectionId, identity) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const roomId = makeRoomCode();
    if (await loadRoom(roomId)) continue; // code collision, try again
    const room = freshRoom(roomId);
    room.hostId = identity.playerId;
    room.seats = [
      { playerId: identity.playerId, connectionId, nickname: identity.nickname, slot: 0, status: 'seated' },
    ];
    try {
      // `null` = must not already exist. Not `0`: a lobby room has revision 0.
      await saveRoom(room, null);
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') continue;
      throw err;
    }
    await sendState(room);
    await setConnRoom(connectionId, room.roomId);
    return room;
  }
  throw new Error('Could not allocate a lobby code — please retry.');
};

/** Join an existing lobby by invite code. Doubles as the reconnection path. */
const join = async (connectionId, identity, roomId) => {
  let reconnected = false;
  const { room, error } = await withRoom(roomId, (current) => {
    const seats = current.seats || [];

    /**
     * Somebody who dropped out of a duel is done with it.
     *
     * This has to be checked BEFORE the "already seated, welcome back" branch
     * below, because that branch refreshes any seat it finds for this playerId
     * unconditionally — which is how a player who lost the room to a forfeit
     * could walk straight back in and resume a duel that had already been
     * decided. The forfeit record names them as the loser, so that is the fact
     * this keys on.
     *
     * Deliberately still allowed: coming back INSIDE the grace window, before
     * the duel is decided. That is the whole point of the grace period, and
     * `forfeit` is only written once it has expired.
     */
    if (current.forfeit && current.forfeit.loserId === identity.playerId) {
      throw Object.assign(
        new Error('You dropped out of that duel and lost it on forfeit — start a new one.'),
        { roomError: true },
      );
    }

    // Re-joining (reload, second tab, or returning inside the grace window)
    // refreshes the connection id in place. Clearing `graceUntil` is what
    // actually ends a disconnect: the seat is held, so the match survives.
    const existing = seats.find((s) => s.playerId === identity.playerId);
    if (existing) {
      // A seat the player walked away from is not one they may return to, even
      // though the row still exists.
      if (existing.status === 'left') {
        throw Object.assign(new Error('You left that duel — start a new one.'), {
          roomError: true,
        });
      }
      existing.connectionId = connectionId;
      existing.status = 'seated';
      if (existing.graceUntil) {
        existing.graceUntil = null;
        reconnected = true;
        // The clock was suspended for the opponent's benefit; hand them a full
        // turn budget rather than resuming a stale deadline.
        if (current.phase === 'playing') current.turnDeadline = nowMs() + TURN_MS;
      }
      return current;
    }

    if (current.phase !== 'lobby') return null; // already started
    if (seats.length >= MAX_SEATS) {
      throw Object.assign(new Error('That lobby is full.'), { roomError: true });
    }

    seats.push({
      playerId: identity.playerId,
      connectionId,
      nickname: identity.nickname,
      slot: seats.length,
      status: 'seated',
    });
    current.seats = seats;

    // Second seat in: the duel begins.
    if (seats.length === MAX_SEATS) {
      const host = seats[0];
      const guest = seats[1];
      const { serializeGameState } = engine();
      const state = serializeGameState(buildMatch(current.roomId, host.playerId, guest.playerId));
      current.state = state;
      current.revision = state.revision;
      current.phase = 'playing';
      current.turnDeadline = nowMs() + TURN_MS;
    }
    return current;
  });

  if (error) return { room: null, error };
  await sendState(room);
  await setConnRoom(connectionId, roomId);
  if (reconnected) {
    await notifyOpponents(room, {
      type: 'OPPONENT_RECONNECTED',
      gameId: roomId,
      playerId: identity.playerId,
    });
  }
  return { room, error: null };
};

/** Apply one player command through the shared authoritative reducer. */
const command = async (connectionId, identity, roomId, gameCommand) => {
  let outcome = { error: null, commandType: gameCommand && gameCommand.type, events: null };

  const { room, error } = await withRoom(roomId, (current) => {
    // Grace first: if the opponent's window has run out the duel is over, and
    // the turn clock must not get a chance to hand initiative to a player who
    // is no longer there.
    const forfeited = enforceGraceDeadline(current);
    enforceTurnDeadline(current);
    if (forfeited) outcome = { ...outcome, forfeited: true };

    const seat = seatOf(current, identity.playerId);
    if (!seat) throw Object.assign(new Error('You are not in that lobby.'), { roomError: true });
    if (current.phase !== 'playing' || !current.state) return null;

    const { applyCommand, deserializeGameState, serializeGameState } = engine();
    const result = applyCommand(
      deserializeGameState(current.state),
      identity.playerId,
      gameCommand,
      secureGameRng,
    );
    if (!result.ok || !result.state) {
      outcome = { ...outcome, error: result.error || 'That action is not allowed.' };
      return null;
    }

    const serialized = serializeGameState(result.state);
    current.state = serialized;
    current.revision = serialized.revision;
    current.winnerId = serialized.winnerId ?? null;
    // Carried out of the mutator so `sendState` can ship it to both seats. This
    // is what makes an online duel animate at all.
    outcome = { ...outcome, events: result.events ?? [] };
    if (serialized.phase === 'ended') {
      current.phase = 'ended';
      current.turnDeadline = null;
    } else {
      // Any accepted action refreshes the clock: the budget is inactivity, not
      // a hard cap on the whole turn.
      current.turnDeadline = nowMs() + TURN_MS;
    }
    return current;
  });

  if (error) return { room: null, error: error || outcome.error, commandType: outcome.commandType };
  await sendState(room, outcome.events);
  if (outcome.forfeited && room && room.forfeit) await announceForfeit(room);
  return { room, error: outcome.error, commandType: outcome.commandType };
};

/** Tell both seats the duel ended on a clock, and who it counts for. */
const announceForfeit = async (room) => {
  if (!room.forfeit) return;
  await notifyOpponents(room, {
    type: 'GAME_OVER_FORFEIT',
    gameId: room.roomId,
    winnerId: room.forfeit.winnerId,
    loserId: room.forfeit.loserId,
    recordWin: room.forfeit.recordWin,
    recordLoss: room.forfeit.recordLoss,
  });
};

/**
 * Deadline check driven by the clients' own countdown reaching zero. This is
 * what actually skips a stalled turn while both players still have the tab open;
 * a fully abandoned room is left to the TTL instead of running a timer Lambda.
 *
 * It is also what closes an expired reconnection grace period — the surviving
 * player keeps ticking, so the forfeit fires within a tick of the window ending.
 */
const tick = async (connectionId, identity, roomId) => {
  let forfeited = false;
  const { room, error } = await withRoom(roomId, (current) => {
    forfeited = enforceGraceDeadline(current);
    enforceTurnDeadline(current);
    return current.revision !== undefined ? current : null;
  });
  if (error) return { room: null, error };
  await sendState(room);
  if (forfeited && room && room.forfeit) await announceForfeit(room);
  return { room, error: null };
};

const handleMessage = async (event, payload) => {
  const connectionId = event.requestContext.connectionId;
  const action = payload.action || '';
  const identity = await identityOf(connectionId);
  if (!identity) return { statusCode: 200, body: 'No identity' };

  try {
    switch (action) {
      case 'sos:create': {
        const room = await create(connectionId, identity);
        return { statusCode: 200, body: room.roomId };
      }

      case 'sos:join': {
        const roomId = String(payload.gameId || '').toUpperCase();
        if (!/^[23456789A-HJ-NP-Z]{6}$/.test(roomId)) {
          await sendError(connectionId, 'That invite code is not valid.');
          return { statusCode: 400, body: 'Bad room code' };
        }
        const { room, error } = await join(connectionId, identity, roomId);
        if (error) await sendError(connectionId, error);
        return { statusCode: error ? 400 : 200, body: error || 'Joined' };
      }

      case 'sos:command': {
        const roomId = String(payload.gameId || '').toUpperCase();
        const { room, error, commandType } = await command(connectionId, identity, roomId, payload.command);
        if (error) {
          await send(connectionId, {
            type: 'sos:error',
            gameId: roomId,
            message: error,
            commandType,
          });
        } else if (room) {
          await send(connectionId, {
            type: 'sos:ack',
            gameId: roomId,
            commandType,
            revision: room.revision,
          });
        }
        return { statusCode: error ? 400 : 200, body: error || 'Applied' };
      }

      case 'sos:tick': {
        const roomId = String(payload.gameId || '').toUpperCase();
        const { error } = await tick(connectionId, identity, roomId);
        return { statusCode: error ? 400 : 200, body: error || 'Ticked' };
      }

      case 'sos:leave': {
        const roomId = String(payload.gameId || '').toUpperCase();
        await leave(connectionId, identity, roomId);
        return { statusCode: 200, body: 'Left' };
      }

      case 'sos:state': {
        const roomId = String(payload.gameId || '').toUpperCase();
        const room = await loadRoom(roomId);
        if (!room) {
          await sendError(connectionId, 'That lobby no longer exists.');
          return { statusCode: 404, body: 'No room' };
        }
        await sendState(room);
        return { statusCode: 200, body: 'State' };
      }

      default:
        return { statusCode: 400, body: 'Unknown Square of Shadows action' };
    }
  } catch (err) {
    if (err.roomError) {
      await sendError(connectionId, err.message);
      return { statusCode: 400, body: err.message };
    }
    console.error('sos handler failed:', err);
    await sendError(connectionId, 'The lobby hit an error — please retry.');
    return { statusCode: 500, body: 'Server error' };
  }
};

/**
 * Voluntary exit.
 *
 * Backing out of a LIVE duel holds the seat for the same grace window a dropped
 * socket gets (see `handleDisconnect`), so the Menu button is no longer an
 * instant forfeit: the opponent gets the countdown, and the leaver can rejoin
 * from the title screen or the duel lobby until it runs out. A draft has
 * nothing to come back to, and a room whose opponent is already gone just ends,
 * so both of those keep the hard leave.
 */
const leave = async (connectionId, identity, roomId) => {
  const { room } = await withRoom(roomId, (current) => {
    const seats = current.seats || [];
    const idx = seats.findIndex((s) => s.playerId === identity.playerId);
    if (idx < 0) return null;
    const opponent = seats[idx === 0 ? 1 : 0];
    const opponentHere = !!(opponent && opponent.connectionId && opponent.status !== 'left');
    if (
      current.phase === 'playing' &&
      opponentHere &&
      !(current.state && current.state.phase === 'deployment')
    ) {
      seats[idx].status = 'grace';
      seats[idx].connectionId = null;
      seats[idx].graceUntil = nowMs() + GRACE_MS;
      // Same reason as a disconnect: the opponent must not lose on time while
      // the game is paused waiting for a seat that is still held.
      current.turnDeadline = null;
      return current;
    }
    seats[idx].status = 'left';
    seats[idx].connectionId = null;
    // A duel with one player gone is over; keep the result for the record.
    if (current.phase === 'playing') {
      if (current.state && current.state.phase === 'deployment') endDraftWithoutWinner(current);
      else {
        current.phase = 'ended';
        current.winnerId = seats[idx === 0 ? 1 : 0] ? seats[idx === 0 ? 1 : 0].playerId : null;
        current.turnDeadline = null;
      }
    }
    return current;
  });
  if (!room) return;
  const seat = seatOf(room, identity.playerId);
  if (seat && seat.graceUntil) {
    await notifyOpponents(room, {
      type: 'PLAYER_DISCONNECTED_GRACE',
      gameId: room.roomId,
      playerId: identity.playerId,
      nickname: seat.nickname || 'Player',
      remainingTimeSeconds: graceSecondsLeft(seat),
    }, identity.playerId);
  }
  await sendState(room);
};

/**
 * Disconnect cleanup, with a reconnection grace period.
 *
 * A dropped socket no longer kills the duel outright. While a match is live the
 * seat is *held* — status `grace`, `graceUntil` stamped — the turn clock is
 * suspended so the opponent is not also raced on time, and the remaining player
 * gets a countdown. Coming back is just `join` clearing `graceUntil`.
 *
 * The forfeit itself is never decided here: this only arms the deadline, and
 * `enforceGraceDeadline` closes it when the still-connected player next ticks or
 * acts. Nothing needs to be running in between (see the header).
 *
 * Two caveats, both deliberate:
 *  - The seat is kept, so `recipients`/`sendState` must skip grace seats; a
 *    grace seat has no connection id anyway, so the existing `status !== 'left'`
 *    filter would try to post to `null`.
 *  - If *both* players are gone there is nobody to notify and nobody to trigger
 *    the check, so the room is ended immediately and left to the TTL.
 */
const handleDisconnect = async (connectionId) => {
  const conn = await docClient.get({
    TableName: CONNECTIONS(),
    Key: { connectionId },
    ConsistentRead: true,
  });
  const roomId = conn.Item && conn.Item.sosRoomId;
  if (!roomId) return;

  const playerId = conn.Item.playerId || conn.Item.userId;
  await withRoom(roomId, (room) => {
    const seat = seatOf(room, playerId);
    if (!seat) return null;

    const opponent = (room.seats || []).find((s) => s.playerId !== playerId);
    const opponentHere = opponent && opponent.connectionId && opponent.status !== 'left';

    if (room.phase !== 'playing' || !opponentHere || (room.state && room.state.phase === 'deployment')) {
      // Nothing to hold open for: pre-match seat, or the room is already empty.
      seat.status = 'left';
      seat.connectionId = null;
      seat.graceUntil = null;
      if (room.phase === 'playing') {
        if (room.state && room.state.phase === 'deployment') endDraftWithoutWinner(room);
        else {
          room.phase = 'ended';
          room.winnerId = opponentHere ? opponent.playerId : null;
          room.turnDeadline = null;
        }
      }
      return room;
    }

    seat.status = 'grace';
    seat.connectionId = null;
    seat.graceUntil = nowMs() + GRACE_MS;
    // Suspend the turn clock: the opponent should not lose on time while the
    // game is already paused waiting for their rival to come back.
    room.turnDeadline = null;
    return room;
  });

  const room = await loadRoom(roomId);
  if (!room) return;

  const seat = seatOf(room, playerId);
  if (seat && seat.graceUntil) {
    await notifyOpponents(room, {
      type: 'PLAYER_DISCONNECTED_GRACE',
      gameId: room.roomId,
      playerId,
      nickname: seat.nickname || 'Player',
      remainingTimeSeconds: graceSecondsLeft(seat),
    }, playerId);
  }
  await sendState(room);
};

/** Record which lobby a socket joined, so $disconnect can clean it up. */
const setConnRoom = async (connectionId, roomId) => {
  await docClient.update({
    TableName: CONNECTIONS(),
    Key: { connectionId },
    UpdateExpression: 'SET #r = :r',
    ExpressionAttributeNames: { '#r': 'sosRoomId' },
    ExpressionAttributeValues: { ':r': roomId },
  });
};

const clearConnRoom = async (connectionId) => {
  await docClient.update({
    TableName: CONNECTIONS(),
    Key: { connectionId },
    UpdateExpression: 'REMOVE #r',
    ExpressionAttributeNames: { '#r': 'sosRoomId' },
  });
};

module.exports = {
  MAX_SEATS,
  TURN_MS,
  GRACE_MS,
  ROOM_TTL_SECONDS,
  CODE_LENGTH,
  ENGINE_PATH,
  freshRoom,
  publicRoom,
  makeRoomCode,
  buildMatch,
  enforceTurnDeadline,
  enforceGraceDeadline,
  eventsFor,
  graceSecondsLeft,
  startAcceptedChallenge,
  seatOf,
  withRoom,
  buildRoomPut,
  saveRoom,
  __setTransport,
  handleMessage,
  handleDisconnect,
  setConnRoom,
  clearConnRoom,
  __setEngine,
};
