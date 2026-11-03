const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const GAME_INFO = {
    CoinFlip: { gameName: 'Coin Flip', gameId: 'coinflip-1' },
    CardGame: { gameName: 'Card Duel', gameId: 'cardgame-1' },
    LuckyWheel: { gameName: 'Lucky Wheel', gameId: 'luckywheel-1' },
    Slots: { gameName: 'Slot Machine', gameId: 'slots-1' },
    Blackjack: { gameName: 'Blackjack', gameId: 'blackjack-1' },
    Roulette: { gameName: 'Roulette', gameId: 'roulette-1' },
    Dice: { gameName: 'Dice', gameId: 'dice-1' },
};

function resolveGame(tx = {}) {
    const haystack = `${tx.gameName || ''} ${tx.gameDetails || ''}`;
    const key = Object.keys(GAME_INFO).find((game) => haystack.includes(game));
    return GAME_INFO[key] || { gameName: tx.gameName || 'Unknown', gameId: 'unknown' };
}

exports.handler = async (event) => {
    try {
        // Scan transactions table for all WIN transactions
        const scanCommand = new ScanCommand({
            TableName: process.env.TRANSACTIONS_TABLE_NAME,
            FilterExpression: '#type = :winType',
            ExpressionAttributeNames: {
                '#type': 'type',
            },
            ExpressionAttributeValues: {
                ':winType': 'WIN',
            },
        });

        const result = await docClient.send(scanCommand);
        const transactions = result.Items || [];

        // Group by game and find highest win for each
        const leaderboard = {};

        transactions.forEach((tx) => {
            const { gameName, gameId } = resolveGame(tx);

            const winAmount = Math.abs(parseFloat(tx.amount) || 0);

            // Get user info
            const userId = tx.userId || 'Unknown';
            const nickname = tx.nickname || userId.substring(0, 8);

            // Track highest win for this game
            if (!leaderboard[gameId] || winAmount > leaderboard[gameId].amount) {
                leaderboard[gameId] = {
                    username: nickname,
                    amount: winAmount,
                    userId: userId,
                    timestamp: tx.timestamp || tx.createdAt,
                    gameName: gameName,
                };
            }
        });

        // Also get user nicknames from Users table for better display
        const userIds = Object.values(leaderboard).map(entry => entry.userId);
        const uniqueUserIds = [...new Set(userIds)];

        // Fetch user details to get actual nicknames
        const userNicknames = {};
        for (const uid of uniqueUserIds) {
            try {
                const userCommand = new QueryCommand({
                    TableName: process.env.USERS_TABLE_NAME,
                    KeyConditionExpression: 'userId = :uid',
                    ExpressionAttributeValues: {
                        ':uid': uid,
                    },
                    Limit: 1,
                });
                const userResult = await docClient.send(userCommand);
                if (userResult.Items && userResult.Items.length > 0) {
                    const user = userResult.Items[0];
                    userNicknames[uid] = user.nickname || user.email?.split('@')[0] || uid.substring(0, 8);
                }
            } catch (err) {
                console.error('Error fetching user:', uid, err);
            }
        }

        // Update leaderboard with actual nicknames
        Object.keys(leaderboard).forEach(gameId => {
            const entry = leaderboard[gameId];
            if (userNicknames[entry.userId]) {
                entry.username = userNicknames[entry.userId];
            }
        });

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                'Access-Control-Allow-Methods': 'GET,OPTIONS',
            },
            body: JSON.stringify(leaderboard),
        };
    } catch (error) {
        console.error('Leaderboard error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
                error: 'Failed to load leaderboard',
                message: error.message
            }),
        };
    }
};

exports.resolveGame = resolveGame;
