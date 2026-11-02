/**
 * Particle intro engine.
 *
 * The old implementation rebuilt everything on every resize: it re-read a
 * full-resolution ImageData (4 bytes per screen pixel) and started a brand new
 * requestAnimationFrame loop plus two global listeners. None of it was ever
 * torn down, so every resize leaked a loop, a particle array and an ~8 MB
 * pixel buffer.
 *
 * This engine keeps one loop and one particle pool. A resize only:
 *   1. resizes the canvas,
 *   2. scales the current particle positions by the viewport ratio,
 *   3. re-samples the word mask from a small offscreen canvas (1/3 scale),
 *   4. retargets the existing particles (no reset, no visual restart).
 *
 * It also pauses when settled, when the tab is hidden and on destroy.
 */

const TAU = Math.PI * 2;

// The text is only a mask, so sample it at ~1/3 resolution. That cuts the
// ImageData read (and its memory) by ~9x with no visual difference.
const MASK_SCALE = 0.35;
const MASK_STEP = 2;
const MASK_ALPHA = 20;

const MOUSE_RADIUS = 35;
const MOUSE_R2 = MOUSE_RADIUS * MOUSE_RADIUS;
const SPRING = 25;

const RESIZE_DEBOUNCE = 180;
const FRAME_MS = 1000 / 61;

const MAX_PARTICLES_DESKTOP = 3200;
const MAX_PARTICLES_MOBILE = 1600;

// Connections are only visible while particles are displaced (the original
// opacity was distance-to-base / 50), so we skip the O(n²) pass at rest.
const CONNECTION_MIN_SQ = 15 * 15;
const CONNECTION_MAX_SQ = 50 * 50;
const CONNECTION_BUCKETS = 4;

const FONT_STACK = '"Varela Round", "Trebuchet MS", Arial, sans-serif';

const isSmallViewport = () => window.innerWidth * window.innerHeight < 500000;

export const createIntroParticles = (canvas) => {
  if (!canvas) return null;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const mask = document.createElement('canvas');
  const maskCtx = mask.getContext('2d', { willReadFrequently: true });

  const particles = [];
  const mouse = { x: -1e4, y: -1e4 };

  let width = 0;
  let height = 0;
  let rafId = 0;
  let running = false;
  let destroyed = false;
  let resizeTimer = 0;
  let lastMoveAt = -Infinity;
  let lastFrameAt = 0;

  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  const createParticle = (baseX, baseY, startX, startY) => ({
    x: startX,
    y: startY,
    baseX,
    baseY,
    size: Math.random() * 0.5 + (isSmallViewport() ? 1 : 2),
    density: Math.random() * 100 + 1,
    dist: 0,
  });

  /** Render the two words into the small mask canvas and return target points. */
  const buildTargets = () => {
    const mw = Math.max(1, Math.round(width * MASK_SCALE));
    const mh = Math.max(1, Math.round(height * MASK_SCALE));

    mask.width = mw;
    mask.height = mh;
    maskCtx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
    maskCtx.clearRect(0, 0, width, height);
    maskCtx.fillStyle = '#fff';
    maskCtx.textBaseline = 'alphabetic';

    const ch = height / 2;
    const titleVspace = height > width ? 9 : 5;

    maskCtx.font = `${Math.round(width * 0.25)}px ${FONT_STACK}`;
    maskCtx.fillText('REIMON', 5, ch - ch / titleVspace);

    maskCtx.font = `${Math.round(width * 0.1325)}px ${FONT_STACK}`;
    maskCtx.fillText('DEVELOPMENT', 5, ch + ch / titleVspace);

    const data = maskCtx.getImageData(0, 0, mw, mh).data;

    // Count filled mask pixels first so the sampling step can be chosen to hit
    // the particle budget instead of producing 10k+ objects on big screens.
    let filled = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > MASK_ALPHA) filled++;
    }
    if (!filled) return [];

    const max = isSmallViewport() ? MAX_PARTICLES_MOBILE : MAX_PARTICLES_DESKTOP;
    const step = Math.max(MASK_STEP, Math.ceil(Math.sqrt(filled / max)));

    const points = [];
    for (let y = 0; y < mh; y += step) {
      const row = y * mw;
      for (let x = 0; x < mw; x += step) {
        if (data[(row + x) * 4 + 3] > MASK_ALPHA) {
          points.push(x / MASK_SCALE, y / MASK_SCALE);
        }
      }
    }
    return points;
  };

  /** Reuse the existing particle objects; only their targets change. */
  const retarget = (points) => {
    const count = points.length / 2;

    for (let i = 0; i < count; i++) {
      const baseX = points[i * 2];
      const baseY = points[i * 2 + 1];
      const particle = particles[i];

      if (particle) {
        particle.baseX = baseX;
        particle.baseY = baseY;
      } else {
        particles.push(
          createParticle(baseX, baseY, Math.random() * width, Math.random() * height)
        );
      }
    }

    if (particles.length > count) particles.length = count;
  };

  const drawParticles = () => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      ctx.moveTo(p.x + p.size, p.y);
      ctx.arc(p.x, p.y, p.size, 0, TAU);
    }
    // One fill for the whole cloud instead of one per particle.
    ctx.fill();
  };

  /**
   * Draw connections in a few opacity buckets: 4 strokes total instead of a
   * beginPath/stroke pair per pair of particles.
   */
  const drawConnections = () => {
    const n = particles.length;
    const step = n > 2000 ? 6 : 5;
    const paths = [];
    for (let i = 0; i < CONNECTION_BUCKETS; i++) paths.push(new Path2D());

    for (let a = 0; a < n; a += step) {
      const pa = particles[a];

      const bucket = Math.min(
        CONNECTION_BUCKETS - 1,
        Math.floor((pa.dist / 50) * CONNECTION_BUCKETS)
      );
      if (bucket <= 0) continue;
      const path = paths[bucket];

      for (let b = a + step; b < n; b += step) {
        const pb = particles[b];
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > CONNECTION_MIN_SQ && d2 < CONNECTION_MAX_SQ) {
          path.moveTo(pa.x, pa.y);
          path.lineTo(pb.x, pb.y);
        }
      }
    }

    ctx.lineWidth = 1;
    for (let i = 1; i < CONNECTION_BUCKETS; i++) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${(i / CONNECTION_BUCKETS).toFixed(2)})`;
      ctx.stroke(paths[i]);
    }
  };

  const tick = (now) => {
    if (!running || destroyed) return;
    rafId = requestAnimationFrame(tick);

    // Cap at ~60 fps so 120/144 Hz screens don't do twice the work.
    if (now - lastFrameAt < FRAME_MS) return;
    lastFrameAt = now;

    ctx.clearRect(0, 0, width, height);

    let moving = false;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const d2 = dx * dx + dy * dy;

      if (d2 < MOUSE_R2 && d2 > 0.0001) {
        const distance = Math.sqrt(d2);
        const force = (MOUSE_RADIUS - distance) / MOUSE_RADIUS;
        p.x -= (dx / distance) * force * p.density;
        p.y -= (dy / distance) * force * p.density;
      } else {
        p.x -= (p.x - p.baseX) / SPRING;
        p.y -= (p.y - p.baseY) / SPRING;
      }

      const bx = p.x - p.baseX;
      const by = p.y - p.baseY;
      const baseDistSq = bx * bx + by * by;
      p.dist = Math.sqrt(baseDistSq);
      if (baseDistSq > 1) moving = true;
    }

    drawParticles();

    const pointerActive = now - lastMoveAt < 1600;
    if (moving || pointerActive) drawConnections();

    // Nothing left to animate: stop the loop until the pointer or a resize
    // wakes it up again.
    if (!moving && !pointerActive) {
      running = false;
      cancelAnimationFrame(rafId);
    }
  };

  const start = () => {
    if (destroyed || running) return;
    running = true;
    lastFrameAt = 0;
    rafId = requestAnimationFrame(tick);
  };

  const stop = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const drawStatic = () => {
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x = p.baseX;
      p.y = p.baseY;
      p.dist = 0;
    }
    drawParticles();
  };

  /** Resize + retarget in place. This is the only work a resize does now. */
  const applySize = () => {
    const nextWidth = Math.max(1, window.innerWidth);
    const nextHeight = Math.max(1, window.innerHeight);

    const rx = width ? nextWidth / width : 1;
    const ry = height ? nextHeight / height : 1;

    width = nextWidth;
    height = nextHeight;
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);

    if (rx !== 1 || ry !== 1) {
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x *= rx;
        p.y *= ry;
        p.baseX *= rx;
        p.baseY *= ry;
      }
    }

    retarget(buildTargets());

    if (reduceMotion) {
      drawStatic();
      return;
    }

    lastMoveAt = -Infinity;
    start();
  };

  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = 0;
      applySize();
    }, RESIZE_DEBOUNCE);
  };

  const onPointerMove = (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    lastMoveAt = performance.now();
    start();
  };

  const onPointerLeave = () => {
    mouse.x = -1e4;
    mouse.y = -1e4;
    lastMoveAt = performance.now();
    start();
  };

  const onVisibilityChange = () => {
    if (document.hidden) stop();
    else start();
  };

  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('mouseleave', onPointerLeave);
  document.addEventListener('visibilitychange', onVisibilityChange);

  applySize();

  return {
    start,
    stop,
    destroy() {
      destroyed = true;
      stop();
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('mouseleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      particles.length = 0;
      mask.width = 0;
      mask.height = 0;
    },
  };
};
