import { Skull } from 'lucide-react';

export interface MainScreenProps {
  activePlayers: number;
  capacity?: number;
  level: number;
  xp: number;
  xpNext: number;
  sectorName: string;
  outpostName: string;
  threatLabel?: string;
  onDeploy?: () => void;
  deployDisabled?: boolean;
  deployLabel?: string;
}

/**
 * Streamlined tactical lobby / main screen (replaces the complex map overlay).
 * Shows only: active player count, survivor level + XP, and the current sector +
 * target outpost name.
 */
export function MainScreen({
  activePlayers,
  capacity = 8,
  level,
  xp,
  xpNext,
  sectorName,
  outpostName,
  threatLabel,
  onDeploy,
  deployDisabled,
  deployLabel = 'Deploy into Quarantine Sector',
}: MainScreenProps) {
  const xpPct = Math.max(0, Math.min(100, (xp / Math.max(1, xpNext)) * 100));
  return (
    <div className="outlands-modal-backdrop" role="dialog" aria-modal="true">
      <div className="outlands-modal outlands-main-screen">
        <div className="outlands-modal-eyebrow">
          <Skull size={14} />
          <span>{threatLabel ?? 'Sector 09 · Outlands'}</span>
        </div>
        <h1>Outlands</h1>

        <div className="outlands-main-grid">
          <div className="outlands-main-card">
            <span className="outlands-main-label">Active Survivors</span>
            <strong className="outlands-main-value">
              {activePlayers}/{capacity}
            </strong>
          </div>
          <div className="outlands-main-card">
            <span className="outlands-main-label">Survivor Level</span>
            <strong className="outlands-main-value">Lv.{level}</strong>
            <div className="outlands-bar outlands-bar-slim">
              <div className="outlands-bar-fill" style={{ width: `${xpPct}%` }} />
            </div>
            <span className="outlands-main-sub">
              {xp}/{xpNext} XP
            </span>
          </div>
          <div className="outlands-main-card">
            <span className="outlands-main-label">Sector</span>
            <strong className="outlands-main-value">{sectorName}</strong>
            <span className="outlands-main-sub">Target outpost: {outpostName}</span>
          </div>
        </div>

        {onDeploy && (
          <div className="outlands-modal-actions">
            <button
              type="button"
              className="outlands-btn outlands-btn-primary outlands-deploy"
              onClick={onDeploy}
              disabled={deployDisabled}
            >
              {deployLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
