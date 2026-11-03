# Vendored: pixelfx

Upstream: https://github.com/patch-gg/pixelfx
Commit: `a84159688af3ca37a4be05a0d422b94451b2e24e` (tag/version 0.3.0, "pixelfx 0.3.0: give the effects a body that performs them")
License: MIT (see `LICENSE`, `NOTICE.md`)

This is the default VFX generator for the games in `casino-games/`. It is
vendored (not a submodule) so the pipeline works on a fresh clone with no extra
setup.

## What was removed from the upstream checkout

- `.git/` — history lives upstream; this directory is plain source in our repo.
- `.github/` — upstream CI.
- `docs/readme/acts.gif`, `docs/readme/montage.gif` — ~12 MB of README previews
  that nothing here reads. `docs/CATALOG.md` and `docs/AUTHORING.md` are kept.
- `records/` — generated previews (created by the upstream render tool).

## Updating

```bash
rm -rf vendor/pixelfx
git clone --depth 1 https://github.com/patch-gg/pixelfx vendor/pixelfx
rm -rf vendor/pixelfx/.git vendor/pixelfx/.github vendor/pixelfx/docs/readme/*.gif
npm run vfx        # re-export every effect and refresh the generated manifest
git diff --stat frontend/public/sprites/vfx
```

Update the commit hash above when you do.

## Not to be confused with

`vendor/pixelfx` is the generator. The effects we actually ship are generated
artifacts in `frontend/public/sprites/vfx/` — commit those, not the upstream
`records/` previews.
