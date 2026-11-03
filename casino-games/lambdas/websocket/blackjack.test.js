// Self-check for blackjack engine rules (double/split/insurance/resolve).
// Run: node lambdas/websocket/blackjack.test.js
process.env.PLAYERS_TABLE_NAME = 'x';
process.env.CONNECTIONS_TABLE_NAME = 'x';
process.env.BLACKJACK_ROOMS_TABLE_NAME = 'x';
process.env.USERS_TABLE_NAME = 'users';
process.env.TRANSACTIONS_TABLE_NAME = 'transactions';

const assert = require('assert');
const { docClient } = require('./utils');
const { handValue, isBlackjack, activeCards, resolveResults, payoutFor, seatPayout, publicRoom, settleSeat, settle } = require('./blackjack');

const C = (rank) => ({ rank, suit: '♠' });

// handValue basics
assert.strictEqual(handValue([C('A'), C('K')]), 21);
assert.strictEqual(handValue([C('A'), C('9'), C('A')]), 21); // soft -> 11+9+1
assert.strictEqual(handValue([C('10'), C('10'), C('2')]), 22);
assert.strictEqual(isBlackjack([C('A'), C('J')]), true);
assert.strictEqual(payoutFor('loss', 10), 0);
assert.strictEqual(payoutFor('push', 10), 10);
assert.strictEqual(payoutFor('win', 10), 20);
assert.strictEqual(payoutFor('blackjack', 10), 25);
assert.strictEqual(seatPayout({ bet: 10, result: 'win', insuranceBet: 5, insuranceResult: 'win' }), 35);

// Settlement is per-player: a failed/deleted account cannot block other seats,
// and a Lambda retry sees its fixed transaction ID instead of paying twice.
const settlementChecks = (async () => {
  const original = { transactWrite: docClient.transactWrite, get: docClient.get };
  const room = { roundId: 'round-1' };
  const seat = { playerId: 'player-1', nickname: 'Player', bet: 10, result: 'win', settlementTimestamp: 12345 };
  let writes = 0;
  docClient.transactWrite = async () => { writes += 1; };
  try {
    await settleSeat(room, seat);
    assert.strictEqual(seat.settlementStatus, 'paid');
    assert.strictEqual(writes, 1);
    const replay = { ...seat, settlementStatus: undefined };
    docClient.transactWrite = async () => { const error = new Error('duplicate'); error.name = 'TransactionCanceledException'; throw error; };
    docClient.get = async ({ TableName }) => TableName === 'transactions'
      ? { Item: { transactionId: 'bj-settlement-round-1-player-1' } }
      : { Item: { userId: 'player-1' } };
    await settleSeat(room, replay);
    assert.strictEqual(replay.settlementStatus, 'paid');

    const deleted = { ...seat, playerId: 'deleted-player', settlementTimestamp: 12346, settlementStatus: undefined };
    docClient.get = async () => ({ Item: undefined });
    await settleSeat(room, deleted);
    assert.strictEqual(deleted.settlementStatus, 'skipped');

    const mixedRoom = {
      roomId: 'bj-main', roundId: 'round-2', phase: 'ended', version: 0, serverSeed: '00'.repeat(32), dealerHand: [], deck: [], seats: [
        { playerId: 'deleted-player', nickname: 'Deleted', result: 'win', bet: 10, inRound: true, disconnected: true, settlementTimestamp: 22345, status: 'left' },
        { playerId: 'active-player', nickname: 'Active', result: 'push', bet: 10, inRound: true, settlementTimestamp: 22346, status: 'left' },
      ],
    };
    docClient.transactWrite = async ({ TransactItems }) => {
      const playerId = TransactItems[0]?.Update?.Key?.userId;
      if (playerId === 'deleted-player') { const error = new Error('missing'); error.name = 'TransactionCanceledException'; throw error; }
    };
    docClient.get = async ({ TableName, Key }) => {
      if (TableName === 'users') return Key.userId === 'active-player' ? { Item: { userId: Key.userId } } : { Item: undefined };
      return { Item: undefined };
    };
    docClient.put = async () => {};
    await settle(mixedRoom);
    assert.strictEqual(mixedRoom.seats[0].settlementStatus, 'skipped');
    assert.strictEqual(mixedRoom.seats[1].settlementStatus, 'paid');
    assert.strictEqual(mixedRoom.settled, true);
  } finally {
    Object.assign(docClient, original);
  }
})();
{
  const room = { phase: 'playing', serverSeed: '00'.repeat(32), dealerHand: [C('A'), C('K')], deck: [C('2')] };
  const visible = publicRoom(room);
  assert.strictEqual(visible.serverSeed, undefined);
  assert.strictEqual(visible.deck, undefined);
  assert.strictEqual(visible.dealerHand[1].rank, '?');
}

// activeCards resolves the card array hit/stand/double/split must mutate:
// base hands live in seat.hand, split hands in hand.cards.
{
  const baseSeat = { hand: [C('9'), C('6')], status: 'active' };
  const cards = activeCards(baseSeat, baseSeat);
  assert.strictEqual(cards, baseSeat.hand);
  cards.push(C('4'));
  assert.strictEqual(baseSeat.hand.length, 3);
  const splitSeat = { status: 'active', hand: [], hands: [{ cards: [C('A'), C('A')], status: 'active' }] };
  assert.strictEqual(activeCards(splitSeat, splitSeat.hands[0]), splitSeat.hands[0].cards);
}

// resolveResults: dealer busts -> everyone wins
{
  const room = { dealerHand: [C('10'), C('8'), C('9')], seats: [
    { status: 'active', hand: [C('9'), C('6')] },      // 15 -> win
    { status: 'busted', hand: [C('10'), C('6')] },     // bust -> loss
    { status: 'blackjack', hand: [C('A'), C('K')] },   // bj -> bj
  ] };
  resolveResults(room);
  assert.strictEqual(room.seats[0].result, 'win');
  assert.strictEqual(room.seats[1].result, 'loss');
  assert.strictEqual(room.seats[2].result, 'blackjack');
}

// resolveResults: split hands each resolved
{
  const room = { dealerHand: [C('10'), C('7')], seats: [
    { status: 'active', hands: [
      { cards: [C('8'), C('7')], status: 'stood' },   // 15 < 17 -> loss
      { cards: [C('A'), C('K')], status: 'active' },  // 21 > 17 -> win (split hand)
    ] },
  ] };
  resolveResults(room);
  assert.strictEqual(room.seats[0].hands[0].result, 'loss');
  assert.strictEqual(room.seats[0].hands[1].result, 'win');
}

// resolveResults: insurance
{
  const room = { dealerHand: [C('A'), C('K')], seats: [
    { status: 'busted', hand: [C('10'), C('6')], insuranceBet: 5 },  // dealer bj -> insurance wins
    { status: 'active', hand: [C('9'), C('8')], insuranceBet: 5 },   // dealer bj -> insurance wins
  ] };
  resolveResults(room);
  assert.strictEqual(room.seats[0].insuranceResult, 'win');
  assert.strictEqual(room.seats[1].insuranceResult, 'win');
}

// resolveResults: insurance loses when dealer has no blackjack
{
  const room = { dealerHand: [C('A'), C('7')], seats: [
    { status: 'active', hand: [C('10'), C('8')], insuranceBet: 5 },  // 18 vs 18 -> push
  ] };
  resolveResults(room);
  assert.strictEqual(room.seats[0].insuranceResult, 'loss');
  assert.strictEqual(room.seats[0].result, 'push');
}

// Natural blackjack beats a non-natural 21; two naturals push.
{
  const dealerNatural = { dealerHand: [C('A'), C('K')], seats: [
    { status: 'stood', hand: [C('7'), C('7'), C('7')] },
    { status: 'blackjack', hand: [C('A'), C('Q')] },
  ] };
  resolveResults(dealerNatural);
  assert.strictEqual(dealerNatural.seats[0].result, 'loss');
  assert.strictEqual(dealerNatural.seats[1].result, 'push');

  const playerNatural = { dealerHand: [C('7'), C('7'), C('7')], seats: [
    { status: 'blackjack', hand: [C('A'), C('K')] },
  ] };
  resolveResults(playerNatural);
  assert.strictEqual(playerNatural.seats[0].result, 'blackjack');
}

settlementChecks.then(() => console.log('blackjack engine self-check: ALL PASS')).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
