const { broadcast, send, listPlayers, docClient, PLAYER_ROOM, allowAction, allowLocalAction, getPlayer } = require('../utils');
const { handleMessage } = require('../blackjack');
const { handleMessage: handleSosMessage } = require('../sos');
const { handleMessage: handleLobbyMessage } = require('../lobby');

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Multiplayer Blackjack - engine handles state server-side, do not broadcast raw
  if (typeof payload.action === 'string' && payload.action.startsWith('bj:')) {
    return handleMessage(event, payload);
  }

  // Square of Shadows duel lobby - roster + challenges. Routed before sos: so a
  // challenge can never be mistaken for a room action.
  if (typeof payload.action === 'string' && payload.action.startsWith('lobby:')) {
    return handleLobbyMessage(event, payload);
  }

  // Square of Shadows online rooms - authoritative engine, never broadcast raw
  if (typeof payload.action === 'string' && payload.action.startsWith('sos:')) {
    return handleSosMessage(event, payload);
  }

  // Heartbeat - reply to the sender only so it keeps the connection alive
  // and lets the client detect a silently-dead socket (no idle drop).
  if (payload.action === 'ping') {
    await send(connectionId, { type: 'pong', ts: Date.now() });
    return { statusCode: 200, body: 'pong' };
  }

  // Game presence - persist which game a player is in and notify the lobby
  if (payload.action === 'gameStatus') {
    const game = typeof payload.game === 'string' && payload.game.length <= 40 ? payload.game : null;
    const player = await getPlayer(connectionId);
    try {
      await docClient.update({
        TableName: process.env.PLAYERS_TABLE_NAME,
        Key: { connectionId, roomId: PLAYER_ROOM },
        UpdateExpression: 'SET currentGame = :g',
        ConditionExpression: 'attribute_exists(connectionId)',
        ExpressionAttributeValues: { ':g': game },
      });
    } catch (err) {
      console.error('gameStatus persist failed:', err);
    }
    await broadcast({ type: 'playerGame', player: { playerId: player.playerId, currentGame: game } });
    return { statusCode: 200, body: 'Game status updated' };
  }

  // Emotes / gestures - floating bubble above the sender's avatar
  if (payload.action === 'emote') {
    const allowedEmotes = new Set(['👋', '🎉', '🤝', '💪', '🔥', '😎', '🙌']);
    if (!allowedEmotes.has(payload.emote)) return { statusCode: 400, body: 'Invalid emote' };
    if (!(await allowAction(connectionId, 'emote', 2000))) {
      return { statusCode: 429, body: 'Emote rate limited' };
    }
    const player = await getPlayer(connectionId);
    await broadcast({
      type: 'emote',
      player: { playerId: player.playerId, nickname: player.nickname || 'Player', avatarColor: player.avatarColor || '#4a90e2', avatarImage: player.avatarImage || null },
      emote: payload.emote,
      ts: Date.now(),
    });
    return { statusCode: 200, body: 'Emote broadcast' };
  }

  // Handle getSnapshot action - send current player list to requester
  if (payload.action === 'getSnapshot' || payload.type === 'getSnapshot') {
    const players = await listPlayers();
    await send(connectionId, { type: 'snapshot', players });
    return { statusCode: 200, body: 'Snapshot sent' };
  }

  // Broadcast message to connected clients
  // If it's a chat message, send to everyone (including sender) so they see their own message
  // For other events, exclude sender to prevent echo/jitter
  if (payload.type === 'chat') {
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (!message || message.length > 300) return { statusCode: 400, body: 'Invalid chat message' };
    if (!(await allowAction(connectionId, 'chat', 2000))) {
      return { statusCode: 429, body: 'Chat rate limited' };
    }
    const player = await getPlayer(connectionId);
    await broadcast({ type: 'chat', message, playerId: player.playerId, nickname: player.nickname || 'Player', timestamp: Date.now() });
    return { statusCode: 200, body: 'Message broadcast' };
  }
  if (payload.action === 'piano' && Number.isInteger(payload.midi) && payload.midi >= 21 && payload.midi <= 108) {
    if (!allowLocalAction(connectionId, 'piano', 80)) return { statusCode: 429, body: 'Piano rate limited' };
    const player = await getPlayer(connectionId);
    await broadcast({ type: 'piano', midi: payload.midi, playerId: player.playerId, nickname: player.nickname || 'Player', ts: Date.now() }, { exclude: connectionId });
    return { statusCode: 200, body: 'Piano note broadcast' };
  }
  return { statusCode: 400, body: 'Unsupported action' };
};
