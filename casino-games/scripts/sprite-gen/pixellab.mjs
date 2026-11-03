/**
 * Generate Square of Shadows art through the PixelLab REST API.
 *
 * Outputs land in `assets/sprites/generated/sos-pixellab/`, which the existing
 * `scripts/copy-sprites.mjs` step already sweeps into `frontend/public/sprites/`.
 * Nothing here is imported by the app at runtime and nothing here runs during a
 * build: the PNGs are committed, and regenerating is always a deliberate act.
 *
 * Commands
 *   balance            free — generations left in the plan
 *   plan [target...]   free — list what `run` would generate and what it costs
 *   run <target...>    SPENDS GENERATIONS. Requires the target names explicitly.
 *   status             free — poll the jobs recorded in state.json
 *
 * The quota is counted in generations, not dollars, and cannot be refunded, so
 * `plan` and `balance` are the default path and `run` is never implicit.
 *
 * Cost control, in one place, because this is the part that actually matters:
 *   - Characters are created in *standard* mode (1 generation). Pro is 10-25 and
 *     v3 is 2-9, which would consume the entire trial on a single class.
 *   - Animations pass `directions: ['south']`. A generation is billed *per
 *     direction*, so rotating a top-down unit that only ever faces the viewer
 *     would cost 8x for sprites the game never draws.
 *   - Animation states use template animations, which are 1 generation each.
 *
 * Usage:
 *   node scripts/sprite-gen/pixellab.mjs plan
 *   node scripts/sprite-gen/pixellab.mjs run classes
 *   node scripts/sprite-gen/pixellab.mjs run animations --force
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'assets', 'sprites', 'generated', 'sos-pixellab');
const STATE = join(OUT, 'state.json');
const API = 'https://api.pixellab.ai/v2';

/** Where the API key comes from, in order. Never a literal in this file. */
function apiKey() {
  if (process.env.PIXELLAB_API_KEY) return process.env.PIXELLAB_API_KEY;
  const env = join(ROOT, '.env');
  if (existsSync(env)) {
    for (const line of readFileSync(env, 'utf8').split('\n')) {
      const m = line.match(/^\s*PIXELLAB_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  }
  throw new Error(
    'PIXELLAB_API_KEY not set.\n' +
      '  cp .env.example .env   then paste the key from https://pixellab.ai/account',
  );
}

/** The API's observed minimum successful submission gap is about 15 seconds. */
const THROTTLE_MS = 15_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastSubmit = 0;

async function call(method, path, body, attempt = 0) {
  if (body) {
    const gap = Date.now() - lastSubmit;
    if (lastSubmit && gap < THROTTLE_MS) await sleep(THROTTLE_MS - gap);
    lastSubmit = Date.now();
  }

  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  // 429 is a throttle, not a failure: the request never started, so nothing was
  // charged and sending the identical request again is safe.
  if (res.status === 429) {
    if (attempt >= 4) throw new Error('still rate limited after 5 tries — nothing charged, re-run later');
    const wait = 15000 * (attempt + 1);
    console.log(`  rate limited, retrying in ${Math.round(wait / 1000)}s (nothing charged)`);
    await sleep(wait);
    return call(method, path, body, attempt + 1);
  }
  if (!res.ok) {
    // 402 is the one that matters: out of generations.
    if (res.status === 402) throw new Error('out of generations (402) — top up or wait for the trial reset');
    throw new Error(`${method} ${path} -> ${res.status}\n${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

// ── the art we want ──────────────────────────────────────────────────────────
//
// Edit this table, not the code. Each entry's cost is noted because it is the
// thing that decides whether a run is affordable.

/**
 * The four playable classes. `size` is the canvas; PixelLab stores the character
 * at ~40% larger so animations have room, so the sheet ends up bigger than this.
 */
const CLASSES = [
  {
    id: 'warrior',
    description:
      'corrupted dark knight, blackened plate armor with skull motifs and spikes, ' +
      'glowing red eyes behind a horned helm, massive cursed greatsword dripping blood, ' +
      'dark demonic warrior, gothic horror, Diablo style, low top-down 3/4 view, ' +
      'single colour black outline',
  },
  {
    id: 'wizard',
    description:
      'dark sorcerer, tattered black robes with glowing purple runes and torn edges, ' +
      'skeletal hands, horned skull mask, cursed staff with a glowing green orb, ' +
      'evil warlock, gothic horror, Castlevania style, low top-down 3/4 view, ' +
      'single colour black outline',
  },
  {
    id: 'cleric',
    description:
      'corrupted priest, dark hooded robes with inverted cross and bone trim, pale ' +
      'undead skin, blood-stained vestments, cursed holy relic weapon glowing green, ' +
      'gothic horror, vampire hunter turned dark, low top-down 3/4 view, ' +
      'single colour black outline',
  },
  {
    id: 'ranger',
    description:
      'dark hunter, black leather armor and tattered cloak, skull mask covering face, ' +
      'poisoned arrows, blood-stained quiver, gothic stalker, horror, ' +
      'low top-down 3/4 view, single colour black outline',
  },
  // ── Faction B — The Penitent Court (counterpart heroes, Blasphemous-style
  // dark-martyr inquisition aesthetic). Same class roles mirrored:
  // templar~warrior, confessor~wizard, martyr~cleric, penitent~ranger.
  {
    id: 'templar',
    description:
      'dark inquisition templar, thorned iron plate armor over ash-grey tabard, ' +
      'great helm reliquary with cracked gold leaf, iron thorns coiled around a heavy ' +
      'flail, penitent crusader, Blasphemous style, gothic horror, ' +
      'low top-down 3/4 view, single colour black outline',
  },
  {
    id: 'confessor',
    description:
      'hooded inquisitor confessor, tattered black cassock with bone trim, golden ' +
      'censer on chains trailing ember smoke, featureless reliquary mask, ' +
      'dark holy inquisitor, Blasphemous style, gothic horror, ' +
      'low top-down 3/4 view, single colour black outline',
  },
  {
    id: 'martyr',
    description:
      'weeping saint martyr, bloodied white shroud, broken halo of twisted gold, ' +
      'candles burning on the shoulders, iron nail scars, dark religious martyr, ' +
      'Blasphemous style, gothic horror, low top-down 3/4 view, single colour black outline',
  },
  {
    id: 'penitent',
    description:
      'cowled flagellant penitent, chained hood hiding the face, iron hook and barbed ' +
      'rope whip, torn grey habits, grotesque holy zealot, Blasphemous style, ' +
      'gothic horror, low top-down 3/4 view, single colour black outline',
  },
];

/**
 * Animation states, 1 generation per direction in template mode.
 *
 * Template ids come from PixelLab's humanoid template list. They are generic
 * martial-arts poses, so they read as "a fighter moves" rather than as the exact
 * class fantasy — that trade is deliberate: a custom v3 animation of the same
 * quality costs several generations each, and there is not enough quota for 16
 * of them. Swap an entry for `action_description` + `mode: 'v3'` if a class ever
 * earns a bespoke animation.
 */
const STATES = [
  { id: 'idle', template_animation_id: 'breathing-idle' },
  { id: 'attack', template_animation_id: 'cross-punch' },
  { id: 'cast', template_animation_id: 'fireball' },
  { id: 'death', template_animation_id: 'falling-back-death' },
  // Frame counts across the five states must total SPRITE_TOTAL (27) and keep
  // engine/art.test.ts STATE_OFFSET: 4+6+6+7+4.
  { id: 'walk', template_animation_id: 'walking-4-frames' },
];

/**
 * Ability icons. These come from `create-image-pixflux`, which returns base64
 * inline, so they cost one request and never need polling.
 */
const ICONS = [
  { id: 'fireball', description: 'pixel art game ability icon, a hellfire ball bursting in dark red and black flame, demonic, transparent background, bold readable silhouette' },
  { id: 'thunder-strike', description: 'pixel art game ability icon, a dark lightning bolt striking down, purple and black, necromantic energy, transparent background, bold readable silhouette' },
  { id: 'ice-wall', description: 'pixel art game ability icon, a wall of jagged black ice with purple frost, dark frozen, transparent background, bold readable silhouette' },
  { id: 'bless-ground', description: 'pixel art game ability icon, a dark unholy aura with red and black energy, cursed ground, transparent background, bold readable silhouette' },
  { id: 'trap', description: 'pixel art game ability icon, a spiked iron floor trap with blood stains, dark steel, horror, transparent background, bold readable silhouette' },
  { id: 'grapple', description: 'pixel art game ability icon, a hooked chain with skull pendant, dark iron and bone, gothic, transparent background, bold readable silhouette' },
  { id: 'attack-warrior', description: 'pixel art action icon for a warrior attack, heavy sword sweeping through a red slash arc, dark iron, transparent background, bold readable silhouette' },
  { id: 'attack-wizard', description: 'pixel art action icon for a wizard attack, sharp arcane bolt bursting from a small violet star, dark magic, transparent background, bold readable silhouette' },
  { id: 'attack-cleric', description: 'pixel art action icon for a cleric attack, relic mace striking with a small gold-white flare, dark fantasy, transparent background, bold readable silhouette' },
  { id: 'attack-ranger', description: 'pixel art action icon for a ranger attack, black arrow flying from a compact bow with a teal streak, transparent background, bold readable silhouette' },
  { id: 'shield-slam', description: 'pixel art game ability icon, a heavy iron shield striking stone with a red impact burst, dark steel, transparent background, bold readable silhouette' },
  { id: 'class-warrior', description: 'pixel art class icon, closed iron warrior helm with a small sword crest, dark steel and muted red, transparent background, bold readable silhouette' },
  { id: 'class-wizard', description: 'pixel art class icon, pointed sorcerer hood and tiny star, dark violet and bone, transparent background, bold readable silhouette' },
  { id: 'class-cleric', description: 'pixel art class icon, reliquary cross with a small emerald gem, dark gold and teal, transparent background, bold readable silhouette' },
  { id: 'class-ranger', description: 'pixel art class icon, compact recurved bow over a feathered arrow, dark green and bone, transparent background, bold readable silhouette' },
  { id: 'move', description: 'pixel art movement icon, two boot prints stepping diagonally across a dark stone tile, muted teal, transparent background, bold readable silhouette' },
];

const TARGETS = {
  classes: { label: 'character sheets', cost: CLASSES.length, unit: 'gen' },
  animations: { label: 'animation states', cost: CLASSES.length * STATES.length, unit: 'gen' },
  icons: { label: 'ability icons', cost: ICONS.length, unit: 'gen' },
};

// ── local state ──────────────────────────────────────────────────────────────

const loadState = () =>
  existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { characters: {}, done: {} };

function saveState(state) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
}

const outDir = (name) => join(OUT, name);

function alreadyHave(name, force) {
  return !force && existsSync(join(outDir(name), 'sprite-sheet-alpha.png'));
}

const writePng = (name, base64) => {
  const dir = outDir(name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sprite-sheet-alpha.png'), Buffer.from(base64, 'base64'));
};

// ── commands ─────────────────────────────────────────────────────────────────

/**
 * Record what a call actually cost.
 *
 * `GET /balance` reports the plan *allowance* (`generations` and `total` both come
 * back as 40 on a fresh trial and stay there after a generation is charged), so it
 * cannot be used to track spend. Every generation response carries the real figure
 * in `usage.generations`, so the ledger is built from those instead.
 */
function recordUsage(state, usage, label) {
  const gen = usage?.generations ?? 0;
  state.spent = (state.spent ?? 0) + gen;
  state.log = state.log ?? [];
  state.log.push({ at: new Date().toISOString(), label, generations: gen });
  saveState(state);
  return gen;
}

/** Per-request generation spend, for an accurate remaining figure. */
function remaining(state) {
  const allowance = state.allowance ?? null;
  if (allowance === null) return 'unknown (run `allowance`)';
  return `${Math.max(0, allowance - (state.spent ?? 0))} of ${allowance}`;
}

/**
 * Character creation is capacity-capped on the free tier at times. It fails a
 * second after submitting and charges nothing, but the message only appears on the
 * background job, not on the character record.
 */
const TIER_LIMITED = 'temporarily limit free tier';

async function balance() {
  const b = await call('GET', '/balance');
  const sub = b?.subscription;
  const state = loadState();
  if (sub?.total != null) {
    state.allowance = sub.total;
    saveState(state);
  }
  console.log(`plan: ${sub?.type ?? 'unknown'}`);
  console.log(`allowance: ${sub?.total ?? '?'} generations per month`);
  console.log(`spent (from this repo's ledger): ${state.spent ?? 0}`);
  console.log(`remaining: ${remaining(state)}`);
  console.log(`credits: ${b?.credits?.type} ${b?.credits?.usd ?? 'n/a'}`);
  console.log(
    '\nnote: the API\'s own generations counter reports the allowance, not what is\n' +
      'left, so the remaining figure above is tracked from per-response usage.',
  );
}

/** Read a background job and surface the real error, which the record omits. */
async function jobError(jobId) {
  try {
    const job = await call('GET', `/background-jobs/${jobId}`);
    return job?.last_response?.error ?? job?.last_response?.detail ?? null;
  } catch {
    return null;
  }
}

function plan(only) {
  const state = loadState();
  const names = only.length ? only : Object.keys(TARGETS);
  let total = 0;
  for (const name of names) {
    const t = TARGETS[name];
    if (!t) {
      console.log(`unknown target: ${name} (have: ${Object.keys(TARGETS).join(', ')})`);
      continue;
    }
    console.log(`\n${name} — ${t.label}  [${t.cost} ${t.unit}]`);
    if (name === 'classes') {
      for (const c of CLASSES) {
        const have = state.characters[c.id]?.character_id;
        const cached = alreadyHave(`sos-${c.id}`, false);
        console.log(
          `  ${c.id.padEnd(8)} ${have ? `character_id ${have}` : 'new character'}` +
            `${cached ? '  (sheet on disk, use --force to redo)' : ''}`,
        );
      }
    }
    if (name === 'animations') {
      for (const c of CLASSES) {
        const cid = state.characters[c.id]?.character_id;
        console.log(
          `  ${c.id.padEnd(8)} ${STATES.map((s) => s.id).join(', ')}` +
            `${cid ? '' : '   (blocked: no character_id yet)'}`,
        );
      }
    }
    if (name === 'icons') {
      for (const i of ICONS) {
        console.log(`  ${i.id.padEnd(16)}${alreadyHave(`icon-${i.id}`, false) ? '  (cached)' : ''}`);
      }
    }
    total += t.cost;
  }
  console.log(`\nestimated: ${total} generations`);
  console.log('nothing above has been generated. `run` is what spends them.');
}

/** Create one character. Standard mode, 4 directions — we only draw south. */
async function makeClass(def, state, force) {
  const name = `sos-${def.id}`;
  // Never re-queue a character that already has an id — even if the sheet
  // has not landed yet, calling create again would burn another generation on a
  // duplicate. Poll with `status` instead.
  if (state.characters[def.id]?.character_id) {
    console.log(`  ${def.id}: already queued (${state.characters[def.id].character_id}), skipping`);
    return 'queued';
  }
  if (alreadyHave(name, force)) return 'cached';

  const res = await call('POST', '/create-character-with-4-directions', {
    description: def.description,
    image_size: { width: 48, height: 48 },
    outline: 'single color black outline',
    shading: 'basic shading',
    detail: 'medium detail',
    view: 'low top-down',
    template_id: 'mannequin',
    seed: 0,
  });
  state.characters[def.id] = {
    character_id: res.character_id,
    background_job_id: res.background_job_id,
    status: res.status,
    queued: new Date().toISOString(),
  };
  saveState(state);
  const gen = recordUsage(state, res.usage, `class:${def.id}`);
  console.log(`  ${def.id}: queued ${res.character_id}${gen ? ` (${gen} gen)` : ''}`);
  return 'queued';
}

/** One animation state, one direction. 1 generation. */
async function makeAnimation(cls, st, state, force) {
  const cid = state.characters[cls.id]?.character_id;
  if (!cid) {
    console.log(`  ${cls.id}/${st.id}: SKIPPED — run \`classes\` first`);
    return 'skipped';
  }
  // A queued animation already has a real group id; re-queueing would burn another
  // generation on a duplicate (character creates guard this, animations didn't).
  // Legacy state entries used "?" as an unknown placeholder — not a real id.
  const prior = state.done[`${cls.id}/${st.id}`]?.animation_group_id;
  if (prior && prior !== '?' && !force) {
    console.log(`  ${cls.id}/${st.id}: already queued (${prior}), skipping`);
    return 'queued';
  }
  const res = await call('POST', '/animate-character', {
    character_id: cid,
    template_animation_id: st.template_animation_id,
    // The whole reason this is affordable: a generation is billed per direction,
    // and a top-down grid unit only ever faces the viewer.
    directions: ['south'],
    mode: 'template',
  });
  const gid = res.animation_group_id;
  const entry = state.done[`${cls.id}/${st.id}`] ?? {};
  entry.animation_group_id = gid;
  entry.background_job_ids = res.background_job_ids ?? null;
  entry.queued = new Date().toISOString();
  state.done[`${cls.id}/${st.id}`] = entry;
  saveState(state);
  const gen = recordUsage(state, res.usage, `anim:${cls.id}/${st.id}`);
  console.log(`  ${cls.id}/${st.id}: queued ${gid}${gen ? ` (${gen} gen)` : ''}`);
  return 'queued';
}

/** Ability icon. pixflux returns base64 inline, so this is a single request. */
async function makeIcon(def) {
  const name = `icon-${def.id}`;
  const res = await call('POST', '/create-image-pixflux', {
    description: def.description,
    // Required by the schema, though the current model ignores it.
    negative_description: '',
    image_size: { width: 32, height: 32 },
    no_background: true,
    outline: 'single color outline',
    shading: 'basic shading',
    detail: 'medium detail',
    view: 'high top-down',
  });
  writePng(name, res.image.base64);
  const state = loadState();
  writeFileSync(
    join(outDir(name), 'manifest.json'),
    `${JSON.stringify({ game_input: 'sos', prompt: def.description, usage: res.usage ?? null }, null, 2)}\n`,
  );
  const gen = recordUsage(state, res.usage, `icon:${def.id}`);
  console.log(`  ${def.id}: written${gen ? ` (${gen} gen)` : ''}`);
  return 'done';
}

/** Poll everything we have queued. Free — status checks are not generations. */
async function status() {
  const state = loadState();
  let pending = 0;
  for (const [id, rec] of Object.entries(state.characters)) {
    const c = await call('GET', `/characters/${rec.character_id}`);
    const rotations = c?.rotation_urls ?? {};
    const done = Object.keys(rotations).length;
    console.log(`  ${id.padEnd(8)} ${c?.status}  rotations ${done}/4`);
    if (c?.status === 'completed') {
      mkdirSync(outDir(`sos-${id}`), { recursive: true });
      writeFileSync(
        join(outDir(`sos-${id}`), 'character.json'),
        `${JSON.stringify(c, null, 2)}\n`,
      );
      // Downloads need no auth: the id is the key. Only south is fetched — the
      // unit always faces the viewer in this game.
      const south = c?.rotation_urls?.south;
      if (south) {
        const res = await fetch(south);
        if (res.ok) {
          writePng(`sos-${id}`, Buffer.from(await res.arrayBuffer()).toString('base64'));
          console.log(`           south sprite saved`);
        }
      }
    } else if (c?.status === 'failed' && rec.background_job_id) {
      // The character record carries no reason; the job does.
      const why = await jobError(rec.background_job_id);
      console.log(`           ${why ?? 'failed (no reason reported)'}`);
      if (why && why.includes(TIER_LIMITED)) {
        console.log('           -> free tier is capacity-limited right now; retry later, nothing charged');
      }
    } else {
      pending += 1;
    }
  }
  for (const [key, rec] of Object.entries(state.done)) {
    if (!rec.animation_group_id) continue;
    console.log(`  ${key.padEnd(20)} queued ${rec.animation_group_id}`);
    pending += 1;
  }
  console.log(pending ? `\n${pending} job(s) still in flight — re-run \`status\` in a few minutes.` : '\nnothing pending.');
}

async function run(only, force) {
  const state = loadState();
  const names = only.length ? only : Object.keys(TARGETS);
  console.log('This spends generations. Ctrl-C now to stop.\n');
  for (const name of names) {
    if (name === 'classes') {
      console.log('classes:');
      for (const c of CLASSES) await makeClass(c, state, force);
    } else if (name === 'animations') {
      console.log('animations:');
      for (const c of CLASSES) for (const st of STATES) await makeAnimation(c, st, state, force);
    } else if (name === 'icons') {
      console.log('icons:');
      for (const i of ICONS) {
        if (alreadyHave(`icon-${i.id}`, force)) {
          console.log(`  ${i.id}: cached`);
          continue;
        }
        await makeIcon(i);
      }
    } else {
      console.log(`unknown target: ${name}`);
    }
  }
  console.log('\nDone. `status` reports progress; run `npm run sprites:copy` afterwards.');
}

// ── entry ────────────────────────────────────────────────────────────────────

const [command = 'plan', ...rest] = process.argv.slice(2);
const flags = rest.filter((a) => a.startsWith('--'));
const positional = rest.filter((a) => !a.startsWith('--'));
const force = flags.includes('--force');

const commands = { balance, plan, run, status };
const fn = commands[command];
if (!fn) {
  console.error(`unknown command: ${command}\nusage: ${Object.keys(commands).join(' | ')}`);
  process.exit(1);
}
await fn(positional, force);
