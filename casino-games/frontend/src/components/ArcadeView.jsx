import { useState } from 'react';
import { Activity, Award, CircleDot, Coins, Dices, Gamepad2, Gift, Grid3X3, Medal, RotateCw, ShieldCheck, Spade, Sparkles, Swords, Trophy, Zap } from 'lucide-react';
import OriginalArcadeGame from './OriginalArcadeGames';
import { CabinetSprite } from './GameArt';

const cabinets = [
  { id: 'slots-1', name: 'Slot Machine', detail: 'Match reels · up to 50x', icon: Sparkles, art: 'slots', tone: 'violet' },
  { id: 'blackjack-1', name: 'Blackjack', detail: 'Verified live table', icon: Spade, art: 'blackjack', tone: 'emerald', featured: true },
  { id: 'roulette-1', name: 'Roulette', detail: 'European single zero', icon: CircleDot, art: 'roulette', tone: 'red' },
  { id: 'dice-1', name: 'Dice', detail: 'High, low, exact, parity', icon: Dices, art: 'dice', tone: 'cyan' },
  { id: 'coinflip-1', name: 'Coin Flip', detail: 'Heads or tails · 2x', icon: Coins, art: 'coin', tone: 'amber' },
  { id: 'luckywheel-1', name: 'Lucky Wheel', detail: 'Server-resolved · up to 5x', icon: RotateCw, art: 'wheel', tone: 'magenta' },
  { id: 'cardgame-1', name: 'Card Duel', detail: 'Red or black · 2x', icon: Gamepad2, art: 'cards', tone: 'blue' },
  { id: 'neon-breaker', name: 'Neon Breaker', detail: 'Brick breaker · score only', icon: Grid3X3, art: 'breaker', tone: 'lime', original: true },
  { id: 'hyperlane', name: 'Hyperlane', detail: 'Dodge traffic · score only', icon: Zap, art: 'hyperlane', tone: 'orange', original: true },
  { id: 'pulse-grid', name: 'Pulse Grid', detail: 'Reaction trial · score only', icon: Activity, art: 'pulse', tone: 'pink', original: true },
];

const gameLabels = {
  CoinFlip: 'Coin Flip', CardGame: 'Card Duel', LuckyWheel: 'Lucky Wheel', Slots: 'Slot Machine',
  Blackjack: 'Blackjack', Roulette: 'Roulette', Dice: 'Dice',
};

const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
const transactionName = (tx) => gameLabels[tx?.gameName] || tx?.gameName || 'Casino game';
const transactionTime = (tx) => {
  const raw = tx?.createdAt || tx?.timestamp;
  if (!raw) return 'recently';
  const minutes = Math.floor((Date.now() - new Date(raw).getTime()) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return new Date(raw).toLocaleDateString();
};

export default function ArcadeView({ balance, onPlay, transactions = [], highscores = {}, stats = {}, progression, onDailyBonus }) {
  const [originalGame, setOriginalGame] = useState(null);
  const activity = transactions.filter((tx) => ['BET', 'WIN', 'LOSS'].includes(String(tx?.type).toUpperCase())).slice(0, 8);
  const leaders = Object.entries(highscores).sort((a, b) => Number(b[1]?.amount || 0) - Number(a[1]?.amount || 0));
  const winRate = stats.totalGames ? Math.round((Number(stats.totalWins || 0) / Number(stats.totalGames)) * 100) : 0;

  return (
    <div className="arcade-page">
      <div className="arcade-stars" aria-hidden="true" />

      <nav className="arcade-local-nav" aria-label="Arcade sections">
        <button type="button" onClick={() => scrollTo('arcade-cabinets')}>Games</button>
        <button type="button" onClick={() => onPlay('blackjack-1')}><Swords size={14} /> Duels</button>
        <button type="button" onClick={() => scrollTo('arcade-leaderboard')}>Leaderboard</button>
        <button type="button" onClick={() => scrollTo('arcade-rewards')}>Prize Room</button>
        <button type="button" onClick={() => scrollTo('arcade-how-to')}>How to Play</button>
      </nav>

      {activity.length > 0 && (
        <div className="arcade-ticker" aria-label="Your recent arcade activity">
          <div className="arcade-ticker-track">
            {[...activity, ...activity].map((tx, index) => (
              <span key={`${tx.timestamp || tx.id || index}-${index}`}>
                <strong>{String(tx.type).toUpperCase()}</strong> {transactionName(tx)} · ${Math.abs(Number(tx.amount || 0)).toFixed(2)}
              </span>
            ))}
          </div>
        </div>
      )}

      <section className="arcade-hero" aria-labelledby="arcade-title">
        <div className="arcade-neon-sign" aria-hidden="true">
          {[...'ARCADE'].map((letter, index) => <span key={`${letter}-${index}`}>{letter}</span>)}
        </div>

        <div className="arcade-crt">
          <div className="arcade-crt-screen">
            <div className="arcade-scanlines" aria-hidden="true" />
            <p className="arcade-overline">CASINO888 PRESENTS</p>
            <h1 id="arcade-title">ARCADE</h1>
            <p className="arcade-subtitle">10 CABINETS · CASINO + ORIGINAL SCORE GAMES</p>
            <button type="button" className="arcade-enter" onClick={() => scrollTo('arcade-cabinets')}>SELECT GAME</button>
          </div>
          <div className="arcade-crt-panel" aria-hidden="true">
            <span className="arcade-knob" /><strong>CASINO888</strong><span className="arcade-speaker" />
          </div>
        </div>

        <div className="arcade-balance-card">
          <span>Available credits</span><strong>${balance.toFixed(2)}</strong><small>Demo funds only</small>
        </div>
      </section>

      <section className="arcade-metrics" aria-label="Arcade statistics">
        <article><Gamepad2 aria-hidden="true" /><span>Games played</span><strong>{Number(stats.totalGames || 0).toLocaleString()}</strong></article>
        <article><Trophy aria-hidden="true" /><span>Lifetime wins</span><strong>{Number(stats.totalWins || 0).toLocaleString()}</strong></article>
        <article><Zap aria-hidden="true" /><span>Win rate</span><strong>{winRate}%</strong></article>
        <article><Award aria-hidden="true" /><span>Arcade level</span><strong>{progression.level}</strong></article>
      </section>

      <section className="arcade-featured" aria-label="Featured game">
        <div>
          <p className="eyebrow">Featured live table</p>
          <h2>Blackjack Duels</h2>
          <p>Server-authoritative multiplayer table with per-player atomic settlement and provably fair shuffled cards. Solo mode remains closed.</p>
          <button type="button" className="primary-button btn-emerald" onClick={() => onPlay('blackjack-1')}><Swords size={18} /> Enter live table</button>
        </div>
        <div className="arcade-featured-cards" aria-hidden="true"><span>A♠</span><span>K♥</span></div>
      </section>

      <section id="arcade-cabinets" className="arcade-cabinets" aria-labelledby="cabinet-title">
        <div className="arcade-section-heading">
          <div><p className="eyebrow">Choose a cabinet</p><h2 id="cabinet-title">Casino floor</h2></div>
          <span>{cabinets.length} games online</span>
        </div>
        <div className="arcade-cabinet-grid">
          {cabinets.map(({ id, name, detail, icon: Icon, art, tone, featured, original }, index) => (
            <article className={`arcade-cabinet arcade-tone-${tone} ${original ? 'is-original' : ''}`} data-game={id} key={id}>
              <div className="arcade-cabinet-marquee"><span>NO. {String(index + 1).padStart(2, '0')}</span>{featured && <em>LIVE</em>}{original && <em>ORIGINAL</em>}<Icon size={22} aria-hidden="true" /></div>
              <div className="arcade-cabinet-screen"><div className="arcade-cabinet-art"><CabinetSprite type={art} /></div><h3>{name}</h3><p>{detail}</p></div>
              <div className="arcade-cabinet-controls"><span className="arcade-joystick" aria-hidden="true" /><button type="button" onClick={() => original ? setOriginalGame(id) : onPlay(id)}>PLAY</button></div>
            </article>
          ))}
        </div>
      </section>

      <div className="arcade-data-grid">
        <section id="arcade-leaderboard" className="arcade-panel" aria-labelledby="arcade-leaders-title">
          <div className="arcade-panel-heading"><Medal aria-hidden="true" /><div><p className="eyebrow">Hall of fame</p><h2 id="arcade-leaders-title">Top wins by game</h2></div></div>
          {leaders.length ? <ol className="arcade-leader-list">{leaders.map(([gameId, entry], index) => <li key={gameId}><span>{index + 1}</span><div><strong>{entry.gameName || gameId}</strong><small>{entry.username || 'Player'}</small></div><b>${Number(entry.amount || 0).toLocaleString()}</b></li>)}</ol> : <p className="arcade-empty">No leaderboard wins recorded yet.</p>}
        </section>

        <section className="arcade-panel" aria-labelledby="arcade-recent-title">
          <div className="arcade-panel-heading"><RotateCw aria-hidden="true" /><div><p className="eyebrow">Your history</p><h2 id="arcade-recent-title">Recent plays</h2></div></div>
          {activity.length ? <div className="arcade-recent-table"><div className="arcade-table-head"><span>Game</span><span>Result</span><span>Amount</span><span>When</span></div>{activity.map((tx, index) => { const type = String(tx.type).toUpperCase(); return <div className="arcade-table-row" key={`${tx.timestamp || tx.id || index}`}><strong>{transactionName(tx)}</strong><span className={`arcade-result-${type.toLowerCase()}`}>{type}</span><span>${Math.abs(Number(tx.amount || 0)).toFixed(2)}</span><time>{transactionTime(tx)}</time></div>; })}</div> : <p className="arcade-empty">Play a cabinet to start your activity feed.</p>}
        </section>
      </div>

      <section id="arcade-rewards" className="arcade-rewards" aria-labelledby="arcade-rewards-title">
        <div><p className="eyebrow">Play-money prize room</p><h2 id="arcade-rewards-title">Rewards and achievements</h2><p>Claim your daily credits, level up through play, and unlock profile trophies. Rewards have no cash value.</p></div>
        <div className="arcade-reward-stats"><span><Gift /><small>Daily reward</small><strong>+${progression.dailyAmount}</strong></span><span><Award /><small>Achievements</small><strong>{progression.unlockedCount}/{progression.achievements.length}</strong></span><span><Zap /><small>Experience</small><strong>{progression.xp.toLocaleString()} XP</strong></span></div>
        <button type="button" className="primary-button btn-purple" onClick={onDailyBonus}>{progression.dailyClaimed ? 'Reward claimed today' : 'Open prize room'}</button>
      </section>

      <section id="arcade-how-to" className="arcade-how-to" aria-labelledby="arcade-how-title">
        <div><ShieldCheck size={28} aria-hidden="true" /><h2 id="arcade-how-title">How to play safely</h2></div>
        <ol><li><strong>Choose a cabinet.</strong><span>Every game displays its rules and listed payout before play.</span></li><li><strong>Set a play-money wager.</strong><span>Your available credits and validation stay visible.</span></li><li><strong>The server resolves the outcome.</strong><span>Animations present the result but never decide your balance.</span></li><li><strong>Review your record.</strong><span>Results appear in recent activity, statistics, and immutable transactions.</span></li></ol>
      </section>
      {originalGame && <OriginalArcadeGame gameId={originalGame} onClose={() => setOriginalGame(null)} />}
    </div>
  );
}
