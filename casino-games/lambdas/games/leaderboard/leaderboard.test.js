import { describe, expect, it } from 'vitest';
import { resolveGame } from './index.js';

describe('leaderboard game mapping', () => {
    it('maps every current game to its arcade cabinet', () => {
        expect(resolveGame({ gameName: 'CoinFlip' }).gameId).toBe('coinflip-1');
        expect(resolveGame({ gameName: 'CardGame' }).gameId).toBe('cardgame-1');
        expect(resolveGame({ gameName: 'LuckyWheel' }).gameId).toBe('luckywheel-1');
        expect(resolveGame({ gameName: 'Slots' }).gameId).toBe('slots-1');
        expect(resolveGame({ gameName: 'Blackjack' }).gameId).toBe('blackjack-1');
        expect(resolveGame({ gameName: 'Roulette' }).gameId).toBe('roulette-1');
        expect(resolveGame({ gameName: 'Dice' }).gameId).toBe('dice-1');
    });

    it('falls back to details for older transactions', () => {
        expect(resolveGame({ gameDetails: 'Slots - Result: WIN' })).toEqual({ gameName: 'Slot Machine', gameId: 'slots-1' });
    });
});
