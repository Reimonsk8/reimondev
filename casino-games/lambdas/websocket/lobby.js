/**
 * Square of Shadows — duel lobby: presence roster and duel challenges.
 *
 * ## Why there is no in-memory "LobbyManager"
 *
 * The obvious design for a lobby is a long-lived process holding a `Map` of
 * connected players and a `setTimeout` per challenge. That is impossible here:
 * every Lambda invocation is a fresh, short-lived container behind API Gateway
 * WebSocket, so an in-memory map is per-container and each of two players would
 * get a different, wrong view of the lobby. There is also no process alive at
 * T+15s to fire a challenge expiry, and none at T+60s to start a grace countdown
 * — nothing is running when no client is sending.
 *
 * So presence is the `casino-players` table (it already *is* the live roster —
 * `listPlayers()` backs the casino floor map), and every deadline is an absolute
 * timestamp on a DynamoDB item that is enforced *lazily*, when the still-present
 * client next speaks. That is the pattern `sos.js` already uses for the turn
 * clock (`turnDeadline` + `sos:tick`), so challenges and the reconnection grace
 * period follow the same proven shape. The observable behaviour is the same as a
 * server-side timer; the cost is zero.
 *
 * ## Challenge items are room items
 *
 * A challenge is stored in the `sos-rooms` table keyed by `roomId = challengeId`
 * with `kind: 'challenge'`. Accepting it flips that same item to `kind: 'room'`
 * and fills in the two seats, so a challenge *becomes* the match room: one id,
 * one write, and no chance of the two ids disagreeing. Reuses the existing
 * on-demand table, so this needs no schema change and no CDK diff.
 */
const { docClient, send, broadcast, getPlayer, listPlayers, updateCachedPlayer, allowAction, identityOf } = require('./utils');

/** Players get this long to answer before the challenge lapses. */
const CHALLENGE_MS = 15_000;

/** How long a challenge item survives before the table's TTL reaps it. */
const CHALLENGE_TTL_SECONDS = 60 * 60;

/** Challenge lifecycle. Only `pending` is actionable; the rest are terminal. */
const CHALLENGE_STATUSES = ['pending', 'accepted', 'declined', 'expired'];

const nowMs = () => Date.now();
const ttlAt = (seconds) => Math.floor(nowMs() / 1000) + seconds;

/** Statuses that make a player un-challengeable: they are busy or already playing. */
const BUSY_STATUSES = new Set(['PENDING_CHALLENGE', 'IN_GAME']);

// ── pure state ───────────────────────────────────────────────────────────────

/** A pending challenge with nobody in it yet. */
const freshChallenge = (challengeId, from, to, expiresAt) => ({
  roomId: challengeId,
  kind: 'challenge',
  status: 'pending',
  challengeId,
  fromPlayerId: from.playerId,
  fromNickname: from.nickname,
  toPlayerId: to.playerId,
  toNickname: to.nickname,
  expiresAt,
  revision: 0,
  createdAt: nowMs(),
  updatedAt: nowMs(),
  ttl: ttlAt(CHALLENGE_TTL_SECONDS),
});

/**
 * Wire projection of a challenge. Carries nicknames so the target's prompt can
 * render "X has challenged you" without a second roster lookup, and so the
 * challenge survives the challenger going offline mid-prompt.
 */
const publicChallenge = (challenge) => ({
  challengeId: challenge.challengeId,
  fromPlayerId: challenge.fromPlayerId,
  fromNickname: challenge.fromNickname || 'Player',
  toPlayerId: challenge.toPlayerId,
  toNickname: challenge.toNickname || 'Player',
  expiresAt: challenge.expiresAt,
});

/**
 * Has this challenge lapsed? Compared against the absolute `expiresAt` rather
 * than a timer, so a Lambda that was asleep still gets the right answer.
 */
const isExpired = (challenge, at = nowMs()) =>
  challenge.status === 'pending' && at >= challenge.expiresAt;

/** Terminal outcome for a challenge nobody answered. */
const expireChallenge = (challenge) => {
  challenge.status = 'expired';
  challenge.updatedAt = nowMs();
  return challenge;
};

/**
 * The roster everyone can see, split by what they are doing.
 *
 * `DISCONNECTED` players ARE included now. They used to be filtered out, which
 * meant a player whose socket dropped simply evaporated from the lobby — and
 * because a disconnect deletes the players row anyway, the lobby could not tell
 * "never here" from "here and then left". Surfacing them lets the UI show a
 * departed player instead of silently shrinking the roster, and `connected`
 * lets the client grey them out rather than offering a challenge that goes
 * nowhere.
 *
 * `inGame` is the one field the two-column lobby actually sorts on; it is
 * derived here rather than in the client so both sides agree on what "busy"
 * means.
 */
const publicRoster = (players) =>
  players
    .filter((p) => p.lobbyStatus)
    .filter((p) => p.playerId)
    .map((p) => ({
      id: p.playerId,
      username: p.nickname || 'Player',
      // The duel lobby is the one screen where players pick each other by face
      // rather than by name, so the roster carries the avatar. `connect` already
      // made this server-authoritative (users table, falling back to the Google
      // `picture` claim) and `move` refuses to let a client overwrite it, so this
      // cannot be spoofed from the browser.
      //
      // Cost note: `avatarImage` is a 128px JPEG data URL (a few KB), and the
      // roster is broadcast to every lobby client on each join/leave/challenge.
      // The emote broadcast already ships the same field to the same audience
      // (see `message/index.js`), so this is not a new class of payload.
      avatarImage: p.avatarImage || null,
      status: p.lobbyStatus,
      challengeable: !BUSY_STATUSES.has(p.lobbyStatus) && p.lobbyStatus !== 'DISCONNECTED',
      inGame: p.lobbyStatus === 'IN_GAME',
      connected: p.lobbyStatus !== 'DISCONNECTED',
    }));

/**
 * Private rooms that are waiting for one more player.
 *
 * A host who chooses "Create private room" is removed from the duel roster
 * (they are no longer looking for a random challenge), which used to make the
 * room disappear from every friend's screen: the only way in was the invite
 * link. The room itself is still the source of truth, so surface open rooms as
 * a separate, explicitly joinable list.
 *
 * Only rooms whose seated host still has a live connection count. A room left
 * behind by a closed tab is not joinable, and showing it would send friends into
 * an empty lobby. That check uses the players table's live connection ids rather
 * than room age, because a host can sit in a private room for a long time.
 */
const publicOpenRooms = (players, rooms) => {
  const liveConnections = new Set(
    (players || []).map((p) => p.connectionId).filter(Boolean),
  );
  return (rooms || [])
    .filter((room) => room && room.phase === 'lobby')
    .map((room) => {
      const seats = room.seats || [];
      if (seats.length !== 1) return null;
      const host = seats[0];
      if (!host || host.status !== 'seated' || !host.connectionId) return null;
      if (!liveConnections.has(host.connectionId)) return null;
      return {
        roomId: room.roomId,
        hostId: host.playerId,
        hostNickname: host.nickname || 'Player',
        createdAt: room.createdAt || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt);
};

/** Read open private rooms. A scan failure must not take the whole roster down. */
const scanOpenRooms = async (players) => {
  try {
    const res = await docClient.scan({
      TableName: ROOMS(),
      FilterExpression: '#phase = :lobby',
      ExpressionAttributeNames: { '#phase': 'phase' },
      ExpressionAttributeValues: { ':lobby': 'lobby' },
    });
    return publicOpenRooms(players, res.Items || []);
  } catch (err) {
    console.error('lobby room scan failed (non-fatal):', err);
    return [];
  }
};

/**
 * A room this specific player can still walk back into.
 *
 * The lobby row is rendered from `resumeRoomId`, which lives in the browser, but
 * only the server can say whether the seat is still held and how much of the
 * grace window is left. Returning that projection in the caller's own
 * `LOBBY_STATE` is what lets the row show a real countdown instead of a stale
 * "rejoin" button for a room that has already been forfeited.
 *
 * Only the caller's own seat is projected, so one player's room code is never
 * exposed to the rest of the roster.
 */
const publicResume = (room, playerId) => {
  if (!room || room.kind === 'challenge') return null;
  if (room.phase !== 'lobby' && room.phase !== 'playing') return null;
  const seat = (room.seats || []).find((s) => s.playerId === playerId);
  if (!seat || seat.status === 'left') return null;
  // The grace deadline is enforced lazily by `sos.js`, so the room can still
  // carry a held seat after the minute has closed if the opponent has not acted
  // yet. Do not offer a rejoin the server would already refuse.
  if (seat.graceUntil && seat.graceUntil <= nowMs()) return null;
  return {
    roomId: room.roomId,
    phase: room.phase,
    graceUntil: seat.graceUntil || null,
  };
};

/** Read the caller's resumable room, ignoring anything that is not theirs. */
const loadResume = async (roomId, playerId) => {
  if (!roomId || !playerId) return null;
  try {
    const res = await docClient.get({
      TableName: ROOMS(),
      Key: { roomId },
      ConsistentRead: true,
    });
    return publicResume(res.Item, playerId);
  } catch (err) {
    // A failed read must not break the roster or be mistaken for "no room":
    // `undefined` omits the key, so the client keeps its local resume card and
    // asks again on the next poll. Only a definite miss returns null.
    console.error('lobby resume lookup failed (non-fatal):', err);
    return undefined;
  }
};

// ── transport ────────────────────────────────────────────────────────────────

const ROOMS = () => process.env.SOS_ROOMS_TABLE_NAME;
const PLAYERS = () => process.env.PLAYERS_TABLE_NAME;

const loadChallenge = async (challengeId) => {
  const res = await docClient.get({ TableName: ROOMS(), Key: { roomId: challengeId } });
  const item = res.Item || null;
  return item && item.kind === 'challenge' ? item : null;
};

const saveChallenge = async (challenge) => {
  challenge.updatedAt = nowMs();
  challenge.ttl = ttlAt(CHALLENGE_TTL_SECONDS);
  await docClient.put({ TableName: ROOMS(), Item: challenge });
};

/**
 * Publish the roster to every lobby client. `broadcast` already fans out over the
 * connections table, which is the same set the roster is derived from, so this
 * cannot drift from who is actually online.
 */
const pushRoster = async () => {
  const players = await listPlayers();
  await broadcast({
    type: 'LOBBY_STATE',
    players: publicRoster(players),
    rooms: await scanOpenRooms(players),
  });
};

/**
 * Record a player's duel-lobby status on their players row.
 *
 * The row is the roster (see the header), so the status has to live there rather
 * than in a side table that could disagree with it. `updateCachedPlayer` keeps
 * `getPlayer`'s 5-minute cache from serving a stale status back.
 */
const setLobbyStatus = async (connectionId, lobbyStatus) => {
  await docClient.update({
    TableName: PLAYERS(),
    Key: { connectionId, roomId: 'main' },
    UpdateExpression: 'SET #s = :s',
    ConditionExpression: 'attribute_exists(connectionId)',
    ExpressionAttributeNames: { '#s': 'lobbyStatus' },
    ExpressionAttributeValues: { ':s': lobbyStatus },
  });
  updateCachedPlayer(connectionId, { lobbyStatus });
};

/** Tell a player their outgoing challenge is over, and why. */
const notifyChallenger = async (challenge, reason) => {
  const target = await findConnectionOf(challenge.fromPlayerId);
  if (target) await send(target, { type: 'CHALLENGE_RESULT', challengeId: challenge.challengeId, outcome: reason });
};

/** Resolve a playerId to their live connection, or null when they are offline. */
const findConnectionOf = async (playerId) => {
  const players = await listPlayers();
  const match = players.find((p) => p.playerId === playerId);
  return match ? match.connectionId : null;
};

/**
 * Retire every challenge that timed out.
 *
 * Called on each roster read, which the clients poll while a prompt is open, so
 * a lapse is noticed within a poll interval without any timer Lambda. Returns
 * the challenges it closed so the caller can toast the challengers.
 */
const sweepExpired = async () => {
  let lapsed = [];
  try {
    const res = await docClient.scan({
      TableName: ROOMS(),
      FilterExpression: '#k = :challenge AND #st = :pending',
      ExpressionAttributeNames: { '#k': 'kind', '#st': 'status' },
      ExpressionAttributeValues: { ':challenge': 'challenge', ':pending': 'pending' },
    });
    lapsed = (res.Items || []).filter((c) => isExpired(c));
  } catch (err) {
    console.error('lobby sweep failed (non-fatal):', err);
    return [];
  }

  for (const challenge of lapsed) {
    try {
      await saveChallenge(expireChallenge(challenge));
      await notifyChallenger(challenge, 'expired');
      // Both sides are free again, so they go back on the challengeable list.
      await releaseStatus(challenge.fromPlayerId, 'IN_LOBBY');
      await releaseStatus(challenge.toPlayerId, 'IN_LOBBY');
    } catch (err) {
      console.error('lobby expiry cleanup failed (non-fatal):', err);
    }
  }
  return lapsed;
};

/** Move a player back to a status, but only if they are still in a challenge. */
const releaseStatus = async (playerId, lobbyStatus) => {
  const connectionId = await findConnectionOf(playerId);
  if (!connectionId) return;
  await setLobbyStatus(connectionId, lobbyStatus).catch(() => {});
};

// ── actions ──────────────────────────────────────────────────────────────────

/**
 * Register in the duel lobby. The client calls this when the player opens the
 * Online Duel view; everyone already in the lobby sees the roster change.
 */
/**
 * The duel-lobby presence of a player who may still be holding a seat.
 *
 * Registering as "looking for a duel" is only true when there is no live room
 * behind them. A player who backed out of a duel (or reloaded mid-match) keeps
 * their seat for the grace window, so this asks the room rather than assuming.
 */
const enter = async (connectionId, identity) => {
  const conn = await docClient.get({
    TableName: CONNECTIONS(),
    Key: { connectionId },
    ConsistentRead: true,
  }).catch(() => null);
  const roomId = conn && conn.Item && conn.Item.sosRoomId;
  const held = roomId ? await loadResume(roomId, identity.playerId) : null;
  // Keep IN_GAME while the seat is held: it is what stops the roster offering
  // this player as free to challenge, and what keeps their own Rejoin row in the
  // "In a duel" column.
  await setLobbyStatus(connectionId, held ? 'IN_GAME' : 'IN_LOBBY');
  await pushRoster();
  return { statusCode: 200, body: 'In lobby' };
};

/**
 * Roster read. Also the poll that drives challenge-expiry toasts, and the
 * refresh that keeps private rooms current without coupling `sos.js` back into
 * this module.
 *
 * The response is sent only to the caller unless an expired challenge had to be
 * broadcast. Polling every lobby client with a full broadcast would be needless
 * fan-out; each client asks for its own snapshot on a timer instead.
 */
const list = async (connectionId, identity, resumeRoomId) => {
  const lapsed = await sweepExpired();
  if (lapsed.length) await pushRoster();
  const players = await listPlayers();
  await send(connectionId, {
    type: 'LOBBY_STATE',
    players: publicRoster(players),
    rooms: await scanOpenRooms(players),
    resume: await loadResume(resumeRoomId, identity.playerId),
  });
  return { statusCode: 200, body: 'Roster sent' };
};

/**
 * Challenge an available player.
 *
 * Refuses when the target is offline, is the sender, or is already busy — the
 * roster the sender clicked was rendered some seconds ago and could be stale, so
 * this re-checks server-side rather than trusting what was on screen.
 */
const challenge = async (connectionId, identity, targetPlayerId) => {
  if (!targetPlayerId || targetPlayerId === identity.playerId) {
    return fail(connectionId, 'Pick another player');
  }
  // One challenge per player at a time, so spam-clicking cannot fan out.
  if (!(await allowAction(connectionId, 'lobby:challenge', 3000))) {
    return fail(connectionId, 'Slow down — one challenge at a time.', 429);
  }

  const targetConnectionId = await findConnectionOf(targetPlayerId);
  if (!targetConnectionId) return fail(connectionId, 'That player is no longer online.', 404);

  const target = await getPlayer(targetConnectionId);
  if (!target.lobbyStatus || BUSY_STATUSES.has(target.lobbyStatus)) {
    return fail(connectionId, 'That player is busy right now.', 409);
  }

  const challengeId = require('./sos').makeRoomCode();
  const item = freshChallenge(challengeId, identity, {
    playerId: targetPlayerId,
    nickname: target.nickname || 'Player',
  }, nowMs() + CHALLENGE_MS);

  try {
    await saveChallenge(item);
  } catch (err) {
    console.error('lobby challenge write failed:', err);
    return fail(connectionId, 'Could not send that challenge', 500);
  }

  await setLobbyStatus(connectionId, 'PENDING_CHALLENGE');
  await setLobbyStatus(targetConnectionId, 'PENDING_CHALLENGE');
  await send(targetConnectionId, { type: 'CHALLENGE_RECEIVED', challenge: publicChallenge(item) });
  // The challenger needs the id too. Without it they cannot match a later
  // CHALLENGE_RESULT to their own offer, so a decline or lapse would leave their
  // "waiting for an answer" banner up forever.
  await send(connectionId, { type: 'CHALLENGE_SENT', challenge: publicChallenge(item) });
  await pushRoster();
  return { statusCode: 200, body: 'Challenge sent' };
};

/**
 * Accept or decline.
 *
 * On accept the challenge item is promoted in place to the match room: `sos.js`
 * owns seat rules, the optimistic lock and the shared engine, so this only has
 * to hand over two identities and let it build the board.
 */
const respond = async (connectionId, identity, challengeId, accept) => {
  const item = await loadChallenge(challengeId);
  if (!item) return fail(connectionId, 'That challenge no longer exists.', 404);
  if (item.toPlayerId !== identity.playerId) {
    return fail(connectionId, 'That challenge is not yours.', 403);
  }

  if (isExpired(item)) {
    await saveChallenge(expireChallenge(item));
    await releaseStatus(item.fromPlayerId, 'IN_LOBBY');
    await releaseStatus(item.toPlayerId, 'IN_LOBBY');
    await notifyChallenger(item, 'expired');
    await pushRoster();
    return fail(connectionId, 'That challenge expired.', 409);
  }

  if (item.status !== 'pending') return fail(connectionId, 'That challenge is already answered.', 409);

  if (!accept) {
    item.status = 'declined';
    await saveChallenge(item);
    await setLobbyStatus(connectionId, 'IN_LOBBY');
    await releaseStatus(item.fromPlayerId, 'IN_LOBBY');
    await notifyChallenger(item, 'declined');
    await pushRoster();
    return { statusCode: 200, body: 'Declined' };
  }

  // Accepting removes the challenge window entirely, so a late decline racing
  // this write cannot resurrect it.
  item.status = 'accepted';
  await saveChallenge(item);
  await setLobbyStatus(connectionId, 'IN_GAME');

  const sos = require('./sos');
  const fromConnectionId = await findConnectionOf(item.fromPlayerId);
  const { room, error } = await sos.startAcceptedChallenge({
    roomId: item.challengeId,
    host: { playerId: item.fromPlayerId, nickname: item.fromNickname, connectionId: fromConnectionId },
    guest: { playerId: item.toPlayerId, nickname: item.toNickname, connectionId },
    // The challenge row's own revision. Never `null`: that is saveRoom's
    // "must not exist" signal, and the row we are promoting plainly exists.
    expectedRevision: item.revision,
  });

  if (error) {
    item.status = 'declined';
    await saveChallenge(item);
    await setLobbyStatus(connectionId, 'IN_LOBBY');
    await releaseStatus(item.fromPlayerId, 'IN_LOBBY');
    await notifyChallenger(item, 'unavailable');
    await pushRoster();
    return fail(connectionId, error, 409);
  }

  if (fromConnectionId) {
    await setLobbyStatus(fromConnectionId, 'IN_GAME').catch(() => {});
  }
  await pushRoster();
  return { statusCode: 200, body: room.roomId };
};

/**
 * Leave the duel lobby without touching any match in progress.
 *
 * Removes the status attribute outright rather than setting a status: the roster
 * is "players currently looking for a duel", so someone who backs out of the
 * Online Duel screen (or goes to sit in their own code room) should disappear
 * from it instead of lingering as challengeable.
 */
const leave = async (connectionId) => {
  await docClient.update({
    TableName: PLAYERS(),
    Key: { connectionId, roomId: 'main' },
    UpdateExpression: 'REMOVE #s',
    ConditionExpression: 'attribute_exists(connectionId)',
    ExpressionAttributeNames: { '#s': 'lobbyStatus' },
  }).catch(() => {});
  updateCachedPlayer(connectionId, { lobbyStatus: undefined });
  await pushRoster();
  return { statusCode: 200, body: 'Left lobby' };
};

/** Release the lobby slot when a socket dies while merely listed in the lobby. */
const handleDisconnect = async (connectionId) => {
  // The players row is deleted by $disconnect, which removes them from the
  // roster on its own; this only makes the departure visible immediately to
  // clients that are polling rather than waiting for their next read.
  await pushRoster().catch(() => {});
};

/**
 * Fail a lobby action and tell the person who asked.
 *
 * The `{ statusCode, body }` a WebSocket handler returns goes to API Gateway,
 * which does *not* route it back to the client — the only way a player learns
 * anything is a message pushed to their socket. Returning a 409 on its own is
 * how "that player is busy" turns into a button that appears to do nothing.
 */
const fail = async (connectionId, message, statusCode = 400) => {
  await send(connectionId, { type: 'LOBBY_ERROR', message }).catch(() => {});
  return { statusCode, body: message };
};

const handleMessage = async (event, payload) => {
  const connectionId = event.requestContext.connectionId;
  const identity = await identityOf(connectionId);
  if (!identity) return { statusCode: 200, body: 'No identity' };

  try {
    switch (payload.action) {
      case 'lobby:enter':
        return enter(connectionId, identity);
      case 'lobby:list':
        return list(connectionId, identity, String(payload.resumeRoomId || ''));
      case 'lobby:challenge':
        return challenge(connectionId, identity, String(payload.targetPlayerId || ''));
      case 'lobby:respond':
        return respond(connectionId, identity, String(payload.challengeId || ''), payload.accept === true);
      case 'lobby:leave':
        return leave(connectionId);
      default:
        return fail(connectionId, 'Unknown lobby action');
    }
  } catch (err) {
    console.error('lobby handler failed:', err);
    return fail(connectionId, 'The lobby hit an error — please retry.', 500);
  }
};

module.exports = {
  CHALLENGE_MS,
  CHALLENGE_TTL_SECONDS,
  CHALLENGE_STATUSES,
  BUSY_STATUSES,
  freshChallenge,
  publicChallenge,
  publicRoster,
  publicOpenRooms,
  publicResume,
  isExpired,
  expireChallenge,
  handleMessage,
  handleDisconnect,
};
