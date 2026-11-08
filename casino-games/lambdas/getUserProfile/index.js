const {
    DynamoDBClient,
    GetItemCommand,
    PutItemCommand,
    UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");
const { unmarshall, marshall } = require("@aws-sdk/util-dynamodb");

let dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

exports.setDynamoDBClient = (client) => { dynamodb = client; };

exports.handler = async (event) => {
    try {
        if (event.httpMethod === 'POST') {
            return await updateProfile(event);
        }

        // Check for specific userId in query parameters (for viewing other profiles)
        const targetUserId = event.queryStringParameters?.userId;
        const authUserId = event.requestContext?.authorizer?.claims?.sub;

        let userId = authUserId;
        let isPublicRequest = false;

        if (targetUserId && targetUserId !== authUserId) {
            userId = targetUserId;
            isPublicRequest = true;
        }

        if (!userId) {
            return response(401, { error: "Unauthorized - no user ID found" });
        }

        // Get user from DynamoDB
        const getCommand = new GetItemCommand({
            TableName: process.env.USERS_TABLE_NAME,
            Key: marshall({ userId }),
        });

        const result = await dynamodb.send(getCommand);

        if (!result.Item) {
            if (isPublicRequest) {
                return response(404, { error: "User not found" });
            }

            // Create the shared player identity row on first sign-in.
            const claims = event.requestContext?.authorizer?.claims || {};
            const email = claims.email || '';
            const googleName = claims.name || '';
            const googlePicture = claims.picture || '';
            const newUser = {
                userId,
                email,
                nickname: googleName || email.split('@')[0] || 'Player',
                avatarImage: googlePicture || '',
                createdAt: new Date().toISOString(),
            };

            const putCommand = new PutItemCommand({
                TableName: process.env.USERS_TABLE_NAME,
                Item: marshall(newUser),
                ConditionExpression: 'attribute_not_exists(userId)',
            });

            try {
                await dynamodb.send(putCommand);
                result.Item = marshall(newUser);
            } catch (err) {
                if (err.name !== 'ConditionalCheckFailedException') throw err;
                const winner = await dynamodb.send(new GetItemCommand({
                    TableName: process.env.USERS_TABLE_NAME,
                    Key: marshall({ userId }),
                    ConsistentRead: true,
                }));
                if (!winner.Item) return response(404, { error: "User not found" });
                result.Item = winner.Item;
            }
        }

        let user = unmarshall(result.Item);
        if (user.deletionStatus === 'DELETING') return response(409, { error: "Account deletion is in progress" });

        // Backfill Google name/avatar for users created before attribute mapping existed
        if (!isPublicRequest) {
            const claims = event.requestContext?.authorizer?.claims || {};
            const googleName = claims.name || '';
            const googlePicture = claims.picture || '';
            for (const [field, value] of [['nickname', googleName], ['avatarImage', googlePicture]]) {
                if (user[field] || !value) continue;
                try {
                    const updated = await dynamodb.send(new UpdateItemCommand({
                        TableName: process.env.USERS_TABLE_NAME,
                        Key: marshall({ userId }),
                        UpdateExpression: 'SET #field = :value',
                        ConditionExpression: `attribute_exists(userId) AND (attribute_not_exists(#field) OR #field = :empty)${field === 'avatarImage' ? ' AND attribute_not_exists(avatarCustomized)' : ''}`,
                        ExpressionAttributeNames: { '#field': field },
                        ExpressionAttributeValues: marshall({ ':value': value, ':empty': '' }),
                        ReturnValues: 'ALL_NEW',
                    }));
                    user = unmarshall(updated.Attributes);
                } catch (err) {
                    if (err.name !== 'ConditionalCheckFailedException') throw err;
                    const current = await dynamodb.send(new GetItemCommand({
                        TableName: process.env.USERS_TABLE_NAME,
                        Key: marshall({ userId }),
                        ConsistentRead: true,
                    }));
                    if (!current.Item) return response(404, { error: "User not found" });
                    user = unmarshall(current.Item);
                }
            }
        }

        const responseData = {
            userId: user.userId,
            nickname: user.nickname || user.email?.split('@')[0] || 'Player',
            avatarImage: user.avatarImage || '',
        };

        // Only include private info if requesting own profile
        if (!isPublicRequest) {
            responseData.email = user.email;
        }

        return response(200, responseData);
    } catch (err) {
        console.error("GetUserProfile error:", err);
        return response(500, { error: err.message || "Failed to get user profile" });
    }
};

async function updateProfile(event) {
    const authUserId = event.requestContext?.authorizer?.claims?.sub;
    if (!authUserId) {
        return response(401, { error: "Unauthorized - no user ID found" });
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (err) {
        return response(400, { error: "Invalid JSON body" });
    }

    const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
    if (!nickname || nickname.length > 30) {
        return response(400, { error: "Nickname must be between 1 and 30 characters." });
    }

    const expr = ['nickname = :nickname'];
    const values = { ':nickname': { S: nickname } };

    if (typeof body.avatarImage === 'string' && body.avatarImage.length <= 500000) {
        expr.push('avatarImage = :avatarImage');
        expr.push('avatarCustomized = :avatarCustomized');
        values[':avatarImage'] = { S: body.avatarImage };
        values[':avatarCustomized'] = { BOOL: true };
    }

    try {
        await dynamodb.send(new UpdateItemCommand({
            TableName: process.env.USERS_TABLE_NAME,
            Key: marshall({ userId: authUserId }),
            UpdateExpression: `SET ${expr.join(', ')}`,
            ConditionExpression: 'attribute_exists(userId) AND attribute_not_exists(deletionStatus)',
            ExpressionAttributeValues: values,
        }));
    } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') {
            return response(404, { error: "User not found" });
        }
        throw err;
    }

    return response(200, { nickname, updated: true });
}

function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
        },
        body: JSON.stringify(body),
    };
}
