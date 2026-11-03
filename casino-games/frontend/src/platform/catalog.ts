/**
 * Platform-level configuration shared by the catalog homepage and the shared
 * platform navigation. Adding a game to the catalog is a one-line change here
 * plus a matching <Route> in frontend/src/App.jsx — no other refactor needed.
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
  /** Design-system theme key for the game world ('casino' | 'sos' | 'arcade' | 'outlands'). */
  theme: string;
  /** Optional CabinetSprite art type shown on the library card (falls back to the icon). */
  art?: string;
  /** Visual accent key, maps to a .home-card-<accent> class in App.css. */
  accent: string;
  status: 'live' | 'soon';
}

export const PLATFORM_NAME = 'ReimonDev Games';
export const PLATFORM_SHORT = 'ReimonDev';
/** Short monogram shown in the brand mark. */
export const PLATFORM_MARK = 'RD';
export const PLATFORM_TAGLINE = 'Play-money games. One account, every world.';

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
    title: 'Outlands',
    tagline: 'Isometric zombie survival',
    description:
      'Step outside the S-Zone into a quarantined city sector. Scavenge, fight escalating undead variants, bank what you can carry, and survive the trip home.',
    icon: 'Skull',
    theme: 'outlands',
    accent: 'toxic',
    status: 'live',
  },
  {
    id: 'casino',
    path: '/casino',
    title: 'Casino',
    tagline: 'Live lobby & classic tables',
    description:
      'Step onto the casino floor: coin flip, blackjack, roulette, slots, dice and more, with a shared wallet and live lobby.',
    icon: 'Spade',
    theme: 'casino',
    art: 'slots',
    accent: 'gold',
    status: 'live',
  },
  {
    id: 'arcade',
    path: '/arcade',
    title: 'Arcade Gallery',
    tagline: 'Cabinets & original score games',
    description:
      'A neon cabinet hall with quick-play originals like Neon Breaker, Hyperlane and Pulse Grid, plus links to the casino tables.',
    icon: 'Gamepad2',
    theme: 'arcade',
    art: 'breaker',
    accent: 'neon',
    status: 'live',
  },
];

export function gameById(id: string): CatalogGame | undefined {
  return GAMES.find((game) => game.id === id);
}

export function gameByPath(path: string): CatalogGame | undefined {
  return GAMES.find((game) => game.path === path);
}
