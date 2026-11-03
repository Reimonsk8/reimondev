import type { CSSProperties } from 'react';
import { getWeaponHotbarIconUrl } from '../engine/assets';
import type { WeaponId, WeaponState } from '../engine/types';

/**
 * Tactical Dark Survival HUD (`/ui/HUD.tsx`).
 *
 * Directive 3:
 * - Zero debug overlay text boxes or SaaS banners.
 * - Bottom-left compact vitals panel (Hull, Stamina, Armor, Hunger/Infection) in dark metal frame.
 * - Crisp nearest-neighbor (`image-rendering: pixelated` / `PIXI.SCALE_MODES.NEAREST`) 32×32 weapon
 *   hotbar slots with ammo counters cleanly overlayed in the bottom-right corner of each slot.
 */
export interface TacticalHudProps {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  hunger: number;
  maxHunger: number;
  armorName: string;
  armorAbsorption: number;
  armorDurability: number;
  armorMaxDurability: number;
  infected: boolean;
  infectionSeverity: number;
  flashlightOn: boolean;
  focusFactor: number;
  reloading: boolean;
  activeWeapon: WeaponId;
  weaponName: string;
  weapons: Record<WeaponId, WeaponState>;
  /** Slot 0/1 firearms; the melee slot is always rendered first. */
  loadout: [WeaponId, WeaponId];
  onSwitchWeapon: (weaponId: WeaponId) => void;
  onQuickUse: (category: 'med' | 'food' | 'antiviral' | 'armor') => void;
}

const WEAPON_SPRITE_ICONS: Partial<Record<WeaponId, string>> = {
  shotgun: publicAsset('/sprites/outlands/weapon_shotgun.png'),
  melee: publicAsset('/sprites/outlands/weapon_machete.png'),
};

const NEAREST_NEIGHBOR_STYLE: CSSProperties = {
  imageRendering: 'pixelated',
  width: 32,
  height: 32,
  display: 'block',
};

function PixelWeaponGlyph({ weaponId }: { weaponId: WeaponId }) {
  const spriteUrl = WEAPON_SPRITE_ICONS[weaponId] ?? getWeaponHotbarIconUrl(weaponId);
  if (spriteUrl) {
    return (
      <img
        src={spriteUrl}
        alt={weaponId}
        width={32}
        height={32}
        draggable={false}
        style={NEAREST_NEIGHBOR_STYLE}
        className="outlands-hotbar-pixel-icon"
      />
    );
  }

  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 16 16"
      style={NEAREST_NEIGHBOR_STYLE}
      className="outlands-hotbar-pixel-icon"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {weaponId === 'rifle' && (
        <>
          <rect x="1" y="7" width="4" height="3" fill="#6b7280" />
          <rect x="5" y="6" width="6" height="3" fill="#9ca3af" />
          <rect x="11" y="7" width="4" height="1" fill="#d1d5db" />
          <rect x="7" y="9" width="2" height="3" fill="#4b5563" />
        </>
      )}
      {weaponId === 'pistol' && (
        <>
          <rect x="4" y="6" width="7" height="3" fill="#9ca3af" />
          <rect x="11" y="6" width="2" height="2" fill="#d1d5db" />
          <rect x="5" y="9" width="3" height="4" fill="#78350f" />
        </>
      )}
      {weaponId === 'smg' && (
        <>
          <rect x="3" y="6" width="8" height="3" fill="#94a3b8" />
          <rect x="11" y="7" width="3" height="1" fill="#cbd5e1" />
          <rect x="8" y="9" width="2" height="4" fill="#475569" />
          <rect x="4" y="9" width="2" height="3" fill="#334155" />
        </>
      )}
      {weaponId === 'sniper' && (
        <>
          <rect x="1" y="7" width="4" height="3" fill="#78350f" />
          <rect x="5" y="7" width="10" height="2" fill="#94a3b8" />
          <rect x="6" y="5" width="5" height="1" fill="#38bdf8" />
        </>
      )}
      {weaponId === 'heavy' && (
        <>
          <rect x="2" y="6" width="5" height="5" fill="#475569" />
          <rect x="7" y="6" width="7" height="1" fill="#f59e0b" />
          <rect x="7" y="8" width="7" height="1" fill="#fbbf24" />
          <rect x="7" y="10" width="7" height="1" fill="#f59e0b" />
        </>
      )}
    </svg>
  );
}

function PixelVitalIcon({ kind }: { kind: 'hp' | 'stamina' | 'armor' | 'hunger' }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      className="outlands-pixel-vital-svg"
      aria-hidden="true"
    >
      {kind === 'hp' && (
        <path
          d="M1 2h2v1h2V2h2v2H6v1H5v1H3V5H2V4H1V2z"
          fill="#ef4444"
        />
      )}
      {kind === 'stamina' && (
        <path d="M4 1h2L4 4h2L3 7V4H2l2-3z" fill="#38bdf8" />
      )}
      {kind === 'armor' && (
        <path d="M1 1h6v3H6v2H4v1H2V6H1V1z" fill="#60a5fa" />
      )}
      {kind === 'hunger' && (
        <path d="M2 1h4v2H5v4H3V3H2V1z" fill="#f59e0b" />
      )}
    </svg>
  );
}

export function HUD(props: TacticalHudProps) {
  const healthPct = Math.max(0, Math.min(100, (props.health / Math.max(1, props.maxHealth)) * 100));
  const staminaPct = Math.max(
    0,
    Math.min(100, (props.stamina / Math.max(1, props.maxStamina)) * 100),
  );
  const armorPct = Math.max(
    0,
    Math.min(100, (props.armorDurability / Math.max(1, props.armorMaxDurability)) * 100),
  );
  const hungerPct = Math.max(
    0,
    Math.min(100, (props.hunger / Math.max(1, props.maxHunger)) * 100),
  );

  return (
    <div className="outlands-bottombar outlands-hud">
      {/* Compact Bottom-Left Vitals Cluster (Health, Stamina, Armor, Hunger) */}
      <div className="outlands-vitals-card outlands-metal-frame">
        <div className="outlands-vital-compact-grid">
          <div className={`outlands-vital-cell ${healthPct <= 25 ? 'is-critical' : ''}`}>
            <div className="outlands-vital-head">
              <span className="outlands-vital-label">
                <PixelVitalIcon kind="hp" /> HULL
              </span>
              <span className="outlands-vital-value">
                {props.health}/{props.maxHealth}
              </span>
              <button
                type="button"
                className="outlands-mini-btn"
                onClick={() => props.onQuickUse('med')}
                title="Use Bandage / Medkit [H]"
              >
                [H]
              </button>
            </div>
            <div className="outlands-bar outlands-bar-slim">
              <div
                className="outlands-bar-fill outlands-bar-health"
                style={{ width: `${healthPct}%` }}
              />
            </div>
          </div>

          <div className="outlands-vital-cell">
            <div className="outlands-vital-head">
              <span className="outlands-vital-label">
                <PixelVitalIcon kind="stamina" /> STAM
              </span>
              <span className="outlands-vital-value">
                {props.stamina}/{props.maxStamina}
              </span>
            </div>
            <div className="outlands-bar outlands-bar-slim">
              <div
                className="outlands-bar-fill"
                style={{
                  width: `${staminaPct}%`,
                  background: 'linear-gradient(90deg, #0284c7, #38bdf8)',
                }}
              />
            </div>
          </div>

          <div className="outlands-vital-cell">
            <div className="outlands-vital-head">
              <span className="outlands-vital-label">
                <PixelVitalIcon kind="armor" /> {props.armorName}
              </span>
              <span className="outlands-vital-value">
                {props.armorDurability}/{props.armorMaxDurability}
              </span>
              <button
                type="button"
                className="outlands-mini-btn"
                onClick={() => props.onQuickUse('armor')}
                title="Patch Armor [G]"
              >
                [G]
              </button>
            </div>
            <div className="outlands-bar outlands-bar-slim">
              <div
                className="outlands-bar-fill outlands-bar-armor"
                style={{ width: `${armorPct}%` }}
              />
            </div>
          </div>

          <div
            className={`outlands-vital-cell ${props.infected || hungerPct <= 15 ? 'is-critical' : ''}`}
          >
            <div className="outlands-vital-head">
              <span className="outlands-vital-label">
                <PixelVitalIcon kind="hunger" /> KCAL
              </span>
              <span
                className={`outlands-vital-value ${props.infected ? 'outlands-bio-infected' : ''}`}
              >
                {props.infected ? `INF ${props.infectionSeverity}%` : `${props.hunger}%`}
              </span>
              <button
                type="button"
                className="outlands-mini-btn"
                onClick={() => props.onQuickUse('food')}
                title="Eat Ration [J]"
              >
                [J]
              </button>
              {props.infected && (
                <button
                  type="button"
                  className="outlands-mini-btn is-bio"
                  onClick={() => props.onQuickUse('antiviral')}
                  title="Inject Antiviral [V]"
                >
                  [V]
                </button>
              )}
            </div>
            <div className="outlands-bar outlands-bar-slim">
              <div
                className="outlands-bar-fill"
                style={{
                  width: `${hungerPct}%`,
                  background: 'linear-gradient(90deg, #b45309, #f59e0b)',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Compact three-slot weapon strip with nearest-neighbor icons and ammo counts. */}
      <div className="outlands-weapons-card outlands-metal-frame">
        <div className="outlands-weapons-grid outlands-weapon-switch outlands-hotbar-slots">
          {(['melee', props.loadout[0], props.loadout[1]] as WeaponId[]).map((id, idx) => {
            const w = props.weapons[id];
            const isSelected = props.activeWeapon === id;
            return (
              <button
                key={id}
                type="button"
                className={`outlands-weapon-slot outlands-hotbar-slot ${isSelected ? 'is-active' : ''}`}
                onClick={() => props.onSwitchWeapon(id)}
                title={`${w.name} [${idx + 1}]`}
              >
                <span className="outlands-weapon-key">{idx + 1}</span>
                <div className="outlands-hotbar-icon-box">
                  <PixelWeaponGlyph weaponId={id} />
                </div>
                <span className="outlands-hotbar-ammo-badge">
                  {w.isMelee ? '∞' : `${w.ammo}/${w.reserve}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
}
import { publicAsset } from '../../../utils/publicAsset';
