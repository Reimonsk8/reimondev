const { createHash, createHmac, randomBytes } = require('crypto');

const createServerSeed = () => randomBytes(32).toString('hex');
const hashSeed = (seed) => createHash('sha256').update(seed, 'utf8').digest('hex');
const createFairRng = (serverSeed, clientSeed, nonce) => {
  let cursor = 0;
  return (max) => {
    const ceiling = 2 ** 48;
    const limit = Math.floor(ceiling / max) * max;
    let value;
    let attempt = 0;
    do {
      const digest = createHmac('sha256', Buffer.from(serverSeed, 'hex')).update(`${clientSeed}:${nonce}:${cursor}:${attempt}`).digest();
      value = digest.readUIntBE(0, 6);
      attempt += 1;
    } while (value >= limit);
    cursor += 1;
    return value % max;
  };
};

module.exports = { createServerSeed, hashSeed, createFairRng };
