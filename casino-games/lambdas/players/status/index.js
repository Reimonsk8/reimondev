const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocument } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocument.from(dynamoClient);

const nicknameFrom = (user = {}) => {
  if (user.nickname) return user.nickname;
  if (user.email) {
    const [prefix] = user.email.split('@');
    if (prefix) return prefix;
  }
  return 'Player';
};

exports.handler = async () => {
  try {
    const [connectionsResult, usersResult] = await Promise.all([
      docClient.scan({
        TableName: process.env.CONNECTIONS_TABLE_NAME,
        ProjectionExpression: 'playerId',
      }),
      docClient.scan({
        TableName: process.env.USERS_TABLE_NAME,
        ProjectionExpression: 'userId, email, nickname',
      }),
    ]);

    const onlineUsers = new Set(
      (connectionsResult.Items || [])
        .map((record) => record.playerId)
        .filter(Boolean),
    );

    const players = (usersResult.Items || []).map((user) => ({
      userId: user.userId,
      nickname: nicknameFrom(user),
      status: onlineUsers.has(user.userId) ? 'online' : 'offline',
    }));

    const responseBody = {
      players,
      totalPlayers: players.length,
      onlinePlayers: players.filter((player) => player.status === 'online').length,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      },
      body: JSON.stringify(responseBody),
    };
  } catch (error) {
    console.error('Unable to load lobby players list', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to load players' }),
    };
  }
};
