import { describe, expect, it } from 'vitest';
import { createFairRng, hashSeed } from './fairness.js';

describe('provably fair primitives', () => {
    const serverSeed = '00'.repeat(32);

    it('hashes commitments and produces stable unbiased draws', () => {
        expect(hashSeed(serverSeed)).toBe('60e05bd1b195af2f94112fa7197a5c88289058840ce7c6df9693756bc6250f55');
        const rng = createFairRng(serverSeed, 'casino888-client', 7);
        expect([rng(2), rng(37), rng(6)]).toEqual([0, 30, 3]);
        expect(rng.draws).toEqual([
            { cursor: 0, max: 2, result: 0, attempt: 0 },
            { cursor: 1, max: 37, result: 30, attempt: 0 },
            { cursor: 2, max: 6, result: 3, attempt: 0 },
        ]);
    });

    it('changes output when client seed or nonce changes', () => {
        expect(createFairRng(serverSeed, 'client-a', 0)(100)).not.toBe(createFairRng(serverSeed, 'client-b', 0)(100));
        expect(createFairRng(serverSeed, 'client-a', 0)(100)).not.toBe(createFairRng(serverSeed, 'client-a', 1)(100));
    });
});
