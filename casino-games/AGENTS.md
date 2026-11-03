# AGENTS.md

Casino888: real-time multiplayer casino-style web app. React/Vite frontend, AWS CDK backend (Cognito, API Gateway REST + one WebSocket API, DynamoDB, Lambda). Frontend hosts on Netlify; backend deploys via CDK. Demo / play-money only — see `PROJECT_DESIGN.md`, the authority document.

## Required reading before editing

- `PROJECT_DESIGN.md` (currently untracked in git) — authority doc; it mandates "analysis before implementation" for anything touching auth, wallet, game outcomes, infrastructure, or shared state, and requires verification commands + known risks in prompts.
- `ARCHITECTURE.md` — system diagrams (Mermaid), REST/WS route map, data model, deploy pipeline.
- `DEPLOYMENT_GUIDE.md` — deployment/troubleshooting flow for the WebSocket lobby.

## Commands

- `npm run dev` — Vite dev server on port 3000, root is `frontend/`. Frontend talks to the already-deployed AWS prod endpoints (no local backend).
- `npm run build` — Vite build of `frontend/` → `dist/` at repo root (Netlify publish dir). This is the de-facto frontend verification step.
- `npm run typecheck` — `tsc --noEmit -p frontend/tsconfig.json` (strict). Must stay clean; it catches "Cannot find name" reference errors (two of which have caused production blank-screen crashes). Do not commit code that adds errors here.
- `npm run lint` — ESLint (flat config `eslint.config.mjs`, errors-only via `--quiet`). After a fresh clone run `npm install` first.
- `npm run deploy` (== `cdk deploy`) — deploys backend. `npx cdk bootstrap` needed once per account/region first.
- `npm run test` — Vitest (`lambdas/**/*.test.js` + `frontend/src/**/*.test.{ts,tsx}`) + blackjack self-check. `npm run test:sos` runs the focused SoS engine/stat/transport suite; `npm run test:sos:smoke` launches a Chrome smoke journey (set `PUPPETEER_EXECUTABLE_PATH` if Chrome is not on a standard path). CI runs both the full suite and browser smoke.
- `lambdas/placeBet` exports its pure logic (`parseBetSide`/`calculateGameResult`/`computeSettlement`); `calculateGameResult` takes an injectable `rng` (default `crypto.randomInt`) so tests drive deterministic outcomes. For CDK TypeScript only: `npx tsc --noEmit` (root `tsconfig.json` includes only `bin/` and `lib/`). Verify the stack with `npx cdk synth` before deploying.
- **CDK gotcha:** the Lambda prop is `reservedConcurrentExecutions` (NOT `reservedConcurrency`) and API Gateway throttling lives on the RestApi `deployOptions` (NOT on `MethodOptions`). Both typos break `tsc`/synth.

## Cost guardrails (workflow)

Dev-only spend protection already baked into `lib/casino-infra-stack.ts`:

- `commonLambdaProps` sets `logRetention: ONE_WEEK` for all REST lambdas (overrides: `lambdas/games/leaderboard` and websocket handlers also have `logRetention`).
- **No `reservedConcurrentExecutions` anywhere** — the account's total concurrency limit is 10 (unreserved must stay ≥ 10), so reserving any lambda fails the deploy with a 400. The real cost ceilings are the account limit + budget + stage throttling.
- Stage throttling on the REST API: `deployOptions { throttlingRateLimit: 20, throttlingBurstLimit: 10 }` (renders as `MethodSettings` on the prod Stage).
- Monthly budget `casino888-dev-budget` ($30 default) via `budgets.CfnBudget` — reads `context.budgetEmail` / `context.budgetLimit` from `cdk.json`. Budget is always created; email alerts at 50/80/100% only fire when `budgetEmail` is non-empty. Changing either requires a redeploy. Tagged `Project=casino888` (prop is `resourceTags`, NOT `tags`).
- Keep these values low — solo dev, ~5 users. Do not bump them without asking.

## Layout

- `frontend/` — React app, mixed `.jsx`/`.js`/`.tsx` (allowJs). Games in `frontend/src/games/`; shared UI in `frontend/src/components/` (modals like `CasinoRules`, `OnlinePlayersModal` live here, not in DashboardView); hooks in `frontend/src/hooks/`. Games + `CasinoMap` are `React.lazy`-loaded (pixi.js stays out of the initial bundle).
- `lib/casino-infra-stack.ts`, `bin/casino-infra.ts` — CDK stack. Every Lambda, DynamoDB table, and API route is defined here.
- `lambdas/` — per-Lambda folders, each with handler `index.handler`.

## Lambda deploy gotcha (important)

CDK bundles each lambda via `Code.fromAsset('lambdas/<dir>')` — whatever is in the folder is zipped as-is. AWS SDK v3 is NOT provided by the Node 20 runtime, so:

- Each lambda folder needing `@aws-sdk/*` must have its own `package.json` (committed) AND `node_modules` (gitignored, so absent after a fresh clone). Run `npm install` inside the lambda dir before `cdk deploy`, or the deploy bundle will miss the SDK.
- Multi-handler lambdas share one bundle + `node_modules` at the folder root: `lambdas/websocket/{connect,disconnect,move,message}/index.js` share `../utils.js`.
- REST endpoint additions in the stack must be mirrored here; the stack also wires env vars (table names, `WEBSOCKET_ENDPOINT`, `API_ENDPOINT`, `CHAT_WEBSOCKET_ENDPOINT`). `delete-account` also gets `PLAYERS_TABLE_NAME` + `CONNECTIONS_TABLE_NAME` via explicit `environment` override.

## Frontend styling (Tailwind v4 — no config file)

- Tailwind v4 runs via `@tailwindcss/postcss`; there is **no `tailwind.config.*`**. All Tailwind + hand-written CSS lives in `frontend/src/App.css` (~2.1k lines, luxury-dark theme with `--gold`/`--emerald` tokens in `:root`).
- Custom Tailwind colors are defined in the `@theme` block at the top of App.css (`--color-accent-gold`, `--color-bg-main`). Utilities like `bg-accent-gold`/`text-accent-gold` (used in `Modal.jsx`) **silently generate nothing** unless the `--color-*` var exists in `@theme`. To add a new color utility, add the var there.
- `Modal.jsx` builds its overlay as `custom-container-${variant}`; the `variant` prop (`game`/`players`/`default`/`notification`/`chat`) maps to a `.custom-container-<name>` class in App.css. New modal styles = add the class in App.css, don't inline-style modals.
- DashboardView uses `is-mobile`/`is-fullscreen` modifier classes for responsive lobby layout (defined in App.css) — extend those, not inline `style={{}}`.

## VFX (pixelfx)

- All new game VFX is generated with the vendored [pixelfx](https://github.com/patch-gg/pixelfx) at `vendor/pixelfx` (MIT, no runtime dependency). Full guide: `docs/VFX_PIPELINE.md`.
- `npm run vfx` renders every effect in `scripts/vfx/effects.mjs` into `frontend/public/sprites/vfx/<slug>/` (one horizontal `strip.png` + `manifest.json`), rewrites `sprites/vfx/index.json`, and regenerates `frontend/src/games/pixelFx.generated.ts`. `npm run vfx -- <slug>` exports a single effect. Never hand-edit generated files.
- SOS plays strips with CSS `steps()` via `SOS_PIXEL_FX` in `games/squareofshadows/pixelFx.ts`; Outlands slices them into PIXI textures through `games/zombie-shooter/vfx/pixelFx.ts` (`PixelFxLayer.play`), hooked into `engine/renderer.ts` `consumeEvents`.

## Frontend endpoints are hardcoded

- `frontend/src/utils/api.js:1` — `API_BASE` is a hardcoded prod REST URL.
- `frontend/src/hooks/useLobby.js:4-5` — hardcoded `DEFAULT_WEBSOCKET_URL` overridden by `VITE_WEBSOCKET_URL`.
- There is no committed `.env`. After changing the backend stack, update these hardcoded values (or use `VITE_WEBSOCKET_URL`); otherwise the frontend keeps hitting stale prod URLs.

## Auth

- Cognito tokens live in localStorage under `c888_id_token`, `c888_access_token`, `c888_refresh_token`, `c888_user_id`. `frontend/src/utils/api.js` sends the Bearer id token and force-logs-out on 401.
- Google IdP maps `fullname`/`profilePicture` → Cognito `name`/`picture` claims; `getUserProfile` captures them into `nickname`/`avatarImage` on auto-create + backfills existing users. `POST /auth/delete-account` (Cognito-authorizer protected) deletes the Cognito user + all user rows (users, transactions, players, connections).
- The WebSocket backend `verifyToken` (`lambdas/websocket/utils.js`) verifies the JWT signature against the Cognito user pool's cached JWKS (1h TTL) and checks issuer + audience. `lambdas/websocket/connect/index.js` takes identity only from the verified token and rejects invalid tokens with 401. Identity (nickname/avatar) is **server-authoritative**: connect reads the user's `nickname`/`avatarImage` from the `casino-users` table (needs `USERS_TABLE_NAME` env + read grant on `webSocketConnectFn`), and `move` refuses to clobber it with a `null` avatarImage or the `'Player'` placeholder nickname.

## Deploy flow

GitHub push → Netlify auto-builds (`netlify.toml`: `npm run build`, publish `dist/`, SPA redirect to `/index.html`). Backend deploys are separate via `npm run deploy`. No GitHub Actions exist.

## Upcoming / pending work

- **Done (batch-5 feedback, commit `9800fbd`, deployed):** AFK kick is server-authoritative on the blackjack WebSocket (not frontend-only) — `join` plants `lastActivityAt`, `publicRoom` computes per-seat `afk` against `BJ_AFK_MS`, and `kickSeat` can now remove a **ready** seat that went stale-AFK (previously ready seats were unkickable). Frontend kick button shows "Kick (AFK)" for those seats (`Blackjack.tsx`). CasinoMap spacing bump via global `MAP_SCALE` (1.6→1.75). CoinFlip coin sprite flip polish. All verified (typecheck/build/test/self-check) and deployed.
- **Config in `cdk.json` context** (budget alerts dormant until filled + redeployed):
  - `budgetEmail` — activates 50/80/100% budget alert emails.
  - `googleClientId` / `googleClientSecret` / `netlifyUrl` — **Google OAuth is LIVE**: IdP + client OAuth flows deployed, `frontend/src/utils/oauth.js` hardcodes the deployed client ID `1vuv9q9um88odm8cgcct6p7705` (overridable via `VITE_COGNITO_CLIENT_ID`). Callback: `<netlifyUrl>/oauth2/callback`. To change/revoke, update `cdk.json` + `lib/casino-infra-stack.ts` (client `node.addDependency(googleIdP)` required — CDK won't order IdP before client otherwise) and redeploy.
