#!/usr/bin/env node
// Batch-prepares sprite-gen runs for the full casino subject set (no AI, no
// spend). Creates assets/sprites/runs/<id>/sprite-request.json + prompts so
// the generation phase is a single command:
//   node scripts/sprite-gen/prepare-all.mjs
// Then, with a free Pollen key set (POLLINATIONS_API_KEY) or another provider:
//   node scripts/sprite-gen/prepare-all.mjs gen [provider]   # default provider: pollinations
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const isWin = process.platform === 'win32';
const python = isWin
  ? join(root, 'tools', 'sprite-gen', '.venv', 'Scripts', 'python.exe')
  : join(root, 'tools', 'sprite-gen', '.venv', 'bin', 'python');

// Each subject: run id -> prepare args. Tables are drawn top-down on the
// casino map; player avatars are pseudo top-down. All rows generate on a
// magenta chroma background so the frame extractor can key them out.
// The prompt wording explicitly bans floor/ground/pedestal/shadow/glow
// artifacts because the free tier's `flux` model otherwise paints a light-pink
// floor glow band across the strip (fusing all frames; rekey-backdrop cannot
// safely flood that band — see scripts/sprite-gen/rekey-backdrop.py).
const CHROMA = '(solid flat magenta #FF00FF background, no text, no watermark, no floor, no ground, no pedestal, no shadow under or behind the subject, no glow, no light bloom, no reflection, no gradient)';
const TABLES = 'clean pixel-art casino prop, top-down view, centered with margin, consistent 2D isometric-ish style, consistent palette, unified outline weight';

const SUBJECTS = [
  {
    id: 'player',
    subject: 'character',
    description: `Casino guest character, elegant suit, three-quarter top-down view, full body visible with margin ${CHROMA}`,
    style: 'clean cozy pixel-art game character, 32px-ish scale, rounded shapes, consistent outline weight, consistent palette',
    states: 'idle,attack,jump,wave',
  },
  ...[
    ['roulette', 'red-and-black roulette wheel with green felt apron and gold rim'],
    ['blackjack', 'green felt blackjack table with a gold betting arc and card lane'],
    ['cardgame', 'card-duel table with two card dealing slots on green felt'],
    ['luckywheel', 'colorful eight-segment prize wheel on a wooden stand'],
    ['dice', 'dice table with a red leather rail and green felt with white dice pattern'],
    ['coinflip', 'coin-flip table with a golden coin pedestal and blue felt'],
    ['slots', 'slot machine cabinet with three reels and a coin tray'],
    ['piano', 'black grand piano top-down with white keys and gold trim'],
    ['reception', 'reception desk with a gold emblem and a ledger on the counter'],
    ['smoking', 'luxury smoking lounge area with a small armchair and ashtray table'],
    ['palm', 'potted palm tree with lush green fronds in a gold-rimmed planter'],
    ['deco', 'ornamental floor vase with tropical leaves and gold trim'],
  ].map(([id, what]) => ({
    id,
    subject: 'effect',
    description: `${what}, ${TABLES} ${CHROMA.replace(')', '')}`,
    style: TABLES,
    states: 'idle',
  })),
];

const mode = process.argv[2] === 'gen';
const PROVIDERS = ['pollinations', 'codex', 'grok'];
const extraArgs = process.argv.slice(3);
// Provider defaults to pollinations; an explicit provider name may follow
// `gen`. Any remaining args are target subject ids to limit the batch to
// (e.g. `node scripts/sprite-gen/prepare-all.mjs gen palm deco`).
const provider = PROVIDERS.includes(extraArgs[0]) ? extraArgs[0] : 'pollinations';
const targets = extraArgs.filter((a) => !PROVIDERS.includes(a));
if (targets.length) console.log(`Target subjects only: ${targets.join(', ')}`);

let rc = 0;
for (const s of SUBJECTS) {
  if (targets.length && !targets.includes(s.id)) continue;
  const runDir = join(root, 'assets', 'sprites', 'runs', s.id);
  if (existsSync(runDir) && readdirSync(runDir).length > 2 && !mode) {
    console.log(`skip prepare ${s.id} (run dir already exists)`);
    continue;
  }
  const args = mode
    ? ['-m', 'sprite_gen.cli', 'gen-set', '--run-dir', runDir, '--provider', provider, '--states', s.states, '--concurrency', '2']
    : [
        '-m',
        'sprite_gen.cli',
        'prepare',
        '--out-dir',
        runDir,
        '--character-id',
        s.id,
        '--description',
        s.description,
        '--style',
        s.style,
        '--subject',
        s.subject,
        '--chroma-key',
        '#FF00FF',
        '--force',
      ];
  console.log(`\n=== ${mode ? 'gen' : 'prepare'} ${s.id} ===`);
  const res = spawnSync(python, args, { cwd: root, encoding: 'utf-8', stdio: 'inherit' });
  if (res.status !== 0) rc = rc || (res.status ?? 1);
  if (mode) {
    // flux paints magenta as hot pink: recolor the backdrop to the run's exact
    // key before the frame extractor keys it (scripts/sprite-gen/rekey-backdrop.py).
    const rekey = spawnSync(python, ['scripts/sprite-gen/rekey-backdrop.py', runDir], { cwd: root, encoding: 'utf-8', stdio: 'inherit' });
    if (rekey.status !== 0) rc = rc || (rekey.status ?? 1);
  }
}
console.log(mode ? '\nGeneration batch done.' : '\nAll runs prepared. Next: node scripts/sprite-gen/prepare-all.mjs gen');
process.exit(rc);