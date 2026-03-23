import { beforeEach, describe, expect, it, vi } from 'vitest';

const oauthClientMocks = vi.hoisted(() => ({
  setCredentials: vi.fn(),
  getAccessToken: vi.fn().mockResolvedValue({ token: 'fresh-access-token' }),
  getTokenInfo: vi.fn().mockResolvedValue({}),
}));

const tokenStoreMocks = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock('googleapis', () => {
  class MockOAuth2Client {
    setCredentials = oauthClientMocks.setCredentials;
    getAccessToken = oauthClientMocks.getAccessToken;
    getTokenInfo = oauthClientMocks.getTokenInfo;
  }

  return {
    google: {
      auth: {
        OAuth2: MockOAuth2Client,
      },
    },
  };
});

vi.mock('../../src/services/token-store.js', () => {
  class MockEncryptedFileTokenStore {
    constructor(_filePath: string, _secretKeyHex: string) {}

    load = tokenStoreMocks.load;
  }

  return {
    EncryptedFileTokenStore: MockEncryptedFileTokenStore,
  };
});

import { parseEnvAuthConfig, validateStoredOAuthTokens } from '../../src/cli/auth-setup.js';

describe('auth-setup token validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokenStoreMocks.load.mockResolvedValue(null);
    oauthClientMocks.getAccessToken.mockResolvedValue({ token: 'fresh-access-token' });
    oauthClientMocks.getTokenInfo.mockResolvedValue({});
  });

  it('parses OAuth and encryption settings from .env content', () => {
    const parsed = parseEnvAuthConfig(`
OAUTH_CLIENT_ID=test-client
OAUTH_CLIENT_SECRET=test-secret
OAUTH_REDIRECT_URI=http://localhost:3000/callback
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
`);

    expect(parsed).toEqual({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3000/callback',
      encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
  });

  it('treats an empty token store as invalid', async () => {
    const result = await validateStoredOAuthTokens({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3000/callback',
      tokenPath: '/tmp/tokens.encrypted',
      encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });

    expect(result.valid).toBe(false);
    expect(result.message).toContain('does not contain any stored tokens');
    expect(oauthClientMocks.getAccessToken).not.toHaveBeenCalled();
    expect(oauthClientMocks.getTokenInfo).not.toHaveBeenCalled();
  });

  it('fails fast when expired tokens have no refresh token', async () => {
    tokenStoreMocks.load.mockResolvedValue({
      access_token: 'expired-access-token',
      expiry_date: Date.now() - 1_000,
    });

    const result = await validateStoredOAuthTokens({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3000/callback',
      tokenPath: '/tmp/tokens.encrypted',
      encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });

    expect(result.valid).toBe(false);
    expect(result.message).toContain('missing a refresh token');
    expect(oauthClientMocks.getAccessToken).not.toHaveBeenCalled();
    expect(oauthClientMocks.getTokenInfo).not.toHaveBeenCalled();
  });

  it('validates a non-expiring access token without forcing a refresh', async () => {
    tokenStoreMocks.load.mockResolvedValue({
      access_token: 'current-access-token',
      refresh_token: 'refresh-token',
      expiry_date: Date.now() + 5 * 60_000,
    });

    const result = await validateStoredOAuthTokens({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3000/callback',
      tokenPath: '/tmp/tokens.encrypted',
      encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });

    expect(result.valid).toBe(true);
    expect(oauthClientMocks.getTokenInfo).toHaveBeenCalledWith('current-access-token');
    expect(oauthClientMocks.getAccessToken).not.toHaveBeenCalled();
  });

  it('surfaces refresh failures for expired tokens', async () => {
    tokenStoreMocks.load.mockResolvedValue({
      access_token: 'expired-access-token',
      refresh_token: 'refresh-token',
      expiry_date: Date.now() - 1_000,
    });
    oauthClientMocks.getAccessToken.mockRejectedValueOnce(new Error('invalid_grant'));

    const result = await validateStoredOAuthTokens({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3000/callback',
      tokenPath: '/tmp/tokens.encrypted',
      encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });

    expect(result.valid).toBe(false);
    expect(result.message).toContain('invalid_grant');
    expect(oauthClientMocks.getAccessToken).toHaveBeenCalledTimes(1);
    expect(oauthClientMocks.getTokenInfo).not.toHaveBeenCalled();
  });
});
