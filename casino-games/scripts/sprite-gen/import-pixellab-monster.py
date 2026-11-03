#!/usr/bin/env python3
"""Import a PixelLab monster export into Square of Shadows' 27-frame atlas.

PixelLab exports a character's rotations and selected animation frames as a
ZIP, with a metadata.json file describing the paths. SoS's renderer expects a
single horizontal atlas in its fixed state order. This adapter preserves the
PixelLab source frames, upscales with nearest-neighbour filtering, and uses the
south-facing idle as a static fallback for states that have no generated clip.

Usage:
  tools/sprite-gen/.venv/Scripts/python.exe scripts/sprite-gen/import-pixellab-monster.py \
    --run-dir assets/sprites/runs/beast-full \
    --out-dir assets/sprites/generated/sos-monster-beast \
    --source-id 6db0c553-e71f-441f-bc6a-ff8beef1918d
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


CELL = 272
SCALE = 4
STATE_LAYOUT = [
    ("idle", 4),
    ("attack", 6),
    ("cast", 6),
    ("death", 7),
    ("walk", 4),
]


def open_rgba(root: Path, relative: str) -> Image.Image:
    with Image.open(root / relative) as image:
        return image.convert("RGBA")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--source-id", required=True)
    args = parser.parse_args()

    metadata_path = args.run_dir / "metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    state = metadata["states"][0]
    frame_paths = state["frames"]
    character = state["character"]
    base_size = character["size"]
    if base_size["width"] != base_size["height"]:
        raise ValueError(f"Expected square source frames; got {base_size}")

    idle = open_rgba(args.run_dir, frame_paths["rotations"]["south"])
    if idle.size != (base_size["width"], base_size["height"]):
        raise ValueError(f"Idle frame size {idle.size} disagrees with metadata {base_size}")

    animations = frame_paths.get("animations", {}).get("attack", {}).get("south", [])
    attack_frames = [open_rgba(args.run_dir, path) for path in animations]
    walk_paths = frame_paths.get("animations", {}).get("walk", {}).get("south", [])
    walk_frames = [open_rgba(args.run_dir, path) for path in walk_paths]
    if any(frame.size != idle.size for frame in attack_frames + walk_frames):
        raise ValueError("Animation frames must match the idle canvas size")

    # Sample the whole generated attack clip into the six positions the SoS
    # action animation exposes. If there is no generated clip, use the idle
    # fallback so no animation slice ever points outside the atlas.
    if attack_frames:
        attack = [
            attack_frames[round(i * (len(attack_frames) - 1) / 5)]
            for i in range(6)
        ]
    else:
        attack = [idle.copy() for _ in range(6)]

    if walk_frames:
        walk = [walk_frames[round(i * (len(walk_frames) - 1) / 3)] for i in range(4)]
    else:
        walk = [idle.copy() for _ in range(4)]

    poses = {
        "idle": [idle.copy() for _ in range(4)],
        "attack": attack,
        # Monsters have no cast action; retain the same clear idle silhouette.
        "cast": [idle.copy() for _ in range(6)],
        # No generated death clip yet: fade the PixelLab idle silhouette rather
        # than showing a player-class corpse animation.
        "death": [idle.copy() for _ in range(7)],
        "walk": walk,
    }

    frames: list[Image.Image] = []
    states_manifest: dict[str, dict[str, int]] = {}
    start = 0
    for state_name, count in STATE_LAYOUT:
        states_manifest[state_name] = {"start": start, "frames": count}
        frames.extend(poses[state_name])
        start += count

    # Alpha fade across the fallback death state is a lightweight, honest
    # fallback until a dedicated death animation is commissioned.
    death_start = states_manifest["death"]["start"]
    for index in range(7):
        frame = frames[death_start + index]
        alpha = frame.getchannel("A").point(lambda value, factor=(6 - index) / 6: round(value * factor))
        frame.putalpha(alpha)

    out_width = CELL * len(frames)
    atlas = Image.new("RGBA", (out_width, CELL), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        scaled = frame.resize((CELL, CELL), Image.Resampling.NEAREST)
        atlas.alpha_composite(scaled, (index * CELL, 0))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    atlas.save(args.out_dir / "sprite-sheet-alpha.png", optimize=True)

    rects = [
        {"x": index * CELL, "y": 0, "w": CELL, "h": CELL}
        for index in range(len(frames))
    ]
    manifest = {
        "game_input": "sprite-sheet-alpha.png",
        "generator": "PixelLab character + attack animation; nearest-neighbour SoS atlas adapter",
        "source_character_id": args.source_id,
        "source_state": character.get("name", "Idle"),
        "source_view": character.get("view", "low top-down"),
        "source_directions": character.get("directions", 4),
        "degraded_static_fallback": True,
        "animation": {
            "rows": {
                "all": {
                    "row": 0,
                    "frames": len(frames),
                    "fps": 12,
                    "loop": False,
                }
            }
        },
        "frame_layout": {
            "rows": {"all": rects},
            "sheetWidth": out_width,
            "sheetHeight": CELL,
            "cellWidth": CELL,
            "cellHeight": CELL,
        },
        "states": states_manifest,
        "generated_states": ["idle"]
        + (["attack"] if attack_frames else [])
        + (["walk"] if walk_frames else []),
        "static_fallback_states": ["cast", "death"]
        + ([] if walk_frames else ["walk"]),
        "source_attack_frames": len(attack_frames),
        "source_walk_frames": len(walk_frames),
    }
    (args.out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {args.out_dir} ({len(frames)} frames, {out_width}x{CELL})")


if __name__ == "__main__":
    main()
