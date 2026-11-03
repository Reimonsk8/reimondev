import { MapPin, Users } from 'lucide-react';

export interface SafezoneEntry {
  id: string;
  name: string;
  sectorCode: string;
  tier: number;
  tierLabel: string;
  description: string;
  x: number;
  y: number;
  radius: number;
}

export const SAFEZONE_DIRECTORY: SafezoneEntry[] = [
  {
    id: 'nastya',
    name: "Nastya's Holdout",
    sectorCode: 'Block B2',
    tier: 0,
    tierLabel: 'Tier 0 — Safe Zone',
    description: 'Survivor sanctuary compound. Zero hostiles inside the perimeter. Banking, healing, and stash services.',
    x: 21,
    y: 21,
    radius: 7,
  },
  {
    id: 'pastor',
    name: 'Fort Pastor',
    sectorCode: 'Block B-1',
    tier: 1,
    tierLabel: 'Tier 1 — Inner Suburbs',
    description: 'National Guard garrison on the north highway. Light hostiles outside the wire; good early loot.',
    x: 21,
    y: -7,
    radius: 4.5,
  },
  {
    id: 'secronom',
    name: 'Secronom Bunker',
    sectorCode: 'Block D4',
    tier: 3,
    tierLabel: 'Tier 3 — Deep Bio-Core',
    description: 'Deep Outlands bio-research command. Apex mutants, top-tier loot, extreme danger.',
    x: 49,
    y: 49,
    radius: 4.5,
  },
  {
    id: 'sector09',
    name: 'Sector 09 Quarantine Perimeter',
    sectorCode: 'Block A1',
    tier: 2,
    tierLabel: 'Tier 2 — Commercial Ruins',
    description: 'Outer quarantine ring. Mid-tier hostiles, abundant containers, moderate risk.',
    x: 7,
    y: 7,
    radius: 4,
  },
];

export interface SafezoneMapModalProps {
  open: boolean;
  onClose: () => void;
  onDeploy: (entry: SafezoneEntry) => void;
  livePlayers?: number;
  capacity?: number;
  deploying?: boolean;
}

export function SafezoneMapModal({
  open,
  onClose,
  onDeploy,
  livePlayers = 0,
  capacity = 8,
  deploying = false,
}: SafezoneMapModalProps) {
  if (!open) return null;
  return (
    <div className="outlands-modal-backdrop" role="dialog" aria-modal="true">
      <div className="outlands-modal outlands-safezone-map">
        <div className="outlands-modal-eyebrow">
          <MapPin size={14} />
          <span>World Safezone Directory</span>
        </div>
        <h1>Select Safezone &amp; Spawn</h1>
        <p className="outlands-briefing-stats">
          Choose a canonical outpost to deploy into. Player count is live.
        </p>
        <div className="outlands-safezone-grid">
          {SAFEZONE_DIRECTORY.map((entry) => (
            <div key={entry.id} className="outlands-safezone-card">
              <div className="outlands-safezone-head">
                <strong>{entry.name}</strong>
                <span className="outlands-safezone-code">{entry.sectorCode}</span>
              </div>
              <div className="outlands-safezone-tier">{entry.tierLabel}</div>
              <div className="outlands-safezone-players">
                <Users size={12} />{' '}
                <span>
                  {entry.id === 'nastya' ? `${livePlayers}/${capacity}` : '—'} Survivors Online
                </span>
              </div>
              <p className="outlands-safezone-desc">{entry.description}</p>
              <button
                type="button"
                className="outlands-btn outlands-btn-primary"
                onClick={() => onDeploy(entry)}
                disabled={deploying}
              >
                Deploy Here
              </button>
            </div>
          ))}
        </div>
        <div className="outlands-modal-actions">
          <button type="button" className="outlands-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
