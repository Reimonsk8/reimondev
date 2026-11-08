import { useEffect, useState } from 'react';
import { apiCall } from '../utils/api';

const fromUser = (user = {}) => ({
  nickname: user.nickname || user.email?.split('@')[0] || 'Player',
  avatarImage: user.picture || null,
});

/** Loads only the identity fields shared by the retained games. */
export function usePlayerProfile(userId, user) {
  const [profile, setProfile] = useState(() => fromUser(user));

  useEffect(() => {
    if (!userId) {
      setProfile(fromUser(user));
      return undefined;
    }

    let active = true;
    setProfile(fromUser(user));
    apiCall('/wallet/profile', 'GET', null, true)
      .then((result) => {
        if (!active) return;
        setProfile({
          nickname: result.nickname || fromUser(user).nickname,
          avatarImage: result.avatarImage || user?.picture || null,
        });
      })
      .catch((error) => {
        console.warn('Player profile unavailable; using sign-in details.', error);
      });

    return () => { active = false; };
  }, [userId, user?.nickname, user?.email, user?.picture]);

  return profile;
}
