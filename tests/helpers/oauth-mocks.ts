/**
 * ServalSheets - OAuth Mock Helpers
 *
 * Shared mock implementations for OAuth2Client and EncryptedFileTokenStore
 * to be used across all authentication-related tests.
 */

import { vi } from 'vitest';

/**
 * Mock OAuth2Client class with proper method signatures
 *
 * Usage:
 * ```typescript
 * vi.mock('googleapis', () => ({
 *   google: {
 *     auth: {
 *       OAuth2: MockOAuth2Client,
 *     },
 *   },
 * }));
 * ```
 */
export class MockOAuth2Client {
  credentials: any = {};

  generateAuthUrl = vi
    .fn()
    .mockReturnValue(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=test&redirect_uri=http://localhost:3000/callback&scope=https://www.googleapis.com/auth/spreadsheets&access_type=offline&response_type=code'
    );

  getToken = vi.fn().mockResolvedValue({
    tokens: {
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expiry_date: Date.now() + 3600000,
      scope:
        'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
    },
  });

  setCredentials = vi.fn((tokens: any) => {
    this.credentials = tokens;
  });

  revokeToken = vi.fn().mockResolvedValue({ success: true });

  getAccessToken = vi.fn().mockResolvedValue({
    token: 'mock-access-token',
  });

  refreshAccessToken = vi.fn().mockResolvedValue({
    credentials: {
      access_token: 'mock-refreshed-token',
      expiry_date: Date.now() + 3600000,
    },
  });
}

/**
 * Mock EncryptedFileTokenStore class
 *
 * Usage:
 * ```typescript
 * vi.mock('../../src/services/token-store.js', () => ({
 *   EncryptedFileTokenStore: MockEncryptedFileTokenStore,
 * }));
 * ```
 */
export class MockEncryptedFileTokenStore {
  save = vi.fn().mockResolvedValue(undefined);
  load = vi.fn().mockResolvedValue(null);
  clear = vi.fn().mockResolvedValue(undefined);
}

/**
 * Helper function to set up all OAuth-related mocks at once
 *
 * Call this in your test file's module scope to set up all mocks:
 * ```typescript
 * setupOAuthMocks();
 * ```
 */
export function setupOAuthMocks() {
  vi.mock('googleapis', () => ({
    google: {
      auth: {
        OAuth2: MockOAuth2Client,
      },
    },
  }));

  vi.mock('../../src/services/token-store.js', () => ({
    EncryptedFileTokenStore: MockEncryptedFileTokenStore,
  }));
}
