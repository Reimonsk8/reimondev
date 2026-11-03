"""
Composite the PixelLab altar set into the one decor sprite sheet the renderer
already knows how to draw.

The sheet is 16 frames of 32x32, laid out left to right.

Why 32 and not the altars' native 64: the decor layer is sized in percentages
(`calc(100% * count) 100%`), so a frame is displayed at exactly one CELL wide no
matter how many pixels it is in the file. A 64px frame lands in a ~30px cell and
the browser downsamples pixel art with a smooth filter, which is what makes
shrunken pixel art look like mud. 32px is ~1:1 with a cell and stays crisp. It is
also the frame size of the existing `sos-ground-decor` sheet (320px / 10), so
the two decor sets are interchangeable on screen.

Frame geometry is NOT recomputed anywhere downstream: `background-position` is
`i / (count - 1)`, which is only correct while the sheet is exactly `count`
tiles wide and one tile tall. That constraint is load-bearing and is why this
build refuses anything else.

Run: python scripts/build-altar-decor.py
"""

import json
import pathlib
import sys

from PIL import Image

ALTAR_DIR = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/altars")
OUT_DIR = pathlib.Path("frontend/public/sprites/sos-altar-decor")

FRAME = 32
EXPECTED_FRAMES = 16
NATIVE = 64

# Box (area average) rather than NEAREST: halving pixel art by picking every
# other pixel aliases badly on thin structures, and the altars are full of them
# — railings, candle stems, cross bars. Averaging keeps the silhouette and drops
# the shimmer.
RESAMPLE = Image.Resampling.BOX


def main() -> int:
    sources = sorted(
        ALTAR_DIR.glob("altar-*.png"),
        key=lambda p: int(p.stem.split("-")[1]),
    )
    if len(sources) != EXPECTED_FRAMES:
        print(f"expected {EXPECTED_FRAMES} altars, found {len(sources)} in {ALTAR_DIR}")
        return 1

    frames = []
    for path in sources:
        img = Image.open(path).convert("RGBA")
        if img.size != (NATIVE, NATIVE):
            print(f"{path.name} is {img.size}, expected {(NATIVE, NATIVE)}")
            return 1
        frames.append(img.resize((FRAME, FRAME), RESAMPLE))

    sheet = Image.new("RGBA", (FRAME * len(frames), FRAME), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        sheet.paste(frame, (i * FRAME, 0))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_DIR / "sprite-sheet-alpha.png")

    # The existing decor sheet ships a manifest, so this one does too. It is
    # documentation, not config: nothing reads it, and pretending otherwise would
    # be worse than saying so.
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(
            {
                "game_input": "sos",
                "source": "PixelLab 'epic dark fantasy ruined gothic' altar set, 16 objects",
                "frames": EXPECTED_FRAMES,
                "frame_size": f"{FRAME}x{FRAME}",
                "sheet": f"{FRAME * EXPECTED_FRAMES}x{FRAME}",
                "source_native_size": f"{NATIVE}x{NATIVE}",
                "usage": "ADVENTURE map mode wall decoration, sparse",
                "note": "drawn by the shared decor layer; frame offset is i/(count-1)",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"wrote {OUT_DIR / 'sprite-sheet-alpha.png'} ({sheet.size[0]}x{sheet.size[1]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())