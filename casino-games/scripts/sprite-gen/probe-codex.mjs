#!/usr/bin/env node
// One-shot probe of the sprite-gen codex provider: generates a single base
// image and reports success/failure cleanly, so AI generation can be gated
// on account capability before a full gen-set batch (avoids burning credits
// on an account without image_gen).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const isWin = process.platform === 'win32';
const python = isWin
  ? join(root, 'tools', 'sprite-gen', '.venv', 'Scripts', 'python.exe')
  : join(root, 'tools', 'sprite-gen', '.venv', 'bin', 'python');

if (!existsSync(python)) {
  console.error(`venv not found at ${python} — run the setup first.`);
  process.exit(1);
}

const subject = process.argv[2] || 'player';
const outDir = join(root, 'assets', 'sprites', 'source');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `${subject}-base.png`);

const prompts = {
  player:
    'Pixel-art casino guest character, top-down three-quarter view, elegant suit, facing down-right slightly toward viewer, centered, full body visible with margin, drawn on a solid magenta (#FF00FF) background, no text, no watermark, no shadow.',
  roulette:
    'Pixel-art top-down view of a casino roulette table, green felt, red/black numbered wheel in center, gold rim, centered with margin, drawn on a solid magenta (#FF00FF) background, no text, no watermark, no shadow.',
};

const prompt = prompts[subject] || prompts.player;

console.log(`Probing codex image_gen for subject "${subject}" -> ${out}`);
const res = spawnSync(
  python,
  ['-m', 'sprite_gen.cli', 'gen', '--provider', 'codex', '--prompt', prompt, '--out', out, '--report', out.replace('.png', '.report.json')],
  { cwd: root, encoding: 'utf-8', stdio: 'inherit' }
);

if (res.status !== 0) {
  console.error(`\nPROBE FAILED (exit ${res.status}). The codex account may not offer image_gen, or the provider errored.`);
  console.error('Check the report file above for provider/alpha details.');
  process.exit(res.status ?? 1);
}

if (existsSync(out)) {
  console.log(`\nPROBE OK — wrote ${out}`);
} else {
  console.error('\nPROBE FAILED — exit 0 but no output image.');
  process.exit(1);
}