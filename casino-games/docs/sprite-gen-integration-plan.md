# Sprite-Gen Integration Plan — Casino888

## Goal
Replace procedural PIXI/Canvas placeholders with generated sprite atlases via https://github.com/aldegad/sprite-gen, keep backup, reversible, no AWS cost.

## Discovery
- CasinoMap.tsx is 100% procedural: `radialWhiteTexture`, `vignetteTexture`, `mapWheelTexture`, `luckyWheelTexture` drawn on canvas. No external .png atlases.
- Player avatars: `createPlayerAvatar` via PIXI.Graphics circles + PIXI.Text emoji, not sprites.
- GameArt.jsx: inline SVG `CabinetSprite`, `DieSprite`.
- Slots/Roulette/CoinFlip generate textures on the fly.
- Result: "replace sprites" = migrate from procedural to atlas-based rendering, not 1:1 file swap.

## Backup
- Branch `backup/pre-sprite-gen-2026-09-13` created at main@67997b8 (pre-sprite work). Audit wip stays dirty in working tree, not committed.
- Restore: `git checkout backup/pre-sprite-gen-2026-09-13` or `git reset --hard backup/pre-sprite-gen-2026-09-13`.

## Vendor
- Cloned `aldegad/sprite-gen@2.2.0` to `tools/sprite-gen` (depth 1).
- Venv `tools/sprite-gen/.venv` Python 3.13, Pillow 12.3 + NumPy 2.5.
- Added to `.gitignore`: `tools/sprite-gen/.venv`, `assets/sprites/runs/`, `assets/sprites/generated/.cache/`. (`assets/sprites/generated/` itself is committed — that's the atlas output checked in.)
- Verification: `tools/sprite-gen/.venv/Scripts/python.exe -m sprite_gen.cli prepare --help` OK. `PYTHONUTF8` not needed for subcommands; root `--help` has cp1252 arrow issue on Windows — use subcommand help or `chcp 65001`.

## Asset Pipeline (no new AWS resources)
```
assets/sprites/
  source/          # 1 base image per character/prop (checked in, e.g., player-base.png 512x512 on chroma)
  runs/            # sprite-gen --out-dir per character (gitignored, ephemeral)
  generated/       # committed outputs: sprite-sheet-alpha.png + manifest.json per atlas
  specs/           # json specs for recolor / layer tracks

frontend/public/sprites/  # Vite serves generated atlases (copy from assets/sprites/generated on build)
frontend/src/assets/sprites/ # loader code
```

## Pipelines Used
- **A · atlas rows** (primary): `prepare → gen-set --provider pollinations → extract → compose-atlas → (curation optional)`. Free tier via the vendored Pollinations adapter (`POLLINATIONS_API_KEY`); codex/grok remain when paid/relevant credits exist.
- **B · video → loop** (optional for walk/run): `video-canvas → video → video-frames → video-loop` needs `ffmpeg` + `grok` CLI or `XAI_API_KEY` + `img2webp`.
- **C · utilities** (works offline, no credentials): `cutout`, `slice-sheet`, `unpack-atlas`. Used for offline demo + importing hand-drawn sheets.
- **D · post**: `recolor`, `compose-layers`, `export-aseprite` for variants without regeneration.

## What to Generate (priority)
1. **player** — 1 base still → states: idle (Breathe), walk, run, smoking, seated. 4 frames/state, 12fps walk/run, loop true. Chroma magenta #FF00FF.
2. **tables** — roulette-wheel, blackjack-table, slots-cabinet, dice-table, coinflip, lucky-wheel, piano, smoking-lounge. Each 1 base → idle static + hover glow variant via recolor.
3. **effects** — chip stack, card flip, dice roll (optional video-loop).
4. **casino-floor** — background-tile from floor texture (independent asset tool).

## Integration Layer (Pixi 7)
- `frontend/src/assets/sprites/AtlasLoader.ts` — loads `sprite-sheet-alpha.png` + `manifest.json.frame_layout`, creates `PIXI.BaseTexture` + `PIXI.Texture` frames, exposes `getFrames(state)`, `createAnimatedSprite(state)`.
- `frontend/src/assets/sprites/useSpriteAtlas.ts` — React hook that loads atlas and provides `AnimatedSprite` props.
- `CasinoMap.tsx` changes (behind feature flag `VITE_USE_SPRITE_ATLAS=1`):
  - Replace `createPlayerAvatar` Graphics with `AnimatedSprite` when atlas loaded, fallback to current Graphics.
  - Replace `mapWheelTexture`/`luckyWheelTexture` canvas draws with atlas sprites when available.
  - Culling unchanged; lazy-load atlases via `React.lazy` so pixi stays out of initial bundle (per AGENTS.md).
- Build: copy `assets/sprites/generated/*` to `frontend/public/sprites/` via `scripts/copy-sprites.mjs` hooked in `vite.config.js` or prebuild script.

## Steps to Achieve (executed in this PR)
1. **Done**: clone + venv + verify.
2. **Done**: `assets/sprites/{source,runs,generated,specs}` (+ `.gitkeep` in specs), `scripts/sprite-gen/` helpers, `.gitignore` updates.
3. **Done**: `scripts/copy-sprites.mjs`, `scripts/validate-sprites.mjs`, `scripts/sprite-gen.mjs` wrapper + npm scripts: `sprites`, `sprites:copy`, `sprites:validate`, `sprites:prepare|gen|extract|compose`, `build:sprites`.
4. **Done**: `AtlasLoader.ts` (loadSpriteAtlas/atlasFrames/createAnimatedSprite) + `useSpriteAtlas.ts` hooks. Typecheck clean. Loader awaits `PIXI.Assets.load` before cutting sub-textures.
5. **Done**: Offline demo proving pipeline C without credentials: `make-demo-base.py` (procedural base on magenta chroma) → `sprite-gen cutout` (73.88% alpha zero) → `assets/sprites/generated/demo/` atlas + manifest → `npm run sprites:copy` → `frontend/public/sprites/demo/`. `sprites:validate` passes the loader contract.
6. **Done**: docs/sprite-gen-integration-plan.md documents the full AI generation path.
7. **Done**: gates — `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test` all PASS.
8. **Done**: CasinoMap flag-gated swap behind `VITE_USE_SPRITE_ATLAS=1` (avatars → player atlas AnimatedSprite; roulette/lucky-wheel sprites → atlas idle frame; procedural fallback kept throughout, atlas load never blocks). Kept `_liveWheels`-tagged sprites swapped on load.
9. **Done**: Full-set run scaffolding for 11 subjects (player + roulette/blackjack/cardgame/luckywheel/dice/coinflip/slots/piano/reception/smoking) via `scripts/sprite-gen/prepare-all.mjs` → `assets/sprites/runs/<id>/` (gitignored) with magenta `#FF00FF` chroma and per-subject descriptions/styles.
10. **Done — provider unblocked (free route)**: a `pollinations` provider was vendored into `tools/sprite-gen` (the AI-image providers codex/grok are both paid/OAuth-bound: codex needs ChatGPT OAuth with `image_gen`, grok hardcodes `api.x.ai` + xAI billing). The Pollinations AI gateway's **free tier covers the classic `flux` model** (verified live 2026-09-13: 1024×256 strip PNG; the modern gateway image models are paid-only → HTTP 402). `gen-set --provider pollinations` is wired; rows generate on the magenta chroma key and are matted out by `extract` exactly like grok rows. Requires a free key (`enter.pollinations.ai/keys`) exported as `POLLINATIONS_API_KEY`. Tested offline (`tests/gen/test_pollinations_provider.py`, 20 passed) + one live image probe OK; full batch run in progress.
11. **Done — full batch generated + published (2026-09-13)**: all 11 runs generated via free `flux` (`POLLINATIONS_API_KEY`), with two flux-specific fixes:
    - `scripts/sprite-gen/rekey-backdrop.py` — flux renders "magenta #FF00FF" as hot pink (~(248,15,100)), so every raw strip is border-flood-filled to the exact key before `extract`. Family B flood (floor-glow cleanup) was tried and reverted: flux's light-pink floor-glow band cannot be separated from bright subject pixels by color tolerance, so the glow is prevented at the prompt level instead (strong anti-floor/glow bumps in `prepare-all.mjs` CHROMA + hand-tuned `player/prompts/idle.txt`).
    - Effects/table runs are **single-subject, `frames: 1`** (converted via `scripts/sprite-gen` conversion in `assets/sprites/runs/`): `flux` draws ONE prop on a 4-frame idle strip instead of four copies, so the 4-frame taxonomy extract fails; a single centered table frame is exactly what the runtime needs (the runtime only reads idle[0]). Player keeps the 4-frame idle/attack/jump/wave taxonomy.
    - Player idle needed the glow fix only; `attack/jump/wave` were clean first pass.
    - Atlases composed to `assets/sprites/generated/<id>/` (player + roulette + blackjack + cardgame + luckywheel + dice + coinflip + slots + piano + reception + smoking), `npm run sprites:copy` → `frontend/public/sprites/`, `npm run sprites:validate` PASS on all 12 (incl. demo). Pixel verification: all sheets match manifest dims, transparent backdrops, 14–43% opaque subject content, zero visible key pixels (remaining exact-key pixels are alpha=1 → invisible).
    - **Flag flipped**: `netlify.toml [build.environment] VITE_USE_SPRITE_ATLAS = "1"`; documented in `frontend/.env.example`. Build verified with the flag set; atlas loader code is in the bundle (no `VITE_USE_SPRITE_ATLAS` string remains → resolved at build). Runtime loads `player`/`roulette`/`luckywheel` atlases; other tables stay procedural until wired.

## Full AI Generation (free Pollen tier)
The 11 prepared runs already exist under `assets/sprites/runs/` (created via `prepare-all.mjs`). Generate with:

```bash
# 0. One-time: get a free key at https://enter.pollinations.ai/keys then:
set POLLINATIONS_API_KEY=...

# 1. Generate rows for every prepared subject (free Pollen; codex/grok remain usable with their own credits)
#    gen mode = gen-set --provider pollinations, then rekey-backdrop per run (flux->exact magenta key).
node scripts/sprite-gen/prepare-all.mjs gen          # all runs; player rows reuse their valid reports
# or per run:
tools/sprite-gen/.venv/Scripts/python.exe -m sprite_gen.cli gen-set --run-dir assets/sprites/runs/player --provider pollinations
tools/sprite-gen/.venv/Scripts/python.exe scripts/sprite-gen/rekey-backdrop.py assets/sprites/runs/player

# 2. Extract + compose + publish one run (repeat per subject)
tools/sprite-gen/.venv/Scripts/python.exe -m sprite_gen.cli extract --run-dir assets/sprites/runs/<id> --states idle
tools/sprite-gen/.venv/Scripts/python.exe -m sprite_gen.cli compose-atlas --run-dir assets/sprites/runs/<id>
#   then copy <id>/sprite-sheet-alpha.png + manifest.json -> assets/sprites/generated/<id>/

# 3. Copy to the frontend public tree + validate the loader contract
npm run sprites:copy && npm run sprites:validate

# 4. Optional curation
tools/sprite-gen/.venv/Scripts/python.exe -m sprite_gen.cli curation --run-dir assets/sprites/runs/player
```

**Free Pollen notes**
- Provider: `pollinations` (vendored adapter; see `tools/sprite-gen/docs/gen.md`). Default model `flux` — the free-tier gateway model, verified live; modern gateway models (`flux.2-flex`, seedream, Gemini image, …) are paid-only and return HTTP 402 on free credits.
- Canvas defaults to `1024×256` (4-frame strip) — override with `POLLINATIONS_WIDTH`/`POLLINATIONS_HEIGHT`.
- **Rekey before extract**: flux paints the magenta backdrop as hot pink (~248,15,100), so raw rows must pass through `scripts/sprite-gen/rekey-backdrop.py` (border flood-fill to exact `#FF00FF`) before `extract` keys them. `prepare-all.mjs gen` does this automatically per run. A light-pink floor-glow band can fuse the frames; it cannot be removed by color-flood (it eats bright subject pixels) — the prompts ban floor/glow/pedestal explicitly instead.
- **Effect runs are single-frame**: the free `flux` model does not reliably draw 4 copies of a prop (it draws one), so table/effect runs declare `idle.frames = 1` and ask for one centered subject; extraction then yields one 256×256 frame per table.
- Refs (identity/layout guides) are **not sent** — the adapter prints a notice; the row prompts already embed identity + layout + chroma spec.
- On `429` lower gen-set concurrency (`--concurrency 2`); on `402` the model is paid-only or the account balance is empty — rerun if the free tier refilled.
- Fallback if the gateway is ever down/paid-only: codex (ChatGPT OAuth w/ `image_gen`) or grok (`XAI_API_KEY`) via `--provider codex|grok`.

For video loops: `video-canvas → video → video-frames → video-loop` per `docs/video-pipeline.md`, requires `ffmpeg` + `img2webp` in PATH.

## Risks / Guardrails
- No new Lambda/Dynamo/WAF/cache/reserved concurrency — sprite assets are static files served by Netlify.
- Generation is local, zero AWS cost.
- Fallback path keeps casino playable if atlas missing/corrupt.
- `tools/sprite-gen` is git-ignored venv, reproducible via `py -m venv` + `pip install -e tools/sprite-gen`.
- Windows cp1252 help bug does not affect pipeline; use subcommand help.

## Rollback
- `git checkout backup/pre-sprite-gen-2026-09-13 -- frontend/src/components/CasinoMap.tsx` etc. or full branch checkout.
- Delete `assets/sprites/generated` and `frontend/public/sprites/demo` to revert to procedural.

## Verification (pre-merge)
- `npm run typecheck` PASS
- `npm run build` PASS (lazy chunk still present)
- `npx cdk synth --quiet` PASS (no infra change)
- `tools/sprite-gen/.venv/Scripts/python.exe -m sprite_gen.cli extract --help` PASS
- Manual: `VITE_USE_SPRITE_ATLAS=1 npm run dev`, verify lobby loads, fallback works.
