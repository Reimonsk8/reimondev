import type { UnitType } from './engine';

type IconKind = 'move' | 'act' | 'attack';
type AttackIcon = 'punch' | 'sword' | 'bow' | 'staff' | 'mace' | 'claw' | 'spit';

const ATTACK_ICON: Record<UnitType, AttackIcon> = {
  WARRIOR: 'sword',
  RANGER: 'bow',
  WIZARD: 'staff',
  CLERIC: 'mace',
  // The monsters bite and spit. They have no other glyph because they have no
  // other action.
  BEAST: 'claw',
  SPITTER: 'spit',
  PALADIN: 'sword',
  BARD: 'staff',
  WARLOCK: 'staff',
  DRUID: 'mace',
  ROGUE: 'bow',
};

/** Small, hand-drawn 32px pixel-art glyphs for the selected-unit action menu. */
export function SosActionIcon({
  kind,
  unitType,
  size = 32,
}: {
  kind: IconKind;
  unitType?: UnitType;
  size?: number;
}) {
  const icon = kind === 'attack' ? (unitType ? ATTACK_ICON[unitType] : 'punch') : kind;

  return (
    <svg
      className="sos-action-icon"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      shapeRendering="crispEdges"
      data-icon={icon}
      aria-hidden="true"
      focusable="false"
    >
      {icon === 'move' && (
        <>
          {/* Two staggered bootprints: move reads as movement, not another weapon. */}
          <path d="M7 4h5v3h3v6h-2v3H7v-3H5V8h2zM21 17h5v3h3v6h-2v3h-6v-3h-2v-5h2z" fill="#2b2034" />
          <path d="M8 5h3v4h3v4H8v-2H6V9h2zM22 18h3v4h3v4h-6v-2h-2v-3h2z" fill="#74d8cb" />
          <path d="M9 6h1v2H9zM23 19h1v2h-1z" fill="#e9fff6" />
        </>
      )}
      {icon === 'act' && (
        <>
          {/* Crossed steel with a center spark: the action/targeting mode. */}
          <path d="M6 4h4v4h3v3h3v3h3v3h3v3h4v4h-5v-3h-3v-3h-3v-3h-3v-3h-3v-3H6z" fill="#2b2034" />
          <path d="M7 5h2v3h3v3h3v3h3v3h3v3h3v2h-2v-2h-3v-3h-3v-3h-3v-3h-3v-3H7z" fill="#dfd2ec" />
          <path d="M22 4h4v5h-3v3h-3v3h-3v3h-3v3h-3v3H6v-4h4v-3h3v-3h3v-3h3v-3h3z" fill="#2b2034" />
          <path d="M23 5h2v3h-2v3h-3v3h-3v3h-3v3h-3v2H8v-2h3v-3h3v-3h3v-3h3v-3h3z" fill="#c8a6ff" />
          <path d="M14 14h4v4h-4z" fill="#f0d77b" />
        </>
      )}
      {icon === 'punch' && (
        <>
          {/* Fallback for an unassigned class: a gauntlet fist. */}
          <path d="M8 13h3V8h4v4h2V6h4v6h2V9h4v9l-3 7H12l-4-4z" fill="#2b2034" />
          <path d="M9 14h3V9h2v6h3V7h2v8h3v-5h2v8l-2 5H13l-3-3z" fill="#d7c7e8" />
          <path d="M12 18h10v2H12zM14 10h1v3h-1zM19 8h1v4h-1z" fill="#f0d77b" />
        </>
      )}
      {icon === 'sword' && (
        <>
          {/* Warrior's straight sword. */}
          <path d="M21 3h6v6h-2v5h-2v5h-2v3h-4v-4h2v-5h2v-5h2V7h-2zM5 20h9v3h-3v5H8v-5H5z" fill="#2b2034" />
          <path d="M22 4h4v4h-2v5h-2v5h-2v3h-2v-2h2v-5h2v-5h2V7h-2z" fill="#d7c7e8" />
          <path d="M6 21h7v1H6zM9 23h1v4H9z" fill="#f0d77b" />
          <path d="M23 5h1v2h-1z" fill="#fff6d5" />
        </>
      )}
      {icon === 'bow' && (
        <>
          {/* Ranger's recurved bow and nocked arrow. */}
          <path d="M9 3h4v4h3v4h2v10h-2v4h-3v4H9v-4h3v-4h2v-4h2v-6h-2V9h-2V6H9z" fill="#2b2034" />
          <path d="M10 4h2v4h3v4h2v8h-2v4h-3v4h-2v-2h2v-3h2v-4h2v-6h-2V9h-2V6h-2z" fill="#c39b67" />
          <path d="M8 15h16v2H8zM21 12l5 4-5 4v-3h-8v-2h8z" fill="#dfd2ec" />
          <path d="M10 15h2v2h-2zM24 15h2v2h-2z" fill="#f0d77b" />
        </>
      )}
      {icon === 'staff' && (
        <>
          {/* Wizard's rune staff with a violet crystal. */}
          <path d="M8 24h4v3H8zM11 20h4v4h-4zM14 16h4v4h-4zM17 12h4v4h-4zM20 8h4v4h-4z" fill="#2b2034" />
          <path d="M9 24h2v2H9zM12 20h2v3h-2zM15 16h2v3h-2zM18 12h2v3h-2zM21 8h2v3h-2z" fill="#c39b67" />
          <path d="M20 3h4v2h3v4h-3v3h-4V9h-3V5h3z" fill="#2b2034" />
          <path d="M21 4h2v2h2v2h-2v2h-2V8h-2V6h2z" fill="#c8a6ff" />
          <path d="M21 5h1v2h-1z" fill="#fff6d5" />
        </>
      )}
      {icon === 'mace' && (
        <>
          {/* Cleric's flanged mace, gold-lit at the head. */}
          <path d="M9 25h4v3H9zM12 21h4v4h-4zM15 17h4v4h-4zM18 13h4v4h-4z" fill="#2b2034" />
          <path d="M10 25h2v2h-2zM13 21h2v3h-2zM16 17h2v3h-2zM19 13h2v3h-2z" fill="#c39b67" />
          <path d="M17 4h4V2h5v3h3v7h-3v3h-5v-2h-4v-3h-2V7h2z" fill="#2b2034" />
          <path d="M18 5h3V3h4v3h2v5h-2v2h-4v-2h-3V9h-2V7h2z" fill="#d7c7e8" />
          <path d="M21 6h3v2h-3zM23 9h3v2h-3zM18 7h1v2h-1z" fill="#f0d77b" />
        </>
      )}
      {icon === 'claw' && (
        <>
          {/* Beast's claw: three hooked talons raking across the tile. */}
          <path d="M4 26h24v3H4zM6 12l5 3v3l-5-3zM12 8l5 4v3l-5-4zM18 6l5 5v3l-5-5z" fill="#2b2034" />
          <path d="M6 23h20v2H6zM7 11l6 4-1 1-6-4zM13 7l6 5-1 1-6-5zM19 5l6 6-1 1-6-6z" fill="#cbb6e8" />
          <path d="M10 19h2v5h-2zM15 18h2v6h-2zM20 18h2v6h-2z" fill="#7a3ab0" />
          <path d="M24 11h2v2h-2z" fill="#f0d77b" />
        </>
      )}
      {icon === 'spit' && (
        <>
          {/* Spitter's acid glob arcing out of a maw, violet-lit like the monsters. */}
          <path d="M4 22h9v3H4zM8 18h6v4H8z" fill="#2b2034" />
          <path d="M5 21h7v2H5zM9 18h4v2H9z" fill="#5a3a7a" />
          <path d="M17 8h7v3h3v7h-3v3h-7v-3h-3v-7h3z" fill="#2b2034" />
          <path d="M18 9h5v2h3v5h-3v2h-5v-2h-3v-5h3z" fill="#9d6fd6" />
          <path d="M19 11h3v2h-3zM22 13h3v2h-3z" fill="#c9a6f5" />
          <path d="M13 25h3v2h-3z" fill="#f0d77b" />
        </>
      )}
    </svg>
  );
}
