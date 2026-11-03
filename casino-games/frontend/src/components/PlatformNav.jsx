import { Link, NavLink } from 'react-router-dom';
import { LogOut, Trophy, UserRound, Wallet } from 'lucide-react';
import { PLATFORM_MARK, PLATFORM_NAME } from '../platform/catalog';

/*
 * Square of Shadows is deliberately absent.
 *
 * It used to be a peer tab here, which made a turn-based tactics game read as
 * just another destination alongside Library and Arcade. It is reached from the
 * homepage carousel instead, where it gets its own artwork and description
 * rather than a bare word in a nav strip. The route itself is unchanged, so
 * invite links and bookmarks still work.
 *
 * Arcade went the same way: it was a third bare word in a strip of two, and it
 * has its own branded cabinets page (and a homepage card) to be reached through.
 * `/arcade` still resolves for bookmarks and direct links.
 */
const NAV_ITEMS = [
  { to: '/', label: 'Library', end: true },
  { to: '/casino', label: 'Casino' },
];

/**
 * Shared application top bar. Rendered on the catalog homepage and every
 * standalone game route. It is intentionally theme-neutral (fixed chrome
 * colours) so navigation reads as app chrome regardless of the active game
 * theme on the route beneath it.
 */
export default function PlatformNav({ nickname, balance = 0, level, avatarImage, showAvatar = false, onLogout, onEditProfile }) {
  return (
    <header className="gg-topbar">
      {/*
        Only the GG mark goes home.

        The whole brand block used to be one link, which made the product name
        read as a fourth navigation target sitting next to Library and Casino — and
        the tagline under it looked tappable. Home is where you go
        by pressing the icon, so the icon is the link and the wordmark is just
        the wordmark. `aria-label` carries the accessible name, since the mark
        itself is only "GG".
      */}
      <span className="gg-brand">
        <Link to="/" className="gg-brand-mark" aria-label={`${PLATFORM_NAME} home`}>
          {PLATFORM_MARK}
        </Link>
        <span className="gg-brand-text">
          <span className="gg-brand-name">{PLATFORM_NAME}</span>
          <span className="gg-brand-tag">one account · every world</span>
        </span>
      </span>

      <nav className="gg-topnav" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `gg-toplink${isActive ? ' is-active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="gg-account">
        <span className="gg-chip gg-chip-accent" title="Play-money balance">
          <Wallet size={14} /> ${Number(balance || 0).toFixed(2)}
        </span>
        {typeof level === 'number' && (
          <span className="gg-chip" title={`Level ${level}`}>
            <Trophy size={14} /> Level {level}
          </span>
        )}
        {nickname && (
          /*
            The name is the profile entry point.

            It used to be an inert chip, so the only way to edit your display
            name or avatar was to find the profile card buried in the casino
            dashboard. Pressing your own name is the obvious gesture, so the
            chip becomes a button and hands off to the caller's profile editor.
          */
          onEditProfile ? (
            <button
              type="button"
              className="gg-chip gg-chip-button"
              onClick={onEditProfile}
              title="Edit your profile"
            >
              {showAvatar && (
                <span className="gg-profile-avatar" aria-hidden="true">
                  {avatarImage ? <img src={avatarImage} alt="" /> : (nickname || 'P').trim().slice(0, 1).toUpperCase()}
                </span>
              )}
              {!showAvatar && <UserRound size={14} />}{nickname}
            </button>
          ) : (
            <span className="gg-chip">{nickname}</span>
          )
        )}
        {onLogout && (
          <button type="button" className="gg-logout" onClick={onLogout}>
            <LogOut size={14} /> Log out
          </button>
        )}
      </div>
    </header>
  );
}
