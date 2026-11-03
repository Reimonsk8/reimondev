# Games library hosting (`/games/`)

The existing ReimonDev React site remains the root application. The Casino888
game library is kept as an isolated Vite project in `casino-games/` and is
assembled into the same Amplify artifact under `build/games/` by `amplify.yml`.
The games frontend targets the ReimonDev AWS account's Casino888 stack in
`us-east-2`: REST API `pmeyof3qzi`, WebSocket API `vbgum6fbrg`, Cognito pool
`us-east-2_q5lPnfuFN`, client `77ieg4fiv0dg7fo5g9uqb1n5rm`, and hosted domain
`reimondev.auth.us-east-2.amazoncognito.com`.

## Build locally

```sh
npm ci --legacy-peer-deps
cd casino-games && npm ci && cd ..
npm run build
cd casino-games && VITE_BASE_PATH=/games/ VITE_USE_SPRITE_ATLAS=1 npm run build && cd ..
mkdir -p build/games
cp -R casino-games/dist/games/. build/games/
```

Amplify runs the same sequence and publishes the root `build/` folder, which
contains both the existing site and the game library.

## Amplify rewrites and asset routing

The Amplify app's routing rules are stored in `amplify-custom-rules.json`.
Apply them in account `721926878294` (region `us-east-1`) with:

```sh
aws amplify update-app --app-id dhs5x061p2ycv \
  --custom-rules file://amplify-custom-rules.json --region us-east-1
```

Keep the `/games/assets/`, `/games/sprites/`, `/games/audio/`, and
`/games/video/` pass-through rules before the `/games/<*>` SPA rewrite. Without
them, Amplify can return `index.html` with HTTP 200 for JavaScript and CSS URLs,
which leaves the games page blank. Keep both existing root SPA fallback rules.
After changing routing, verify that `/games/` and a nested game route return
the games HTML, while a hashed JS asset returns `Content-Type: text/javascript`
and contains the bundle (not HTML).

The Cognito client allows
`https://reimondev.com/games/oauth2/callback` and sign-out URL
`https://reimondev.com/games/`; Google is an enabled identity provider using
authorization-code grant. The Google provider maps `email`, `name`, and
`picture` to the corresponding Cognito attributes. The frontend's endpoint and
OAuth fallbacks are configured for the target account.

## Current deployment

Amplify app `dhs5x061p2ycv` in account `721926878294` automatically builds the
`deploy` production branch. The CasinoInfraStack is deployed in `us-east-2` in
that same account. Changes pushed to `deploy` trigger a live build.
