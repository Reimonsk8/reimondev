# Vite game app and CDK backend

`casino-games/` is a legacy directory name. The public app is the Vite project in `frontend/`; the CDK app lives in `infra/`. The top-level `../amplify.yml` assembles its build under `/games/` on the main site's Amplify deploy.

## Commands
- `npm run dev` — Vite app. It uses `frontend/` as the root, base `/games/`, and port 3000; with the CRA site running on 3000, Vite will move to 3001.
- `npm run typecheck` — strict frontend check (`tsc --noEmit -p frontend/tsconfig.json`).
- `npm run build` — Vite production build to `casino-games/dist/`.
- `npm run test:sos` and `npm run test:outlands` — focused retained-game suites.
- `npm run test:sos:smoke` and `npm run test:outlands:smoke` — browser smoke tests; set `PUPPETEER_EXECUTABLE_PATH` if Chrome is not auto-detected.
- CDK: `npx tsc --noEmit`, `npx cdk synth`, review `npx cdk diff --profile <profile>`, then `npm run deploy` only after verifying the AWS account/region.

## Shared game and auth contracts
- The main site's `/projects` page is the unified projects-and-games catalog; the Vite app redirects `/games/` there. `frontend/src/App.jsx` owns Cognito login/OAuth and the playable routes under `/games/...`.
- The Square of Shadows engine is shared with `lambdas/websocket/sos.js` using the literal esbuild import `../../frontend/src/games/squareofshadows/engine/index.ts`; do not turn it into a computed require or fork the rules.
- SoS online play uses the shared WebSocket handlers, `lambdas/websocket/lobby.js`, `lambdas/websocket/sos.js`, and the `sos-rooms` table. Zombie Shooter also consumes shared socket movement/presence. These are shared game services, not casino-only dependencies.
- Cognito identity is verified in `lambdas/websocket/utils.js`; socket identity comes from verified claims and the profile row, never client-supplied IDs.
- Frontend REST/WebSocket defaults are in `frontend/src/utils/api.js` and `frontend/src/hooks/useLobby.js`. The `c888_*` local-storage token names and `/wallet/profile` path are legacy contracts; change them only with a compatible migration.
- `infra/lib/casino-infra-stack.ts` is a mixed historical stack. Preserve Cognito, profile, shared socket, and SoS resources when pruning unrelated infrastructure. Review the exact CDK diff before deployment and do not delete user data tables implicitly.

## Build and generated assets
- CI installs dependencies inside each `lambdas/*/` folder that has a `package.json` before typecheck/build/tests/synth; reproduce that step after a fresh clone before CDK operations.
- Tailwind v4 has no `tailwind.config.*`; custom utilities require matching variables in the `@theme` block in `frontend/src/App.css`.
- VFX output is generated with `npm run vfx` from `scripts/vfx/effects.mjs`; do not hand-edit generated VFX files. SoS uses CSS step strips; Zombie Shooter loads its own PIXI textures.
- Older Casino888-oriented prose docs are historical; use the root `../amplify.yml`, this package's `vite.config.js`, and package scripts as deployment truth.
