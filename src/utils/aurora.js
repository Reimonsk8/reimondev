// Procedural aurora blobs.
//
// Phase origins are deliberately fixed in App.css. These variables only alter
// the sizes, stop positions, and opacity of the surrounding corona/ribbons.
// Re-roll the incoming phase while it is transparent, before its crossfade.
//
// Standard geometry ranges are percentages of the layer box; keys ending in
// "o" are alphas. Desktop C also gets phase-local pixel radii, clamped to its
// viewport envelope so wide screens still produce a compact eclipse.

const RANGES = {
  // A: fixed top-centre beam with variable ribbon/beam edge spreads.
  a: {
    bw: [48, 66], bh: [18, 30], bo: [0.07, 0.13],
    b1w: [30, 48], b1h: [10, 22], b1o: [0.035, 0.085],
    b2w: [28, 46], b2h: [9, 20], b2o: [0.03, 0.075],
  },
  // B: stable eclipse shadow, variable vignette and off-axis atmospheric edges.
  b: {
    gw: [42, 68], gh: [22, 42], go: [0.035, 0.09],
    vw: [34, 52], vh: [92, 132],
    sw: [42, 52], sh: [23, 32], so: [0.62, 0.82],
    l1w: [24, 42], l1h: [12, 26], l1o: [0.025, 0.065],
    l2w: [22, 40], l2h: [10, 24], l2o: [0.02, 0.055],
  },
  // C: fixed umbra; only the corona's spread, thickness, and edge lobes vary.
  c: {
    rw: [52, 72], rh: [25, 40], o: [0.18, 0.26],
    rs: [42, 47], rp: [49, 54], re: [68, 78],
    gw: [68, 88], gh: [38, 58], go: [0.025, 0.06],
    l1w: [3.5, 8.5], l1h: [7, 12], l1o: [0.025, 0.07],
    l2w: [3.5, 8.5], l2h: [7, 12], l2o: [0.02, 0.06],
    l3w: [5, 10], l3h: [5, 9], l3o: [0.015, 0.05],
  },
};

const rand = (min, max) => min + Math.random() * (max - min);

export function randomAuroraVars(phase) {
  const ranges = RANGES[phase];
  const vars = {};

  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = rand(min, max);
    vars[`--${phase}-${key}`] = key.endsWith('o')
      ? value.toFixed(3)
      : `${value.toFixed(1)}%`;
  }

  // CSS calc() does not support number-by-number multiplication in gradient
  // alpha stops across target browsers, so precompute this derived opacity.
  if (phase === 'c') {
    vars['--c-ro'] = (Number(vars['--c-o']) * 0.38).toFixed(3);

    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      const height = window.innerHeight;
      const layerHeight = height * 1.08;
      // The scale animation peaks at 1.045; leave enough margin so the
      // visible ellipse remains <= 550px wide and <= 50vh tall.
      const ringRadius = rand(0.92, 1) * Math.min(275, height * 0.25);
      const lobeRadius = (centerY, low, high) => {
        const remainingRadius = Math.max(12, ringRadius - Math.abs(centerY - 0.08) * layerHeight);
        return `${rand(remainingRadius * low, remainingRadius * high).toFixed(1)}px`;
      };

      vars['--c-desktop-ring-size'] = `${ringRadius.toFixed(1)}px`;
      // Keep the umbra compact so the larger silver corona remains visible
      // beyond the eclipse instead of being swallowed by its dark falloff.
      vars['--c-desktop-shadow-size'] = `${(ringRadius * 0.52).toFixed(1)}px`;
      vars['--c-desktop-l1w'] = lobeRadius(0.06, 0.52, 0.82);
      vars['--c-desktop-l1h'] = lobeRadius(0.06, 0.42, 0.68);
      vars['--c-desktop-l2w'] = lobeRadius(0.11, 0.48, 0.78);
      vars['--c-desktop-l2h'] = lobeRadius(0.11, 0.42, 0.68);
      vars['--c-desktop-l3w'] = `${rand(Math.max(12, ringRadius * 0.3), ringRadius * 0.56).toFixed(1)}px`;
      vars['--c-desktop-l3h'] = lobeRadius(0.18, 0.4, 0.7);

    }
  }

  return vars;
}

export function initialAuroraVars() {
  return {
    ...randomAuroraVars('a'),
    ...randomAuroraVars('b'),
    ...randomAuroraVars('c'),
  };
}

// Aurora Lab helper: multiply every alpha var (keys ending in "o") by an
// intensity factor. --c-ro is derived from --c-o, so it is recomputed instead
// of scaled directly, matching randomAuroraVars above.
export function scaleAuroraAlphas(vars, intensity) {
  if (!Number.isFinite(intensity) || intensity === 1) return vars;

  const out = {};
  for (const [key, value] of Object.entries(vars)) {
    if (key === '--c-ro') continue;
    out[key] = key.endsWith('o')
      ? Math.min(1, Number(value) * intensity).toFixed(3)
      : value;
  }
  if (out['--c-o'] !== undefined) {
    out['--c-ro'] = (Number(out['--c-o']) * 0.38).toFixed(3);
  }
  return out;
}
