# ReimonDev Games — System Architecture

A play-money game library with a casino mini-game. React/Vite frontend on Netlify, serverless AWS backend (Cognito + API Gateway + DynamoDB + Lambda) deployed via CDK.

Status: **LIVE (demo / play-money only)**. Authority docs: `PROJECT_DESIGN.md` (product), `lib/casino-infra-stack.ts` (infra source of truth).

Diagrams use Mermaid — render in GitHub/VS Code, and parse programmatically.

---

## 1. System Context

```mermaid
graph LR
    U["Browser User"] -->|HTTPS / WSS| F["Frontend (Netlify)<br/>React 19 + Vite + PixiJS<br/>dist/ auto-built on git push"]

    F -->|"HTTPS REST<br/>Bearer JWT"| R["API Gateway REST<br/>api: casino-auth-api /prod"]
    F -->|"WSS (token in query)"| W["API Gateway WebSocket<br/>casino-websocket-api /prod"]

    R -->|invoke| RESTL["REST Lambdas"]
    W -->|invoke| WSL["WS Lambdas"]

    RESTL --> D[("DynamoDB")]
    WSL --> D

    COG["Cognito User Pool<br/>email+password + Google IdP"] -.->|JWKS / verify| W
    F -->|"token exchange<br/>/oauth2/callback"| COG

    CW["CloudWatch<br/>Alarms ×6, Budget $30/mo, Logs 7d"] -.->|metrics/logs| RESTL
    CW -.->|metrics/logs| WSL
```

---

## 2. REST API (server-authoritative backend)

| Area | Route | Lambda | Auth |
|------|-------|--------|------|
| Auth | `POST /auth/signup`, `/verify`, `/login`, `/forgot`, `/confirm-forgot-password` | `lambdas/{signup,verify,login,forgot,confirm-forgot}` | public |
| Auth | `POST /auth/delete-account` | `lambdas/delete-account` | Cognito authorizer |
| Wallet | `GET/POST /wallet/profile` | `lambdas/getUserProfile` (GET=read own/`?userId=` public profile, POST=update nickname/avatar) | Cognito authorizer |
| Wallet | `GET /wallet/transactions` | `lambdas/getTransactionHistory` | Cognito |
| Wallet | `POST /wallet/deposit` · `/withdraw` · `/bet` | `lambdas/depositFunds` · `withdrawFunds` · `placeBet` | Cognito |
| Lobby | `GET /players/status` | `lambdas/players/status` | Cognito |
| Games | `GET /games/leaderboard` | `lambdas/games/leaderboard` | **public** |

```mermaid
sequenceDiagram
    participant F as Frontend
    participant R as API Gateway REST
    participant L as Lambda
    participant D as DynamoDB

    F->>R: POST /wallet/bet {amount, side}
    Note over R: Cognito authorizer validates Bearer JWT
    R->>L: invoke placeBet
    L->>L: validate amount/side, map game rules
    L->>L: outcome = crypto.randomInt (secure RNG)
    L->>D: TransactWriteItems (atomic)<br/>users: balance+delta, totalGames/Wins/Wagered/biggestWin<br/>transactions: BET + WIN/LOSS rows
    D-->>L: committed
    L-->>R: {isWin, winAmount, result, newBalance, message}
    R-->>F: 200 JSON
```

Key rules: every balance change is one atomic `TransactWriteItems` (users table + 2 transaction rows) → no race conditions, immutable audit trail. Outcomes are decided **server-side only**; the client animates the server result.

---

## 3. Auth Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant C as Cognito
    participant L as auth Lambdas
    participant D as DynamoDB (casino-users)

    alt Email + password
        U->>F: signup form
        F->>L: POST /auth/signup
        L->>C: SignUp
        U->>F: verification code
        F->>L: POST /auth/verify
        L->>C: ConfirmSignUp
        F->>L: POST /auth/login → InitiateAuth
        L-->>F: {id_token, access_token}
    else Google OAuth
        U->>C: hosted UI sign-in
        C-->>F: redirect /oauth2/callback?code=
        F->>C: exchangeCodeForTokens (PKCE client)
        C-->>F: tokens
    end
    F->>F: store c888_id_token/access/refresh/user_id (localStorage)
    F->>L: GET /wallet/profile (Bearer)
    L->>D: auto-create user row (balance $100) or backfill Google name/avatar
    L-->>F: profile
```

- WS identity is **server-authoritative**: `connect` verifies the JWT signature via cached JWKS (1h TTL) and takes identity only from verified claims + the users table — query-param `nickname` is a fallback, never authority.

---

## 4. WebSocket Lobby + Chat + Blackjack

```mermaid
graph TD
    F["Frontend useLobby.js + CasinoMap (PixiJS)"] -->|"wss://…/prod?token=…"| W["API Gateway WS"]

    W -->|"$connect"| C["connect/index.js<br/>verify JWT (JWKS) → put players+connections rows<br/>zombie-killer cleanup → broadcast playerJoined"]
    W -->|"$disconnect"| D["disconnect/index.js<br/>delete rows → broadcast playerLeft"]
    W -->|"action: move"| M["move/index.js<br/>validate payload → broadcast move (excl. sender)"]
    W -->|"action: getSnapshot"| S["message/index.js<br/>listPlayers → send snapshot to requester"]
    W -->|"type: chat"| MSG["message/index.js<br/>rate-limit (casino-rate-limits, 2s) → broadcast chat"]
    W -->|"action: emote"| EM["message/index.js<br/>rate-limit 2s → broadcast emote bubble"]
    W -->|"action: gameStatus"| GS["message/index.js<br/>persist players.currentGame → broadcast playerGame"]
    W -->|"action: ping"| P["message/index.js<br/>reply pong (keepalive)"]
    W -->|"action: bj:*"| BJ["blackjack.js<br/>server-authoritative multiplayer engine<br/>rooms in blackjack-rooms table"]

    C --> T[("casino-connections")]
    C --> P2[("casino-players")]
    D --> T
    D --> P2
    M --> P2
    BJ --> R[("blackjack-rooms")]
    MSG --> RAT[("casino-rate-limits")]
```

Chat and emotes ride the **same** WebSocket API as lobby presence — there is a single WS API (`casino-websocket-api`), not two. All WS lambdas share one bundle (`lambdas/websocket/` → `utils.js`, `blackjack.js`).

---

## 5. Data Model (DynamoDB)

All tables are **pay-per-request** (on-demand). Removal policies: `casino-users`, `casino-transactions`, `blackjack-rooms` = **RETAIN**; `casino-players`, `casino-connections`, `casino-rate-limits` = DESTROY + **TTL**.

```mermaid
erDiagram
    casino-users ||--o{ casino-transactions : "1 user → many txs"
    casino-users ||--o{ casino-connections : "1 user → WS connections"
    casino-users ||--o{ casino-players : "1 user → lobby presence"
    casino-users ||--o{ casino-rate-limits : "throttle keys"

    casino-users {
        string userId PK
        string email
        number currentBalance
        string nickname
        string avatarImage
        number totalGames totalWins totalWagered totalWon biggestWin
        string createdAt updatedAt
    }
    casino-transactions {
        string userId PK
        number timestamp SK
        string transactionId
        string type "BET | WIN | LOSS | DEPOSIT | WITHDRAW"
        number amount
        string gameName
        string gameDetails
        number balanceAfter
        string createdAt
    }
    casino-players {
        string connectionId PK
        string roomId SK
        string userId "GSI: userIdIndex"
        string playerId nickname
        number avatarSize direction
        string avatarColor avatarImage currentGame status
        object position
        number ttl "expires +1h"
    }
    casino-connections {
        string connectionId PK
        string userId
        number ttl
    }
    blackjack-rooms {
        string roomId PK
        object state
        number ttl
    }
    casino-rate-limits {
        string key PK
        number ttl
    }
```

---

## 6. Frontend Structure

```mermaid
graph TD
    MAIN["main.jsx<br/>PWA SW registration"] --> APP["App.jsx<br/>useAuth + useWallet + useLobby + useTransactions<br/>wires DashboardView / AuthView"]
    APP --> DASH["DashboardView.jsx<br/>tabs: profile | lobby"]
    DASH --> MAP["CasinoMap.tsx (React.lazy)<br/>PixiJS floor, avatars, plaques"]
    DASH --> PANEL["LeaderboardPanel.jsx<br/>collapsible sidebar (30s poll)"]
    DASH --> STATS["MyStatsCard.jsx<br/>lifetime + per-game breakdown"]
    DASH --> META["PlayerMeta.jsx<br/>Levels, Achievements, DailyBonus, Settings"]
    DASH --> CHAT["GlobalChat.tsx"]
    DASH -->|opens| GAMES["games/ (React.lazy)<br/>CoinFlip CardGame LuckyWheel Slots Blackjack Roulette Dice Outlands"]
    DASH --> HOOKS["hooks/useLobby.js<br/>WS client, 12.5 msg/s move cap"]
    GAMES --> WALLET["useWallet.placeBet → REST"]
    GAMES --> SHELL["GameShell + FitToContainer<br/>scale to stage"]
    GAMES --> OUTLANDS["Outlands<br/>PixiJS v7 + pure isometric sim<br/>local-only; socket adapter pending"]

    APP --> T["Toasts.jsx (global notifications)"]
    HOOKS -->|wss| WS
    WALLET -->|"POST /wallet/bet"| REST
```

- Styling: Tailwind v4 (no config) — custom tokens in `App.css` `@theme` block; hand-written CSS in `App.css` (~2.1k lines).
- **Outlands** is a lazy-loaded browser game at `/outlands`: infinite procedural chunks, 3×3 named sectors/outposts, survival/progression/inventory, seven weapon classes, nine zombie variants, loot containers, interiors, dynamic lighting, gore decals, and sprite assets. The active game UI still uses local simulation and localStorage stash. `server/outlands/` contains a separate Cognito-authenticated WebSocket room-service prototype; it is not deployed by CDK or yet wired to the expanded RPG UI. Its room state is process-memory-only and the server-side stash resets after reconnect grace expires.
- Endpoints: `frontend/src/utils/api.js` `API_BASE` (defaults to prod, overridable `VITE_API_URL`); `useLobby.js` WS URL (`VITE_WEBSOCKET_URL`). See `frontend/.env.example`.

---

## 7. Deployment Pipeline

```mermaid
graph LR
    subgraph Frontend
        GIT["git push origin main"]
        GIT --> N["Netlify auto-build<br/>npm run build → dist/"]
        N --> CDN["Netlify CDN (SPA redirect → /index.html)"]
    end
    subgraph Backend
        DEV["npm run deploy (cdk deploy)"]
        DEV --> BOOT["npx cdk bootstrap (once per account/region)"]
        DEV --> SYNTH["npx cdk synth (verify first)"]
        SYNTH --> AWS["CloudFormation → API GW, Cognito,<br/>DynamoDB, Lambdas, alarms, budget"]
    end
    CDN --> F2["Browser"]
    AWS --> REST2["REST + WS endpoints"]
    F2 --> REST2
```

**Two independent deploys.** Frontend: Netlify auto-build on push. Backend: manual `npm run deploy`. After changing the stack, update the hardcoded URLs in `api.js` / `useLobby.js` (or `.env`) — otherwise the frontend keeps hitting stale prod endpoints.

Cost guardrails baked into the stack: budget `casino888-dev-budget` ($30/mo, email alerts at 50/80/100% when `budgetEmail` set), CloudWatch error alarms on 6 key lambdas, `logRetention: ONE_WEEK`, REST stage throttling 20 rps / burst 10, **no** `reservedConcurrentExecutions` (account concurrency limit is 10).

---

## 8. Quality Gates & Verification

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server (port 3000) → hits deployed prod API |
| `npm run lint` | ESLint flat config, errors-only (`--quiet`) |
| `npm run typecheck` | `tsc --noEmit -p frontend/tsconfig.json` (strict) — catches blank-screen reference errors |
| `npm run build` | Vite production build → `dist/` (de-facto frontend verification) |
| `npx tsc --noEmit` | CDK TypeScript (root `tsconfig.json`, `bin/`+`lib/`) |
| `npx cdk synth` | Validate the CloudFormation template before deploying |
| `node lambdas/websocket/blackjack.test.js` | Blackjack engine self-test (only test in repo) |

Per `PROJECT_DESIGN.md`: any change touching auth, wallet, game outcomes, infrastructure, or shared state requires analysis before implementation, verification commands, and documented risks.

---

## 9. Known Architecture Notes / Gotchas

- **Lambda bundling**: CDK zips `lambdas/<dir>` as-is. Node 20 runtime does **not** ship AWS SDK v3, so each lambda folder needs its own committed `package.json` + installed `node_modules` before `cdk deploy`.
- **CDK typos that break synth**: Lambda prop is `reservedConcurrentExecutions` (not `reservedConcurrency`); REST throttling lives on the `RestApi` `deployOptions` (not `MethodOptions`); tag prop is `resourceTags` (not `tags`).
- **Blackjack** is the only multiplayer game: server-authoritative state in `lambdas/websocket/blackjack.js`, rooms persisted in `blackjack-rooms`, multi-handler WS lambdas share `lambdas/websocket/utils.js`.
- **Deletion**: `delete-account` removes the Cognito user + all rows (users, transactions, players, connections) — mirrors the tables it has grants on.
- **Security baseline done**: WS JWT signature verification (cached JWKS), server-authoritative identity, atomic wallet writes, `crypto.randomInt` for all game outcomes + blackjack shuffle. Not done: automated CI, unit-test suite beyond the blackjack self-test, moving committed OAuth secret in `cdk.json` to env/SSM.
