import { useState, useEffect, useCallback } from 'react';
import { soundManager } from '../utils/audio';

const DAILY_KEY = 'c888_daily_claim';
const SOUND_KEY = 'c888_sound_prefs';

export const ACHIEVEMENTS = [
  { id: 'first-win', name: 'First Blood', desc: 'Win your first bet', icon: '🎯', check: (s) => s.totalWins >= 1 },
  { id: 'hot-streak', name: 'Hot Streak', desc: 'Win 10 bets', icon: '🔥', check: (s) => s.totalWins >= 10 },
  { id: 'regular', name: 'Regular', desc: 'Play 50 games', icon: '🎰', check: (s) => s.totalGames >= 50 },
  { id: 'high-roller', name: 'High Roller', desc: 'Wager $1,000 lifetime', icon: '💎', check: (s) => s.totalWagered >= 1000 },
  { id: 'whale', name: 'Whale', desc: 'Wager $10,000 lifetime', icon: '🐋', check: (s) => s.totalWagered >= 10000 },
  { id: 'big-hit', name: 'Big Hit', desc: 'Win $250 in one bet', icon: '💰', check: (s) => s.biggestWin >= 250 },
  { id: 'jackpot', name: 'Jackpot', desc: 'Win $1,000 in one bet', icon: '👑', check: (s) => s.biggestWin >= 1000 },
];

function load(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

export function useProgression(userId, stats = {}, updateBalance) {
  const [daily, setDaily] = useState(() => load(DAILY_KEY) || {});
  const [sound, setSoundState] = useState(() => load(SOUND_KEY) || { enabled: true, volume: 0.3 });

  useEffect(() => {
    soundManager.setVolume(sound.enabled ? sound.volume : 0);
  }, [sound]);

  const xp =
    (stats.totalGames || 0) * 10 +
    (stats.totalWins || 0) * 25 +
    Math.floor(stats.totalWagered || 0) +
    Math.floor(stats.totalWon || 0) * 2;
  const level = Math.floor(xp / 100) + 1;
  const levelXp = xp % 100;

  const achievements = ACHIEVEMENTS.map((a) => ({ ...a, unlocked: a.check(stats) }));
  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  const today = new Date().toISOString().slice(0, 10);
  const dailyClaimed = daily[userId] === today;
  const dailyAmount = 100 + level * 25;

  const claimDaily = useCallback(async () => {
    if (!updateBalance || dailyClaimed) return false;
    const ok = await updateBalance(dailyAmount, 'deposit');
    if (ok) {
      setDaily((prev) => {
        const next = { ...prev, [userId]: today };
        localStorage.setItem(DAILY_KEY, JSON.stringify(next));
        return next;
      });
    }
    return ok;
  }, [updateBalance, dailyClaimed, dailyAmount, userId, today]);

  const setSound = useCallback((patch) => {
    setSoundState((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(SOUND_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { xp, level, levelXp, achievements, unlockedCount, dailyClaimed, dailyAmount, claimDaily, sound, setSound };
}
