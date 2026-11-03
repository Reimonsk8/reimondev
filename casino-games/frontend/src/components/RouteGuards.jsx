import { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { exchangeCodeForTokens } from '../utils/oauth';

const REDIRECT_KEY = 'c888_redirect';

/**
 * Guards game routes: unauthenticated visitors are sent to the landing/login
 * at `/` while their intended path is remembered (sessionStorage, so it also
 * survives the full-page Google OAuth round trip).
 */
export function RequireAuth({ userId, children }) {
  const location = useLocation();

  useEffect(() => {
    if (userId) return;
    const target = `${location.pathname}${location.search}`;
    if (target && target !== '/') {
      sessionStorage.setItem(REDIRECT_KEY, target);
    }
  }, [userId, location.pathname, location.search]);

  if (!userId) return <Navigate to="/" replace />;
  return children;
}

/**
 * Handles the Cognito Hosted UI / Google OAuth callback at
 * `/oauth2/callback?code=...`. Tokens are exchanged, then the app performs one
 * full reload into the remembered target so `useAuth` restores the session.
 */
export function OAuthCallback({ showModal }) {
  const exchangeStarted = useRef(false);
  useEffect(() => {
    if (exchangeStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const oauthError = params.get('error');
    if (!code && !oauthError) return;
    exchangeStarted.current = true;

    if (oauthError) {
      const description = params.get('error_description') || 'Google sign-in was cancelled.';
      sessionStorage.removeItem(REDIRECT_KEY);
      window.location.replace('/');
      showModal?.('Login Failed', description, 'error');
      return;
    }

    exchangeCodeForTokens(code)
      .then((tokens) => {
        localStorage.setItem('c888_id_token', tokens.id_token);
        localStorage.setItem('c888_access_token', tokens.access_token);
        localStorage.setItem('c888_refresh_token', tokens.refresh_token || '');
        const target = sessionStorage.getItem(REDIRECT_KEY) || '/';
        sessionStorage.removeItem(REDIRECT_KEY);
        window.location.replace(target);
      })
      .catch((error) => {
        console.error('OAuth token exchange failed:', error);
        window.location.replace('/');
        showModal?.('Login Failed', 'Google sign-in failed. Please try again.', 'error');
      });
  }, [showModal]);

  return (
    <main className="app-shell">
      <div className="glass-card text-center py-12 px-8">
        <p className="text-2xl font-semibold text-accent-gold">Signing you in…</p>
      </div>
    </main>
  );
}
