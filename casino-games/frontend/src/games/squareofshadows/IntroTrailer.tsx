import { useCallback, useEffect, useRef, useState } from 'react';
import { setMusicEnabled } from './audio';

/**
 * First-run intro trailer.
 *
 * Shown when the Square of Shadows screen is opened, until the player skips it.
 * Skipping is remembered; watching it through is not — so it replays on every
 * visit right up until somebody says no, which is what "every visit until
 * skipped" has to mean.
 *
 * ## The one rule
 *
 * This must never be able to strand somebody on a black screen. There is
 * therefore no path through this component that can fail closed:
 *
 *  - a video that errors or times out dismisses it,
 *  - `prefers-reduced-motion` skips it outright,
 *  - a previously-skipped player never sees it at all,
 *  - Escape, the Skip button and the `ended` event all lead to the same fade.
 *
 * The gate is not decoration. Browsers refuse to autoplay media with sound
 * until the user has interacted with the page, so a "press to begin" screen is
 * the only way this trailer can be heard. It is also the AAA convention, and it
 * doubles as the gesture that unlocks the game's own audio afterwards.
 */

const TRAILER_SRC = publicAsset('/video/casino-trailer.mp4');
const SKIP_KEY = 'c888_sos_intro_skipped';

/**
 * Hard ceiling on how long the trailer may hold the screen.
 *
 * The file is 30s. A slow connection can stretch that well past a minute, and a
 * video that stalls on its last frame with no `ended` event would otherwise sit
 * there indefinitely. This is the backstop for that; the Skip button is the
 * front door.
 */
const MAX_TRAILER_MS = 90_000;

/** How long the hand-off to the game takes. Long enough to read as a dissolve. */
const FADE_MS = 900;

type Phase = 'gate' | 'playing' | 'leaving';

const readSkipped = (): boolean => {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    // Private mode / storage disabled: show it every visit rather than never.
    return false;
  }
};

const rememberSkipped = () => {
  try {
    localStorage.setItem(SKIP_KEY, '1');
  } catch {
    /* nothing to do; it simply shows again next visit */
  }
};

const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export default function IntroTrailer({
  onDismiss,
  replayToken = 0,
}: {
  onDismiss?: () => void;
  /**
   * Bump this to show the trailer again on demand.
   *
   * The first-visit gate reads `localStorage`, so a player who skipped the
   * trailer could never get it back. The main menu's "Play Intro" bumps this
   * counter, which forces the trailer to mount regardless of what is stored —
   * and unlike the automatic first visit, an explicit request is honoured even
   * under `prefers-reduced-motion`, because the player asked for it by name.
   */
  replayToken?: number;
}) {
  // `null` means "not showing at all" — decided before the first paint so a
  // returning player never sees a flash of the gate.
  const [phase, setPhase] = useState<Phase | null>(() => {
    if (typeof window === 'undefined') return null;
    if (readSkipped() || prefersReducedMotion()) return null;
    return 'gate';
  });
  const lastReplayToken = useRef(replayToken);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const leaveTimer = useRef<number | null>(null);

  const finish = useCallback(
    (skipped: boolean) => {
      if (leaveTimer.current !== null) return;
      if (skipped) rememberSkipped();
      videoRef.current?.pause();
      setPhase('leaving');
      leaveTimer.current = window.setTimeout(() => {
        leaveTimer.current = null;
        setPhase(null);
        onDismiss?.();
      }, FADE_MS);
    },
    [onDismiss],
  );

  const skip = useCallback(() => finish(true), [finish]);

  /*
   * An explicit replay from the menu.
   *
   * Keyed on the token rather than a boolean so it only fires when the player
   * actually asks: a second press while the trailer is already up would
   * otherwise restart it from the gate mid-watch.
   */
  useEffect(() => {
    if (replayToken === lastReplayToken.current) return;
    lastReplayToken.current = replayToken;
    if (phase !== null) return;
    setPhase('gate');
  }, [replayToken, phase]);

  // Keep the game's own music out from under the trailer. The gate click is a
  // real gesture, so the audio module would otherwise unlock and start the menu
  // loop on top of the trailer's soundtrack.
  useEffect(() => {
    if (phase === null) return undefined;
    setMusicEnabled(false);
    return () => setMusicEnabled(true);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'playing') return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    // Muted is not the plan — the gate already unlocked it. `play()` is still
    // awaited so a rejection here is visible in development rather than
    // silently producing a silent frame that never ends.
    const attempt = video.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => finish(false));
    }
    // The backstop for a stream that stalls on its final frame and never fires
    // `ended`, which would otherwise hold the screen forever.
    const hardStop = window.setTimeout(() => finish(true), MAX_TRAILER_MS);
    return () => window.clearTimeout(hardStop);
  }, [phase, finish]);

  // Escape skips. A cinematic that cannot be escaped is a cage, not a trailer.
  useEffect(() => {
    if (phase === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, skip]);

  if (phase === null) return null;

  return (
    <div
      className={`sos-intro is-${phase}`}
      role="dialog"
      aria-modal="true"
      aria-label="Square of Shadows trailer"
      data-testid="sos-intro"
    >
      <video
        ref={videoRef}
        className="sos-intro-video"
        src={TRAILER_SRC}
        preload="auto"
        playsInline
        // The trailer carries its own soundtrack; the element must not be muted
        // or the "Press to Begin" gate buys nothing.
        onEnded={() => finish(false)}
        onError={() => finish(true)}
        // Cover, never letterbox-free: the source is 16:9 and phones are not.
        style={{ objectFit: 'cover' }}
      />

      {/*
        The vignette. Two jobs — it hides the seam where the video's own black
        bars meet the page, and it keeps white overlaid text legible over any
        frame the trailer happens to cut to.
      */}
      <div className="sos-intro-vignette" aria-hidden="true" />

      {phase === 'gate' && (
        <button type="button" className="sos-intro-gate" onClick={() => setPhase('playing')}>
          <img
            src={publicAsset('/sprites/sos-pixellab/gothic-altar.png')}
            alt=""
            className="sos-intro-gate-art"
          />
          <span className="sos-intro-gate-title">Square of Shadows</span>
          <span className="sos-intro-gate-cta">Press to Begin</span>
        </button>
      )}

      <button type="button" className="sos-intro-skip" onClick={skip}>
        Skip <span aria-hidden="true">››</span>
      </button>
    </div>
  );
}

export { MAX_TRAILER_MS };
import { publicAsset } from '../../utils/publicAsset';
