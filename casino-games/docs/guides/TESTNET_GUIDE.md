# Casino888 Testnet Guide

Status: Base Sepolia only. C888T and all testnet balances have no monetary value.

## Implemented locally

- Provably-fair HMAC-SHA256 rounds for Coin Flip, Card Duel, Lucky Wheel, Slots, Roulette, and Dice.
- Browser verification of commitment, RNG draws, outcome, multiplier, and payout.
- Cognito-authenticated self-custody wallet linking by one-time signed message.
- Fixed Base Sepolia chain ID `84532`; no mainnet chain configuration.
- `Casino888TestToken` faucet token and `TestGameEscrow` source compile locally.
- `npm run testnet:status` verifies RPC network and reports configured contract addresses.

Multiplayer Blackjack uses per-player atomic, idempotent settlement. Deleted accounts are skipped without blocking other payouts. Solo Blackjack remains disabled because it must not handle balances client-side.

## Required before AWS deploy

1. Rotate leaked Google OAuth secret in Google Cloud.
2. Store new value as SecureString `/casino888/google-client-secret` in `us-east-2`.
3. Rotate leaked GitHub PAT. Git remote now contains no embedded token.
4. Run `npm install && npm run build` in `lambdas/walletLink` so bundled `index.js` is current.
5. Run root quality gates and `npx cdk synth`.

## Required before contract deploy

1. Create dedicated Base Sepolia deploy wallet. Never commit private key or seed phrase.
2. Fund it only with faucet Base Sepolia ETH.
3. Obtain external smart-contract review.
4. Deploy token, then escrow with token address and operator address.
5. Set `C888T_ADDRESS`, `C888_ESCROW_ADDRESS`, `VITE_C888T_ADDRESS`, and `VITE_C888_ESCROW_ADDRESS`.
6. Run `npm run testnet:status`; it must report `deployed: true`.

No Robinhood brokerage integration exists. Injected EIP-1193 wallets work locally. Robinhood Wallet mobile needs a WalletConnect/Reown project ID and physical Base Sepolia compatibility test before claiming support.

## Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npx tsc --noEmit
npx cdk synth
npm run testnet:status
```

Contracts:

```bash
cd contracts
npm install
npm run build
```
