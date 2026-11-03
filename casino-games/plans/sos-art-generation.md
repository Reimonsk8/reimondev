# Square of Shadows — art generation plan

Status: **IN PROGRESS.** PixelLab auth works through the REST script
`scripts/sprite-gen/pixellab.mjs` (`.env`); the MCP needs an opencode restart to
pick up the `setx PIXELLAB_API_KEY` change. Faction draft logic is implemented;
all eight 27-frame sheets are assembled and copied to runtime. Extra icon
requests are now queued under PixelLab rate limits.

Decided resolution: **272×272 per frame** (PixelLab native 68px ×4
nearest-neighbour, the largest *lossless integer* upscale — 256 exactly would
require a non-integer resize that breaks the pixel grid). ~9× the old 32px
cells; 512 ruled out (see below).

- PixelLab character creation maxes at **128px**; template animations on
  canvases >100px are billed **1 generation per frame** (~27/class — ~216 gens).
  Native 256/512 frames are financially impossible on this budget.
- Template mode at 48px creation (68px canvas, **1 gen per state**) reproduces
  the exact 27-frame contract: `breathing-idle`=4, `cross-punch`=6,
  `fireball`=6, `falling-back-death`=7, `walking-4-frames`=4.
- The upscale happens locally in `scripts/sprite-gen/assemble-sheets.mjs`
  (zero cost). 512 would double sheet bytes for detail nobody sees at ~48–64
  CSS px board size.

## Contract that must NOT change

- 27 frames per class sheet, order `idle(4) attack(6) cast(6) death(7) walk(4)`
  — `SPRITE_TOTAL`, `SPRITE_STATE_OFFSET` (`SquareOfShadows.tsx:240`),
  `STATE_OFFSET` (`engine/art.test.ts:25`) and the `steps(N, jump-none)` CSS
  keyframes all hard-code this.
- 4 frames per VFX/link strip (`background-size: 400% 100%` +
  `steps(4, jump-none)` in `theme.css`).
- 18 terrain tiles: FLOOR, FLOOR_ALT, WALL_0..WALL_15 autotile masks.
- `image-rendering: pixelated` stays (already present on `.sos-sprite`,
  `.sos-spellfx-sprite`, `.sos-linkfx-sprite`, terrain).
- Output lands in `assets/sprites/generated/<name>/` then
  `node scripts/copy-sprites.mjs` → `frontend/public/sprites/<name>/`
  (art.test.ts reads the `assets/` copy, runtime reads `public/`).

Resolution-independence proof: CSS frames by percentage
(`background-position: calc(frame / (total-1) * 100%)`, `background-size:
calc(100% * var(--sprite-total)) 100%`), so only `cellWidth/Height` in each
manifest changes. **No TSX/CSS edits required for the resize itself.**

## Batch 1 — regen existing class sheets at 272 (4 assets)

| Asset | Frames | Notes |
|---|---|---|
| `sos-warrior` | 27 | same states, same order |
| `sos-wizard` | 27 | idem |
| `sos-cleric` | 27 | idem |
| `sos-ranger` | 27 | idem |

Theme: **Inquisitors of Truth — Church of Leviathan** (see factions below).

## Batch 2 — regen existing VFX strips at 256 (8 assets, 4 frames each)

`sos-vfx-{slash, fireball, thunder, ice, heal, trap, arrow, firebolt}` — same
4-frame strips, same order. `theme.css` sizes/timings stay untouched.

## Batch 3 — NEW missing VFX/link strips (8 assets, 4 frames each)

These spawn in code today with CSS-only fallback (no sprite):

| Asset | Used by | Code site |
|---|---|---|
| `sos-vfx-blood` | hit splatter on every attack | `SquareOfShadows.tsx:748,909` |
| `sos-vfx-death` | corpse poof | `:920` |
| `sos-vfx-guard` | shield-cover sparkle | `:873` |
| `sos-vfx-shield-slam` | knockback impact | `:884` |
| `sos-vfx-rope` | Grapple chain (link kind `rope`) | `LINK_SPRITE_FOR` |
| `sos-vfx-push` | shove streak (link kind `push`) | idem |
| `sos-vfx-shield` | ally-cover travel (link kind `shield`, replaces lucide icon) | idem |
| `sos-pixellab/icon-shield-slam` | only ability without a pixel icon | `ABILITY_ICON` |

Wiring after generation: add the three link kinds to `LINK_SPRITE_FOR`
(`SquareOfShadows.tsx:153`) and the four abilities to `VFX_SPRITE_FOR` (`:141`).

## Batch 4 — terrain regen at 256 (1 asset)

`sos-terrain`, 18 tiles, autotile mask order unchanged (up 1, right 2, down 4,
left 8). The contrast/autotile assertions in `art.test.ts` (walls brighter than
floor, dark base, cap lighting) must still pass.

## Batch 5 — Faction B: the counterpart heroes (4 NEW class sheets, 27 frames)

Two-faction setup. Engine-side the 4 unit types stay `WARRIOR/WIZARD/CLERIC/
RANGER`; the two factions are **cosmetic skins** with identical stats/abilities.
The shared deployment state now records faction picks. If asymmetric faction
abilities are ever added, that is a game-outcome change and gets its own
analysis pass.

### Faction A — `Inquisitors of Truth / Church of Leviathan` (existing 4)

Holy-order inquisitors: heavy gold-embroidered vestments, leviathan/sea-serpent
church motifs (scales, tentacle filigree, coral-shaped mitres), burning relic
eyes, gold + deep teal + bone white. Regenerated versions of the current four
classes, same silhouettes readable at board size.

### Faction B — `The Penitent Court` (new 4, Blasphemous-inspired dark-martyr
aesthetic)

Twisted-counterpart holy martyrdom: cowlled penitents, iron thorns, candle
wax, reliquary masks, cracked gold leaf over ash-grey cloth, weeping statues,
broken halos. **Same class roles, mirrored silhouettes:**

| Class skin | Mirrors | Visual hook |
|---|---|---|
| Templar | Warrior | thorned iron plate, great-helm reliquary, flagellant banner |
| Confessor | Wizard | hooded inquisitor-mage, censer instead of staff, smoke+ember |
| Martyr | Cleric | weeping saint, broken halo, candles on shoulders, self-sacrifice motif |
| Penitent | Ranger | cowled whip-bearer, chained hood, rope + iron hook |

## Batch 6 — missing UI icons (10 new PixelLab icons)

- `icon-attack-{warrior,wizard,cleric,ranger}`
- `icon-class-{warrior,wizard,cleric,ranger}`
- `icon-move`
- `icon-shield-slam` (the one previously missing ability icon)

The six existing ability icons remain cached. `ClassIcon`, `ActGlyph`, and the
Move skill use the new icons when present, with their current Lucide/SVG art as
load-failure fallback.

Names used in the current draft UI: Inquisitors of Truth / Church of Leviathan
and The Penitent Court.

## Faction choice and attack previews (implemented)

- `CHOOSE_FACTION` is validated by the shared reducer during `deployment`; the
  second picker receives the remaining faction, then both squads deploy.
- Multiplayer `turnOrder` and `pickOrder` are independently shuffled with
  `crypto.randomInt` in the WebSocket Lambda. Local modes keep the human first;
  the AI automatically takes the remaining faction.
- A 3-minute pick deadline auto-assigns a faction; leaving/disconnecting before
  combat ends the draft without a win/forfeit.
- The target overlay shows range plus a transparent impact footprint on hover;
  Shield Slam now uses the same preview path as tile abilities. Preview uses
  the shared engine geometry and does not alter command resolution.

## Test/code touchpoints when the sheets land

- `engine/art.test.ts`: ✅ DONE — cell size is now read per-sheet from
  `manifest.frame_layout.cellWidth` (procedural=32, PixelLab=272), the
  16-colour palette lock is scoped to terrain only (PixelLab art is freely
  coloured), the procedural-only "death fades" test removed (template death
  falls at full alpha), plus a new square-frame invariant. Green against the
  old 32px sheets (30/30) and will stay green at 272px.
- `scripts/sprite-gen/sos-pixel-art.mjs` (procedural generator) stays as the
  VFX/terrain source and fallback — do not delete.
- Faction map/UI wiring is implemented in `SquareOfShadows.tsx`; all 8 sheets
  are assembled at 272px and copied to `frontend/public/sprites`.

## Generation cost note (real numbers)

Budget: **40 generations/month** on the PixelLab plan ($1 USD credit on top).
Ledger in `assets/sprites/generated/sos-pixellab/state.json`.

Real per-asset costs (discovered from the v2 API):
- Character create @48px: 1 gen. Template animation @68px canvas: **1 gen per
  state**. → a full 5-state class = 6 gens.
- VFX strips need 4 pixflux images each (~1 gen/frame) → the 8 existing strips
  regen at 256 = 32 gens, impossible here. **Decision: VFX strips stay the
  existing procedural 32px art for now** (they're 4-frame blips at 48 CSS px,
  the quality gap vs. units is small). Revisit if the budget grows.
- Terrain (18 tiles) likewise stays procedural.
- Current icon queue is 10 additional icons (six older ability icons cached).

Generation queue plan (may exceed the current balance by four):
1. Finish faction A animations (16 gens — 4 were pre-queued) ✅ queued
2. Create faction B characters (4 gens) ✅ queued
3. Faction B animation submissions completed; all 8 sheets assembled without
   idle fallbacks and copied to runtime.
4. Missing class/attack/move/shield-slam icons queued; run `status`, then copy
   and re-verify after they finish.
Total planned class generations had been
   40 gens including creates vs. 36 reported available; if quota ends on the
   final submissions, the assembler cycles that faction's own idle frames into
   any missing states (27-frame contract preserved) and records fallbacks in the
   manifest; regenerate those states after the quota reset for full animation.

Assembly after generation costs nothing:
`GET /characters/{id}/spritesheet` (free status export, returns ZIP with a
layout JSON mapping rows→animations) → `assemble-sheets.mjs` picks the 5 state
rows, upscales ×4, bakes the 27-frame sheet + manifest.

## Verification (after generation + wiring)

```
node scripts/validate-sprites.mjs
node scripts/copy-sprites.mjs
npm run test          # art.test.ts contract + engine/protocol tests
npm run typecheck && npm run lint && npm run build
```

## Known risks

- Backend Lambda and frontend must be released together: older clients do not
  understand the faction-draft phase/command. Do not deploy one half alone.
- PixelLab frames are per-generation; 27 consistent frames of the same
  character is the classic consistency problem — use one base/character id +
  rotations/frame tooling, eyeball every sheet before baking, and expect some
  regen loops.
- Animation consistency needs visual review before copy/deploy.
- Sheet width at 272 cells is 7344px (~8 MB RGBA/class); do not go 512.
