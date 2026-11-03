import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyToken } from './utils.js';

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
const KID = 'test-key-1';
const REGION = 'us-test-1';
const USER_POOL = 'us-test-1_abc';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL}`;
const CLIENT_ID = 'test-client';

function signJwt(payload, { kid = KID, aud = CLIENT_ID, iss = ISSUER } = {}) {
    const header = b64url({ alg: 'RS256', kid, typ: 'JWT' });
    const body = b64url({
        ...payload,
        aud,
        iss,
        exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const signature = sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url');
    return `${header}.${body}.${signature}`;
}

beforeAll(() => {
    process.env.AWS_REGION = REGION;
    process.env.USER_POOL_ID = USER_POOL;
    process.env.USER_POOL_CLIENT_ID = CLIENT_ID;
    global.fetch = async () => ({
        ok: true,
        json: async () => ({ keys: [{ kid: KID, use: 'sig', alg: 'RS256', ...jwk }] }),
    });
});

afterAll(() => {
    delete global.fetch;
});

describe('verifyToken', () => {
    it('rejects missing or malformed tokens', async () => {
        await expect(verifyToken(null)).rejects.toThrow('Missing token');
        await expect(verifyToken('a.b')).rejects.toThrow('Malformed token');
    });

    it('accepts a valid Bearer token and returns the payload', async () => {
        const payload = await verifyToken(`Bearer ${signJwt({ sub: 'user-1' })}`);
        expect(payload.sub).toBe('user-1');
        expect(payload.aud).toBe(CLIENT_ID);
    });

    it('rejects a token signed by an unknown key (wrong kid)', async () => {
        await expect(verifyToken(signJwt({ sub: 'user-1' }, { kid: 'other' })))
            .rejects.toThrow('Unknown signing key');
    });

    it('rejects a token for a different audience', async () => {
        await expect(verifyToken(signJwt({ sub: 'user-1' }, { aud: 'other-client' })))
            .rejects.toThrow('jwt audience invalid');
    });

    it('rejects a token from a different issuer', async () => {
        await expect(verifyToken(signJwt({ sub: 'user-1' }, { iss: 'https://cognito-idp.us-test-1.amazonaws.com/other-pool' })))
            .rejects.toThrow('jwt issuer invalid');
    });

    it('rejects a tampered signature', async () => {
        const good = signJwt({ sub: 'user-1' });
        const [h, p] = good.split('.');
        await expect(verifyToken(`${h}.${p}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`))
            .rejects.toThrow();
    });
});
