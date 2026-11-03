// Which pixelfx effects we ship, and at what frame rate.
//
// Every entry renders to frontend/public/sprites/vfx/<slug>/ and can be used by
// any game in this app: the manifest is engine-agnostic (a horizontal strip plus
// frame metadata), so SOS animates it with CSS steps() and Outlands slices it
// into PIXI textures.
//
// Add an effect by copying the upstream id from:
//   node vendor/pixelfx/tools/list.mjs
// then run:
//   npm run vfx -- <slug>          # just this one
//   npm run vfx                    # every entry

export const EFFECTS = [
  // ── Square of Shadows ──────────────────────────────────────────────────────
  // Sized by `sosPx` in the SOS sprite map; these effects are authored at
  // 100-300 px, so they are shown large relative to a 48 px tile.
  { slug: 'slash', effect: 'melee/sword-slash', fps: 20, loop: false },
  { slug: 'fireball', effect: 'fire/fireball', fps: 20, loop: true },
  { slug: 'thunder-strike', effect: 'lightning/lightning-strike', fps: 20, loop: false },
  { slug: 'frost-nova', effect: 'ice/frost-nova', fps: 20, loop: false },
  { slug: 'heal', effect: 'holy/heal', fps: 20, loop: false },
  { slug: 'heal-aoe', effect: 'holy/heal-aoe', fps: 20, loop: false },
  { slug: 'holy-pillar', effect: 'holy/holy-pillar', fps: 20, loop: false },
  { slug: 'earth-spike', effect: 'nature/earth-spike', fps: 20, loop: false },
  { slug: 'ground-slam', effect: 'impacts/ground-slam', fps: 20, loop: false },
  { slug: 'holy-smite', effect: 'holy/smite', fps: 12, loop: false },
  { slug: 'divine-shield', effect: 'holy/divine-shield', fps: 16, loop: true },
  { slug: 'vine-whip', effect: 'nature/vine-whip', fps: 20, loop: false },
  { slug: 'root-snare', effect: 'nature/root-snare', fps: 20, loop: false },
  { slug: 'curse', effect: 'shadow/curse', fps: 16, loop: false },
  { slug: 'poisoned', effect: 'status/poisoned', fps: 16, loop: true },

  // ── Outlands (zombie shooter) ─────────────────────────────────────────────
  { slug: 'muzzle-pistol', effect: 'projectiles/muzzle-pistol', fps: 24, loop: false },
  { slug: 'muzzle-shotgun', effect: 'projectiles/muzzle-shotgun', fps: 24, loop: false },
  { slug: 'muzzle-smg', effect: 'projectiles/muzzle-smg', fps: 24, loop: true },
  { slug: 'bullet-impact', effect: 'impacts/bullet-impact', fps: 20, loop: false },
  { slug: 'hit-spark', effect: 'impacts/hit-spark', fps: 20, loop: false },
  { slug: 'crit-hit', effect: 'impacts/crit-hit', fps: 20, loop: false },
  { slug: 'bleeding', effect: 'status/bleeding', fps: 16, loop: true },
];
