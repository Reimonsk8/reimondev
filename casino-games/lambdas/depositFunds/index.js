const {
    DynamoDBClient,
    GetItemCommand,
    TransactWriteItemsCommand,
} = require("@aws-sdk/client-dynamodb");
const { unmarshall, marshall } = require("@aws-sdk/util-dynamodb");
const { createHash } = require("crypto");

let dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
exports.setDynamoDBClient = (client) => { dynamodb = client; };

const validIdempotencyKey = (key) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key || '');
const operationRecordId = (key) => `WALLET#${createHash('sha256').update(key).digest('hex')}`;
const transactionTimestamp = (key) => Date.now() + (parseInt(createHash('sha256').update(key).digest('hex').slice(0, 3), 16) % 1000) / 1000;

exports.handler = async (event) => {
    try {
        const userId = event.requestContext?.authorizer?.claims?.sub;

        if (!userId) {
            return response(401, { error: "Unauthorized" });
        }

        const body = JSON.parse(event.body || "{}");
        const amount = typeof body.amount === 'number' ? body.amount : NaN;
        const idempotencyKey = body.idempotencyKey;
        if (!Number.isFinite(amount) || amount <= 0 || amount > 10000 || Number(amount.toFixed(2)) !== amount || !validIdempotencyKey(idempotencyKey)) {
            return response(400, { error: "Invalid amount" });
        }

        // Get current user balance
        const getCommand = new GetItemCommand({
            TableName: process.env.USERS_TABLE_NAME,
            Key: marshall({ userId }),
            ConsistentRead: true,
        });

        const userResult = await dynamodb.send(getCommand);

        if (!userResult.Item) {
            return response(404, { error: "User not found" });
        }

        const user = unmarshall(userResult.Item);
        if (user.deletionStatus) return response(409, { error: "Account deletion is in progress" });
        const recordId = operationRecordId(idempotencyKey);
        const existing = await dynamodb.send(new GetItemCommand({ TableName: process.env.GAME_ROUNDS_TABLE_NAME, Key: marshall({ userId, recordId }), ConsistentRead: true }));
        if (existing.Item) {
            const operation = unmarshall(existing.Item);
            return operation.type === 'DEPOSIT' && operation.amount === amount
                ? response(200, operation.response)
                : response(409, { error: "Idempotency key already used" });
        }
        const currentBalance = Number.isFinite(user.currentBalance) ? user.currentBalance : 0;
        const newBalance = (Math.round(currentBalance * 100) + Math.round(amount * 100)) / 100;

        // Atomic transaction: update balance + create transaction record
        const timestamp = transactionTimestamp(idempotencyKey);
        const transactionId = `deposit-${idempotencyKey}`;
        const operationResponse = { message: "Deposit successful", amount, newBalance };

        const transactCommand = new TransactWriteItemsCommand({
            TransactItems: [
                {
                    Update: {
                        TableName: process.env.USERS_TABLE_NAME,
                        Key: marshall({ userId }),
                        UpdateExpression: "SET currentBalance = :newBalance, updatedAt = :updatedAt",
                        ConditionExpression: "attribute_exists(userId) AND attribute_not_exists(deletionStatus) AND currentBalance = :currentBalance",
                        ExpressionAttributeValues: marshall({
                            ":newBalance": newBalance,
                            ":currentBalance": currentBalance,
                            ":updatedAt": new Date().toISOString(),
                        }),
                    },
                },
                {
                    Put: {
                        TableName: process.env.TRANSACTIONS_TABLE_NAME,
                        Item: marshall({
                            userId,
                            timestamp,
                            transactionId,
                            idempotencyKey,
                            type: "DEPOSIT",
                            amount,
                            balanceAfter: newBalance,
                            createdAt: new Date().toISOString(),
                        }),
                        ConditionExpression: 'attribute_not_exists(userId)',
                    },
                },
                {
                    Put: {
                        TableName: process.env.GAME_ROUNDS_TABLE_NAME,
                        Item: marshall({ userId, recordId, type: 'DEPOSIT', amount, idempotencyKey, response: operationResponse, createdAt: new Date().toISOString() }),
                        ConditionExpression: 'attribute_not_exists(userId)',
                    },
                },
            ],
        });

        await dynamodb.send(transactCommand);

        return response(200, operationResponse);
    } catch (err) {
        if (err.name === 'TransactionCanceledException') {
            const body = JSON.parse(event.body || '{}');
            if (validIdempotencyKey(body.idempotencyKey)) {
                const existing = await dynamodb.send(new GetItemCommand({
                    TableName: process.env.GAME_ROUNDS_TABLE_NAME,
                    Key: marshall({ userId: event.requestContext?.authorizer?.claims?.sub, recordId: operationRecordId(body.idempotencyKey) }),
                    ConsistentRead: true,
                }));
                const item = existing.Item ? unmarshall(existing.Item) : null;
                if (item?.type === 'DEPOSIT' && item.amount === body.amount) return response(200, item.response);
            }
            return response(409, { error: "Balance changed; retry operation" });
        }
        console.error("DepositFunds error:", err);
        return response(500, { error: err.message || "Deposit failed" });
    }
};

exports.operationRecordId = operationRecordId;

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
