import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Gamepad2,
  ShieldCheck,
  Skull,
  Spade,
  Sparkles,
  Swords,
  Trophy,
} from 'lucide-react';
import { GAMES, PLATFORM_TAGLINE } from '../platform/catalog';
import { useProgression } from '../hooks/useProgression';
import { CabinetSprite } from './GameArt';
import PlatformNav from './PlatformNav';
import Modal from './Modal';
import AvatarCustomizer from './AvatarCustomizer';

const ICONS = { Swords, Spade, Gamepad2, Skull };

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The authenticated platform library at `/`. Catalog data, launch destinations,
 * account state, and profile callbacks remain owned by the existing app flows.
 */
export default function HomeView({
  nickname,
  balance = 0,
  stats = {},
  userId,
  email,
  avatarImage: walletAvatar,
  onProfileSaved,
  onLogout,
}) {
  const prog = useProgression(userId, stats);

  // Profile editor, opened by pressing your own name in the top bar. Editing was
  // only reachable from the casino dashboard's profile card, which is a long way
  // to go just to fix a typo in your display name.
  const [profileOpen, setProfileOpen] = useState(false);
  const [avatarImage, setAvatarImage] = useState(walletAvatar || '');

  // The wallet profile is the server's copy of the avatar; adopt it whenever it
  // arrives (first load, or a save that came back from another tab). An avatar
  // picked inside the editor always wins, hence the `avatarImage` guard.
  useEffect(() => {
    if (!avatarImage && walletAvatar) setAvatarImage(walletAvatar);
  }, [walletAvatar, avatarImage]);

  return (
    <div className="home-page">
      <PlatformNav
        nickname={nickname}
        balance={balance}
        avatarImage={walletAvatar || avatarImage}
        showAvatar
        onLogout={onLogout}
        onEditProfile={() => setProfileOpen(true)}
      />

      <section className="lib-header" aria-label="Your game library">
        <div className="lib-header-copy">
          <p className="lib-eyebrow">Game library</p>
          <h1 className="lib-title">{greeting()}, {nickname || 'Player'}</h1>
          <p className="lib-subtitle">{PLATFORM_TAGLINE}</p>
        </div>
        <div className="lib-header-stats">
          <span className="ui-chip">
            <Trophy size={14} /> Level {prog.level}
          </span>
          <span className="ui-chip">
            <Sparkles size={14} /> {Number(stats.totalGames || 0).toLocaleString()} games played
          </span>
        </div>
      </section>

      {GAMES[0] && (
        <section className={`library-feature library-feature-${GAMES[0].theme}`} aria-label="Featured world">
          <div className="library-feature-copy">
            <span className="library-feature-kicker"><Sparkles size={14} /> Featured world</span>
            <h2>{GAMES[0].title}</h2>
            <p>{GAMES[0].description}</p>
            <Link to={GAMES[0].path} className="library-feature-action">
              Enter world <ArrowRight size={17} />
            </Link>
          </div>
          <div className="library-feature-art" aria-hidden="true">
            {GAMES[0].art ? <CabinetSprite type={GAMES[0].art} /> : <Swords size={58} />}
            <span className="library-feature-orbit" />
          </div>
          <div className="library-feature-index"><span>01</span><i />{String(GAMES.length).padStart(2, '0')}</div>
        </section>
      )}

      <section className="lib-toolbar" aria-labelledby="home-catalog-title">
        <div>
          <p className="lib-eyebrow">The collection</p>
          <h2 id="home-catalog-title">All worlds</h2>
          <p>Pick a world to launch — your profile and progress carry across every game.</p>
        </div>
        <span className="lib-count">{GAMES.length} games available</span>
      </section>

      <section className="lib-grid" aria-label="Available games">
        {GAMES.map((game) => {
          const Icon = ICONS[game.icon] || Sparkles;
          return (
            <Link
              key={game.id}
              to={game.path}
              className={`lib-card lib-card-${game.theme}`}
              data-game={game.id}
            >
              <div className="lib-card-art">
                {game.art ? (
                  <CabinetSprite type={game.art} />
                ) : (
                  <span className="lib-card-emblem"><Icon size={40} /></span>
                )}
              </div>
              <div className="lib-card-body">
                <span className={`lib-card-badge${game.status === 'live' ? '' : ' is-soon'}`}>
                  {game.status === 'live' ? 'LIVE' : 'SOON'}
                </span>
                <h3>{game.title}</h3>
                <p className="lib-card-tag">{game.tagline}</p>
                <p className="lib-card-desc">{game.description}</p>
                <span className="lib-card-cta">Launch <ArrowRight size={16} /></span>
              </div>
            </Link>
          );
        })}
      </section>

      <p className="home-footer">
        <ShieldCheck size={15} /> Play-money only. No real money, no deposits — just games.
      </p>

      <Modal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        title="Your Profile"
        variant="default"
      >
        <div className="profile-modal-body home-profile-modal">
          <AvatarCustomizer
            nickname={nickname}
            userId={userId}
            email={email}
            avatarImage={avatarImage}
            setAvatarImage={setAvatarImage}
            onSaved={() => {
              onProfileSaved?.();
            }}
          />
        </div>
      </Modal>
    </div>
  );
}
