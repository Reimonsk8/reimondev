// Google OAuth via Cognito Hosted UI.
// COGNITO_CLIENT_ID is the Cognito app client ID (public, not a secret).
// Override with VITE_COGNITO_CLIENT_ID, else the deployed client ID is used.
export const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN || "casino888.auth.us-east-2.amazoncognito.com";
export const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || "1vuv9q9um88odm8cgcct6p7705";
const appBaseUrl = new URL(import.meta.env.BASE_URL || '/', window.location.origin);
export const OAUTH_REDIRECT_URI = import.meta.env.VITE_OAUTH_REDIRECT || new URL('oauth2/callback', appBaseUrl).toString();

export function googleLoginUrl() {
    const params = new URLSearchParams({
        identity_provider: "Google",
        redirect_uri: OAUTH_REDIRECT_URI,
        response_type: "code",
        client_id: COGNITO_CLIENT_ID,
        scope: "openid email profile",
    });
    return `https://${COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`;
}

// Exchange the authorization code for Cognito tokens (client has no secret).
export async function exchangeCodeForTokens(code) {
    const res = await fetch(`https://${COGNITO_DOMAIN}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: COGNITO_CLIENT_ID,
            code,
            redirect_uri: OAUTH_REDIRECT_URI,
        }).toString(),
    });
    if (!res.ok) {
        throw new Error(`Token exchange failed (${res.status})`);
    }
    return res.json();
}
