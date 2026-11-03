const { docClient, PLAYER_ROOM, send, allowLocalAction } = require('./utils');
const { randomUUID } = require('crypto');
const { createServerSeed, hashSeed, createFairRng } = require('./fairness');

const ROOM_ID = 'bj-main';
const MAX_SEATS = 4;
const CONNECTIONS = process.env.CONNECTIONS_TABLE_NAME;
const PLAYERS = process.env.PLAYERS_TABLE_NAME;
const ROOMS = process.env.BLACKJACK_ROOMS_TABLE_NAME;
const USERS = process.env.USERS_TABLE_NAME;
const TRANSACTIONS = process.env.TRANSACTIONS_TABLE_NAME;

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const rankValue = (rank) => (rank === 'A' ? 11 : ['J', 'Q', 'K'].includes(rank) ? 10 : parseInt(rank, 10));

const createDeck = () => {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ suit, rank });
  return deck;
};

const shuffle = (deck, rng = null) => {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = rng ? rng(i + 1) : require('crypto').randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
};

const handValue = (cards) => {
  let value = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') {
      aces++;
      value += 11;
    } else {
      value += rankValue(c.rank);
    }
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  return value;
};

const isBlackjack = (cards) => cards.length === 2 && handValue(cards) === 21;

const draw = (room) => {
  if (!room.deck.length) room.deck = shuffle(createDeck());
  return room.deck.pop();
};

const soloRoomId = (playerId) => `bj-solo-${playerId}`;

const freshRoom = (roomId = ROOM_ID) => ({
  roomId,
  phase: 'queue',
seats: [],
spectators: [],
chat: [],
dealerHand: [],
deck: [],
createdAt: Date.now(),
version: 0,
roundNonce: 0,
serverSeed: createServerSeed(),
});

const loadRoom = async (roomId = ROOM_ID) => {
  const res = await docClient.get({ TableName: ROOMS, Key: { roomId } });
  const room = res.Item || freshRoom(roomId);
  if (!room.serverSeed) room.serverSeed = createServerSeed();
  if (!Number.isInteger(room.version)) room.version = 0;
  if (!Number.isInteger(room.roundNonce)) room.roundNonce = 0;
  return room;
};

const saveRoom = async (room) => {
  room.updatedAt = Date.now();
  const expected = room.version || 0;
  room.version = expected + 1;
  room.serverSeedHash = hashSeed(room.serverSeed);
  await docClient.put({
    TableName: ROOMS,
    Item: room,
    ConditionExpression: expected ? '#version = :expected' : 'attribute_not_exists(#version)',
    ExpressionAttributeNames: { '#version': 'version' },
    ExpressionAttributeValues: expected ? { ':expected': expected } : undefined,
  });
};

// ponytail: single global room item; last-write-wins on concurrent actions.
// Fine for a 4-seat play-money table. Split into per-room partitions + an
// optimistic conditional put if contention ever becomes visible.
const publicRoom = (room) => ({
  ...room,
  // Compute the AFK flag server-side so the client's Kick button + Kick (AFK)
  // label have an authoritative signal without the client re-deriving it from
  // seat private timestamps. Stale = no bj:* message in the AFK window.
  seats: (room.seats || []).map((s) => ({
    ...s,
    afk: Date.now() - (s.lastActivityAt || 0) >= BJ_AFK_MS,
  })),
  dealerHand: room.phase === 'playing' && room.dealerHand.length > 1
    ? [room.dealerHand[0], { suit: '', rank: '?' }]
    : room.dealerHand,
  deck: undefined,
  serverSeed: undefined,
  revealedServerSeed: room.phase === 'ended' ? room.serverSeed : undefined,
  serverSeedHash: hashSeed(room.serverSeed),
});

const transactionTimestamp = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);
const roomWrite = (room) => {
  const expected = room.version || 0;
  room.version = expected + 1;
  room.updatedAt = Date.now();
  room.serverSeedHash = hashSeed(room.serverSeed);
  return {
    Put: {
      TableName: ROOMS,
      Item: room,
      ConditionExpression: expected ? '#version = :expected' : 'attribute_not_exists(#version)',
      ExpressionAttributeNames: { '#version': 'version' },
      ExpressionAttributeValues: expected ? { ':expected': expected } : undefined,
    },
  };
};

const charge = async (room, seat, amount, action) => {
  const timestamp = transactionTimestamp();
  await docClient.transactWrite({ TransactItems: [
    roomWrite(room),
    { Update: { TableName: USERS, Key: { userId: seat.playerId }, UpdateExpression: 'SET currentBalance = currentBalance - :amount, updatedAt = :now, totalWagered = if_not_exists(totalWagered, :zero) + :amount', ConditionExpression: 'attribute_not_exists(deletionStatus) AND currentBalance >= :amount', ExpressionAttributeValues: { ':amount': amount, ':now': new Date().toISOString(), ':zero': 0 } } },
    { Put: { TableName: TRANSACTIONS, Item: { userId: seat.playerId, timestamp, transactionId: randomUUID(), type: 'BET', amount: -amount, gameName: 'Blackjack', nickname: seat.nickname, gameDetails: `Blackjack - ${action} - ${room.roundId}`, createdAt: new Date().toISOString() }, ConditionExpression: 'attribute_not_exists(userId)' } },
  ] });
  await sendState(room);
  return { statusCode: 200, body: 'OK' };
};

const payoutFor = (result, bet) => result === 'blackjack' ? bet * 2.5 : result === 'win' ? bet * 2 : result === 'push' ? bet : 0;
const seatPayout = (seat) => {
  const hands = seat.hands || [{ result: seat.result, bet: seat.bet }];
  const handPayout = hands.reduce((total, hand) => total + payoutFor(hand.result, hand.bet || seat.bet), 0);
  return handPayout + (seat.insuranceResult === 'win' ? (seat.insuranceBet || 0) * 3 : 0);
};

const settleSeat = async (room, seat) => {
  if (seat.settlementStatus) return;
  const payout = seatPayout(seat);
  const hands = seat.hands || [{ result: seat.result }];
  const won = hands.some((hand) => ['win', 'blackjack'].includes(hand.result)) || seat.insuranceResult === 'win';
  const timestamp = seat.settlementTimestamp;
  if (!Number.isSafeInteger(timestamp)) throw new Error('Missing settlement timestamp');
  const transactionId = `bj-settlement-${room.roundId}-${seat.playerId}`;
  const transaction = {
    userId: seat.playerId, timestamp, transactionId, type: payout > 0 ? 'WIN' : 'LOSS', amount: payout,
    gameName: 'Blackjack', nickname: seat.nickname, gameDetails: `Blackjack - Settlement - ${room.roundId}`,
    createdAt: new Date().toISOString(),
  };
  try {
    await docClient.transactWrite({ TransactItems: [
      { Update: { TableName: USERS, Key: { userId: seat.playerId }, UpdateExpression: 'SET currentBalance = currentBalance + :payout, updatedAt = :now, totalGames = if_not_exists(totalGames, :zero) + :one, totalWins = if_not_exists(totalWins, :zero) + :win, totalWon = if_not_exists(totalWon, :zero) + :payout', ConditionExpression: 'attribute_exists(userId)', ExpressionAttributeValues: { ':payout': payout, ':now': new Date().toISOString(), ':zero': 0, ':one': 1, ':win': won ? 1 : 0 } } },
      { Put: { TableName: TRANSACTIONS, Item: transaction, ConditionExpression: 'attribute_not_exists(userId)' } },
    ] });
    seat.settlementStatus = 'paid';
  } catch (err) {
    if (err.name !== 'TransactionCanceledException') throw err;
    const [user, existingTransaction] = await Promise.all([
      docClient.get({ TableName: USERS, Key: { userId: seat.playerId }, ConsistentRead: true }),
      docClient.get({ TableName: TRANSACTIONS, Key: { userId: seat.playerId, timestamp }, ConsistentRead: true }),
    ]);
    // A committed transaction means atomic user credit also committed before Lambda retried.
    if (existingTransaction.Item?.transactionId === transactionId) seat.settlementStatus = 'paid';
    else if (!user.Item) seat.settlementStatus = 'skipped';
    else throw err;
  }
};

const settle = async (room) => {
  if (room.settled) return persist(room);
  for (const seat of room.seats.filter((item) => item.inRound !== false)) await settleSeat(room, seat);
  room.settled = true;
  await sendState(room);
  return persist(room);
};

const sendState = async (room) => {
const recipients = [
...room.seats.filter((s) => s.status !== 'left').map((s) => s.connectionId),
...(room.spectators || []),
];
await Promise.all(recipients.map((cid) => send(cid, { type: 'bj:state', room: publicRoom(room) })));
};

const broadcastToTable = async (room, payload) => {
const recipients = [
...room.seats.filter((s) => s.status !== 'left').map((s) => s.connectionId),
...(room.spectators || []),
];
await Promise.all(recipients.map((cid) => send(cid, payload)));
};

const sendError = async (connectionId, message) => {
  await send(connectionId, { type: 'bj:error', message });
};

const persist = async (room) => {
  await saveRoom(room);
  await sendState(room);
  return { statusCode: 200, body: 'OK' };
};

const getConnectionInfo = async (connectionId) => {
  const conn = await docClient.get({ TableName: CONNECTIONS, Key: { connectionId } });
  if (!conn.Item) return null;
  const player = await docClient.get({ TableName: PLAYERS, Key: { connectionId, roomId: PLAYER_ROOM } });
  return {
    playerId: conn.Item.playerId,
    bjRoomId: conn.Item?.bjRoomId || null,
    nickname: player.Item?.nickname || 'Player',
    avatarColor: player.Item?.avatarColor || '#4a90e2',
    avatarImage: player.Item?.avatarImage || null,
  };
};

const setConnRoom = async (connectionId) => {
  await docClient.update({
    TableName: CONNECTIONS,
    Key: { connectionId },
    UpdateExpression: 'SET bjRoomId = :r',
    ExpressionAttributeValues: { ':r': ROOM_ID },
  });
};

const clearConnRoom = async (connectionId) => {
  await docClient
    .update({ TableName: CONNECTIONS, Key: { connectionId }, UpdateExpression: 'REMOVE bjRoomId' })
    .catch(() => {});
};

const allFinished = (room) =>
  room.seats.every(
    (s) =>
      s.inRound === false || s.status === 'left' ||
      (s.hands
        ? s.hands.every((h) => h.status === 'stood' || h.status === 'busted')
        : ['stood', 'busted', 'blackjack'].includes(s.status)),
  );

// Active hand of a seat (split hands override the base hand).
const activeHand = (seat) => {
  if (seat.hands) return seat.hands[seat.activeHand || 0];
  return seat;
};

// Card array of the active hand: base hands live in seat.hand, split hands
// live in hand.cards. All action handlers must go through this, or dealt
// cards land in the wrong array and never render.
const activeCards = (seat, hand) => (seat.hands ? hand.cards : seat.hand);

const resetIfEmpty = (room) => {
  if (room.seats.length === 0) Object.assign(room, freshRoom(), { createdAt: room.createdAt });
};

const join = async (connectionId, info, room) => {
  const existing = room.seats.find((s) => s.playerId === info.playerId && s.status !== 'left');
  if (existing) {
    existing.connectionId = connectionId;
    existing.avatarColor = info.avatarColor;
    existing.avatarImage = info.avatarImage;
    await setConnRoom(connectionId, room.roomId);
    return persist(room);
  }
  if (room.phase !== 'queue') {
    await sendError(connectionId, 'A round is in progress. Wait for it to end to join.');
    return { statusCode: 200, body: 'Busy' };
  }
  if (room.seats.length >= MAX_SEATS) {
    await sendError(connectionId, `Table is full (${MAX_SEATS} players).`);
    return { statusCode: 200, body: 'Full' };
  }
  room.seats.push({
    playerId: info.playerId,
    nickname: info.nickname,
    avatarColor: info.avatarColor,
    avatarImage: info.avatarImage,
    connectionId,
    ready: false,
    lastActivityAt: Date.now(), // seat-lifetime AFK anchor (server-authoritative,
    // bumped by every bj:* action below — used by kickSeat + the AFK sweep so
    // a player who readied-up and then walked away still gets folded out),
    bet: 10,
    hand: [],
    status: 'idle',
    result: null,
  });
  await setConnRoom(connectionId, room.roomId);
  return persist(room);
};

const resolveResults = (room) => {
  const dv = handValue(room.dealerHand);
  const dealerBj = isBlackjack(room.dealerHand);
  const resolveHand = (cards, status) => {
    if (status === 'busted') return 'loss';
    const pv = handValue(cards);
    if (status === 'blackjack') return dealerBj ? 'push' : 'blackjack';
    if (dealerBj) return 'loss';
    if (dv > 21 || pv > dv) return 'win';
    if (pv < dv) return 'loss';
    return 'push';
  };
  for (const s of room.seats) {
    if (s.inRound === false || s.status === 'left') continue;
    if (dealerBj && s.insuranceBet) s.insuranceResult = 'win';
    else if (s.insuranceBet) s.insuranceResult = 'loss';
    if (s.hands) {
      s.hands.forEach((h) => {
        h.result = resolveHand(h.cards, h.status);
      });
      continue;
    }
    s.result = resolveHand(s.hand, s.status);
    s.status = 'stood';
  }
  return room;
};

const dealerTurn = async (room) => {
  room.phase = 'dealer';
  while (handValue(room.dealerHand) < 17) room.dealerHand.push(draw(room));
  resolveResults(room);
  room.phase = 'ended';
  return settle(room);
};

const start = async (connectionId, room) => {
  const seat = room.seats.find((s) => s.connectionId === connectionId);
  if (!seat || !seat.ready) {
    await sendError(connectionId, 'Ready up before starting the round.');
    return { statusCode: 200, body: 'Not ready' };
  }
  if (room.phase !== 'queue') {
    await sendError(connectionId, 'A round is already in progress.');
    return { statusCode: 200, body: 'Busy' };
  }
  const ready = room.seats.filter((s) => s.ready && s.status !== 'left');
  if (!ready.length) {
    await sendError(connectionId, 'No ready players to deal in.');
    return { statusCode: 200, body: 'Empty' };
  }
  const clientSeed = ready.map((seat) => `${seat.playerId}:${seat.clientSeed}`).sort().join('|');
  room.roundId = randomUUID();
  room.settled = false;
  room.deck = shuffle(createDeck(), createFairRng(room.serverSeed, clientSeed, room.roundNonce || 0));
  const roundTimestamp = Date.now() * 1000;
  for (const [index, s] of ready.entries()) {
    s.inRound = true;
    s.hand = [draw(room), draw(room)];
    s.status = isBlackjack(s.hand) ? 'blackjack' : 'active';
    s.hands = undefined;
    s.activeHand = undefined;
    s.splitUsed = undefined;
    s.doubled = undefined;
    s.insuranceBet = undefined;
    s.insuranceResult = undefined;
    s.result = undefined;
    s.settlementStatus = undefined;
    s.settlementTimestamp = roundTimestamp + 100 + index;
  }
  room.seats.filter((s) => !ready.includes(s)).forEach((s) => { s.inRound = false; });
  room.dealerHand = [draw(room), draw(room)];
  room.phase = 'playing';
  const charges = ready.map((s) => s.bet);
  const totalItems = [roomWrite(room)];
  ready.forEach((s, index) => {
    const timestamp = roundTimestamp + index;
    totalItems.push({ Update: { TableName: USERS, Key: { userId: s.playerId }, UpdateExpression: 'SET currentBalance = currentBalance - :amount, updatedAt = :now, totalWagered = if_not_exists(totalWagered, :zero) + :amount', ConditionExpression: 'attribute_not_exists(deletionStatus) AND currentBalance >= :amount', ExpressionAttributeValues: { ':amount': charges[index], ':now': new Date().toISOString(), ':zero': 0 } } });
    totalItems.push({ Put: { TableName: TRANSACTIONS, Item: { userId: s.playerId, timestamp, transactionId: randomUUID(), type: 'BET', amount: -charges[index], gameName: 'Blackjack', nickname: s.nickname, gameDetails: `Blackjack - Start - ${room.roundId}`, createdAt: new Date().toISOString() }, ConditionExpression: 'attribute_not_exists(userId)' } });
  });
  await docClient.transactWrite({ TransactItems: totalItems });
  await sendState(room);
  if (isBlackjack(room.dealerHand)) return dealerTurn(room);
  if (allFinished(room)) return dealerTurn(await loadRoom(room.roomId));
  return { statusCode: 200, body: 'OK' };
};

// Advance the seat to its next unfinished split hand. Returns true if the
// seat still has a hand to play, false if all of its hands are done.
const advanceSeat = (seat) => {
  if (!seat.hands) return false;
  const idx = seat.hands.findIndex((h) => h.status === 'active');
  if (idx === -1) return false;
  seat.activeHand = idx;
  return true;
};

// After any action on a seat, persist and only end the round when every seat
// has finished every hand.
const afterAction = async (room) => {
  if (allFinished(room)) return dealerTurn(room);
  return persist(room);
};

const hit = async (connectionId, room) => {
  const seat = room.seats.find((s) => s.connectionId === connectionId);
  if (!seat) return { statusCode: 200, body: 'Not seated' };
  const hand = activeHand(seat);
  if (room.phase !== 'playing' || hand.status !== 'active') {
    await sendError(connectionId, 'You cannot hit right now.');
    return { statusCode: 200, body: 'Bad state' };
  }
  const cards = activeCards(seat, hand);
  cards.push(draw(room));
  const v = handValue(cards);
  if (v > 21) hand.status = 'busted';
  else if (v === 21) hand.status = 'stood';
  advanceSeat(seat);
  return afterAction(room);
};

const stand = async (connectionId, room) => {
  const seat = room.seats.find((s) => s.connectionId === connectionId);
  if (!seat) return { statusCode: 200, body: 'Not seated' };
  const hand = activeHand(seat);
  if (room.phase !== 'playing' || hand.status !== 'active') {
    await sendError(connectionId, 'You cannot stand right now.');
    return { statusCode: 200, body: 'Bad state' };
  }
  hand.status = 'stood';
  advanceSeat(seat);
  return afterAction(room);
};

const split = async (connectionId, room, shouldPersist = true) => {
  const seat = room.seats.find((s) => s.connectionId === connectionId);
  if (!seat) return { statusCode: 200, body: 'Not seated' };
  const hand = activeHand(seat);
  if (room.phase !== 'playing' || hand.status !== 'active') {
    await sendError(connectionId, 'You cannot split right now.');
    return { statusCode: 200, body: 'Bad state' };
  }
  const cards = activeCards(seat, hand);
  if (cards.length !== 2 || cards[0].rank !== cards[1].rank) {
    await sendError(connectionId, 'You can only split two cards of the same rank.');
    return { statusCode: 200, body: 'Bad split' };
  }
  if (seat.splitUsed) {
    await sendError(connectionId, 'You can only split once.');
    return { statusCode: 200, body: 'No re-split' };
  }
  const bet = hand.bet !== undefined ? hand.bet : seat.bet;
  seat.splitUsed = true;
  seat.hands = [
    { cards: [cards[0]], bet, status: 'active' },
    { cards: [cards[1]], bet, status: 'active' },
  ];
  seat.activeHand = 0;
  return shouldPersist ? persist(room) : { statusCode: 200, body: 'OK' };
};

const newRound = async (connectionId, room) => {
  const seat = room.seats.find((s) => s.connectionId === connectionId);
  if (!seat) {
    await sendError(connectionId, 'You are not seated.');
    return { statusCode: 200, body: 'Not seated' };
  }
  if (room.phase !== 'ended') {
    await sendError(connectionId, 'Current round must finish first.');
    return { statusCode: 400, body: 'Round active' };
  }
  for (const s of room.seats) {
    if (s.status === 'left') continue;
    s.hand = [];
    s.hands = undefined;
    s.activeHand = undefined;
    s.splitUsed = undefined;
    s.doubled = undefined;
    s.insuranceBet = undefined;
    s.insuranceResult = undefined;
    s.status = 'idle';
    s.result = null;
    s.ready = false;
    s.inRound = false;
  }
  room.dealerHand = [];
  room.deck = [];
  room.phase = 'queue';
  room.revealedServerSeed = room.serverSeed;
  room.serverSeed = createServerSeed();
  room.roundNonce = (room.roundNonce || 0) + 1;
  room.roundId = undefined;
  room.settled = undefined;
  return persist(room);
};

// AFK window before a seat is considered gone: if the seat has not sent ANY
// bj:* message (bj:state / bj:chat / bj:ready / bj:hit / bj:* in that window)
// it is treated as not-at-keyboard — stale-ready seats are kickable through
// this window, which is what lets a real table unstick from a player who
// clicked Ready and then walked away. 90s matches the frontend AFK badge.
const BJ_AFK_MS = 90_000; // 90 seconds — aligns with seat.afk on the client.

// Server-authoritative kick: only in the pre-round queue, only against a seat
// that has not readied up (AFK / trolling protection). The kicker must be a
// seated player themselves — hosts and casuals alike — and cannot kick during
// a live round (that would corrupt the round ledger). Mirrors leave() teardown.
// NEW: a seat that readied up but has not touched the table in the last
// BJ_AFK_MS (hasn't been seen by bj:state/bj:chat/bj:* in that window) counts
// as AFK too — ready-AFK seats are kickable just like non-ready ones, which
// closes the "clicked ready then walked away" exploit that used to pin a
// table forever while the round could never start.
const kickSeat = async (connectionId, targetPlayerId, room) => {
  const kicker = room.seats.find((s) => s.connectionId === connectionId);
  if (!kicker) {
    await sendError(connectionId, 'You must be seated to kick someone.');
    return { statusCode: 400, body: 'Not seated' };
  }
  if (room.phase !== 'queue') {
    await sendError(connectionId, 'You can only kick between rounds.');
    return { statusCode: 400, body: 'Round active' };
  }
  const target = room.seats.find((s) => s.playerId === targetPlayerId);
  if (!target) {
    await sendError(connectionId, 'That player is no longer at the table.');
    return { statusCode: 400, body: 'No target' };
  }
  if (target.ready) {
    // Ready seats can still be kicked when they are stale-AFK: lastTimeSeen
    // older than the AFK window means they are not at the keyboard anymore.
    // This is the only path that lets a table unstick from a gone-ready player.
    const stale = Date.now() - (target.lastActivityAt || 0) >= BJ_AFK_MS;
    if (!stale) {
      await sendError(connectionId, `${target.nickname} is ready — ask them to unready before kicking.`);
      return { statusCode: 400, body: 'Target ready' };
    }
  }
  if (connectionId === target.connectionId) {
    await sendError(connectionId, 'You cannot kick yourself — use Leave Table.');
    return { statusCode: 400, body: 'Self-kick' };
  }
  const targetSeat = target;
  room.seats = room.seats.filter((s) => s.playerId !== target.playerId);
  if (room.spectators) room.spectators = room.spectators.filter((cid) => cid !== target.connectionId);
  await send(target.connectionId, {
    type: 'bj:kicked', nickname: kicker.nickname, message: `${kicker.nickname} kicked you — you sat AFK (not ready) and the table was full.`,
  });
  await clearConnRoom(target.connectionId);
  resetIfEmpty(room);
  return persist(room);
};

const leave = async (connectionId, room) => {
const idx = room.seats.findIndex((s) => s.connectionId === connectionId);
if (idx !== -1 && ['playing', 'dealer'].includes(room.phase)) {
  const seat = room.seats[idx];
  if (seat.hands) seat.hands.forEach((hand) => { if (hand.status === 'active') hand.status = 'stood'; });
  else if (seat.status === 'active') seat.status = 'stood';
  seat.disconnected = true;
} else if (idx !== -1) room.seats.splice(idx, 1);
if (room.spectators) room.spectators = room.spectators.filter((cid) => cid !== connectionId);
await clearConnRoom(connectionId);
resetIfEmpty(room);
return allFinished(room) && room.phase === 'playing' ? dealerTurn(room) : persist(room);
};

const handleMessage = async (event, payload) => {
  const connectionId = event.requestContext.connectionId;
  const action = payload.action || '';
  try {
    if (action === 'bj:chat' && !allowLocalAction(connectionId, 'bj-chat', 1000)) {
      return { statusCode: 429, body: 'Chat rate limited' };
    }
    const info = await getConnectionInfo(connectionId);
    if (!info) return { statusCode: 200, body: 'No identity' };
    const solo = action === 'bj:join' && payload.solo === true;
    const room = await loadRoom(solo ? soloRoomId(info.playerId) : info.bjRoomId || ROOM_ID);

    switch (action) {
      case 'bj:join':
        return join(connectionId, info, room);
      case 'bj:ready': {
        const seat = room.seats.find((s) => s.connectionId === connectionId);
        if (!seat) {
          await sendError(connectionId, 'You are not seated.');
          return { statusCode: 200, body: 'Not seated' };
        }
        if (room.phase !== 'queue') {
          await sendError(connectionId, 'Cannot change wager during a round.');
          return { statusCode: 400, body: 'Round active' };
        }
        seat.ready = true;
        if (Number.isFinite(payload.bet) && payload.bet > 0 && payload.bet <= 10000) seat.bet = Math.round(payload.bet * 100) / 100;
        if (typeof payload.clientSeed !== 'string' || payload.clientSeed.length < 8 || payload.clientSeed.length > 128) {
          seat.ready = false;
          await sendError(connectionId, 'Invalid client seed.');
          return { statusCode: 400, body: 'Invalid client seed' };
        }
        seat.clientSeed = payload.clientSeed;
        return persist(room);
      }
      case 'bj:unready': {
        const seat = room.seats.find((s) => s.connectionId === connectionId);
        if (room.phase !== 'queue') return { statusCode: 400, body: 'Round active' };
        if (seat) seat.ready = false;
        return persist(room);
      }
      case 'bj:hit':
        return hit(connectionId, room);
      case 'bj:stand':
        return stand(connectionId, room);
      case 'bj:double': {
        const seat = room.seats.find((s) => s.connectionId === connectionId);
        if (!seat) return { statusCode: 200, body: 'Not seated' };
        const hand = activeHand(seat);
        if (room.phase !== 'playing' || hand.status !== 'active') {
          await sendError(connectionId, 'You cannot double right now.');
          return { statusCode: 200, body: 'Bad state' };
        }
        const baseBet = hand.bet !== undefined ? hand.bet : seat.bet;
        hand.doubled = true;
        if (hand.bet !== undefined) hand.bet = Math.round(baseBet * 2 * 100) / 100;
        else seat.bet = Math.round(baseBet * 2 * 100) / 100;
        const cards = activeCards(seat, hand);
        cards.push(draw(room));
        const dv = handValue(cards);
        if (dv > 21) hand.status = 'busted';
        else hand.status = 'stood';
        advanceSeat(seat);
        if (allFinished(room)) {
          await charge(room, seat, baseBet, 'Double');
          return dealerTurn(await loadRoom(room.roomId));
        }
        return charge(room, seat, baseBet, 'Double');
      }
      case 'bj:insurance': {
        await sendError(connectionId, 'Insurance is disabled until a server-timed decision window is available.');
        return { statusCode: 400, body: 'Insurance disabled' };
      }
      case 'bj:split': {
        const seat = room.seats.find((s) => s.connectionId === connectionId);
        if (!seat) return { statusCode: 200, body: 'Not seated' };
        const bet = activeHand(seat).bet ?? seat.bet;
        const result = await split(connectionId, room, false);
        if (result.body !== 'OK') return result;
        return charge(room, seat, bet, 'Split');
      }
      case 'bj:start':
        return start(connectionId, room);
      case 'bj:newRound':
        return newRound(connectionId, room);
        case 'bj:leave':
            return leave(connectionId, room);
        case 'bj:kick': {
            const targetPlayerId = String(payload.playerId || '');
            if (!targetPlayerId) {
                await sendError(connectionId, 'Missing kick target.');
                return { statusCode: 400, body: 'No target' };
            }
            return kickSeat(connectionId, targetPlayerId, room);
        }
        case 'bj:spectate': {
            if (!room.spectators) room.spectators = [];
            if (!room.seats.some((s) => s.connectionId === connectionId) && !room.spectators.includes(connectionId)) {
                room.spectators.push(connectionId);
            }
            await send(connectionId, { type: 'bj:state', room: publicRoom(room) });
            return { statusCode: 200, body: 'Spectating' };
        }
        case 'bj:unspectate': {
            if (room.spectators) room.spectators = room.spectators.filter((cid) => cid !== connectionId);
            return { statusCode: 200, body: 'Stopped spectating' };
        }
        case 'bj:chat': {
            const text = String(payload.message || '').trim().slice(0, 200);
            if (!text) return { statusCode: 200, body: 'Empty' };
            if (!room.chat) room.chat = [];
            room.chat.push({ playerId: info.playerId, nickname: info.nickname, avatarColor: info.avatarColor, message: text, ts: Date.now() });
            if (room.chat.length > 20) room.chat = room.chat.slice(-20);
            await broadcastToTable(room, { type: 'bj:chat', message: text, player: { playerId: info.playerId, nickname: info.nickname, avatarColor: info.avatarColor }, ts: Date.now() });
            return { statusCode: 200, body: 'Chat sent' };
        }
        case 'bj:state':
            await send(connectionId, { type: 'bj:state', room: publicRoom(room) });
            return { statusCode: 200, body: 'State' };
      default:
        return { statusCode: 400, body: 'Unknown blackjack action' };
    }
  } catch (err) {
    console.error('Blackjack engine error:', err.message);
    return { statusCode: 200, body: 'Error' };
  }
};

const handleDisconnect = async (connectionId) => {
const conn = await docClient.get({ TableName: CONNECTIONS, Key: { connectionId } });
if (!conn.Item?.bjRoomId) return;
const room = await loadRoom(conn.Item?.bjRoomId);
await leave(connectionId, room);
};

module.exports = {
  ROOM_ID,
  MAX_SEATS,
  freshRoom,
  createDeck,
  shuffle,
  handValue,
  isBlackjack,
  activeCards,
  resolveResults,
  payoutFor,
  seatPayout,
  settleSeat,
  settle,
  publicRoom,
  handleMessage,
  handleDisconnect,
};
