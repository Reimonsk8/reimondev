# Repository instructions

- The root app is CRA: `src/App.js` mounts `src/components/MainMenu.js`, which owns the site routes. `casino-games/` is a separate Vite app plus CDK backend; follow `casino-games/AGENTS.md` for its game, Lambda, and infrastructure contracts.
- `/projects` is the unified Work page. The Vite app redirects `/games/` to `/projects#games`; playable/auth routes are in Vite under `/games/...`.
- Local root app: `npm start`. CRA proxies `/games` to Vite at `localhost:3001` (`src/setupProxy.js`); start Vite with `cd casino-games && npm run dev` (port 3000, which Vite moves off if CRA occupies it).
- `amplify.yml` is the production build source of truth (Node 20): install root deps with `npm ci --legacy-peer-deps`, install `casino-games` deps separately, build CRA, build Vite, then copy Vite output to `build/games/`. Root `npm run build` alone does not build the game app. For local CRA build verification use `CI=false npm run build`.
- `build/` is tracked; inspect its changes after builds before staging. Root `README.md` has merge-conflict markers and stale CRA boilerplate; use manifests and executable config instead.
