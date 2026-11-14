import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import ProjectPubnub from '../projectPages/projectPubnub';
import '../../styles/Projects.css';

const PUBLIC_URL = process.env.PUBLIC_URL || '';

// `visibility: 'private'` marks unpublished / unfinished work. Those cards only
// render for the admin session (see src/auth/AuthContext.js) and carry a status
// plus the remaining TODOs. Everything without that flag is public portfolio.
const FILTERS = [
  { id: 'all', label: 'All work' },
  { id: 'project', label: 'Projects' },
  { id: 'game', label: 'Games' },
  { id: 'unpublished', label: 'Unpublished', adminOnly: true },
];

const STATUS_LABELS = {
  idea: 'Idea · not started',
  nearly_complete: 'Nearly complete',
  in_progress: 'In progress',
  outdated: 'Outdated',
  complete_needs_optimization: 'Complete · needs optimization',
  on_hold: 'On hold',
  functional_needs_cleanup: 'Functional · needs cleanup',
  stable: 'Stable',
  early_prototype: 'Early prototype',
  proof_of_concept: 'Proof of concept',
  flagship_active: 'Flagship · active',
  refactor_planned: 'Refactor planned',
  working_outdated: 'Working · outdated stack',
  archived: 'Archived',
};

const WORK_ITEMS = [
  // ---------------------------------------------------------------- published
  {
    id: 'square-of-shadows',
    kind: 'game',
    eyebrow: 'TACTICAL FANTASY',
    title: 'Square of Shadows',
    description: 'A turn-based duel of positioning, class abilities, and close tactical choices.',
    image: '/games/sprites/wallpaper.jpg',
    imageAlt: 'The two realms of Square of Shadows',
    action: { label: 'Enter the world', href: '/games/square-of-shadows' },
  },
  {
    id: 'zombie-shooter',
    kind: 'game',
    status: 'in_progress',
    eyebrow: 'ISOMETRIC SURVIVAL',
    title: 'Zombie Shooter',
    description: 'Scavenge a quarantined city, fight the infected, and make it back alive.',
    currentState: 'Playable demo in good shape, but requires significant work.',
    nextSteps: [
      'Polish animations',
      'Build in-game progression system',
      'Add persistent multiplayer server later on',
    ],
    image: '/games/sprites/outlands/survivor.png',
    imageAlt: 'Pixel-art survivor from Zombie Shooter',
    imageClass: 'work-card-art--pixel',
    action: { label: 'Enter the Outlands', href: '/games/outlands' },
  },
  {
    id: 'ayuda-pronto',
    kind: 'project',
    eyebrow: 'MEXICO · SERVICES MARKETPLACE',
    title: 'AyudaPronto',
    description: 'A free marketplace for services in Mexico.',
    artLabel: 'AYUDA / PRONTO',
    note: 'Source repository is private.',
    action: { label: 'Visit AyudaPronto', href: 'https://ayudapronto.com/' },
  },
  {
    id: '3d-model-generator',
    kind: 'project',
    eyebrow: 'OPEN SOURCE · 3D',
    title: '3D Model Generator',
    description: 'Generate 3D models locally from images—or text with TRELLIS—using open-source AI engines, then download the GLB output.',
    artLabel: '3D / GENERATION',
    action: { label: 'View GitHub repo', href: 'https://github.com/Reimonsk8/3D-Model-Generator' },
  },
  {
    id: 'media-sweep',
    kind: 'project',
    eyebrow: 'OPEN SOURCE · MEDIA',
    title: 'Media Sweep',
    description: 'A safe media-to-Immich workflow: inventory photos and videos, find what is missing, then copy files into date-based folders without deleting the originals.',
    artLabel: 'MEDIA / SWEEP',
    note: 'Source repository is private.',
  },
  {
    id: 'dark-void-qt',
    kind: 'project',
    eyebrow: 'C++ · QT · PIXEL ART',
    title: 'Dark Void',
    description: 'A 2D dungeon adventure built in Qt with C++ and pixel-art visuals.',
    image: `${PUBLIC_URL}/img/darkvoid-qt.webp`,
    imageAlt: 'Dark Void Qt game screenshot',
    actions: [
      { label: 'View dungeon artwork', href: `${PUBLIC_URL}/img/darkvoid-0.webp` },
      { label: 'Download build', href: 'https://my-video-storage-demo.s3.amazonaws.com/DarknessVoidConsoleAlpha.rar', download: true },
    ],
  },
  {
    id: 'dnd-cpp',
    kind: 'project',
    eyebrow: 'C++ · DESKTOP GAME',
    title: 'Dungeon & Dragons',
    description: 'A small Windows adventure about navigating a dark dungeon and finding the exit.',
    image: `${PUBLIC_URL}/img/darkvoid-1.webp`,
    imageAlt: 'Dungeon game artwork',
    actions: [
      { label: 'More game artwork', href: `${PUBLIC_URL}/img/darkvoid-2.webp` },
      { label: 'Download build', href: 'https://my-video-storage-demo.s3.amazonaws.com/DarknessVoidConsoleAlpha.rar', download: true },
    ],
  },
  {
    id: 'xvc-panel',
    kind: 'project',
    status: 'proof_of_concept',
    eyebrow: 'OPEN SOURCE · PANEL',
    title: 'XVC Panel',
    description: 'A Windows-first control surface to discover, build, and run code-based visuals, with OSC parameters and LFO modulation.',
    currentState: 'Solid proof of concept that works.',
    nextSteps: ['Heavy UI/UX polish to make it practically useful'],
    artLabel: 'XVC / PANEL',
    action: { label: 'View GitHub repo', href: 'https://github.com/Reimonsk8/XVCpanel' },
  },
  {
    id: 'sat-buzon',
    kind: 'project',
    status: 'early_prototype',
    eyebrow: 'OPEN SOURCE · MEXICO',
    title: 'SAT Buzón',
    description: 'Playwright automation for Mexico’s SAT: e.firma sign-in, Buzón Tributario, monthly ISR filings, and refund-case monitoring.',
    currentState: 'Barely functional baseline.',
    nextSteps: ['Expand automation workflows to make it practically useful'],
    artLabel: 'SAT / BUZÓN',
    action: { label: 'View GitHub repo', href: 'https://github.com/Reimonsk8/sat-buzon' },
  },
  {
    id: 'dark-and-darker-bot',
    kind: 'project',
    status: 'on_hold',
    eyebrow: 'AUTOMATION · COMMUNITY',
    title: 'Dark and Darker lobby bot',
    description: 'A Discord bot and companion utility for automating lobby-ready workflows.',
    currentState: 'Worked as intended for its target patch, currently unnecessary due to frequent game updates.',
    nextSteps: [
      'Wait for a stable game version',
      'Identify and build new automations once the meta/API stabilizes',
    ],
    image: `${PUBLIC_URL}/img/lobbyready.webp`,
    imageAlt: 'Dark and Darker lobby-ready bot',
    actions: [
      { label: 'Install Discord bot', href: 'https://discord.com/oauth2/authorize?client_id=1107128802578006066' },
      { label: 'Download app', href: 'https://my-video-storage-demo.s3.amazonaws.com/DndAutoClickBot.exe', download: true },
    ],
  },
  {
    id: 'dark-and-darker-calculator',
    kind: 'project',
    status: 'on_hold',
    eyebrow: 'OPEN SOURCE · GAME TOOL',
    title: 'Dark and Darker Calculator',
    description: 'A class damage calculator with game data loaded from DarkerDB. Results depend on current game data and damage-scaling rules.',
    currentState: 'Dependent on live DarkerDB data and shifting damage-scaling rules.',
    nextSteps: ['Re-sync scaling formulas and data once game patches stabilize'],
    artLabel: 'DARK / CALCULATOR',
    actions: [
      { label: 'Open calculator', href: 'https://reimonsk8.github.io/dark-and-darker-calculator/' },
      { label: 'View GitHub repo', href: 'https://github.com/Reimonsk8/dark-and-darker-calculator' },
    ],
  },
  {
    id: 'unknown-void',
    kind: 'project',
    status: 'outdated',
    eyebrow: 'UNREAL ENGINE 5 · MULTIPLAYER',
    title: 'The Unknown Void',
    description: 'A multiplayer horror-survival project, with early gameplay and locomotion prototypes.',
    currentState: 'Built on an outdated Unreal Engine version.',
    nextSteps: [
      'Migrate project to Unreal Engine 5.8',
      'Adapt gameplay and locomotion prototypes to the new engine version',
    ],
    artLabel: 'UE5 / SURVIVAL',
    actions: [
      { label: 'Gameplay prototype', href: 'https://my-video-storage-demo.s3.amazonaws.com/Multiplayer.mp4' },
      { label: 'Locomotion prototype', href: 'https://my-video-storage-demo.s3.amazonaws.com/Locomotion.mp4' },
    ],
  },
  {
    id: 'qwen-local-server',
    kind: 'project',
    status: 'outdated',
    eyebrow: 'OPEN SOURCE · LOCAL AI',
    title: 'Qwen Local Server',
    description: 'Run Qwen locally behind an OpenAI-compatible API, with GPU inference, quantization, and streaming responses.',
    currentState: 'Functional previously, now outdated.',
    nextSteps: ['Update inference backend to support current Qwen3.8 / Qwen4 models and updated APIs'],
    artLabel: 'QWEN / LOCAL',
    action: { label: 'View GitHub repo', href: 'https://github.com/Reimonsk8/qwen-local-server' },
  },
  {
    id: 'storefront-ui-catalog',
    kind: 'project',
    status: 'refactor_planned',
    eyebrow: 'WEB · E-COMMERCE',
    title: 'Storefront UI Catalog',
    description: 'A consolidated catalog showcasing personal e-commerce and shop UI demos.',
    currentState: 'Kartel Kollection is basic/outdated; merging with the Clothing storefront concept into a unified personal UI showcase.',
    nextSteps: [
      'Merge Kartel Kollection and Clothing storefront concept into a single UI demo catalog',
      'Replace the two separate cards with the merged catalog',
    ],
    artLabel: 'WEB / COMMERCE',
    actions: [
      { label: 'Brand site', to: '/kartel' },
      { label: 'Shop experience', to: '/kartelshop' },
      { label: 'Storefront demo', href: 'http://ncaliforniatestbucket.s3-website-us-west-1.amazonaws.com/' },
    ],
  },

  // -------------------------------------------------------------- unpublished
  {
    id: 'instagram-unfollower',
    kind: 'project',
    visibility: 'private',
    status: 'idea',
    eyebrow: 'FUTURE IDEA · AUTOMATION',
    title: 'Instagram unfollower tracker',
    description: 'Spots the accounts that stopped following you and saves the list, so you can follow them back later or keep the record.',
    currentState: 'Idea only — nothing built yet.',
    nextSteps: [
      'Snapshot the follower list and diff it on each check',
      'Save unfollowers with a timestamp to a local list',
      'Add a follow-back queue so the saved names can be followed later',
      'Decide how to handle login/rate limits without tripping Instagram',
    ],
    artLabel: 'INSTAGRAM / DIFF',
  },
  {
    id: 'pubnub-iot',
    kind: 'project',
    visibility: 'private',
    status: 'working_outdated',
    eyebrow: 'IOT · REAL-TIME DATA',
    title: 'Live temperature dashboard',
    description: 'A university IoT prototype that streams sensor readings from Raspberry Pi and ESP32 devices for live visualization.',
    currentState: 'Outdated stack, though the core dashboard works reliably.',
    nextSteps: ['Provide a clean SDK for Raspberry Pi and ESP32 devices to plug in and stream'],
    artLabel: 'PUBNUB / IOT',
    demo: true,
  },
  {
    id: 'navico',
    kind: 'project',
    visibility: 'private',
    status: 'archived',
    eyebrow: 'HARDWARE · NAVICO',
    title: 'Marine electronics internship',
    description: 'Hardware design work across sonar, GPS, and radar: competitor analysis, battery systems, and automated circuit testing.',
    currentState: 'No source code available. Kept off the public portfolio for now.',
    nextSteps: [],
    artLabel: 'HARDWARE / SYSTEMS',
  },
];

function WorkAction({ action }) {
  const className = 'work-card-action';
  if (action.to) {
    return <Link className={className} to={action.to}>{action.label}<span aria-hidden="true">↗</span></Link>;
  }

  const isInternalGame = action.href.startsWith('/games/');
  return (
    <a
      className={className}
      href={action.href}
      download={action.download || undefined}
      target={isInternalGame || action.download ? undefined : '_blank'}
      rel={isInternalGame || action.download ? undefined : 'noreferrer'}
    >
      {action.label}<span aria-hidden="true">↗</span>
    </a>
  );
}

function WorkCard({ item, isPrivate, pubnubOpen, onToggleDemo }) {
  return (
    <article className={`work-card work-card--${item.kind}${isPrivate ? ' work-card--private' : ''}`}>
      <div className={`work-card-art ${item.imageClass || ''}`}>
        {item.image ? (
          <img src={item.image} alt={item.imageAlt || ''} loading="lazy" decoding="async" />
        ) : (
          <span>{item.artLabel}</span>
        )}
        <span className={`work-card-kind${isPrivate ? ' work-card-kind--private' : ''}`}>
          {isPrivate ? 'PRIVATE' : item.kind === 'game' ? 'GAME' : 'PROJECT'}
        </span>
      </div>
      <div className="work-card-content">
        <p className="work-card-eyebrow">{item.eyebrow}</p>
        <h2>{item.title}</h2>
        <p className="work-card-description">{item.description}</p>

        {isPrivate && (
          <>
            <p className="work-card-status">
              <span className="work-card-status-dot" aria-hidden="true" />
              {STATUS_LABELS[item.status] || 'Unpublished'}
            </p>
            {item.currentState && <p className="work-card-state">{item.currentState}</p>}
            {item.nextSteps?.length > 0 && (
              <div className="work-card-todo">
                <p className="work-card-todo-title">Still to do</p>
                <ul>
                  {item.nextSteps.map((step) => <li key={step}>{step}</li>)}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="work-card-actions">
          {item.action && <WorkAction action={item.action} />}
          {item.actions?.map((action) => <WorkAction action={action} key={action.label} />)}
          {item.demo && (
            <button
              type="button"
              className="work-card-action"
              aria-expanded={pubnubOpen}
              aria-controls="pubnub-demo"
              onClick={onToggleDemo}
            >
              {pubnubOpen ? 'Close live demo' : 'Open live demo'}<span aria-hidden="true">{pubnubOpen ? '−' : '+'}</span>
            </button>
          )}
        </div>
        {item.note && <p className="work-card-note">{item.note}</p>}
        {item.demo && (
          <div id="pubnub-demo" className="work-live-demo" hidden={!pubnubOpen}>
            {pubnubOpen && <ProjectPubnub />}
          </div>
        )}
      </div>
    </article>
  );
}

function Projects() {
  const { ready, isAdmin } = useAuth();
  const [filter, setFilter] = useState(() => (window.location.hash === '#games' ? 'game' : 'all'));
  const [pubnubOpen, setPubnubOpen] = useState(false);

  // Private cards exist only for the admin session; for everyone else the page
  // behaves exactly like a curated portfolio.
  const showUnpublished = ready && isAdmin;
  const filters = FILTERS.filter((item) => !item.adminOnly || showUnpublished);
  const matches = (item) => {
    if (filter === 'unpublished') return item.visibility === 'private';
    return filter === 'all' || item.kind === filter;
  };

  const publicItems = WORK_ITEMS.filter((item) => item.visibility !== 'private' && matches(item));
  const privateItems = showUnpublished
    ? WORK_ITEMS.filter((item) => item.visibility === 'private' && matches(item))
    : [];
  const total = publicItems.length + privateItems.length;

  useEffect(() => {
    if (filter === 'unpublished' && !showUnpublished) setFilter('all');
  }, [filter, showUnpublished]);

  const selectFilter = (nextFilter) => {
    setFilter(nextFilter);
    const hash = nextFilter === 'game' ? '#games' : '';
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
  };

  useEffect(() => {
    if (window.location.hash !== '#games') return;
    document.getElementById('work-results')?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <main className="work-page" aria-labelledby="work-title">
      <header className="work-intro">
        <p className="work-eyebrow">REIMON DEVELOPMENT · SELECTED WORK</p>
        <h1 id="work-title">Built in the dark.<br /><span>Made to be explored.</span></h1>
        <p className="work-lede">A collection of games, experiments, and things I’ve built along the way.</p>
        <a className="work-contact-link" href="mailto:reimonsk8@gmail.com">Have a project in mind? <span>Get in touch ↗</span></a>
      </header>

      <section id="games" className="work-library" aria-label="Projects and games">
        <div className="work-toolbar">
          <div className="work-filters" role="group" aria-label="Filter work">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                className={filter === item.id ? 'work-filter is-active' : 'work-filter'}
                aria-pressed={filter === item.id}
                onClick={() => selectFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="work-count" aria-live="polite">
            {total} {total === 1 ? 'piece' : 'pieces'}
            {privateItems.length > 0 && ` · ${privateItems.length} unpublished`}
          </span>
        </div>

        <div id="work-results" className="work-grid">
          {publicItems.map((item) => (
            <WorkCard
              key={item.id}
              item={item}
              isPrivate={false}
              pubnubOpen={pubnubOpen}
              onToggleDemo={() => setPubnubOpen((open) => !open)}
            />
          ))}

          {privateItems.length > 0 && (
            <div className="work-private-divider">
              <p className="work-private-title">Unpublished</p>
              <p className="work-private-copy">
                Unfinished, on hold, or outdated work. Only your admin session renders these cards.
              </p>
            </div>
          )}

          {privateItems.map((item) => (
            <WorkCard
              key={item.id}
              item={item}
              isPrivate
              pubnubOpen={pubnubOpen}
              onToggleDemo={() => setPubnubOpen((open) => !open)}
            />
          ))}

          {total === 0 && <p className="work-empty">Nothing here yet.</p>}
        </div>
      </section>
      <footer className="work-footer">A SMALL SELECTION OF THINGS MADE WITH CURIOSITY.</footer>
    </main>
  );
}

export default Projects;
