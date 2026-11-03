const {
    DynamoDBClient,
    GetItemCommand,
    TransactWriteItemsCommand,
} = require("@aws-sdk/client-dynamodb");
const { unmarshall, marshall } = require("@aws-sdk/util-dynamodb");
const { randomUUID, randomInt } = require("crypto");
const { createServerSeed, hashSeed, createFairRng } = require('./fairness');

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

// Valid bet sides for each game type
const VALID_BETS = {
    // CoinFlip
    'cara': { game: 'CoinFlip', type: 'coinflip' },
    'cruz': { game: 'CoinFlip', type: 'coinflip' },
    // Card Game (red/black)
    'rojo': { game: 'CardGame', type: 'color' },
    'negro': { game: 'CardGame', type: 'color' },
    // Lucky Wheel
    'spin': { game: 'LuckyWheel', type: 'wheel' },
    // Slots
    'slots': { game: 'Slots', type: 'slots' },
    // Roulette
    'red': { game: 'Roulette', type: 'roulette' },
    'black': { game: 'Roulette', type: 'roulette' },
    'green': { game: 'Roulette', type: 'roulette' },
    'odd': { game: 'Roulette', type: 'roulette' },
    'even': { game: 'Roulette', type: 'roulette' },
    // Dice
    'high': { game: 'Dice', type: 'dice' },
    'low': { game: 'Dice', type: 'dice' },
    'dice-odd': { game: 'Dice', type: 'dice', normalizedSide: 'odd' },
    'dice-even': { game: 'Dice', type: 'dice', normalizedSide: 'even' },
};

// Parse bet side - handles complex bets like "number-7" or "exact-10"
function parseBetSide(side) {
    if (typeof side !== 'string' || !side) return null;

    const lowerSide = side.toLowerCase();

    // Check for exact match first
    if (VALID_BETS[lowerSide]) {
        const bet = VALID_BETS[lowerSide];
        return { ...bet, side: bet.normalizedSide || lowerSide };
    }

    // Handle number bets (e.g., "number-7" for roulette)
    if (/^number-\d+$/.test(lowerSide)) {
        const num = Number(lowerSide.slice(7));
        if (num >= 0 && num <= 36) {
            return { game: 'Roulette', type: 'roulette', side: lowerSide, target: num };
        }
    }

    // Handle exact dice bets (e.g., "exact-7")
    if (/^exact-\d+$/.test(lowerSide)) {
        const num = Number(lowerSide.slice(6));
        if (num >= 2 && num <= 12) {
            return { game: 'Dice', type: 'dice', side: lowerSide, target: num };
        }
    }

    return null;
}

function isValidAmount(amount) {
    const cents = amount * 100;
    return Number.isFinite(amount) && amount > 0 && amount <= 10000
        && Math.abs(cents - Math.round(cents)) <= 1e-8;
}

const validProofInput = (value, max) => typeof value === 'string' && value.length >= 8 && value.length <= max;

async function getFairness(userId) {
    const key = marshall({ userId, recordId: 'FAIRNESS' });
    const get = () => dynamodb.send(new GetItemCommand({
        TableName: process.env.GAME_ROUNDS_TABLE_NAME,
        Key: key,
        ConsistentRead: true,
    }));
    let result = await get();
    if (!result.Item) {
        const serverSeed = createServerSeed();
        try {
            await dynamodb.send(new TransactWriteItemsCommand({
                TransactItems: [
                    {
                        ConditionCheck: {
                            TableName: process.env.USERS_TABLE_NAME,
                            Key: marshall({ userId }),
                            ConditionExpression: 'attribute_exists(userId) AND attribute_not_exists(deletionStatus)',
                        },
                    },
                    {
                        Put: {
                            TableName: process.env.GAME_ROUNDS_TABLE_NAME,
                            Item: marshall({ userId, recordId: 'FAIRNESS', serverSeed, serverSeedHash: hashSeed(serverSeed), nonce: 0 }),
                            ConditionExpression: 'attribute_not_exists(userId)',
                        },
                    },
                ],
            }));
        } catch (err) {
            if (err.name !== 'TransactionCanceledException') throw err;
        }
        result = await get();
    }
    if (!result.Item) throw new Error('Fairness state unavailable');
    return unmarshall(result.Item);
}

// Calculate game result based on game type. `rng` is injectable so tests can
// drive deterministic outcomes; production uses crypto.randomInt.
function calculateGameResult(betInfo, betAmount, rng = randomInt) {
    const { game, type, side, target } = betInfo;

    let isWin = false;
    let multiplier = 2; // Default 2x payout
    let result = '';
    let symbolsResult = null;

    switch (type) {
        case 'coinflip': {
            result = rng(2) === 0 ? 'cara' : 'cruz';
            isWin = result === side;
            multiplier = 2;
            break;
        }

        case 'color': {
            // Card game - red or black
            result = rng(2) === 0 ? 'rojo' : 'negro';
            isWin = result === side;
            multiplier = 2;
            break;
        }

        case 'wheel': {
            // Lucky wheel - random win (40% chance)
            isWin = rng(100) < 40;
            multiplier = isWin ? (rng(4) + 2) : 0; // 2x to 5x
            result = isWin ? 'WIN' : 'LOSE';
            break;
        }

        case 'slots': {
            // Slots - 3 reels; 3 matching symbols pays the symbol multiplier, 2 matching pays 2x
            const SLOT_SYMBOLS = ['💎', '🍀', '🍒', '🍋', '🍊', '🍇', '🍉', '⭐'];
            const SLOT_PAYTABLE = {
                '💎': 50, '🍀': 25, '🍒': 15, '⭐': 10,
                '🍋': 8, '🍊': 6, '🍇': 5, '🍉': 4,
            };
            const reels = () => rng(SLOT_SYMBOLS.length);
            const symbols = [
                SLOT_SYMBOLS[reels()],
                SLOT_SYMBOLS[reels()],
                SLOT_SYMBOLS[reels()],
            ];
            symbolsResult = symbols;
            const allMatch = symbols[0] === symbols[1] && symbols[1] === symbols[2];
            const twoMatch = symbols[0] === symbols[1] || symbols[1] === symbols[2] || symbols[0] === symbols[2];
            if (allMatch) {
                isWin = true;
                multiplier = SLOT_PAYTABLE[symbols[0]] || 4;
                result = `JACKPOT ${symbols.join(' ')}`;
            } else if (twoMatch) {
                isWin = true;
                multiplier = 2;
                result = `WIN ${symbols.join(' ')}`;
            } else {
                isWin = false;
                multiplier = 0;
                result = `LOSE ${symbols.join(' ')}`;
            }
            break;
        }

        case 'roulette': {
            // Roulette - simulate wheel
            const ROULETTE_NUMBERS = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
            const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

            const winningNumber = ROULETTE_NUMBERS[rng(ROULETTE_NUMBERS.length)];
            const winningColor = winningNumber === 0 ? 'green' : (RED_NUMBERS.includes(winningNumber) ? 'red' : 'black');
            result = `${winningNumber} (${winningColor})`;

            if (side === 'red' || side === 'black') {
                isWin = winningColor === side;
                multiplier = 2;
            } else if (side === 'green') {
                isWin = winningNumber === 0;
                multiplier = 35;
            } else if (side === 'odd') {
                isWin = winningNumber !== 0 && winningNumber % 2 === 1;
                multiplier = 2;
            } else if (side === 'even') {
                isWin = winningNumber !== 0 && winningNumber % 2 === 0;
                multiplier = 2;
            } else if (side.startsWith('number-')) {
                isWin = winningNumber === target;
                multiplier = 35;
            }
            break;
        }

        case 'dice': {
            // Dice - roll two dice
            const die1 = rng(6) + 1;
            const die2 = rng(6) + 1;
            const total = die1 + die2;
            result = `${die1}+${die2}=${total}`;

            if (side === 'high') {
                isWin = total >= 8;
                multiplier = 2;
            } else if (side === 'low') {
                isWin = total <= 6;
                multiplier = 2;
            } else if (side === 'odd') {
                isWin = total % 2 === 1;
                multiplier = 2;
            } else if (side === 'even') {
                isWin = total % 2 === 0;
                multiplier = 2;
            } else if (side.startsWith('exact-')) {
                isWin = total === target;
                multiplier = 6;
            }
            break;
        }

        default:
            throw new Error('Unsupported bet type');
    }

    return { isWin, multiplier, result, game, symbols: symbolsResult };
}

// Wallet settlement math: how much the bet pays out and the balance delta.
function computeSettlement(betAmount, isWin, multiplier) {
    if (isWin) {
        const winAmount = betAmount * multiplier;
        return { winAmount, delta: winAmount - betAmount };
    }
    return { winAmount: 0, delta: -betAmount };
}

exports.handler = async (event) => {
    try {
        const userId = event.requestContext?.authorizer?.claims?.sub;

        if (!userId) {
            return response(401, { error: "Unauthorized" });
        }

        const userResult = await dynamodb.send(new GetItemCommand({
            TableName: process.env.USERS_TABLE_NAME,
            Key: marshall({ userId }),
            ConsistentRead: true,
        }));
        if (!userResult.Item) return response(404, { error: "User not found" });
        const user = unmarshall(userResult.Item);
        if (user.deletionStatus) return response(409, { error: "Account deletion is in progress" });

        if (event.httpMethod === 'GET') {
            const fairness = await getFairness(userId);
            return response(200, { serverSeedHash: fairness.serverSeedHash, nonce: fairness.nonce, algorithm: 'hmac-sha256-v1' });
        }

        const body = JSON.parse(event.body || "{}");
        const betAmount = typeof body.amount === 'number' ? body.amount : NaN;
        const betSide = body.side;
        const clientSeed = body.clientSeed;
        const expectedHash = body.serverSeedHash;
        const idempotencyKey = body.idempotencyKey;

        if (!isValidAmount(betAmount)) {
            return response(400, { error: "Invalid bet amount" });
        }
        if (!validProofInput(clientSeed, 128) || !/^[a-f0-9]{64}$/.test(expectedHash || '') || !validProofInput(idempotencyKey, 100)) {
            return response(400, { error: "Invalid fairness proof input" });
        }

        // Parse and validate bet
        const betInfo = parseBetSide(betSide);
        if (!betInfo) {
            return response(400, { error: "Invalid bet side" });
        }

        const roundId = hashSeed(`${userId}:${idempotencyKey}`);
        const roundKey = marshall({ userId, recordId: `ROUND#${roundId}` });
        const existingRound = await dynamodb.send(new GetItemCommand({
            TableName: process.env.GAME_ROUNDS_TABLE_NAME,
            Key: roundKey,
            ConsistentRead: true,
        }));
        if (existingRound.Item) return response(200, unmarshall(existingRound.Item).response);

        const fairness = await getFairness(userId);
        if (fairness.serverSeedHash !== expectedHash) {
            return response(409, { error: 'Fairness commitment changed; retry with current commitment' });
        }

        const currentBalance = user.currentBalance || 0;
        const nickname = user.nickname || user.email?.split('@')[0] || 'Player';
        // Bigger-wins stat: DynamoDB has no max()/greatest() update function, so
        // compute it here from the row we just read (best-effort under concurrency).
        const prevBiggestWin = user.biggestWin || 0;

        // Check sufficient funds
        if (currentBalance < betAmount) {
            return response(400, { error: "Insufficient funds" });
        }

        // Calculate game result
        const fairRng = createFairRng(fairness.serverSeed, clientSeed, fairness.nonce);
        const { isWin, multiplier, result, game, symbols } = calculateGameResult(betInfo, betAmount, fairRng);

        // Calculate new balance
        const { winAmount, delta } = computeSettlement(betAmount, isWin, multiplier);
        const newBalance = currentBalance + delta;

        // Create transaction records
        const timestamp = Date.now();
        const betTransactionId = randomUUID();
        const resultTransactionId = randomUUID();
        const nextServerSeed = createServerSeed();
        const nextServerSeedHash = hashSeed(nextServerSeed);
        const proof = {
            algorithm: 'hmac-sha256-v1',
            serverSeedHash: fairness.serverSeedHash,
            serverSeed: fairness.serverSeed,
            nextServerSeedHash,
            clientSeed,
            nonce: fairness.nonce,
            draws: fairRng.draws,
            rulesVersion: 'casino888-v1',
            selection: betInfo.side,
        };
        const roundResponse = {
            roundId,
            result,
            isWin,
            betAmount,
            winAmount: isWin ? winAmount : 0,
            multiplier: isWin ? multiplier : 0,
            newBalance,
            game,
            symbols: symbols || null,
            proof,
            message: isWin
                ? `You won $${winAmount.toFixed(2)}! Result: ${result}`
                : `You lost $${betAmount.toFixed(2)}. Result: ${result}`,
        };
        proof.isWin = isWin;
        proof.multiplier = isWin ? multiplier : 0;
        proof.betAmount = betAmount;
        proof.winAmount = roundResponse.winAmount;

        const transactItems = [
            {
                Update: {
                    TableName: process.env.USERS_TABLE_NAME,
                    Key: marshall({ userId }),
                    UpdateExpression: "SET currentBalance = currentBalance + :delta, updatedAt = :updatedAt, totalGames = if_not_exists(totalGames, :zero) + :one, totalWagered = if_not_exists(totalWagered, :zero) + :betAmount, totalWins = if_not_exists(totalWins, :zero) + :winInc, totalWon = if_not_exists(totalWon, :zero) + :wonInc, biggestWin = :newBiggestWin",
                    ConditionExpression: "attribute_not_exists(deletionStatus) AND currentBalance = :currentBalance AND currentBalance >= :betAmount",
                    ExpressionAttributeValues: marshall({
                        ":delta": delta,
                        ":updatedAt": new Date().toISOString(),
                        ":zero": 0,
                        ":one": 1,
                        ":betAmount": betAmount,
                        ":currentBalance": currentBalance,
                        ":winInc": isWin ? 1 : 0,
                        ":wonInc": isWin ? winAmount : 0,
                        ":newBiggestWin": Math.max(prevBiggestWin, isWin ? winAmount : 0),
                    }),
                },
            },
            {
                Put: {
                    TableName: process.env.TRANSACTIONS_TABLE_NAME,
                    Item: marshall({
                        userId,
                        timestamp,
                        transactionId: betTransactionId,
                        type: "BET",
                        amount: -betAmount,
                        gameName: game,
                        nickname: nickname,
                        gameDetails: `${game} - Bet: ${betSide}`,
                        balanceAfter: currentBalance - betAmount,
                        createdAt: new Date().toISOString(),
                    }),
                    ConditionExpression: 'attribute_not_exists(userId)',
                },
            },
            {
                Put: {
                    TableName: process.env.TRANSACTIONS_TABLE_NAME,
                    Item: marshall({
                        userId,
                        timestamp: timestamp + 1,
                        transactionId: resultTransactionId,
                        type: isWin ? "WIN" : "LOSS",
                        amount: isWin ? winAmount : 0,
                        gameName: game,
                        nickname: nickname,
                        gameDetails: `${game} - Result: ${result} - ${isWin ? 'WIN' : 'LOSS'}`,
                        balanceAfter: newBalance,
                        createdAt: new Date().toISOString(),
                    }),
                    ConditionExpression: 'attribute_not_exists(userId)',
                },
            },
            {
                Update: {
                    TableName: process.env.GAME_ROUNDS_TABLE_NAME,
                    Key: marshall({ userId, recordId: 'FAIRNESS' }),
                    UpdateExpression: 'SET serverSeed = :seed, serverSeedHash = :hash, nonce = :nextNonce',
                    ConditionExpression: 'serverSeedHash = :expectedHash AND nonce = :nonce',
                    ExpressionAttributeValues: marshall({
                        ':seed': nextServerSeed,
                        ':hash': nextServerSeedHash,
                        ':nextNonce': fairness.nonce + 1,
                        ':expectedHash': fairness.serverSeedHash,
                        ':nonce': fairness.nonce,
                    }),
                },
            },
            {
                Put: {
                    TableName: process.env.GAME_ROUNDS_TABLE_NAME,
                    Item: marshall({
                        userId,
                        recordId: `ROUND#${roundId}`,
                        roundId,
                        idempotencyKey,
                        response: roundResponse,
                        createdAt: new Date().toISOString(),
                    }),
                    ConditionExpression: 'attribute_not_exists(userId)',
                },
            },
        ];

        const transactCommand = new TransactWriteItemsCommand({
            TransactItems: transactItems,
        });

        await dynamodb.send(transactCommand);

        return response(200, roundResponse);
    } catch (err) {
        if (err.name === 'TransactionCanceledException') {
            return response(409, { error: "Round conflict or insufficient funds" });
        }
        console.error("PlaceBet error:", err);
        return response(500, { error: err.message || "Bet failed" });
    }
};

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

// Pure logic exported for unit tests (outcome math must stay server-side; the
// tests only pin down that logic, they never run it client-side).
module.exports = { handler: exports.handler, parseBetSide, isValidAmount, calculateGameResult, computeSettlement };
