/** Generate the four Gothic Adventure-mode Wang terrain atlases. */
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://api.pixellab.ai/v2';
const RUN_DIR = join(ROOT, 'assets', 'sprites', 'runs', 'sos-biomes-gothic');
const JOBS = join(RUN_DIR, 'jobs.json');
const LEDGER = join(ROOT, 'assets', 'sprites', 'generated', 'sos-pixellab', 'state.json');
const THEMES = [
  {
    id: 'grass',
    lower: 'Last Templar March floor: dead winter grass threaded through cracked soot-black cathedral paving, tarnished-brass mosaic fragments, bone dust, muted ash and a little dead moss; flat, no objects',
    upper: 'solid black limestone wall of a ruined border abbey, broken pointed arches, caught roots and torn crimson pennants; clearly blocked, not a walkable terrace',
    transition: 'ash, dead grass roots and chipped cathedral paving',
  },
  {
    id: 'holy-temple',
    lower: 'desecrated Templar cathedral floor: cracked charcoal marble, broken sun-and-sword mosaic in tarnished brass, dried blood and bone flecks; near-black, flat and readable',
    upper: 'solid ruined Templar church wall, black limestone blocks, chipped pointed-arch carving, a broken saint relief and dried-crimson scars; blocked vertical obstruction, not a platform',
    transition: 'bone dust, dried blood and shattered brass mosaic pieces',
  },
  {
    id: 'shadow-realm',
    lower: 'Veiled Ossuary floor: polished black stone fractured around pale bone-dust inlay and a broken eclipsed-sun church mosaic, restrained bruised-violet seams and dried crimson; flat, no objects',
    upper: 'solid black-glass basalt wall fused with weathered church masonry, blind reliquary niches, bone inlay and very dim bruised-violet seams; blocked, no walkable top',
    transition: 'bone dust, dark glass shards and small bruised-violet mineral seams',
  },
  {
    id: 'inferno',
    lower: 'Ashen Siege floor: charred cathedral flagstone with tiny subdued ember-red cracks, scorched brass crusader markings and fine ash; near-black, flat, no flames or objects',
    upper: 'solid soot-blackened limestone wall from a burned Templar basilica, broken pointed-arch relief, small fire-scar pits and tarnished-brass rivets; blocked vertical wall, no terrace',
    transition: 'charred rubble, ash and a few dark-red embers',
  },
];
const THROTTLE_MS = 15_000;
let lastSubmit = 0;

function apiKey() {
  if (process.env.PIXELLAB_API_KEY) return process.env.PIXELLAB_API_KEY;
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, 'utf8').match(/^\s*PIXELLAB_API_KEY\s*=\s*(.+?)\s*$/m);
    if (match) return match[1].replace(/^['"]|['"]$/g, '');
  }
  throw new Error('PIXELLAB_API_KEY is not configured; set it in .env or the environment.');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readJobs = () => existsSync(JOBS) ? JSON.parse(readFileSync(JOBS, 'utf8')) : {};
const saveJobs = (jobs) => {
  mkdirSync(dirname(JOBS), { recursive: true });
  writeFileSync(JOBS, `${JSON.stringify(jobs, null, 2)}\n`);
};

async function request(method, path, body) {
  if (body && lastSubmit) await sleep(Math.max(0, THROTTLE_MS - (Date.now() - lastSubmit)));
  if (body) lastSubmit = Date.now();
  const response = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${apiKey()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 423) return { pending: true };
    if (response.status === 429 || (response.status >= 500 && method === 'GET')) return { retry: true };
    throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

function recordUsage(usage, theme) {
  if (!usage) return;
  const state = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { spent: 0, log: [] };
  state.spent = (state.spent ?? 0) + (usage.generations ?? 0);
  state.log ??= [];
  state.log.push({ at: new Date().toISOString(), label: `terrain:${theme}`, generations: usage.generations ?? 0, usd: usage.usd ?? null });
  writeFileSync(LEDGER, `${JSON.stringify(state, null, 2)}\n`);
}

async function generate() {
  const jobs = readJobs();
  const balance = await request('GET', '/balance');
  console.log(`PixelLab credit balance before generation: $${balance?.credits?.usd ?? 'unknown'}`);
  for (const theme of THEMES) {
    if (existsSync(join(ROOT, 'assets', 'sprites', 'generated', `sos-terrain-${theme.id}`, 'manifest.json'))) {
      console.log(`${theme.id}: already generated; skipping`);
      continue;
    }
    const job = jobs[theme.id];
    if (!job?.tileset_id) {
      let result;
      do {
        result = await request('POST', '/create-tileset', {
          lower_description: theme.lower,
          upper_description: theme.upper,
          transition_description: theme.transition,
          transition_size: 0,
          shape_style: 'square',
          tile_size: { width: 32, height: 32 },
          view: 'high top-down',
          outline: 'single color outline',
          shading: 'medium shading',
          detail: 'medium detail',
          tile_strength: 1.2,
        });
        if (result.retry) {
          console.log(`${theme.id}: PixelLab is busy or rate-limiting; retrying in 15s`);
          await sleep(15_000);
        }
      } while (result.retry);
      jobs[theme.id] = {
        tileset_id: result.tileset_id,
        background_job_id: result.background_job_id ?? null,
        status: result.status ?? 'processing',
        usage: result.usage ?? null,
        queued_at: new Date().toISOString(),
      };
      saveJobs(jobs);
      recordUsage(result.usage, theme.id);
      console.log(`${theme.id}: queued (${result.usage?.generations ?? result.usage?.usd ?? 'usage pending'})`);
      if (result.tileset) {
        assemble(theme, result);
        jobs[theme.id].status = 'completed';
        saveJobs(jobs);
        continue;
      }
    }

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = await request('GET', `/tilesets/${jobs[theme.id].tileset_id}`);
      if (result.retry) {
        console.log(`${theme.id}: temporary PixelLab read failure; retrying in 15s`);
        await sleep(15_000);
        continue;
      }
      if (!result.pending) {
        assemble(theme, result);
        jobs[theme.id].status = 'completed';
        jobs[theme.id].completed_at = new Date().toISOString();
        if (!jobs[theme.id].usage && result.usage) {
          jobs[theme.id].usage = result.usage;
          recordUsage(result.usage, theme.id);
        }
        saveJobs(jobs);
        break;
      }
      if (attempt === 39) throw new Error(`${theme.id}: still processing after 10 minutes; rerun this command to resume`);
      console.log(`${theme.id}: processing; checking again in 15s`);
      await sleep(15_000);
    }
  }
  const after = await request('GET', '/balance');
  console.log(`PixelLab credit balance after queueing: $${after?.credits?.usd ?? 'unknown'}`);
}

function assemble(theme, result) {
  const tileset = result.tileset;
  assert.equal(tileset.total_tiles, 16, `${theme.id}: expected 16 Wang tiles`);
  const tileSize = tileset.tile_size.width;
  assert.equal(tileSize, 32, `${theme.id}: expected 32px tiles`);
  assert.equal(tileset.tile_size.height, tileSize);
  const sheetSize = tileSize * 4;
  const sheet = Buffer.alloc(sheetSize * sheetSize * 4);
  const frameRows = {};
  const animationRows = {};
  const tileMetadata = [];
  const occupied = new Set();

  for (const tile of tileset.tiles) {
    const corners = ['NW', 'NE', 'SE', 'SW'];
    const pattern = corners.reduce((bits, corner) => {
      const terrain = tile.corners[corner];
      assert.ok(terrain === 'lower' || terrain === 'upper', `${theme.id}/${tile.name}: unsupported ${corner} terrain ${terrain}`);
      return (bits << 1) | Number(terrain === 'upper');
    }, 0);
    const row = pattern >> 2;
    const col = pattern & 3;
    const tileKey = `${row},${col}`;
    assert.ok(!occupied.has(tileKey), `${theme.id}: duplicate tile position ${tileKey}`);
    occupied.add(tileKey);
    const base64 = tile.image.base64.replace(/^data:image\/png;base64,/, '');
    const image = decodePng(Buffer.from(base64, 'base64'));
    assert.equal(image.width, tileSize, `${theme.id}/${tile.name}: wrong tile width`);
    assert.equal(image.height, tileSize, `${theme.id}/${tile.name}: wrong tile height`);
    for (let y = 0; y < tileSize; y += 1) {
      const source = y * tileSize * 4;
      const dest = ((row * tileSize + y) * sheetSize + col * tileSize) * 4;
      image.rgba.copy(sheet, dest, source, source + tileSize * 4);
    }
    const name = `TILE_${row}_${col}`;
    frameRows[name] = [{ x: col * tileSize, y: row * tileSize, w: tileSize, h: tileSize }];
    animationRows[name] = { row, frames: 1, fps: 1, loop: false };
    tileMetadata.push({ name: tile.name, atlas_index: pattern, atlas_position: { row, col }, original_position: tile.original_position, corners: tile.corners });
  }
  assert.equal(tileMetadata.length, 16);

  const source = join(ROOT, 'assets', 'sprites', 'generated', `sos-terrain-${theme.id}`);
  const runtime = join(ROOT, 'frontend', 'public', 'sprites', `sos-terrain-${theme.id}`);
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'sprite-sheet-alpha.png'), encodePng(sheetSize, sheetSize, sheet));
  writeFileSync(join(source, 'wang-tiles.json'), `${JSON.stringify({ theme: theme.id, tile_size: tileSize, columns: 4, rows: 4, tiles: tileMetadata, metadata: result.metadata }, null, 2)}\n`);
  writeFileSync(join(source, 'manifest.json'), `${JSON.stringify({
    game_input: 'sos',
    degraded_static_fallback: false,
    animation: { rows: animationRows },
    frame_layout: { rows: frameRows, sheetWidth: sheetSize, sheetHeight: sheetSize, cellWidth: tileSize, cellHeight: tileSize },
  }, null, 2)}\n`);
  mkdirSync(dirname(runtime), { recursive: true });
  mkdirSync(runtime, { recursive: true });
  for (const file of ['sprite-sheet-alpha.png', 'manifest.json']) {
    copyFileSync(join(source, file), join(runtime, file));
  }
  console.log(`${theme.id}: assembled 16 tiles into ${source}`);
}

async function collect() {
  const jobs = readJobs();
  for (const theme of THEMES) {
    const job = jobs[theme.id];
    if (!job?.tileset_id) {
      console.log(`${theme.id}: no job recorded`);
      continue;
    }
    const result = await request('GET', `/tilesets/${job.tileset_id}`);
    if (result.pending || result.retry) {
      console.log(`${theme.id}: still processing`);
      continue;
    }
    assemble(theme, result);
    job.status = 'completed';
    job.completed_at = new Date().toISOString();
    saveJobs(jobs);
  }
}

function selfCheck() {
  const pixels = Buffer.from(Array.from({ length: 32 * 32 * 4 }, (_, i) => (i * 17) & 255));
  const roundTrip = decodePng(encodePng(32, 32, pixels));
  assert.deepEqual(roundTrip.rgba, pixels);
  console.log('SoS biome PNG self-check passed');
}

const command = process.argv[2];
if (command === 'generate') await generate();
else if (command === 'collect') await collect();
else if (command === 'self-check') selfCheck();
else console.log('Usage: node scripts/sprite-gen/sos-biomes.mjs <generate|collect|self-check>');
