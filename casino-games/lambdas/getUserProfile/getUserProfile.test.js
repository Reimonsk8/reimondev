import { beforeEach, describe, expect, it, vi } from 'vitest';
import { marshall } from '@aws-sdk/util-dynamodb';
import profile from './index.js';

const { handler, setDynamoDBClient } = profile;
const send = vi.fn();

const getEvent = (targetUserId, claims = { sub: 'self', email: 'self@example.com' }) => ({
    httpMethod: 'GET',
    queryStringParameters: targetUserId ? { userId: targetUserId } : null,
    requestContext: { authorizer: { claims } },
});

const body = (result) => JSON.parse(result.body);
const conditionalFailure = () => Object.assign(new Error('condition failed'), { name: 'ConditionalCheckFailedException' });

describe('getUserProfile concurrency and privacy', () => {
    beforeEach(() => {
        send.mockReset();
        setDynamoDBClient({ send });
        process.env.USERS_TABLE_NAME = 'users';
    });

    it('returns 404 for a missing foreign user without writing', async () => {
        send.mockResolvedValueOnce({});

        const result = await handler(getEvent('missing'));

        expect(result.statusCode).toBe(404);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0].constructor.name).toBe('GetItemCommand');
    });

    it('returns only public identity fields for an existing foreign user', async () => {
        send.mockResolvedValueOnce({ Item: marshall({
            userId: 'other', email: 'private@example.com', currentBalance: 999,
            nickname: 'Other', totalGames: 2, totalWins: 1,
        }) });

        const result = await handler(getEvent('other'));

        expect(result.statusCode).toBe(200);
        expect(body(result)).toMatchObject({ userId: 'other', nickname: 'Other' });
        expect(body(result)).not.toHaveProperty('email');
        expect(body(result)).not.toHaveProperty('currentBalance');
        expect(body(result)).not.toHaveProperty('totalGames');
    });

    it('conditionally creates own profile and rereads winner after a race', async () => {
        const winner = { userId: 'self', email: 'winner@example.com', nickname: 'Winner' };
        send.mockResolvedValueOnce({})
            .mockRejectedValueOnce(conditionalFailure())
            .mockResolvedValueOnce({ Item: marshall(winner) });

        const result = await handler(getEvent());

        expect(result.statusCode).toBe(200);
        expect(body(result)).toMatchObject({ nickname: 'Winner', email: 'winner@example.com' });
        expect(body(result)).not.toHaveProperty('currentBalance');
        expect(send.mock.calls[1][0].input.ConditionExpression).toBe('attribute_not_exists(userId)');
        expect(send.mock.calls[2][0].input.ConsistentRead).toBe(true);
    });

    it('backfills only missing profile fields and keeps concurrent customization', async () => {
        const old = { userId: 'self', email: 'self@example.com' };
        const customized = { ...old, nickname: 'Custom', avatarImage: 'custom.png' };
        send.mockResolvedValueOnce({ Item: marshall(old) })
            .mockRejectedValueOnce(conditionalFailure())
            .mockResolvedValueOnce({ Item: marshall(customized) });

        const result = await handler(getEvent(null, {
            sub: 'self', email: 'self@example.com', name: 'Google Name', picture: 'google.png',
        }));

        expect(result.statusCode).toBe(200);
        expect(body(result)).toMatchObject({ nickname: 'Custom', avatarImage: 'custom.png' });
        const update = send.mock.calls[1][0];
        expect(update.constructor.name).toBe('UpdateItemCommand');
        expect(update.input.UpdateExpression).toBe('SET #field = :value');
        expect(update.input.ConditionExpression).toContain('attribute_not_exists(#field)');
        expect(update.input).not.toHaveProperty('Item');
        expect(JSON.stringify(update.input)).not.toMatch(/currentBalance|totalGames/);
        expect(send.mock.calls[2][0].input.ConsistentRead).toBe(true);
        expect(send).toHaveBeenCalledTimes(3);
    });

    it('uses ALL_NEW from successful backfill without rewriting wallet fields', async () => {
        const old = { userId: 'self', email: 'self@example.com', nickname: 'Player' };
        const updated = { ...old, avatarImage: 'google.png' };
        send.mockResolvedValueOnce({ Item: marshall(old) })
            .mockResolvedValueOnce({ Attributes: marshall(updated) });

        const result = await handler(getEvent(null, { sub: 'self', email: 'self@example.com', picture: 'google.png' }));

        expect(result.statusCode).toBe(200);
        expect(body(result)).toMatchObject({ avatarImage: 'google.png' });
        const update = send.mock.calls[1][0].input;
        expect(update.ReturnValues).toBe('ALL_NEW');
        expect(update.ConditionExpression).toContain('attribute_not_exists(avatarCustomized)');
        expect(JSON.stringify(update)).not.toMatch(/currentBalance|totalGames/);
    });

    it('POST requires an existing row and maps failed condition to 404', async () => {
        send.mockRejectedValueOnce(conditionalFailure());
        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({ nickname: 'New name' }),
            requestContext: { authorizer: { claims: { sub: 'self' } } },
        };

        const result = await handler(event);

        expect(result.statusCode).toBe(404);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0].constructor.name).toBe('UpdateItemCommand');
        expect(send.mock.calls[0][0].input.ConditionExpression).toContain('attribute_exists(userId)');
        expect(send.mock.calls[0][0].input.ConditionExpression).toContain('attribute_not_exists(deletionStatus)');
    });

    it('persists an explicit avatar removal and marks it customized', async () => {
        send.mockResolvedValueOnce({});
        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({ nickname: 'New name', avatarImage: '' }),
            requestContext: { authorizer: { claims: { sub: 'self' } } },
        };

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        const values = send.mock.calls[0][0].input.ExpressionAttributeValues;
        expect(values[':avatarImage']).toEqual({ S: '' });
        expect(values[':avatarCustomized']).toEqual({ BOOL: true });
    });
});
