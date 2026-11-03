import { beforeEach, describe, expect, it, vi } from 'vitest';
import { marshall } from '@aws-sdk/util-dynamodb';
import deposit from './index.js';
import withdraw from '../withdrawFunds/index.js';

const key = '123e4567-e89b-42d3-a456-426614174000';
const event = (amount = 10) => ({
  body: JSON.stringify({ amount, idempotencyKey: key }),
  requestContext: { authorizer: { claims: { sub: 'user-1' } } },
});
const body = (result) => JSON.parse(result.body);
const canceled = () => Object.assign(new Error('canceled'), { name: 'TransactionCanceledException' });

describe('wallet mutation idempotency', () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    deposit.setDynamoDBClient({ send });
    withdraw.setDynamoDBClient({ send });
    process.env.USERS_TABLE_NAME = 'users';
    process.env.TRANSACTIONS_TABLE_NAME = 'transactions';
    process.env.GAME_ROUNDS_TABLE_NAME = 'rounds';
  });

  it('uses a stable transaction key and exact balance condition for deposits', async () => {
    send.mockResolvedValueOnce({ Item: marshall({ userId: 'user-1', currentBalance: 100 }) })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const result = await deposit.handler(event());

    expect(result.statusCode).toBe(200);
    expect(body(result).newBalance).toBe(110);
    const transaction = send.mock.calls[2][0].input.TransactItems;
    expect(transaction[0].Update.ConditionExpression).toContain('currentBalance = :currentBalance');
    expect(transaction[1].Put.ConditionExpression).toBe('attribute_not_exists(userId)');
    expect(transaction[2].Put.TableName).toBe('rounds');
    expect(deposit.operationRecordId(key)).toBe(withdraw.operationRecordId(key));
  });

  it('returns the committed deposit on retry without a second mutation', async () => {
    send.mockResolvedValueOnce({ Item: marshall({ userId: 'user-1', currentBalance: 110 }) })
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(canceled())
      .mockResolvedValueOnce({ Item: marshall({ userId: 'user-1', recordId: deposit.operationRecordId(key), type: 'DEPOSIT', amount: 10, response: { message: 'Deposit successful', amount: 10, newBalance: 110 } }) });

    const result = await deposit.handler(event());

    expect(result.statusCode).toBe(200);
    expect(body(result).newBalance).toBe(110);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('returns the committed withdrawal on retry and rejects unrelated conflicts', async () => {
    send.mockResolvedValueOnce({ Item: marshall({ userId: 'user-1', currentBalance: 90 }) })
      .mockResolvedValueOnce({ Item: marshall({ userId: 'user-1', recordId: withdraw.operationRecordId(key), type: 'WITHDRAWAL', amount: 10, response: { message: 'Withdrawal successful', amount: 10, newBalance: 90 } }) });
    expect((await withdraw.handler(event())).statusCode).toBe(200);

    send.mockReset();
    send.mockResolvedValueOnce({ Item: marshall({ userId: 'user-1', currentBalance: 100 }) })
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(canceled())
      .mockResolvedValueOnce({});
    const conflict = await withdraw.handler(event());
    expect(conflict.statusCode).toBe(409);
  });

  it('rejects malformed idempotency keys before DynamoDB', async () => {
    const result = await deposit.handler({ ...event(), body: JSON.stringify({ amount: 10, idempotencyKey: 'bad' }) });
    expect(result.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects sub-cent amounts that would disagree with the applied balance', async () => {
    const result = await deposit.handler(event(0.10000000001));
    expect(result.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('rounds decimal balances to cents and rejects reuse with another operation', async () => {
    send.mockResolvedValueOnce({ Item: marshall({ userId: 'user-1', currentBalance: 0.2 }) })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const result = await deposit.handler(event(0.1));
    expect(body(result).newBalance).toBe(0.3);

    send.mockReset();
    send.mockResolvedValueOnce({ Item: marshall({ userId: 'user-1', currentBalance: 0.3 }) })
      .mockResolvedValueOnce({ Item: marshall({ userId: 'user-1', recordId: deposit.operationRecordId(key), type: 'DEPOSIT', amount: 0.1, response: {} }) });
    expect((await withdraw.handler(event(0.1))).statusCode).toBe(409);
  });

  it('blocks mutations and replay responses for tombstoned users', async () => {
    send.mockResolvedValueOnce({ Item: marshall({ userId: 'user-1', deletionStatus: 'DELETING' }) });
    expect((await deposit.handler(event())).statusCode).toBe(409);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
