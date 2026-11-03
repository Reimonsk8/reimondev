const { docClient, PLAYER_ROOM, broadcast, verifyToken } = require('../utils');

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  try {
    const token = event.queryStringParameters?.token || event.headers?.Authorization;
    const queryNickname = event.queryStringParameters?.nickname;
    const queryAvatarColor = event.queryStringParameters?.avatarColor;
    const queryAvatarSize = event.queryStringParameters?.avatarSize;
    let payload;
    try {
      payload = await verifyToken(token);
    } catch (err) {
      console.log('Rejecting connection: invalid token -', err.message);
      return { statusCode: 401, body: 'Unauthorized' };
    }

    // Identity comes only from the verified token, never from query params
    const playerId = payload.sub;

    // Authoritative profile from the users table (stored at getUserProfile time:
    // Google name/picture, or the first-login nickname). Falls back to token
    // claims / client query params only when the user row is missing.
    let storedUser = null;
    try {
      const userRes = await docClient.get({
        TableName: process.env.USERS_TABLE_NAME,
        Key: { userId: playerId },
        ConsistentRead: true,
      });
      storedUser = userRes.Item || null;
      if (storedUser?.deletionStatus) return { statusCode: 403, body: 'Account deletion in progress' };
    } catch (err) {
      console.warn('Profile lookup failed:', err);
      return { statusCode: 500, body: 'Profile lookup failed' };
    }

    const nickname =
      (storedUser && storedUser.nickname) ||
      (queryNickname && queryNickname.trim()) ||
      payload.name ||
      payload['custom:nickname'] ||
      payload.email ||
      'Player';
    const avatarImage = (storedUser && storedUser.avatarImage) || payload.picture || null;

    // Zombie Killer: Detect and remove old connections for this user to prevent ghosts
    try {
      // Find any existing players with this playerId
      const existing = await docClient.scan({
        TableName: process.env.PLAYERS_TABLE_NAME,
        FilterExpression: 'playerId = :pid',
        ExpressionAttributeValues: { ':pid': playerId }
      });

      // Delete their records (kick the ghosts)
      if (existing.Items && existing.Items.length > 0) {
        console.log(`Removing ${existing.Items.length} ghost connections for ${playerId}`);
        const deletePromises = existing.Items.map(item =>
          docClient.delete({
            TableName: process.env.PLAYERS_TABLE_NAME,
            Key: { connectionId: item.connectionId, roomId: item.roomId }
          })
        );
        await Promise.all(deletePromises);
      }
    } catch (err) {
      console.warn('Zombie killer warning:', err); // Non-fatal
    }

    const ttl = Math.floor(Date.now() / 1000) + 3 * 3600;
    const player = {
      connectionId,
      roomId: PLAYER_ROOM,
      playerId,
      userId: playerId,
      nickname,
      status: 'online',
      position: { x: 1344, y: 980, isSmoking: false }, // Frontend spawn in scaled world
      direction: 0,
      avatarColor: queryAvatarColor || '#4a90e2',
      avatarSize: parseInt(queryAvatarSize) || 80,
      avatarImage, // Server-authoritative (users table) or token picture
      isSmoking: false,
      ttl,
      lastMoveAt: Date.now(),
    };

    await docClient.transactWrite({ TransactItems: [
      { ConditionCheck: { TableName: process.env.USERS_TABLE_NAME, Key: { userId: playerId }, ConditionExpression: 'attribute_exists(userId) AND attribute_not_exists(deletionStatus)' } },
      { Put: { TableName: process.env.PLAYERS_TABLE_NAME, Item: player } },
      { Put: { TableName: process.env.CONNECTIONS_TABLE_NAME, Item: { connectionId, playerId, userId: playerId, ttl } } },
    ] });

    // NOTE: Cannot send messages during $connect - connection not ready yet
    // The snapshot will be sent via a separate "getSnapshot" action after connect
    // Broadcast playerJoined to existing connections (excludes self)
    try {
      await broadcast({ type: 'playerJoined', player }, { exclude: connectionId });
    } catch (err) {
      console.log('Broadcast error (non-fatal):', err.message);
    }

    return { statusCode: 200, body: 'Connected' };
  } catch (error) {
    console.error('Connect handler error:', error);
    await Promise.allSettled([
      docClient.delete({ TableName: process.env.PLAYERS_TABLE_NAME, Key: { connectionId, roomId: PLAYER_ROOM } }),
      docClient.delete({ TableName: process.env.CONNECTIONS_TABLE_NAME, Key: { connectionId } }),
    ]);
    return { statusCode: 500, body: 'Connection setup failed' };
  }
};
