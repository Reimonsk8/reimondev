/** Assemble the reviewed PixelLab ground props into the runtime SoS decal atlas. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIZE = 32;
const PROPS = [
  ['BONE_RUBBLE', 'bone-rubble'],
  ['RELIQUARY', 'stone-reliquary'],
  ['FALLEN_HELM', 'fallen-helm'],
  ['ROSE_GLASS', 'rose-glass'],
  ['WAR_BANNER', 'war-banner'],
  ['SWORD_ROSARY', 'sword-rosary'],
  ['WAR_PSALTER', 'war-psalter'],
  ['CENSER', 'censer'],
  ['SAINT_HEAD', 'saint-head'],
  ['SUPPLY_CHEST', 'supply-chest'],
];

const sourceDir = join(ROOT, 'assets', 'sprites', 'generated', 'sos-pixellab', 'ground-decor');
const sourceOut = join(ROOT, 'assets', 'sprites', 'generated', 'sos-ground-decor');
const runtimeOut = join(ROOT, 'frontend', 'public', 'sprites', 'sos-ground-decor');

function buildAtlas() {
  const width = SIZE * PROPS.length;
  const pixels = Buffer.alloc(width * SIZE * 4);
  const frameRows = {};
  const animationRows = {};

  for (const [index, [name, slug]] of PROPS.entries()) {
    const image = decodePng(readFileSync(join(sourceDir, `${slug}.png`)));
    assert.equal(image.width, SIZE, `${slug}: expected 32px width`);
    assert.equal(image.height, SIZE, `${slug}: expected 32px height`);
    let opaque = 0;
    for (let i = 3; i < image.rgba.length; i += 4) if (image.rgba[i] > 0) opaque += 1;
    assert.ok(opaque > 0 && opaque < SIZE * SIZE, `${slug}: expected a visible transparent prop`);
    for (let y = 0; y < SIZE; y += 1) {
      image.rgba.copy(pixels, (y * width + index * SIZE) * 4, y * SIZE * 4, (y + 1) * SIZE * 4);
    }
    frameRows[name] = [{ x: index * SIZE, y: 0, w: SIZE, h: SIZE }];
    animationRows[name] = { row: 0, frames: 1, fps: 1, loop: false };
  }
  return { width, pixels, frameRows, animationRows };
}

function writeAtlas(atlas) {
  const manifest = {
    game_input: 'sos',
    degraded_static_fallback: false,
    source: 'PixelLab Pixen gothic Templar aftermath prop set',
    animation: { rows: atlas.animationRows },
    frame_layout: {
      rows: atlas.frameRows,
      sheetWidth: atlas.width,
      sheetHeight: SIZE,
      cellWidth: SIZE,
      cellHeight: SIZE,
    },
  };
  for (const directory of [sourceOut, runtimeOut]) mkdirSync(directory, { recursive: true });
  writeFileSync(join(sourceOut, 'sprite-sheet-alpha.png'), encodePng(atlas.width, SIZE, atlas.pixels));
  writeFileSync(join(sourceOut, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(runtimeOut, 'sprite-sheet-alpha.png'), encodePng(atlas.width, SIZE, atlas.pixels));
  writeFileSync(join(runtimeOut, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

const atlas = buildAtlas();
writeAtlas(atlas);
console.log(`Assembled ${PROPS.length} transparent gothic props into ${atlas.width}x${SIZE}.`);
