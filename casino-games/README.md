# ReimonDev Games

This Vite app is packaged by the parent ReimonDev Amplify build under `/games/`. It contains two playable worlds:

- **Square of Shadows** — tactical turn-based matches with optional online duels.
- **Zombie Shooter** — the isometric survival game at the legacy `/outlands` route.

## Local development

```sh
npm ci
npm run dev
```

Vite uses `frontend/` as its root and `/games/` as its base. The CRA site also uses port 3000; when both servers run, Vite moves to 3001 and the main site's `/games` proxy forwards there.

## Verification

```sh
npm run typecheck
npm run test:sos
npm run test:outlands
npm run build
```

The SoS and Outlands smoke tests require Chrome; set `PUPPETEER_EXECUTABLE_PATH` when it is not auto-detected.

## Shared backend

`infra/lib/casino-infra-stack.ts` is the CDK source for Cognito identity, profile lookup, the shared WebSocket connection/movement service, and Square of Shadows room state. Before changing or deploying infrastructure, verify the AWS account/region, review `npx cdk diff --profile <profile>`, and preserve shared game resources and player data.
