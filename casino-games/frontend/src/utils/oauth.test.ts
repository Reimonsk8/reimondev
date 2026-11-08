import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Cognito Google OAuth helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds the Hosted UI authorize URL with the callback and requested scopes', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://games.example' } });
    const { googleLoginUrl } = await import('./oauth');
    const url = new URL(googleLoginUrl());

    expect(url.origin).toBe('https://casino888.auth.us-east-2.amazoncognito.com');
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('identity_provider')).toBe('Google');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe('https://games.example/oauth2/callback');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('client_id')).toBe('1vuv9q9um88odm8cgcct6p7705');
  });

  it('exchanges an authorization code using the exact same callback URI', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://games.example' } });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id_token: 'id', access_token: 'access', refresh_token: 'refresh' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { exchangeCodeForTokens } = await import('./oauth');

    await expect(exchangeCodeForTokens('auth-code')).resolves.toEqual({
      id_token: 'id',
      access_token: 'access',
      refresh_token: 'refresh',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe('https://casino888.auth.us-east-2.amazoncognito.com/oauth2/token');
    expect(options.method).toBe('POST');
    const body = new URLSearchParams(String(options.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('redirect_uri')).toBe('https://games.example/oauth2/callback');
  });

  it('reports rejected authorization codes clearly', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://games.example' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const { exchangeCodeForTokens } = await import('./oauth');

    await expect(exchangeCodeForTokens('expired')).rejects.toThrow('Token exchange failed (400)');
  });
});
