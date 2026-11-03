import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, CircleHelp, Maximize2, Minimize2 } from 'lucide-react';
import FitToContainer from './FitToContainer';
import { publicAsset } from '../utils/publicAsset';

interface GameShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  history?: string[];
  historyTitle?: string;
  instructionsTitle?: string;
  instructionsBody?: string;
  /** Public sprite-sheet name under /sprites/ for the game's generated art
   *  (e.g. 'blackjack'); shown as a medallion next to the game title. */
  emblem?: string;
  onClose?: () => void;
}

export default function GameShell({
  title,
  subtitle,
  children,
  history,
  historyTitle,
  instructionsTitle,
  instructionsBody,
  emblem,
  onClose,
}: GameShellProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instructionsButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeInstructionsRef = useRef<HTMLButtonElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const instructionsTitleId = useId();

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch(() => undefined);
    } else {
      document.exitFullscreen?.().catch(() => undefined);
    }
  };

  useEffect(() => {
    const handleChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  useEffect(() => {
    if (!showInstructions) return;
    closeInstructionsRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setShowInstructions(false);
      instructionsButtonRef.current?.focus();
    };
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [showInstructions]);

  return (
    <div ref={containerRef} className={`game-shell ${isFullscreen ? 'is-fullscreen' : ''}`}>
      <div className="game-shell-header">
        <div className="game-shell-heading">
          {emblem && (
            <img
              src={publicAsset(`/sprites/${emblem}/sprite-sheet-alpha.png`)}
              alt=""
              aria-hidden="true"
              className="game-shell-emblem"
              loading="lazy"
            />
          )}
          <p className="eyebrow">{title}</p>
          {subtitle && <p className="text-muted small">{subtitle}</p>}
        </div>
        <div className="game-shell-actions">
          {onClose && (
            <button type="button" className="ghost-button game-shell-action" onClick={onClose}>
              <ArrowLeft size={17} aria-hidden="true" /> <span>Lobby</span>
            </button>
          )}
          {instructionsTitle && instructionsBody && (
            <button ref={instructionsButtonRef} type="button" className="ghost-button game-shell-action" onClick={() => setShowInstructions(true)} aria-label={`How to play ${title}`}>
              <CircleHelp size={18} aria-hidden="true" /> <span>Rules</span>
            </button>
          )}
          {document.fullscreenEnabled && (
            <button type="button" className="ghost-button game-shell-action" onClick={toggleFullscreen} aria-pressed={isFullscreen}>
              {isFullscreen ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
              <span>{isFullscreen ? 'Exit' : 'Fullscreen'}</span>
            </button>
          )}
        </div>
      </div>
      <div className="table-shell">
        <div className="table-stage">
          <div className="table-grid" aria-hidden="true" />
          <div className="table-content">
            <FitToContainer>{children}</FitToContainer>
          </div>
        </div>
      </div>
      {showInstructions && instructionsTitle && instructionsBody && (
        <div className="instructions-overlay" role="dialog" aria-modal="true" aria-labelledby={instructionsTitleId}>
          <div className="instructions-card">
            <h3 id={instructionsTitleId}>{instructionsTitle}</h3>
            <p>{instructionsBody}</p>
            <button ref={closeInstructionsRef} type="button" className="ghost-button" onClick={() => { setShowInstructions(false); instructionsButtonRef.current?.focus(); }}>
              Got it
            </button>
          </div>
        </div>
      )}
      {history && history.length > 0 && (
        <div className="game-shell-history">
          <h4>{historyTitle ?? 'Result History'}</h4>
          <ul>
            {history.map((entry, index) => (
              <li key={`${entry}-${index}`}>{entry}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
