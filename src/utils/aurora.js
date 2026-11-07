// Procedural aurora blobs.
//
// Each phase owns a set of CSS custom properties (--a-*, --b-*, --c-*) consumed
// by the gradients in styles/App.css. We re-roll the incoming phase's values at
// the exact moment it is fully transparent (right before it fades in), so the
// blob layout is new every cycle without ever visibly snapping mid-transition.
//
// Value ranges are percentages of the layer box; keys ending in "o" are alphas.

const RANGES = {
  // A: pale beam + two silver ribbons.
  a: {
    bx: [38, 62], by: [-6, 3], bw: [42, 62], bh: [14, 26],
    b1x: [12, 44], b1y: [-12, 12], b1w: [24, 46], b1h: [10, 26], b1o: [0.05, 0.13],
    b2x: [56, 88], b2y: [-14, 14], b2w: [22, 44], b2h: [9, 24], b2o: [0.04, 0.12],
  },
  // B: soft top glow + deep vignette.
  b: {
    gx: [32, 68], gy: [-12, 2], gw: [34, 60], gh: [18, 40], go: [0.05, 0.14],
    vx: [30, 70], vy: [-10, 4], vw: [26, 50], vh: [80, 125],
  },
  // C: the holy donut ring.
  c: {
    x: [38, 62], y: [2, 16], rw: [44, 70], rh: [20, 34], o: [0.18, 0.30],
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

  return vars;
}

export function initialAuroraVars() {
  return {
    ...randomAuroraVars('a'),
    ...randomAuroraVars('b'),
    ...randomAuroraVars('c'),
  };
}
