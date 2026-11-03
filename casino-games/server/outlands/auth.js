const jwt = require('jsonwebtoken');
const { createPublicKey } = require('node:crypto');

/** Verifies Cognito ID tokens with cached JWKS; never trusts client-sent IDs. */
function createCognitoVerifier({
  region = process.env.AWS_REGION,
  userPoolId = process.env.USER_POOL_ID,
  clientId = process.env.USER_POOL_CLIENT_ID,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  cacheTtlMs = 60 * 60 * 1000,
} = {}) {
  let cachedKeys = null;
  let fetchedAt = 0;

  async function getKeys() {
    if (cachedKeys && now() - fetchedAt < cacheTtlMs) return cachedKeys;
    if (!region || !userPoolId || typeof fetchImpl !== 'function') {
      throw new Error('Cognito verifier configuration is incomplete');
    }
    const url = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error('Unable to fetch Cognito signing keys');
    const data = await response.json();
    if (!Array.isArray(data.keys)) throw new Error('Invalid Cognito JWKS response');
    cachedKeys = data.keys;
    fetchedAt = now();
    return cachedKeys;
  }

  return async function verifyCognitoIdToken(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 8192) {
      throw new Error('Invalid token');
    }
    if (!clientId || !userPoolId || !region) throw new Error('Cognito verifier configuration is incomplete');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Unsupported token signature');
    const keys = await getKeys();
    const jwk = keys.find((key) => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk) throw new Error('Unknown token signing key');
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    return jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      audience: clientId,
      issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
    });
  };
}

module.exports = { createCognitoVerifier };
