# Handoff

- Base: `67997b8` en `main`.
- Run activo: `docs/audit/2026-09-09-casino888/`.
- Leer primero: `CONTEXT.md`, `TASKS.json`, `FINDINGS.json`, `VALIDATION.md`.
- Piloto modificado: `frontend/src/components/CasinoMap.tsx`, `frontend/src/components/DashboardView.jsx`.
- Config de herramienta preexistente: `opencode.json` añade Playwright MCP.
- No rastreados a preservar: `.playwright-mcp/`, `production-desktop.*`, `references/`.
- Ningún proceso local persistente iniciado.
- Correcciones integradas locales: mapa/input, sesión/delete UI, perfil, wallet idempotente, naturales Blackjack, realtime barato, bundling/CI y tombstone delete-account.
- Gates finales: 41 tests, typecheck, lint, build, CDK typecheck y synth pasan.
- Riesgos prioritarios: carrera WS en vuelo durante delete, limiter no distribuido, scans sin paginación, PKCE y docs/filtros.
- Mejoras con coste (`PITR`, alarmas/métricas nuevas, WAF/cache distribuida) diferidas por instrucción del usuario.
- Próxima acción recomendada: inspección final del diff y commit local solo si usuario autoriza; después prueba runtime en entorno autenticado antes de deploy.
- No publicar sin autorización.
