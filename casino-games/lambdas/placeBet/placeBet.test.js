import { describe, it, expect } from 'vitest';
import { parseBetSide, isValidAmount, calculateGameResult, computeSettlement } from './index.js';

// Deterministic fake for crypto.randomInt: yields queued values, one per call.
function seq(...values) {
    let i = 0;
    return () => values[i++];
}

describe('parseBetSide', () => {
    it('parses coinflip sides case-insensitively', () => {
        expect(parseBetSide('cara').type).toBe('coinflip');
        expect(parseBetSide('CRUZ').side).toBe('cruz');
        expect(parseBetSide('CARA').game).toBe('CoinFlip');
    });

    it('parses roulette number bets only within 0-36', () => {
        expect(parseBetSide('number-7')).toMatchObject({ type: 'roulette', side: 'number-7', target: 7 });
        expect(parseBetSide('number-0').type).toBe('roulette');
        expect(parseBetSide('number-40')).toBeNull();
        expect(parseBetSide('number-7junk')).toBeNull();
    });

    it('parses dice exact bets only within 2-12', () => {
        expect(parseBetSide('exact-7')).toMatchObject({ type: 'dice', side: 'exact-7', target: 7 });
        expect(parseBetSide('exact-1')).toBeNull();
        expect(parseBetSide('exact-13')).toBeNull();
        expect(parseBetSide('exact-7junk')).toBeNull();
        expect(parseBetSide('dice-odd')).toMatchObject({ game: 'Dice', type: 'dice', side: 'odd' });
        expect(parseBetSide('dice-even')).toMatchObject({ game: 'Dice', type: 'dice', side: 'even' });
    });

    it('rejects unknown and client-declared blackjack results', () => {
        expect(parseBetSide('bogus')).toBeNull();
        expect(parseBetSide('blackjack-start')).toBeNull();
        expect(parseBetSide('blackjack-win')).toBeNull();
        expect(parseBetSide('blackjack-loss')).toBeNull();
        expect(parseBetSide({ side: 'red' })).toBeNull();
        expect(parseBetSide('red').type).toBe('roulette');
        expect(parseBetSide('odd').game).toBe('Roulette');
    });
});

describe('isValidAmount', () => {
    it('accepts cents within the demo limit and rejects malformed amounts', () => {
        expect(isValidAmount(0.29)).toBe(true);
        expect(isValidAmount(10000)).toBe(true);
        expect(isValidAmount(0)).toBe(false);
        expect(isValidAmount(1.001)).toBe(false);
        expect(isValidAmount(10000.01)).toBe(false);
        expect(isValidAmount(Infinity)).toBe(false);
        expect(isValidAmount(Number.NaN)).toBe(false);
    });
});

describe('computeSettlement', () => {
    it('pays winAmount - bet on a win', () => {
        expect(computeSettlement(10, true, 2)).toEqual({ winAmount: 20, delta: 10 });
        expect(computeSettlement(10, true, 35)).toEqual({ winAmount: 350, delta: 340 });
    });

    it('deducts the full bet on a loss', () => {
        expect(computeSettlement(10, false, 0)).toEqual({ winAmount: 0, delta: -10 });
    });
});

describe('calculateGameResult with injected rng', () => {
    it('coinflip: rng 0 -> cara', () => {
        const out = calculateGameResult(parseBetSide('cara'), 10, seq(0));
        expect(out.isWin).toBe(true);
        expect(out.multiplier).toBe(2);
        expect(out.result).toBe('cara');
        const loss = calculateGameResult(parseBetSide('cara'), 10, seq(1));
        expect(loss.isWin).toBe(false);
    });

    it('color: rng 0 -> rojo', () => {
        const out = calculateGameResult(parseBetSide('rojo'), 10, seq(0));
        expect(out.isWin).toBe(true);
        expect(calculateGameResult(parseBetSide('negro'), 10, seq(0)).isWin).toBe(false);
    });

    it('wheel: win within 40% (multiplier from second roll), lose above', () => {
        const win = calculateGameResult(parseBetSide('spin'), 10, seq(39, 0));
        expect(win.isWin).toBe(true);
        expect(win.multiplier).toBe(2);
        const lose = calculateGameResult(parseBetSide('spin'), 10, seq(40));
        expect(lose.isWin).toBe(false);
        expect(lose.multiplier).toBe(0);
    });

    it('slots: jackpot when all 3 symbols match', () => {
        const out = calculateGameResult(parseBetSide('slots'), 10, seq(0, 0, 0));
        expect(out.isWin).toBe(true);
        expect(out.multiplier).toBe(50); // diamond paytable
        expect(out.symbols).toEqual(['💎', '💎', '💎']);
    });

    it('slots: 2x when exactly 2 symbols match', () => {
        const out = calculateGameResult(parseBetSide('slots'), 10, seq(0, 1, 1));
        expect(out.isWin).toBe(true);
        expect(out.multiplier).toBe(2);
    });

    it('slots: loss when no symbols match', () => {
        const out = calculateGameResult(parseBetSide('slots'), 10, seq(0, 1, 2));
        expect(out.isWin).toBe(false);
        expect(out.multiplier).toBe(0);
    });

    it('roulette: 32 is red and even, 0 is green', () => {
        const winRed = calculateGameResult(parseBetSide('red'), 10, seq(1)); // index 1 -> 32
        expect(winRed.result).toBe('32 (red)');
        expect(winRed.isWin).toBe(true);
        expect(calculateGameResult(parseBetSide('black'), 10, seq(1)).isWin).toBe(false);
        expect(calculateGameResult(parseBetSide('even'), 10, seq(1)).isWin).toBe(true);
        expect(calculateGameResult(parseBetSide('odd'), 10, seq(1)).isWin).toBe(false);
        expect(calculateGameResult(parseBetSide('number-32'), 10, seq(1)).isWin).toBe(true);
        expect(calculateGameResult(parseBetSide('number-32'), 10, seq(1)).multiplier).toBe(35);

        const green = calculateGameResult(parseBetSide('green'), 10, seq(0)); // index 0 -> 0
        expect(green.isWin).toBe(true);
        expect(calculateGameResult(parseBetSide('red'), 10, seq(0)).isWin).toBe(false);
    });

    it('dice: 5+5=10 is high and even, 4+1=5 is low and odd', () => {
        const high = calculateGameResult(parseBetSide('high'), 10, seq(5, 5));
        expect(high.result).toBe('6+6=12');
        expect(high.isWin).toBe(true);
        expect(calculateGameResult(parseBetSide('exact-12'), 10, seq(5, 5)).isWin).toBe(true);
        expect(calculateGameResult(parseBetSide('exact-12'), 10, seq(5, 5)).multiplier).toBe(6);
        expect(calculateGameResult(parseBetSide('low'), 10, seq(5, 5)).isWin).toBe(false);

        const low = calculateGameResult(parseBetSide('low'), 10, seq(3, 0));
        expect(low.result).toBe('4+1=5');
        expect(low.isWin).toBe(true);
        expect(calculateGameResult(parseBetSide('dice-odd'), 10, seq(3, 0)).isWin).toBe(true);
        expect(calculateGameResult(parseBetSide('dice-even'), 10, seq(5, 5)).isWin).toBe(true);
    });

});
