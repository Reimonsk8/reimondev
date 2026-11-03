type Draw = { cursor: number; max: number; result: number; attempt: number };
type Proof = { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number; draws: Draw[]; selection?: string; isWin?: boolean; multiplier?: number; betAmount?: number; winAmount?: number };

const bytesToHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g)?.map((byte) => parseInt(byte, 16)) || []);

export async function verifyProof(proof: Proof) {
  const encoder = new TextEncoder();
  const hash = bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(proof.serverSeed)));
  if (hash !== proof.serverSeedHash) return false;
  const key = await crypto.subtle.importKey('raw', hexToBytes(proof.serverSeed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  for (let index = 0; index < proof.draws.length; index += 1) {
    const draw = proof.draws[index];
    if (draw.cursor !== index || !Number.isInteger(draw.max) || draw.max < 1 || !Number.isInteger(draw.result) || draw.result < 0 || draw.result >= draw.max || !Number.isInteger(draw.attempt) || draw.attempt < 0) return false;
    const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${proof.clientSeed}:${proof.nonce}:${draw.cursor}:${draw.attempt}`)));
    const value = digest.slice(0, 6).reduce((total, byte) => total * 256 + byte, 0);
    const ceiling = 2 ** 48;
    const limit = Math.floor(ceiling / draw.max) * draw.max;
    if (value >= limit || value % draw.max !== draw.result) return false;
  }
  return true;
}

export function verifyOutcome(game: string, result: string, proof: Proof) {
  const values = proof.draws.map((draw) => draw.result);
  let expectedResult = '';
  let expectedMultiplier = 0;
  if (game === 'CoinFlip' && proof.draws.length === 1 && proof.draws[0].max === 2) { expectedResult = values[0] === 0 ? 'cara' : 'cruz'; expectedMultiplier = expectedResult === proof.selection ? 2 : 0; }
  else if (game === 'CardGame' && proof.draws.length === 1 && proof.draws[0].max === 2) { expectedResult = values[0] === 0 ? 'rojo' : 'negro'; expectedMultiplier = expectedResult === proof.selection ? 2 : 0; }
  else if (game === 'LuckyWheel' && proof.draws[0]?.max === 100 && proof.draws.length === (values[0] < 40 ? 2 : 1)) { const win = values[0] < 40; expectedResult = win ? 'WIN' : 'LOSE'; expectedMultiplier = win && proof.draws[1]?.max === 4 ? values[1] + 2 : 0; }
  else if (game === 'Dice' && proof.draws.length === 2 && proof.draws.every((draw) => draw.max === 6)) {
    const total = values[0] + values[1] + 2; expectedResult = `${values[0] + 1}+${values[1] + 1}=${total}`;
    const selected = proof.selection; const win = selected === 'high' ? total >= 8 : selected === 'low' ? total <= 6 : selected === 'odd' ? total % 2 === 1 : selected === 'even' ? total % 2 === 0 : selected?.startsWith('exact-') ? total === Number(selected.slice(6)) : false;
    expectedMultiplier = win ? (selected?.startsWith('exact-') ? 6 : 2) : 0;
  }
  if (game === 'Roulette') {
    const wheel = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
    const red = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
    const number = wheel[values[0]];
    if (proof.draws.length !== 1 || proof.draws[0].max !== 37) return false;
    expectedResult = `${number} (${number === 0 ? 'green' : red.has(number) ? 'red' : 'black'})`;
    const color = number === 0 ? 'green' : red.has(number) ? 'red' : 'black'; const selected = proof.selection;
    const win = selected === color || selected === 'odd' && number !== 0 && number % 2 === 1 || selected === 'even' && number !== 0 && number % 2 === 0 || selected === `number-${number}`;
    expectedMultiplier = win ? (selected === 'green' || selected?.startsWith('number-') ? 35 : 2) : 0;
  }
  if (game === 'Slots') {
    if (proof.draws.length !== 3 || proof.draws.some((draw) => draw.max !== 8)) return false;
    const symbols = ['💎', '🍀', '🍒', '🍋', '🍊', '🍇', '🍉', '⭐'];
    const paytable: Record<string, number> = { '💎': 50, '🍀': 25, '🍒': 15, '⭐': 10, '🍋': 8, '🍊': 6, '🍇': 5, '🍉': 4 };
    const reels = values.map((value) => symbols[value]);
    const matches = reels[0] === reels[1] && reels[1] === reels[2] ? 'JACKPOT' : reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2] ? 'WIN' : 'LOSE';
    expectedResult = `${matches} ${reels.join(' ')}`;
    expectedMultiplier = matches === 'JACKPOT' ? paytable[reels[0]] : matches === 'WIN' ? 2 : 0;
  }
  const expectedWin = expectedMultiplier > 0;
  const expectedPayout = expectedWin ? Number(proof.betAmount) * expectedMultiplier : 0;
  return Boolean(expectedResult) && result === expectedResult && proof.isWin === expectedWin && proof.multiplier === expectedMultiplier && Math.abs(Number(proof.winAmount) - expectedPayout) < 1e-8;
}
