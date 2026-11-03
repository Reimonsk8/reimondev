import { describe, expect, it } from 'vitest';
import {
  inviteMessage,
  isValidRoomCode,
  makeRoomCode,
  normalizeRoomCode,
  parseRoomCode,
  roomInviteUrl,
} from './invite';

describe('sos invite links', () => {
  it('generates codes from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = makeRoomCode();
      expect(code).toHaveLength(6);
      // I/O/0/1 are excluded so a code survives being read aloud.
      expect(code).not.toMatch(/[01IO]/);
      expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]+$/);
    }
  });

  it('does not repeat itself across many draws', () => {
    const seen = new Set(Array.from({ length: 500 }, () => makeRoomCode()));
    // 32^6 is ~1e9, so 500 draws colliding at all would be a real bug.
    expect(seen.size).toBeGreaterThan(495);
  });

  it('normalises sloppy user input', () => {
    expect(normalizeRoomCode('b7kq2m')).toBe('B7KQ2M');
    expect(normalizeRoomCode('B7KQ-ZM!')).toBe('B7KQZM');
    expect(normalizeRoomCode('B7KQ2MEXTRA')).toBe('B7KQ2M');
    expect(normalizeRoomCode(null)).toBe('');
  });

  it('validates length after normalisation', () => {
    expect(isValidRoomCode('B7KQ2M')).toBe(true);
    expect(isValidRoomCode('b7kq')).toBe(false);
    expect(isValidRoomCode('')).toBe(false);
  });

  it('builds an absolute invite URL on the SoS route', () => {
    expect(roomInviteUrl('b7kq2m', 'https://example.test')).toBe(
      'https://example.test/square-of-shadows?room=B7KQ2M',
    );
  });

  it('round-trips a code through a query string', () => {
    const code = makeRoomCode();
    expect(parseRoomCode(`?room=${code}`)).toBe(code);
    expect(parseRoomCode(`room=${code.toLowerCase()}`)).toBe(code);
    expect(parseRoomCode('?room=' + code + '&foo=1')).toBe(code);
  });

  it('rejects missing or malformed room params', () => {
    expect(parseRoomCode('')).toBe('');
    expect(parseRoomCode(null)).toBe('');
    expect(parseRoomCode('?room=short')).toBe('');
    expect(parseRoomCode('?other=1')).toBe('');
  });

  it('includes the host nickname and code in the share text', () => {
    const message = inviteMessage('B7KQ2M', 'Ada');
    expect(message).toContain('Ada');
    expect(message).toContain('B7KQ2M');
    expect(message).toContain('/square-of-shadows?room=B7KQ2M');
  });

  it('still produces a usable message without a nickname', () => {
    const message = inviteMessage('B7KQ2M');
    expect(message).toContain('/square-of-shadows?room=B7KQ2M');
    expect(message).not.toContain('undefined');
  });
});