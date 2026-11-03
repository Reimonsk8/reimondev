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

## Before enabling an Amplify build

Do not replace the existing site's routing rules. The Amplify app now has a
`/games/<*>` SPA rewrite to `/games/index.html` before the existing generic
root SPA fallback; both original root rules are retained. Before public
announcement, verify `/games/`, a nested game route, and a hashed asset URL on
the deployed site; an asset request must return the asset, not `index.html`.

The Cognito client allows
`https://reimondev.com/games/oauth2/callback` and sign-out URL
`https://reimondev.com/games/`; Google is an enabled identity provider using
authorization-code grant. The Google provider maps `email`, `name`, and
`picture` to the corresponding Cognito attributes. The frontend's endpoint and
OAuth fallbacks are configured for the target account.

## Current deployment boundary

The Amplify app already owns `reimondev.com` and automatically builds its
`deploy` branch. The backend stack and Amplify route rule have been updated;
frontend files remain on local branch `integrate/deploy-games` until pushed.
Pushing to the watched `deploy` branch triggers a live Amplify deployment, so
confirm the final integration diff and the user's approval immediately before
that push.
