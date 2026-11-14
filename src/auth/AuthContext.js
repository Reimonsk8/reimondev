import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  fetchAuthSession,
  getCurrentUser,
  signOut as amplifySignOut,
} from 'aws-amplify/auth';
import { isAuthConfigured } from './amplifyAuth';

// The one admin account for the site. This is a client-side convenience gate
// for showing admin-only UI; real admin data must still be enforced by the
// APIs that serve it.
export const ADMIN_EMAIL = 'reimonsk8@gmail.com';

// Token keys owned by the Vite games app (`/games/...`). Both apps share the
// same origin in production, so mirroring the Cognito tokens into these keys
// means one portal sign-in is enough for the multiplayer games — and a game
// sign-in is recognized by the portal.
const GAMES_ID_TOKEN = 'c888_id_token';
const GAMES_ACCESS_TOKEN = 'c888_access_token';
const GAMES_REFRESH_TOKEN = 'c888_refresh_token';

const decodeJwtPayload = (token) => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
};

const readGamesSession = () => {
  try {
    const token = window.localStorage.getItem(GAMES_ID_TOKEN);
    if (!token) return null;
    const claims = decodeJwtPayload(token);
    if (!claims?.sub) return null;
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return {
      source: 'games',
      username: claims.sub,
      email: claims.email || '',
      name: claims.name || '',
      groups: Array.isArray(claims['cognito:groups']) ? claims['cognito:groups'] : [],
      sub: claims.sub,
    };
  } catch {
    return null;
  }
};

const mirrorTokensToGames = ({ id, access, refresh }) => {
  try {
    if (id) window.localStorage.setItem(GAMES_ID_TOKEN, id);
    if (access) window.localStorage.setItem(GAMES_ACCESS_TOKEN, access);
    if (refresh) window.localStorage.setItem(GAMES_REFRESH_TOKEN, refresh);
  } catch {
    // Storage unavailable — the games app just won't inherit this session.
  }
};

const clearGamesSession = () => {
  try {
    window.localStorage.removeItem(GAMES_ID_TOKEN);
    window.localStorage.removeItem(GAMES_ACCESS_TOKEN);
    window.localStorage.removeItem(GAMES_REFRESH_TOKEN);
  } catch {
    // Storage unavailable — nothing to clear.
  }
};

const AuthContext = createContext(null);

export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth requires <AuthProvider>');
  return value;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (isAuthConfigured) {
      try {
        const current = await getCurrentUser();
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken;
        const accessToken = session.tokens?.accessToken;

        // Hand the session to the games app (same origin, legacy keys).
        mirrorTokensToGames({
          id: idToken?.toString(),
          access: accessToken?.toString(),
          refresh: session.tokens?.refreshToken?.toString(),
        });

        const claims = idToken?.payload || {};
        setUser({
          source: 'portal',
          username: current.username,
          email: claims.email || '',
          name: claims.name || '',
          groups: Array.isArray(claims['cognito:groups']) ? claims['cognito:groups'] : [],
          sub: claims.sub || current.userId,
        });
        setReady(true);
        return;
      } catch {
        // Not signed in through the portal — fall back to a games session.
      }
    }

    setUser(readGamesSession());
    setReady(true);
  }, []);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (alive) refresh();
    };

    run();
    // Pick up sessions created in other tabs, the games app, or after the
    // Google OAuth round trip without forcing a reload.
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      alive = false;
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    if (isAuthConfigured) {
      try {
        await amplifySignOut();
      } catch {
        // Already signed out or unreachable — clearing local keys is enough.
      }
    }
    clearGamesSession();
    setUser(null);
  }, []);

  const isAdmin = Boolean(user) && (
    (user.email || '').toLowerCase() === ADMIN_EMAIL
    || (user.groups || []).includes('admin')
  );

  const value = {
    user,
    ready,
    isAdmin,
    signOut,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Render children only for the admin session. Real admin data still has to be
// protected by the API that serves it — this only hides UI.
export const AdminOnly = ({ children, fallback = null }) => {
  const { ready, isAdmin } = useAuth();
  if (!ready) return null;
  return isAdmin ? children : fallback;
};
