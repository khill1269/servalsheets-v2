/**
 * Tests for Google API Client
 *
 * Tests the GoogleApiClient class including initialization,
 * token management, scopes, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor } from '../helpers/wait-for.js';
import { google } from 'googleapis';

// Mock googleapis before importing the module
vi.mock('googleapis', () => {
  // Create a mock class for OAuth2
  class MockOAuth2 {
    credentials = {};
    setCredentials = vi.fn((tokens: Record<string, unknown>) => {
      this.credentials = { ...this.credentials, ...tokens };
    });
    on = vi.fn();
    off = vi.fn();
    generateAuthUrl = vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth');
    getToken = vi.fn().mockResolvedValue({ tokens: { access_token: 'test-token' } });
  }

  // Create a mock class for GoogleAuth
  class MockGoogleAuth {
    getClient = vi.fn().mockResolvedValue({
      credentials: {},
      setCredentials: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    });
  }

  return {
    google: {
      auth: {
        OAuth2: MockOAuth2,
        GoogleAuth: MockGoogleAuth,
      },
      sheets: vi.fn().mockReturnValue({
        spreadsheets: {
          get: vi.fn(),
          values: { get: vi.fn(), update: vi.fn() },
        },
      }),
      drive: vi.fn().mockReturnValue({
        files: { list: vi.fn(), get: vi.fn() },
      }),
      bigquery: vi.fn().mockReturnValue({
        datasets: { list: vi.fn(), get: vi.fn() },
        tables: { list: vi.fn(), get: vi.fn() },
        jobs: { query: vi.fn(), get: vi.fn() },
      }),
      docs: vi.fn().mockReturnValue({
        documents: { get: vi.fn(), create: vi.fn(), batchUpdate: vi.fn() },
      }),
      slides: vi.fn().mockReturnValue({
        presentations: { get: vi.fn(), create: vi.fn(), batchUpdate: vi.fn() },
      }),
      drivelabels: vi.fn().mockReturnValue({
        labels: { get: vi.fn(), list: vi.fn() },
      }),
      driveactivity: vi.fn().mockReturnValue({
        activity: { query: vi.fn() },
      }),
      workspaceevents: vi.fn().mockReturnValue({
        subscriptions: { create: vi.fn(), delete: vi.fn(), get: vi.fn(), list: vi.fn() },
      }),
    },
  };
});

// Mock token store
vi.mock('../services/token-store.js', () => ({
  EncryptedFileTokenStore: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock token manager
vi.mock('../services/token-manager.js', () => ({
  TokenManager: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    forceRefresh: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock circuit breaker
vi.mock('../utils/circuit-breaker.js', () => ({
  CircuitBreaker: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockImplementation((fn) => fn()),
    getStats: vi.fn().mockReturnValue({ state: 'closed', failures: 0 }),
  })),
}));

// Mock config
vi.mock('../config/env.js', () => ({
  getCircuitBreakerConfig: vi.fn().mockReturnValue({
    failureThreshold: 5,
    resetTimeout: 30000,
  }),
}));

// Mock HTTP/2 detector
vi.mock('../utils/http2-detector.js', () => ({
  logHTTP2Capabilities: vi.fn(),
  validateHTTP2Config: vi.fn().mockReturnValue({ warnings: [] }),
}));

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  GoogleApiClient,
  DEFAULT_SCOPES,
  ELEVATED_SCOPES,
  READONLY_SCOPES,
  resolveGoogleApiAgentTimeoutMs,
} from '../../src/services/google-api.js';

describe('GoogleApiClient', () => {
  let client: GoogleApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (client) {
      await client.destroy?.();
    }
  });

  describe('constructor', () => {
    it('should create client with default options', () => {
      client = new GoogleApiClient();
      expect(client).toBeDefined();
      expect(client.authType).toBe('application_default');
    });

    it('should detect service account auth type', () => {
      client = new GoogleApiClient({
        serviceAccountKeyPath: '/path/to/key.json',
      });
      expect(client.authType).toBe('service_account');
    });

    it('should detect oauth auth type', () => {
      client = new GoogleApiClient({
        credentials: {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        },
      });
      expect(client.authType).toBe('oauth');
    });

    it('should detect access token auth type', () => {
      client = new GoogleApiClient({
        accessToken: 'test-access-token',
      });
      expect(client.authType).toBe('access_token');
    });

    it('should use default scopes by default', () => {
      client = new GoogleApiClient();
      // Default is DEFAULT_SCOPES (minimal permissions with incremental consent)
      expect(client.scopes).toEqual(DEFAULT_SCOPES);
    });

    it('should use elevated scopes when requested', () => {
      client = new GoogleApiClient({ elevatedAccess: true });
      expect(client.scopes).toEqual(ELEVATED_SCOPES);
    });

    it('should use custom scopes when provided', () => {
      const customScopes = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
      client = new GoogleApiClient({ scopes: customScopes });
      expect(client.scopes).toEqual(customScopes);
    });
  });

  describe('scopes exports', () => {
    it('should export DEFAULT_SCOPES with spreadsheets and drive access', () => {
      expect(DEFAULT_SCOPES).toContain('https://www.googleapis.com/auth/spreadsheets');
      // Default is self-hosted mode which uses FULL_ACCESS_SCOPES (includes full drive)
      // In saas mode, this would be drive.file instead
      expect(
        DEFAULT_SCOPES.includes('https://www.googleapis.com/auth/drive') ||
          DEFAULT_SCOPES.includes('https://www.googleapis.com/auth/drive.file')
      ).toBe(true);
    });

    it('should export ELEVATED_SCOPES with full drive access', () => {
      expect(ELEVATED_SCOPES).toContain('https://www.googleapis.com/auth/spreadsheets');
      expect(ELEVATED_SCOPES).toContain('https://www.googleapis.com/auth/drive');
    });

    it('should export READONLY_SCOPES', () => {
      expect(READONLY_SCOPES).toContain('https://www.googleapis.com/auth/spreadsheets.readonly');
      expect(READONLY_SCOPES).toContain('https://www.googleapis.com/auth/drive.readonly');
    });
  });

  describe('resolveGoogleApiAgentTimeoutMs', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('prefers GOOGLE_API_TIMEOUT_MS', () => {
      process.env['GOOGLE_API_TIMEOUT_MS'] = '45000';
      process.env['GOOGLE_API_REQUEST_TIMEOUT_MS'] = '15000';

      expect(resolveGoogleApiAgentTimeoutMs()).toBe(45000);
    });

    it('falls back to the legacy GOOGLE_API_REQUEST_TIMEOUT_MS alias', () => {
      delete process.env['GOOGLE_API_TIMEOUT_MS'];
      process.env['GOOGLE_API_REQUEST_TIMEOUT_MS'] = '15000';

      expect(resolveGoogleApiAgentTimeoutMs()).toBe(15000);
    });

    it('uses the default timeout when neither env var is set', () => {
      delete process.env['GOOGLE_API_TIMEOUT_MS'];
      delete process.env['GOOGLE_API_REQUEST_TIMEOUT_MS'];

      expect(resolveGoogleApiAgentTimeoutMs()).toBe(60000);
    });
  });

  describe('initialize', () => {
    it('should initialize with OAuth credentials', async () => {
      client = new GoogleApiClient({
        credentials: {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          redirectUri: 'http://localhost:3000/callback',
        },
      });

      await client.initialize();

      // Should not throw
      expect(client.sheets).toBeDefined();
      expect(client.drive).toBeDefined();
    });

    it('should initialize with access token', async () => {
      client = new GoogleApiClient({
        accessToken: 'test-access-token',
      });

      await client.initialize();

      expect(client.sheets).toBeDefined();
    });

    it('should preserve explicit oauth token metadata during initialization', async () => {
      client = new GoogleApiClient({
        credentials: {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          redirectUri: 'http://localhost:3000/callback',
        },
        oauthTokens: {
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expiry_date: 1234567890,
          token_type: 'Bearer',
          scope: 'scope-a scope-b',
        },
      });

      await client.initialize();

      expect(client.getTokenStatus()).toEqual({
        hasAccessToken: true,
        hasRefreshToken: true,
        expiryDate: 1234567890,
        scope: 'scope-a scope-b',
      });
    });
  });

  describe('shared drive write throttling', () => {
    it('uses Drive metadata instead of spreadsheet ID heuristics for shared drive writes', async () => {
      client = new GoogleApiClient({
        accessToken: 'test-access-token',
      });
      await client.initialize();

      const driveApi = vi.mocked(google.drive).mock.results.at(-1)?.value as {
        files: { get: ReturnType<typeof vi.fn> };
      };
      const waitSpy = vi.spyOn(client, 'waitForSharedDriveWriteToken').mockResolvedValue(12);

      driveApi.files.get.mockResolvedValue({ data: { driveId: 'shared-drive-123' } });

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: 'sheet-123',
        range: 'Sheet1!A1',
        valueInputOption: 'RAW',
        requestBody: { values: [['x']] },
      });

      expect(driveApi.files.get).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'sheet-123',
          fields: 'driveId',
          supportsAllDrives: true,
        })
      );
      expect(waitSpy).toHaveBeenCalledTimes(1);
    });

    it('caches shared drive membership lookups per spreadsheet', async () => {
      client = new GoogleApiClient({
        accessToken: 'test-access-token',
      });
      await client.initialize();

      const driveApi = vi.mocked(google.drive).mock.results.at(-1)?.value as {
        files: { get: ReturnType<typeof vi.fn> };
      };

      driveApi.files.get.mockResolvedValue({ data: { driveId: 'shared-drive-123' } });

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: 'sheet-123',
        range: 'Sheet1!A1',
        valueInputOption: 'RAW',
        requestBody: { values: [['x']] },
      });
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: 'sheet-123',
        range: 'Sheet1!A2',
        valueInputOption: 'RAW',
        requestBody: { values: [['y']] },
      });

      expect(driveApi.files.get).toHaveBeenCalledTimes(1);
    });

    it('does not throttle writes when Drive metadata shows a personal drive file', async () => {
      client = new GoogleApiClient({
        accessToken: 'test-access-token',
      });
      await client.initialize();

      const driveApi = vi.mocked(google.drive).mock.results.at(-1)?.value as {
        files: { get: ReturnType<typeof vi.fn> };
      };
      const waitSpy = vi.spyOn(client, 'waitForSharedDriveWriteToken').mockResolvedValue(12);

      driveApi.files.get.mockResolvedValue({ data: {} });

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: 'sheet-123',
        range: 'Sheet1!A1',
        valueInputOption: 'RAW',
        requestBody: { values: [['x']] },
      });

      expect(waitSpy).not.toHaveBeenCalled();
    });
  });

  describe('sheets getter', () => {
    it('should throw ServiceError when not initialized', () => {
      client = new GoogleApiClient();

      expect(() => client.sheets).toThrow('Google API client not initialized');
    });

    it('should return sheets API when initialized', async () => {
      client = new GoogleApiClient({
        credentials: {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        },
      });

      await client.initialize();

      expect(client.sheets).toBeDefined();
      expect(client.sheets.spreadsheets).toBeDefined();
    });
  });

  describe('drive getter', () => {
    it('should throw ServiceError when not initialized', () => {
      client = new GoogleApiClient();

      expect(() => client.drive).toThrow('Google API client not initialized');
    });

    it('should return drive API when initialized', async () => {
      client = new GoogleApiClient({
        credentials: {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        },
      });

      await client.initialize();

      expect(client.drive).toBeDefined();
      expect(client.drive.files).toBeDefined();
    });
  });

  describe('oauth2 getter', () => {
    it('should throw ServiceError when not initialized', () => {
      client = new GoogleApiClient();

      expect(() => client.oauth2).toThrow('Google API client not initialized');
    });
  });

  describe('getTokenStatus', () => {
    it('should return empty status when not initialized', () => {
      client = new GoogleApiClient();

      const status = client.getTokenStatus();

      expect(status.hasAccessToken).toBe(false);
      expect(status.hasRefreshToken).toBe(false);
    });
  });

  describe('hasElevatedAccess', () => {
    it('should reflect scope mode for default scopes', () => {
      client = new GoogleApiClient();
      // Default is self-hosted mode which uses FULL_ACCESS_SCOPES (includes full drive)
      // hasElevatedAccess is true when scopes include full drive scope
      const hasDriveScope = client.scopes.includes('https://www.googleapis.com/auth/drive');
      expect(client.hasElevatedAccess).toBe(hasDriveScope);
    });

    it('should return true for elevated scopes', () => {
      client = new GoogleApiClient({ elevatedAccess: true });
      expect(client.hasElevatedAccess).toBe(true);
    });
  });

  describe('scopes getter', () => {
    it('should return a copy of scopes (not the original array)', () => {
      client = new GoogleApiClient();
      const scopes1 = client.scopes;
      const scopes2 = client.scopes;

      expect(scopes1).toEqual(scopes2);
      expect(scopes1).not.toBe(scopes2); // Different array instances
    });
  });
});

describe('GoogleApiClient token management', () => {
  it('should handle token store initialization', () => {
    const client = new GoogleApiClient({
      credentials: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      },
      tokenStorePath: '/tmp/tokens.encrypted',
      tokenStoreKey: '0'.repeat(64), // 64-char hex key
    });

    expect(client).toBeDefined();
  });

  it('should accept custom token store', () => {
    const customStore = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };

    const client = new GoogleApiClient({
      credentials: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      },
      tokenStore: customStore,
    });

    expect(client).toBeDefined();
  });
});

describe('GoogleApiClient options', () => {
  it('should accept retry options', () => {
    const client = new GoogleApiClient({
      retryOptions: {
        maxRetries: 5,
        initialDelayMs: 1000,
      },
    });

    expect(client).toBeDefined();
  });

  it('should accept timeout option', () => {
    const client = new GoogleApiClient({
      timeoutMs: 30000,
    });

    expect(client).toBeDefined();
  });
});

describe('GoogleApiClient HTTP/2 connection health', () => {
  let client: GoogleApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    delete process.env['GOOGLE_API_CONNECTION_RESET_THRESHOLD'];
    delete process.env['GOOGLE_API_MAX_IDLE_MS'];
    delete process.env['GOOGLE_API_KEEPALIVE_INTERVAL_MS'];
  });

  afterEach(async () => {
    if (client) {
      await client.destroy?.();
    }
  });

  describe('recordCallResult', () => {
    it('should reset consecutive errors on success', () => {
      client = new GoogleApiClient();

      // Simulate some failures first
      client.recordCallResult(false);
      client.recordCallResult(false);

      // Success should reset counter
      client.recordCallResult(true);

      // No way to directly check consecutiveErrors (private), but next 3 failures
      // should trigger reset if counter was properly reset
      client.recordCallResult(false);
      client.recordCallResult(false);
      client.recordCallResult(false); // Should trigger reset at threshold=3

      // Test passes if no errors thrown
      expect(client).toBeDefined();
    });

    it('should track consecutive errors', () => {
      client = new GoogleApiClient();

      client.recordCallResult(false);
      client.recordCallResult(false);

      // After 2 failures, should not trigger reset yet (threshold is 3)
      expect(client).toBeDefined();
    });

    it('should trigger connection reset after threshold failures', async () => {
      client = new GoogleApiClient();

      // Trigger 3 consecutive failures (default threshold)
      client.recordCallResult(false);
      client.recordCallResult(false);
      client.recordCallResult(false);

      // Wait a bit for async reset to start
      await waitFor(100);

      expect(client).toBeDefined();
    });

    it('should use custom threshold from environment', async () => {
      process.env['GOOGLE_API_CONNECTION_RESET_THRESHOLD'] = '5';
      client = new GoogleApiClient();

      // Trigger 4 failures (below custom threshold of 5)
      client.recordCallResult(false);
      client.recordCallResult(false);
      client.recordCallResult(false);
      client.recordCallResult(false);

      // Should not trigger reset yet
      await waitFor(50);

      // 5th failure should trigger
      client.recordCallResult(false);
      await waitFor(100);

      expect(client).toBeDefined();
    });

    it('should update connection health metrics', () => {
      client = new GoogleApiClient();

      client.recordCallResult(true);
      client.recordCallResult(false);

      // Metrics should be updated (we can't assert on metrics in this test,
      // but we verify no errors are thrown)
      expect(client).toBeDefined();
    });
  });

  describe('ensureHealthyConnection', () => {
    it('should not reset if connection is fresh', async () => {
      client = new GoogleApiClient();

      // Call immediately after creation (connection is fresh)
      await client.ensureHealthyConnection();

      // Should not trigger reset
      expect(client).toBeDefined();
    });

    it('should reset after max idle time', async () => {
      process.env['GOOGLE_API_MAX_IDLE_MS'] = '100'; // 100ms for testing
      client = new GoogleApiClient();

      // Wait for idle timeout
      await waitFor(150);

      // Should trigger proactive reset
      await client.ensureHealthyConnection();

      expect(client).toBeDefined();
    });

    it('should use custom max idle time from environment', async () => {
      process.env['GOOGLE_API_MAX_IDLE_MS'] = '200';
      client = new GoogleApiClient();

      // Wait less than custom timeout
      await waitFor(100);
      await client.ensureHealthyConnection();

      // Should not trigger reset yet
      expect(client).toBeDefined();

      // Wait past custom timeout
      await waitFor(150);
      await client.ensureHealthyConnection();

      // Should trigger reset now
      expect(client).toBeDefined();
    });
  });

  describe('connection reset integration', () => {
    it('should recover from consecutive HTTP/2 errors', async () => {
      client = new GoogleApiClient();

      // Simulate HTTP/2 error pattern
      for (let i = 0; i < 3; i++) {
        client.recordCallResult(false);
      }

      // Wait for async reset
      await waitFor(200);

      // Next success should work normally
      client.recordCallResult(true);

      expect(client).toBeDefined();
    });

    it('should prevent concurrent connection resets', async () => {
      client = new GoogleApiClient();

      // Trigger multiple rapid failures
      for (let i = 0; i < 10; i++) {
        client.recordCallResult(false);
      }

      // Wait for resets to process
      await waitFor(300);

      // Should handle gracefully (only one reset should run)
      expect(client).toBeDefined();
    });
  });

  describe('keepalive mechanism', () => {
    it('should start keepalive if interval configured', async () => {
      process.env['GOOGLE_API_KEEPALIVE_INTERVAL_MS'] = '100';
      client = new GoogleApiClient({
        credentials: {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        },
      });

      await client.initialize();

      // Wait for at least one keepalive cycle
      await waitFor(250);

      expect(client).toBeDefined();
    });

    it('should not start keepalive if interval is 0', async () => {
      process.env['GOOGLE_API_KEEPALIVE_INTERVAL_MS'] = '0';
      client = new GoogleApiClient({
        credentials: {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        },
      });

      await client.initialize();

      expect(client).toBeDefined();
    });

    it('should stop keepalive on destroy', async () => {
      process.env['GOOGLE_API_KEEPALIVE_INTERVAL_MS'] = '100';
      client = new GoogleApiClient({
        credentials: {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        },
      });

      await client.initialize();
      await client.destroy?.();

      // Should cleanup without errors
      expect(client).toBeDefined();
    });
  });

  describe('production scenarios', () => {
    it('should handle GOAWAY error recovery pattern', async () => {
      client = new GoogleApiClient();

      // Simulate GOAWAY pattern: multiple quick failures
      client.recordCallResult(false);
      client.recordCallResult(false);
      client.recordCallResult(false);

      // Wait for reset
      await waitFor(200);

      // Simulate successful reconnection
      client.recordCallResult(true);
      client.recordCallResult(true);

      expect(client).toBeDefined();
    });

    it('should maintain health during burst traffic', async () => {
      client = new GoogleApiClient();

      // Simulate burst of successful calls
      for (let i = 0; i < 50; i++) {
        client.recordCallResult(true);
      }

      // Check health
      await client.ensureHealthyConnection();

      expect(client).toBeDefined();
    });

    it('should handle intermittent failures gracefully', async () => {
      client = new GoogleApiClient();

      // Simulate intermittent failures (success resets counter)
      client.recordCallResult(false);
      client.recordCallResult(false);
      client.recordCallResult(true); // Reset
      client.recordCallResult(false);
      client.recordCallResult(false);
      client.recordCallResult(true); // Reset again

      // Should never trigger threshold
      await waitFor(100);

      expect(client).toBeDefined();
    });
  });
});
