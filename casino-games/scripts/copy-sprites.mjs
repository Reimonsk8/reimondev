#!/usr/bin/env node
// Copies committed generated atlases (assets/sprites/generated/*) into the
// frontend public tree so Vite serves them as static assets:
//   assets/sprites/generated/<name>/sprite-sheet-alpha.png + manifest.json
//   -> frontend/public/sprites/<name>/...
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcRoot = join(root, 'assets', 'sprites', 'generated');
const destRoot = join(root, 'frontend', 'public', 'sprites');

if (!existsSync(srcRoot)) {
  console.log('assets/sprites/generated does not exist yet — nothing to copy.');
  process.exit(0);
}

const entries = readdirSync(srcRoot).filter((name) => {
  try {
    return statSync(join(srcRoot, name)).isDirectory();
  } catch {
    return false;
  }
});

if (entries.length === 0) {
  console.log('assets/sprites/generated is empty — nothing to copy.');
  process.exit(0);
}

const SUFFIXES = [
  'sprite-sheet-alpha.png',
  'manifest.json',
  '.preview.gif',
  '.png', // individual per-state strips if present
];

rmSync(destRoot, { recursive: true, force: true });
mkdirSync(destRoot, { recursive: true });

function copyAtlasDir(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const file of readdirSync(srcDir)) {
    const full = join(srcDir, file);
    const st = statSync(full);
    if (st.isDirectory()) {
      copyAtlasDir(full, join(destDir, file));
      continue;
    }
    if (!st.isFile()) continue;
    const match = SUFFIXES.some((s) => file.endsWith(s));
    if (!match) continue;
    copyFileSync(full, join(destDir, file));
    copied += 1;
  }
}

let copied = 0;
for (const name of entries) {
  copyAtlasDir(join(srcRoot, name), join(destRoot, name));
}
console.log(`Copied ${copied} sprite asset(s) from ${srcRoot} -> ${destRoot}`);