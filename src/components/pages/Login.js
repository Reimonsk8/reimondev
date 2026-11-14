import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildSignInUrl, OAUTH_REDIRECT_URI } from '../../auth/oauth';
import { useAuth } from '../../auth/AuthContext';
import '../../styles/Login.css';

const ERROR_MESSAGES = {
  access_denied: 'Sign-in was cancelled before it finished.',
  redirect_mismatch: `This URL isn't allow-listed on the Cognito app client yet: ${OAUTH_REDIRECT_URI}`,
  invalid_request: 'Cognito rejected the request. Check the app client configuration.',
};

const SignedIn = ({ user, isAdmin, signOut }) => {
  const email = user?.email || user?.username || '';

  return (
    <section className="login-signed-in" aria-label="Signed in">
      <p className="login-eyebrow">{isAdmin ? 'ADMIN SESSION' : 'SESSION ACTIVE'}</p>
      <p className="login-signed-in-line">
        Signed in as <strong>{email}</strong>
      </p>
      <p className="login-signed-in-note">
        One session for the whole site — the multiplayer games pick it up automatically.
        {isAdmin && (
          <>
            {' '}
            <Link to="/admin">Open the admin console ↗</Link>
          </>
        )}
      </p>
      <button type="button" className="login-signout" onClick={signOut}>
        Sign out
      </button>
    </section>
  );
};

export default function Login() {
  const { user, ready, isAdmin, signOut, completeSignIn } = useAuth();
  const [exchanging, setExchanging] = useState(false);
  const [error, setError] = useState('');
  const handled = useRef(false);

  // Return trip from the Cognito hosted UI: one-time code in the query string.
  useEffect(() => {
    if (handled.current) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const oauthError = params.get('error');

    if (!code && !oauthError) return;
    handled.current = true;

    // Strip the parameters so a refresh doesn't replay a used code.
    window.history.replaceState(null, '', window.location.pathname);

    if (oauthError) {
      setError(
        ERROR_MESSAGES[oauthError]
          || params.get('error_description')
          || 'Sign-in failed. Please try again.',
      );
      return;
    }

    setExchanging(true);
    completeSignIn(code)
      .then((signedIn) => {
        if (!signedIn) setError('Signed in, but the token response could not be read.');
      })
      .catch((err) => {
        console.error('Cognito token exchange failed:', err);
        setError('Could not finish sign-in. Please try again.');
      })
      .finally(() => setExchanging(false));
  }, [completeSignIn]);

  const showSession = Boolean(user);

  return (
    <main className="login-page" aria-labelledby="login-title">
      <header className="login-intro">
        <p className="login-eyebrow">ACCOUNT · SIGN IN</p>
        <h1 id="login-title">
          Welcome back.
          <br />
          <span>The work stays with you.</span>
        </h1>
        <p className="login-lede">
          Sign in with Google or your email and password. The same session unlocks the
          multiplayer games — no second login.
        </p>
      </header>

      <div className="login-panel">
        {showSession ? (
          <SignedIn user={user} isAdmin={isAdmin} signOut={signOut} />
        ) : exchanging ? (
          <p className="login-status" role="status">Signing you in…</p>
        ) : !ready ? (
          <p className="login-status" role="status">Checking for an existing session…</p>
        ) : (
          <>
            {error && <p className="login-error" role="alert">{error}</p>}
            <div className="login-providers">
              <a className="login-provider login-provider--primary" href={buildSignInUrl('Google')}>
                Continue with Google<span aria-hidden="true">↗</span>
              </a>
              <a className="login-provider" href={buildSignInUrl()}>
                Sign in with email and password<span aria-hidden="true">↗</span>
              </a>
            </div>
            <p className="login-help">
              You&apos;ll finish on Cognito&apos;s secure sign-in page, the same one the
              games use.
            </p>
            <p className="login-help login-help--fine">
              App clients must allow <code>{OAUTH_REDIRECT_URI}</code> as a callback URL.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
