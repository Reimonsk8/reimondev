#!/usr/bin/env python3
"""Procedural demo base image for the sprite-gen pipeline (no AI needed).

Draws a simple casino token/card on a magenta chroma background and saves it
to <repo>/assets/sprites/source. Proves the offline C-utilities pipeline
(cutout -> alpha) without any AI provider credentials.

Usage:
  tools/sprite-gen/.venv/Scripts/python.exe scripts/sprite-gen/make-demo-base.py
"""
from pathlib import Path
import sys

from PIL import Image, ImageDraw

MAGENTA = (255, 0, 255, 255)
OUT = Path(__file__).resolve().parents[2] / "assets" / "sprites" / "source" / "player-base.png"


def draw_red_chip(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int) -> None:
    # Gold ring
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(212, 175, 55, 255), outline=(255, 223, 138, 255), width=4)
    # Inner dark band
    draw.ellipse((cx - r * 0.82, cy - r * 0.82, cx + r * 0.82, cy + r * 0.82), fill=(160, 32, 45, 255), outline=(255, 223, 138, 255), width=2)
    # Center
    draw.ellipse((cx - r * 0.5, cy - r * 0.5, cx + r * 0.5, cy + r * 0.5), fill=(200, 60, 60, 255))
    # "88"
    draw.text((cx - 8, cy - 10), "88", fill=(255, 255, 255, 255))


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    size = 256
    img = Image.new("RGBA", (size, size), MAGENTA)
    d = ImageDraw.Draw(img)
    # Two chips + a card, centered with margin (safe margin ~ 9.4%).
    draw_red_chip(d, 96, 110, 46)
    draw_red_chip(d, 160, 156, 46)
    # Card
    d.rounded_rectangle((118, 44, 188, 122), radius=8, fill=(245, 245, 236, 255), outline=(120, 60, 20, 255), width=3)
    d.text((130, 62), "A", fill=(20, 20, 20, 255))
    d.text((150, 88), "♠", fill=(20, 20, 20, 255))  # may not render in base font; fine for demo
    img.save(OUT, "PNG")
    print(f"wrote {OUT} ({size}x{size}, magenta chroma)")
    return 0


if __name__ == "__main__":
    sys.exit(main())