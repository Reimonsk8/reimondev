import { describe, expect, it } from 'vitest';
import { outlandsHealthUrl } from './sectorStatus';

describe('outlands sector status helpers', () => {
  it('maps the WebSocket URL to the HTTP health endpoint', () => {
    expect(outlandsHealthUrl('ws://127.0.0.1:3020/outlands')).toBe(
      'http://127.0.0.1:3020/health',
    );
    expect(outlandsHealthUrl('wss://outlands.example.com/outlands')).toBe(
      'https://outlands.example.com/health',
    );
  });
});
