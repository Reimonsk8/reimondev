import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Authenticator,
  ThemeProvider,
  createTheme,
  defaultDarkModeOverride,
} from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { isAuthConfigured } from '../../auth/amplifyAuth';
import { useAuth } from '../../auth/AuthContext';
import '../../styles/Login.css';

// Dark theme so the Authenticator blends into the eclipse look instead of
// rendering its default light card.
const theme = createTheme({
  name: 'eclipse-auth',
  overrides: [defaultDarkModeOverride],
});

const SETUP_VARS = [
  ['REACT_APP_AUTH_USER_POOL_ID', 'us-east-2_XXXXXXXXX'],
  ['REACT_APP_AUTH_REGION', 'us-east-2 (default)'],
  ['REACT_APP_AUTH_USER_POOL_CLIENT_ID', '77ieg4fiv0dg7fo5g9uqb1n5rm (default)'],
  ['REACT_APP_AUTH_COGNITO_DOMAIN', 'reimondev.auth.us-east-2.amazoncognito.com (default)'],
];

const AuthNotConfigured = () => (
  <section className="login-setup" aria-label="Authentication setup required">
    <p className="login-setup-title">Sign-in isn&apos;t configured yet</p>
    <p className="login-setup-copy">
      Add the user pool ID to <code>.env.local</code> (or the Amplify console) and restart
      the dev server. The page then renders the real sign-in form.
    </p>
    <ul className="login-setup-vars">
      {SETUP_VARS.map(([name, example]) => (
        <li key={name}>
          <code>{name}</code>
          <span>{example}</span>
        </li>
      ))}
    </ul>
    <p className="login-setup-note">
      Find the pool ID with{' '}
      <code>aws cognito-idp list-user-pools --max-results 60 --region us-east-2</code>.
      The app client also needs <code>http://localhost:3000/login</code> and{' '}
      <code>https://reimondev.com/login</code> as allowed callback URLs.
    </p>
  </section>
);

const SignedIn = () => {
  const { user, isAdmin, signOut } = useAuth();
  const email = user?.email || user?.username || '';

  return (
    <section className="login-signed-in" aria-label="Signed in">
      <p className="login-eyebrow">{isAdmin ? 'ADMIN SESSION' : 'SESSION ACTIVE'}</p>
      <p className="login-signed-in-line">
        Signed in as <strong>{email}</strong>
      </p>
      <p className="login-signed-in-note">
        This session also unlocks the multiplayer games — no second sign-in there.
        {isAdmin && (
          <>
            {' '}
            <Link to="/admin">Open the admin console ↗</Link>
          </>
        )}
      </p>
      <button type="button" className="login-signout" onClick={() => signOut()}>
        Sign out
      </button>
    </section>
  );
};

// Rendered inside the Authenticator's signed-in state. The shared auth context
// may still be empty right after a password/Google sign-in, so refresh it.
const AfterSignIn = () => {
  const { user, refresh } = useAuth();

  useEffect(() => {
    if (!user) refresh();
  }, [user, refresh]);

  return <SignedIn />;
};

export default function Login() {
  const { user } = useAuth();

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
        {user ? (
          <SignedIn />
        ) : isAuthConfigured ? (
          <ThemeProvider theme={theme} colorMode="dark">
            <Authenticator socialProviders={['google']}>
              {() => <AfterSignIn />}
            </Authenticator>
          </ThemeProvider>
        ) : (
          <AuthNotConfigured />
        )}
      </div>
    </main>
  );
}
