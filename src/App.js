import React, { useEffect, useRef, useState } from 'react';
/*import particles from './assets/particles.json'*/
import './styles/App.css';
import MainMenu from './components/MainMenu';
import { initialAuroraVars, randomAuroraVars } from './utils/aurora';

// Ambient aurora cycle: A (silver ribbons) -> B (singularity) -> C (holy donut
// ring) -> back to A. Each phase holds for its own duration, then cross-fades
// over the 5s CSS transition. Phase C gets the longest hold so the ring reads.
const AURORA_PHASES = [
  { phase: 'a', hold: 8000 },
  { phase: 'b', hold: 7000 },
  { phase: 'c', hold: 13000 },
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
      let timer = 0;

      const advance = () => {
        timer = window.setTimeout(() => {
          index = (index + 1) % AURORA_PHASES.length;
          const next = AURORA_PHASES[index].phase;
          // Re-roll the next layer while it is still fully transparent, then
          // flip the phase in the same render so the new shape fades in.
          setAuroraVars((prev) => ({ ...prev, ...randomAuroraVars(next) }));
          setPhase(next);
          advance();
        }, AURORA_PHASES[index].hold);
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
