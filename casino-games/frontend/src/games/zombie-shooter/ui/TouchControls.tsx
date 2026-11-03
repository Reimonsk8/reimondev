import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Vec2 } from '../engine/types';

/** Must match the forced-landscape media query in zombieShooter.css. */
const FORCED_LANDSCAPE = '(orientation: portrait) and (max-width: 900px)';
const DEAD_ZONE = 0.22;

function shellIsRotated(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(FORCED_LANDSCAPE).matches;
}

/**
 * Screen point -> element-local point. The portrait shell is rotated 90° CW, so
 * the bounding rect is transposed and pointer deltas must be swapped.
 */
export function clientToLocal(el: HTMLElement, clientX: number, clientY: number): Vec2 {
  const rect = el.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (shellIsRotated()) return { x: y, y: rect.width - x };
  return { x, y };
}

/** True on phones/tablets, where the keyboard HUD is useless. */
export function useTouchUi(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    // Coarse pointer + no hover: a real touch screen, not a touch-enabled laptop.
    const query = window.matchMedia('(hover: none) and (pointer: coarse)');
    const update = () => setTouch(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return touch;
}

/** Left-thumb virtual stick. Writes a unit move vector in screen axes. */
export function TouchJoystick({ moveRef }: { moveRef: RefObject<Vec2> }) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLSpanElement | null>(null);
  const pointerRef = useRef<number | null>(null);

  const reset = () => {
    pointerRef.current = null;
    moveRef.current = { x: 0, y: 0 };
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
  };

  const track = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pad = padRef.current;
    if (!pad) return;
    const local = clientToLocal(pad, event.clientX, event.clientY);
    const radius = pad.clientWidth / 2;
    const limit = radius * 0.62;
    let dx = local.x - radius;
    let dy = local.y - radius;
    const dist = Math.hypot(dx, dy);
    if (dist > limit) {
      dx = (dx / dist) * limit;
      dy = (dy / dist) * limit;
    }
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    const held = Math.hypot(dx, dy);
    moveRef.current =
      held / limit < DEAD_ZONE || held === 0
        ? { x: 0, y: 0 }
        : { x: dx / held, y: dy / held };
  };

  return (
    <div
      ref={padRef}
      className="outlands-touch-stick"
      role="button"
      aria-label="Movement stick"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        pointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        track(event);
      }}
      onPointerMove={(event) => {
        if (pointerRef.current === event.pointerId) track(event);
      }}
      onPointerUp={(event) => {
        if (pointerRef.current === event.pointerId) reset();
      }}
      onPointerCancel={(event) => {
        if (pointerRef.current === event.pointerId) reset();
      }}
    >
      <span ref={knobRef} className="outlands-touch-knob" />
    </div>
  );
}
