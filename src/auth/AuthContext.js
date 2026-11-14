import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { exchangeCodeForTokens, refreshTokens } from './oauth';

// The one admin account for the site. This is a client-side convenience gate
// for showing admin-only UI; real admin data must still be enforced by the
// APIs that serve it.
export const ADMIN_EMAIL = 'reimonsk8@gmail.com';

// Token keys owned by the games app (`/games/...`). Both apps share one origin
// in production, so writing these here means a portal sign-in *is* a games
// sign-in — and a games sign-in is recognized by the portal. There is no copy
// or translation step: this is the only session store.
const ID_TOKEN = 'c888_id_token';
const ACCESS_TOKEN = 'c888_access_token';
const REFRESH_TOKEN = 'c888_refresh_token';
const USER_ID = 'c888_user_id';

// Treat a token as expired slightly early so a request never races the clock.
const EXPIRY_SKEW_MS = 60 * 1000;

const decodeJwtPayload = (token) => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
};

const userFromClaims = (claims) => {
  if (!claims?.sub) return null;
  return {
    username: claims['cognito:username'] || claims.username || claims.sub,
    email: claims.email || '',
    name: claims.name || '',
    groups: Array.isArray(claims['cognito:groups']) ? claims['cognito:groups'] : [],
    sub: claims.sub,
    expiresAt: claims.exp ? claims.exp * 1000 : 0,
  };
};

const isExpired = (user) => Boolean(user?.expiresAt) && user.expiresAt - EXPIRY_SKEW_MS < Date.now();

const readTokens = () => {
  try {
    return {
      id: window.localStorage.getItem(ID_TOKEN),
      access: window.localStorage.getItem(ACCESS_TOKEN),
      refresh: window.localStorage.getItem(REFRESH_TOKEN),
    };
  } catch {
    return { id: null, access: null, refresh: null };
  }
};

const storeTokens = (tokens) => {
  try {
    if (tokens.id_token) window.localStorage.setItem(ID_TOKEN, tokens.id_token);
    if (tokens.access_token) window.localStorage.setItem(ACCESS_TOKEN, tokens.access_token);
    // Refresh-token grants don't return a new refresh token; keep the old one.
    if (tokens.refresh_token) window.localStorage.setItem(REFRESH_TOKEN, tokens.refresh_token);
  } catch {
    // Storage unavailable — the session just won't persist.
  }
};

const clearTokens = () => {
  try {
    window.localStorage.removeItem(ID_TOKEN);
    window.localStorage.removeItem(ACCESS_TOKEN);
    window.localStorage.removeItem(REFRESH_TOKEN);
    window.localStorage.removeItem(USER_ID);
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

  // Read the shared session, renewing it with the refresh token when needed.
  const refresh = useCallback(async () => {
    const tokens = readTokens();

    if (tokens.id) {
      const current = userFromClaims(decodeJwtPayload(tokens.id));
      if (current && !isExpired(current)) {
        setUser(current);
        setReady(true);
        return current;
      }
    }

    if (tokens.refresh) {
      try {
        const renewed = await refreshTokens(tokens.refresh);
        storeTokens(renewed);
        const current = userFromClaims(decodeJwtPayload(renewed.id_token));
        setUser(current);
        setReady(true);
        return current;
      } catch {
        clearTokens();
      }
    }

    setUser(null);
    setReady(true);
    return null;
  }, []);

  // Finish the hosted-UI redirect: exchange the one-time code for tokens.
  const completeSignIn = useCallback(async (code) => {
    const tokens = await exchangeCodeForTokens(code);
    storeTokens(tokens);
    const current = userFromClaims(decodeJwtPayload(tokens.id_token));
    setUser(current);
    setReady(true);
    return current;
  }, []);

  const signOut = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  useEffect(() => {
    refresh();
    // Pick up sign-ins from other tabs or from the games app without a reload.
    const onStorage = (event) => {
      if (event.key && ![ID_TOKEN, ACCESS_TOKEN, REFRESH_TOKEN].includes(event.key)) return;
      refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const isAdmin = Boolean(user) && (
    (user.email || '').toLowerCase() === ADMIN_EMAIL
    || (user.groups || []).includes('admin')
  );

  const value = { user, ready, isAdmin, signOut, refresh, completeSignIn };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Render children only for the admin session. Real admin data still has to be
// protected by the API that serves it — this only hides UI.
export const AdminOnly = ({ children, fallback = null }) => {
  const { ready, isAdmin } = useAuth();
  if (!ready) return null;
  return isAdmin ? children : fallback;
};
