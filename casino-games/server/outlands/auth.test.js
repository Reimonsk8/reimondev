import { describe, expect, it } from 'vitest';
const { generateKeyPairSync } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { createCognitoVerifier } = require('./auth');

const region = 'us-east-2';
const userPoolId = 'us-east-2_example';
const clientId = 'client-example';
const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

function signingFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'smoke-key', alg: 'RS256', use: 'sig' };
  const token = jwt.sign(
    { sub: 'verified-user', name: 'Verified Operative' },
    privateKey,
    { algorithm: 'RS256', keyid: jwk.kid, audience: clientId, issuer, expiresIn: '5m' },
  );
  return { token, jwk, privateKey };
}

describe('Cognito ID token verification', () => {
  it('checks RS256 signature, issuer, audience, and claims with cached keys', async () => {
    const { token, jwk } = signingFixture();
    let fetches = 0;
    const verify = createCognitoVerifier({
      region,
      userPoolId,
      clientId,
      fetchImpl: async () => {
        fetches += 1;
        return { ok: true, json: async () => ({ keys: [jwk] }) };
      },
    });

    await expect(verify(token)).resolves.toMatchObject({ sub: 'verified-user', name: 'Verified Operative' });
    await expect(verify(token)).resolves.toMatchObject({ sub: 'verified-user' });
    expect(fetches).toBe(1);
  });

  it('rejects forged tokens and tokens with a different audience', async () => {
    const { token, jwk, privateKey } = signingFixture();
    const verify = createCognitoVerifier({
      region,
      userPoolId,
      clientId,
      fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [jwk] }) }),
    });
    const [header, payload] = token.split('.');
    await expect(verify(`${header}.${payload}.${'x'.repeat(300)}`)).rejects.toThrow();

    const wrongAudience = jwt.sign(
      { sub: 'wrong-audience' },
      privateKey,
      { algorithm: 'RS256', keyid: 'smoke-key', audience: 'wrong-client', issuer, expiresIn: '5m' },
    );
    await expect(verify(wrongAudience)).rejects.toThrow();
  });
});
