import React, { useEffect, useMemo, useRef, useState } from 'react';
import { initialAuroraVars, randomAuroraVars, scaleAuroraAlphas } from '../utils/aurora';
import { useAuroraSettings } from './AuroraLab';

// Ambient eclipse cycle. Hold durations count from the end of the incoming
// crossfade, so each state gets its intended fully-visible time. Timing comes
// from the hidden Aurora Lab settings so it can be tuned live.
const PHASE_SEQUENCE = ['a', 'c', 'b', 'c'];

const AuroraBackdrop = () => {
  const { settings } = useAuroraSettings();
  const { speed, crossfadeS, holdA, holdB, holdC, paused } = settings;
  const [phase, setPhase] = useState('a');
  const [auroraVars, setAuroraVars] = useState(initialAuroraVars);
  const auroraRef = useRef(null);

  // Sequence position survives effect restarts (speed/pause changes) so the
  // cycle continues from the current phase instead of snapping back to A.
  const sequenceIndex = useRef(0);
  const firstAdvance = useRef(true);

  // Freeze the aurora when the tab is hidden or the lab pauses it, so it
  // costs nothing in the background (and stops competing with route code
  // while you navigate).
  useEffect(() => {
    const el = auroraRef.current;
    if (!el) return undefined;

    const syncPaused = () => el.classList.toggle('is-paused', document.hidden || paused);
    syncPaused();
    document.addEventListener('visibilitychange', syncPaused);
    return () => document.removeEventListener('visibilitychange', syncPaused);
  }, [paused]);

  useEffect(() => {
    const reduceMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    if (reduceMotion || paused) return undefined;

    const holds = { a: holdA, b: holdB, c: holdC };
    let timer = 0;

    const advance = () => {
      const current = PHASE_SEQUENCE[sequenceIndex.current];
      const holdMs = (holds[current] * 1000) / speed
        + (firstAdvance.current ? 0 : crossfadeS * 1000);
      timer = window.setTimeout(() => {
        sequenceIndex.current = (sequenceIndex.current + 1) % PHASE_SEQUENCE.length;
        const next = PHASE_SEQUENCE[sequenceIndex.current];
        // Re-roll the next layer while it is still fully transparent, then
        // flip the phase in the same render so the new shape fades in.
        setAuroraVars((prev) => ({ ...prev, ...randomAuroraVars(next) }));
        setPhase(next);
        firstAdvance.current = false;
        advance();
      }, holdMs);
    };

    advance();
    return () => window.clearTimeout(timer);
  }, [speed, crossfadeS, holdA, holdB, holdC, paused]);

  const style = useMemo(() => ({
    ...scaleAuroraAlphas(auroraVars, settings.intensity),
    // Aurora Lab hooks consumed by styles/App.css.
    '--aurora-size': settings.size,
    '--aurora-fade': `${settings.crossfadeS}s`,
    '--aurora-drift': settings.drift,
    '--aurora-core-o': settings.core,
    '--aurora-grain-o': settings.grain,
  }), [auroraVars, settings.intensity, settings.size, settings.crossfadeS, settings.drift, settings.core, settings.grain]);

  return (
    <div
      id="particles-js"
      ref={auroraRef}
      aria-hidden="true"
      data-phase={phase}
      style={style}
    >
      <span className="aurora-c" />
      <span className="aurora-core" />
      <span className="aurora-grain" />
    </div>
  );
};

export default AuroraBackdrop;
