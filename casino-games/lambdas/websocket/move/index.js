const { docClient, PLAYER_ROOM, broadcast, send, getPlayer, updateCachedPlayer, allowLocalAction } = require('../utils');

const lastPersisted = new Map();

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  if (!allowLocalAction(connectionId, 'move', 50)) return { statusCode: 429, body: 'Movement rate limited' };
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const position = payload.position;
  const direction = payload.direction ?? 0;
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)
    || position.x < 0 || position.x > 2688 || position.y < 0 || position.y > 1512
    || !Number.isFinite(direction)) {
    return { statusCode: 400, body: 'Invalid movement' };
  }
  const isSmoking = payload.isSmoking === true;
  const smokeStart = Number.isFinite(payload.smokeStart) ? payload.smokeStart : null;
  let player;
  try {
    player = await getPlayer(connectionId);
  } catch {
    return { statusCode: 401, body: 'Unknown connection' };
  }
  const now = Date.now();
  const previous = player.position || { x: position.x, y: position.y };
  const elapsed = Math.max(0, now - (player.lastMoveAt || now));
  const maxDistance = position.game === 'outlands' || !player.lastMoveAt ? 3000 : 40 + elapsed * 0.4;
  if (Math.hypot(position.x - previous.x, position.y - previous.y) > maxDistance) {
    return { statusCode: 400, body: 'Movement too fast' };
  }
  updateCachedPlayer(connectionId, { position, direction, lastMoveAt: now });

  const broadcastPlayer = {
    connectionId,
    playerId: player.playerId,
    nickname: player.nickname || 'Player',
    avatarColor: player.avatarColor,
    avatarImage: player.avatarImage,
    avatarSize: player.avatarSize,
    position: { ...position, isSmoking, smokeStart },
    direction,
    isSmoking,
    smokeStart,
  };

  // Ack to sender FIRST so movement feels instant, then broadcast to others.
  // Broadcasting to N players sequentially before acking made sender latency
  // grow with the player count.
  await send(connectionId, {
    type: 'moveAck',
    position,
  });

  // Broadcast to OTHERS only (prevent echo/ghosting on client)
  await broadcast({ type: 'playerMoved', player: broadcastPlayer }, { exclude: connectionId });

  // Persist at most once/second: same expected writes as the old 10% sampling
  // at 10 moves/s, but deterministic enough for a new Lambda container.
  if (now - (lastPersisted.get(connectionId) || 0) >= 1000) {
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    // Helper to add update fields
    const addUpdate = (key, value, dbName) => {
      const attrName = `#${key}`;
      const attrVal = `:${key}`;
      updateExpressions.push(`${attrName} = ${attrVal}`);
      expressionAttributeNames[attrName] = dbName || key;
      expressionAttributeValues[attrVal] = value;
    };

    addUpdate('pos', { ...position, isSmoking, smokeStart }, 'position');
    addUpdate('dir', direction, 'direction');
    addUpdate('smk', isSmoking, 'isSmoking');
    addUpdate('sst', smokeStart, 'smokeStart');
    addUpdate('lma', now, 'lastMoveAt');

    try {
      await docClient.update({
        TableName: process.env.PLAYERS_TABLE_NAME,
        Key: { connectionId, roomId: PLAYER_ROOM },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ConditionExpression: 'attribute_exists(connectionId)',
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      });
      lastPersisted.set(connectionId, now);
    } catch (err) {
      console.error('Failed to persist move (throttled):', err);
      // Swallowing error to not break the movement flow
    }
  }

  return { statusCode: 200, body: 'Move processed' };
};
