import { createRoot } from 'react-dom/client';
import SquareOfShadows from './games/squareofshadows/SquareOfShadows';

/*
 * The `<main class="app-shell game-fullbleed">` wrapper is REPRODUCED here, not
 * incidental. `App.jsx` puts the page frame and the full-bleed sizing rules on
 * that element, so a harness that mounts the game bare cannot see either — it
 * went green on a page frame that was not there and on a scroll fix that had no
 * wrapper to scroll inside. Keep this in step with `App.jsx:258`.
 */
createRoot(document.getElementById('smoke-root')!).render(
  <main className="app-shell game-fullbleed">
    <SquareOfShadows userId="sos-smoke-user" nickname="Smoke test" />
  </main>,
);
