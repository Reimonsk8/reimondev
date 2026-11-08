/**
 * Retained game inventory and platform identity. The main site renders game
 * discovery in its unified /projects Work page; playable routes remain in App.
 */
export interface CatalogGame {
  /** Stable id, also used for analytics/deep links. */
  id: string;
  /** Canonical client route for the game. */
  path: string;
  title: string;
  tagline: string;
  description: string;
  /** lucide-react icon name, resolved by the catalog card. */
  icon: string;
  /** Design-system theme key used to scope the game's styles. */
  theme: string;
  /** Visual accent key, maps to a .home-card-<accent> class in App.css. */
  accent: string;
  status: 'live' | 'soon';
}

export const PLATFORM_NAME = 'ReimonDev Games';
export const PLATFORM_SHORT = 'ReimonDev';
/** Short monogram shown in the brand mark. */
export const PLATFORM_MARK = 'RD';
export const PLATFORM_TAGLINE = 'Two worlds. One adventure.';

export const GAMES: CatalogGame[] = [
  {
    id: 'square-of-shadows',
    path: '/square-of-shadows',
    title: 'Square of Shadows',
    tagline: 'Dark-fantasy tactics',
    description:
      'Command warriors, wizards, clerics and rangers on an 8x8 board. Outmaneuver your rival and claim the square.',
    icon: 'Swords',
    theme: 'sos',
    accent: 'violet',
    status: 'live',
  },
  {
    id: 'outlands',
    path: '/outlands',
    title: 'Zombie Shooter',
    tagline: 'Isometric zombie survival',
    description:
      'Step outside the S-Zone into a quarantined city sector. Scavenge, fight escalating undead variants, bank what you can carry, and survive the trip home.',
    icon: 'Skull',
    theme: 'outlands',
    accent: 'toxic',
    status: 'live',
  },
];

export function gameById(id: string): CatalogGame | undefined {
  return GAMES.find((game) => game.id === id);
}

export function gameByPath(path: string): CatalogGame | undefined {
  return GAMES.find((game) => game.path === path);
}
