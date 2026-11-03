const {
    DynamoDBClient,
    QueryCommand,
} = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

exports.handler = async (event) => {
    try {
        // Extract userId from Cognito authorizer
        const userId = event.requestContext?.authorizer?.claims?.sub;

        if (!userId) {
            return response(401, { error: "Unauthorized - no user ID found" });
        }

        // Query transactions for this user, sorted by timestamp descending
        const queryCommand = new QueryCommand({
            TableName: process.env.TRANSACTIONS_TABLE_NAME,
            KeyConditionExpression: "userId = :userId",
            ExpressionAttributeValues: {
                ":userId": { S: userId },
            },
            ScanIndexForward: false, // Sort descending (newest first)
            Limit: 50, // Last 50 transactions
        });

        const result = await dynamodb.send(queryCommand);

        const transactions = result.Items ? result.Items.map(item => unmarshall(item)) : [];

        return response(200, {
            transactions,
            count: transactions.length,
        });
    } catch (err) {
        console.error("GetTransactionHistory error:", err);
        return response(500, { error: err.message || "Failed to get transaction history" });
    }
};

function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "OPTIONS,GET",
        },
        body: JSON.stringify(body),
    };
}
