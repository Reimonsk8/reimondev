import { Medal } from 'lucide-react';

const RANK_COLORS = ['#ffd700', '#c0c0c0', '#cd7f32'];

export default function LeaderboardPanel({ highscores = {} }) {
  const entries = Object.entries(highscores).sort((a, b) => (b[1].amount || 0) - (a[1].amount || 0));

  if (entries.length === 0) {
    return <p className="empty-state lobby-history-empty">No wins recorded yet.</p>;
  }

  return (
    <ul className="leaderboard">
      {entries.map(([gameId, entry], index) => (
        <li key={gameId} className={index < 3 ? `is-rank-${index + 1}` : ''}>
          <span className="leaderboard-rank">{index < 3 ? <Medal size={16} color={RANK_COLORS[index]} /> : `${index + 1}.`}</span>
          <span className="leaderboard-name">{entry.gameName || gameId}</span>
          <span className="leaderboard-user">{entry.username}</span>
          <span className="leaderboard-amount">${Number(entry.amount || 0).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}
