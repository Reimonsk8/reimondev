const MAX_MESSAGE_BYTES = 8192;
const WEAPONS = new Set(['melee', 'pistol', 'shotgun', 'smg', 'sniper', 'rifle', 'heavy']);

function isVector(value) {
  return value && typeof value === 'object'
    && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function boundedVector(value, fallback) {
  if (!isVector(value)) return fallback;
  return {
    x: Math.max(-1, Math.min(1, value.x)),
    y: Math.max(-1, Math.min(1, value.y)),
  };
}

function parseClientMessage(raw) {
  const bytes = Buffer.isBuffer(raw) ? raw.byteLength : Buffer.byteLength(String(raw));
  if (bytes === 0 || bytes > MAX_MESSAGE_BYTES) return null;

  let message;
  try {
    message = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
  } catch {
    return null;
  }
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') return null;

  if (message.type === 'authenticate') {
    if (typeof message.token !== 'string' || message.token.length < 20 || message.token.length > 8192) return null;
    const outposts = new Set(['nastya', 'pastor', 'secronom', 'sector09']);
    return { type: 'authenticate', token: message.token, outpostId: outposts.has(message.outpostId) ? message.outpostId : 'nastya' };
  }
  if (message.type === 'input') {
    if (!Number.isSafeInteger(message.seq) || message.seq < 0 || message.seq > 0x7fffffff) return null;
    const aim = boundedVector(message.input?.aim, { x: 1, y: 0 });
    if (Math.hypot(aim.x, aim.y) < 1e-6) return null;
    const input = {
      move: boundedVector(message.input?.move, { x: 0, y: 0 }),
      aim,
      firing: message.input?.firing === true,
      reload: message.input?.reload === true,
      sprint: message.input?.sprint === true,
    };
    if (WEAPONS.has(message.input?.weapon)) input.weapon = message.input.weapon;
    if (WEAPONS.has(message.input?.weaponSwitch)) input.weaponSwitch = message.input.weaponSwitch;
    const slot = message.input?.loadoutSlot;
    if ((slot === 0 || slot === 1) && WEAPONS.has(message.input?.loadoutWeapon)) {
      input.loadoutSlot = slot;
      input.loadoutWeapon = message.input.loadoutWeapon;
    }
    return { type: 'input', seq: message.seq, input };
  }
  if (message.type === 'ping') {
    return { type: 'ping', id: Number.isSafeInteger(message.id) ? message.id : 0 };
  }
  if (message.type === 'redeploy') return { type: 'redeploy' };
  return null;
}

module.exports = { MAX_MESSAGE_BYTES, parseClientMessage };
