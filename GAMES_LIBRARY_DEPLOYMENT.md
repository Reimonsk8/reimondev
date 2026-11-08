# Games app deployment

The `/games/` Vite app is built separately from CRA, then assembled into the main Amplify artifact by root `amplify.yml`.

Portfolio and game discovery are unified at `/projects` (`/projects#games` opens the game filter). The Vite root `/games/` redirects there; authenticated gameplay and OAuth remain under `/games/...`.

## Local build

```sh
npm ci --legacy-peer-deps
cd casino-games && npm ci && npm run build && cd ..
npm run build
```

The Vite output goes to `casino-games/dist/`; CRA's production output goes to root `build/`. Amplify copies the Vite output to `build/games/` before publishing the root `build/` directory.

## Local dev routing

Run CRA at `http://localhost:3000`, then Vite from `casino-games/`. Vite moves to port 3001 if 3000 is occupied; root `src/setupProxy.js` forwards `/games` to that server.

## Production deploy

Push the reviewed source changes to the `deploy` branch to trigger Amplify. The nested CDK backend is a separate deployment: verify the intended AWS account/region, run `npx cdk diff --profile <profile>`, inspect data/resource removals, then deploy only the approved stack changes. Preserve Cognito/profile, shared WebSocket, player/connection, and Square of Shadows room services.

Amplify rewrites live in `amplify-custom-rules.json`; keep `/games/assets/`, `/games/sprites/`, `/games/audio/`, and `/games/video/` asset pass-throughs ahead of the `/games/<*>` SPA rewrite.
