const { randomBytes } = require('crypto');
const { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { getAddress, verifyMessage } = require('viem');

const db = new DynamoDBClient({ region: process.env.AWS_REGION });
const CHAIN_ID = 84532;

const response = (statusCode, body) => ({
  statusCode,
  headers: { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Allow-Methods': 'OPTIONS,GET,POST' },
  body: JSON.stringify(body),
});

const buildMessage = ({ domain, address, nonce, issuedAt, expirationTime }) => `${domain} wants you to sign in with your Ethereum account:
${address}

Link this testnet wallet to Casino888. No transaction or token approval is requested.

URI: ${domain}
Version: 1
Chain ID: ${CHAIN_ID}
Nonce: ${nonce}
Issued At: ${issuedAt}
Expiration Time: ${expirationTime}`;

exports.handler = async (event) => {
  try {
    const userId = event.requestContext?.authorizer?.claims?.sub;
    if (!userId) return response(401, { error: 'Unauthorized' });
    const userResult = await db.send(new GetItemCommand({ TableName: process.env.USERS_TABLE_NAME, Key: marshall({ userId }), ConsistentRead: true }));
    const user = userResult.Item ? unmarshall(userResult.Item) : null;
    if (!user || user.deletionStatus) return response(409, { error: 'Account deletion is in progress' });

    if (event.httpMethod === 'GET') {
      const result = await db.send(new GetItemCommand({ TableName: process.env.WALLET_LINKS_TABLE_NAME, Key: marshall({ recordId: `USER#${userId}` }) }));
      const item = result.Item ? unmarshall(result.Item) : null;
      return response(200, { address: item?.address || null, chainId: CHAIN_ID, network: 'Base Sepolia', testnet: true });
    }

    const body = JSON.parse(event.body || '{}');
    if (event.resource?.endsWith('/nonce')) {
      let address;
      try { address = getAddress(body.address); } catch { return response(400, { error: 'Invalid wallet address' }); }
      const nonce = randomBytes(16).toString('hex');
      const issuedAt = new Date().toISOString();
      const expirationTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const message = buildMessage({ domain: process.env.APP_ORIGIN, address, nonce, issuedAt, expirationTime });
      await db.send(new TransactWriteItemsCommand({ TransactItems: [
        { ConditionCheck: { TableName: process.env.USERS_TABLE_NAME, Key: marshall({ userId }), ConditionExpression: 'attribute_exists(userId) AND attribute_not_exists(deletionStatus)' } },
        { Put: { TableName: process.env.WALLET_LINKS_TABLE_NAME, Item: marshall({ recordId: `NONCE#${userId}`, userId, address, nonce, message, expiresAt: Math.floor(Date.now() / 1000) + 300, used: false }) } },
      ] }));
      return response(200, { address, chainId: CHAIN_ID, message });
    }

    const nonceResult = await db.send(new GetItemCommand({
      TableName: process.env.WALLET_LINKS_TABLE_NAME,
      Key: marshall({ recordId: `NONCE#${userId}` }),
      ConsistentRead: true,
    }));
    if (!nonceResult.Item) return response(400, { error: 'Nonce missing or expired' });
    const nonce = unmarshall(nonceResult.Item);
    if (nonce.used || nonce.expiresAt < Math.floor(Date.now() / 1000) || body.message !== nonce.message) return response(400, { error: 'Nonce missing or expired' });
    if (typeof body.signature !== 'string' || !(await verifyMessage({ address: nonce.address, message: nonce.message, signature: body.signature }))) {
      return response(401, { error: 'Invalid wallet signature' });
    }

    const linkedAt = new Date().toISOString();
    const currentResult = await db.send(new GetItemCommand({ TableName: process.env.WALLET_LINKS_TABLE_NAME, Key: marshall({ recordId: `USER#${userId}` }), ConsistentRead: true }));
    const current = currentResult.Item ? unmarshall(currentResult.Item) : null;
    if (current?.address && current.address.toLowerCase() !== nonce.address.toLowerCase()) {
      return response(409, { error: 'Unlink current wallet before linking another address' });
    }
    await db.send(new TransactWriteItemsCommand({ TransactItems: [
      { ConditionCheck: { TableName: process.env.USERS_TABLE_NAME, Key: marshall({ userId }), ConditionExpression: 'attribute_exists(userId) AND attribute_not_exists(deletionStatus)' } },
      { Update: {
        TableName: process.env.WALLET_LINKS_TABLE_NAME,
        Key: marshall({ recordId: `NONCE#${userId}` }),
        UpdateExpression: 'SET used = :true',
        ConditionExpression: 'used = :false AND expiresAt >= :now',
        ExpressionAttributeValues: marshall({ ':true': true, ':false': false, ':now': Math.floor(Date.now() / 1000) }),
      } },
      { Put: {
        TableName: process.env.WALLET_LINKS_TABLE_NAME,
        Item: marshall({ recordId: `ADDRESS#${nonce.address.toLowerCase()}`, userId, address: nonce.address, linkedAt }),
        ConditionExpression: 'attribute_not_exists(recordId) OR userId = :userId',
        ExpressionAttributeValues: marshall({ ':userId': userId }),
      } },
      { Put: { TableName: process.env.WALLET_LINKS_TABLE_NAME, Item: marshall({ recordId: `USER#${userId}`, userId, address: nonce.address, chainId: CHAIN_ID, linkedAt }) } },
    ] }));
    return response(200, { address: nonce.address, chainId: CHAIN_ID, network: 'Base Sepolia', testnet: true });
  } catch (err) {
    if (err.name === 'TransactionCanceledException') return response(409, { error: 'Wallet already linked or nonce already used' });
    console.error('Wallet link error:', err.name);
    return response(500, { error: 'Wallet link failed' });
  }
};

module.exports.buildMessage = buildMessage;
