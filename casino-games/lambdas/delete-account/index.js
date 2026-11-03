const {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const {
  DynamoDBClient,
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");
const { ApiGatewayManagementApiClient, DeleteConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
const ddb = new DynamoDBClient({ region: process.env.AWS_REGION });
const websocket = new ApiGatewayManagementApiClient({ endpoint: process.env.WEBSOCKET_ENDPOINT?.replace(/^wss:/i, 'https:') });

exports.handler = async (event) => {
  try {
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;
    const username = claims['cognito:username'] || userId;
    if (!userId) {
      return response(401, { error: "Unauthorized - no user ID found" });
    }

    // Tombstone blocks new wallet/profile/game operations while cleanup runs.
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.USERS_TABLE_NAME,
      Key: marshall({ userId }),
      UpdateExpression: 'SET deletionStatus = :status, deletionRequestedAt = :now',
      ConditionExpression: 'attribute_exists(userId)',
      ExpressionAttributeValues: marshall({ ':status': 'DELETING', ':now': new Date().toISOString() }),
    }));

    const connectionIds = [];
    let lastKey;
    do {
      const result = await ddb.send(new ScanCommand({
        TableName: process.env.CONNECTIONS_TABLE_NAME,
        FilterExpression: 'userId = :uid',
        ExpressionAttributeValues: marshall({ ':uid': userId }),
        ExclusiveStartKey: lastKey,
      }));
      for (const item of result.Items || []) connectionIds.push(unmarshall(item).connectionId);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    await Promise.all(connectionIds.map((connectionId) => websocket.send(new DeleteConnectionCommand({ ConnectionId: connectionId })).catch((err) => {
      if (err.name !== 'GoneException' && err.$metadata?.httpStatusCode !== 410) throw err;
    })));

    // Re-read after tombstoning to close the check/start race.
    const currentRoomResult = await ddb.send(new GetItemCommand({ TableName: process.env.BLACKJACK_ROOMS_TABLE_NAME, Key: marshall({ roomId: 'bj-main' }), ConsistentRead: true }));
    if (currentRoomResult.Item) {
      const room = unmarshall(currentRoomResult.Item);
      const activeSeat = (room.seats || []).find((seat) => seat.playerId === userId && seat.inRound === true);
      if (activeSeat && room.settled === false) {
        return response(409, { error: 'Finish the active blackjack round before deleting your account.' });
      }
      const seats = (room.seats || []).filter((seat) => seat.playerId !== userId);
      const spectatorConnections = (room.spectators || []).filter((connectionId) => !connectionIds.includes(connectionId));
      const chat = (room.chat || []).filter((message) => message.playerId !== userId);
      if (seats.length !== (room.seats || []).length || spectatorConnections.length !== (room.spectators || []).length || chat.length !== (room.chat || []).length) {
        const expectedVersion = room.version || 0;
        room.seats = seats;
        room.spectators = spectatorConnections;
        room.chat = chat;
        room.version = expectedVersion + 1;
        await ddb.send(new PutItemCommand({
          TableName: process.env.BLACKJACK_ROOMS_TABLE_NAME,
          Item: marshall(room, { removeUndefinedValues: true }),
          ConditionExpression: expectedVersion ? '#version = :expected' : 'attribute_not_exists(#version)',
          ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues: expectedVersion ? marshall({ ':expected': expectedVersion }) : undefined,
        }));
      }
    }

    // 3. Delete all transactions for this user
    let exclusiveStartKey;
    do {
      const txResult = await ddb.send(new QueryCommand({
        TableName: process.env.TRANSACTIONS_TABLE_NAME,
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: marshall({ ':uid': userId }),
        ExclusiveStartKey: exclusiveStartKey,
      }));
      for (const item of txResult.Items || []) {
        const tx = unmarshall(item);
        await ddb.send(new DeleteItemCommand({
          TableName: process.env.TRANSACTIONS_TABLE_NAME,
          Key: marshall({ userId: tx.userId, timestamp: tx.timestamp }),
        }));
      }
      exclusiveStartKey = txResult.LastEvaluatedKey;
    } while (exclusiveStartKey);

    // Delete fairness state and game rounds for this user.
    exclusiveStartKey = undefined;
    do {
      const roundsResult = await ddb.send(new QueryCommand({
        TableName: process.env.GAME_ROUNDS_TABLE_NAME,
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: marshall({ ':uid': userId }),
        ExclusiveStartKey: exclusiveStartKey,
      }));
      for (const item of roundsResult.Items || []) {
        const round = unmarshall(item);
        await ddb.send(new DeleteItemCommand({
          TableName: process.env.GAME_ROUNDS_TABLE_NAME,
          Key: marshall({ userId, recordId: round.recordId }),
        }));
      }
      exclusiveStartKey = roundsResult.LastEvaluatedKey;
    } while (exclusiveStartKey);

    const walletLinkResult = await ddb.send(new GetItemCommand({
      TableName: process.env.WALLET_LINKS_TABLE_NAME,
      Key: marshall({ recordId: `USER#${userId}` }),
    }));
    const walletLink = walletLinkResult.Item ? unmarshall(walletLinkResult.Item) : null;
    const walletRecords = [`USER#${userId}`, `NONCE#${userId}`];
    if (walletLink?.address) walletRecords.push(`ADDRESS#${walletLink.address.toLowerCase()}`);
    for (const recordId of walletRecords) {
      await ddb.send(new DeleteItemCommand({
        TableName: process.env.WALLET_LINKS_TABLE_NAME,
        Key: marshall({ recordId }),
      }));
    }

    // 4. Delete player rows for this user (players keyed by connectionId+roomId, has userIdIndex GSI)
    lastKey = undefined;
    do {
      const playersResult = await ddb.send(new QueryCommand({
        TableName: process.env.PLAYERS_TABLE_NAME,
        IndexName: 'userIdIndex',
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: marshall({ ':uid': userId }),
        ExclusiveStartKey: lastKey,
      }));
      for (const item of playersResult.Items || []) {
        const row = unmarshall(item);
        await ddb.send(new DeleteItemCommand({
          TableName: process.env.PLAYERS_TABLE_NAME,
          Key: marshall({ connectionId: row.connectionId, roomId: row.roomId }),
        }));
      }
      lastKey = playersResult.LastEvaluatedKey;
    } while (lastKey);

    for (const connectionId of connectionIds) await ddb.send(new DeleteItemCommand({ TableName: process.env.CONNECTIONS_TABLE_NAME, Key: marshall({ connectionId }) }));

    // Strip PII and balance before deleting external identity. If the final
    // delete fails, only an anonymous tombstone remains.
    await ddb.send(new PutItemCommand({
      TableName: process.env.USERS_TABLE_NAME,
      Item: marshall({ userId, deletionStatus: 'DELETING', deletionRequestedAt: new Date().toISOString() }),
      ConditionExpression: 'deletionStatus = :status',
      ExpressionAttributeValues: marshall({ ':status': 'DELETING' }),
    }));

    // Delete identity only after all child records are gone, so failures above
    // remain retryable by the authenticated user.
    try {
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: username }));
    } catch (err) {
      if (err.name !== 'UserNotFoundException') throw err;
    }

    return response(200, { message: "Account deleted successfully." });
  } catch (err) {
    console.error("Delete account error:", err);
    return response(500, { error: "Failed to delete account" });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "OPTIONS,POST",
    },
    body: JSON.stringify(body),
  };
}
