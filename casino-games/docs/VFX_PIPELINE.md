# VFX pipeline (pixelfx)

All new game VFX comes from [pixelfx](https://github.com/patch-gg/pixelfx),
vendored at `vendor/pixelfx` (see `vendor/pixelfx/UPSTREAM.md`). Effects are code,
not images: we render them offline into sprite strips and the games play those.

## Why strips

A strip is one horizontal PNG plus a manifest. It is deliberately engine-agnostic:

- **Square of Shadows** animates it in CSS with `steps(n)` + `background-position`
  (no extra JS on the board).
- **Outlands** slices it into PIXI textures and plays it on an `AnimatedSprite`.

Neither game imports pixelfx at runtime, so the generator never lands in the
bundle and effects can be swapped without touching game logic.

## Adding an effect

1. Find the upstream id:

   ```bash
   npm run vfx:list | grep fire
   node vendor/pixelfx/tools/render.mjs fire/torch --gif     # watch it first
   ```

2. Add an entry to `scripts/vfx/effects.mjs`:

   ```js
   { slug: 'torch', effect: 'fire/torch', fps: 20, loop: true },
   ```

3. Export it:

   ```bash
   npm run vfx -- torch     # one effect
   npm run vfx              # everything (also rewrites the generated manifest)
   ```

4. Use it:
   - **SOS** — add an `ABILITY: 'slug'` pair to `SOS_PIXEL_FX` in
     `frontend/src/games/squareofshadows/pixelFx.ts`, and a display width in
     `SOS_PIXEL_FX_WIDTH` (the board tile is ~48 px).
   - **Outlands** — call `pixelFx.play('slug', x, y, { scale })` from
     `engine/renderer.ts`; add the slug to `PRELOAD_FX` if it fires often.

## Output

`frontend/public/sprites/vfx/<slug>/`

| file | contents |
| --- | --- |
| `strip.png` | frames left→right, transparent, no padding |
| `manifest.json` | frame size/count, fps, duration, loop, pivot |

`frontend/public/sprites/vfx/index.json` describes everything exported, and
`frontend/src/games/pixelFx.generated.ts` is the typed copy the games import.
Both are generated — never edit them by hand.

## Conventions

- **Never ship the stock character.** The exporter always renders with
  `actor: false`; effects that act out a body would otherwise show pixelfx's
  grey dummy on top of our sprites.
- **Prefer the pivot over centring.** Each effect declares where its origin sits
  inside the frame (a muzzle, a floor mark). Both games anchor by that pivot.
- **Keep strips under 8192 px wide.** The exporter lowers `fps` automatically
  when a long effect would exceed it; raise the effect's `fps` only if the result
  is too choppy.
- **Match the art scale.** pixelfx authors at 100-300 px; SOS tiles are ~48 px and
  Outlands actors are ~32-64 px. Set a display scale, don't re-render at a
  different size.
- **Palettes** can be overridden per export (`--opts '{"palette":[...]}'` in the
  upstream render tool) — useful to make a generic fire read as the game's own
  school of magic.

## Verifying

```bash
npm run vfx                 # must exit 0 and rewrite every manifest
npm run typecheck           # generated manifest types must stay valid
npm run build
npm run test
```
