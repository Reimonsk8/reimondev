# Outlands dedicated server

This standalone Node WebSocket service owns Outlands room simulation. It is
separate from the Casino CDK stack and its API Gateway WebSocket Lambdas. The
default local server listens on `127.0.0.1:3020`; clients connect to
`ws://127.0.0.1:3020/outlands`.

## Local development

Configure the Cognito pool used by the frontend, then start the service and
Vite in separate terminals:

```powershell
$env:AWS_REGION = 'us-east-2'
$env:USER_POOL_ID = '<Cognito user pool id>'
$env:USER_POOL_CLIENT_ID = '<Cognito app client id>'
npm run outlands:server
npm run dev
```

Set `VITE_OUTLANDS_WS_URL=ws://127.0.0.1:3020/outlands` in the frontend environment
to make deployment connect through the authenticated authoritative service. Local
development may omit it and use browser simulation; production disables deployment
until this shared-world endpoint is configured.
There is exactly one public world, `sector-07`; empty sessions do not delete it and
offline character state remains available when that user returns. `OUTLANDS_STATE_FILE`
selects its atomic JSON snapshot file (default `./data/outlands-sector-07.json`). The
server persists every five seconds and on shutdown. Production must mount a durable
disk at the snapshot location and run exactly one server process; ephemeral container
storage or multiple independent server replicas would break the single-world guarantee.
`OUTLANDS_ALLOWED_ORIGINS` is a comma-separated list;
its local default allows only localhost:3000 and 127.0.0.1:3000. For a hosted
service, set `OUTLANDS_HOST=0.0.0.0`, `OUTLANDS_PORT`, an explicit origin
allowlist, and use a TLS-terminating reverse proxy/load balancer for `wss://`.

## Build and verification

- `npm run outlands:server:build` bundles the shared TypeScript simulation into
  `node_modules/.cache/outlands-server.cjs`.
- `npm run outlands:server:run` starts the built bundle.
- `npm run test:outlands` tests the shared engine and room simulation.
- `npx vitest run server/outlands` tests token verification, message validation,
  and the real WebSocket service flow.
- `GET /health` reports process health and in-memory room/connection counts.

The service authenticates every connection with a verified Cognito ID token;
player IDs, inventory, and stash are never accepted from input messages. There is **one public sector** (`sector-07`) — the service does not spawn extra
rooms when it fills. Player cap defaults to **8** (`OUTLANDS_ROOM_CAPACITY`) for
sim performance; when full, new joins receive `SECTOR_FULL` and the WebSocket
closes with code `4003`. `GET /health` exposes `{ players, capacity, full }` for
the briefing UI. Capacity limits concurrent connections; disconnected characters
remain persisted. Reconnect grace is 30s. The service is a single-process authoritative
host, not a horizontally scaled MMO cluster.
