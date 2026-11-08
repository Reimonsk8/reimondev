const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocument } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApi } = require('@aws-sdk/client-apigatewaymanagementapi');
const jwt = require('jsonwebtoken');
const { createPublicKey } = require('crypto');

const dynamoClient = new DynamoDBClient({});
// Ignore undefined values from partial player/profile updates. Use null (not
// undefined) when an explicit DynamoDB NULL is required.
const docClient = DynamoDBDocument.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const PLAYER_ROOM = 'main';

const getMgmt = () => {
  const endpoint = process.env.WEBSOCKET_ENDPOINT?.replace(/^wss:/i, 'https:');
  return new ApiGatewayManagementApi({ endpoint });
};

// ponytail: cached Cognito JWKS (1h TTL). Replaces the old base64-only decodeToken:
// signatures are now verified against the user pool's public keys.
let jwksCache = null;
const playerCache = new Map();
const localActionTimes = new Map();

const getJwks = async () => {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < 3600 * 1000) {
    return jwksCache.keys;
  }
  const res = await fetch(
    `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.USER_POOL_ID}/.well-known/jwks.json`,
  );
  if (!res.ok) {
    throw new Error('Failed to fetch Cognito JWKS');
  }
  const data = await res.json();
  jwksCache = { keys: data.keys || [], fetchedAt: now };
  return jwksCache.keys;
};

const verifyToken = async (token) => {
  if (!token) {
    throw new Error('Missing token');
  }
  const sanitized = token.replace(/^Bearer\s+/i, '');
  const parts = sanitized.split('.');
  if (parts.length < 3) {
    throw new Error('Malformed token');
  }
  const header = JSON.parse(Buffer.from(parts[0], 'base64').toString('utf-8'));
  const keys = await getJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new Error('Unknown signing key');
  }
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  return jwt.verify(sanitized, key, {
    algorithms: ['RS256'],
    audience: process.env.USER_POOL_CLIENT_ID,
    issuer: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.USER_POOL_ID}`,
  });
};

const send = async (connectionId, payload) => {
  const api = getMgmt();
  try {
    await api.postToConnection({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(payload)),
    });
  } catch (err) {
    if (err.statusCode === 410) {
      await docClient.delete({
        TableName: process.env.CONNECTIONS_TABLE_NAME,
        Key: { connectionId },
      });
    }
  }
};

const getPlayer = async (connectionId) => {
  const cached = playerCache.get(connectionId);
  if (cached && cached.expiresAt > Date.now()) return cached.player;
  const result = await docClient.get({
    TableName: process.env.PLAYERS_TABLE_NAME,
    Key: { connectionId, roomId: PLAYER_ROOM },
  });
  if (!result.Item) throw new Error('Unknown connection');
  playerCache.set(connectionId, { player: result.Item, expiresAt: Date.now() + 300000 });
  return result.Item;
};

const updateCachedPlayer = (connectionId, updates) => {
  const cached = playerCache.get(connectionId);
  if (cached) cached.player = { ...cached.player, ...updates };
};

/**
 * Verified identity for a socket: `{ playerId, nickname }` straight from the
 * players row written at connect, or null when the socket is unknown.
 *
 * Shared by every room module so there is exactly one place that turns a
 * connection id into a player identity — a second copy is how a handler ends up
 * trusting a client-supplied name.
 *
 * `readPlayer` is injectable so a caller that routes its transport through a
 * test seam (`sos.js`) can have this use the *same* stubbed read, rather than
 * quietly hitting the real table behind the seam.
 */
const identityOf = async (connectionId, readPlayer = getPlayer) => {
  let player;
  try {
    player = await readPlayer(connectionId);
  } catch {
    return null;
  }
  return { playerId: player.playerId || player.userId, nickname: player.nickname || 'Player' };
};

const clearLocalActionTimes = () => localActionTimes.clear();

const broadcast = async (payload, { exclude } = {}) => {
  const connections = await docClient.scan({
    TableName: process.env.CONNECTIONS_TABLE_NAME,
    ProjectionExpression: 'connectionId',
  });
  await Promise.all(
    (connections.Items || [])
      .filter((item) => item.connectionId !== exclude)
      .map((item) => send(item.connectionId, payload)),
  );
};

// Windowed rate limiter backed by the rate-limits table.
// Bucket = now / windowMs, so one conditional put per window gates the action;
// the TTL attribute reaps old buckets. Fail-open on non-conditional errors so a
// table hiccup never blocks a player. windowMs is roughly a cooldown, not an
// exact ceiling (bucket boundaries are wall-clock aligned).
const allowAction = async (connectionId, action, windowMs) => {
  const bucket = Math.floor(Date.now() / windowMs);
  const key = `${connectionId}:${action}:${bucket}`;
  try {
    await docClient.put({
      TableName: process.env.RATE_LIMITS_TABLE_NAME,
      Item: {
        key,
        ttl: Math.floor(Date.now() / 1000) + Math.ceil(windowMs / 1000) + 1,
      },
      ConditionExpression: 'attribute_not_exists(#k)',
      ExpressionAttributeNames: { '#k': 'key' },
    });
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    console.error('allowAction skipped (fail-open):', err);
    return true;
  }
};

// Per-container throttle for high-frequency cosmetic actions. Stage throttling
// remains the account-wide backstop without adding a DynamoDB write per move.
const allowLocalAction = (connectionId, action, windowMs) => {
  const key = `${connectionId}:${action}`;
  const now = Date.now();
  if (now - (localActionTimes.get(key) || 0) < windowMs) return false;
  localActionTimes.set(key, now);
  if (localActionTimes.size > 1000) {
    for (const [entry, timestamp] of localActionTimes) if (now - timestamp > 60000) localActionTimes.delete(entry);
  }
  return true;
};

const listPlayers = async () => {
  const result = await docClient.scan({
    TableName: process.env.PLAYERS_TABLE_NAME,
    FilterExpression: '#room = :room',
    ExpressionAttributeNames: { '#room': 'roomId' },
    ExpressionAttributeValues: { ':room': PLAYER_ROOM },
  });

  const now = Math.floor(Date.now() / 1000);

  // Filter out stale players (expired TTL) and ensure valid data
  const rawPlayers = (result.Items || [])
    .filter((player) => {
      // Filter out expired players
      if (player.ttl && player.ttl < now) return false;
      // Filter out players without valid playerId
      if (!player.playerId || player.playerId === 'guest') return false;
      return true;
    })
    .map((player) => ({
      ...player,
      nickname: player.nickname || 'Player',
    }));

  // Deduplicate by playerId to prevent multiple ghost instances of the same user
  const uniquePlayers = new Map();
  rawPlayers.forEach(p => {
    // If multiple connections exist for same user, we keep the one with latest TTL or just the first one found
    if (!uniquePlayers.has(p.playerId)) {
      uniquePlayers.set(p.playerId, p);
    }
  });

  return Array.from(uniquePlayers.values());
};

module.exports = {
  docClient,
  PLAYER_ROOM,
  send,
  broadcast,
  listPlayers,
  verifyToken,
  allowAction,
  allowLocalAction,
  getPlayer,
  updateCachedPlayer,
  identityOf,
  clearLocalActionTimes,
};
