/**
 * Particle intro engine (refactored).
 *
 * Visual: deep-black hero with a subtle top-center vignette glow, the rounded
 * "REIMON DEVELOPMENT" webfont mask optically centred in the viewport, and a
 * dense, bright white point cloud.
 *
 * Performance: particle state lives in contiguous Float32Arrays (no per-frame
 * object allocation / GC spikes), the mask is sampled offscreen at ~1/3
 * resolution with a 2x stride, the particle budget is capped, the rAF loop is
 * throttled to ~60 fps and pauses via IntersectionObserver + visibilitychange.
 */
const TAU = Math.PI * 2;

const MASK_SCALE = 0.35;
const MASK_STEP = 2;
const MASK_ALPHA = 16;

const MOUSE_RADIUS = 35;
const MOUSE_R2 = MOUSE_RADIUS * MOUSE_RADIUS;
const SPRING = 25;

const RESIZE_DEBOUNCE = 180;
const FRAME_MS = 1000 / 61;

const MAX_PARTICLES_DESKTOP = 4000;
const MAX_PARTICLES_MOBILE = 2000;

const CONNECTION_MIN_SQ = 15 * 15;
const CONNECTION_MAX_SQ = 50 * 50;
const CONNECTION_BUCKETS = 4;

// Varela Round is self-hosted (see src/index.css) so this is the same face the
// Reimon TSX intro and .skip button use, even on machines without it installed.
const FONT_STACK = '"Varela Round", "Trebuchet MS", Arial, sans-serif';

const isSmallViewport = () => window.innerWidth * window.innerHeight < 500000;

export const createIntroParticles = (canvas) => {
  if (!canvas) return null;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const mask = document.createElement('canvas');
  const maskCtx = mask.getContext('2d', { willReadFrequently: true });

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

  // Contiguous particle buffers (Float32Array) to avoid GC in the frame loop.
  const capacity = MAX_PARTICLES_DESKTOP;
  const xs = new Float32Array(capacity);
  const ys = new Float32Array(capacity);
  const baseXs = new Float32Array(capacity);
  const baseYs = new Float32Array(capacity);
  const sizes = new Float32Array(capacity);
  const densities = new Float32Array(capacity);
  const dists = new Float32Array(capacity);
  let count = 0;

  const initParticle = (i, baseX, baseY, startX, startY) => {
    baseXs[i] = baseX;
    baseYs[i] = baseY;
    xs[i] = startX;
    ys[i] = startY;
    sizes[i] = Math.random() * 0.5 + (isSmallViewport() ? 1 : 2);
    densities[i] = Math.random() * 100 + 1;
    dists[i] = 0;
  };

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
    maskCtx.textAlign = 'center';

    const measureLine = (text, fontSize) => {
      maskCtx.font = `${fontSize}px ${FONT_STACK}`;
      const metrics = maskCtx.measureText(text);
      return {
        ascent: metrics.actualBoundingBoxAscent || fontSize * 0.72,
        descent: metrics.actualBoundingBoxDescent || 0,
        width: metrics.width,
        inkLeft: metrics.actualBoundingBoxLeft || 0,
        inkRight: metrics.actualBoundingBoxRight || metrics.width,
      };
    };

    // Exactly the TSX sizes: 25vw and 13.25vw.
    let fontSizeTop = width * 0.25;
    let fontSizeBottom = width * 0.1325;
    let gap = height * 0.025;
    let topMetrics = measureLine('REIMON', fontSizeTop);
    let bottomMetrics = measureLine('DEVELOPMENT', fontSizeBottom);
    let blockHeight =
      topMetrics.ascent + topMetrics.descent + gap +
      bottomMetrics.ascent + bottomMetrics.descent;

    // The Enter button sits at 80vh (the TSX .bottom-container rule), and the
    // TSX 25vw line is a touch wider than the viewport in Varela Round, so only
    // shrink when needed: 98% width margin and clearance above the button.
    const maxWidth = width * 0.98;
    const inkWidth = Math.max(
      topMetrics.inkLeft + topMetrics.inkRight,
      bottomMetrics.inkLeft + bottomMetrics.inkRight
    );
    const maxHeight = Math.max(
      height * 0.4,
      (height * 0.8 - 24 - height / 2) * 2
    );
    const shrink = Math.min(1, maxWidth / inkWidth, maxHeight / blockHeight);
    if (shrink < 1) {
      fontSizeTop *= shrink;
      fontSizeBottom *= shrink;
      gap *= shrink;
      topMetrics = measureLine('REIMON', fontSizeTop);
      bottomMetrics = measureLine('DEVELOPMENT', fontSizeBottom);
      blockHeight =
        topMetrics.ascent + topMetrics.descent + gap +
        bottomMetrics.ascent + bottomMetrics.descent;
    }

    // Centre on the actual ink box (not on the baseline, which sat high).
    const blockTop = (height - blockHeight) / 2;
    const baselineTop = blockTop + topMetrics.ascent;
    const baselineBottom =
      baselineTop + topMetrics.descent + gap + bottomMetrics.ascent;
    // Side bearings make the advance box and the ink box differ by a few px,
    // so align the ink (what the eye sees) rather than the advance width.
    const inkCentreX = (m) => width / 2 - (m.inkRight - m.inkLeft) / 2;

    maskCtx.font = `${fontSizeTop}px ${FONT_STACK}`;
    maskCtx.fillText('REIMON', inkCentreX(topMetrics), baselineTop);

    maskCtx.font = `${fontSizeBottom}px ${FONT_STACK}`;
    maskCtx.fillText('DEVELOPMENT', inkCentreX(bottomMetrics), baselineBottom);

    const data = maskCtx.getImageData(0, 0, mw, mh).data;

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

  /** Reuse the existing particle buffers; only their targets change. */
  const retarget = (points) => {
    const newCount = points.length / 2;
    const targetCount = Math.min(newCount, capacity);

    for (let i = 0; i < targetCount; i++) {
      const baseX = points[i * 2];
      const baseY = points[i * 2 + 1];
      if (i < count) {
        baseXs[i] = baseX;
        baseYs[i] = baseY;
      } else {
        initParticle(i, baseX, baseY, Math.random() * width, Math.random() * height);
      }
    }
    count = targetCount;
  };

  const drawParticles = () => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const size = sizes[i];
      ctx.moveTo(xs[i] + size, ys[i]);
      ctx.arc(xs[i], ys[i], size, 0, TAU);
    }
    ctx.fill();
  };

  const drawConnections = () => {
    const n = count;
    const step = n > 2000 ? 6 : 5;
    const paths = [];
    for (let i = 0; i < CONNECTION_BUCKETS; i++) paths.push(new Path2D());

    for (let a = 0; a < n; a += step) {
      const paX = xs[a];
      const paY = ys[a];
      const paDist = dists[a];

      const bucket = Math.min(
        CONNECTION_BUCKETS - 1,
        Math.floor((paDist / 50) * CONNECTION_BUCKETS)
      );
      if (bucket <= 0) continue;
      const path = paths[bucket];

      for (let b = a + step; b < n; b += step) {
        const dx = paX - xs[b];
        const dy = paY - ys[b];
        const d2 = dx * dx + dy * dy;
        if (d2 > CONNECTION_MIN_SQ && d2 < CONNECTION_MAX_SQ) {
          path.moveTo(paX, paY);
          path.lineTo(xs[b], ys[b]);
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

    if (now - lastFrameAt < FRAME_MS) return;
    lastFrameAt = now;

    ctx.clearRect(0, 0, width, height);

    let moving = false;
    for (let i = 0; i < count; i++) {
      const dx = mouse.x - xs[i];
      const dy = mouse.y - ys[i];
      const d2 = dx * dx + dy * dy;

      if (d2 < MOUSE_R2 && d2 > 0.0001) {
        const distance = Math.sqrt(d2);
        const force = (MOUSE_RADIUS - distance) / MOUSE_RADIUS;
        xs[i] -= (dx / distance) * force * densities[i];
        ys[i] -= (dy / distance) * force * densities[i];
      } else {
        xs[i] -= (xs[i] - baseXs[i]) / SPRING;
        ys[i] -= (ys[i] - baseYs[i]) / SPRING;
      }

      const bx = xs[i] - baseXs[i];
      const by = ys[i] - baseYs[i];
      const baseDistSq = bx * bx + by * by;
      dists[i] = Math.sqrt(baseDistSq);
      if (baseDistSq > 1) moving = true;
    }

    drawParticles();

    const pointerActive = now - lastMoveAt < 1600;
    if (moving || pointerActive) drawConnections();

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
    for (let i = 0; i < count; i++) {
      xs[i] = baseXs[i];
      ys[i] = baseYs[i];
      dists[i] = 0;
    }
    drawParticles();
  };

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
      for (let i = 0; i < count; i++) {
        xs[i] *= rx;
        ys[i] *= ry;
        baseXs[i] *= rx;
        baseYs[i] *= ry;
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

  // Pause/throttle when the hero canvas scrolls out of view.
  let observer = null;
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!document.hidden) start();
          } else {
            stop();
          }
        }
      },
      { threshold: 0.01 }
    );
    observer.observe(canvas);
  }

  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('mouseleave', onPointerLeave);
  document.addEventListener('visibilitychange', onVisibilityChange);

  applySize();

  // The hero face is a webfont. If it hasn't decoded yet the first mask uses
  // the fallback, so rebuild once Varela Round is actually available (the
  // particles glide into the real letterforms instead of staying on a serif).
  if (document.fonts && document.fonts.load) {
    document.fonts
      .load(`16px ${FONT_STACK}`)
      .then(() => {
        if (!destroyed) applySize();
      })
      .catch(() => {});
  }

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
      if (observer) observer.disconnect();
      count = 0;
      mask.width = 0;
      mask.height = 0;
    },
  };
};