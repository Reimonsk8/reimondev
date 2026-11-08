# ReimonDev Games architecture

`casino-games/` is a legacy folder name. The React/Vite app is embedded in the main ReimonDev site at `/games/`; the parent `amplify.yml` builds both the CRA site and this app.

## Frontend

- Entry: `frontend/src/main.jsx` → `frontend/src/App.jsx`.
- Portfolio and game discovery live together on the main site's `/projects` Work page, with Games/Projects filters. The Vite app redirects its catalog root (`/games/`) to `/projects#games`.
- Auth: Cognito email/password and Google OAuth; protected game routes use `/login` and `/oauth2/callback`.
- Play/auth routes stay in Vite: `/games/square-of-shadows`, `/games/outlands` (Zombie Shooter), `/games/login`, and `/games/oauth2/callback`. The old `/games/zombie-shooter` path redirects to `/games/outlands`.
- Square of Shadows rules are in `frontend/src/games/squareofshadows/engine/`. The WebSocket Lambda bundles this same TypeScript engine so server/client rules do not drift.
- Zombie Shooter simulation and rendering are in `frontend/src/games/zombie-shooter/`; its optional remote player sync uses the shared WebSocket movement route.

## Shared AWS services

`infra/lib/casino-infra-stack.ts` remains the CDK source of truth; its historical filename/stack identity are retained for CloudFormation compatibility. It manages Cognito, the shared player profile, API Gateway REST/WS, transient player/connection records, and `sos-rooms`.

The WebSocket `$default` handler routes `lobby:*` to the SoS duel lobby and `sos:*` to the authoritative SoS room engine. `move` is used for player presence/movement; `ping`, `getSnapshot`, and chat support the shared game connection. Socket identity is verified against Cognito JWKS and is taken from the token, not client-supplied IDs.

The legacy `/wallet/profile` REST path is retained only as a shared player-profile compatibility endpoint (nickname/avatar); it must not regain wallet or wagering behavior. Casino-only APIs and handlers are not part of the retained game app.

## Checks and deploys

```sh
npm run typecheck
npm run test:sos
npm run test:outlands
npm run build
npx tsc --noEmit
npx cdk synth
npx cdk diff --profile <profile>
```

The browser smoke tests require Chrome. Backend deployment is separate from the Amplify frontend build; verify the target AWS identity and review the CDK diff before `npm run deploy`.
