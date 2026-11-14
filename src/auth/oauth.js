// Cognito Hosted UI OAuth — the same flow the games app uses
// (casino-games/frontend/src/utils/oauth.js), so one sign-in covers the whole
// site: this writes the legacy `c888_*` keys the games app already reads.
//
// Only two public values are needed: the hosted-UI domain and the app client
// ID. The user pool ID that Amplify's Auth API requires is never used here,
// which is why no Cognito pool configuration is needed on this side.
//
// Both values default to the deployed games app, and can be overridden with
// REACT_APP_AUTH_COGNITO_DOMAIN / REACT_APP_AUTH_USER_POOL_CLIENT_ID.

export const COGNITO_DOMAIN =
  process.env.REACT_APP_AUTH_COGNITO_DOMAIN || 'reimondev.auth.us-east-2.amazoncognito.com';

// Public app client ID (not a secret) — same client the games app uses.
export const COGNITO_CLIENT_ID =
  process.env.REACT_APP_AUTH_USER_POOL_CLIENT_ID || '77ieg4fiv0dg7fo5g9uqb1n5rm';

const origin = typeof window !== 'undefined' ? window.location.origin : '';

// Must be allow-listed on the Cognito app client, next to the games app's
// existing /games/oauth2/callback entry. Overridable for the fallback below.
export const OAUTH_REDIRECT_URI =
  process.env.REACT_APP_AUTH_REDIRECT_URI || `${origin}/login`;

const endpoint = (path) => `https://${COGNITO_DOMAIN}${path}`;

// Hosted-UI sign-in URL. With `identityProvider` it jumps straight to that
// provider; without it, Cognito renders its own form — email + password plus
// the same Google button — so both sign-in styles share one session.
export function buildSignInUrl(identityProvider) {
  const params = new URLSearchParams({
    client_id: COGNITO_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
  });
  if (identityProvider) params.set('identity_provider', identityProvider);
  return `${endpoint('/oauth2/authorize')}?${params.toString()}`;
}

const postToken = async (body) => {
  const res = await fetch(endpoint('/oauth2/token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: COGNITO_CLIENT_ID, ...body }).toString(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.id_token) {
    const reason = data?.error_description || data?.error || `HTTP ${res.status}`;
    throw new Error(`Token request failed: ${reason}`);
  }
  return data;
};

// Exchange the one-time authorization code (the client has no secret).
export const exchangeCodeForTokens = (code) =>
  postToken({ grant_type: 'authorization_code', code, redirect_uri: OAUTH_REDIRECT_URI });

// Silent renewal; Cognito keeps the original refresh token.
export const refreshTokens = (refreshToken) =>
  postToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
