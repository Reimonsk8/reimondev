import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { FaSlidersH } from 'react-icons/fa';
import {
  AURORA_DEFAULTS,
  clampAuroraSettings,
  loadAuroraSettings,
  saveAuroraSettings,
} from '../utils/auroraSettings';
import '../styles/AuroraLab.css';

// Hidden experimental control room for the ambient aurora/eclipse background.
//
// Nothing here is reachable through the visible UI: type "eclipse" anywhere
// on the site to toggle the panel (Escape closes it). Values persist in
// localStorage and drive AuroraBackdrop plus the --aurora-* hooks in App.css.

const SECRET = 'eclipse';

const AuroraSettingsContext = createContext(null);

export const useAuroraSettings = () => {
  const context = useContext(AuroraSettingsContext);
  if (!context) {
    throw new Error('useAuroraSettings requires <AuroraSettingsProvider>');
  }
  return context;
};

export const AuroraSettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(loadAuroraSettings);

  useEffect(() => {
    saveAuroraSettings(settings);
  }, [settings]);

  const update = useCallback((patch) => {
    setSettings((prev) => clampAuroraSettings({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => setSettings({ ...AURORA_DEFAULTS }), []);

  return (
    <AuroraSettingsContext.Provider value={{ settings, update, reset }}>
      {children}
    </AuroraSettingsContext.Provider>
  );
};

const mult = (v) => `${v.toFixed(2)}×`;
const seconds = (v) => `${v.toFixed(1)} s`;

const SLIDER_GROUPS = [
  {
    title: 'Phase cycle',
    rows: [
      { key: 'speed', label: 'Cycle speed', min: 0.25, max: 4, step: 0.05, format: mult },
      { key: 'crossfadeS', label: 'Crossfade', min: 0.5, max: 20, step: 0.5, format: seconds },
      { key: 'holdA', label: 'Phase A hold', min: 2, max: 60, step: 1, format: seconds },
      { key: 'holdB', label: 'Phase B hold', min: 2, max: 60, step: 1, format: seconds },
      { key: 'holdC', label: 'Phase C hold', min: 2, max: 60, step: 1, format: seconds },
    ],
  },
  {
    title: 'Layers & glow',
    rows: [
      { key: 'size', label: 'Eclipse size', min: 0.6, max: 1.8, step: 0.02, format: mult },
      { key: 'intensity', label: 'Aurora glow', min: 0, max: 2, step: 0.05, format: mult },
      { key: 'core', label: 'Core glow', min: 0, max: 2, step: 0.05, format: mult },
      { key: 'grain', label: 'Film grain', min: 0, max: 0.15, step: 0.005, format: (v) => v.toFixed(3) },
    ],
  },
  {
    title: 'Motion',
    rows: [
      { key: 'drift', label: 'Drift motion', min: 0.25, max: 4, step: 0.05, format: mult },
    ],
  },
];

const consumesTextInput = (node) =>
  node instanceof HTMLElement && (
    node.isContentEditable ||
    node.tagName === 'TEXTAREA' ||
    (node.tagName === 'INPUT' &&
      !['range', 'checkbox', 'radio', 'button', 'submit', 'color', 'file'].includes(node.type))
  );

export const AuroraLabPanel = () => {
  const { settings, update, reset } = useAuroraSettings();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // The launcher stays hidden until the "eclipse" secret reveals it.
  const [launcherRevealed, setLauncherRevealed] = useState(false);
  const copiedTimer = useRef(0);
  const launcherRef = useRef(null);

  const closePanel = useCallback(() => {
    setOpen(false);
    // Hand focus back to the launcher once it re-mounts.
    requestAnimationFrame(() => launcherRef.current?.focus());
  }, []);

  // Secret trigger: type "eclipse" anywhere to toggle the lab. The buffer
  // resets after a short pause so stray typing never adds up to it.
  useEffect(() => {
    let buffer = '';
    let flushTimer = 0;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        closePanel();
        return;
      }
      // Never fight with real text entry (nav search, forms, the lab itself).
      if (consumesTextInput(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1) return;

      buffer = (buffer + event.key.toLowerCase()).slice(-SECRET.length);
      window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => { buffer = ''; }, 1600);

      if (buffer === SECRET) {
        buffer = '';
        if (open) {
          // Secret while the lab is open: close it and return to the clean,
          // button-less state.
          closePanel();
          setLauncherRevealed(false);
        } else {
          // Secret while closed: toggle the launcher in and out of view.
          setLauncherRevealed((visible) => !visible);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    // One-line hint so the trigger stays discoverable for the site owner.
    console.info('%cAurora Lab%c type "eclipse" to reveal the sliders button, then click it to open.', 'font-weight: bold', '');
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(flushTimer);
    };
  }, [open, closePanel]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const copySettings = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(settings, null, 2));
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (permissions, insecure context) — ignore.
    }
  };

  if (!open) {
    // Hidden by default: the launcher only exists once the secret reveals
    // it, so the site stays clean until "eclipse" is typed.
    if (!launcherRevealed) return null;

    return createPortal(
      <button
        ref={launcherRef}
        type="button"
        className="aurora-lab-launcher"
        aria-label="Open Aurora Lab (experimental)"
        title="Aurora Lab (experimental)"
        onClick={() => setOpen(true)}
      >
        <FaSlidersH aria-hidden="true" />
      </button>,
      document.body,
    );
  }

  return createPortal(
    <aside className="aurora-lab" aria-label="Aurora Lab (experimental)">
      <div className="aurora-lab-head">
        <p className="aurora-lab-title">
          Aurora Lab <span className="aurora-lab-tag">experimental</span>
        </p>
        <div className="aurora-lab-head-actions">
          <button
            type="button"
            className={`lab-btn lab-btn-mini${settings.paused ? ' is-active' : ''}`}
            onClick={() => update({ paused: !settings.paused })}
          >
            {settings.paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            className="aurora-lab-close"
            onClick={closePanel}
            aria-label="Close Aurora Lab"
          >
            ×
          </button>
        </div>
      </div>

      {SLIDER_GROUPS.map((group) => (
        <section key={group.title} className="lab-section">
          <h3 className="lab-section-title">{group.title}</h3>
          {group.rows.map(({ key, label, min, max, step, format }) => (
            <label key={key} className="lab-row" htmlFor={`lab-${key}`}>
              <span className="lab-label">{label}</span>
              <output className="lab-value" htmlFor={`lab-${key}`}>{format(settings[key])}</output>
              <input
                id={`lab-${key}`}
                className="lab-slider"
                type="range"
                min={min}
                max={max}
                step={step}
                value={settings[key]}
                aria-label={label}
                onChange={(event) => update({ [key]: Number(event.target.value) })}
              />
            </label>
          ))}
        </section>
      ))}

      <div className="lab-buttons">
        <button type="button" className="lab-btn" onClick={reset}>Reset</button>
        <button type="button" className="lab-btn" onClick={copySettings}>
          {copied ? 'Copied ✓' : 'Copy JSON'}
        </button>
      </div>

      <p className="lab-hint">
        Type <strong>eclipse</strong> anywhere to reveal the corner button (again to hide it);
        click it to open and <strong>Esc</strong> closes. Values persist in this browser;{' '}
        <strong>Copy JSON</strong> to bake a look into the defaults in{' '}
        <code>src/utils/auroraSettings.js</code>.
      </p>
    </aside>,
    document.body,
  );
};
