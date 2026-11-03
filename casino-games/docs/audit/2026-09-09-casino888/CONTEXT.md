# Contexto de auditoría

- Run: `2026-09-09-casino888`
- Base: `main@67997b8e478d6a475b75d30d72bcdae462909cb2`
- Modo: auditar primero; corregir bugs confirmados localmente; sin commit, push, merge ni deploy sin autorización.
- Producto: demo de casino play-money. Ninguna prueba debe mutar saldos reales o testnet.
- Stack: React 19/Vite/PixiJS; Cognito; API Gateway REST + WebSocket; Lambda Node 20; DynamoDB; CDK; Netlify.
- Autoridad: `PROJECT_DESIGN.md` para producto; `lib/casino-infra-stack.ts` para IaC.
- Accesos: repositorio local, AWS CLI y sesión autenticada BrowserOS Neo disponibles. Estado vivo y código local se registran por separado.
- Herramientas: subagentes reales `explore`/`general`, BrowserOS Neo, Playwright MCP, npm, TypeScript, ESLint, Vitest, CDK y AWS CLI.
- Cambios preexistentes al run: `opencode.json`; `.playwright-mcp/`, `production-desktop.*` y `references/` no rastreados. Cambios del piloto en `CasinoMap.tsx` y `DashboardView.jsx` pertenecen a este run.
- Límites: modelo no puede interpretar screenshots; inspección visual usa accesibilidad, DOM, geometría y estados computados. Diff local del mapa no puede probarse en producción sin publicación; build local sí está verificado.

## Baseline

- `npm run typecheck`: pass antes del piloto.
- `npm run lint`: inicialmente falló por función local obsoleta `handleTapAnywhere`; piloto la eliminó.
- `npm run test`: 26 pruebas Vitest + self-check Blackjack pass.
- Producción Neo autenticada: viewport `1680x949`; canvas `x=21`, `y=101.1875`, `1247x885`; `elementFromPoint` impacta canvas; `pointer-events:auto`.

## Decisiones

- DPR solo controla backing store; cámara y picking usan `renderer.screen`.
- Primer input WASD/flecha/d-pad cancela click-to-move.
- Blur y overlays modales cancelan entrada, destino y velocidad.
- Pointer Events es única pila táctil del canvas; no se duplica con Touch Events.
- `isMobile` no recrea `PIXI.Application`; listeners estables delegan a callbacks actuales mediante refs.
