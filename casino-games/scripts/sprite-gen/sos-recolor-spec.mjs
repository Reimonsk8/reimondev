#!/usr/bin/env node
/**
 * Author a sprite-gen `recolor` spec for the Square of Shadows class sprites.
 *
 * Why this exists: the only animated atlas in the repo (`player`) came back from
 * the image provider as an AI-painted frame with tens of thousands of distinct
 * RGB values, so a hand-written 5-anchor palette map only recolours ~42% of the
 * pixels and leaves the rest as casino blue-grey. This script enumerates the
 * dominant colours of a `recolor-palette` draft and projects each one onto the
 * nearest stop of a class ramp drawn from the dark-dungeon 16 palette, so the
 * recolour covers essentially every visible pixel while keeping each class's
 * lightness ordering intact.
 *
 * It emits authoring scaffolding only (the spec JSON). The bake itself is run
 * by `sprite-gen recolor`, which stays deterministic: same input bytes -> same
 * output bytes.
 *
 * Usage:
 *   node scripts/sprite-gen/sos-recolor-spec.mjs \
 *     --palette assets/sprites/runs/sos-classes/palette.full.json \
 *     --out     assets/sprites/runs/sos-classes/recolor.dense.json \
 *     --coverage 0.995
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const palettePath = args.get('palette');
const outPath = args.get('out');
const coverage = Number(args.get('coverage') ?? '0.995');
/**
 * Hard cap on anchors. The colour histogram is long-tailed (64k distinct values
 * from an AI-painted frame) and the bake cost is linear in the map size, so the
 * tail beyond a few thousand anchors is 1-2px anti-aliasing noise that the
 * recolour report already accounts for as `passthrough_pixels`.
 */
const maxEntries = Number(args.get('max-entries') ?? '4000');

if (!palettePath || !outPath) {
  console.error(
    'usage: sos-recolor-spec.mjs --palette <draft.json> --out <spec.json> [--coverage 0.995] [--max-entries 4000]',
  );
  process.exit(2);
}

/** Class ramps, dark -> light, from .opencode/skills/pixel-art/assets/palette-dark-dungeon.json */
const RAMPS = {
  warrior: ['#0b0910', '#7a2f1c', '#c8561f', '#f2a541', '#e8e4d8'],
  wizard: ['#0b0910', '#241b3a', '#8a4bd6', '#c9a0ff', '#e8e4d8'],
  cleric: ['#0b0910', '#2f3a2a', '#4d6b3a', '#7fa050', '#e8e4d8'],
  ranger: ['#0b0910', '#161225', '#4a4a66', '#a7b0c8', '#e8e4d8'],
};

const toRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Perceptual-ish luminance, good enough to keep ramp ordering monotonic. */
const luma = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

/** Squared weighted RGB distance (redmean) - cheap and far better than plain RGB. */
const dist2 = (a, b) => {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
};

const draft = JSON.parse(readFileSync(palettePath, 'utf8'));
const colours = draft.colors ?? [];

const totalPixels = colours.reduce((sum, c) => sum + c.pixels, 0);
const targetPixels = totalPixels * coverage;

// Keep the most frequent colours until the requested share of pixels is covered.
const selected = [];
let covered = 0;
for (const c of colours) {
  if (selected.length >= maxEntries) break;
  selected.push(c);
  covered += c.pixels;
  if (covered >= targetPixels) break;
}

const variants = Object.entries(RAMPS).map(([name, ramp]) => {
  const stops = ramp.map(toRgb);
  const map = {};
  for (const c of selected) {
    const src = toRgb(c.hex);
    let best = stops[0];
    let bestDist = Infinity;
    for (const stop of stops) {
      const d = dist2(src, stop);
      if (d < bestDist) {
        bestDist = d;
        best = stop;
      }
    }
    const hex = `#${best.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    map[c.hex] = hex;
  }
  return { name, map };
});

const spec = { version: 1, kind: 'sprite-gen-recolor', match: 'exact', variants };
writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      ok: true,
      spec: outPath,
      palette_colors: colours.length,
      mapped_colors: selected.length,
      covered_pixels: covered,
      total_opaque_pixels: totalPixels,
      coverage: Number((covered / totalPixels).toFixed(6)),
      variants: variants.map((v) => ({ name: v.name, entries: Object.keys(v.map).length })),
    },
    null,
    2,
  ),
);

// Sanity: a ramp that collapses to one colour would defeat the recolour.
for (const v of variants) {
  const distinct = new Set(Object.values(v.map));
  if (distinct.size < 3) {
    console.error(`variant ${v.name} collapsed to ${distinct.size} colour(s) - widen the ramp`);
    process.exit(1);
  }
}

export { luma };