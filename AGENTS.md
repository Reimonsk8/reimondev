# Repository instructions

## App boundaries
- The repository root is the CRA personal site (`src/App.js` → `src/components/MainMenu.js`).
- `casino-games/` is a legacy directory name for the Vite `/games/` app and its CDK backend. Its more specific guidance is in `casino-games/AGENTS.md`.
- `/projects` is the unified portfolio-and-games Work page. `/games/` redirects to its Games filter; actual play/auth routes remain under `/games/...` in Vite.
- The production build is root `amplify.yml`: it builds CRA, builds the nested Vite app, then copies that output into `build/games/`.
- Root `README.md` currently contains merge-conflict markers and stale CRA boilerplate; prefer manifests and executable configuration until it is repaired.

## Commands and local development
- Root site: `npm start` (CRA on port 3000); `CI=false npm run build` for production verification.
- Nested game app: `cd casino-games && npm run dev`, `npm run typecheck`, `npm run test:sos`, `npm run test:outlands`, `npm run build`.
- CRA's `src/setupProxy.js` forwards `/games` to Vite on port 3001. Vite is configured for port 3000 and moves to 3001 when CRA is already using 3000.
- The root build writes to tracked `build/`; inspect build-output changes before staging.

## Deployment and shared infrastructure
- Amplify production deploys from the `deploy` branch. Keep deployment commits scoped; do not include unrelated or user-owned working-tree edits.
- The nested CDK entry is `casino-games/infra/bin/casino-infra.ts`; stack source is `casino-games/infra/lib/casino-infra-stack.ts`. Before deploy, verify AWS identity and region, then run `npx tsc --noEmit`, `npx cdk synth`, and `npx cdk diff --profile <profile>` from `casino-games/`.
- Cognito/profile and the shared WebSocket/DynamoDB services support both retained games. Square of Shadows specifically depends on `lambdas/websocket/lobby.js`, `lambdas/websocket/sos.js`, and `sos-rooms`; Zombie Shooter uses shared player movement/presence. Preserve these when removing unrelated features.
- REST and WebSocket defaults are in `casino-games/frontend/src/utils/api.js` and `casino-games/frontend/src/hooks/useLobby.js`; coordinate endpoint changes with CDK outputs.
- Each Lambda folder has its own dependency manifest. CI installs those dependencies before CDK synth because Node 20 Lambda does not include AWS SDK v3.
