import { describe, expect, it } from 'vitest';
const { parseClientMessage, MAX_MESSAGE_BYTES } = require('./protocol');

describe('Outlands socket protocol', () => {
  it('accepts auth, bounded input, ping, and redeploy messages', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'authenticate', token: 'x'.repeat(40), outpostId: 'pastor' })))
      .toEqual({ type: 'authenticate', token: 'x'.repeat(40), outpostId: 'pastor' });
    expect(parseClientMessage(JSON.stringify({ type: 'authenticate', token: 'x'.repeat(40), outpostId: 'invalid' }))?.outpostId)
      .toBe('nastya');
    const input = parseClientMessage(JSON.stringify({
      type: 'input',
      seq: 12,
      input: {
        move: { x: 8, y: -3 },
        aim: { x: 0.2, y: 0.9 },
        firing: true,
        reload: false,
        sprint: true,
        weapon: 'shotgun',
      },
    }));
    expect(input).toMatchObject({
      type: 'input',
      seq: 12,
      input: { move: { x: 1, y: -1 }, firing: true, sprint: true, weapon: 'shotgun' },
    });
    expect(parseClientMessage('{"type":"ping","id":4}')).toEqual({ type: 'ping', id: 4 });
    expect(parseClientMessage('{"type":"redeploy"}')).toEqual({ type: 'redeploy' });
  });

  it('passes a loadout slot assignment through, and drops invalid ones', () => {
    const parse = (input) => parseClientMessage(JSON.stringify({ type: 'input', seq: 3, input }))
      ?.input;
    expect(parse({ aim: { x: 1, y: 0 }, loadoutSlot: 1, loadoutWeapon: 'pistol' }))
      .toMatchObject({ loadoutSlot: 1, loadoutWeapon: 'pistol' });
    expect(parse({ aim: { x: 1, y: 0 }, loadoutSlot: 2, loadoutWeapon: 'pistol' })?.loadoutSlot)
      .toBeUndefined();
    expect(parse({ aim: { x: 1, y: 0 }, loadoutSlot: 0, loadoutWeapon: 'railgun' })?.loadoutWeapon)
      .toBeUndefined();
  });

  it('rejects malformed, oversized, non-finite, and unsupported commands', () => {    expect(parseClientMessage('{')).toBeNull();
    expect(parseClientMessage('x'.repeat(MAX_MESSAGE_BYTES + 1))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'input', seq: 1, input: { aim: { x: 0, y: 0 } } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'input', seq: -1, input: {} }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'admin', playerId: 'trusted?' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'authenticate', token: 'short' }))).toBeNull();
  });
});
