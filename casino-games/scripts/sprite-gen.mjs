#!/usr/bin/env node
// Thin wrapper around the vendored sprite-gen CLI (tools/sprite-gen).
// Usage: node scripts/sprite-gen.mjs <subcommand> [args...]
// On Windows the venv interpreter is .venv\Scripts\python.exe; the CLI is
// run as `python -m sprite_gen.cli` to avoid the .exe shebang + cp1252 help
// quirk. Pass --help on a subcommand (e.g. `prepare --help`).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cliDir = join(root, 'tools', 'sprite-gen');
const isWin = process.platform === 'win32';
const python = isWin
  ? join(cliDir, '.venv', 'Scripts', 'python.exe')
  : join(cliDir, '.venv', 'bin', 'python');

if (!existsSync(python)) {
  console.error(
    `sprite-gen venv not found at ${python}\n` +
      'Run: py -m venv tools/sprite-gen/.venv && tools/sprite-gen/.venv/Scripts/pip.exe install -e tools/sprite-gen'
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') && args.length === 1) {
  // Subcommand help prints an ASCII flowchart with → which is fine; the
  // root parser fails on cp1252, so short-circuit to a manual summary.
  console.log(
    [
      'sprite-gen wrapper — pipeline A (atlas rows):',
      '  prepare --out-dir <run> --character-id <id> --base-image <png>  create a run',
      '  gen-set --run-dir <run> --provider codex                         generate state rows (needs codex login)',
      '  extract --run-dir <run>                                          chroma -> transparent frames',
      '  compose-atlas --run-dir <run>                                    sprite-sheet-alpha.png + manifest.json',
      '  curation --run-dir <run>                                         optional webview curation',
      'Pipeline C (offline utilities):',
      '  cutout <png> --white-check | --chroma-key #RRGGBB',
      '  slice-sheet --sheet <png> --chroma-key <key> --grid NxM',
      '  unpack-atlas --atlas <png> [--manifest <json>]',
      'Pass any sprite-gen CLI, e.g. node scripts/sprite-gen.mjs extract --help',
    ].join('\n')
  );
  process.exit(0);
}

const res = spawnSync(python, ['-m', 'sprite_gen.cli', ...args], {
  cwd: root,
  encoding: 'utf-8',
  stdio: 'inherit',
});
process.exit(res.status ?? 1);