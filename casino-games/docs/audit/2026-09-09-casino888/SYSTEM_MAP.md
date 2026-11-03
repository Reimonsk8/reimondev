# Mapa del sistema

## Recorrido principal

`main.jsx` → `App.jsx` → `useAuth`/`useWallet`/`useTransactions`/`useLobby` → `DashboardView` → `CasinoMap` o juegos lazy-loaded.

## Autenticación

- Email: `AuthView` → REST `/auth/*` → Lambdas Cognito.
- Google: Cognito Hosted UI → `/oauth2/callback` → `oauth.js` → tokens en `localStorage`.
- REST usa Cognito authorizer; WebSocket verifica firma/issuer/audience en `lambdas/websocket/utils.js`.

## Wallet y juegos

- Perfil/saldo: `casino-users`.
- Trail: `casino-transactions` (`userId`, `timestamp`).
- Seis juegos REST: `useWallet.placeBet` → `/wallet/bet` → `placeBet`; HMAC-SHA256, round idempotente y escritura transaccional.
- Blackjack multiplayer: WebSocket → `blackjack.js` → `blackjack-rooms`, users y transactions; settlement por jugador.
- Blackjack solo todavía contiene flujo cliente que backend rechaza.

## Realtime

- Un WebSocket API: connect, disconnect, move y default/message.
- Presencia: `casino-connections` y `casino-players` con TTL.
- Broadcast actual escanea conexiones; chat/emote tienen rate limit, move/piano/bj:chat no.

## Infraestructura y entrega

- `lib/casino-infra-stack.ts`: fuente IaC.
- Backend: `cdk deploy` manual.
- Frontend: push `main` dispara Netlify.
- Config frontend usa `VITE_*` con fallbacks productivos hardcodeados.
- Google OAuth secret se referencia desde Secrets Manager preexistente.

## Código generado/desconectado

- `lambdas/walletLink/index.js`: bundle generado y artefacto desplegable; fuente `source.js`.
- `dist/`, `cdk.out/`, `contracts/build/`: generados/ignorados.
- Contratos Base Sepolia compilan, pero no están conectados al flujo activo.
