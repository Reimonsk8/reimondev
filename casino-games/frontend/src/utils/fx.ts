import { soundManager } from './audio';

const PALETTE = ['#f7c948', '#ff6b81', '#4fd1c5', '#a78bfa', '#60a5fa', '#f472b6', '#fbbf24', '#34d399'];

let layer: HTMLDivElement | null = null;

const ensureLayer = () => {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.id = 'fx-layer';
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;';
  document.body.appendChild(layer);
  return layer;
};

const flash = (className: string, ms = 600) => {
  const el = document.createElement('div');
  el.className = className;
  el.style.cssText = 'position:absolute;inset:0;';
  ensureLayer().appendChild(el);
  setTimeout(() => el.remove(), ms);
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const burstConfetti = (count = 90) => {
  if (prefersReducedMotion()) return;
  const root = ensureLayer();
  const w = window.innerWidth;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    const size = 6 + Math.random() * 8;
    p.style.cssText = `position:absolute;left:${Math.random() * w}px;top:-16px;width:${size}px;height:${size * (Math.random() > 0.5 ? 1 : 0.45)}px;background:${PALETTE[i % PALETTE.length]};border-radius:${Math.random() > 0.5 ? '50%' : '2px'};opacity:${0.7 + Math.random() * 0.3};animation:fx-confetti ${1.1 + Math.random() * 1.2}s ease-out forwards;`;
    p.style.setProperty('--fx-fall-x', `${(Math.random() * 220 - 110).toFixed(0)}px`);
    p.addEventListener('animationend', () => p.remove());
    root.appendChild(p);
  }
};

export const celebrate = () => {
  soundManager.playWin();
  flash('fx-flash-win');
  burstConfetti(90);
};

export const bustFlash = () => {
  soundManager.playLose();
  flash('fx-flash-lose');
};

export const spinSound = (duration = 0.8) => {
  soundManager.playSpin(duration);
};

// A single chip arcs from the click point and lands on the felt. Used by every
// game's shared BetControl, so one call site covers all bet placements.
export const chipFly = (clientX?: number, clientY?: number) => {
  if (prefersReducedMotion()) return;
  const root = ensureLayer();
  const el = document.createElement('div');
  const size = 26;
  el.style.cssText = `position:absolute;width:${size}px;height:${size}px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#ffd56b,#e77700 60%,#8a4d00);box-shadow:0 4px 10px rgba(0,0,0,.45),inset 0 0 0 4px rgba(255,215,0,.35);opacity:0;`;
  const sx = clientX ?? window.innerWidth / 2;
  const sy = clientY ?? window.innerHeight - 60;
  const tx = window.innerWidth / 2 + (Math.random() - 0.5) * 180;
  const ty = window.innerHeight * 0.55;
  el.style.left = `${sx - size / 2}px`;
  el.style.top = `${sy - size / 2}px`;
  const anim = el.animate(
    [
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate(${(tx - sx) * 0.5}px, ${ty - sy - 130}px) scale(1.15) rotate(400deg)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${tx - sx}px, ${ty - sy}px) scale(0.55) rotate(760deg)`, opacity: 0 },
    ],
    { duration: 650, easing: 'cubic-bezier(.3,.6,.5,1)', fill: 'forwards' }
  );
  anim.addEventListener('finish', () => el.remove());
  root.appendChild(el);
  soundManager.playChip();
};
