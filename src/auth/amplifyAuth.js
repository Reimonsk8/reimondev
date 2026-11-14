// Cognito / Amplify Auth wiring for the site sign-in page.
//
// The portal shares the games app's Cognito user pool so one sign-in carries
// across to /games/... . Region, hosted-UI domain, and app client ID default
// to the values already deployed for the Vite games app (a public client ID,
// not a secret). Only the user pool ID has to be supplied:
//
//   REACT_APP_AUTH_USER_POOL_ID   e.g. us-east-2_ABC123
//
// Optional overrides (same names, in .env.local or the Amplify console):
//   REACT_APP_AUTH_REGION, REACT_APP_AUTH_USER_POOL_CLIENT_ID,
//   REACT_APP_AUTH_COGNITO_DOMAIN
//
// Google auth requires the "Google" identity provider on the user pool
// (Cognito → Sign-in experience → Federated identity provider sign-in) — it
// already exists for the games app, so the portal reuses it.

import { Amplify } from 'aws-amplify';

const REGION = process.env.REACT_APP_AUTH_REGION || 'us-east-2';
const USER_POOL_ID = process.env.REACT_APP_AUTH_USER_POOL_ID || '';
const USER_POOL_CLIENT_ID =
  process.env.REACT_APP_AUTH_USER_POOL_CLIENT_ID || '77ieg4fiv0dg7fo5g9uqb1n5rm';
const COGNITO_DOMAIN =
  process.env.REACT_APP_AUTH_COGNITO_DOMAIN || 'reimondev.auth.us-east-2.amazoncognito.com';

export const isAuthConfigured = Boolean(USER_POOL_ID);

const origin = typeof window !== 'undefined' ? window.location.origin : '';

// Configure once at app start. When the user pool ID is missing this is a
// no-op and the /login page shows a setup checklist instead of a broken form.
export const configureAuth = () => {
  if (!isAuthConfigured) return false;

  Amplify.configure({
    Auth: {
      Cognito: {
        region: REGION,
        userPoolId: USER_POOL_ID,
        userPoolClientId: USER_POOL_CLIENT_ID,
        loginWith: {
          oauth: {
            domain: COGNITO_DOMAIN,
            scopes: ['email', 'openid', 'profile'],
            // Both lists must be allow-listed on the Cognito app client.
            // Deriving them from the current origin keeps localhost and
            // production working through one code path.
            redirectSignIn: [`${origin}/login`],
            redirectSignOut: [`${origin}/`],
            responseType: 'code',
            providers: ['Google'],
          },
        },
      },
    },
  });

  return true;
};
