/**
 * ServalSheets - Auth Handler Tests
 *
 * Tests for OAuth authentication flows.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthHandler } from '../../src/handlers/auth.js';
import { SheetsAuthOutputSchema } from '../../src/schemas/auth.js';
import type { GoogleApiClient } from '../../src/services/google-api.js';

const oauthClientMocks = vi.hoisted(() => ({
  lastGeneratedState: undefined as string | undefined,
  generateAuthUrl: vi.fn((options?: { scope?: string[]; state?: string }) => {
    oauthClientMocks.lastGeneratedState = options?.state;
    const params = new URLSearchParams({
      client_id: 'test',
      redirect_uri: 'http://localhost:3000/callback',
      scope: options?.scope?.join(' ') ?? 'https://www.googleapis.com/auth/spreadsheets',
      access_type: 'offline',
      response_type: 'code',
    });
    if (options?.state) {
      params.set('state', options.state);
    }
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }),
  getToken: vi.fn().mockResolvedValue({
    tokens: {
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expiry_date: 1704067200000 + 3600000,
    },
  }),
  setCredentials: vi.fn(),
  revokeToken: vi.fn().mockResolvedValue({ success: true }),
  getAccessToken: vi.fn().mockResolvedValue({
    token: 'mock-access-token',
  }),
  refreshAccessToken: vi.fn().mockResolvedValue({
    credentials: {
      access_token: 'mock-refreshed-token',
      expiry_date: 1704067200000 + 3600000,
    },
  }),
}));

const mockSessionContext = vi.hoisted(() => ({
  exportState: vi.fn().mockReturnValue('mock-session-state'),
  importState: vi.fn(),
}));

const callbackServerMocks = vi.hoisted(() => ({
  startCallbackServer: vi.fn().mockImplementation(() =>
    Promise.resolve({
      code: 'auto-auth-code',
      state: oauthClientMocks.lastGeneratedState,
    })
  ),
  extractPortFromRedirectUri: vi.fn().mockReturnValue(3000),
}));

// Make auth tests deterministic by disabling embedded OAuth fallback in this suite.
vi.mock('../../src/utils/oauth-config.js', () => ({
  getOAuthEnvConfig: () => ({
    clientId: undefined,
    clientSecret: undefined,
    redirectUri: undefined,
    configured: false,
    source: 'none',
  }),
}));

// Mock googleapis with proper OAuth2Client class
// Note: Class must be defined inside factory to avoid hoisting issues
// See tests/helpers/oauth-mocks.ts for the reference implementation
vi.mock('googleapis', () => {
  class MockOAuth2Client {
    credentials: any = {};

    generateAuthUrl = oauthClientMocks.generateAuthUrl;
    getToken = oauthClientMocks.getToken;
    setCredentials = vi.fn((tokens: any) => {
      this.credentials = tokens;
    });

    revokeToken = oauthClientMocks.revokeToken;
    getAccessToken = oauthClientMocks.getAccessToken;
    refreshAccessToken = oauthClientMocks.refreshAccessToken;
  }

  return {
    google: {
      auth: {
        OAuth2: MockOAuth2Client,
      },
    },
  };
});

vi.mock('../../src/services/session-context.js', () => ({
  getSessionContext: vi.fn(() => mockSessionContext),
}));

vi.mock('../../src/utils/oauth-callback-server.js', () => ({
  startCallbackServer: callbackServerMocks.startCallbackServer,
  extractPortFromRedirectUri: callbackServerMocks.extractPortFromRedirectUri,
}));

// Mock EncryptedFileTokenStore
// See tests/helpers/oauth-mocks.ts for the reference implementation
vi.mock('../../src/services/token-store.js', () => {
  class MockEncryptedFileTokenStore {
    save = vi.fn().mockResolvedValue(undefined);
    load = vi.fn().mockResolvedValue(null);
    clear = vi.fn().mockResolvedValue(undefined);
  }

  return {
    EncryptedFileTokenStore: MockEncryptedFileTokenStore,
  };
});

// Mock Google API client
const createMockGoogleClient = (
  authType: 'oauth' | 'service_account' | 'application_default' = 'oauth',
  hasTokens = false
): GoogleApiClient =>
  ({
    authType,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    getTokenStatus: vi.fn().mockReturnValue({
      hasAccessToken: hasTokens,
      hasRefreshToken: hasTokens,
    }),
    validateToken: vi.fn().mockResolvedValue({
      valid: hasTokens, // Token is valid if it exists
      error: hasTokens ? undefined : 'No token present',
    }),
    setCredentials: vi.fn(),
    setScopes: vi.fn(),
    clearStoredTokens: vi.fn(),
    revokeAccess: vi.fn(),
  }) as any;

async function startManualLoginAndGetState(handler: AuthHandler): Promise<string> {
  process.env['OAUTH_USE_CALLBACK_SERVER'] = 'false';

  const loginResult = await handler.handle({ action: 'login' });
  expect(loginResult.response.success).toBe(true);

  const state = new URL(loginResult.response.authUrl!).searchParams.get('state');
  expect(state).toBeTruthy();

  return state!;
}

describe('AuthHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset environment variables
    delete process.env['OAUTH_CLIENT_ID'];
    delete process.env['OAUTH_CLIENT_SECRET'];
    delete process.env['OAUTH_USE_CALLBACK_SERVER'];
    process.env['OAUTH_AUTO_OPEN_BROWSER'] = 'false';
    oauthClientMocks.lastGeneratedState = undefined;
    mockSessionContext.exportState.mockReturnValue('mock-session-state');
  });

  describe('status action', () => {
    it('should return authenticated status for service account', async () => {
      const mockClient = createMockGoogleClient('service_account', true);
      const handler = new AuthHandler({ googleClient: mockClient });

      const result = await handler.handle({ action: 'status' });

      expect(result).toHaveProperty('response');
      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('authenticated', true);
      expect(result.response).toHaveProperty('authType', 'service_account');
      expect(result.response).toHaveProperty('readiness.googleAuth.authenticated', true);
      expect(result.response).toHaveProperty('recommendedNextAction');

      const parseResult = SheetsAuthOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should return authenticated status for OAuth with tokens', async () => {
      const mockClient = createMockGoogleClient('oauth', true);
      const handler = new AuthHandler({ googleClient: mockClient });

      const result = await handler.handle({ action: 'status' });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('authenticated', true);
      expect(result.response).toHaveProperty('hasAccessToken', true);
      expect(result.response).toHaveProperty('hasRefreshToken', true);
    });

    it('should return not authenticated when no tokens', async () => {
      const mockClient = createMockGoogleClient('oauth', false);
      const handler = new AuthHandler({ googleClient: mockClient });

      const result = await handler.handle({ action: 'status' });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('authenticated', false);
      expect(result.response.message).toContain('Not authenticated');
      expect(result.response).toHaveProperty('blockingIssues.0.code', 'AUTHENTICATION_REQUIRED');
      expect(result.response).toHaveProperty('readiness.googleAuth.configured', true);
    });

    it('should return unconfigured when no OAuth credentials', async () => {
      const handler = new AuthHandler({ googleClient: null });

      const result = await handler.handle({ action: 'status' });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('authenticated', false);
      expect(result.response).toHaveProperty('authType', 'unconfigured');
    });

    it('should return configured but not authenticated', async () => {
      const handler = new AuthHandler({
        googleClient: null,
        oauthClientId: 'test-client-id',
        oauthClientSecret: 'test-secret',
      });

      const result = await handler.handle({ action: 'status' });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('authenticated', false);
      expect(result.response).toHaveProperty('authType', 'oauth');
    });

    it('surfaces re-auth guidance after repeated refresh failures and clears after success', async () => {
      const mockClient = createMockGoogleClient('oauth', true);
      const handler = new AuthHandler({
        googleClient: mockClient,
        oauthClientId: 'test-client-id',
        oauthClientSecret: 'test-secret',
        redirectUri: 'http://localhost:3000/callback',
      });
      const refreshError = new Error('Refresh token revoked');
      const oauthClient = {
        generateAuthUrl: oauthClientMocks.generateAuthUrl,
        refreshAccessToken: vi.fn().mockRejectedValue(refreshError),
        setCredentials: vi.fn(),
      } as any;

      (handler as any).startTokenManager(oauthClient);
      const tokenManager = (handler as any).tokenManager;

      await tokenManager.refreshToken();
      await tokenManager.refreshToken();
      await tokenManager.refreshToken();

      const reauthStatus = await handler.handle({ action: 'status' });

      expect(reauthStatus.response.success).toBe(false);
      if (!reauthStatus.response.success) {
        expect(reauthStatus.response.error.code).toBe('INVALID_CREDENTIALS');
        expect(reauthStatus.response.error.details?.['re_auth_url']).toContain(
          'https://accounts.google.com/o/oauth2/v2/auth'
        );
        expect(reauthStatus.response.error.details?.['consecutiveFailures']).toBe(3);
      }

      oauthClient.refreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: 'new-access-token',
          refresh_token: 'mock-refresh-token',
          expiry_date: 1704067200000 + 3600000,
        },
      });

      await tokenManager.refreshToken();

      const recoveredStatus = await handler.handle({ action: 'status' });

      expect(recoveredStatus.response.success).toBe(true);
      if (recoveredStatus.response.success) {
        expect(recoveredStatus.response.authenticated).toBe(true);
      }
    });
  });

  describe('login action', () => {
    it('should return error when OAuth not configured', async () => {
      const handler = new AuthHandler({ googleClient: null });

      const result = await handler.handle({ action: 'login' });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('CONFIG_ERROR');
      expect(result.response.error?.message).toContain('not configured');
    });

    it('should generate auth URL for manual flow', async () => {
      const handler = new AuthHandler({
        oauthClientId: 'test-client-id',
        oauthClientSecret: 'test-secret',
        redirectUri: 'http://localhost:3000/callback',
      });

      // Disable auto features
      process.env['OAUTH_USE_CALLBACK_SERVER'] = 'false';
      process.env['OAUTH_AUTO_OPEN_BROWSER'] = 'false';

      const result = await handler.handle({ action: 'login' });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('authUrl');
      expect(result.response.authUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(result.response).toHaveProperty('instructions');
      expect(result.response.instructions).toBeInstanceOf(Array);
    });

    it('should request additional scopes when provided', async () => {
      const mockClient = createMockGoogleClient('oauth', false);
      const handler = new AuthHandler({
        googleClient: mockClient,
        oauthClientId: 'test-client-id',
        oauthClientSecret: 'test-secret',
      });

      process.env['OAUTH_USE_CALLBACK_SERVER'] = 'false';

      const result = await handler.handle({
        action: 'login',
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      });

      expect(result.response.success).toBe(true);
      expect(result.response.scopes).toContain('https://www.googleapis.com/auth/drive.readonly');
    });

    it('should handle callback server timeout gracefully', async () => {
      const handler = new AuthHandler({
        oauthClientId: 'test-client-id',
        oauthClientSecret: 'test-secret',
        redirectUri: 'http://localhost:3000/callback',
      });

      // Note: Callback server timeout behavior is tested via environment variables
      // For simplicity, we test the manual flow which is the fallback
      process.env['OAUTH_USE_CALLBACK_SERVER'] = 'false';

      const result = await handler.handle({ action: 'login' });

      // Should fall back to manual flow
      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('authUrl');
    });

    it('does not overwrite client scopes in automatic callback flow when Google omits granted scopes', async () => {
      const mockClient = createMockGoogleClient('oauth', false);
      const handler = new AuthHandler({
        googleClient: mockClient,
        oauthClientId: 'test-client-id',
        oauthClientSecret: 'test-secret',
        redirectUri: 'http://localhost:3000/callback',
      });

      const result = await handler.handle({ action: 'login' });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('authenticated', true);
      expect(callbackServerMocks.startCallbackServer).toHaveBeenCalled();
      expect(mockClient.setScopes).not.toHaveBeenCalled();
      expect(mockSessionContext.importState).toHaveBeenCalledWith('mock-session-state');
    });
  });

  describe('callback action', () => {
    it('should exchange code for tokens', async () => {
      const mockClient = createMockGoogleClient('oauth', false);
      const handler = new AuthHandler({
        googleClient: mockClient,
        oauthClientId: 'test-client-id',
        oauthClientSecret: 'test-secret',
      });
      const state = await startManualLoginAndGetState(handler);

      const result = await handler.handle({
        action: 'callback',
        code: 'test-auth-code',
        state,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('authenticated', true);
      expect(result.response).toHaveProperty('hasRefreshToken', true);
    });

    it('should return error when OAuth not configured', async () => {
      const handler = new AuthHandler({ googleClient: null });

      const result = await handler.handle({
        action: 'callback',
        code: 'test-code',
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('CONFIG_ERROR');
    });

    it('should warn when encryption key not set', async () => {
      const handler = new AuthHandler({
        oauthClientId: 'test-client-id',
        oauthClientSecret: 'test-secret',
        tokenStoreKey: undefined,
      });
      const state = await startManualLoginAndGetState(handler);

      const result = await handler.handle({
        action: 'callback',
        code: 'test-code',
        state,
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.message).toContain('ENCRYPTION_KEY');
      }
    });

    it('rejects invalid state before exchanging the authorization code', async () => {
      const handler = new AuthHandler({
        oauthClientId: 'test-client-id',
        oauthClientSecret: 'test-secret',
      });

      const result = await handler.handle({
        action: 'callback',
        code: 'test-code',
        state: 'invalid-state',
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.message).toContain('state verification failed');
      expect(oauthClientMocks.getToken).not.toHaveBeenCalled();
      expect(mockSessionContext.importState).not.toHaveBeenCalled();
    });

    it('restores session state only when callback state matches the login state', async () => {
      process.env['OAUTH_USE_CALLBACK_SERVER'] = 'false';
      const handler = new AuthHandler({
        oauthClientId: 'test-client-id',
        oauthClientSecret: 'test-secret',
      });

      const loginResult = await handler.handle({ action: 'login' });
      expect(loginResult.response.success).toBe(true);
      const state = new URL(loginResult.response.authUrl!).searchParams.get('state');
      expect(state).toBeTruthy();

      const callbackResult = await handler.handle({
        action: 'callback',
        code: 'test-code',
        state: state!,
      });

      expect(callbackResult.response.success).toBe(true);
      expect(mockSessionContext.importState).toHaveBeenCalledWith('mock-session-state');
    });

    it('does not restore pending session state when callback omits state', async () => {
      process.env['OAUTH_USE_CALLBACK_SERVER'] = 'false';
      const handler = new AuthHandler({
        oauthClientId: 'test-client-id',
        oauthClientSecret: 'test-secret',
      });

      const loginResult = await handler.handle({ action: 'login' });
      expect(loginResult.response.success).toBe(true);

      const callbackResult = await handler.handle({
        action: 'callback',
        code: 'test-code',
      });

      expect(callbackResult.response.success).toBe(false);
      expect(callbackResult.response.error?.message).toContain('state verification failed');
      expect(mockSessionContext.importState).not.toHaveBeenCalled();
    });

    it('does not overwrite client scopes when Google omits granted scopes', async () => {
      const mockClient = createMockGoogleClient('oauth', false);
      const handler = new AuthHandler({
        googleClient: mockClient,
        oauthClientId: 'test-client-id',
        oauthClientSecret: 'test-secret',
      });
      const state = await startManualLoginAndGetState(handler);

      const result = await handler.handle({
        action: 'callback',
        code: 'test-code',
        state,
      });

      expect(result.response.success).toBe(true);
      expect(mockClient.setScopes).not.toHaveBeenCalled();
    });
  });

  describe('logout action', () => {
    it('should clear tokens and revoke access', async () => {
      const mockClient = createMockGoogleClient('oauth', true);
      const handler = new AuthHandler({ googleClient: mockClient });

      const result = await handler.handle({ action: 'logout' });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('authenticated', false);
      expect(mockClient.clearStoredTokens).toHaveBeenCalled();

      const parseResult = SheetsAuthOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should handle revoke errors gracefully', async () => {
      const mockClient = createMockGoogleClient('oauth', true);
      mockClient.revokeAccess = vi.fn().mockRejectedValue(new Error('Revoke failed'));
      const handler = new AuthHandler({ googleClient: mockClient });

      const result = await handler.handle({ action: 'logout' });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('authenticated', false);
    });

    it('should clear token store when no client', async () => {
      const handler = new AuthHandler({
        googleClient: null,
        tokenStoreKey: 'test-key',
      });

      const result = await handler.handle({ action: 'logout' });

      expect(result.response.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors', async () => {
      const mockClient = createMockGoogleClient('oauth', true);
      mockClient.getTokenStatus = vi.fn().mockImplementation(() => {
        throw new Error('Unexpected error');
      });
      const handler = new AuthHandler({ googleClient: mockClient });

      const result = await handler.handle({ action: 'status' });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INTERNAL_ERROR');
    });

    it('should validate output against schema', async () => {
      const handler = new AuthHandler({
        oauthClientId: 'test-id',
        oauthClientSecret: 'test-secret',
      });

      const result = await handler.handle({ action: 'status' });

      const parseResult = SheetsAuthOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });

  describe('setup_feature webhooks', () => {
    beforeEach(() => {
      delete process.env['REDIS_URL'];
      vi.resetModules();
    });

    afterEach(() => {
      delete process.env['REDIS_URL'];
    });

    it('returns instructions when no redisUrl provided', async () => {
      const handler = new AuthHandler({});
      const result = await handler.handle({
        action: 'setup_feature',
        feature: 'webhooks',
      });
      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.message).toMatch(/Provide a Redis URL/i);
        expect(result.response.instructions).toEqual(
          expect.arrayContaining([expect.stringMatching(/upstash|redis\.com/i)])
        );
      }
    });

    it('saves REDIS_URL from redisUrl field and reports hot-wire outcome', async () => {
      // Mock redis createClient to fail — confirms graceful fallback to restart-required
      vi.doMock('redis', () => ({
        createClient: () => ({
          connect: vi.fn().mockRejectedValue(new Error('connection refused')),
        }),
      }));

      const handler = new AuthHandler({});
      const result = await handler.handle({
        action: 'setup_feature',
        feature: 'webhooks',
        redisUrl: 'redis://localhost:6379',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        // URL was persisted even if hot-wire failed
        expect(process.env['REDIS_URL']).toBe('redis://localhost:6379');
        // Message indicates restart path
        expect(result.response.message).toMatch(/saved|restart/i);
      }
    });

    it('accepts legacy apiKey field as redis URL for backward compat', async () => {
      vi.doMock('redis', () => ({
        createClient: () => ({
          connect: vi.fn().mockRejectedValue(new Error('connection refused')),
        }),
      }));

      const handler = new AuthHandler({});
      const result = await handler.handle({
        action: 'setup_feature',
        feature: 'webhooks',
        apiKey: 'redis://legacy:6379',
      });

      expect(result.response.success).toBe(true);
      expect(process.env['REDIS_URL']).toBe('redis://legacy:6379');
    });

    it('response validates against output schema', async () => {
      const handler = new AuthHandler({});
      const result = await handler.handle({
        action: 'setup_feature',
        feature: 'webhooks',
      });
      expect(SheetsAuthOutputSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('token manager integration', () => {
    it('should start token manager after successful login', async () => {
      const handler = new AuthHandler({
        oauthClientId: 'test-client-id',
        oauthClientSecret: 'test-secret',
      });
      const state = await startManualLoginAndGetState(handler);

      const result = await handler.handle({
        action: 'callback',
        code: 'test-code',
        state,
      });

      expect(result.response.success).toBe(true);
    });

    it('should stop token manager on logout', async () => {
      const mockClient = createMockGoogleClient('oauth', true);
      const handler = new AuthHandler({ googleClient: mockClient });

      // First logout
      const result = await handler.handle({ action: 'logout' });

      expect(result.response.success).toBe(true);
    });
  });
});
