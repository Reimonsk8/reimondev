const { broadcast, send, listPlayers, allowAction, getPlayer } = require('../utils');
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
  return { statusCode: 400, body: 'Unsupported action' };
};
