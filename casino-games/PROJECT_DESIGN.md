# Casino888 Project Design

Status: Authority document for phased development
Last updated: 2026-08-10
Repo stage: MVP advanced prototype (play-money demo, LIVE on AWS + Netlify)
Progress tracker: TODO_features.md

Phase status (2026-08-10): Phases 2-3 and most of 5 implemented; Phase 0 partial (no tests/CI yet); Phase 1 partial (URLs still hardcoded); Phase 4 NOT started (bet outcomes still use Math.random()); Phases 6-8 partial; Phase 9 correctly deferred.

## 1. Purpose

This document is the product and engineering authority for Casino888. Future prompts, code changes, pull requests, and implementation phases should follow this design unless this file is intentionally updated first.

Casino888 is a real-time multiplayer casino-style web application with:

- React/Vite frontend.
- AWS CDK infrastructure.
- Cognito authentication.
- API Gateway REST endpoints.
- API Gateway WebSocket lobby and chat.
- DynamoDB persistence.
- Lambda backend logic.
- Wallet, transactions, lobby, games, leaderboard, and player presence.

Important boundary: until compliance, auditability, responsible gaming, and secure random generation are completed, this product must be treated as a demo, internal prototype, or play-money experience. It must not be represented as production-ready gambling software.

## 2. Current Repo Assessment

Current level: 5.5/10 as a technical product, 7/10 as a demo, 2/10 as real-money casino infrastructure.

Strengths:

- Full-stack shape already exists.
- CDK defines Cognito, REST API, WebSocket APIs, DynamoDB tables, and Lambda functions.
- Frontend has multiple game views and a visual lobby.
- Wallet and transaction flows exist.
- Multiplayer presence and chat are partially implemented.
- The project has enough surface area to evolve by phases instead of being rewritten.

Weaknesses to fix before production:

- No visible test suite, CI, lint, or automated quality gates.
- Some environment values are hardcoded in frontend code.
- WebSocket token handling decodes JWT payloads without cryptographic verification.
- Game outcomes use `Math.random()` and are not auditable.
- CORS is broadly open.
- Some DynamoDB resources use development removal policies.
- Several Lambda handlers log full events or sensitive request metadata.
- Dependency tree currently reports a missing declared package: `ws`.
- Existing docs mix old state, deployment notes, and feature ideas.

## 3. Product Vision

Casino888 should become a polished real-time casino lobby where users can:

- Authenticate safely.
- Manage a play-money wallet.
- Enter a live lobby with avatars and chat.
- Launch casino-style games from a shared environment.
- View personal statistics and transaction history.
- Compete on fair leaderboards.
- Receive clear feedback for wins, losses, connection state, and account actions.

The desired feel is premium, fast, social, and trustworthy. It should not feel like a loose collection of games. The lobby, wallet, profile, chat, and games should behave as one coherent product.

## 4. Product Principles

Trust first:

- Money-like balances, bets, transactions, and outcomes must be server-authoritative.
- The client may animate outcomes, but must not decide financial state.
- Every wallet mutation must leave an immutable transaction trail.

AI-native development:

- Every development prompt should reference this file.
- Each phase should produce small, reviewable changes.
- Prompts must ask for analysis before implementation when a change touches auth, wallet, game outcomes, infrastructure, or shared state.
- AI-generated changes must include verification commands and known risks.

Mobile-first casino lobby:

- The first screen after login should be useful on mobile and desktop.
- Touch targets must be at least 44px.
- No horizontal scrolling on mobile.
- Critical controls must not rely on hover.

Operational clarity:

- Configuration must come from environment variables or CDK outputs.
- Logs should be useful but must not expose tokens, passwords, or full sensitive events.
- Deploy instructions should match the actual repo and current environments.

Phased progress:

- Do not add new games or cosmetic features before stabilizing security, configuration, testing, and architecture basics.
- Each phase must have a Definition of Done.

## 5. Target User Experience

Primary user flow:

1. User opens the app.
2. User signs up, verifies email, or logs in.
3. User lands in the dashboard/lobby.
4. User sees wallet balance, profile, status, and available games.
5. User joins the live lobby.
6. User moves avatar, sees other players, and can chat.
7. User opens a game from the lobby or game list.
8. User places a bet.
9. Server resolves outcome and returns authoritative result.
10. UI updates balance, stats, transaction history, and feedback.

Secondary flows:

- User customizes avatar.
- User reviews transaction history.
- User sees leaderboard.
- User toggles sound and visual settings.
- User disconnects/reconnects from lobby.
- User receives useful error states when auth, wallet, or WebSocket fails.

## 6. Information Architecture

Recommended app sections:

- Auth: login, signup, verification, resend code.
- Dashboard: account overview, balance, recent transactions, stats.
- Lobby: live map, player list, chat, game entry points.
- Games: Coin Flip, Card Game, Lucky Wheel, Slots, Blackjack, Roulette, Dice.
- Profile: avatar, nickname, preferences, session controls.
- Leaderboard: daily, weekly, all-time rankings.
- Admin/ops later: health, suspicious activity, game configuration, audit tools.

The dashboard and lobby may share one shell, but navigation should make state obvious:

- Current account.
- Current connection state.
- Current game/session state.
- Current wallet balance.

## 7. UI/UX Standard

Design direction:

- Premium casino interface, but restrained enough for repeated use.
- Avoid one-note color themes. Gold can be an accent, not the whole palette.
- Use dark surfaces with strong contrast, readable text, and controlled highlights.
- Use consistent radii, spacing, icon style, and motion timing.

Accessibility:

- Normal text contrast target: WCAG AA 4.5:1.
- Interactive targets: minimum 44x44px.
- Visible focus states required.
- Keyboard navigation must work for auth, wallet, modals, tabs, and game controls where possible.
- Reduced motion must be respected for heavy game/lobby effects.

Responsive behavior:

- Mobile-first breakpoints: 375, 768, 1024, 1440.
- No fixed desktop-only layouts for primary flows.
- Fixed toolbars and bottom controls must account for safe areas.
- Text must not overlap cards, buttons, canvas, or modals.

Interaction:

- Buttons show loading/disabled states during async requests.
- Wallet actions require explicit confirmation when destructive or irreversible.
- Errors appear near the relevant action.
- Modals must close through escape/cancel paths.
- Game animations are presentation only; backend remains authoritative.

## 8. Architecture Target

Frontend:

- React 19 with Vite.
- Components grouped by product domain.
- Hooks handle feature state and API/WebSocket boundaries.
- UI components should not hardcode deployed AWS URLs.
- Game components should receive server result data when financial state is involved.

Backend:

- Lambda handlers for auth, wallet, games, lobby, chat, and leaderboard.
- Shared backend utilities for response formatting, validation, logging, token verification, and DynamoDB access.
- All wallet and game mutations must be atomic when possible.
- Lambda input validation must reject unknown or unsupported actions.

Infrastructure:

- AWS CDK is the source of truth for cloud resources.
- Environments should be explicit: local, dev, staging, production.
- Production resources must use safe removal policies.
- CORS origins must be environment-specific.
- CDK outputs must feed frontend configuration through a controlled process.

Persistence:

- Users table stores profile and aggregate stats.
- Transactions table stores immutable wallet/game transaction records.
- Players/connections tables store transient lobby state with TTL.
- Future audit tables should store game outcome proofs and risk events.

Realtime:

- WebSocket connection must verify identity server-side.
- Presence updates should be throttled.
- Movement payloads must be validated for speed, bounds, and shape.
- Broadcast should avoid scans at larger scale; move toward room/index based queries.

## 9. Security And Trust Requirements

Authentication:

- Cognito is the identity provider.
- REST protected endpoints use Cognito authorizer.
- WebSocket connect must verify JWT signature and claims, not only decode payload.
- Do not accept `userId` from query params as authority over identity.

Wallet:

- Wallet balance changes happen only in backend.
- Each balance change writes a transaction.
- Withdraw/deposit flows in demo mode must be clearly labeled as simulated.
- Production money movement requires a payment provider, KYC/AML, fraud checks, and compliance review.

Game outcomes:

- Client-side random is allowed only for visual effects.
- Backend outcome generation must use a secure source.
- For casino-grade mode, outcomes need auditable/provably fair design or regulated RNG.
- Each outcome should record inputs, result, payout, timestamp, and versioned game rules.

Logging:

- Never log passwords, tokens, full Authorization headers, or full raw auth events.
- Use structured logs with request id, user id, action, status, latency, and error class.
- User-facing errors should be clear but not leak internals.

Abuse prevention:

- Add rate limits for auth, wallet, bet, chat, and movement.
- Validate bet amount min/max.
- Validate allowed game actions.
- Add chat moderation hooks before public launch.
- Add anomaly detection for wallet and betting behavior.

## 10. AI-Native Engineering Standard

Every implementation prompt should include:

- Goal.
- Files or modules likely involved.
- Phase from this document.
- Acceptance criteria.
- Verification commands.
- Risk level.
- Instruction to preserve unrelated user changes.

Every AI change should:

- Read current code before editing.
- Keep changes scoped.
- Prefer existing repo patterns.
- Avoid broad refactors unless the phase requires it.
- Add or update tests for changed behavior.
- Report verification results.
- Note follow-up risks.

AI agents must not:

- Invent production claims not supported by code.
- Add real-money language unless compliance phase is complete.
- Store secrets in frontend or repo files.
- Use client state as authority for wallet, bets, auth, or identity.
- Replace user changes without explicit approval.

## 11. Development Phases

### Phase 0: Repo Stabilization

Goal: make the repo clean, installable, and verifiable.

Scope:

- Fix dependency mismatch (`ws` missing from installed tree).
- Add lint/typecheck/test scripts.
- Add basic CI or documented local quality command.
- Separate generated/build artifacts from source.
- Normalize docs so README points to this design and current setup.

Definition of Done:

- `npm install` produces a valid dependency tree.
- `npm run build` succeeds.
- `npx tsc --noEmit` succeeds for CDK.
- A single documented verification command exists.
- No production secrets or generated build folders are intended for commit.

### Phase 1: Configuration And Environments

Goal: remove hardcoded deployment URLs and make environments explicit.

Scope:

- Replace hardcoded REST API and WebSocket URLs with Vite env variables.
- Document `.env.example`.
- Align Netlify config with Vite build.
- Add environment names and deployment notes.
- Ensure CDK outputs are documented.

Definition of Done:

- No frontend source hardcodes deployed AWS URLs.
- Local/dev/staging/prod values are documented.
- App fails clearly if required config is missing.

### Phase 2: Auth And Session Hardening

Goal: make identity handling trustworthy.

Scope:

- Verify WebSocket JWT signature and claims.
- Stop trusting query `userId` as identity authority.
- Clean token storage and expiration handling.
- Remove sensitive auth logging.
- Add auth tests for Lambda handlers/utilities.

Definition of Done:

- Invalid or forged WebSocket tokens are rejected.
- Full auth tokens are never logged.
- REST and WebSocket identity behavior is tested.

### Phase 3: Wallet And Transaction Integrity

Goal: make wallet behavior reliable and auditable in demo mode.

Scope:

- Add strict amount validation and min/max bet/deposit/withdraw config.
- Use conditional writes or transactions to prevent race issues.
- Standardize transaction schema.
- Make demo-money labeling explicit.
- Add wallet Lambda tests.

Definition of Done:

- Wallet mutations are atomic.
- Negative, NaN, infinity, overflow, and invalid currency inputs are rejected.
- Each mutation creates a clear transaction record.

### Phase 4: Game Engine Authority

Goal: make backend the only authority for game outcomes.

Scope:

- Create shared game result module.
- Remove generic fallback betting behavior.
- Version game rules and payout tables.
- Replace `Math.random()` for financial outcomes with secure RNG.
- Ensure frontend only animates server results.

Definition of Done:

- Unsupported bets are rejected.
- Every game has a backend rules test.
- Client cannot force win/loss by passing a local result.

### Phase 5: Realtime Lobby Reliability

Goal: make multiplayer presence stable and safe.

Scope:

- Validate movement payloads.
- Add rate limiting/throttling.
- Handle stale connections consistently.
- Improve broadcast efficiency.
- Split lobby movement and chat concerns clearly.

Definition of Done:

- Movement outside bounds is rejected or clamped server-side.
- Excessive movement/chat messages are throttled.
- Disconnect cleanup works.
- Two-browser lobby test is documented.

### Phase 6: UI System And Mobile Polish

Goal: make the product feel coherent and professional.

Scope:

- Define design tokens for color, spacing, radius, type, z-index, motion.
- Normalize buttons, modals, tabs, panels, inputs, and game shells.
- Improve mobile lobby and game controls.
- Add accessible focus and reduced-motion behavior.
- Remove overlapping text/layout issues.

Definition of Done:

- Core flows work at 375, 768, 1024, and 1440 widths.
- No horizontal scroll on mobile.
- Primary controls meet touch target requirements.
- UI states exist for loading, empty, error, success, disabled.

### Phase 7: Observability And Operations

Goal: make failures visible and deploys safer.

Scope:

- Add structured logging.
- Add CloudWatch metrics/alarms for key Lambdas.
- Add frontend error tracking hook or provider.
- Add deployment checklist.
- Track API errors, bet failures, auth failures, and WebSocket disconnects.

Definition of Done:

- Operators can see backend error rate and latency.
- Key failures have searchable request ids.
- Deploy guide reflects actual process.

### Phase 8: Product Expansion

Goal: add new product value after the foundation is safe.

Candidates:

- Daily bonus.
- Toast notifications.
- Sound controls.
- Statistics dashboard.
- Daily/weekly/all-time leaderboard.
- Friend system.
- Poker or multiplayer table games.
- PWA install flow.

Definition of Done:

- New features follow the security and UX standards above.
- Each feature includes tests and verification notes.
- No feature bypasses wallet/game authority rules.

### Phase 9: Production/Compliance Gate

Goal: decide whether this remains play-money entertainment or moves toward regulated use.

Required for real-money consideration:

- Legal review by jurisdiction.
- Responsible gaming controls.
- KYC/AML provider integration.
- Payment provider integration.
- Fraud/risk program.
- Auditable RNG or provably fair system.
- Incident response plan.
- Data privacy review.
- Penetration testing.
- Financial reconciliation.

Definition of Done:

- Written compliance approval exists.
- Product copy, UI, and backend behavior match approved operating model.

## 12. Prompt Contract

Use this block in future implementation prompts:

```text
Use PROJECT_DESIGN.md as the authority.
Work only on the requested phase/scope.
Read relevant files before editing.
Preserve unrelated user changes.
Do not introduce hardcoded deployed URLs, secrets, or production gambling claims.
Server must remain authoritative for auth, wallet, bets, game outcomes, and identity.
Add or update tests when behavior changes.
Run verification commands and report results.
If a requested change conflicts with PROJECT_DESIGN.md, stop and explain the conflict.
```

Recommended prompt template:

```text
Phase: <number and name from PROJECT_DESIGN.md>
Goal: <specific outcome>
Scope: <files/modules/features>
Acceptance criteria:
- <criterion 1>
- <criterion 2>
Verification:
- <command 1>
- <command 2>
Risk notes:
- <security/wallet/realtime/UI risk if any>
```

## 13. Quality Gates

Minimum gate for any PR/change:

- Build succeeds.
- Typecheck succeeds where applicable.
- Tests pass where tests exist.
- No unrelated files are reformatted.
- No secret, token, password, or private key is added.
- No hardcoded deployed endpoint is added to frontend source.
- User-facing copy does not claim real-money readiness.

Higher gate for auth/wallet/game changes:

- Unit tests required.
- Invalid input tests required.
- Security impact noted.
- Transaction or audit impact noted.
- Rollback/deploy risk noted.

Higher gate for UI changes:

- Mobile and desktop checked.
- Loading/error/empty states considered.
- Focus and keyboard behavior considered.
- Reduced motion considered for heavy animations.
- No text overlap or horizontal scroll.

## 14. Canonical Technical Decisions

Frontend framework: React with Vite.

Infrastructure: AWS CDK v2.

Auth: AWS Cognito.

Database: DynamoDB.

Backend runtime: Node.js Lambda.

Realtime: API Gateway WebSocket.

Hosting: Netlify for frontend, AWS for backend.

Source of truth for cloud resources: `lib/casino-infra-stack.ts`.

Source of truth for product/engineering direction: this file.

## 15. Non-Goals For Near-Term Phases

Do not prioritize these until Phases 0-5 are complete:

- Real-money deposits/withdrawals.
- New payment provider integration.
- Public gambling launch.
- Complex admin console.
- Large visual redesign without fixing foundations.
- New multiplayer games that require new financial logic.

## 16. Open Questions

- Should Casino888 remain play-money only, or eventually target real-money compliance?
- Which environment should be considered canonical dev/staging/prod?
- Should chat use the existing lobby WebSocket or stay a separate WebSocket API?
- Should the app use one shared API client and one shared WebSocket client abstraction?
- What is the desired game fairness model: secure server RNG, provably fair, or regulated RNG provider?
- What is the minimum device target for mobile lobby performance?

## 17. Immediate Recommended Next Step

Start with Phase 0, then Phase 1. The project should not add more casino features until install/build/configuration and endpoint management are clean.

Suggested first implementation prompt:

```text
Use PROJECT_DESIGN.md as the authority.
Phase: 0 Repo Stabilization
Goal: make the repo installable and verifiable without changing product behavior.
Scope: package.json, package-lock.json, README or docs only if needed.
Acceptance criteria:
- npm ls --depth=0 passes.
- npm run build passes.
- npx tsc --noEmit passes.
- No unrelated source behavior changes.
Verification:
- npm ls --depth=0
- npm run build
- npx tsc --noEmit
Preserve unrelated user changes.
```
