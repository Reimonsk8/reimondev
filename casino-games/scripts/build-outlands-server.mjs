import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'node_modules/.cache/outlands-server.cjs');
await mkdir(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(root, 'server/outlands/index.js')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});

console.log(`Built authoritative Outlands server to ${outfile}`);
