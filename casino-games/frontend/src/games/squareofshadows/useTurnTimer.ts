import { useEffect, useRef, useState } from 'react';

/**
 * Per-turn countdown for Square of Shadows.
 *
 * The clock is keyed on `turnKey` so it resets whenever initiative actually
 * changes hands (new turn number, or the active player swapped) rather than on
 * every render. `onExpire` fires exactly once per turn, which is what makes the
 * "you ran out of time, your turn is skipped" rule safe to drive off it.
 *
 * `remaining` is derived from an absolute deadline instead of a decremented
 * counter so a throttled background tab cannot drift the clock: when the tab
 * wakes up, the first recompute already reflects real elapsed time.
 */
export const TURN_SECONDS = 180;

/** Warn (colour shift) under this many seconds. */
export const TURN_URGENT_SECONDS = 30;

/** Pulse the warning under this many seconds. */
export const TURN_CRITICAL_SECONDS = 10;

export interface TurnTimer {
  /** Whole seconds left, clamped to >= 0. */
  remaining: number;
  /** 0..1 progress through the turn, for a ring/bar fill. */
  fraction: number;
  /** Under TURN_URGENT_SECONDS. */
  isUrgent: boolean;
  /** Under TURN_CRITICAL_SECONDS. */
  isCritical: boolean;
}

const EMPTY: TurnTimer = {
  remaining: TURN_SECONDS,
  fraction: 1,
  isUrgent: false,
  isCritical: false,
};

export function useTurnTimer({
  active,
  turnKey,
  onExpire,
  seconds = TURN_SECONDS,
}: {
  /** Only run the clock while a turn genuinely belongs to this client. */
  active: boolean;
  /** Changing this restarts the countdown (e.g. `${turnNumber}:${activePlayerId}`). */
  turnKey: string | number | null;
  onExpire: () => void;
  seconds?: number;
}): TurnTimer {
  const [timer, setTimer] = useState<TurnTimer>(EMPTY);
  const deadlineRef = useRef<number>(0);
  const firedRef = useRef(false);
  // Keep the latest callback without making the interval depend on it, so a
  // caller passing an inline arrow does not restart the clock every render.
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!active || turnKey === null) {
      deadlineRef.current = 0;
      firedRef.current = false;
      setTimer({ ...EMPTY, remaining: seconds, fraction: 1 });
      return undefined;
    }

    deadlineRef.current = Date.now() + seconds * 1000;
    firedRef.current = false;

    const tick = () => {
      const left = Math.max(0, deadlineRef.current - Date.now());
      const whole = Math.ceil(left / 1000);
      setTimer({
        remaining: whole,
        fraction: Math.max(0, Math.min(1, left / (seconds * 1000))),
        isUrgent: left <= TURN_URGENT_SECONDS * 1000,
        isCritical: left <= TURN_CRITICAL_SECONDS * 1000,
      });
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current();
      }
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [active, turnKey, seconds]);

  return timer;
}

/** mm:ss for the timer readout. */
export function formatTurnClock(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}