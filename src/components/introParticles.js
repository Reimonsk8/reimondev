/**
 * Particle intro engine (refactored).
 *
 * Visual: deep-black hero with a subtle top-center vignette glow, the
 * "REIMON DEVELOPMENT" Times New Roman mask, and a
 * dense, bright white point cloud.
 *
 * Performance: particle state lives in contiguous Float32Arrays, connection
 * candidates are spatially indexed, and the rAF loop pauses when settled or
 * hidden.
 */
import {
  createCanvas2DRenderer,
  createWebGLRenderer,
  LINE_BUCKETS,
  MAX_CONNECTIONS,
} from './introParticleRenderers';
import { createAdaptiveQualityController, getInitialQualityIndex } from './introParticleQuality';

const MASK_SCALE = 0.35;
const MASK_STEP = 1;
const MASK_ALPHA = 16;

const MOUSE_RADIUS = 35;
const MOUSE_R2 = MOUSE_RADIUS * MOUSE_RADIUS;
const SPRING = 25;

const RESIZE_DEBOUNCE = 180;
const FRAME_MS = 1000 / 61;

const MAX_PARTICLES_DESKTOP = 5000;
const MAX_PARTICLES_MOBILE = 2500;

const CONNECTION_MIN_SQ = 15 * 15;
const CONNECTION_MAX_SQ = 50 * 50;
const CONNECTION_CELL_SIZE = 50;
const METRICS_INTERVAL_MS = 250;
const METRICS_HISTORY_SIZE = 120;

// Match the site's global intro typography.
const FONT_STACK = '"Times New Roman"';

const isSmallViewport = () => window.innerWidth * window.innerHeight < 500000;

export const createIntroParticles = (canvas, rendererType = '2d', onMetrics = () => {}) => {
  if (!canvas) return null;

  const capacity = MAX_PARTICLES_DESKTOP;
  const renderer = rendererType === 'webgl'
    ? createWebGLRenderer(canvas, capacity)
    : createCanvas2DRenderer(canvas);
  if (!renderer) return null;

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
  let minTargetX = 0;
  let maxTargetX = 0;
  let minTargetY = 0;
  let maxTargetY = 0;

  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  const qualityController = createAdaptiveQualityController(getInitialQualityIndex({
    isMobile: isSmallViewport(),
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    deviceMemory: navigator.deviceMemory || 0,
  }));
  let quality = qualityController.level;
  const basePixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

  // Contiguous particle buffers (Float32Array) to avoid GC in the frame loop.
  const xs = new Float32Array(capacity);
  const ys = new Float32Array(capacity);
  const baseXs = new Float32Array(capacity);
  const baseYs = new Float32Array(capacity);
  const sizes = new Float32Array(capacity);
  const densities = new Float32Array(capacity);
  const displacementSq = new Float32Array(capacity);
  const gridNext = new Int32Array(capacity);
  const connectionData = new Float32Array(MAX_CONNECTIONS * 5);
  const frameIntervals = new Float32Array(METRICS_HISTORY_SIZE);
  const simulationTimes = new Float32Array(METRICS_HISTORY_SIZE);
  const connectionTimes = new Float32Array(METRICS_HISTORY_SIZE);
  const renderingTimes = new Float32Array(METRICS_HISTORY_SIZE);
  const sortedFrameIntervals = new Float32Array(METRICS_HISTORY_SIZE);
  let gridHeads = new Int32Array(0);
  let gridColumns = 0;
  let gridRows = 0;
  let count = 0;
  let connectionCount = 0;
  let metricsIndex = 0;
  let metricsCount = 0;
  let lastMetricsAt = 0;
  let lastFrameTimestamp = 0;

  const initParticle = (i, baseX, baseY, startX, startY) => {
    baseXs[i] = baseX;
    baseYs[i] = baseY;
    xs[i] = startX;
    ys[i] = startY;
    sizes[i] = Math.random() * 1 + (isSmallViewport() ? 2.2 : 3);
    densities[i] = Math.random() * 100 + 1;
    displacementSq[i] = 0;
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
    maskCtx.textAlign = 'left';

    const ch = height / 2;
    const titleVspace = height > width ? 9 : 5;

    maskCtx.font = `${Math.round(width * 0.25)}px ${FONT_STACK}`;
    maskCtx.fillText('REIMON', 5, ch - ch / titleVspace);

    maskCtx.font = `${Math.round(width * 0.1325)}px ${FONT_STACK}`;
    maskCtx.fillText('DEVELOPMENT', 5, ch + ch / titleVspace);

    const data = maskCtx.getImageData(0, 0, mw, mh).data;

    let filled = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > MASK_ALPHA) filled++;
    }
    if (!filled) return [];

    const deviceMax = isSmallViewport() ? MAX_PARTICLES_MOBILE : MAX_PARTICLES_DESKTOP;
    const max = Math.max(500, Math.floor(deviceMax * quality.particleScale));
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
    minTargetX = width;
    minTargetY = height;
    maxTargetX = 0;
    maxTargetY = 0;

    for (let i = 0; i < targetCount; i++) {
      const baseX = points[i * 2];
      const baseY = points[i * 2 + 1];
      minTargetX = Math.min(minTargetX, baseX);
      minTargetY = Math.min(minTargetY, baseY);
      maxTargetX = Math.max(maxTargetX, baseX);
      maxTargetY = Math.max(maxTargetY, baseY);
      if (i < count) {
        baseXs[i] = baseX;
        baseYs[i] = baseY;
      } else {
        // Match the reference intro: particles gather into the text from
        // across the viewport, producing its connecting-line formation.
        initParticle(i, baseX, baseY, Math.random() * width, Math.random() * height);
      }
    }
    count = targetCount;
  };

  const drawConnections = () => {
    const n = count;
    const step = quality.connectionStride;
    gridColumns = Math.max(1, Math.ceil(width / CONNECTION_CELL_SIZE));
    gridRows = Math.max(1, Math.ceil(height / CONNECTION_CELL_SIZE));
    const gridSize = gridColumns * gridRows;
    if (gridHeads.length !== gridSize) gridHeads = new Int32Array(gridSize);
    gridHeads.fill(-1);

    // Index points into a uniform spatial grid, so each particle only compares
    // against nearby candidates instead of scanning the entire particle array.
    for (let i = 0; i < n; i++) {
      const cellX = Math.min(gridColumns - 1, Math.max(0, Math.floor(xs[i] / CONNECTION_CELL_SIZE)));
      const cellY = Math.min(gridRows - 1, Math.max(0, Math.floor(ys[i] / CONNECTION_CELL_SIZE)));
      const cell = cellY * gridColumns + cellX;
      gridNext[i] = gridHeads[cell];
      gridHeads[cell] = i;
    }

    const lines = connectionData;
    let lineCount = 0;

    for (let a = 0; a < n; a += step) {
      const paX = xs[a];
      const paY = ys[a];
      const paDistSq = displacementSq[a];

      if (paDistSq < 1) continue;
      const bucket = Math.min(
        LINE_BUCKETS - 1,
        Math.floor((Math.sqrt(paDistSq) / 50) * LINE_BUCKETS)
      );
      const cellX = Math.min(gridColumns - 1, Math.max(0, Math.floor(paX / CONNECTION_CELL_SIZE)));
      const cellY = Math.min(gridRows - 1, Math.max(0, Math.floor(paY / CONNECTION_CELL_SIZE)));
      for (let y = Math.max(0, cellY - 1); y <= Math.min(gridRows - 1, cellY + 1); y++) {
        for (let x = Math.max(0, cellX - 1); x <= Math.min(gridColumns - 1, cellX + 1); x++) {
          for (let b = gridHeads[y * gridColumns + x]; b !== -1; b = gridNext[b]) {
            if (b <= a || b % step !== 0) continue;
            const dx = paX - xs[b];
            const dy = paY - ys[b];
            const d2 = dx * dx + dy * dy;
            if (d2 > CONNECTION_MIN_SQ && d2 < CONNECTION_MAX_SQ && lineCount < quality.connectionLimit) {
              const offset = lineCount * 5;
              lines[offset] = paX;
              lines[offset + 1] = paY;
              lines[offset + 2] = xs[b];
              lines[offset + 3] = ys[b];
              lines[offset + 4] = bucket + 1;
              lineCount++;
            }
          }
        }
      }
    }

    renderer.drawLines(lines, lineCount);
    return lineCount;
  };

  const tick = (now) => {
    if (!running || destroyed) return;
    rafId = requestAnimationFrame(tick);

    if (now - lastFrameAt < FRAME_MS) return;
    lastFrameAt = now;
    const frameInterval = lastFrameTimestamp ? now - lastFrameTimestamp : FRAME_MS;
    lastFrameTimestamp = now;

    const renderingStart = performance.now();
    renderer.clear(width, height);
    let renderingMs = performance.now() - renderingStart;

    const simulationStart = performance.now();
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
      // Keep squared displacement for the pointer-connection buckets. Avoid a
      // square root for every particle on every animation frame.
      displacementSq[i] = baseDistSq;
      if (baseDistSq > 1) moving = true;
    }
    const simulationMs = performance.now() - simulationStart;

    const particleDrawStart = performance.now();
    renderer.drawParticles(xs, ys, sizes, count);
    renderingMs += performance.now() - particleDrawStart;

    const pointerActive = now - lastMoveAt < 900;
    // Draw connection lines while the text is assembling, like the TSX intro,
    // and while pointer movement is disturbing the settled particle field.
    let connectionMs = 0;
    connectionCount = 0;
    if (moving || pointerActive) {
      const connectionStart = performance.now();
      connectionCount = drawConnections();
      connectionMs = performance.now() - connectionStart;
    }

    saveFrameMetrics(frameInterval, simulationMs, connectionMs, renderingMs);
    if (now - lastMetricsAt >= METRICS_INTERVAL_MS) {
      lastMetricsAt = now;
      const metrics = readMetrics(true);
      onMetrics(metrics);
      if (qualityController.observe(metrics.p95FrameMs)) applyQuality();
    }

    if (!moving && !pointerActive) {
      running = false;
      cancelAnimationFrame(rafId);
      emitMetrics(false);
    }
  };

  const start = () => {
    if (destroyed || running) return;
    running = true;
    lastFrameAt = 0;
    lastFrameTimestamp = 0;
    rafId = requestAnimationFrame(tick);
  };

  const stop = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const drawStatic = () => {
    renderer.clear(width, height);
    connectionCount = 0;
    for (let i = 0; i < count; i++) {
      xs[i] = baseXs[i];
      ys[i] = baseYs[i];
      displacementSq[i] = 0;
    }
    renderer.drawParticles(xs, ys, sizes, count);
  };

  const readMetrics = (isRunning) => {
    let frameTotal = 0;
    let simulationTotal = 0;
    let connectionTotal = 0;
    let renderingTotal = 0;
    for (let i = 0; i < metricsCount; i++) {
      const interval = frameIntervals[i];
      sortedFrameIntervals[i] = interval;
      frameTotal += interval;
      simulationTotal += simulationTimes[i];
      connectionTotal += connectionTimes[i];
      renderingTotal += renderingTimes[i];
    }
    sortedFrameIntervals.fill(Infinity, metricsCount);
    sortedFrameIntervals.sort();
    const averageFrameMs = metricsCount ? frameTotal / metricsCount : 0;
    const p95Index = Math.max(0, Math.ceil(metricsCount * 0.95) - 1);
    return {
      fps: isRunning && averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
      averageFrameMs,
      p95FrameMs: metricsCount ? sortedFrameIntervals[p95Index] : 0,
      simulationMs: metricsCount ? simulationTotal / metricsCount : 0,
      connectionMs: metricsCount ? connectionTotal / metricsCount : 0,
      renderingMs: metricsCount ? renderingTotal / metricsCount : 0,
      particleCount: count,
      connectionCount,
      renderer: rendererType === 'webgl' ? 'WebGL2' : 'Canvas 2D',
      gpuStatus: renderer.gpuStatus,
      gpuRenderer: renderer.gpuRenderer || 'browser-managed',
      quality: quality.name,
      qualityScale: quality.particleScale,
      renderScale: quality.resolutionScale,
      devicePixelRatio: window.devicePixelRatio || 1,
      canvasPixelRatio: basePixelRatio * quality.resolutionScale,
      running: isRunning,
    };
  };

  const emitMetrics = (isRunning = running) => {
    onMetrics(readMetrics(isRunning));
  };

  const saveFrameMetrics = (frameInterval, simulationMs, connectionMs, renderingMs) => {
    frameIntervals[metricsIndex] = frameInterval;
    simulationTimes[metricsIndex] = simulationMs;
    connectionTimes[metricsIndex] = connectionMs;
    renderingTimes[metricsIndex] = renderingMs;
    metricsIndex = (metricsIndex + 1) % METRICS_HISTORY_SIZE;
    metricsCount = Math.min(METRICS_HISTORY_SIZE, metricsCount + 1);
  };

  const applySize = () => {
    const nextWidth = Math.max(1, window.innerWidth);
    const nextHeight = Math.max(1, window.innerHeight);

    const rx = width ? nextWidth / width : 1;
    const ry = height ? nextHeight / height : 1;

    width = nextWidth;
    height = nextHeight;
    renderer.resize(Math.round(width), Math.round(height), basePixelRatio * quality.resolutionScale);

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
      emitMetrics(false);
      return;
    }

    lastMoveAt = -Infinity;
    start();
  };

  let applyQuality = () => {};
  applyQuality = () => {
    quality = qualityController.level;
    renderer.resize(Math.round(width), Math.round(height), basePixelRatio * quality.resolutionScale);
    retarget(buildTargets());
    lastMoveAt = -Infinity;
    mouse.x = -1e4;
    mouse.y = -1e4;
    drawStatic();
    stop();
    emitMetrics(false);
  };

  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = 0;
      applySize();
    }, RESIZE_DEBOUNCE);
  };

  const onPointerMove = (event) => {
    const padding = MOUSE_RADIUS;
    const insideTextBounds =
      event.clientX >= minTargetX - padding &&
      event.clientX <= maxTargetX + padding &&
      event.clientY >= minTargetY - padding &&
      event.clientY <= maxTargetY + padding;

    if (!insideTextBounds) {
      mouse.x = -1e4;
      mouse.y = -1e4;
      lastMoveAt = -Infinity;
      return;
    }

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
      renderer.destroy();
      count = 0;
      mask.width = 0;
      mask.height = 0;
    },
  };
};
