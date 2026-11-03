# Validación

## Baseline dinámico de producción

- Entorno: BrowserOS Neo autenticado, producción Netlify.
- Estado desplegado: commit exacto no acreditado desde navegador; no se atribuye al diff local.
- Viewport: `1680x949`.
- Canvas: `x=21`, `y=101.1875`, `1247x885`, `pointer-events:auto` y centro impacta `<canvas>`.
- Resultado: descartó sospecha CSS para producción; confirmó acceso al recorrido lobby.

## Piloto integrado local

Estado: worktree sobre `67997b8`, sin commit.

```text
npm run typecheck  PASS
npm run lint       PASS
npm run build      PASS (2286 módulos)
npm run test       PASS (5 archivos, 26 tests + blackjack self-check)
git diff --check   PASS
```

Revisión A: matemática Pixi/DPR aprobada; sin objeciones vigentes tras ronda 2.

Revisión B: detectó focus/contenteditable, breakpoint con d-pad y stale callbacks; corregidos. Ronda 3 aprobada sin findings vigentes.

Limitación: no hay harness unitario para Pixi/input. Validación dinámica del código local autenticado requiere entorno local con sesión de prueba o publicación autorizada. Producción Neo es baseline de versión anterior.

## App logout/delete y perfil

```text
npm run typecheck  PASS
npm run lint       PASS
npm run build      PASS
npm run test       PASS (6 archivos, 33 tests + blackjack)
git diff --check   PASS
```

- APP-001/AUTH-001: dos revisores; race de logout durante handshake corregida en `disconnectFromLobby`; aprobación ronda 2.
- DATA-001: siete pruebas focalizadas para privacidad, creación concurrente, backfill condicional, `ALL_NEW`, POST y eliminación explícita de avatar; dos revisores aprobaron tras tres rondas.
- Limitación: DynamoDB simulado; no se ejecutaron mutaciones contra AWS vivo.

## Lotes wallet, realtime, Blackjack, borrado y entrega

Estado integrado local sobre `67997b8`, sin publicación:

```text
npm run test       PASS (8 archivos, 41 tests + blackjack self-check)
npm run typecheck  PASS
npm run lint       PASS
npm run build      PASS (2286 módulos)
npx tsc --noEmit   PASS
npx cdk synth --quiet PASS
git diff --check   PASS
```

- Bundles sintetizados: delete-account `2.5 MB`; cuatro WebSocket `1.4 MB` cada uno.
- Sin tablas, Lambdas, colas, caches, WAF, PITR ni alarmas nuevas.
- Config WebSocket stage y permisos cambian sobre recursos existentes.
- Realtime: limiter/velocidad son mitigación por contenedor; no garantía distribuida.
- Delete-account: tombstone bloquea resurrección REST y nuevas conexiones; invocaciones WS ya en vuelo conservan carrera residual. No se realizó borrado real.
- Revisor B de bundling no estuvo disponible por cuota; Revisor A validó clon limpio. Limitación registrada.
