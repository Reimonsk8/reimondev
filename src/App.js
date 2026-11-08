import React, { useEffect, useRef, useState } from 'react';
/*import particles from './assets/particles.json'*/
import './styles/App.css';
import MainMenu from './components/MainMenu';
import { initialAuroraVars, randomAuroraVars } from './utils/aurora';

// Ambient eclipse cycle. Hold durations count from the end of the incoming
// crossfade, so each state gets its intended fully-visible time.
const AURORA_CROSSFADE_MS = 8000;
const AURORA_PHASES = [
  { phase: 'a', hold: 11000 },
  { phase: 'c', hold: 15000 },
  { phase: 'b', hold: 10000 },
  { phase: 'c', hold: 15000 },
];

const App = () => {
    const [phase, setPhase] = useState('a');
    const [auroraVars, setAuroraVars] = useState(initialAuroraVars);
    const auroraRef = useRef(null);

    // Freeze the aurora when the tab is hidden so it costs nothing in the
    // background (and stops competing with route code while you navigate).
    useEffect(() => {
      const el = auroraRef.current;
      if (!el) return undefined;

      const syncPaused = () => el.classList.toggle('is-paused', document.hidden);
      syncPaused();
      document.addEventListener('visibilitychange', syncPaused);
      return () => document.removeEventListener('visibilitychange', syncPaused);
    }, []);

    useEffect(() => {
      const reduceMotion = window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;
      if (reduceMotion) return undefined;

      let index = 0;
      let firstPhase = true;
      let timer = 0;

      const advance = () => {
        timer = window.setTimeout(() => {
          index = (index + 1) % AURORA_PHASES.length;
          const next = AURORA_PHASES[index].phase;
          // Re-roll the next layer while it is still fully transparent, then
          // flip the phase in the same render so the new shape fades in.
          setAuroraVars((prev) => ({ ...prev, ...randomAuroraVars(next) }));
          setPhase(next);
          firstPhase = false;
          advance();
        }, AURORA_PHASES[index].hold + (firstPhase ? 0 : AURORA_CROSSFADE_MS));
      };

      advance();
      return () => window.clearTimeout(timer);
    }, []);

    return (
      <div className="App">       
        <header className="App-header">
        </header>
        <div
          id="particles-js"
          ref={auroraRef}
          aria-hidden="true"
          data-phase={phase}
          style={auroraVars}
        >
          <span className="aurora-c" />
          <span className="aurora-core" />
          <span className="aurora-grain" />
        </div>
        <MainMenu/>
      </div>
    );
};

export default App;
