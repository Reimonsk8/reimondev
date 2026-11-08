import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ProjectPubnub from '../projectPages/projectPubnub';
import '../../styles/Projects.css';

const PUBLIC_URL = process.env.PUBLIC_URL || '';
const FILTERS = [
  { id: 'all', label: 'All work' },
  { id: 'project', label: 'Projects' },
  { id: 'game', label: 'Games' },
];

const WORK_ITEMS = [
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
    eyebrow: 'ISOMETRIC SURVIVAL',
    title: 'Zombie Shooter',
    description: 'Scavenge a quarantined city, fight the infected, and make it back alive.',
    image: '/games/sprites/outlands/survivor.png',
    imageAlt: 'Pixel-art survivor from Zombie Shooter',
    imageClass: 'work-card-art--pixel',
    action: { label: 'Enter the Outlands', href: '/games/outlands' },
  },
  {
    id: 'dark-and-darker-bot',
    kind: 'project',
    eyebrow: 'AUTOMATION · COMMUNITY',
    title: 'Dark and Darker lobby bot',
    description: 'A Discord bot and companion utility for automating lobby-ready workflows.',
    image: `${PUBLIC_URL}/img/lobbyready.webp`,
    imageAlt: 'Dark and Darker lobby-ready bot',
    actions: [
      { label: 'Install Discord bot', href: 'https://discord.com/oauth2/authorize?client_id=1107128802578006066' },
      { label: 'Download app', href: 'https://my-video-storage-demo.s3.amazonaws.com/DndAutoClickBot.exe', download: true },
    ],
  },
  {
    id: 'unknown-void',
    kind: 'project',
    eyebrow: 'UNREAL ENGINE 5 · MULTIPLAYER',
    title: 'The Unknown Void',
    description: 'A multiplayer horror-survival project, with early gameplay and locomotion prototypes.',
    artLabel: 'UE5 / SURVIVAL',
    actions: [
      { label: 'Gameplay prototype', href: 'https://my-video-storage-demo.s3.amazonaws.com/Multiplayer.mp4' },
      { label: 'Locomotion prototype', href: 'https://my-video-storage-demo.s3.amazonaws.com/Locomotion.mp4' },
    ],
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
    id: 'media-sweep',
    kind: 'project',
    eyebrow: 'OPEN SOURCE · MEDIA',
    title: 'Media Sweep',
    description: 'A safe media-to-Immich workflow: inventory photos and videos, find what is missing, then copy files into date-based folders without deleting the originals.',
    artLabel: 'MEDIA / SWEEP',
    note: 'Source repository is private.',
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
    id: 'dark-and-darker-calculator',
    kind: 'project',
    eyebrow: 'OPEN SOURCE · GAME TOOL',
    title: 'Dark and Darker Calculator',
    description: 'A class damage calculator with game data loaded from DarkerDB. Results depend on current game data and damage-scaling rules.',
    artLabel: 'DARK / CALCULATOR',
    actions: [
      { label: 'Open calculator', href: 'https://reimonsk8.github.io/dark-and-darker-calculator/' },
      { label: 'View GitHub repo', href: 'https://github.com/Reimonsk8/dark-and-darker-calculator' },
    ],
  },
  {
    id: 'sat-buzon',
    kind: 'project',
    eyebrow: 'OPEN SOURCE · MEXICO',
    title: 'SAT Buzón',
    description: 'Playwright automation for Mexico’s SAT: e.firma sign-in, Buzón Tributario, monthly ISR filings, and refund-case monitoring.',
    artLabel: 'SAT / BUZÓN',
    action: { label: 'View GitHub repo', href: 'https://github.com/Reimonsk8/sat-buzon' },
  },
  {
    id: 'qwen-local-server',
    kind: 'project',
    eyebrow: 'OPEN SOURCE · LOCAL AI',
    title: 'Qwen Local Server',
    description: 'Run Qwen locally behind an OpenAI-compatible API, with GPU inference, quantization, and streaming responses.',
    artLabel: 'QWEN / LOCAL',
    action: { label: 'View GitHub repo', href: 'https://github.com/Reimonsk8/qwen-local-server' },
  },
  {
    id: 'xvc-panel',
    kind: 'project',
    eyebrow: 'OPEN SOURCE · PANEL',
    title: 'XVC Panel',
    description: 'A Windows-first control surface to discover, build, and run code-based visuals, with OSC parameters and LFO modulation.',
    artLabel: 'XVC / PANEL',
    action: { label: 'View GitHub repo', href: 'https://github.com/Reimonsk8/XVCpanel' },
  },
  {
    id: 'pubnub-iot',
    kind: 'project',
    eyebrow: 'IOT · REAL-TIME DATA',
    title: 'Live temperature dashboard',
    description: 'A university IoT prototype that streams sensor readings from Raspberry Pi and ESP32 devices for live visualization.',
    artLabel: 'PUBNUB / IOT',
    demo: true,
  },
  {
    id: 'kartel',
    kind: 'project',
    eyebrow: 'WEB · E-COMMERCE',
    title: 'Kartel Kollection',
    description: 'A branded storefront experiment with a custom product experience.',
    image: `${PUBLIC_URL}/img/kartel-bg.webp`,
    imageAlt: 'Kartel Kollection storefront artwork',
    actions: [
      { label: 'Brand site', to: '/kartel' },
      { label: 'Shop experience', to: '/kartelshop' },
    ],
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
    id: 'navico',
    kind: 'project',
    eyebrow: 'HARDWARE · NAVICO',
    title: 'Marine electronics internship',
    description: 'Hardware design work across sonar, GPS, and radar: competitor analysis, battery systems, and automated circuit testing.',
    artLabel: 'HARDWARE / SYSTEMS',
  },
  {
    id: 'clothing-demo',
    kind: 'project',
    eyebrow: 'WEB · STOREFRONT',
    title: 'Clothing storefront concept',
    description: 'A compact storefront demo exploring product presentation and a simple shopping flow.',
    artLabel: 'WEB / COMMERCE',
    action: { label: 'Open storefront', href: 'http://ncaliforniatestbucket.s3-website-us-west-1.amazonaws.com/' },
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

function Projects() {
  const [filter, setFilter] = useState(() => (window.location.hash === '#games' ? 'game' : 'all'));
  const [pubnubOpen, setPubnubOpen] = useState(false);
  const visibleItems = WORK_ITEMS.filter((item) => filter === 'all' || item.kind === filter);

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
            {FILTERS.map((item) => (
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
          <span className="work-count" aria-live="polite">{visibleItems.length} {visibleItems.length === 1 ? 'piece' : 'pieces'}</span>
        </div>

        <div id="work-results" className="work-grid">
          {visibleItems.map((item) => (
            <article className={`work-card work-card--${item.kind}`} key={item.id}>
              <div className={`work-card-art ${item.imageClass || ''}`}>
                {item.image ? (
                  <img src={item.image} alt={item.imageAlt || ''} loading="lazy" decoding="async" />
                ) : (
                  <span>{item.artLabel}</span>
                )}
                <span className="work-card-kind">{item.kind === 'game' ? 'GAME' : 'PROJECT'}</span>
              </div>
              <div className="work-card-content">
                <p className="work-card-eyebrow">{item.eyebrow}</p>
                <h2>{item.title}</h2>
                <p className="work-card-description">{item.description}</p>
                <div className="work-card-actions">
                  {item.action && <WorkAction action={item.action} />}
                  {item.actions?.map((action) => <WorkAction action={action} key={action.label} />)}
                  {item.demo && (
                    <button
                      type="button"
                      className="work-card-action"
                      aria-expanded={pubnubOpen}
                      aria-controls="pubnub-demo"
                      onClick={() => setPubnubOpen((open) => !open)}
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
          ))}
        </div>
      </section>
      <footer className="work-footer">A SMALL SELECTION OF THINGS MADE WITH CURIOSITY.</footer>
    </main>
  );
}

export default Projects;
