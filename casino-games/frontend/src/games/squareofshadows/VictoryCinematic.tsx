import { useCallback, useEffect, useRef, useState } from 'react';
import { setMusicEnabled } from './audio';
import type { Faction } from './engine/types';

/**
 * The winning faction's victory film, played once between the last blow and the
 * battle tally.
 *
 * Same contract as the intro trailer: it must never strand the player. Error,
 * a stalled stream, Skip and `ended` all lead to the same dissolve — and the
 * caller reveals the tally on that callback, so every path ends on the stats.
 *
 * The clip is per faction, and a faction whose film has not been cut yet simply
 * 404s into `onError` — the tally appears straight away, no broken screen.
 */
const SRC: Record<Faction, string> = {
  INQUISITORS: publicAsset('/video/victory-inquisitors.mp4'),
  PENITENT_COURT: publicAsset('/video/victory-penitent-court.mp4'),
};

/** Backstop for a stream that stalls on its last frame and never fires `ended`. */
const MAX_CINEMATIC_MS = 60_000;

/** Matches the `sos-intro-dissolve` keyframe in App.css. */
const LEAVE_MS = 900;

export default function VictoryCinematic({
  faction,
  onDone,
}: {
  faction: Faction;
  onDone: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const finished = useRef(false);
  const leaveTimer = useRef<number | null>(null);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    videoRef.current?.pause();
    setLeaving(true);
    leaveTimer.current = window.setTimeout(() => onDone(), LEAVE_MS);
  }, [onDone]);

  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  // The fight's own soundtrack would play over the film.
  useEffect(() => {
    setMusicEnabled(false);
    return () => setMusicEnabled(true);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    // Unmuted first: the player has been clicking the board for a whole match,
    // which is the gesture Chrome wants. Not every browser agrees, so a
    // rejection falls back to a muted play rather than a silent black screen.
    const attempt = video.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => {
        video.muted = true;
        const muted = video.play();
        if (muted && typeof muted.catch === 'function') muted.catch(finish);
      });
    }
    const hardStop = window.setTimeout(finish, MAX_CINEMATIC_MS);
    return () => window.clearTimeout(hardStop);
  }, [finish]);

  // A cinematic that cannot be escaped is a cage.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  return (
    <div
      className={`sos-intro${leaving ? ' is-leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Victory cinematic"
      data-testid="sos-victory-cinematic"
    >
      <video
        ref={videoRef}
        className="sos-intro-video"
        src={SRC[faction]}
        preload="auto"
        playsInline
        onEnded={finish}
        onError={finish}
        style={{ objectFit: 'cover' }}
      />
      <div className="sos-intro-vignette" aria-hidden="true" />
      <button type="button" className="sos-intro-skip" onClick={finish}>
        Skip <span aria-hidden="true">››</span>
      </button>
    </div>
  );
}

export { MAX_CINEMATIC_MS };
import { publicAsset } from '../../utils/publicAsset';
