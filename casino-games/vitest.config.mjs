import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        root: '.',
        include: ['lambdas/**/*.test.js', 'server/**/*.test.js', 'frontend/src/**/*.test.{ts,tsx}'],
        exclude: ['**/node_modules/**', '**/blackjack.test.js'],
    },
});
