const { CognitoIdentityProviderClient, AdminDeleteUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const {
  DynamoDBClient,
  DeleteItemCommand,
  PutItemCommand,
  ScanCommand,
  QueryCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');
const { ApiGatewayManagementApiClient, DeleteConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { handleDisconnect: disconnectSos } = require('../websocket/sos');
const { handleDisconnect: disconnectLobby } = require('../websocket/lobby');

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
const ddb = new DynamoDBClient({ region: process.env.AWS_REGION });
const websocket = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_ENDPOINT?.replace(/^wss:/i, 'https:'),
});

exports.handler = async (event) => {
  try {
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;
    const username = claims['cognito:username'] || userId;
    if (!userId) return response(401, { error: 'Unauthorized - no user ID found' });

    // Tombstone first so a concurrent WebSocket connect cannot recreate the profile.
    await ddb.send(new UpdateItemCommand({
      TableName: process.env.USERS_TABLE_NAME,
      Key: marshall({ userId }),
      UpdateExpression: 'SET deletionStatus = :status, deletionRequestedAt = :now',
      ConditionExpression: 'attribute_exists(userId)',
      ExpressionAttributeValues: marshall({ ':status': 'DELETING', ':now': new Date().toISOString() }),
    }));

    const connections = [];
    let lastKey;
    do {
      const result = await ddb.send(new ScanCommand({
        TableName: process.env.CONNECTIONS_TABLE_NAME,
        FilterExpression: 'userId = :uid',
        ExpressionAttributeValues: marshall({ ':uid': userId }),
        ExclusiveStartKey: lastKey,
      }));
      for (const item of result.Items || []) connections.push(unmarshall(item).connectionId);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    // Release the player's SoS room/lobby state before closing their socket.
    for (const connectionId of connections) {
      await disconnectSos(connectionId).catch((error) => console.warn('SoS account cleanup skipped:', error.message));
      await disconnectLobby(connectionId).catch((error) => console.warn('Lobby account cleanup skipped:', error.message));
      await websocket.send(new DeleteConnectionCommand({ ConnectionId: connectionId })).catch((error) => {
        if (error.name !== 'GoneException' && error.$metadata?.httpStatusCode !== 410) throw error;
      });
    }

    let playerKey;
    do {
      const result = await ddb.send(new QueryCommand({
        TableName: process.env.PLAYERS_TABLE_NAME,
        IndexName: 'userIdIndex',
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: marshall({ ':uid': userId }),
        ExclusiveStartKey: playerKey,
      }));
      for (const item of result.Items || []) {
        const player = unmarshall(item);
        await ddb.send(new DeleteItemCommand({
          TableName: process.env.PLAYERS_TABLE_NAME,
          Key: marshall({ connectionId: player.connectionId, roomId: player.roomId }),
        }));
      }
      playerKey = result.LastEvaluatedKey;
    } while (playerKey);

    for (const connectionId of connections) {
      await ddb.send(new DeleteItemCommand({
        TableName: process.env.CONNECTIONS_TABLE_NAME,
        Key: marshall({ connectionId }),
      }));
    }

    // Remove profile PII before deleting the external identity. Keep only an
    // anonymous tombstone if the Cognito deletion must be retried.
    await ddb.send(new PutItemCommand({
      TableName: process.env.USERS_TABLE_NAME,
      Item: marshall({ userId, deletionStatus: 'DELETING', deletionRequestedAt: new Date().toISOString() }),
      ConditionExpression: 'deletionStatus = :status',
      ExpressionAttributeValues: marshall({ ':status': 'DELETING' }),
    }));

    try {
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: username }));
    } catch (error) {
      if (error.name !== 'UserNotFoundException') throw error;
    }

    return response(200, { message: 'Account deleted successfully.' });
  } catch (error) {
    console.error('Delete account error:', error);
    return response(500, { error: 'Failed to delete account' });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'OPTIONS,POST',
    },
    body: JSON.stringify(body),
  };
}
