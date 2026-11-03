import { describe, expect, it } from 'vitest';
import { buildMessage } from './source.js';

describe('wallet link message', () => {
  it('pins origin, address, chain, nonce and expiry', () => {
    const message = buildMessage({ domain: 'https://casino.test', address: '0x0000000000000000000000000000000000000001', nonce: 'abcd1234', issuedAt: '2026-01-01T00:00:00.000Z', expirationTime: '2026-01-01T00:05:00.000Z' });
    expect(message).toContain('https://casino.test wants you to sign in');
    expect(message).toContain('Chain ID: 84532');
    expect(message).toContain('Nonce: abcd1234');
    expect(message).toContain('No transaction or token approval is requested.');
  });
});
