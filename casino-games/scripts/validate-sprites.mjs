// Dry-run validation of the sprites loader contract against every committed
// atlas manifest under assets/sprites/generated. Mirrors the checks that
// frontend/src/assets/sprites/AtlasLoader.ts makes at runtime.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const genRoot = join(root, 'assets', 'sprites', 'generated');
const required = ['game_input', 'degraded_static_fallback', 'animation.rows', 'frame_layout.rows'];
// These are PixelLab staging/source folders, not runtime atlases.
const staging = new Set(['floor', 'sos-pixellab']);

const entries = readdirSync(genRoot).filter((n) => {
  if (staging.has(n)) return false;
  try {
    return statSync(join(genRoot, n)).isDirectory();
  } catch {
    return false;
  }
});

let failures = 0;
for (const name of entries) {
  const dir = join(genRoot, name);
  const manifestPath = join(dir, 'manifest.json');
  const sheetPath = join(dir, 'sprite-sheet-alpha.png');
  const problems = [];
  if (!statSync(manifestPath, { throwIfNoEntry: false })) problems.push('missing manifest.json');
  else {
    let m;
    try {
      m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      problems.push(`manifest.json not valid JSON: ${e.message}`);
    }
    if (m) {
      for (const field of required) {
        const parts = field.split('.');
        let v = m;
        for (const p of parts) v = v?.[p];
        if (v === undefined) problems.push(`missing ${field}`);
      }
      if (m.frame_layout?.rows) {
        for (const [state, rects] of Object.entries(m.frame_layout.rows)) {
          for (const r of rects) {
            if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.w) || !Number.isFinite(r.h)) {
              problems.push(`frame_layout.rows.${state} has non-numeric rect`);
            }
          }
        }
      }
    }
  }
  if (!statSync(sheetPath, { throwIfNoEntry: false })) problems.push('missing sprite-sheet-alpha.png');
  if (problems.length) {
    failures += 1;
    console.log(`✗ ${name}: ${problems.join('; ')}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

if (failures) {
  console.error(`\n${failures} atlas(es) failed the loader contract check.`);
  process.exit(1);
}
console.log(`\nAll ${entries.length} atlas(es) satisfy the loader contract.`);
