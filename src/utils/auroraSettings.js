// Hidden experimental "Aurora Lab" settings for the ambient eclipse
// background. AuroraLab.js exposes them through a React context; the values
// drive the phase-cycle timing in AuroraBackdrop.js and the --aurora-*
// custom properties consumed by styles/App.css.
//
// Every value mirrors a shipped default, so an untouched lab renders the
// site exactly as before. Everything is clamped on load and on update, so a
// stale or corrupt localStorage entry can never break the background.

export const AURORA_DEFAULTS = {
  speed: 1, // Phase-cycle multiplier: 2 halves the wait between phases.
  crossfadeS: 8, // Crossfade between phases, in seconds.
  holdA: 11, // Fully-visible hold for phase A, in seconds.
  holdB: 10, // Fully-visible hold for phase B, in seconds.
  holdC: 15, // Fully-visible hold for phase C, in seconds.
  drift: 1, // Speed multiplier for the slow drift/breathe keyframes.
  size: 1, // Rendered scale of every aurora layer and the core.
  intensity: 1, // Multiplier on the aurora layers' alpha stops.
  core: 1, // Multiplier on the breathing core's opacity.
  grain: 0.035, // Film-grain opacity.
  paused: false, // Freeze the whole cycle and its animations.
};

const LIMITS = {
  speed: [0.25, 4],
  crossfadeS: [0.5, 20],
  holdA: [2, 60],
  holdB: [2, 60],
  holdC: [2, 60],
  drift: [0.25, 4],
  size: [0.6, 1.8],
  intensity: [0, 2],
  core: [0, 2],
  grain: [0, 0.15],
};

const STORAGE_KEY = 'reimondev.aurora-lab.v1';

export const clampAuroraSettings = (input) => {
  const out = { ...AURORA_DEFAULTS };
  for (const key of Object.keys(AURORA_DEFAULTS)) {
    const fallback = AURORA_DEFAULTS[key];
    if (typeof fallback === 'boolean') {
      out[key] = typeof input[key] === 'boolean' ? input[key] : fallback;
    } else {
      const [min, max] = LIMITS[key];
      const value = Number(input[key]);
      out[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
    }
  }
  return out;
};

export const loadAuroraSettings = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? clampAuroraSettings(JSON.parse(raw)) : { ...AURORA_DEFAULTS };
  } catch {
    // Unavailable (private mode, parse error) — fall back to defaults.
    return { ...AURORA_DEFAULTS };
  }
};

export const saveAuroraSettings = (settings) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable — the lab just won't persist.
  }
};
