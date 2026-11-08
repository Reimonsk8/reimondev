const PALETTE = ['#d8d8d8', '#ababab', '#f1f1f1', '#737373'];

let layer: HTMLDivElement | null = null;

const ensureLayer = () => {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.id = 'fx-layer';
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;';
  document.body.appendChild(layer);
  return layer;
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
