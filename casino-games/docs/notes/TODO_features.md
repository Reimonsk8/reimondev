# Casino888 - Progress Summary + Plan

Authority: `PROJECT_DESIGN.md`. Status: play-money demo, LIVE on AWS + Netlify.
Frontend deploy = `git push origin main` (Netlify auto-build); backend = `npm run deploy` (cdk).

## ✅ Done (in production)

### Core platform
- Auth: signup/verify/login/google-oauth/reset, Cognito, JWT (WS verifies signature via cached JWKS)
- Google OAuth flow live (IdP + client, callback `/oauth2/callback`)
- Wallet: play-money balance, deposit/withdraw/bet, **atomic conditional updates**, transaction history
- Profile: editable nickname/avatar, backfilled from Google claims, stats card
- REST + 2 WebSockets: lobby (move/presence), chat
- Leaderboard lambda + UI
- Lobby map: PixiJS casino floor, avatars, presence, chat bubbles, emotes
- 7 games: Coin Flip, Card Game, Lucky Wheel, Slots, Blackjack, Roulette, Dice
- Delete account (Cognito + all user rows)

### Recent sessions (Aug 2026, all pushed/deployed)
- `a703e5c` Blackjack "Begin Play" crash fixed (DynamoDB `removeUndefinedValues`) — live-verified 2-player round
- `ec63d87` Game modal compacted for 1080p; small modals content-fit
- `87255f7` FitToContainer: games scale to stage, no internal scroll
- `040f6a5` Perf: lobby map pauses while a game modal is open; removed full-screen backdrop blur behind games
- `9800fbd` Batch-5 feedback: **AFK kick is now server-authoritative** — `join` plants `lastActivityAt`, `publicRoom` exposes per-seat `afk` (stale ≥ `BJ_AFK_MS`), `kickSeat` can remove a **ready** seat that went stale-AFK (closes the "clicked ready + walked away" pin exploit; regression-guarded `(room.seats || [])`); CasinoMap global `MAP_SCALE` 1.6→1.75 for reception/carpet/piano/VIP/card-duel air; CoinFlip coin sprite fake-3D flip polish + "Kick (AFK)" ready-button label. Deployed via CDK (WS MessageHandler re-bundled).
- (earlier) atomic wallet, editable profile, server-authoritative identity, lazy-loading, luxury-dark UI

## 🗺️ Square of Shadows — upcoming: Adventure mode

Two modes are offered on the draft screen. **Arena** is implemented and is the
default: a fixed 12×10 mirrored board, two squads, no monsters, no items, no
surprises. **Adventure** is on the menu today but is currently *only* a
generated floor — a different biome per match, drawn from the match seed. The
things that make it "Adventure" are not built yet. This is the plan, not a
promise; the UI labels it "In development" for exactly that reason.

Everything below has to be **engine** work, not view work: the same
`frontend/src/games/squareofshadows/engine/` is bundled into
`lambdas/websocket/sos.js`, so the server stays the authority and each feature
needs a Lambda re-deploy to take effect online.

### A1. Map generation beyond the current biome swap
- The floor is currently one 12×10 arena re-skinned per match. Adventure wants
  *generated geometry* — room-and-corridor layouts, multiple exits, chokepoints.
- `generateWalls` already takes the match seed, so this extends rather than
  replaces it. Layouts must stay **mirrored** for both sides or the match stops
  being fair.
- Open question: fixed size (keeps the existing UI and rules) or variable size
  (needs board-size plumbing through `GameState`, deployment, and the camera).

### A2. Items
- Loot tables seeded per match, dropped on tiles, picked up by stepping on them.
- Item effects are **engine rules**, not UI: they need to survive serialize /
  deserialize (online) exactly like `zones` and `iceWalls` do, or the two
  clients will disagree about the floor.
- Balance risk: items turn Arena's "no surprises" into Adventure's whole point,
  and the two modes must not share a tuning pass.

### A3. Monsters
- Neutral AI units that neither player owns, placed by the generator.
- Big one: neutral units need an owner model. `Unit.ownerId` is currently
  `playerId | AI_PLAYER_ID`, so this is either a new owner value or a party
  concept. Both clients and the Lambda must agree or PvP turns start targeting
  the wrong things.
- Loot/XP on kill, and a reward for clearing a floor — this is the mode's win
  condition, and it is a real design decision, not a checkbox.

### A4. Exploration
- Fog of war / revealed tiles, per player, persisted in `GameState`.
- Doors, keys, chests — anything that gates part of the map.
- An exploration map larger than one screen, which likely forces A1's
  variable-size decision first.

### A5. Rules to settle before writing any of it
- **Turn clock.** Arena is untimed offline by decision. Adventure has monsters
  and loot; whether online Adventure turns are timed needs a call.
- **Death / permadeath.** Today a defeated unit stays in state for animation.
  Losing a unit permanently is a much bigger change than the revive path.
- **Persistence.** Rooms are held in memory in the Lambda. Longer Adventure
  matches raise reconnect and idle-room questions before they raise balance ones.

### Blocked on
- PixelLab balance is exhausted (0 generations). Monster/item/floor art needs
  either credits or hand-drawn placeholders.

## 🔴 Known gaps / must-fix before more features

1. **Game authority (Phase 4)** — outcomes use `Math.random()` in `lambdas/placeBet/index.js:82-218` + blackjack shuffle. Move to Node `crypto.randomInt` (secure), version rules/payouts, record outcome metadata.
2. **Tests/lint/CI (Phase 0) — DONE** — vitest suites for bet outcome math (`lambdas/placeBet/placeBet.test.js`, injectable `rng`) + JWT auth (`lambdas/websocket/auth.test.js`) + blackjack self-check; ESLint; GitHub Actions CI (typecheck, lint, build, test).
3. **Hardcoded endpoints (Phase 1) — DONE** — `api.js`/`useLobby.js`/`oauth.js` read `VITE_*` env with prod fallbacks; `frontend/.env.example` documents them.
4. **Phase 2/5 leftovers** — auth lambda tests; movement/chat rate limiting; broadcast efficiency.
5. **Observability (Phase 7)** — CloudWatch metrics/alarms, structured logging.
6. **Security cleanup** — `cdk.json` holds a real Google OAuth client secret (committed); rank it or move to env/SSM. Git remote has a GitHub PAT baked into the URL — rotate.
7. **Mobile (Phase 6)** — lobby/games not verified at 375/768 widths.

## 🟡 Cost/ops pending

- `cdk.json` `budgetEmail` empty → budget alert emails dormant until filled + redeploy.
- `logRetention: ONE_WEEK` already on all lambdas; stage throttling 20 rps; budget $30 (do not raise without asking).

## Testnet track (Sep 2026)

- Base Sepolia only (`84532`); no mainnet support.
- Provably-fair rounds + browser verifier implemented for six REST games.
- Self-custody wallet linking implemented for injected EIP-1193 wallets; no funds or approvals.
- C888T faucet token + test escrow compile locally but are not deployed.
- Blackjack multiplayer settlement is per-player and idempotent; local tests cover retry, disconnect, and deleted-account isolation.
- Deployment blocked until Google OAuth secret and GitHub PAT are rotated; see `TESTNET_GUIDE.md`.

## 📋 Next plan (phased, per PROJECT_DESIGN.md)

### ✅ P1 – done (Aug 2026)
- WS throttling: server-side chat + emote throttle (2s, `casino-rate-limits` TTL table, `allowAction` helper in `utils.js`); client move cap 12.5/s in `useLobby.js` (server-side per-move limiting skipped — would cost ~$100/mo in DynamoDB writes; client cap fixes the fan-out load for play-money).
- `npm run lint`: ESLint flat config (`eslint.config.mjs`, errors-only), 19 real dead-code findings removed.
- CloudWatch alarms: `casino888-{PlaceBet,Deposit,Withdraw,Login,WsMessage,WsConnect}-errors` (2×5min windows) + optional SNS email wired to `budgetEmail`.

### ✅ P2 – done (Aug 2026)
- `prefers-reduced-motion` blanket for CSS animations + confetti guard in `fx.ts`; `overflow-x: clip` mobile guard. (Touch targets / 375-768 layout review still possible as a visual pass.)

### ✅ P3 – partial (Aug 2026)
- Sound toggle: already existed (SettingsModal → persisted `c888_sound_prefs` → `soundManager`).
- PWA: `frontend/public/manifest.webmanifest` + generated icons + network-first `sw.js` + registration in `main.jsx`.

### ⏳ Remaining (blocked on P0 secure RNG first, per PROJECT_DESIGN.md)
- **P0 – nearly done:** secure RNG DONE (`crypto.randomInt`, commit `efdab2f`). Wallet/bet tests DONE, blackjack covered (self-check), auth tests DONE, `.env.example` + env-var endpoints DONE. **Only open item: fill `budgetEmail` in `cdk.json` + redeploy** (needs your email).
- **P3 still open:** statistics dashboard, daily bonus, friend system, poker.
- **P4 – Not now:** real-money anything, compliance, new financial-logic games.

## Professional product roadmap

Prioritized by trust and user value. New game outcomes and wallet mutations require a separate authority review before implementation.

### P5 - Product cohesion
- First-session guided tour: profile, play-money wallet, lobby movement, chat, and first game.
- Unified game status language: wager, listed payout, settled result, balance change, retry/error.
- Continue/replay affordances that preserve the last safe bet without auto-submitting it.
- Searchable rules center with payout tables and a persistent play-money disclaimer.
- Notification center with read state for bonuses, achievements, social events, and system notices.

### P6 - Social casino
- Friend requests, online status, private invitations, mute/block/report, and privacy controls.
- Party groups that enter a table together; spectator mode remains read-only.
- Table reactions and moderated emotes with the existing WebSocket throttle.
- Shareable profile cards and opt-in achievement showcases.
- Presence rooms so lobby broadcasts do not require full-table scans as usage grows.

### P7 - Player progression
- Statistics dashboard: per-game sessions, win rate, wager volume, payout, streaks, and recent form.
- Server-awarded daily challenges and achievements with idempotent claim handling.
- Cosmetic-only levels, titles, card backs, table themes, and avatar items.
- Seasonal play-money leaderboards with clear reset dates and archived winners.
- Personal goals and session summaries without changing odds or encouraging loss chasing.

### P8 - Responsible play and accessibility
- Session timer, configurable play-money limits, cool-off reminders, and clear simulated-funds labels.
- Full keyboard and screen-reader pass for lobby movement, games, chat, and nested dialogs.
- High-contrast mode, text-size preference, reduced-transparency mode, and independent music/effect volume.
- Localization foundation for UI, dates, currencies, rules, and right-to-left layouts.
- Automated viewport and accessibility checks at 375, 768, 1024, and 1440 widths.

### P9 - Reliability and performance
- Frontend error boundary per lazy game, retry UI, and client release/version reporting.
- WebSocket reconnect diagnostics, offline state, message delivery status, and stale-session recovery.
- Core Web Vitals and game/lobby FPS telemetry with privacy-safe sampling.
- Asset budgets, route-level bundle budgets, canvas lifecycle tests, and low-power graphics mode.
- API contract tests for every game result so displayed outcomes cannot diverge from settlements.

### P10 - Operations and moderation
- Structured audit events and dashboards for auth, wallet, game, WebSocket, and moderation failures.
- Admin-only player lookup, mute/ban review, report queue, and immutable operator action history.
- Feature flags and maintenance banners with safe defaults and no client authority over payouts.
- Runbooks, synthetic smoke tests, backup/restore drills, and deployment health checks.
- Secret rotation and environment separation before any wider public launch.

### Explicitly gated
- Poker or any new financial-logic game: define server rules, settlement model, tests, and UI contract first.
- Real-money deposits, withdrawals, prizes, or cash-equivalent rewards: compliance/KYC/AML/legal work first.
- Voice chat, user-generated media, and direct messaging: moderation, reporting, privacy, and cost plan first.
