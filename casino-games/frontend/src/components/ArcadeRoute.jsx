import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ArcadeView from './ArcadeView';
import PlatformNav from './PlatformNav';
import { DailyBonusModal } from './PlayerMeta';
import { useProgression } from '../hooks/useProgression';
import { apiCall } from '../utils/api';

/**
 * Standalone `/arcade` route. Wraps the existing ArcadeView with the shared
 * platform nav, the shared progression/daily-bonus state, and the leaderboard
 * feed. Casino cabinets hand off to `/casino?game=<id>` so all casino game
 * launching stays in one place (the dashboard); the original score games keep
 * running inline inside ArcadeView.
 */
export default function ArcadeRoute({
  userId,
  nickname,
  balance = 0,
  stats = {},
  transactions = [],
  updateBalance,
  onLogout,
}) {
  const navigate = useNavigate();
  const [highscores, setHighscores] = useState({});
  const [showDailyBonus, setShowDailyBonus] = useState(false);
  const prog = useProgression(userId, stats, updateBalance);

  useEffect(() => {
    let active = true;
    const fetchLeaderboard = async () => {
      try {
        const data = await apiCall('/games/leaderboard');
        if (active) setHighscores(data || {});
      } catch (error) {
        console.error('Failed to fetch leaderboard:', error);
      }
    };
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const onPlay = useCallback(
    (gameId) => {
      navigate(`/casino?game=${encodeURIComponent(gameId)}`);
    },
    [navigate],
  );

  return (
    <div className="arcade-route">
      <PlatformNav
        nickname={nickname}
        balance={balance}
        level={prog.level}
        onLogout={onLogout}
        showHome
      />
      <ArcadeView
        balance={balance}
        onPlay={onPlay}
        transactions={transactions}
        highscores={highscores}
        stats={stats}
        progression={prog}
        onDailyBonus={() => setShowDailyBonus(true)}
      />
      <DailyBonusModal
        isOpen={showDailyBonus}
        onClose={() => setShowDailyBonus(false)}
        dailyClaimed={prog.dailyClaimed}
        dailyAmount={prog.dailyAmount}
        claimDaily={prog.claimDaily}
      />
    </div>
  );
}
